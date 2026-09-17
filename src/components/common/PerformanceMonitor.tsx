/**
 * 性能监控面板组件
 * 仅在开发者模式下显示，展示实时性能指标
 */

import { useState, useCallback } from 'react'
import { ChevronDown, ChevronUp, Trash2, RefreshCw } from 'lucide-react'
import { usePerformanceMonitor, formatDuration, getDurationColorClass } from '@/hooks/usePerformanceMonitor'
import { useSettingsStore } from '@/store/settingsStore'
import './PerformanceMonitor.scss'

export default function PerformanceMonitor() {
  // 从设置中获取开发者模式状态
  const devMode = useSettingsStore(state => state.settings.devMode)
  
  // 使用性能监控 Hook
  const {
    stats,
    clearData,
    formatMemory,
    getMemoryUsagePercent
  } = usePerformanceMonitor(2000) // 每 2 秒刷新一次
  
  // 面板是否展开
  const [isExpanded, setIsExpanded] = useState(true)
  
  // 如果未启用开发者模式，不渲染任何内容
  if (!devMode) {
    return null
  }
  
  /**
   * 处理清空数据
   */
  const handleClearData = useCallback(() => {
    clearData()
  }, [clearData])
  
  /**
   * 切换面板展开/折叠状态
   */
  const toggleExpanded = useCallback(() => {
    setIsExpanded(prev => !prev)
  }, [])
  
  // 内存使用百分比
  const memoryPercent = getMemoryUsagePercent()
  
  // API 成功率颜色
  const apiSuccessRateColor = stats.api.successRate >= 90 ? '#10b981' : 
                              stats.api.successRate >= 70 ? '#f59e0b' : 
                              '#ef4444'
  
  return (
    <div className="performance-monitor">
      {/* 面板头部 */}
      <div className="performance-monitor__header" onClick={toggleExpanded}>
        <div className="performance-monitor__title">
          <span className="performance-monitor__icon">📊</span>
          <span>性能监控</span>
        </div>
        <div className="performance-monitor__actions">
          <button
            className="performance-monitor__btn"
            onClick={(e) => {
              e.stopPropagation()
              handleClearData()
            }}
            title="清空数据"
          >
            <Trash2 size={14} />
          </button>
          {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </div>
      
      {/* 面板内容（可折叠） */}
      {isExpanded && (
        <div className="performance-monitor__content">
          {/* OCR 性能指标 */}
          <div className="performance-metric">
            <div className="performance-metric__header">
              <span className="performance-metric__label">OCR 识别时间</span>
              <span className={`performance-metric__value ${getDurationColorClass(stats.ocr.lastDuration)}`}>
                {stats.ocr.lastDuration > 0 ? formatDuration(stats.ocr.lastDuration) : '-'}
              </span>
            </div>
            <div className="performance-metric__details">
              <span>平均: {stats.ocr.averageDuration > 0 ? formatDuration(stats.ocr.averageDuration) : '-'}</span>
              <span>次数: {stats.ocr.count}</span>
            </div>
          </div>
          
          {/* AI 评分性能指标 */}
          <div className="performance-metric">
            <div className="performance-metric__header">
              <span className="performance-metric__label">AI 评分时间</span>
              <span className={`performance-metric__value ${getDurationColorClass(stats.ai.lastDuration)}`}>
                {stats.ai.lastDuration > 0 ? formatDuration(stats.ai.lastDuration) : '-'}
              </span>
            </div>
            <div className="performance-metric__details">
              <span>平均: {stats.ai.averageDuration > 0 ? formatDuration(stats.ai.averageDuration) : '-'}</span>
              <span>次数: {stats.ai.count}</span>
            </div>
          </div>
          
          {/* 内存占用 */}
          <div className="performance-metric">
            <div className="performance-metric__header">
              <span className="performance-metric__label">内存占用</span>
              <span className="performance-metric__value">
                {stats.memory ? formatMemory(stats.memory) : 'N/A'}
              </span>
            </div>
            {stats.memory && (
              <div className="performance-metric__progress">
                <div className="progress-bar">
                  <div
                    className="progress-bar__fill"
                    style={{
                      width: `${memoryPercent}%`,
                      backgroundColor: memoryPercent > 80 ? '#ef4444' : memoryPercent > 60 ? '#f59e0b' : '#10b981'
                    }}
                  />
                </div>
                <span className="progress-text">{memoryPercent}%</span>
              </div>
            )}
          </div>
          
          {/* API 调用统计 */}
          <div className="performance-metric">
            <div className="performance-metric__header">
              <span className="performance-metric__label">API 调用</span>
              <span
                className="performance-metric__value"
                style={{ color: apiSuccessRateColor }}
              >
                {stats.api.successRate}%
              </span>
            </div>
            <div className="performance-metric__details">
              <span>成功: {stats.api.successCalls}</span>
              <span>失败: {stats.api.failedCalls}</span>
              <span>总计: {stats.api.totalCalls}</span>
            </div>
            {/* API 成功率进度条 */}
            <div className="performance-metric__progress">
              <div className="progress-bar">
                <div
                  className="progress-bar__fill"
                  style={{
                    width: `${stats.api.successRate}%`,
                    backgroundColor: apiSuccessRateColor
                  }}
                />
              </div>
              <span className="progress-text">成功率</span>
            </div>
          </div>
          
          {/* 刷新按钮 */}
          <div className="performance-monitor__footer">
            <button className="performance-monitor__refresh-btn">
              <RefreshCw size={12} />
              实时更新中...
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
