/**
 * 统一错误处理工具
 * 提供标准化的错误类、错误处理函数和错误上报机制
 */

import { LogService } from '../services/LogService'

// ============ 自定义错误类 ============

/**
 * 应用基础错误类
 * 所有自定义错误都应继承此类
 */
export class AppError extends Error {
  public readonly code: string
  public readonly statusCode: number
  public readonly isOperational: boolean

  constructor(
    message: string,
    code: string = 'UNKNOWN_ERROR',
    statusCode: number = 500,
    isOperational: boolean = true
  ) {
    super(message)
    this.name = this.constructor.name
    this.code = code
    this.statusCode = statusCode
    this.isOperational = isOperational
    
    // 保持正确的原型链
    Object.setPrototypeOf(this, AppError.prototype)
    
    // 捕获堆栈跟踪
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor)
    }
  }
}

/**
 * 验证错误 - 输入验证失败
 */
export class ValidationError extends AppError {
  constructor(message: string, field?: string) {
    super(message, 'VALIDATION_ERROR', 400)
    this.name = 'ValidationError'
    if (field) {
      this.message = `${field}: ${message}`
    }
  }
}

/**
 * 认证错误 - API Key 无效或缺失
 */
export class AuthenticationError extends AppError {
  constructor(message: string = 'Authentication failed') {
    super(message, 'AUTHENTICATION_ERROR', 401)
    this.name = 'AuthenticationError'
  }
}

/**
 * 授权错误 - 权限不足
 */
export class AuthorizationError extends AppError {
  constructor(message: string = 'Permission denied') {
    super(message, 'AUTHORIZATION_ERROR', 403)
    this.name = 'AuthorizationError'
  }
}

/**
 * 资源未找到错误
 */
export class NotFoundError extends AppError {
  constructor(resource: string, identifier?: string) {
    const message = identifier 
      ? `${resource} not found: ${identifier}`
      : `${resource} not found`
    super(message, 'NOT_FOUND', 404)
    this.name = 'NotFoundError'
  }
}

/**
 * 超时错误
 */
export class TimeoutError extends AppError {
  public readonly timeout: number
  
  constructor(message: string = 'Operation timed out', timeout?: number) {
    super(message, 'TIMEOUT_ERROR', 408)
    this.name = 'TimeoutError'
    this.timeout = timeout || 0
  }
}

/**
 * 配置错误 - 配置缺失或无效
 */
export class ConfigurationError extends AppError {
  constructor(message: string, configKey?: string) {
    const fullMessage = configKey 
      ? `Configuration error [${configKey}]: ${message}`
      : `Configuration error: ${message}`
    super(fullMessage, 'CONFIGURATION_ERROR', 500)
    this.name = 'ConfigurationError'
  }
}

/**
 * 服务不可用错误
 */
export class ServiceUnavailableError extends AppError {
  public readonly service: string
  
  constructor(service: string, message?: string) {
    super(message || `${service} is unavailable`, 'SERVICE_UNAVAILABLE', 503)
    this.name = 'ServiceUnavailableError'
    this.service = service
  }
}

// ============ 错误代码枚举 ============

export enum ErrorCode {
  // 通用错误
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  NOT_FOUND = 'NOT_FOUND',
  TIMEOUT = 'TIMEOUT',
  
  // 认证/授权错误
  AUTHENTICATION_ERROR = 'AUTHENTICATION_ERROR',
  AUTHORIZATION_ERROR = 'AUTHORIZATION_ERROR',
  API_KEY_MISSING = 'API_KEY_MISSING',
  API_KEY_INVALID = 'API_KEY_INVALID',
  
  // 配置错误
  CONFIGURATION_ERROR = 'CONFIGURATION_ERROR',
  CONFIG_MISSING = 'CONFIG_MISSING',
  CONFIG_INVALID = 'CONFIG_INVALID',
  
  // 浏览器错误
  BROWSER_LAUNCH_FAILED = 'BROWSER_LAUNCH_FAILED',
  BROWSER_NOT_LAUNCHED = 'BROWSER_NOT_LAUNCHED',
  PAGE_NAVIGATION_FAILED = 'PAGE_NAVIGATION_FAILED',
  ELEMENT_NOT_FOUND = 'ELEMENT_NOT_FOUND',
  
  // OCR 错误
  OCR_NOT_CONFIGURED = 'OCR_NOT_CONFIGURED',
  OCR_RECOGNITION_FAILED = 'OCR_RECOGNITION_FAILED',
  OCR_TIMEOUT = 'OCR_TIMEOUT',
  
