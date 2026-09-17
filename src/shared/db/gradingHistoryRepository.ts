/**
 * 批改历史记录数据库仓库
 * 使用 sql.js (SQLite) 进行数据持久化
 */

import initSqlJs from 'sql.js'
// 使用 Vite 的 ?url 导入获取 wasm 文件的本地路径
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url'
import type { GradingHistory, GradingHistoryFilter } from '@/types'

/**
 * 旧版 localStorage 明文键名（仅用于向后兼容迁移，迁移成功后会被清理）
 */
const LEGACY_STORAGE_KEY = 'grading_history_db'

/**
 * 主进程加密历史存储通道（由 electron/preload.ts 暴露）。
 * 渲染层只搬运整库字节，明文 PII 不再落 localStorage。
 */
interface HistoryBridge {
  load: () => Promise<Uint8Array | null>
  save: (bytes: Uint8Array) => Promise<{ ok: boolean; error?: string }>
  clear: () => Promise<{ ok: boolean; error?: string }>
}

function getHistoryBridge(): HistoryBridge | null {
  if (typeof window === 'undefined') return null
  const api = (window as any).electronAPI
  const bridge = api?.history
  if (bridge && typeof bridge.load === 'function' && typeof bridge.save === 'function') {
    return bridge as HistoryBridge
  }
  return null
}

// ===========================================
// 历史库读取失败的用户可见文案
// 技术细节（safeStorage / decrypt / AES-GCM 等）只写日志，UI 只展示可理解的人话
// ===========================================

/** 加密密钥跨设备/跨账户不匹配（safeStorage 场景） */
export const HISTORY_LOAD_KEY_MISMATCH_MESSAGE =
  '历史记录读取失败：加密密钥与当前设备或系统账户不匹配（多见于更换电脑、重装系统或更换 Windows 账户后）。原历史文件仍保留在应用数据目录中，未被删除，数据未丢失。'

/** 其他读取/解密失败（文件损坏、权限等） */
export const HISTORY_LOAD_FAILED_MESSAGE =
  '历史记录读取失败：无法打开本地加密历史文件（文件可能损坏或无访问权限）。原文件仍保留在应用数据目录中，未被删除，可稍后重试；如持续失败请联系技术支持。'

/**
 * 把主进程返回的技术性错误，分类为可直接展示给用户的中文说明。
 * 纯函数（无副作用、无外部依赖），便于单测。
 */
export function toUserFacingHistoryError(raw: unknown): string {
  const message = typeof raw === 'string' ? raw : String((raw as any)?.message ?? raw ?? '')
  const lower = message.toLowerCase()
  const looksLikeKeyMismatch =
    message.includes('无法解密') ||
    message.includes('系统安全存储加密') ||
    lower.includes('decrypt') ||
    lower.includes('safestorage')
  return looksLikeKeyMismatch ? HISTORY_LOAD_KEY_MISMATCH_MESSAGE : HISTORY_LOAD_FAILED_MESSAGE
}

/**
 * 数据库仓库类
 * 负责批改历史记录的 CRUD 操作
 */
class GradingHistoryRepository {
  private db: any = null
  private initialized: boolean = false
  // 是否使用主进程加密存储（false 表示回退到 localStorage 明文，仅限测试/浏览器环境）
  private useMainProcess: boolean = false

