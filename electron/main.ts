/**
 * 主进程入口（重构后）
 * 职责：窗口管理、IPC 路由、应用生命周期
 * 所有业务逻辑已委托给服务层
 */

// ============ 导入 ============

import { app, BrowserWindow, screen, ipcMain } from 'electron'
import * as path from 'path'
import axios from 'axios'
import FormData from 'form-data'

// 服务层
import { LogService, getLogger } from './services/LogService'
import { writeLogLine } from './logger'
import { ConfigService, getConfigService } from './services/ConfigService'
import { StorageService, getStorageService } from './services/StorageService'
import { BrowserService, getBrowserService } from './services/BrowserService'
import { OCRService, getOCRService } from './services/OCRService'
import { AIService, getAIService } from './services/AIService'

// 适配器模块
import { initializeAdapters } from './adapters/init'

// IPC 处理程序
import { setupIPCHandlers } from './ipc'

// 批改历史加密存储（PII 落盘）
import { registerHistoryHandlers } from './historyStore'

// ============ 全局变量 ============

let mainWindow: BrowserWindow | null = null

// 服务实例
let logger: LogService
let configService: ConfigService
let storageService: StorageService
let browserService: BrowserService
let ocrService: OCRService
let aiService: AIService

// ============ 初始化 ============

async function initServices(): Promise<void> {
  // 创建日志服务
  logger = getLogger()

  // 把服务层日志落盘（userData/logs/app-YYYY-MM-DD.log）。
  // 修复：此前只有控制台输出，用户反馈问题时无法回溯模型返回等关键细节。
  logger.addTransport({
    write(entry: any) {
      const meta = entry?.meta ? ` ${JSON.stringify(entry.meta)}` : ''
      const err = entry?.error?.message ? ` | ${entry.error.message}` : ''
      writeLogLine(`[${entry?.timestamp}] [${entry?.levelLabel}] ${entry?.message}${meta}${err}`)
    },
  })
  
  // 创建配置服务
  configService = getConfigService(logger)
  await configService.init()
  
  // 初始化适配器系统（必须在创建 BrowserService 之前）
  await initializeAdapters(logger, configService)
  logger.info('适配器系统已初始化')
  
  // 创建存储服务
  storageService = getStorageService(logger)
  await storageService.init()
  
  // 创建浏览器服务
  browserService = getBrowserService(logger, configService)
  
  // 创建 OCR 服务
  ocrService = getOCRService(logger, configService)
  
  // 创建 AI 服务
  aiService = getAIService(logger, storageService)
  
  logger.info('所有服务已初始化')
}

// ============ 窗口管理 ============

function createWindow(): void {
  const isDev = process.env.NODE_ENV === 'development'
  
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hidden',
    webPreferences: {
      // 使用 app.getAppPath() 确保 asar/unpacked 都能正确找到
      preload: path.join(app.getAppPath(), 'dist', 'main', 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  // 加载渲染进程
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools()
  } else {
    // 使用 app.getAppPath() 获取 asar 根路径，自动处理 asar 内外文件访问
    mainWindow.loadFile(path.join(app.getAppPath(), 'dist', 'renderer', 'index.html'))
  }

  // 窗口事件
  mainWindow.on('maximize', () => {
    mainWindow?.webContents.send('window:maximize-change', true)
  })

  mainWindow.on('unmaximize', () => {
    mainWindow?.webContents.send('window:maximize-change', false)
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// ============ OCR 连接测试（主进程代理）============

/**
 * 安全修复（高-05 回归）：
 * OCR「测试连接」此前在渲染层直接 fetch，并把 Token 放进 Authorization 头。
 * Token 改为只存 secureStorage 后，渲染层只剩哨兵值（__SECURED__），
 * 直发必然 401，用户误以为 Token 失效。
 * 这里把测试挪到主进程：由主进程从 secureStorage 读取真实 Token 发请求，
 * 渲染层永远拿不到真值（与 bot:test-api 对 API Key 的处理保持一致）。
 */
function registerOcrTestHandler(): void {
  ipcMain.handle('ocr:test-connection', async (_event, params: { url?: string; model?: string }) => {
    const url = (params?.url || '').trim()
    const model = (params?.model || '').trim() || 'PaddleOCR-VL-1.6'

    if (!url) {
      return { ok: false, error: '请先填写 OCR 服务地址' }
    }

    // 真值只存在于主进程安全存储，渲染层不接触
    const token = storageService?.get('paddle_ocr_token') || ''
    if (!token) {
      return { ok: false, error: '未配置 OCR Token：请先在设置中填写并保存 Token' }
    }

    let submitUrl = url.replace(/\/+$/, '')
    if (!submitUrl.endsWith('/api/v2/ocr/jobs')) {
      submitUrl += '/api/v2/ocr/jobs'
    }

    // 1x1 PNG 测试图，用于提交一个真实 OCR 任务验证连通性
    const testImage = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    )
    const form = new FormData()
    form.append('file', testImage, 'test.png')
    form.append('model', model)
    form.append('optionalPayload', JSON.stringify({
      useDocOrientationClassify: false,
      useDocUnwarping: false,
      useChartRecognition: false,
    }))

    try {
      const response = await axios.post(submitUrl, form, {
        headers: {
          'Authorization': `bearer ${token}`,
          ...form.getHeaders(),
        },
        timeout: 15000,
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        // 由主进程统一处理各状态码，不抛异常
        validateStatus: () => true,
      })

      const data = response.data
      const code = data?.code
      return {
        ok: response.status === 200 && (!code || code === 0),
        status: response.status,
        jobId: data?.data?.jobId,
        code,
        msg: data?.msg,
      }
    } catch (error: any) {
      logger?.warn?.('OCR 连接测试请求失败', { message: error?.message, code: error?.code })
      if (error?.code === 'ECONNABORTED') {
        return { ok: false, error: 'OCR 连接超时（15秒），请检查服务地址和网络' }
      }
      if (error?.code === 'ENOTFOUND' || error?.code === 'ECONNREFUSED') {
        return { ok: false, error: 'OCR 连接失败：无法连接到服务，请检查地址是否正确' }
      }
      return { ok: false, error: String(error?.message || error) }
    }
  })
}

// ============ 应用生命周期 ============

app.whenReady().then(async () => {
  try {
    // 初始化所有服务
    await initServices()
  } catch (error) {
    // 修复：服务初始化失败时显示错误对话框并退出，避免应用在不完整状态下运行
    console.error('服务初始化失败:', error)
    const { dialog } = require('electron')
    dialog.showErrorBox(
      '应用启动失败',
      `服务初始化失败，应用无法正常启动。\n\n错误信息: ${error instanceof Error ? error.message : String(error)}\n\n请尝试重新安装应用或联系技术支持。`
    )
    app.quit()
    return
  }
  
  // 创建窗口
  createWindow()
  
  // 注册 IPC 处理程序
  setupIPCHandlers({
    mainWindow,
    logger,
    configService,
    storageService,
    browserService,
    ocrService,
    aiService,
  })

  // 批改历史加密存储 IPC（PII 落盘到 userData/grading-history.enc）
  registerHistoryHandlers()

  // OCR 连接测试 IPC（主进程代理，渲染层不接触真实 Token）
  registerOcrTestHandler()
  
  logger.info('应用已启动')
  
  // macOS 激活事件
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
}).catch((error) => {
  console.error('应用启动失败:', error)
  app.quit()
})

// 所有窗口关闭时退出（Windows/Linux）
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// ============ 导出（用于测试）============

export { mainWindow, logger, configService, storageService, browserService, ocrService, aiService }
