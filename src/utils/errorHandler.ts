/**
 * 全局错误处理器
 * 负责捕获和处理渲染进程的未处理错误
 */

// 错误日志接口
export interface ErrorLog {
  time: string
  type: string
  message: string
  stack?: string
  url?: string
  lineNumber?: number
  columnNumber?: number
  reason?: string // 用于 Promise rejection
}

// 已记录的错误集合（用于避免重复记录）
const loggedErrors = new Set<string>()

/**
 * 生成错误的唯一标识
 * 用于避免重复记录同一个错误
 */
function getErrorKey(errorLog: ErrorLog): string {
  const { message, stack, type } = errorLog
  return `${type}:${message}:${stack?.substring(0, 100) || ''}`
}

/**
 * 发送错误日志到主进程
 */
function sendErrorToMainProcess(errorLog: ErrorLog): void {
  try {
    // 检查是否重复
    const errorKey = getErrorKey(errorLog)
    if (loggedErrors.has(errorKey)) {
      console.log('[ErrorHandler] 跳过重复错误:', errorLog.message)
      return
    }

    // 记录到集合
    loggedErrors.add(errorKey)

    // 限制集合大小，避免内存泄漏
    if (loggedErrors.size > 100) {
      const iterator = loggedErrors.values()
      loggedErrors.delete(iterator.next().value!)
    }

    // 发送到主进程
    if (window.electronAPI && typeof window.electronAPI.send === 'function') {
      window.electronAPI.send('renderer-error', errorLog)
    } else {
      // 如果 electronAPI 不可用，输出到控制台
      console.error('[ErrorHandler] 无法发送到主进程:', errorLog)
    }
  } catch (error) {
    console.error('[ErrorHandler] 发送错误日志失败:', error)
  }
}

/**
 * 处理 JavaScript 全局错误
 */
function handleGlobalError(
  message: string | Event,
  source?: string,
  lineno?: number,
  colno?: number,
  error?: Error
): void {
  const errorLog: ErrorLog = {
    time: new Date().toISOString(),
    type: 'GLOBAL_ERROR',
    message: error?.message || (typeof message === 'string' ? message : '未知错误'),
    stack: error?.stack,
    url: source,
    lineNumber: lineno,
    columnNumber: colno
  }

  console.error('[ErrorHandler] 捕获到全局错误:', errorLog)
  sendErrorToMainProcess(errorLog)
}

/**
 * 处理未捕获的 Promise 拒绝
 */
function handleUnhandledRejection(event: PromiseRejectionEvent): void {
  const reason = event.reason
  const errorLog: ErrorLog = {
    time: new Date().toISOString(),
    type: 'UNHANDLED_REJECTION',
    message: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
    reason: String(reason)
  }

  console.error('[ErrorHandler] 捕获到未处理的 Promise 拒绝:', errorLog)
  sendErrorToMainProcess(errorLog)

  // 阻止默认行为（避免在控制台显示错误信息）
  event.preventDefault()
}

/**
 * 初始化全局错误处理器
 * 应该在应用启动时调用
 */
export function initErrorHandler(): void {
  if (typeof window === 'undefined') {
    console.warn('[ErrorHandler] 不在浏览器环境中，跳过初始化')
    return
  }

  // 捕获全局 JavaScript 错误
  window.addEventListener('error', (event) => {
    handleGlobalError(
      event.message,
      event.filename,
      event.lineno,
      event.colno,
      event.error
    )
  })

  // 捕获未处理的 Promise 拒绝
  window.addEventListener('unhandledrejection', handleUnhandledRejection)

  console.log('[ErrorHandler] 全局错误处理器已初始化')
}

/**
 * 销毁全局错误处理器
 * 用于清理事件监听器
 */
export function destroyErrorHandler(): void {
  if (typeof window === 'undefined') {
    return
  }

  // 移除事件监听器
  window.removeEventListener('error', handleGlobalError as any)
  window.removeEventListener('unhandledrejection', handleUnhandledRejection as any)

  // 清空错误记录
  loggedErrors.clear()

  console.log('[ErrorHandler] 全局错误处理器已销毁')
}

/**
 * 手动记录错误
 * 可以在业务代码中调用此函数记录错误
 */
export function logError(
  error: Error | string,
  type: string = 'MANUAL_ERROR'
): void {
  const errorLog: ErrorLog = {
    time: new Date().toISOString(),
    type,
    message: error instanceof Error ? error.message : error,
    stack: error instanceof Error ? error.stack : undefined
  }

  console.error('[ErrorHandler] 手动记录错误:', errorLog)
  sendErrorToMainProcess(errorLog)
}

/**
 * 手动记录警告
 * 用于记录非致命性问题
 */
export function logWarning(message: string, details?: any): void {
  const warningLog: ErrorLog = {
    time: new Date().toISOString(),
    type: 'WARNING',
    message,
    stack: details ? JSON.stringify(details) : undefined
  }

  console.warn('[ErrorHandler] 记录警告:', warningLog)
  sendErrorToMainProcess(warningLog)
}

// 导出默认对象（包含所有函数）
export default {
  init: initErrorHandler,
  destroy: destroyErrorHandler,
  logError,
  logWarning
}
