/**
 * 性能监控 Hook
 * 提供性能指标状态和实时更新功能
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { performanceCollector, PerformanceStats, MemoryInfo } from '@/utils/performanceCollector'

/**
 * 格式化字节大小为人类可读的字符串
 * @param bytes 字节数
 * @returns 格式化后的字符串（如 "12.5 MB"）
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

/**
 * 性能监控 Hook 返回值类型
 */
export interface UsePerformanceMonitorReturn {
  // 性能统计数据
  stats: PerformanceStats
  // 是否正在监控
  isMonitoring: boolean
  // 开始监控
  startMonitoring: () => void
  // 停止监控
  stopMonitoring: () => void
  // 清空性能数据
  clearData: () => void
  // 格式化内存信息
  formatMemory: (memory: MemoryInfo | null) => string
  // 获取内存使用百分比
  getMemoryUsagePercent: () => number
}

/**
 * 性能监控自定义 Hook
 * @param interval 刷新间隔（毫秒，默认 1000ms）
 * @returns UsePerformanceMonitorReturn
 */
export function usePerformanceMonitor(interval: number = 1000): UsePerformanceMonitorReturn {
  // 性能统计数据状态
  const [stats, setStats] = useState<PerformanceStats>(() => performanceCollector.getStats())
  const [isMonitoring, setIsMonitoring] = useState<boolean>(false)
  
  // 使用 ref 保存定时器 ID
  const timerRef = useRef<number | null>(null)
  
  /**
   * 开始监控
   */
  const startMonitoring = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
    }
    
    setIsMonitoring(true)
    
    // 创建定时刷新器
    timerRef.current = window.setInterval(() => {
      const newStats = performanceCollector.getStats()
      setStats({ ...newStats })
    }, interval)
  }, [interval])
  
  /**
   * 停止监控
   */
  const stopMonitoring = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    setIsMonitoring(false)
  }, [])
  
  /**
   * 清空性能数据
   */
  const clearData = useCallback(() => {
    performanceCollector.clear()
    setStats(performanceCollector.getStats())
  }, [])
  
  /**
   * 格式化内存信息
   */
  const formatMemory = useCallback((memory: MemoryInfo | null): string => {
    if (!memory) return 'N/A'
    return `${formatBytes(memory.usedJSHeapSize)} / ${formatBytes(memory.totalJSHeapSize)}`
  }, [])
  
  /**
   * 获取内存使用百分比
   * @returns 0-100 的数值
   */
  const getMemoryUsagePercent = useCallback((): number => {
    const memory = stats.memory
    if (!memory || memory.totalJSHeapSize === 0) return 0
    return Math.round((memory.usedJSHeapSize / memory.totalJSHeapSize) * 100)
  }, [stats.memory])
  
  // 组件挂载时自动开始监控
  useEffect(() => {
    startMonitoring()
    
    // 组件卸载时停止监控
    return () => {
      stopMonitoring()
    }
  }, [startMonitoring, stopMonitoring])
  
  // 监听性能采集器的更新
  useEffect(() => {
    const listener = () => {
      const newStats = performanceCollector.getStats()
      setStats({ ...newStats })
    }
    
    performanceCollector.addListener(listener)
    
    return () => {
      performanceCollector.removeListener(listener)
    }
  }, [])
  
  return {
    stats,
    isMonitoring,
    startMonitoring,
    stopMonitoring,
    clearData,
    formatMemory,
    getMemoryUsagePercent
  }
}

/**
 * 格式化耗时显示
 * @param ms 毫秒数
 * @returns 格式化后的字符串
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`
  } else if (ms < 60000) {
    return `${(ms / 1000).toFixed(1)}s`
  } else {
    return `${Math.round(ms / 60000)}min`
  }
}

/**
 * 获取耗时的颜色类名
 * @param ms 毫秒数
 * @returns CSS 类名
 */
export function getDurationColorClass(ms: number): string {
  if (ms < 1000) return 'duration-good'      // 绿色：< 1s
  if (ms < 3000) return 'duration-warning'   // 黄色：1-3s
  return 'duration-error'                      // 红色：> 3s
}
