import { Clock, Search, Download, Trash2, Filter } from 'lucide-react'
import { useState, useRef, useEffect, useCallback } from 'react'
import { useGradingStore, type LogLevel } from '@/store/gradingStore'
import './GradingLogs.scss'

/**
 * 日志级别标签映射
 */
const LEVEL_TABS: Array<{ key: LogLevel | 'all'; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'info', label: '信息' },
  { key: 'success', label: '成功' },
  { key: 'warning', label: '警告' },
  { key: 'error', label: '错误' },
]

/** 日志级别 → 图标/前缀映射 */
const LEVEL_PREFIX: Record<LogLevel, string> = {
  info: 'INFO',
  success: 'OK',
  warning: 'WARN',
  error: 'ERR',
}

/**
 * 批改日志组件
 * 支持日志级别过滤、搜索和导出
 *
 * 布局设计：每条日志为单行，左侧彩色竖线标识级别，
 * 紧凑时间戳 + 级别标签 + 消息内容横向排列，
 * 消息区始终占据剩余宽度，杜绝文字竖排。
 */
export default function GradingLogs() {
  const logs = useGradingStore((state) => state.logs)
  const logFilterLevel = useGradingStore((state) => state.logFilterLevel)
  const logSearchKeyword = useGradingStore((state) => state.logSearchKeyword)
  const logCompact = useGradingStore((state) => state.logCompact)
  const clearLogs = useGradingStore((state) => state.clearLogs)
  const setLogFilterLevel = useGradingStore((state) => state.setLogFilterLevel)
  const setLogSearchKeyword = useGradingStore((state) => state.setLogSearchKeyword)
  const setLogCompact = useGradingStore((state) => state.setLogCompact)
  const getFilteredLogs = useGradingStore((state) => state.getFilteredLogs)
  const exportLogs = useGradingStore((state) => state.exportLogs)
  const previewImage = useGradingStore((state) => state.previewImage)

  const logsEndRef = useRef<HTMLDivElement>(null)
  const [showExportMenu, setShowExportMenu] = useState(false)
  const exportMenuRef = useRef<HTMLDivElement>(null)
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null)

  // 获取过滤后的日志
  const filteredLogs = getFilteredLogs()

  // 自动滚动到最新日志
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [filteredLogs])

  // 点击外部关闭导出菜单
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(event.target as Node)) {
        setShowExportMenu(false)
      }
    }

    if (showExportMenu) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showExportMenu])

  /**
   * 处理日志导出
   */
  const handleExport = useCallback(async (format: 'txt' | 'json') => {
    setShowExportMenu(false)

    try {
      const content = exportLogs(format)
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const extension = format === 'json' ? 'json' : 'txt'
      const filename = `grading-logs-${timestamp}.${extension}`

      // 使用 electronAPI 调用主进程保存文件
      if (window.electronAPI && typeof window.electronAPI.invoke === 'function') {
        const result: any = await window.electronAPI.invoke('dialog:saveFile', {
          defaultPath: filename,
          filters: [
            { name: format === 'json' ? 'JSON 文件' : '文本文件', extensions: [extension] }
          ]
        })

        if (!result.canceled && result.filePath) {
          const writeResult: any = await window.electronAPI.invoke('file:write', result.filePath, content)
          if (writeResult.success) {
            alert('日志导出成功！')
          } else {
            alert('日志导出失败：' + (writeResult.error || '未知错误'))
          }
        }
      } else {
        // 降级方案：使用 Blob 和 URL 下载
        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = filename
        link.click()
        URL.revokeObjectURL(url)
      }
    } catch (error) {
      console.error('导出日志失败:', error)
      alert('导出日志失败：' + (error instanceof Error ? error.message : '未知错误'))
    }
  }, [exportLogs])

  /**
   * 格式化日志时间 — 紧凑格式 HH:mm:ss
   * 完整日期仅在 hover 时通过 title 属性展示
   */
  const formatLogTime = (isoString: string): string => {
    try {
      const date = new Date(isoString)
      return date.toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      })
    } catch {
      return isoString
    }
  }

  /** 用于 title 属性展示完整日期时间 */
  const formatFullTime = (isoString: string): string => {
    try {
      return new Date(isoString).toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      })
    } catch {
      return isoString
    }
  }

  /**
   * 获取日志级别对应的 CSS 类名
   */
  const getLogLevelClass = (level: LogLevel): string => {
    const classMap: Record<LogLevel, string> = {
      info: 'log-level-info',
      success: 'log-level-success',
      warning: 'log-level-warning',
      error: 'log-level-error',
    }
    return classMap[level] || 'log-level-info'
  }

  /**
   * 高亮搜索关键词
   */
  const highlightKeyword = (text: string, keyword: string): React.ReactNode => {
    if (!keyword.trim()) return text

    const parts = text.split(new RegExp(`(${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'))
    return parts.map((part, i) =>
      part.toLowerCase() === keyword.toLowerCase()
        ? <mark key={i} className="search-highlight">{part}</mark>
        : part
    )
  }

  return (
    <div className="card logs-card">
      {/* 卡片头部 */}
      <div className="card-header">
        <Clock size={14} />
        <h3>运行日志</h3>
        <span className="logs-count">({filteredLogs.length})</span>

        {/* 操作按钮组 */}
        <div className="logs-actions">
          <div className="export-menu-container" ref={exportMenuRef}>
            <button
              className="btn-action"
              onClick={() => setShowExportMenu(!showExportMenu)}
              title="导出日志"
            >
              <Download size={14} />
            </button>
            {showExportMenu && (
              <div className="export-menu">
                <button onClick={() => handleExport('txt')}>
                  导出为 TXT
                </button>
                <button onClick={() => handleExport('json')}>
                  导出为 JSON
                </button>
              </div>
            )}
          </div>

          <button
            className="btn-action btn-clear"
            onClick={clearLogs}
            title="清空日志"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* 过滤和搜索控件 */}
      <div className="logs-controls">
        <button
          className={`compact-toggle ${logCompact ? 'active' : ''}`}
          onClick={() => setLogCompact(!logCompact)}
          title={logCompact ? '精简模式：已隐藏步骤级日志，只保留结果与异常。点击切换为详细模式' : '详细模式：显示全部日志（含步骤级）。点击切换为精简模式'}
        >
          <Filter size={14} />
          {logCompact ? '精简' : '详细'}
        </button>

        <div className="logs-filter-tabs">
          {LEVEL_TABS.map(tab => (
            <button
              key={tab.key}
              className={`filter-tab ${logFilterLevel === tab.key ? 'active' : ''}`}
              onClick={() => setLogFilterLevel(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="logs-search">
          <Search size={14} className="search-icon" />
          <input
            type="text"
            placeholder="搜索日志..."
            value={logSearchKeyword}
            onChange={(e) => setLogSearchKeyword(e.target.value)}
            className="search-input"
          />
          {logSearchKeyword && (
            <button
              className="search-clear"
              onClick={() => setLogSearchKeyword('')}
            >
              ×
            </button>
          )}
        </div>
      </div>

      {/* 日志列表 */}
      <div className="card-body">
        <div className="logs-list">
          {filteredLogs.length === 0 ? (
            <div className="logs-empty">
              {logs.length === 0 ? '等待开始...' : '没有匹配的日志'}
            </div>
          ) : (
            filteredLogs.map((log, i) => {
              const isBlankLog = log.message.includes('空白卷') || log.message.includes('blank')
              const canShowImage = isBlankLog && previewImage

              return (
                <div
                  key={i}
                  className={`log-item ${getLogLevelClass(log.level)}`}
                  title={formatFullTime(log.time)}
                >
                  {/* 左侧彩色指示条 — 用 ::before 实现 */}

                  {/* 空白卷图片缩略图 */}
                  {canShowImage && (
                    <div
                      className="log-image-thumbnail"
                      onClick={() => setPreviewImageUrl(previewImage)}
                      title="点击查看大图"
                    >
                      <img src={previewImage} alt="空白卷" />
                    </div>
                  )}

                  {/* 时间 + 级别行 */}
                  <span className="log-meta">
                    <span className="log-time">{formatLogTime(log.time)}</span>
                    <span className={`log-badge log-badge-${log.level}`}>
                      {LEVEL_PREFIX[log.level]}
                    </span>
                  </span>

                  {/* 日志消息 */}
                  <span className="log-message">
                    {highlightKeyword(log.message, logSearchKeyword)}
                  </span>
                </div>
              )
            })
          )}
          <div ref={logsEndRef} />
        </div>
      </div>

      {/* 图片预览对话框 */}
      {previewImageUrl && (
        <div className="image-preview-overlay" onClick={() => setPreviewImageUrl(null)}>
          <div className="image-preview-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="image-preview-header">
              <h3>空白卷图片预览</h3>
              <button
                className="image-preview-close"
                onClick={() => setPreviewImageUrl(null)}
              >
                ✕
              </button>
            </div>
            <div className="image-preview-body">
              <img src={previewImageUrl} alt="空白卷大图" />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