  /**
   * 初始化数据库
   * 创建表结构和索引
   */
  async init(): Promise<void> {
    if (this.initialized) return

    try {
      // 初始化 sql.js
      // 使用 Vite ?url 导入的本地路径，确保打包后能正确加载 wasm 文件
      const SQL = await initSqlJs({
        locateFile: () => sqlWasmUrl,
      })

      const bridge = getHistoryBridge()

      if (bridge) {
        this.useMainProcess = true
        // 以主进程加密文件为准。解密/读取失败会显式抛出，绝不静默清空历史。
        // 技术细节（safeStorage / decrypt / AES-GCM 等）只写日志；
        // 抛出的 message 是可直接展示给用户的中文说明（见 toUserFacingHistoryError）。
        let encryptedBytes: Uint8Array | null
        try {
          encryptedBytes = await bridge.load()
        } catch (loadError) {
          console.error('[GradingHistoryRepository] 读取/解密历史库失败（原始错误，仅记日志）:', loadError)
          throw new Error(toUserFacingHistoryError(loadError))
        }
        if (encryptedBytes && encryptedBytes.length > 0) {
          this.db = new SQL.Database(new Uint8Array(encryptedBytes))
          // 防御：加密文件已是权威副本，若仍残留旧版明文库（如上次迁移中途崩溃），一并清理
          try {
            if (typeof localStorage !== 'undefined' && localStorage.getItem(LEGACY_STORAGE_KEY)) {
              localStorage.removeItem(LEGACY_STORAGE_KEY)
              console.warn('[GradingHistoryRepository] 检测到残留的旧版 localStorage 明文库，已清理（权威副本为加密文件）')
            }
          } catch (err) {
            console.warn('[GradingHistoryRepository] 清理残留明文库失败:', err)
          }
        } else {
          // 首次运行（主进程文件为空）：尝试从旧版 localStorage 明文库迁移
          const legacyBytes = this.readLegacyDatabase()
          if (legacyBytes) {
            this.db = new SQL.Database(legacyBytes)
            this.createTables()
            this.createIndexes()
            // 迁移到加密文件；失败会抛出（上层可见），并保留 localStorage 明文副本作为回退
            await this.persistDatabase()
            // 迁移成功后清理旧明文副本，避免本地留存一份明文 PII
            try {
              localStorage.removeItem(LEGACY_STORAGE_KEY)
            } catch (err) {
              console.warn('[GradingHistoryRepository] 清理旧版 localStorage 明文库失败:', err)
            }
            this.initialized = true
            console.log('[GradingHistoryRepository] 数据库初始化成功（已从 localStorage 明文迁移到加密文件）')
            return
          }
          this.db = new SQL.Database()
        }
      } else {
        // 主进程通道不可用（测试/浏览器环境）：回退到 localStorage 明文
        this.useMainProcess = false
        console.warn(
          '[GradingHistoryRepository] 主进程历史存储通道不可用，回退到 localStorage 明文存储（仅限测试/浏览器环境；生产环境请勿依赖此路径）'
        )
        const legacyBytes = this.readLegacyDatabase()
        this.db = legacyBytes ? new SQL.Database(legacyBytes) : new SQL.Database()
      }

      // 创建表结构
      this.createTables()

      // 创建索引
      this.createIndexes()

      this.initialized = true
      console.log('[GradingHistoryRepository] 数据库初始化成功')
    } catch (error) {
      console.error('[GradingHistoryRepository] 数据库初始化失败:', error)
      throw error
    }
  }

