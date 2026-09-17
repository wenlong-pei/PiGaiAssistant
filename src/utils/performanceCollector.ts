/**
 * 性能数据采集工具
 * 用于采集 OCR 识别、AI 评分、内存占用、API 调用等性能指标
 */

// 性能指标类型定义
export interface PerformanceMetric {
  type: 'ocr' | 'ai' | 'api'
  duration: number        // 耗时（毫秒）
  timestamp: number      // 时间戳
  success: boolean       // 是否成功
  errorMessage?: string  // 错误信息（如果有）
}

export interface MemoryInfo {
  usedJSHeapSize: number   // 已使用的 JS 堆大小（字节）
  totalJSHeapSize: number   // 总 JS 堆大小（字节）
  jsHeapSizeLimit: number   // JS 堆大小限制（字节）
}

export interface PerformanceStats {
  // OCR 性能指标
  ocr: {
    lastDuration: number     // 最后一次 OCR 耗时
    averageDuration: number  // 平均 OCR 耗时
    count: number           // OCR 调用次数
    successCount: number    // 成功次数
  }
  // AI 评分性能指标
  ai: {
    lastDuration: number     // 最后一次 AI 评分耗时
    averageDuration: number  // 平均 AI 评分耗时
    count: number           // AI 评分调用次数
    successCount: number    // 成功次数
  }
  // API 调用统计
  api: {
    totalCalls: number      // 总调用次数
    successCalls: number   // 成功调用次数
    failedCalls: number     // 失败调用次数
    successRate: number     // 成功率（0-100）
  }
  // 内存占用
  memory: MemoryInfo | null
}

/**
 * 性能采集器类
 * 单例模式，全局共享性能数据
 */
class PerformanceCollector {
  private static instance: PerformanceCollector
  
  // 性能指标缓冲区（最多保存 100 条记录）
  private readonly MAX_METRICS = 100
  private metrics: PerformanceMetric[] = []
  
  // 性能统计数据（实时计算）
  private stats: PerformanceStats = {
    ocr: { lastDuration: 0, averageDuration: 0, count: 0, successCount: 0 },
    ai: { lastDuration: 0, averageDuration: 0, count: 0, successCount: 0 },
    api: { totalCalls: 0, successCalls: 0, failedCalls: 0, successRate: 100 },
    memory: null
  }
  
  // 监听器列表（用于通知组件更新）
  private listeners: Set<() => void> = new Set()

  private constructor() {
    // 私有构造函数，确保单例
  }

  /**
   * 获取单例实例
   */
  static getInstance(): PerformanceCollector {
    if (!PerformanceCollector.instance) {
      PerformanceCollector.instance = new PerformanceCollector()
    }
    return PerformanceCollector.instance
  }

  /**
   * 添加性能指标记录
   */
  private addMetric(metric: PerformanceMetric): void {
    this.metrics.push(metric)
    
    // 保持缓冲区大小不超过限制
    if (this.metrics.length > this.MAX_METRICS) {
      this.metrics.shift()
    }
    
    // 更新统计数据
    this.updateStats(metric)
    
    // 通知所有监听器
    this.notifyListeners()
  }

  /**
   * 更新统计数据
   */
  private updateStats(metric: PerformanceMetric): void {
    if (metric.type === 'ocr') {
      this.stats.ocr.lastDuration = metric.duration
      this.stats.ocr.count++
      if (metric.success) {
        this.stats.ocr.successCount++
      }
      // 计算平均耗时
      const ocrMetrics = this.metrics.filter(m => m.type === 'ocr')
      const avgDuration = ocrMetrics.reduce((sum, m) => sum + m.duration, 0) / ocrMetrics.length
      this.stats.ocr.averageDuration = Math.round(avgDuration)
    } else if (metric.type === 'ai') {
      this.stats.ai.lastDuration = metric.duration
      this.stats.ai.count++
      if (metric.success) {
        this.stats.ai.successCount++
      }
      // 计算平均耗时
      const aiMetrics = this.metrics.filter(m => m.type === 'ai')
      const avgDuration = aiMetrics.reduce((sum, m) => sum + m.duration, 0) / aiMetrics.length
      this.stats.ai.averageDuration = Math.round(avgDuration)
    } else if (metric.type === 'api') {
      this.stats.api.totalCalls++
      if (metric.success) {
        this.stats.api.successCalls++
      } else {
        this.stats.api.failedCalls++
      }
      // 计算成功率
      this.stats.api.successRate = Math.round(
        (this.stats.api.successCalls / this.stats.api.totalCalls) * 100
      )
    }
  }

