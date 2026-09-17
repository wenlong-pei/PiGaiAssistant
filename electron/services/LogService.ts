/**
 * 日志服务
 * 提供统一的日志记录、敏感信息过滤、日志级别控制
 */

import { SENSITIVE_PATTERNS, LogLevel } from '../utils/constants'
import { isString } from '../utils/validators'

// ============ 日志级别标签 ============

const LEVEL_LABELS = {
  [LogLevel.ERROR]: 'ERROR',
  [LogLevel.WARN]: 'WARN',
  [LogLevel.INFO]: 'INFO',
  [LogLevel.DEBUG]: 'DEBUG',
} as const

// ============ 日志条目接口 ============

export interface LogEntry {
  timestamp: string
  level: LogLevel
  levelLabel: string
  message: string
  meta?: Record<string, any>
  error?: {
    message: string
    stack?: string
    name?: string
  }
}

// ============ 日志传输器接口 ============

export interface LogTransport {
  write(entry: LogEntry): void | Promise<void>
}

// ============ 控制台传输器 ============

class ConsoleTransport implements LogTransport {
  write(entry: LogEntry): void {
    const timestamp = entry.timestamp
    const level = entry.levelLabel
    const message = entry.message
    const metaStr = entry.meta ? ` ${JSON.stringify(entry.meta)}` : ''
    const errorStr = entry.error ? `\n${entry.error.name}: ${entry.error.message}\n${entry.error.stack || ''}` : ''
    
    const output = `[${timestamp}] [${level}] ${message}${metaStr}${errorStr}`
    
    switch (entry.level) {
      case LogLevel.ERROR:
        console.error(output)
        break
      case LogLevel.WARN:
        console.warn(output)
        break
      case LogLevel.INFO:
        console.info(output)
        break
      case LogLevel.DEBUG:
        console.debug(output)
        break
    }
  }
}

// ============ 日志服务类 ============

export class LogService {
  private level: LogLevel
  private transports: LogTransport[]
  private enableSanitize: boolean
  
  constructor(
    level: LogLevel = LogLevel.INFO,
    transports?: LogTransport[],
    enableSanitize: boolean = true
  ) {
    this.level = level
    this.transports = transports || [new ConsoleTransport()]
    this.enableSanitize = enableSanitize
  }
  
  // ============ 公共方法 ============
  
  /**
   * 记录信息日志
   */
  info(message: string, meta?: Record<string, any>): void {
    this.log(LogLevel.INFO, message, undefined, meta)
  }
  
  /**
   * 记录警告日志
   */
  warn(message: string, meta?: Record<string, any>): void {
    this.log(LogLevel.WARN, message, undefined, meta)
  }
  
  /**
   * 记录错误日志
   */
  error(message: string, error?: Error, meta?: Record<string, any>): void {
    this.log(LogLevel.ERROR, message, error, meta)
  }
  
  /**
   * 记录调试日志
   */
  debug(message: string, meta?: Record<string, any>): void {
    this.log(LogLevel.DEBUG, message, undefined, meta)
  }
  
  /**
   * 设置日志级别
   */
  setLevel(level: LogLevel): void {
    this.level = level
  }
  
  /**
   * 获取当前日志级别
   */
  getLevel(): LogLevel {
    return this.level
  }
  
  /**
   * 添加传输器
   */
  addTransport(transport: LogTransport): void {
    this.transports.push(transport)
  }
  
  /**
   * 移除所有传输器
   */
  clearTransports(): void {
    this.transports = []
  }
  
  // ============ 敏感信息过滤 ============
  
  /**
   * 过滤敏感信息
   * @param meta - 元数据对象
   * @returns 过滤后的元数据
   */
  sanitize(meta: Record<string, any>): Record<string, any> {
    if (!this.enableSanitize) return meta
    
    const sanitized = { ...meta }
    
    // 递归过滤对象中的所有字段
    const sanitizeValue = (obj: any, depth: number = 0): any => {
      // 防止无限递归
      if (depth > 5) return '[MAX_DEPTH]'
      
      if (isString(obj)) {
        // 检查字符串是否包含敏感信息
        let result = obj
        SENSITIVE_PATTERNS.forEach(pattern => {
          result = result.replace(pattern, '[REDACTED]')
        })
        return result
      }
      
      if (Array.isArray(obj)) {
        return obj.map(item => sanitizeValue(item, depth + 1))
      }
      
      if (obj && typeof obj === 'object') {
        const sanitizedObj: Record<string, any> = {}
        for (const key of Object.keys(obj)) {
          // 检查键名是否包含敏感信息
          const isSensitiveKey = SENSITIVE_PATTERNS.some(pattern => pattern.test(key))
          if (isSensitiveKey) {
            sanitizedObj[key] = '[REDACTED]'
          } else {
            sanitizedObj[key] = sanitizeValue(obj[key], depth + 1)
          }
        }
        return sanitizedObj
      }
      
      return obj
    }
    
    return sanitizeValue(sanitized)
  }
  
  // ============ 私有方法 ============
  
  /**
   * 核心日志记录方法
   */
  private log(
    level: LogLevel,
    message: string,
    error?: Error,
    meta?: Record<string, any>
  ): void {
    // 检查日志级别
    if (level > this.level) return
    
    // 构建日志条目
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      levelLabel: LEVEL_LABELS[level],
      message: this.enableSanitize ? this.sanitizeString(message) : message,
      meta,
    }
    
    // 处理错误对象
    if (error) {
      entry.error = {
        message: error.message,
        name: error.name,
        stack: error.stack,
      }
    }
    
    // 过滤元数据中的敏感信息
    if (meta && this.enableSanitize) {
      entry.meta = this.sanitize(meta)  // 直接净化并替换 meta
    }
    
    // 写入所有传输器
    this.transports.forEach(transport => {
      try {
        transport.write(entry)
      } catch (err) {
        console.error('Log transport error:', err)
      }
    })
  }
  
  /**
   * 过滤字符串中的敏感信息
   */
  private sanitizeString(text: string): string {
    if (!this.enableSanitize) return text
    
    let result = text
    SENSITIVE_PATTERNS.forEach(pattern => {
      result = result.replace(pattern, '[REDACTED]')
    })
    return result
  }
}

// ============ 默认日志服务实例 ============

let defaultLogger: LogService | null = null

/**
 * 获取默认日志服务实例（单例）
 */
export function getLogger(level?: LogLevel): LogService {
  if (!defaultLogger) {
    defaultLogger = new LogService(level || LogLevel.INFO)
  }
  
  if (level !== undefined) {
    defaultLogger.setLevel(level)
  }
  
  return defaultLogger
}

/**
 * 创建新的日志服务实例
 */
export function createLogger(
  level: LogLevel = LogLevel.INFO,
  enableSanitize: boolean = true
): LogService {
  return new LogService(level, undefined, enableSanitize)
}

// ============ 导出 ============

export default LogService
export { ConsoleTransport }
