import { useState, useEffect } from 'react'
import { Download, RefreshCw, CheckCircle, AlertCircle, Loader } from 'lucide-react'
import toast from 'react-hot-toast'
import './UpdateChecker.scss'

interface UpdateInfo {
  version?: string
  releaseNotes?: string
}

interface UpdateState {
  status: 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error'
  progress: number
  version?: string
  releaseNotes?: string
  error?: string
}

export default function UpdateChecker() {
  const [updateState, setUpdateState] = useState<UpdateState>({
    status: 'idle',
    progress: 0,
  })
  const [currentVersion] = useState(__APP_VERSION__) // 从 package.json 读取

  useEffect(() => {
    // 监听更新状态变化
    if (window.electronAPI?.update) {
      const unsubscribeState = window.electronAPI.update.onStateChanged((state: UpdateState) => {
        setUpdateState(state)
      })

      const unsubscribeAvailable = window.electronAPI.update.onAvailable((info: UpdateInfo) => {
        toast.success(`发现新版本: ${info.version}`)
      })

      const unsubscribeDownloaded = window.electronAPI.update.onDownloaded(() => {
        toast.success('新版本已下载完成，可以安装更新')
      })

      // 获取初始状态
      window.electronAPI.update.getStatus().then((state: UpdateState) => {
        if (state) {
          setUpdateState(state)
        }
      })

      // 清理函数
      return () => {
        unsubscribeState?.()
        unsubscribeAvailable?.()
        unsubscribeDownloaded?.()
      }
    }
  }, [])

  const handleCheckUpdate = async () => {
    if (!window.electronAPI?.update) {
      toast.error('更新功能不可用')
      return
    }

    setUpdateState((prev) => ({ ...prev, status: 'checking', error: undefined }))
    try {
      const result = await window.electronAPI.update.check()
      if (!result) {
        setUpdateState((prev) => ({ ...prev, status: 'idle' }))
        toast.success('当前已是最新版本')
      }
    } catch (error: any) {
      setUpdateState((prev) => ({
        ...prev,
        status: 'error',
        error: error.message || '检查更新失败'
      }))
      toast.error('检查更新失败')
    }
  }

  const handleDownload = async () => {
    if (!window.electronAPI?.update) return

    setUpdateState(prev => ({ ...prev, status: 'downloading', progress: 0 }))
    try {
      await window.electronAPI.update.download()
    } catch (error: any) {
      setUpdateState(prev => ({ ...prev, status: 'error', error: String(error) }))
      toast.error('下载更新失败')
    }
  }

  const handleInstall = async () => {
    if (!window.electronAPI?.update) return

    if (confirm('确定要立即更新吗？应用将重启。')) {
      await window.electronAPI.update.install()
    }
  }

  const getStatusDisplay = () => {
    switch (updateState.status) {
      case 'checking':
        return (
          <div className="update-status update-status--checking">
            <Loader size={16} className="spin" />
            <span>检查更新中...</span>
          </div>
        )
      case 'available':
        return (
          <div className="update-status update-status--available">
            <Download size={16} />
            <span>发现新版本 {updateState.version}</span>
          </div>
        )
      case 'downloading':
        return (
          <div className="update-status update-status--downloading">
            <Loader size={16} className="spin" />
            <span>下载中 {updateState.progress.toFixed(0)}%</span>
          </div>
        )
      case 'ready':
        return (
          <div className="update-status update-status--ready">
            <CheckCircle size={16} />
            <span>新版本已就绪</span>
          </div>
        )
      case 'error':
        return (
          <div className="update-status update-status--error">
            <AlertCircle size={16} />
            <span>{updateState.error || '更新失败'}</span>
          </div>
        )
      default:
        return (
          <div className="update-status update-status--idle">
            <CheckCircle size={16} />
            <span>当前版本 {currentVersion}</span>
          </div>
        )
    }
  }

  return (
    <div className="update-checker">
      <div className="update-checker__header">
        <h3>软件更新</h3>
        <button
          className="btn btn--sm btn--secondary"
          onClick={handleCheckUpdate}
          disabled={updateState.status === 'checking' || updateState.status === 'downloading'}
        >
          <RefreshCw size={14} className={updateState.status === 'checking' ? 'spin' : ''} />
          检查更新
        </button>
      </div>

      <div className="update-checker__content">
        {getStatusDisplay()}

        {updateState.status === 'available' && (
          <div className="update-actions">
            <button className="btn btn--primary" onClick={handleDownload}>
              <Download size={14} />
              下载更新
            </button>
          </div>
        )}

        {updateState.status === 'downloading' && (
          <div className="update-progress">
            <div className="progress-bar">
              <div
                className="progress-bar__fill"
                style={{ width: `${updateState.progress}%` }}
              />
            </div>
          </div>
        )}

        {updateState.status === 'ready' && (
          <div className="update-actions">
            <button className="btn btn--primary" onClick={handleInstall}>
              <CheckCircle size={14} />
              立即更新并重启
            </button>
          </div>
        )}

        {updateState.releaseNotes && (
          <div className="update-notes">
            <h4>更新说明</h4>
            <p>{updateState.releaseNotes}</p>
          </div>
        )}
      </div>
    </div>
  )
}