  /**
   * 采集 OCR 识别时间
   * @param startTime 开始时间（performance.now() 的值）
   */
  collectOCRTime(startTime: number, success: boolean = true, errorMessage?: string): void {
    const duration = Math.round(performance.now() - startTime)
    this.addMetric({
      type: 'ocr',
      duration,
      timestamp: Date.now(),
      success,
      errorMessage
    })
  }

  /**
   * 采集 AI 评分时间
   * @param startTime 开始时间（performance.now() 的值）
   */
  collectAIScoreTime(startTime: number, success: boolean = true, errorMessage?: string): void {
    const duration = Math.round(performance.now() - startTime)
    this.addMetric({
      type: 'ai',
      duration,
      timestamp: Date.now(),
      success,
      errorMessage
    })
  }

  /**
   * 采集 API 调用结果
   * @param success 是否成功
   */
  collectAPICall(success: boolean): void {
    this.addMetric({
      type: 'api',
      duration: 0,
      timestamp: Date.now(),
      success
    })
  }

  /**
   * 获取内存使用情况
   * 注意：仅在 Chrome/Electron 环境中可用
   * @returns MemoryInfo 或 null（如果不支持）
   */
  getMemoryUsage(): MemoryInfo | null {
    try {
      // performance.memory 是 Chrome 特有的属性
      const memory = (performance as any).memory
      if (memory) {
        this.stats.memory = {
          usedJSHeapSize: memory.usedJSHeapSize,
          totalJSHeapSize: memory.totalJSHeapSize,
          jsHeapSizeLimit: memory.jsHeapSizeLimit
        }
        return this.stats.memory
      }
    } catch (error) {
      console.warn('[PerformanceCollector] 无法获取内存信息:', error)
    }
    return null
  }

  /**
   * 获取当前性能统计数据
   */
  getStats(): PerformanceStats {
    // 每次获取时更新内存信息
    this.getMemoryUsage()
    return { ...this.stats }
  }

  /**
   * 获取最近的性能指标记录
   * @param count 获取数量（默认 20）
   */
  getRecentMetrics(count: number = 20): PerformanceMetric[] {
    return this.metrics.slice(-count)
  }

  /**
   * 清空所有性能数据
   */
  clear(): void {
    this.metrics = []
    this.stats = {
      ocr: { lastDuration: 0, averageDuration: 0, count: 0, successCount: 0 },
      ai: { lastDuration: 0, averageDuration: 0, count: 0, successCount: 0 },
      api: { totalCalls: 0, successCalls: 0, failedCalls: 0, successRate: 100 },
      memory: null
    }
    this.notifyListeners()
  }

  /**
   * 添加监听器
   * @param listener 监听函数
   */
  addListener(listener: () => void): void {
    this.listeners.add(listener)
  }

  /**
   * 移除监听器
   * @param listener 监听函数
   */
  removeListener(listener: () => void): void {
    this.listeners.delete(listener)
  }

  /**
   * 通知所有监听器
   */
  private notifyListeners(): void {
    this.listeners.forEach(listener => {
      try {
        listener()
      } catch (error) {
        console.error('[PerformanceCollector] 监听器执行失败:', error)
      }
    })
  }
}

// 导出单例
export const performanceCollector = PerformanceCollector.getInstance()

// 导出便捷方法
export function startMeasure(): number {
  return performance.now()
}

export function endMeasure(startTime: number, type: 'ocr' | 'ai', success: boolean = true): number {
  const duration = Math.round(performance.now() - startTime)
  if (type === 'ocr') {
    performanceCollector.collectOCRTime(startTime, success)
  } else {
    performanceCollector.collectAIScoreTime(startTime, success)
  }
  return duration
}
