import { Minus, Square, X, Maximize2 } from 'lucide-react'
import { useState, useEffect } from 'react'
import './TitleBar.scss'

const api = typeof window !== 'undefined' && (window as any).electronAPI

export default function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false)

  // 监听主进程推送的窗口最大化状态变化
  useEffect(() => {
    if (!window.electronAPI) return
    
    // 使用类型断言访问可能不存在的方法
    const api = window.electronAPI as any
    if (!api.onWindowMaximizeChange) return
    
    const unsubscribe = api.onWindowMaximizeChange((maximized: boolean) => {
      setIsMaximized(maximized)
    })
    return unsubscribe
  }, [])

  const handleMinimize = () => {
    api?.minimizeWindow()
  }

  const handleMaximize = () => {
    api?.maximizeWindow()
  }

  const handleClose = () => {
    api?.closeWindow()
  }

  return (
    <header className="title-bar" onDoubleClick={handleMaximize}>
      <div className="title-bar__left">
        <div className="title-bar__logo">
          <svg viewBox="0 0 32 32" className="title-bar__icon">
            <defs>
              <linearGradient id="logoGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#00c9b0" />
                <stop offset="100%" stopColor="#3b82f6" />
              </linearGradient>
            </defs>
            <circle cx="16" cy="16" r="14" fill="url(#logoGradient)" />
            <path d="M10 12h12M10 16h12M10 20h8" stroke="white" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </div>
        <span className="title-bar__title">皮老板智能阅卷工具</span>
        <span className="title-bar__version">v{__APP_VERSION__}</span>
      </div>
      
      <div className="title-bar__right">
        <button 
          className="title-bar__btn" 
          onClick={handleMinimize}
          title="最小化"
        >
          <Minus size={16} />
        </button>
        <button 
          className="title-bar__btn" 
          onClick={handleMaximize}
          title={isMaximized ? '还原' : '最大化'}
        >
          {isMaximized ? <Maximize2 size={14} /> : <Square size={14} />}
        </button>
        <button 
          className="title-bar__btn title-bar__btn--close" 
          onClick={handleClose}
          title="关闭"
        >
          <X size={16} />
        </button>
      </div>
    </header>
  )
}
