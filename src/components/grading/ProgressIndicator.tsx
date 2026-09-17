import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useGradingStore } from '@/store/gradingStore'
import './ProgressIndicator.scss'

/**
 * 进度指示器组件 Props 接口
 */
interface ProgressIndicatorProps {
  /** 是否显示详细统计（可折叠） */
  showDetails?: boolean
}

/**
 * 格式化时间为可读字符串
 * @param seconds 秒数
 * @returns 格式化后的时间字符串（如 "2分30秒"、"1小时5分钟"）
 */
function formatTime(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}秒`
  } else if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60)
    const secs = seconds % 60
    return secs > 0 ? `${minutes}分${secs}秒` : `${minutes}分钟`
  } else {
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    return minutes > 0 ? `${hours}小时${minutes}分钟` : `${hours}小时`
  }
}

/**
 * 进度指示器组件
 * 显示批改进度条、统计信息和详细数据
 */
export default function ProgressIndicator({ showDetails = true }: ProgressIndicatorProps) {
  // 从 store 获取状态和方法
  const stats = useGradingStore((state) => state.stats)
  const getSpeed = useGradingStore((state) => state.getSpeed)
  const getEstimatedTimeRemaining = useGradingStore((state) => state.getEstimatedTimeRemaining)
  const getAverageTime = useGradingStore((state) => state.getAverageTime)
  const getElapsedTime = useGradingStore((state) => state.getElapsedTime)
  const startTime = useGradingStore((state) => state.startTime)
  const fastestTime = useGradingStore((state) => state.fastestTime)
  const slowestTime = useGradingStore((state) => state.slowestTime)
  
  // 详细统计折叠状态
  const [detailsExpanded, setDetailsExpanded] = useState(false)
  
  // 计算进度百分比
  const progressPercent = stats.total > 0 
    ? Math.round((stats.completed / stats.total) * 100) 
    : 0
  
  // 获取进度条颜色
  const getProgressColor = () => {
    if (stats.failed > 0 && stats.completed === stats.total) {
      return 'var(--warning-500)' // 有失败，显示警告色
    }
    if (stats.completed === stats.total && stats.total > 0) {
      return 'var(--success-500)' // 全部完成
    }
    return 'var(--primary-500)' // 进行中
  }
  
  // 获取速度
  const speed = getSpeed()
  
  // 获取估算剩余时间
  const estimatedTimeRemaining = getEstimatedTimeRemaining()
  
  // 获取平均时间
  const avgTime = getAverageTime()
  
  // 获取已用时间
  const elapsedTime = getElapsedTime()
  
  // 如果没有开始批改，不显示组件
  if (!startTime && stats.completed === 0) {
    return null
  }
  
  return (
    <div className="progress-indicator">
      {/* 标题区 */}
      <div className="progress-header">
        <h4>批改进度</h4>
        {showDetails && (
          <button 
            className="btn-toggle-details"
            onClick={() => setDetailsExpanded(!detailsExpanded)}
          >
            {detailsExpanded ? '收起' : '详情'}
            <span className={`arrow ${detailsExpanded ? 'expanded' : ''}`}>▼</span>
          </button>
        )}
      </div>
      
      {/* 进度条 */}
      <div className="progress-bar-container">
        <div className="progress-bar-bg">
          <motion.div 
            className="progress-bar-fill"
            style={{ backgroundColor: getProgressColor() }}
            initial={{ width: 0 }}
            animate={{ width: `${progressPercent}%` }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
          />
        </div>
        <div className="progress-text">
          <span className="progress-percent">{progressPercent}%</span>
          <span className="progress-count">
            {stats.completed} / {stats.total}
          </span>
        </div>
      </div>
      
      {/* 统计信息 */}
      <div className="stats-grid">
        <div className="stat-item stat-success">
          <span className="stat-value">{stats.completed - stats.blank - stats.failed}</span>
          <span className="stat-label">成功</span>
        </div>
        <div className="stat-item stat-failed">
          <span className="stat-value">{stats.failed}</span>
          <span className="stat-label">失败</span>
        </div>
        <div className="stat-item stat-blank">
          <span className="stat-value">{stats.blank}</span>
          <span className="stat-label">空白卷</span>
          {stats.total > 0 && (
            <span className="stat-percent">({Math.round(stats.blank / stats.total * 100)}%)</span>
          )}
        </div>
        <div className="stat-item stat-speed">
          <span className="stat-value">{speed}</span>
          <span className="stat-label">份/分钟</span>
        </div>
      </div>
      
      {/* 预计剩余时间 */}
      {estimatedTimeRemaining !== null && estimatedTimeRemaining > 0 && (
        <div className="time-estimate">
          <span className="time-icon">⏱️</span>
          <span className="time-text">
            预计剩余：{formatTime(estimatedTimeRemaining)}
          </span>
        </div>
      )}
      
      {/* 详细统计（可折叠） */}
      <AnimatePresence>
        {detailsExpanded && (
          <motion.div
            className="details-panel"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            <div className="details-content">
              <div className="detail-item">
                <span className="detail-label">开始时间</span>
                <span className="detail-value">
                  {startTime ? new Date(startTime).toLocaleTimeString('zh-CN') : '-'}
                </span>
              </div>
              
              <div className="detail-item">
                <span className="detail-label">已用时间</span>
                <span className="detail-value">
                  {elapsedTime !== null ? formatTime(elapsedTime) : '-'}
                </span>
              </div>
              
              <div className="detail-item">
                <span className="detail-label">平均批改时间</span>
                <span className="detail-value">
                  {avgTime !== null ? `${avgTime}秒/份` : '-'}
                </span>
              </div>
              
              <div className="detail-item">
                <span className="detail-label">最快批改</span>
                <span className="detail-value">
                  {fastestTime !== null ? `${Math.round(fastestTime / 1000 * 10) / 10}秒` : '-'}
                </span>
              </div>
              
              <div className="detail-item">
                <span className="detail-label">最慢批改</span>
                <span className="detail-value">
                  {slowestTime !== null ? `${Math.round(slowestTime / 1000 * 10) / 10}秒` : '-'}
                </span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
