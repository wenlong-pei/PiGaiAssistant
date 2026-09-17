import { Component, ErrorInfo, ReactNode } from 'react'
import { AlertCircle, RefreshCw, Bug } from 'lucide-react'
import './ErrorBoundary.scss'

/**
 * ErrorBoundary 组件的状态接口
 */
interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
  errorInfo: ErrorInfo | null
}

/**
 * ErrorBoundary 组件的 Props 接口
 */
interface ErrorBoundaryProps {
  children: ReactNode
  fallback?: ReactNode
}

/**
 * 全局错误边界组件
 * 使用 class component 实现，必须捕获渲染过程中的 JavaScript 错误
 */
class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null
    }
  }

  /**
   * 静态方法：从错误中派生状态
   * 当子组件抛出错误时，更新 state 以触发降级 UI
   */
  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return {
      hasError: true,
      error
    }
  }

  /**
   * 组件捕获错误后的回调
   * 用于记录错误信息（发送到主进程、日志服务等）
   */
  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // 更新状态以包含错误堆栈信息
    this.setState({
      error,
      errorInfo
    })

    // 发送错误日志到主进程
    this.logErrorToMainProcess(error, errorInfo)
  }

  /**
   * 发送错误日志到主进程
   * 通过 IPC 将错误信息发送到主进程进行记录
   */
  private logErrorToMainProcess = (error: Error, errorInfo: ErrorInfo): void => {
    try {
      const errorLog = {
        time: new Date().toISOString(),
        type: 'RENDER_ERROR',
        message: error.message,
        stack: error.stack,
        componentStack: errorInfo.componentStack
      }

      // 通过 electronAPI 发送到主进程
      if (window.electronAPI && typeof window.electronAPI.send === 'function') {
        window.electronAPI.send('renderer-error', errorLog)
      }

      // 同时输出到控制台以便调试
      console.error('[ErrorBoundary] 捕获到渲染错误:', errorLog)
    } catch (logError) {
      // 避免错误日志本身导致问题
      console.error('[ErrorBoundary] 发送错误日志失败:', logError)
    }
  }

  /**
   * 重新加载应用
   */
  handleReload = (): void => {
    window.location.reload()
  }

  /**
   * 报告问题
   * 可以在这里实现发送错误报告的功能
   */
  handleReportIssue = (): void => {
    try {
      const errorDetails = {
        message: this.state.error?.message || '未知错误',
        stack: this.state.error?.stack || '无堆栈信息',
        componentStack: this.state.errorInfo?.componentStack || '无组件堆栈',
        userAgent: navigator.userAgent,
        timestamp: new Date().toISOString()
      }

      // 复制到剪贴板
      navigator.clipboard.writeText(JSON.stringify(errorDetails, null, 2))
        .then(() => {
          alert('错误详情已复制到剪贴板，请粘贴到问题报告中。')
        })
        .catch(() => {
          // 如果剪贴板 API 不可用，使用传统方法
          const errorText = JSON.stringify(errorDetails, null, 2)
          prompt('请复制以下错误详情并提交问题报告：', errorText)
        })
    } catch (error) {
      console.error('报告问题失败:', error)
    }
  }

  /**
   * 渲染错误界面
   */
  render(): ReactNode {
    if (this.state.hasError) {
      // 如果提供了自定义 fallback，使用它
      if (this.props.fallback) {
        return this.props.fallback
      }

      // 默认错误界面
      return (
        <div className="error-boundary">
          <div className="error-container">
            {/* 错误图标 */}
            <div className="error-icon">
              <AlertCircle size={64} />
            </div>

            {/* 错误标题 */}
            <h1 className="error-title">抱歉，应用出现了问题</h1>

            {/* 错误描述 */}
            <div className="error-alert error-alert-danger">
              <strong>错误信息：</strong>
              <span>{this.state.error?.message || '发生未知错误'}</span>
            </div>

            {/* 解决建议 */}
            <div className="error-alert error-alert-info">
              <strong>解决建议：</strong>
              <ul>
                <li>尝试刷新页面</li>
                <li>检查网络连接</li>
                <li>如果问题持续存在，请报告问题</li>
              </ul>
            </div>

            {/* 操作按钮 */}
            <div className="error-actions">
              <button
                className="btn btn-primary"
                onClick={this.handleReload}
              >
                <RefreshCw size={16} />
                重新加载
              </button>
              <button
                className="btn btn-secondary"
                onClick={this.handleReportIssue}
              >
                <Bug size={16} />
                报告问题
              </button>
            </div>

            {/* 错误详情（开发模式下显示） */}
            {process.env.NODE_ENV === 'development' && this.state.error && (
              <details className="error-details">
                <summary>错误详情（开发模式）</summary>
                <pre className="error-stack">
                  {this.state.error.stack}
                  {'\n\n组件堆栈：\n'}
                  {this.state.errorInfo?.componentStack}
                </pre>
              </details>
            )}
          </div>
        </div>
      )
    }

    // 正常情况下渲染子组件
    return this.props.children
  }
}

export default ErrorBoundary
