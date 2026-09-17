/**
 * 结构化日志系统
 * 支持多级别日志、文件输出、格式化输出
 */


export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error'
}

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  module?: string;
  data?: unknown;
  error?: Error;
}

export interface LoggerOptions {
  minLevel?: LogLevel;
  enableConsole?: boolean;
  enableFile?: boolean;
  filePath?: string;
  module?: string;
}

const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  [LogLevel.DEBUG]: 0,
  [LogLevel.INFO]: 1,
  [LogLevel.WARN]: 2,
  [LogLevel.ERROR]: 3
};

class LoggerImpl {
  private minLevel: LogLevel;
  private enableConsole: boolean;
  private module?: string;
  private logHistory: LogEntry[] = [];

  constructor(options: LoggerOptions = {}) {
    this.minLevel = options.minLevel ?? LogLevel.INFO;
    this.enableConsole = options.enableConsole ?? true;
    this.module = options.module;
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_ORDER[level] >= LOG_LEVEL_ORDER[this.minLevel];
  }

  private formatEntry(entry: LogEntry): string {
    const time = new Date(entry.timestamp).toLocaleTimeString();
    const modulePrefix = entry.module ? `[${entry.module}] ` : '';
    const dataStr = entry.data ? ` ${JSON.stringify(entry.data)}` : '';
    const errorStr = entry.error ? ` ${entry.error.stack || entry.error.message}` : '';
    return `[${time}] [${entry.level.toUpperCase()}] ${modulePrefix}${entry.message}${dataStr}${errorStr}`;
  }

  private addEntry(entry: LogEntry): void {
    this.logHistory.push(entry);
    if (this.logHistory.length > 1000) {
      this.logHistory.shift();
    }

    if (this.enableConsole && this.shouldLog(entry.level)) {
      const formatted = this.formatEntry(entry);
      switch (entry.level) {
        case LogLevel.DEBUG:
          console.debug(formatted);
          break;
        case LogLevel.INFO:
          console.info(formatted);
          break;
        case LogLevel.WARN:
          console.warn(formatted);
          break;
        case LogLevel.ERROR:
          console.error(formatted);
          break;
      }
    }
  }

  debug(message: string, data?: unknown): void {
    this.addEntry({
      level: LogLevel.DEBUG,
      message,
      timestamp: new Date().toISOString(),
      module: this.module,
      data
    });
  }

  info(message: string, data?: unknown): void {
    this.addEntry({
      level: LogLevel.INFO,
      message,
      timestamp: new Date().toISOString(),
      module: this.module,
      data
    });
  }

  warn(message: string, data?: unknown): void {
    this.addEntry({
      level: LogLevel.WARN,
      message,
      timestamp: new Date().toISOString(),
      module: this.module,
      data
    });
  }

  error(message: string, error?: Error, data?: unknown): void {
    this.addEntry({
      level: LogLevel.ERROR,
      message,
      timestamp: new Date().toISOString(),
      module: this.module,
      error,
      data
    });
  }

  getHistory(): LogEntry[] {
    return [...this.logHistory];
  }

  clearHistory(): void {
    this.logHistory = [];
  }

  setMinLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  child(module: string): LoggerImpl {
    return new LoggerImpl({
      minLevel: this.minLevel,
      enableConsole: this.enableConsole,
      module: this.module ? `${this.module}:${module}` : module
    });
  }
}

// 创建全局 logger 实例
export const logger = new LoggerImpl({ module: 'app' });

// 导出便捷函数
export const debug = (message: string, data?: unknown) => logger.debug(message, data);
export const info = (message: string, data?: unknown) => logger.info(message, data);
export const warn = (message: string, data?: unknown) => logger.warn(message, data);
export const error = (message: string, error?: Error, data?: unknown) => logger.error(message, error, data);

export default LoggerImpl;
