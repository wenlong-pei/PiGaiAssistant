import { describe, it, expect } from 'vitest'
import { AppError, ErrorCodes, ErrorUtils, ErrorSeverity } from '@/utils/AppError'

describe('AppError', () => {
  it('should create an AppError with default values', () => {
    const error = new AppError(ErrorCodes.UNKNOWN_ERROR, 'Test error')
    
    expect(error.message).toBe('Test error')
    expect(error.code).toBe(ErrorCodes.UNKNOWN_ERROR)
    expect(error.severity).toBe(ErrorSeverity.MEDIUM)
    expect(error.recoverable).toBe(true)
  })

  it('should create an AppError with custom values', () => {
    const error = new AppError(ErrorCodes.API_REQUEST_FAILED, 'API failed', {
      severity: ErrorSeverity.HIGH,
      details: { endpoint: '/api/users' }
    })
    
    expect(error.code).toBe(ErrorCodes.API_REQUEST_FAILED)
    expect(error.message).toBe('API failed')
    expect(error.severity).toBe(ErrorSeverity.HIGH)
    expect(error.details).toEqual({ endpoint: '/api/users' })
  })

  it('should check recoverable status', () => {
    const recoverable = new AppError(ErrorCodes.UNKNOWN_ERROR, 'Test', {
      recoverable: true
    })
    const notRecoverable = new AppError(ErrorCodes.UNKNOWN_ERROR, 'Test', {
      recoverable: false
    })
    
    expect(ErrorUtils.isRecoverable(recoverable)).toBe(true)
    expect(ErrorUtils.isRecoverable(notRecoverable)).toBe(false)
  })
})

describe('ErrorUtils', () => {
  describe('getUserFriendlyMessage', () => {
    it('should return message for API_REQUEST_FAILED', () => {
      const error = new AppError(ErrorCodes.API_REQUEST_FAILED, 'Test')
      const message = ErrorUtils.getUserFriendlyMessage(error)
      expect(message).toContain('网络请求失败')
    })

    it('should return message for PAGE_NOT_FOUND', () => {
      const error = new AppError(ErrorCodes.PAGE_NOT_FOUND, 'Test')
      const message = ErrorUtils.getUserFriendlyMessage(error)
      expect(message).toContain('页面未找到')
    })

    it('should return predefined message for UNKNOWN_ERROR', () => {
      const error = new AppError(ErrorCodes.UNKNOWN_ERROR, 'Custom unknown message')
      const message = ErrorUtils.getUserFriendlyMessage(error)
      expect(message).toBe('发生未知错误')
    })

    it('should return message for unknown code', () => {
      const error = new AppError(ErrorCodes.UNKNOWN_ERROR, 'Custom error')
      const message = ErrorUtils.getUserFriendlyMessage(error)
      expect(message).toBe('发生未知错误')
    })
  })

  describe('getRetryStrategy', () => {
    it('should suggest retry for timeout error', () => {
      const error = new AppError(ErrorCodes.API_TIMEOUT, 'Timeout')
      const strategy = ErrorUtils.getRetryStrategy(error)
      
      expect(strategy.shouldRetry).toBe(true)
      expect(strategy.delayMs).toBe(2000)
      expect(strategy.maxRetries).toBe(3)
    })

    it('should suggest retry for rate limit error', () => {
      const error = new AppError(ErrorCodes.API_RATE_LIMIT, 'Rate limited')
      const strategy = ErrorUtils.getRetryStrategy(error)
      
      expect(strategy.shouldRetry).toBe(true)
      expect(strategy.delayMs).toBe(5000)
      expect(strategy.maxRetries).toBe(2)
    })

    it('should not suggest retry for missing API key', () => {
      const error = new AppError(ErrorCodes.API_KEY_MISSING, 'Missing key')
      const strategy = ErrorUtils.getRetryStrategy(error)
      
      expect(strategy.shouldRetry).toBe(false)
    })
  })
})