  // AI 错误
  AI_NOT_CONFIGURED = 'AI_NOT_CONFIGURED',
  AI_API_CALL_FAILED = 'AI_API_CALL_FAILED',
  AI_RESPONSE_PARSE_FAILED = 'AI_RESPONSE_PARSE_FAILED',
  AI_RATE_LIMITED = 'AI_RATE_LIMITED',
  
  // 存储错误
  STORAGE_ERROR = 'STORAGE_ERROR',
  STORAGE_NOT_AVAILABLE = 'STORAGE_NOT_AVAILABLE',
  
  // 文件路径错误
  PATH_NOT_ALLOWED = 'PATH_NOT_ALLOWED',
  FILE_NOT_FOUND = 'FILE_NOT_FOUND',
  FILE_READ_ERROR = 'FILE_READ_ERROR',
  FILE_WRITE_ERROR = 'FILE_WRITE_ERROR',
}

// ============ 错误处理函数 ============

/**
 * 标准化错误响应格式
 */
export interface ErrorResponse {
  success: false
  error: string
  code: string
  details?: any
}

/**
 * 将任意错误转换为标准错误响应
 * @param error - 任意错误对象
 * @returns 标准错误响应对象
 */
export function toErrorResponse(error: unknown): ErrorResponse {
  if (error instanceof AppError) {
    return {
      success: false,
      error: error.message,
      code: error.code,
      details: {
        statusCode: error.statusCode,
        isOperational: error.isOperational,
      },
    }
  }
  
  if (error instanceof Error) {
    return {
      success: false,
      error: error.message,
      code: ErrorCode.UNKNOWN_ERROR,
      details: {
        stack: error.stack,
      },
    }
  }
  
  // 未知类型的错误
  return {
    success: false,
    error: String(error),
    code: ErrorCode.UNKNOWN_ERROR,
  }
}

/**
 * 处理并记录错误
 * @param error - 错误对象
 * @param logger - 日志服务实例
 * @param context - 上下文信息
 * @returns 标准错误响应
 */
export function handleError(
  error: unknown,
  logger?: LogService,
  context?: Record<string, any>
): ErrorResponse {
  const errorResponse = toErrorResponse(error)
  
  // 记录错误日志
  if (logger) {
    logger.error(errorResponse.error, error instanceof Error ? error : undefined, {
      code: errorResponse.code,
      context,
    })
  } else {
    console.error('[Error]', errorResponse.error, { code: errorResponse.code, context })
  }
  
  return errorResponse
}

/**
 * 异步错误处理包装器
 * 自动捕获 async 函数中的错误并返回标准响应
 * @param fn - 异步函数
 * @param logger - 日志服务实例
 * @returns 包装后的函数
 */
export function asyncErrorHandler<T extends any[], R>(
  fn: (...args: T) => Promise<R>,
  logger?: LogService
): (...args: T) => Promise<R | ErrorResponse> {
  return async (...args: T) => {
    try {
      return await fn(...args)
    } catch (error) {
      return handleError(error, logger, { args: args.length })
    }
  }
}

/**
 * 重试机制包装器
 * @param fn - 要重试的异步函数
 * @param maxRetries - 最大重试次数
 * @param delay - 重试延迟（毫秒）
 * @param logger - 日志服务实例
 * @returns 函数执行结果
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  delay: number = 1000,
  logger?: LogService
): Promise<T> {
  let lastError: unknown
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      
      if (attempt < maxRetries) {
        const waitTime = delay * (attempt + 1)
        if (logger) {
          logger.warn(`重试第 ${attempt + 1} 次失败，等待 ${waitTime}ms 后重试`, { error })
        }
        
        await new Promise(resolve => setTimeout(resolve, waitTime))
      }
    }
  }
  
  throw lastError
}

/**
 * 超时包装器
 * @param promise - Promise 对象
 * @param timeout - 超时时间（毫秒）
 * @param errorMessage - 超时错误消息
 * @returns Promise 结果
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeout: number,
  errorMessage?: string
): Promise<T> {
  const timeoutPromise = new Promise<T>((_, reject) => {
    setTimeout(() => {
      reject(new TimeoutError(errorMessage || `Operation timed out after ${timeout}ms`, timeout))
    }, timeout)
  })
  
  return Promise.race([promise, timeoutPromise])
}

// ============ 类型守卫 ============

/**
 * 检查是否为 AppError 实例
 */
export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError
}

/**
 * 检查是否为特定错误代码
 */
export function isErrorCode(error: unknown, code: ErrorCode): boolean {
  return isAppError(error) && error.code === code
}

// ============ 导出 ============

export default {
  AppError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  TimeoutError,
  ConfigurationError,
  ServiceUnavailableError,
  ErrorCode,
  toErrorResponse,
  handleError,
  asyncErrorHandler,
  withRetry,
  withTimeout,
  isAppError,
  isErrorCode,
}
