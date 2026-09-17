/**
 * 自动更新服务
 * 使用 electron-updater 实现应用自动更新
 *
 * ============ 链路设计（2026-09-17 重构）============
 * 1. 更新源：唯一事实来源是打包时 electron-builder 写入的 `app-update.yml`
 *    （由 package.json 的 build.publish 生成），运行时由 updateConfig 解析，
 *    避免源码里再硬编码一份 owner/repo 而漂移。
 *    ⚠️ 该仓库**必须公开**：客户端要能匿名读取 Release，
 *    私有仓库意味着必须把访问凭据打进客户端，等于自己泄露钥匙。
 *
 * 2. 安装版（NSIS）：启动后自动检查 → 后台自动下载 → 就绪后由**用户确认**再重启安装。
 *
 * 3. 绿色版（portable）：没有安装目录，更新包会装成新副本而非替换自己，
 *    因此不自动下载、不提供"一键安装"，只提示并引导到 Release 页面手动下载。
 *
 * 4. 安装必须由用户显式确认：更新包目前**无代码签名**（阻断-05 缓解），
 *    已关闭 autoInstallOnAppQuit，禁止退出时静默安装。
 *
 * 5. 检查结果必须可区分"已是最新"与"检查失败"：早期实现里 check 出错被吞成 null，
 *    渲染层把失败显示成"当前已是最新版本"，用户永远发现不了更新坏掉。
 */

import { autoUpdater, UpdateInfo } from 'electron-updater'
import { BrowserWindow, ipcMain, app, shell } from 'electron'
import { logger } from './logger'
import { getUpdateFeedInfo, isPortableBuild } from './updateConfig'

// 更新状态
export type UpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error'

interface UpdateState {
  status: UpdateStatus
  progress: number
  version?: string
  releaseNotes?: string
  error?: string
  /** 当前运行版本 */
  currentVersion: string
  /** 是否绿色版（决定 UI 走"手动下载"还是"一键安装"） */
  isPortable: boolean
  /** 手动下载入口（绿色版 / 自动更新失败时的兜底） */
  manualDownloadUrl: string
  /** 更新源仓库标识，便于排查"检查不到更新"时确认客户端到底在问谁 */
  updateFeed: string
}

/** 检查更新的结构化结果——调用方必须能区分"最新"与"失败" */
export interface UpdateCheckResult {
  ok: boolean
  updateAvailable: boolean
  currentVersion: string
  version?: string
  error?: string
  reason?: 'dev' | 'up-to-date' | 'update-available' | 'in-progress' | 'failed'
}

/** 通用动作结果 */
export interface UpdateActionResult {
  ok: boolean
  error?: string
}

/** 首次自动检查的延迟：避开启动高峰，不与应用初始化抢 IO */
const FIRST_CHECK_DELAY_MS = 20 * 1000
/** 周期检查间隔：6 小时 */
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

class AutoUpdateService {
  private mainWindow: BrowserWindow | null = null
  private readonly isPortable: boolean
  private state: UpdateState
  private updateAvailable = false
  private updateDownloaded = false
  private started = false
  /** 并发保护：electron-updater 不允许同时进行两次检查，否则会抛错并让用户看到莫名失败 */
  private checkInFlight = false
  private firstCheckTimer: NodeJS.Timeout | null = null
  private intervalTimer: NodeJS.Timeout | null = null

  constructor() {
    this.isPortable = isPortableBuild()
    const feed = getUpdateFeedInfo()

    this.state = {
      status: 'idle',
      progress: 0,
      currentVersion: app.getVersion(),
      isPortable: this.isPortable,
      manualDownloadUrl: feed.releasesUrl,
      updateFeed: `${feed.owner}/${feed.repo}`,
    }

    this.setupAutoUpdater()
  }

