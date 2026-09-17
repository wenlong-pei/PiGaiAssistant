/**
 * 输入验证工具函数
 * 提供类型验证、参数验证、安全验证等功能
 */

import { LogLevel, SENSITIVE_PATTERNS } from './constants'

// ============ 类型验证工具 ============

/**
 * 检查值是否为字符串
 */
export function isString(value: unknown): value is string {
  return typeof value === 'string'
}

/**
 * 检查值是否为非空字符串
 */
export function isNonEmptyString(value: unknown): value is string {
  return isString(value) && value.trim().length > 0
}

/**
 * 检查值是否为数字
 */
export function isNumber(value: unknown): value is number {
  return typeof value === 'number' && !isNaN(value) && isFinite(value)
}

/**
 * 检查值是否为整数
 */
export function isInteger(value: unknown): value is number {
  return isNumber(value) && Number.isInteger(value)
}

/**
 * 检查值是否为布尔值
 */
export function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean'
}

/**
 * 检查值是否为对象
 */
export function isObject(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 检查值是否为数组
 */
export function isArray(value: unknown): value is any[] {
  return Array.isArray(value)
}

/**
 * 检查值是否为指定类型的数组
 */
export function isArrayOf<T>(
  value: unknown,
  predicate: (item: unknown) => item is T
): value is T[] {
  return isArray(value) && value.every(predicate)
}

// ============ 范围验证工具 ============

/**
 * 检查数字是否在指定范围内
 */
export function isInRange(value: number, min: number, max: number): boolean {
  return isNumber(value) && value >= min && value <= max
}

/**
 * 检查字符串长度是否在指定范围内
 */
export function isStringLengthInRange(
  value: string,
  min: number,
  max: number
): boolean {
  return isString(value) && value.length >= min && value.length <= max
}

/**
 * 检查数组长度是否在指定范围内
 */
export function isArrayLengthInRange(
  value: any[],
  min: number,
  max: number
): boolean {
  return isArray(value) && value.length >= min && value.length <= max
}

// ============ IPC 输入验证 ============

/**
 * 验证 IPC 调用参数 - bot:grade
 */
export interface GradeValidationResult {
  valid: boolean
  error?: string
  text?: string
  standard?: any
  correctionHistory?: any[]
}

export function validateGradeParams(
  text: unknown,
  standard: unknown,
  correctionHistory?: unknown
): GradeValidationResult {
  // 验证 text
  if (!text || !isString(text)) {
    return { valid: false, error: 'Invalid text parameter: must be a non-empty string' }
  }
  
  if (text.length > 100000) {
    return { valid: false, error: 'Invalid text parameter: text too long (max 100000 characters)' }
  }
  
  // 验证 standard
  if (!standard || !isObject(standard)) {
    return { valid: false, error: 'Invalid standard parameter: must be an object' }
  }
  
  // 验证 standard.totalScore
  if (standard.totalScore !== undefined) {
    if (!isNumber(standard.totalScore) || !isInRange(standard.totalScore, 0, 1000)) {
      return { valid: false, error: 'Invalid standard.totalScore: must be a number between 0 and 1000' }
    }
  }
  
  // 验证 standard.id
  if (standard.id !== undefined && !isString(standard.id)) {
    return { valid: false, error: 'Invalid standard.id: must be a string' }
  }
  
  // 验证 standard.name
  if (standard.name !== undefined && !isString(standard.name)) {
    return { valid: false, error: 'Invalid standard.name: must be a string' }
  }
  
  // 验证 correctionHistory（可选）
  if (correctionHistory !== undefined) {
    if (!isArray(correctionHistory)) {
      return { valid: false, error: 'Invalid correctionHistory parameter: must be an array' }
    }
    
    // 验证数组中的每个元素
    for (let i = 0; i < correctionHistory.length; i++) {
      const item = correctionHistory[i]
      if (!isObject(item)) {
        return { valid: false, error: `Invalid correctionHistory[${i}]: must be an object` }
      }
      
      if (item.originalScore !== undefined && !isNumber(item.originalScore)) {
        return { valid: false, error: `Invalid correctionHistory[${i}].originalScore: must be a number` }
      }
      
      if (item.correctedScore !== undefined && !isNumber(item.correctedScore)) {
        return { valid: false, error: `Invalid correctionHistory[${i}].correctedScore: must be a number` }
      }
      
      if (item.reason !== undefined && !isString(item.reason)) {
        return { valid: false, error: `Invalid correctionHistory[${i}].reason: must be a string` }
      }
      
      if (item.text !== undefined && !isString(item.text)) {
        return { valid: false, error: `Invalid correctionHistory[${i}].text: must be a string` }
      }
    }
  }
  
  return {
    valid: true,
    text: text as string,
    standard: standard as any,
    correctionHistory: correctionHistory as any[] | undefined,
  }
}

/**
 * 验证 IPC 调用参数 - bot:submit
 */
export interface SubmitValidationResult {
  valid: boolean
  error?: string
  score?: number
}

export function validateSubmitParams(score: unknown): SubmitValidationResult {
  if (!isNumber(score) || isNaN(score)) {
    return { valid: false, error: 'Invalid score parameter: must be a number' }
  }
  
  if (!isInRange(score, 0, 1000)) {
    return { valid: false, error: 'Invalid score parameter: must be between 0 and 1000' }
  }
  
  return { valid: true, score: score as number }
}

/**
 * 验证 IPC 调用参数 - file:read / file:write
 * 改进：完整实现路径遍历防护，检查路径是否在允许的系统目录下
 */
export interface FilePathValidationResult {
  valid: boolean
  error?: string
  normalizedPath?: string
}

export function validateFilePath(filePath: string, allowedPaths?: string[]): FilePathValidationResult {
  if (!filePath || !isString(filePath)) {
    return { valid: false, error: 'Invalid file path: must be a non-empty string' }
  }
  
  // 检查空字节注入
  if (filePath.includes('\0')) {
    return { valid: false, error: 'Invalid file path: null byte detected' }
  }
  
  // 标准化路径（防止路径遍历攻击）
  const path = require('path')
  const resolvedPath = path.resolve(filePath)
  
  // 检查路径遍历攻击（防御性检查）
  const normalizedPath = resolvedPath.toLowerCase().replace(/\\/g, '/')
  const inputNormalized = filePath.toLowerCase().replace(/\\/g, '/')
  
  // 检查原始输入是否包含遍历字符（在解析前）
  if (inputNormalized.includes('..') || inputNormalized.includes('~')) {
    return { valid: false, error: 'Invalid file path: path traversal detected' }
  }
  
  // 如果提供了允许的路径列表，检查路径是否在允许范围内
  if (allowedPaths && allowedPaths.length > 0) {
    const isAllowed = allowedPaths.some(allowedPath => {
      const normalizedAllowed = allowedPath.toLowerCase().replace(/\\/g, '/')
      return normalizedPath === normalizedAllowed || normalizedPath.startsWith(normalizedAllowed + '/')
    })
    
    if (!isAllowed) {
      return { valid: false, error: 'Access denied: path not in allowed directories' }
    }
  } else {
    // 默认检查：只允许用户数据目录和文档目录
    try {
      const { app } = require('electron')
      const defaultAllowedPaths = [
        app.getPath('userData'),
        app.getPath('documents'),
        app.getPath('downloads'),
        app.getPath('pictures'),
      ]
      
      const isAllowed = defaultAllowedPaths.some(allowedPath => {
        const normalizedAllowed = allowedPath.toLowerCase().replace(/\\/g, '/')
        return normalizedPath === normalizedAllowed || normalizedPath.startsWith(normalizedAllowed + '/')
      })
      
      if (!isAllowed) {
        return { valid: false, error: 'Access denied: path not in allowed directories' }
      }
    } catch (error) {
      // 如果无法获取 app 实例（可能在测试环境中），允许相对路径
      if (path.isAbsolute(resolvedPath)) {
        return { valid: false, error: 'Access denied: absolute path not allowed without app instance' }
      }
    }
  }
  
  return { valid: true, normalizedPath: resolvedPath }
}

/**
 * 验证 IPC 调用参数 - bot:configurePaddleOCR
 */
export interface PaddleOCRConfigValidationResult {
  valid: boolean
  error?: string
  config?: {
    enabled: boolean
    aistudioToken?: string
    serverUrl?: string
    model?: string
    timeout?: number
  }
}

export function validatePaddleOCRConfig(config: unknown): PaddleOCRConfigValidationResult {
  if (!config || !isObject(config)) {
    return { valid: false, error: 'Invalid config: must be an object' }
  }
  
  const { enabled, aistudioToken, serverUrl, model, timeout } = config
  
  // 验证 enabled
  if (enabled !== undefined && !isBoolean(enabled)) {
    return { valid: false, error: 'Invalid config.enabled: must be a boolean' }
  }
  
  // 验证 aistudioToken（可选）
  if (aistudioToken !== undefined && aistudioToken !== null && !isString(aistudioToken)) {
    return { valid: false, error: 'Invalid config.aistudioToken: must be a string' }
  }
  
  // 验证 serverUrl（可选）
  if (serverUrl !== undefined && serverUrl !== null && !isString(serverUrl)) {
    return { valid: false, error: 'Invalid config.serverUrl: must be a string' }
  }
  
  // 验证 model（可选）
  if (model !== undefined && model !== null && !isString(model)) {
    return { valid: false, error: 'Invalid config.model: must be a string' }
  }
  
  // 验证 timeout（可选）
  if (timeout !== undefined && !isNumber(timeout)) {
    return { valid: false, error: 'Invalid config.timeout: must be a number' }
  }
  
  return {
    valid: true,
    config: {
      enabled: enabled as boolean || false,
      aistudioToken: aistudioToken as string | undefined,
      serverUrl: serverUrl as string | undefined,
      model: model as string | undefined,
      timeout: timeout as number | undefined,
    },
  }
}

// ============ 安全验证工具 ============

/**
 * 检查字符串是否包含敏感信息
 */
export function containsSensitiveInfo(text: string): boolean {
  if (!isString(text)) return false
  
  return SENSITIVE_PATTERNS.some(pattern => pattern.test(text))
}

/**
 * 脱敏处理 - 隐藏敏感信息
 */
export function sanitizeSensitiveInfo(text: string, mask: string = '[REDACTED]'): string {
  if (!isString(text)) return String(text)
  
  let sanitized = text
  SENSITIVE_PATTERNS.forEach(pattern => {
    sanitized = sanitized.replace(pattern, mask)
  })
  
  return sanitized
}

/**
 * 安全地记录对象（隐藏敏感字段）
 */
export function safeLogObject(
  obj: Record<string, any>,
  sensitiveFields: string[] = ['token', 'apiKey', 'password', 'secret', 'credential']
): Record<string, any> {
  const sanitized = { ...obj }
  
  sensitiveFields.forEach(field => {
    if (field in sanitized) {
      sanitized[field] = '[REDACTED]'
    }
  })
  
  return sanitized
}

// ============ IPC 验证装饰器（高阶函数）============

/**
 * IPC 处理器输入验证包装器
 * @param handler - 原始 IPC 处理器
 * @param validator - 验证函数
 */
export function withValidation<T extends any[], R>(
  handler: (...args: T) => Promise<R>,
  validator: (...args: T) => { valid: boolean; error?: string }
) {
  return async (...args: T): Promise<R | { success: false; error: string }> => {
    const validation = validator(...args)
    if (!validation.valid) {
      return { success: false, error: validation.error || 'Invalid parameters' }
    }
    
    return await handler(...args)
  }
}

// ============ 导出 ============

export default {
  // 类型验证
  isString,
  isNonEmptyString,
  isNumber,
  isInteger,
  isBoolean,
  isObject,
  isArray,
  isArrayOf,
  
  // 范围验证
  isInRange,
  isStringLengthInRange,
  isArrayLengthInRange,
  
  // IPC 验证
  validateGradeParams,
  validateSubmitParams,
  validateFilePath,
  validatePaddleOCRConfig,
  
  // 安全验证
  containsSensitiveInfo,
  sanitizeSensitiveInfo,
  safeLogObject,
  
  // 验证包装器
  withValidation,
}
