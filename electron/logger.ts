/**
 * 主进程日志记录器
 * 支持控制台输出 + 文件写入
 */

import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LOG_LEVELS: Record<LogLevel, string> = {
  debug: 'DEBUG',
  info: 'INFO',
  warn: 'WARN',
  error: 'ERROR',
}

// 日志文件路径
let logFilePath: string | null = null
let auditLogPath: string | null = null

function getLogDir(): string {
  const logDir = path.join(app?.getPath?.('userData') || './logs', 'logs')
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true })
  }
  return logDir
}

function getLogFilePath(): string {
  if (!logFilePath) {
    const logDir = getLogDir()
    const date = new Date().toISOString().split('T')[0]
    logFilePath = path.join(logDir, `app-${date}.log`)
  }
  return logFilePath
}

function getAuditLogPath(): string {
  if (!auditLogPath) {
    const logDir = getLogDir()
    const date = new Date().toISOString().split('T')[0]
    auditLogPath = path.join(logDir, `audit-${date}.log`)
  }
  return auditLogPath
}

// 日志轮转：单文件超过 10MB 即归档，最多保留最近 7 份归档（修复 OBS-08：此前无限增长）
const MAX_LOG_SIZE = 10 * 1024 * 1024
const MAX_ARCHIVED_LOGS = 7

function rotateIfNeeded(filePath: string): void {
  try {
    const stat = fs.statSync(filePath)
    if (stat.size < MAX_LOG_SIZE) return
    const rotated = filePath + '.' + Date.now() + '.rotated'
    fs.renameSync(filePath, rotated)
    cleanupOldLogs(filePath)
  } catch (err: any) {
    // 文件不存在或正在写入等：忽略，不阻塞日志
    if (err && err.code !== 'ENOENT') {
      console.error('[logger] 日志归档失败:', err)
    }
  }
}

function cleanupOldLogs(filePath: string): void {
  try {
    const dir = path.dirname(filePath)
    const base = path.basename(filePath)
    const archives = fs
      .readdirSync(dir)
      .filter((f) => f.startsWith(base) && f.endsWith('.rotated'))
      .sort()
    while (archives.length > MAX_ARCHIVED_LOGS) {
      const oldest = archives.shift()
      if (oldest) fs.unlinkSync(path.join(dir, oldest))
    }
  } catch (err) {
    console.error('[logger] 清理旧日志失败:', err)
  }
}

function writeToFile(filePath: string, content: string): void {
  try {
    rotateIfNeeded(filePath)
    fs.appendFileSync(filePath, content + '\n', { encoding: 'utf8' })
  } catch (err) {
    console.error('[logger] 写入日志文件失败:', err)
  }
}

function formatTimestamp(): string {
  return new Date().toISOString()
}

function log(level: LogLevel, module: string, ...args: any[]): void {
  const timestamp = formatTimestamp()
  const prefix = `[${timestamp}] [${LOG_LEVELS[level]}] [${module}]`
  const message = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')
  const fullMessage = `${prefix} ${message}`
  
  // 控制台输出
  switch (level) {
    case 'debug':
      console.debug(prefix, ...args)
      break
    case 'info':
      console.info(prefix, ...args)
      break
    case 'warn':
      console.warn(prefix, ...args)
      break
    case 'error':
      console.error(prefix, ...args)
      break
  }
  
  // 文件写入（info及以上级别）
  if (level !== 'debug') {
    writeToFile(getLogFilePath(), fullMessage)
  }
}

// 审计日志：记录关键业务操作
function auditLog(operation: string, details: Record<string, any>): void {
  const timestamp = formatTimestamp()
  const entry = {
    timestamp,
    operation,
    ...details,
  }
  const line = JSON.stringify(entry)
  console.info(`[AUDIT] ${line}`)
  writeToFile(getAuditLogPath(), line)
}

/**
 * 供 LogService 的文件传输器复用：把一行日志追加到当日日志文件。
 * 修复：此前 LogService 只注册了 ConsoleTransport，AIService 等服务的
 * 详细日志（含模型原始返回内容）从未落盘，问题排查时拿不到运行时证据。
 */
export function writeLogLine(line: string): void {
  writeToFile(getLogFilePath(), line)
}

export const logger = {
  debug: (module: string, ...args: any[]) => log('debug', module, ...args),
  info: (module: string, ...args: any[]) => log('info', module, ...args),
  warn: (module: string, ...args: any[]) => log('warn', module, ...args),
  error: (module: string, ...args: any[]) => log('error', module, ...args),
  audit: auditLog,
}
