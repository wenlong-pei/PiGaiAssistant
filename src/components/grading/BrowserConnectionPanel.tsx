import { Monitor, CheckCircle, Link } from 'lucide-react'

/**
 * 浏览器连接面板组件 Props 接口
 */
interface BrowserConnectionPanelProps {
  browserLaunched: boolean
  isZhixuePage: boolean
  isRunning: boolean
  isConnecting: boolean
  currentStandard: any
  onLaunchBrowser: () => void
  onConnectBrowser: () => void
}

/**
 * 浏览器连接面板组件
 * 负责显示浏览器连接状态、启动浏览器、检测页面元素
 */
export default function BrowserConnectionPanel({
  browserLaunched,
  isZhixuePage,
  isRunning,
  isConnecting,
  currentStandard,
  onLaunchBrowser,
  onConnectBrowser,
}: BrowserConnectionPanelProps) {
  return (
    <div className="card">
      <div className="card-header">
        <Link size={16} />
        <h3>浏览器连接</h3>
      </div>
      <div className="card-body">
        {/* 启动浏览器按钮 */}
        <button
          className={`btn ${browserLaunched ? 'btn-success' : 'btn-primary'}`}
          onClick={onLaunchBrowser}
          disabled={isRunning || isConnecting || !currentStandard}
          style={{ width: '100%' }}
        >
          {isConnecting ? (
            <><span className="spinner" style={{ width: 16, height: 16, borderWidth: 2, display: 'inline-block', verticalAlign: 'middle', marginRight: 6 }} />启动中...</>
          ) : browserLaunched ? (
            <><CheckCircle size={16} />Edge 已启动</>
          ) : (
            <><Monitor size={16} />启动 Edge 浏览器</>
          )}
        </button>

        {/* 检测页面元素按钮 */}
        {browserLaunched && !isConnecting && (
          <button
            className="btn btn-warning"
            onClick={onConnectBrowser}
            disabled={isRunning}
            style={{ width: '100%', marginTop: 8 }}
          >
            🔍 检测页面元素
          </button>
        )}
      </div>

      {/* 页面识别状态提示 */}
      {isZhixuePage && (
        <div className="card-footer">
          <span className="badge badge-success">批改页面已识别 · 可以开始批改</span>
        </div>
      )}
    </div>
  )
}
