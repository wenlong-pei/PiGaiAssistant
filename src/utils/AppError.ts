/**
 * 统一错误处理体系
 * 提供标准化的错误类、错误代码和工具函数
 */

/**
 * 错误严重程度
 */
export enum ErrorSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical'
}

/**
 * 预定义错误代码
 */
export enum ErrorCodes {
  API_KEY_MISSING = 'API_KEY_MISSING',
  API_KEY_INVALID = 'API_KEY_INVALID',
  API_REQUEST_FAILED = 'API_REQUEST_FAILED',
  API_TIMEOUT = 'API_TIMEOUT',
  API_RATE_LIMIT = 'API_RATE_LIMIT',
  BROWSER_LAUNCH_FAILED = 'BROWSER_LAUNCH_FAILED',
  PAGE_NOT_FOUND = 'PAGE_NOT_FOUND',
  ELEMENT_NOT_FOUND = 'ELEMENT_NOT_FOUND',
  DOM_SELECTOR_FAILED = 'DOM_SELECTOR_FAILED',
  OCR_FAILED = 'OCR_FAILED',
  OCR_TIMEOUT = 'OCR_TIMEOUT',
  OCR_NO_TEXT = 'OCR_NO_TEXT',
  AI_SCORE_FAILED = 'AI_SCORE_FAILED',
  AI_PARSE_FAILED = 'AI_PARSE_FAILED',
  AI_INVALID_RESPONSE = 'AI_INVALID_RESPONSE',
  SUBMIT_FAILED = 'SUBMIT_FAILED',
  SCORE_INPUT_FAILED = 'SCORE_INPUT_FAILED',
  CONFIG_INVALID = 'CONFIG_INVALID',
  CONFIG_LOAD_FAILED = 'CONFIG_LOAD_FAILED',
  SELECTOR_NOT_FOUND = 'SELECTOR_NOT_FOUND',
  NETWORK_ERROR = 'NETWORK_ERROR',
  STORAGE_ERROR = 'STORAGE_ERROR',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR'
}

export class AppError extends Error {
  public readonly code: ErrorCodes;
  public readonly severity: ErrorSeverity;
  public readonly details?: Record<string, unknown>;
  public readonly timestamp: Date;
  public readonly recoverable: boolean;

  constructor(
    code: ErrorCodes,
    message: string,
    options?: {
      severity?: ErrorSeverity;
      details?: Record<string, unknown>;
      cause?: Error;
      recoverable?: boolean;
    }
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.severity = options?.severity ?? ErrorSeverity.MEDIUM;
    this.details = options?.details;
    this.timestamp = new Date();
    this.recoverable = options?.recoverable ?? true;
    (this as any).cause = options?.cause;
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AppError);
    }
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      severity: this.severity,
      details: this.details,
      timestamp: this.timestamp.toISOString(),
      recoverable: this.recoverable,
      stack: this.stack
    };
  }

  static fromJSON(json: Record<string, unknown>): AppError {
    const error = new AppError(
      json.code as ErrorCodes,
      json.message as string,
      {
        severity: json.severity as ErrorSeverity,
        details: json.details as Record<string, unknown>,
        recoverable: json.recoverable as boolean
      }
    );
    error.stack = json.stack as string;
    return error;
  }
}

export const ErrorUtils = {
  getUserFriendlyMessage(error: AppError): string {
    const messages: Record<ErrorCodes, string> = {
      [ErrorCodes.API_KEY_MISSING]: '请先在设置中配置 API Key',
      [ErrorCodes.API_KEY_INVALID]: 'API Key 无效，请检查后重试',
      [ErrorCodes.API_REQUEST_FAILED]: '网络请求失败，请检查网络连接',
      [ErrorCodes.API_TIMEOUT]: '请求超时，请重试',
      [ErrorCodes.API_RATE_LIMIT]: '请求过于频繁，请稍后再试',
      [ErrorCodes.BROWSER_LAUNCH_FAILED]: '无法启动浏览器，请重试',
      [ErrorCodes.PAGE_NOT_FOUND]: '页面未找到，请检查链接',
      [ErrorCodes.ELEMENT_NOT_FOUND]: '未找到目标元素，请刷新页面重试',
      [ErrorCodes.DOM_SELECTOR_FAILED]: 'DOM 选择失败，请更新选择器配置',
      [ErrorCodes.OCR_FAILED]: '文字识别失败，请重试',
      [ErrorCodes.OCR_TIMEOUT]: '文字识别超时，请重试',
      [ErrorCodes.OCR_NO_TEXT]: '未识别到有效文字',
      [ErrorCodes.AI_SCORE_FAILED]: 'AI 评分失败，请重试',
      [ErrorCodes.AI_PARSE_FAILED]: '解析评分结果失败',
      [ErrorCodes.AI_INVALID_RESPONSE]: 'AI 返回无效响应',
      [ErrorCodes.SUBMIT_FAILED]: '提交失败，请重试',
      [ErrorCodes.SCORE_INPUT_FAILED]: '分数填写失败，请手动填写',
      [ErrorCodes.CONFIG_INVALID]: '配置无效，请检查设置',
      [ErrorCodes.CONFIG_LOAD_FAILED]: '加载配置失败',
      [ErrorCodes.SELECTOR_NOT_FOUND]: '未找到选择器配置',
      [ErrorCodes.NETWORK_ERROR]: '网络错误，请检查连接',
      [ErrorCodes.STORAGE_ERROR]: '存储错误，请清理缓存',
      [ErrorCodes.UNKNOWN_ERROR]: '发生未知错误'
    };
    return messages[error.code] || error.message;
  },

  isRecoverable(error: AppError): boolean {
    return error.recoverable;
  },

  getRetryStrategy(error: AppError): { shouldRetry: boolean; delayMs?: number; maxRetries?: number } {
    switch (error.code) {
      case ErrorCodes.API_TIMEOUT:
      case ErrorCodes.NETWORK_ERROR:
        return { shouldRetry: true, delayMs: 2000, maxRetries: 3 };
      case ErrorCodes.API_RATE_LIMIT:
        return { shouldRetry: true, delayMs: 5000, maxRetries: 2 };
      case ErrorCodes.OCR_TIMEOUT:
      case ErrorCodes.AI_SCORE_FAILED:
        return { shouldRetry: true, delayMs: 1000, maxRetries: 2 };
      case ErrorCodes.API_KEY_MISSING:
      case ErrorCodes.API_KEY_INVALID:
      case ErrorCodes.CONFIG_INVALID:
        return { shouldRetry: false };
      default:
        return { shouldRetry: error.recoverable, delayMs: 1000, maxRetries: 1 };
    }
  },

  async safeExecuteAsync<T>(
    fn: () => Promise<T>,
    errorCode: ErrorCodes,
    errorMessage: string,
    options?: { severity?: ErrorSeverity; details?: Record<string, unknown> }
  ): Promise<{ success: true; data: T } | { success: false; error: AppError }> {
    try {
      const data = await fn();
      return { success: true, data };
    } catch (cause) {
      const error = new AppError(errorCode, errorMessage, {
        ...options,
        cause: cause instanceof Error ? cause : new Error(String(cause))
      });
      return { success: false, error };
    }
  }
};

export default AppError;
