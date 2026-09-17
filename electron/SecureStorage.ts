/**
 * 安全存储工具
 * 使用 electron-safe-storage 加密敏感信息
 */

import { safeStorage, app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import * as os from 'os'

interface SecureStoreData {
  [key: string]: string // 加密后的 base64 字符串
}

class SecureStorage {
  private filePath: string
  private data: SecureStoreData = {}

  constructor() {
    // 存储在用户数据目录下
    const userDataPath = app.getPath('userData')
    this.filePath = path.join(userDataPath, 'secure-store.json')
    this.load()
  }

  /**
   * 从文件加载加密数据
   */
  private load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const content = fs.readFileSync(this.filePath, 'utf-8')
        this.data = JSON.parse(content)
      }
    } catch (error) {
      console.error('Failed to load secure store:', error)
      this.data = {}
    }
  }

  /**
   * 保存加密数据到文件
   */
  private save(): void {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8')
    } catch (error) {
      console.error('Failed to save secure store:', error)
    }
  }

  /**
   * 检查是否支持安全存储
   */
  isAvailable(): boolean {
    return safeStorage.isEncryptionAvailable()
  }

  /**
   * 从机器信息派生 AES-256 密钥
   */
  private deriveKey(): Buffer {
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
   * 加密字符串
   */
  private encrypt(plainText: string): string {
    if (this.isAvailable()) {
      try {
        const encrypted = safeStorage.encryptString(plainText)
        return encrypted.toString('base64')
      } catch (error) {
        console.error('Encryption failed:', error)
        throw new Error('Failed to encrypt data')
      }
    }

    // Fallback: 使用 AES-256-GCM 加密
    console.warn('Safe storage not available, using fallback AES-256-GCM encryption')
    try {
      const key = this.deriveKey()
      const iv = crypto.randomBytes(16)
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)

      const encrypted = Buffer.concat([
        cipher.update(plainText, 'utf8'),
        cipher.final(),
      ])
      const authTag = cipher.getAuthTag()

      // 拼接: iv(16) + authTag(16) + encrypted
      const combined = Buffer.concat([iv, authTag, encrypted])
      return combined.toString('base64')
    } catch (error) {
      console.error('Fallback encryption failed:', error)
      throw new Error('Failed to encrypt data')
    }
  }

  /**
   * 解密字符串
   */
  private decrypt(encryptedBase64: string): string {
    if (this.isAvailable()) {
      try {
        const encrypted = Buffer.from(encryptedBase64, 'base64')
        return safeStorage.decryptString(encrypted)
      } catch (error) {
        console.error('Decryption failed:', error)
        throw new Error('Failed to decrypt data')
      }
    }

    // Fallback: 使用 AES-256-GCM 解密
    console.warn('Safe storage not available, using fallback AES-256-GCM decryption')
    try {
      const key = this.deriveKey()
      const combined = Buffer.from(encryptedBase64, 'base64')

      // 提取: iv(16) + authTag(16) + encrypted
      const iv = combined.subarray(0, 16)
      const authTag = combined.subarray(16, 32)
      const encrypted = combined.subarray(32)

      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
      decipher.setAuthTag(authTag)

      const decrypted = Buffer.concat([
        decipher.update(encrypted),
        decipher.final(),
      ])
      return decrypted.toString('utf8')
    } catch (error) {
      console.error('Fallback decryption failed:', error)
      throw new Error('Failed to decrypt data')
    }
  }

  /**
   * 设置加密值
   * @param key - 键名
   * @param value - 值（空字符串会被存储，用于表示"删除"）
   */
  set(key: string, value: string): void {
    // 允许存储空字符串（表示删除/清除）
    // 如果 value 是 undefined 或 null，则返回
    if (value === undefined || value === null) {
      return
    }

    if (value === '') {
      // 空字符串表示删除该键
      delete this.data[key]
      this.save()
      return
    }
    
    const encrypted = this.encrypt(value)
    this.data[key] = encrypted
    this.save()
  }

  /**
   * 获取解密值
   */
  get(key: string): string | null {
    const encrypted = this.data[key]
    if (!encrypted) return null

    try {
      return this.decrypt(encrypted)
    } catch (error) {
      console.error(`Failed to get key ${key}:`, error)
      return null
    }
  }

  /**
   * 删除值
   */
  delete(key: string): void {
    delete this.data[key]
    this.save()
  }

  /**
   * 检查是否存在
   */
  has(key: string): boolean {
    return key in this.data
  }

  /**
   * 获取所有键
   */
  keys(): string[] {
    return Object.keys(this.data)
  }

  /**
   * 清除所有数据
   */
  clear(): void {
    this.data = {}
    this.save()
  }
}

// 单例实例
let secureStorageInstance: SecureStorage | null = null

export function getSecureStorage(): SecureStorage {
  if (!secureStorageInstance) {
    secureStorageInstance = new SecureStorage()
  }
  return secureStorageInstance
}

export { SecureStorage }
