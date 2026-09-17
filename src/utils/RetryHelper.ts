/**
 * 智能重试机制
 * 支持指数退避、最大重试次数、错误过滤
 */

import { AppError, ErrorUtils } from './AppError';
import { logger } from './Logger';

export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  shouldRetry?: (error: AppError) => boolean;
  onRetry?: (attempt: number, error: AppError) => void;
}

export type RetryResult<T> = {
  success: true;
  data: T;
  attempts: number;
} | {
  success: false;
  error: AppError;
  attempts: number;
}

/**
 * 带指数退避的重试执行器
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<RetryResult<T>> {
  const {
    maxRetries = 3,
    baseDelayMs = 1000,
    maxDelayMs = 30000,
    shouldRetry,
    onRetry
  } = options;

  let lastError: AppError | null = null;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      const data = await fn();
      return { success: true, data, attempts: attempt };
    } catch (cause) {
      const error = cause instanceof AppError ? cause : new AppError(
        'UNKNOWN_ERROR' as any,
        cause instanceof Error ? cause.message : String(cause),
        { cause: cause instanceof Error ? cause : new Error(String(cause)) }
      );
      
      lastError = error;

      // 检查是否应该重试
      const retryStrategy = ErrorUtils.getRetryStrategy(error);
      const canRetry = shouldRetry?.(error) ?? (retryStrategy.shouldRetry && attempt <= maxRetries);

      if (!canRetry || attempt > maxRetries) {
        logger.error('Retry exhausted', error, { attempt, maxRetries });
        return { success: false, error, attempts: attempt };
      }

      // 计算延迟时间（指数退避 + 抖动）
      const delayMs = Math.min(
        baseDelayMs * Math.pow(2, attempt - 1) + Math.random() * 1000,
        maxDelayMs
      );

      logger.warn(`Retry attempt ${attempt}/${maxRetries}`, { error: error.message, delayMs });
      onRetry?.(attempt, error);

      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  // 理论上不会到达这里
  return { 
    success: false, 
    error: lastError!, 
    attempts: maxRetries + 1 
  };
}

/**
 * 同步重试执行器
 */
export function withRetrySync<T>(
  fn: () => T,
  options: RetryOptions = {}
): RetryResult<T> {
  const {
    maxRetries = 3,
    shouldRetry,
    onRetry
  } = options;

  let lastError: AppError | null = null;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      const data = fn();
      return { success: true, data, attempts: attempt };
    } catch (cause) {
      const error = cause instanceof AppError ? cause : new AppError(
        'UNKNOWN_ERROR' as any,
        cause instanceof Error ? cause.message : String(cause),
        { cause: cause instanceof Error ? cause : new Error(String(cause)) }
      );
      
      lastError = error;

      const retryStrategy = ErrorUtils.getRetryStrategy(error);
      const canRetry = shouldRetry?.(error) ?? (retryStrategy.shouldRetry && attempt <= maxRetries);

      if (!canRetry || attempt > maxRetries) {
        logger.error('Retry exhausted', error, { attempt, maxRetries });
        return { success: false, error, attempts: attempt };
      }

      onRetry?.(attempt, error);
    }
  }

  return { 
    success: false, 
    error: lastError!, 
    attempts: maxRetries + 1 
  };
}

/**
 * 创建带重试的函数
 */
export function createRetryable<T extends unknown[], R>(
  fn: (...args: T) => Promise<R>,
  options: RetryOptions = {}
): (...args: T) => Promise<RetryResult<R>> {
  return async (...args: T) => {
    return withRetry(() => fn(...args), options);
  };
}

export default withRetry;
