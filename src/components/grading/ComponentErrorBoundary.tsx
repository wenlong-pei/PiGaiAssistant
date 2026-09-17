import { Component, ErrorInfo, ReactNode } from 'react'
import './ComponentErrorBoundary.scss'

/**
 * 组件级错误边界 Props 接口
 */
interface ComponentErrorBoundaryProps {
  children: ReactNode
  componentName?: string
  fallback?: ReactNode
}

/**
 * 组件级错误边界状态接口
 */
interface ComponentErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

/**
 * 组件级错误边界
 * 用于捕获单个组件的错误，避免整个应用崩溃
 */
class ComponentErrorBoundary extends Component<
  ComponentErrorBoundaryProps,
  ComponentErrorBoundaryState
> {
  constructor(props: ComponentErrorBoundaryProps) {
    super(props)
    this.state = {
      hasError: false,
      error: null
    }
  }

  static getDerivedStateFromError(error: Error): Partial<ComponentErrorBoundaryState> {
    return {
      hasError: true,
      error
    }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error(`[${this.props.componentName || 'Component'}] 捕获到错误:`, error, errorInfo)
  }

  handleReset = (): void => {
    this.setState({
      hasError: false,
      error: null
    })
  }

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback
      }

      return (
        <div className="component-error">
          <div className="component-error-icon">⚠️</div>
          <div className="component-error-message">
            {this.props.componentName || '组件'}加载失败
          </div>
          <button
            className="component-error-retry"
            onClick={this.handleReset}
          >
            重试
          </button>
        </div>
      )
    }

    return this.props.children
  }
}

export default ComponentErrorBoundary
