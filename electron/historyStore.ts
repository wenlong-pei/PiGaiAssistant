/**
 * 批改历史加密存储（主进程）
 *
 * 安全修复 高-06（隐私 / PIPL）：
 * 批改历史库内含 student_name / student_id / 成绩等 PII。改造前整库以
 * JSON(Uint8Array) 明文写入渲染层 localStorage（键 grading_history_db），
 * 既违反 PIPL，又会因超配额写入失败被静默吞掉（重启即静默丢失全部历史）。
 *
 * 现改为：整库字节落盘到 userData/grading-history.enc 并加密。
 *  - 优先 safeStorage.encryptString（OS 级密钥，Windows 下为 DPAPI）
 *  - safeStorage 不可用时，降级为「机器信息派生密钥 + AES-256-GCM」，
 *    沿用 electron/SecureStorage.ts 既有的降级方案。
 *    注意：降级路径仍然是加密，绝不写明文（不把 PII 直接落盘）。
 *
 * 文件格式（首字节为算法标记，其后为密文载荷）：
 *  0x01 = safeStorage：载荷 = safeStorage.encryptString(UTF8(base64(DB)))
 *  0x02 = AES-256-GCM：载荷 = iv(16) | authTag(16) | ciphertext
 */

import { ipcMain, app, safeStorage } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import * as os from 'os'

export const HISTORY_CHANNELS = {
  LOAD: 'history:load',
  SAVE: 'history:save',
  CLEAR: 'history:clear',
} as const

const FILE_NAME = 'grading-history.enc'
const MAGIC_SAFE_STORAGE = 0x01
const MAGIC_AES_GCM = 0x02
const GCM_IV_LENGTH = 16
const GCM_TAG_LENGTH = 16

export interface HistoryOpResult {
  ok: boolean
  error?: string
}

/**
 * 加密文件路径（惰性计算：必须在 app ready 之后才有 userData 路径）
 */
function getHistoryFilePath(): string {
  return path.join(app.getPath('userData'), FILE_NAME)
}

/**
 * 从机器信息派生 AES-256 密钥（与 electron/SecureStorage.ts 的降级方案保持一致）
 */
function deriveFallbackKey(): Buffer {
  const machineInfo = [
    os.hostname(),
    os.platform(),
    os.arch(),
    os.totalmem(),
    process.env.USERNAME || process.env.USER || 'unknown',
    process.env.COMPUTERNAME || 'unknown',
  ].join('|')
  return crypto.scryptSync(machineInfo, 'grading-assistant-secure-salt', 32)
}

/**
 * 加密整库字节 → 待落盘 Buffer（首字节标记算法）
 */
function encryptToBuffer(plain: Buffer): Buffer {
  if (safeStorage.isEncryptionAvailable()) {
    try {
      // safeStorage 只接受字符串，故先用 base64 无损编码二进制
      const encrypted = safeStorage.encryptString(plain.toString('base64'))
      return Buffer.concat([Buffer.from([MAGIC_SAFE_STORAGE]), encrypted])
    } catch (error) {
      console.error('[historyStore] safeStorage 加密失败，降级到派生密钥 AES-256-GCM:', error)
    }
  } else {
    console.warn('[historyStore] safeStorage 不可用，降级到派生密钥 AES-256-GCM（仍为加密存储，不落明文）')
  }

  const key = deriveFallbackKey()
  const iv = crypto.randomBytes(GCM_IV_LENGTH)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()])
  const authTag = cipher.getAuthTag()
  return Buffer.concat([Buffer.from([MAGIC_AES_GCM]), iv, authTag, ciphertext])
}

/**
 * 解密整库字节。任何失败都必须抛出（绝不静默返回空库，否则等于静默丢数据）
 */
function decryptFromBuffer(raw: Buffer): Buffer {
  if (raw.length < 1) {
    throw new Error('批改历史加密文件为空或已损坏')
  }
  const magic = raw[0]
  const payload = raw.subarray(1)

  if (magic === MAGIC_SAFE_STORAGE) {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('批改历史由系统安全存储加密，但当前环境无法解密（更换机器/系统账户会导致此问题）')
    }
    return Buffer.from(safeStorage.decryptString(payload), 'base64')
  }

  if (magic === MAGIC_AES_GCM) {
    const iv = payload.subarray(0, GCM_IV_LENGTH)
    const authTag = payload.subarray(GCM_IV_LENGTH, GCM_IV_LENGTH + GCM_TAG_LENGTH)
    const ciphertext = payload.subarray(GCM_IV_LENGTH + GCM_TAG_LENGTH)
    const decipher = crypto.createDecipheriv('aes-256-gcm', deriveFallbackKey(), iv)
    decipher.setAuthTag(authTag)
    return Buffer.concat([decipher.update(ciphertext), decipher.final()])
  }

  throw new Error(`批改历史文件格式无法识别（magic=0x${magic.toString(16)}）`)
}

/**
 * 把来自渲染层的字节负载归一化为 Buffer
 */
function toBuffer(input: unknown): Buffer {
  if (Buffer.isBuffer(input)) return input
  if (input instanceof Uint8Array) return Buffer.from(input)
  if (input instanceof ArrayBuffer) return Buffer.from(new Uint8Array(input))
  if (Array.isArray(input)) return Buffer.from(input)
  throw new Error('history:save 收到无效的数据格式（期望 Uint8Array）')
}

/**
 * 原子写入：先写临时文件再 rename，避免写一半崩溃导致库损坏
 */
function writeFileAtomic(filePath: string, data: Buffer): void {
  const tmpPath = `${filePath}.tmp`
  fs.writeFileSync(tmpPath, data)
  fs.renameSync(tmpPath, filePath)
}

/**
 * 注册批改历史加密存储的 IPC 处理程序
 * 由 electron/main.ts 在 app ready 后调用一次
 */
export function registerHistoryHandlers(): void {
  // 读取整库字节；文件不存在返回 null（首次运行）
  ipcMain.handle(HISTORY_CHANNELS.LOAD, async (): Promise<Uint8Array | null> => {
    const filePath = getHistoryFilePath()
    if (!fs.existsSync(filePath)) return null
    const raw = fs.readFileSync(filePath)
    return new Uint8Array(decryptFromBuffer(raw))
  })

  // 写入整库字节；失败必须抛出（渲染层据此感知「历史未能保存」）
  ipcMain.handle(HISTORY_CHANNELS.SAVE, async (_event, bytes: unknown): Promise<HistoryOpResult> => {
    const data = toBuffer(bytes)
    if (data.length === 0) {
      throw new Error('拒绝写入空的批改历史库（避免误清空用户历史）')
    }
    const encrypted = encryptToBuffer(data)
    try {
      writeFileAtomic(getHistoryFilePath(), encrypted)
      return { ok: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error('[historyStore] 写入加密历史库失败（将上抛给渲染层）:', error)
      throw new Error(`批改历史写入失败：${message}`)
    }
  })

  // 清除加密文件
  ipcMain.handle(HISTORY_CHANNELS.CLEAR, async (): Promise<HistoryOpResult> => {
    const filePath = getHistoryFilePath()
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
      return { ok: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error('[historyStore] 清除加密历史库失败:', error)
      throw new Error(`清除批改历史失败：${message}`)
    }
  })
}