  /**
   * 设置主窗口
   */
  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window
    // 窗口就绪后把当前状态补推一次，避免渲染层挂载前丢失状态变化
    this.pushState()
  }

  /**
   * 配置 autoUpdater
   */
  private setupAutoUpdater(): void {
    // 配置日志
    autoUpdater.logger = {
      info: (message: any) => logger.info('[AutoUpdater]', message),
      warn: (message: any) => logger.warn('[AutoUpdater]', message),
      error: (message: any) => logger.error('[AutoUpdater]', message),
      debug: (message: any) => logger.debug('[AutoUpdater]', message),
    }

    // 安装版：发现新版本后自动后台下载，用户只需确认"重启安装"这一步。
    // 绿色版：不自动下载（下载了也用不上，只会白耗带宽）。
    autoUpdater.autoDownload = !this.isPortable
    // 安全修复（阻断-05 缓解）：更新包无代码签名可校验（项目未配置代码签名证书），
    // 因此禁止"退出时静默安装"，安装必须由用户在界面中显式确认。
    autoUpdater.autoInstallOnAppQuit = false
    // 显式禁止降级：即使更新源返回更低版本也拒绝安装（防降级攻击）
    autoUpdater.allowDowngrade = false

    // 事件监听
    autoUpdater.on('checking-for-update', () => {
      this.updateState({ status: 'checking' })
      logger.info('检查更新中...')
    })

    autoUpdater.on('update-available', (info: UpdateInfo) => {
      this.updateAvailable = true
      this.updateState({
        status: 'available',
        version: info.version,
        releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined,
      })
      if (this.isPortable) {
        logger.info(`发现新版本 ${info.version}（绿色版，需手动下载）`)
      } else {
        logger.info(`发现新版本: ${info.version}，开始后台下载`)
      }
    })

    autoUpdater.on('update-not-available', (info: UpdateInfo) => {
      this.updateState({ status: 'idle', version: info.version })
      logger.info(`当前已是最新版本: ${info.version}`)
    })

    autoUpdater.on('download-progress', (progress) => {
      this.updateState({
        status: 'downloading',
        progress: progress.percent,
      })
      logger.debug(`下载进度: ${progress.percent.toFixed(1)}%`)
    })

    autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
      this.updateDownloaded = true
      this.updateState({
        status: 'ready',
        version: info.version,
      })
      logger.info(`新版本下载完成: ${info.version}`)
    })

    autoUpdater.on('error', (error) => {
      this.updateState({
        status: 'error',
        error: error?.message || String(error),
      })
      logger.error('自动更新出错:', error)
    })

    // 设置 IPC 处理程序
    this.setupIpcHandlers()
  }

  /**
   * 设置 IPC 处理程序
   */
  private setupIpcHandlers(): void {
    ipcMain.removeHandler('update:check')
    ipcMain.handle('update:check', async (): Promise<UpdateCheckResult> => {
      return this.checkNow()
    })

    ipcMain.removeHandler('update:download')
    ipcMain.handle('update:download', async (): Promise<UpdateActionResult> => {
      if (this.isPortable) {
        return { ok: false, error: '绿色版不支持自动更新，请手动下载安装包' }
      }
      try {
        await autoUpdater.downloadUpdate()
        return { ok: true }
      } catch (error: any) {
        logger.error('下载更新失败:', error)
        return { ok: false, error: error?.message || String(error) }
      }
    })

    ipcMain.removeHandler('update:install')
    ipcMain.handle('update:install', (): UpdateActionResult => {
      try {
        this.installUpdate()
        return { ok: true }
      } catch (error: any) {
        return { ok: false, error: error?.message || String(error) }
      }
    })

    ipcMain.removeHandler('update:status')
    ipcMain.handle('update:status', () => {
      return this.state
    })

    // 绿色版 / 自动更新失败时的兜底：打开 Release 页面让用户手动下载
    ipcMain.removeHandler('update:open-download')
    ipcMain.handle('update:open-download', async (): Promise<UpdateActionResult> => {
      const url = this.state.manualDownloadUrl
      try {
        await shell.openExternal(url)
        return { ok: true }
      } catch (error: any) {
        logger.error('打开下载页失败:', error)
        return { ok: false, error: `打开下载页失败，请手动访问 ${url}` }
      }
    })

    ipcMain.removeHandler('update:set-skip')
    ipcMain.handle('update:set-skip', (_, skip: boolean) => {
      // electron-updater 不支持运行时跳过更新，这里仅记录
      logger.info(`Update skip setting: ${skip}`)
    })
  }

  /**
   * 启动自动检查：延迟首检 + 周期轮询。
   * 必须由 main.ts 在窗口创建后调用，否则客户端永远不会主动发现新版本。
   */
  startAutoCheck(): void {
    if (this.started) return
    this.started = true

    if (!app.isPackaged) {
      logger.info('开发环境不启动自动更新检查')
      return
    }

    this.firstCheckTimer = setTimeout(() => {
      void this.checkNow().catch(() => {})
    }, FIRST_CHECK_DELAY_MS)

    this.intervalTimer = setInterval(() => {
      void this.checkNow().catch(() => {})
    }, CHECK_INTERVAL_MS)

    logger.info(
      `自动更新已启用：源=${this.state.updateFeed}，模式=${this.isPortable ? '绿色版(手动)' : '安装版(自动下载)'}，` +
      `首次检查 ${FIRST_CHECK_DELAY_MS / 1000}s 后，之后每 ${CHECK_INTERVAL_MS / 3600000}h`
    )
  }

  /**
   * 停止定时器（应用退出前调用，避免定时器悬挂）
   */
  stopAutoCheck(): void {
    if (this.firstCheckTimer) {
      clearTimeout(this.firstCheckTimer)
      this.firstCheckTimer = null
    }
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer)
      this.intervalTimer = null
    }
    this.started = false
  }

  /**
   * 执行一次检查，返回可区分"最新/失败"的结构化结果。
   * 可被 IPC 与定时器共用。
   */
  private async checkNow(): Promise<UpdateCheckResult> {
    const currentVersion = app.getVersion()

    if (!app.isPackaged) {
      return {
        ok: false,
        updateAvailable: false,
        currentVersion,
        error: '开发环境不检查更新',
        reason: 'dev',
      }
    }

    // 并发保护：启动后 20s 的自动首检、6 小时轮询、用户手动点击三者可能撞车。
    // electron-updater 同时只允许一次检查，撞上会抛错，界面就会弹一个用户看不懂的失败。
    // 此时直接复用已知状态，静默返回即可（不算失败，也不谎报"已是最新"）。
    if (this.checkInFlight) {
      return {
        ok: true,
        updateAvailable: this.updateAvailable,
        currentVersion,
        version: this.state.version,
        reason: 'in-progress',
      }
    }

    this.checkInFlight = true
    try {
      const result = await autoUpdater.checkForUpdates()
      const info = result?.updateInfo
      if (info && info.version && info.version !== currentVersion) {
        return {
          ok: true,
          updateAvailable: true,
          currentVersion,
          version: info.version,
          reason: 'update-available',
        }
      }
      return { ok: true, updateAvailable: false, currentVersion, reason: 'up-to-date' }
    } catch (error: any) {
      const message = error?.message || String(error)
      logger.error('检查更新失败:', error)
      // 网络类错误单独给出人话提示，其余原样透传
      const friendly =
        message.includes('net::ERR') || error?.code === 'ECONNREFUSED' || error?.code === 'ENOTFOUND'
          ? `无法连接更新服务器，请检查网络（${message}）`
          : message
      this.updateState({ status: 'error', error: friendly })
      return {
        ok: false,
        updateAvailable: false,
        currentVersion,
        error: friendly,
        reason: 'failed',
      }
    } finally {
      this.checkInFlight = false
    }
  }

  /**
   * 推送状态到渲染进程。
   *
   * 修复：main.ts 此前从未调用 setMainWindow()，这里的分支长期不可达，
   * 而 UpdateChecker 只在挂载时取一次 update:status，结果"下载完成/可安装"
   * 永远推不到渲染层 →「立即更新并重启」按钮不出现。
   * 因安全加固已关闭 autoInstallOnAppQuit（不再退出时静默安装），
   * 这条推送必须可达，否则更新将永远无法安装。
   */
  private updateState(updates: Partial<UpdateState>): void {
    this.state = { ...this.state, ...updates }
    this.pushState()
  }

  private pushState(): void {
    const target =
      this.mainWindow && !this.mainWindow.isDestroyed()
        ? this.mainWindow
        : BrowserWindow.getAllWindows().find((win) => !win.isDestroyed()) || null
    if (target) {
      target.webContents.send('update:state-changed', this.state)
    }
  }

  /**
   * 检查更新（对外方法，语义同 checkNow）
   */
  async checkForUpdates(): Promise<UpdateInfo | null> {
    const result = await autoUpdater.checkForUpdates()
    return result?.updateInfo || null
  }

  /**
   * 下载更新
   */
  async downloadUpdate(): Promise<void> {
    if (this.isPortable) {
      throw new Error('绿色版不支持自动更新，请手动下载安装包')
    }
    if (!this.updateAvailable) {
      throw new Error('没有可用的更新')
    }
    await autoUpdater.downloadUpdate()
  }

  /**
   * 安装更新并重启
   */
  installUpdate(): void {
    if (this.isPortable) {
      throw new Error('绿色版不支持自动更新，请手动下载安装包后替换')
    }
    if (!this.updateDownloaded) {
      throw new Error('更新尚未下载完成')
    }
    autoUpdater.quitAndInstall()
  }

  /**
   * 获取当前状态
   */
  getState(): UpdateState {
    return { ...this.state }
  }
}

// 单例实例
let autoUpdateServiceInstance: AutoUpdateService | null = null

export function getAutoUpdateService(): AutoUpdateService {
  if (!autoUpdateServiceInstance) {
    autoUpdateServiceInstance = new AutoUpdateService()
  }
  return autoUpdateServiceInstance
}

/**
 * 退出前清理定时器。
 * 刻意不实例化单例——退出阶段的清理动作不应该反过来触发一次服务构造。
 */
export function stopAutoUpdateServiceIfStarted(): void {
  autoUpdateServiceInstance?.stopAutoCheck()
}

export { AutoUpdateService }