  /**
   * 读取旧版 localStorage 明文库（JSON 数组，元素为字节数值）
   * 解析失败时返回 null（视为无旧数据），不抛错
   */
  private readLegacyDatabase(): Uint8Array | null {
    try {
      if (typeof localStorage === 'undefined') return null
      const raw = localStorage.getItem(LEGACY_STORAGE_KEY)
      if (!raw) return null
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed) || parsed.length === 0) return null
      return Uint8Array.from(parsed as number[])
    } catch (error) {
      console.error('[GradingHistoryRepository] 读取旧版 localStorage 历史库失败（将忽略该副本）:', error)
      return null
    }
  }

  /**
   * 创建数据库表
   */
  private createTables(): void {
    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS grading_history (
        id TEXT PRIMARY KEY,
        exam_id TEXT NOT NULL,
        student_id TEXT NOT NULL,
        student_name TEXT,
        standard_id TEXT NOT NULL,
        standard_name TEXT NOT NULL,
        final_score REAL NOT NULL,
        max_score REAL NOT NULL,
        criteria_snapshot TEXT NOT NULL,
        ai_score_detail TEXT,
        correction_records TEXT,
        grading_time INTEGER NOT NULL,
        evaluation_mode TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT
      )
    `

    this.db.run(createTableSQL)
  }

  /**
   * 创建索引
   */
  private createIndexes(): void {
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_exam_id ON grading_history(exam_id)',
      'CREATE INDEX IF NOT EXISTS idx_student_id ON grading_history(student_id)',
      'CREATE INDEX IF NOT EXISTS idx_created_at ON grading_history(created_at DESC)',
      'CREATE INDEX IF NOT EXISTS idx_status ON grading_history(status)',
    ]

    indexes.forEach((indexSQL) => this.db.run(indexSQL))
  }

  /**
   * 保存历史记录
   * @param history 批改历史记录
   * @returns 保存的记录ID（持久化失败会抛出，调用方必须感知）
   */
  async saveHistory(history: GradingHistory): Promise<string> {
    this.checkInitialized()

    const sql = `
      INSERT INTO grading_history (
        id, exam_id, student_id, student_name, standard_id, standard_name,
        final_score, max_score, criteria_snapshot, ai_score_detail,
        correction_records, grading_time, evaluation_mode, status,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `

    const params = [
      history.id,
      history.examId,
      history.studentId,
      history.studentName || null,
      history.standardId,
      history.standardName,
      history.finalScore,
      history.maxScore,
      history.criteriaSnapshot,
      history.aiScoreDetail || null,
      history.correctionRecords || null,
      history.gradingTime,
      history.evaluationMode,
      history.status,
      history.createdAt,
      history.updatedAt || null,
    ]

    try {
      this.db.run(sql, params)
      await this.persistDatabase()
      console.log(`[GradingHistoryRepository] 历史记录已保存: ${history.id}`)
      return history.id
    } catch (error) {
      console.error('[GradingHistoryRepository] 保存历史记录失败:', error)
      throw error
    }
  }

  /**
   * 根据ID获取历史记录
   * @param id 记录ID
   * @returns 历史记录或null
   */
  getHistoryById(id: string): GradingHistory | null {
    this.checkInitialized()

    const sql = 'SELECT * FROM grading_history WHERE id = ?'
    
    try {
      const stmt = this.db.prepare(sql)
      stmt.bind([id])
      const result = stmt.step() ? stmt.getAsObject() : null
      stmt.free()

      if (!result) return null

      return this.mapRowToHistory(result)
    } catch (error) {
      console.error('[GradingHistoryRepository] 获取历史记录失败:', error)
      throw error
    }
  }

  /**
   * 获取历史记录列表（支持分页和筛选）
   * @param filter 筛选条件
   * @param page 页码（从1开始）
   * @param pageSize 每页数量
   * @returns 历史记录列表和总数
   */
  getHistories(
    filter?: GradingHistoryFilter,
    page: number = 1,
    pageSize: number = 20
  ): { histories: GradingHistory[]; total: number } {
    this.checkInitialized()

    // 构建 WHERE 子句
    const { whereClause, params } = this.buildWhereClause(filter)

    // 查询总数
    const countSQL = `SELECT COUNT(*) as total FROM grading_history ${whereClause}`
    const countStmt = this.db.prepare(countSQL)
    countStmt.bind(params)
    const total = countStmt.step() ? countStmt.getAsObject().total : 0
    countStmt.free()

    // 查询数据
    const offset = (page - 1) * pageSize
    const dataSQL = `
      SELECT * FROM grading_history 
      ${whereClause} 
      ORDER BY created_at DESC 
      LIMIT ? OFFSET ?
    `
    const dataParams = [...params, pageSize, offset]

    try {
      const stmt = this.db.prepare(dataSQL)
      stmt.bind(dataParams)
      
      const histories: GradingHistory[] = []
      while (stmt.step()) {
        const row = stmt.getAsObject()
        histories.push(this.mapRowToHistory(row))
      }
      stmt.free()

      return { histories, total: Number(total) }
    } catch (error) {
      console.error('[GradingHistoryRepository] 获取历史记录列表失败:', error)
      throw error
    }
  }

  /**
   * 删除历史记录
   * @param id 记录ID（持久化失败会抛出）
   */
  async deleteHistory(id: string): Promise<void> {
    this.checkInitialized()

    const sql = 'DELETE FROM grading_history WHERE id = ?'
    
    try {
      this.db.run(sql, [id])
      await this.persistDatabase()
      console.log(`[GradingHistoryRepository] 历史记录已删除: ${id}`)
    } catch (error) {
      console.error('[GradingHistoryRepository] 删除历史记录失败:', error)
      throw error
    }
  }

  /**
   * 批量删除历史记录
   * @param ids 记录ID数组（持久化失败会抛出）
   */
  async deleteHistories(ids: string[]): Promise<void> {
    this.checkInitialized()

    if (ids.length === 0) return

    const placeholders = ids.map(() => '?').join(',')
    const sql = `DELETE FROM grading_history WHERE id IN (${placeholders})`
    
    try {
      this.db.run(sql, ids)
      await this.persistDatabase()
      console.log(`[GradingHistoryRepository] 批量删除历史记录: ${ids.length} 条`)
    } catch (error) {
      console.error('[GradingHistoryRepository] 批量删除历史记录失败:', error)
      throw error
    }
  }

  /**
   * 获取统计数据
   * @param filter 筛选条件
   * @returns 统计信息
   */
  getStatistics(filter?: GradingHistoryFilter): any {
    this.checkInitialized()

    const { whereClause, params } = this.buildWhereClause(filter)

    const sql = `
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
        AVG(CASE WHEN status = 'completed' THEN final_score END) as average_score,
        AVG(CASE WHEN status = 'completed' THEN grading_time END) as average_time
      FROM grading_history
      ${whereClause}
    `

    try {
      const stmt = this.db.prepare(sql)
      stmt.bind(params)
      const result = stmt.step() ? stmt.getAsObject() : null
      stmt.free()

      if (!result) {
        return {
          total: 0,
          completed: 0,
          failed: 0,
          averageScore: 0,
          averageTime: 0,
          passRate: 0,
        }
      }

      // 计算通过率（假设 >= 60% 满分即通过）
      const passRateSQL = `
        SELECT COUNT(*) as pass_count
        FROM grading_history
        WHERE status = 'completed' 
        AND (final_score * 100.0 / max_score) >= 60
        ${whereClause ? 'AND ' + whereClause.replace('WHERE ', '') : ''}
      `
      const passStmt = this.db.prepare(passRateSQL)
      passStmt.bind(params)
      const passResult = passStmt.step() ? passStmt.getAsObject() : { pass_count: 0 }
      passStmt.free()

      const passRate = result.completed > 0 
        ? (passResult.pass_count / result.completed) * 100 
        : 0

      return {
        total: Number(result.total),
        completed: Number(result.completed),
        failed: Number(result.failed),
        averageScore: Number(result.average_score) || 0,
        averageTime: Number(result.average_time) || 0,
        passRate: Math.round(passRate * 100) / 100,
      }
    } catch (error) {
      console.error('[GradingHistoryRepository] 获取统计数据失败:', error)
      throw error
    }
  }

  /**
   * 构建 WHERE 子句
   * @param filter 筛选条件
   * @returns WHERE 子句和参数数组
   */
  private buildWhereClause(filter?: GradingHistoryFilter): { whereClause: string; params: any[] } {
    if (!filter) return { whereClause: '', params: [] }

    const conditions: string[] = []
    const params: any[] = []

    if (filter.examId) {
      conditions.push('exam_id = ?')
      params.push(filter.examId)
    }

    if (filter.studentId) {
      conditions.push('student_id = ?')
      params.push(filter.studentId)
    }

    if (filter.studentName) {
      conditions.push('student_name LIKE ?')
      params.push(`%${filter.studentName}%`)
    }

    if (filter.standardId) {
      conditions.push('standard_id = ?')
      params.push(filter.standardId)
    }

    if (filter.startDate) {
      conditions.push('created_at >= ?')
      params.push(filter.startDate)
    }

    if (filter.endDate) {
      conditions.push('created_at <= ?')
      params.push(filter.endDate)
    }

    if (filter.minScore !== undefined) {
      conditions.push('final_score >= ?')
      params.push(filter.minScore)
    }

    if (filter.maxScore !== undefined) {
      conditions.push('final_score <= ?')
      params.push(filter.maxScore)
    }

    if (filter.evaluationMode) {
      conditions.push('evaluation_mode = ?')
      params.push(filter.evaluationMode)
    }

    if (filter.status) {
      conditions.push('status = ?')
      params.push(filter.status)
    }

    if (filter.searchText) {
      conditions.push('(student_name LIKE ? OR exam_id LIKE ? OR standard_name LIKE ?)')
      const searchPattern = `%${filter.searchText}%`
      params.push(searchPattern, searchPattern, searchPattern)
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    return { whereClause, params }
  }

  /**
   * 将数据库行映射为 GradingHistory 对象
   * @param row 数据库行
   * @returns GradingHistory 对象
   */
  private mapRowToHistory(row: any): GradingHistory {
    return {
      id: row.id,
      examId: row.exam_id,
      studentId: row.student_id,
      studentName: row.student_name,
      standardId: row.standard_id,
      standardName: row.standard_name,
      finalScore: row.final_score,
      maxScore: row.max_score,
      criteriaSnapshot: row.criteria_snapshot,
      aiScoreDetail: row.ai_score_detail,
      correctionRecords: row.correction_records,
      gradingTime: row.grading_time,
      evaluationMode: row.evaluation_mode,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  /**
   * 检查数据库是否已初始化
   */
  private checkInitialized(): void {
    if (!this.initialized || !this.db) {
      throw new Error('数据库未初始化，请先调用 init() 方法')
    }
  }

  /**
   * 持久化数据库整库字节
   *
   * 安全修复 高-06：写入失败必须上抛，绝不静默吞掉。
   *  - 主进程可用：走 IPC（userData/grading-history.enc，加密落盘）
   *  - 主进程不可用：回退 localStorage 明文（仅测试/浏览器环境，已有 warn 提示）
   */
  private async persistDatabase(): Promise<void> {
    const data = this.db.export() as Uint8Array

    if (this.useMainProcess) {
      const bridge = getHistoryBridge()
      if (!bridge) {
        throw new Error('主进程历史存储通道不可用，无法保存批改历史')
      }
      const result = await bridge.save(data)
      if (result && result.ok === false) {
        throw new Error(result.error || '主进程保存批改历史失败')
      }
      return
    }

    // 回退：localStorage 明文（仅测试/浏览器环境）
    try {
      localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(Array.from(data)))
    } catch (error) {
      // 修复：此前此处只 console.error 后静默返回，超配额后用户重启即静默丢失全部历史
      console.error('[GradingHistoryRepository] 回退存储（localStorage 明文）写入失败:', error)
      throw error
    }
  }

  /**
   * 清空所有历史记录（持久化失败会抛出）
   */
  async clearAll(): Promise<void> {
    this.checkInitialized()

    try {
      this.db.run('DELETE FROM grading_history')
      await this.persistDatabase()
      console.log('[GradingHistoryRepository] 已清空所有历史记录')
    } catch (error) {
      console.error('[GradingHistoryRepository] 清空历史记录失败:', error)
      throw error
    }
  }

  /**
   * 关闭数据库连接（会先尝试持久化，失败会抛出）
   */
  async close(): Promise<void> {
    if (this.db) {
      await this.persistDatabase()
      this.db.close()
      this.db = null
      this.initialized = false
      console.log('[GradingHistoryRepository] 数据库连接已关闭')
    }
  }
}

// 导出单例
const gradingHistoryRepository = new GradingHistoryRepository()
export default gradingHistoryRepository
