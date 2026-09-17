import { useState, useEffect } from 'react'
import { Download, RefreshCw, CheckCircle, AlertCircle, Loader, ExternalLink } from 'lucide-react'
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
  currentVersion: string
  isPortable: boolean
  manualDownloadUrl: string
  updateFeed: string
}

const INITIAL_STATE: UpdateState = {
  status: 'idle',
  progress: 0,
  currentVersion: __APP_VERSION__,
  isPortable: false,
  manualDownloadUrl: '',
  updateFeed: '',
}

/**
 * 软件更新面板
 *
 * 分工说明（重要）：
 * - **检查更新的时机由主进程负责**（启动后延迟首检 + 每 6 小时轮询），
 *   本组件只反映状态、并提供"手动立即检查"入口。所以它挂载时不再主动打接口，
 *   避免用户每次打开设置页都去戳一次更新服务器。
 * - **安装版**：发现新版本 → 主进程后台自动下载 → 就绪后用户点「立即更新并重启」。
 * - **绿色版**：不自动下载、不提供一键安装（更新包会装成新副本而非替换自己），
 *   只引导用户去 Release 页面手动下载。
 */
export default function UpdateChecker() {
  const [updateState, setUpdateState] = useState<UpdateState>(INITIAL_STATE)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const update = window.electronAPI?.update
    if (!update) return

    // 监听主进程推来的状态变化
    const unsubscribeState = update.onStateChanged((state: UpdateState) => {
      if (state) setUpdateState(state)
    })

    const unsubscribeAvailable = update.onAvailable((info: UpdateInfo) => {
      toast.success(`发现新版本 ${info?.version ?? ''}`)
    })

    const unsubscribeDownloaded = update.onDownloaded(() => {
      toast.success('新版本已下载完成，可重启安装')
    })

    // 取一次当前状态（组件挂载前可能已有状态变化）
    update
      .getStatus()
      .then((state: UpdateState) => {
        if (state) setUpdateState(state)
      })
      .catch(() => {
        /* 取状态失败不影响手动检查 */
      })

    return () => {
      unsubscribeState?.()
      unsubscribeAvailable?.()
      unsubscribeDownloaded?.()
    }
  }, [])

  const handleCheckUpdate = async () => {
    const update = window.electronAPI?.update
    if (!update) {
      toast.error('更新功能不可用')
      return
    }

    setBusy(true)
    setUpdateState((prev) => ({ ...prev, status: 'checking', error: undefined }))
    try {
      const result = await update.check()

      if (result?.reason === 'in-progress') {
        // 已有一次检查在进行（启动首检/定时轮询），静默返回，不打扰用户
        return
      }

      if (result?.ok && !result.updateAvailable) {
        setUpdateState((prev) => ({ ...prev, status: 'idle', error: undefined }))
        toast.success('当前已是最新版本')
      } else if (!result?.ok) {
        // 关键修复：早期实现把"检查失败"吞成 null，界面一律显示"当前已是最新版本"，
        // 更新链路坏掉了用户也发现不了。这里必须如实报告失败原因。
        const message = result?.error || '检查更新失败'
        setUpdateState((prev) => ({ ...prev, status: 'error', error: message }))
        toast.error(message)
      }
      // result.updateAvailable 时状态由 update:state-changed 事件推送，此处不重复设置
    } catch (error: any) {
      const message = error?.message || '检查更新失败'
      setUpdateState((prev) => ({ ...prev, status: 'error', error: message }))
      toast.error(message)
    } finally {
      setBusy(false)
    }
  }

  const handleDownload = async () => {
    const update = window.electronAPI?.update
    if (!update) return

    setUpdateState((prev) => ({ ...prev, status: 'downloading', progress: 0 }))
    const result = await update.download()
    if (!result?.ok) {
      const message = result?.error || '下载更新失败'
      setUpdateState((prev) => ({ ...prev, status: 'error', error: message }))
      toast.error(message)
    }
  }

  const handleInstall = async () => {
    const update = window.electronAPI?.update
    if (!update) return

    if (!confirm('确定要立即更新吗？应用将重启。')) return

    const result = await update.install()
    if (!result?.ok) {
      toast.error(result?.error || '安装更新失败')
    }
  }

  const handleOpenDownloadPage = async () => {
    const update = window.electronAPI?.update
    if (!update) return
    const result = await update.openDownloadPage()
    if (!result?.ok) {
      toast.error(result?.error || '打开下载页失败')
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
            <span>下载中 {Number(updateState.progress || 0).toFixed(0)}%</span>
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
            <span>当前版本 {updateState.currentVersion}</span>
          </div>
        )
    }
  }

  const isPortable = updateState.isPortable
  const canAutoUpdate = !isPortable

  return (
    <div className="update-checker">
      <div className="update-checker__header">
        <h3>软件更新</h3>
        <button
          className="btn btn--sm btn--secondary"
          onClick={handleCheckUpdate}
          disabled={busy || updateState.status === 'checking' || updateState.status === 'downloading'}
        >
          <RefreshCw size={14} className={busy || updateState.status === 'checking' ? 'spin' : ''} />
          检查更新
        </button>
      </div>

      <div className="update-checker__content">
        {getStatusDisplay()}

        {/* 安装版：允许手动重试下载（自动下载失败时用） */}
        {updateState.status === 'available' && canAutoUpdate && (
          <div className="update-actions">
            <button className="btn btn--primary" onClick={handleDownload}>
              <Download size={14} />
              下载更新
            </button>
          </div>
        )}

        {/* 绿色版：不支持自动更新，引导去 Release 页面手动下载 */}
        {updateState.status === 'available' && isPortable && (
          <div className="update-actions">
            <button className="btn btn--primary" onClick={handleOpenDownloadPage}>
              <ExternalLink size={14} />
              前往下载新版
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

        {updateState.status === 'ready' && canAutoUpdate && (
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

        {/* 绿色版说明：让用户明白为什么不能一键更新 */}
        {isPortable && updateState.status === 'available' && (
          <p style={{ marginTop: '12px', fontSize: '12px', opacity: 0.7, lineHeight: 1.6 }}>
            当前为绿色免安装版，无法自动替换自身。请下载新版安装包后手动替换，
            或改用安装版以获得自动更新。
          </p>
        )}

        {/* 诊断信息：排查"检查不到更新"时，先确认客户端在问哪个仓库 */}
        <p style={{ marginTop: '12px', fontSize: '12px', opacity: 0.55 }}>
          更新源：{updateState.updateFeed || '未配置'}　·　当前版本：{updateState.currentVersion}
          {isPortable ? '　·　运行模式：绿色版' : ''}
        </p>
      </div>
    </div>
  )
}
