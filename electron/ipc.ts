/**
 * IPC 处理程序注册
 * 所有 IPC 处理程序集中注册，保持 main.ts 简洁
 */

import { ipcMain, dialog, app } from 'electron'
import { BrowserWindow } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import axios from 'axios'
import { PATHS } from './utils/constants'
import { assertSafeAIEndpoint, assertProviderEndpointBinding } from './utils/endpointGuard'
import type { NextPaperResult } from './adapters/PlatformAdapter.interface'

/**
 * 校验内部导航 URL（修复 RM-SEC-003）
 * 仅允许 http/https，阻断 file://、javascript:、data: 等本地文件/注入协议。
 * 不强制域名白名单，避免影响用户自定义批改平台站点。
 */
export function validateNavigateUrl(raw: any): { ok: true; url: string } | { ok: false; error: string } {
  if (typeof raw !== 'string' || !raw.trim()) {
    return { ok: false, error: 'URL 为空' }
  }
  try {
    const parsed = new URL(raw.trim())
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { ok: false, error: `不允许的协议：${parsed.protocol}` }
    }
    return { ok: true, url: parsed.toString() }
  } catch {
    return { ok: false, error: 'URL 格式无效' }
  }
}

/**
 * 校验对外打开的外部链接（修复 shell:openExternal 无 handler + 无协议校验）
 */
export function validateExternalUrl(raw: any): { ok: true; url: string } | { ok: false; error: string } {
  if (typeof raw !== 'string' || !raw.trim()) {
    return { ok: false, error: 'URL 为空' }
  }
  try {
    const parsed = new URL(raw.trim())
    if (!['http:', 'https:', 'mailto:'].includes(parsed.protocol)) {
      return { ok: false, error: `不允许的协议：${parsed.protocol}` }
    }
    return { ok: true, url: parsed.toString() }
  } catch {
    return { ok: false, error: 'URL 格式无效' }
  }
}

// 服务实例（由 main.ts 注入）
let mainWindow: BrowserWindow | null = null
let logger: any
let configService: any
let storageService: any
let browserService: any
let ocrService: any
let aiService: any

/**
 * 初始化 IPC 处理程序
 * @param deps - 依赖对象
 */
export function setupIPCHandlers(deps: {
  mainWindow: BrowserWindow | null
  logger: any
  configService: any
  storageService: any
  browserService: any
  ocrService: any
  aiService: any
}): void {
  mainWindow = deps.mainWindow
  logger = deps.logger
  configService = deps.configService
  storageService = deps.storageService
  browserService = deps.browserService
  ocrService = deps.ocrService
  aiService = deps.aiService

  // 注册所有 IPC 处理程序
  registerRendererErrorHandler()
  registerWindowHandlers()
  registerDialogHandlers()
  registerAppHandlers()
  registerBotSettingHandlers()
  registerSecureStorageHandlers()
  registerPaddleOCRHandlers()
  registerBrowserHandlers()
  registerCaptureHandlers()
  registerInteractionHandlers()
  registerOCRHandlers()
  registerAIGradingHandlers()
  registerNavigationHandlers()
  registerFileHandlers()
  registerAutoUpdateHandlers()
}

// ============ 渲染层错误上报 ============

function registerRendererErrorHandler(): void {
  // 修复 BUG-NEW-011：渲染层 ErrorBoundary 上报通道此前未注册，错误被白名单拦截后静默丢弃
  ipcMain.on('renderer-error', (_event, payload: any) => {
    const message =
      (payload && typeof payload === 'object' && typeof payload.message === 'string' ? payload.message : String(payload ?? '')) ||
      'unknown renderer error'
    const stack = payload && typeof payload === 'object' ? payload.stack : undefined
    logger?.error?.('[renderer-error] ' + message, stack ? new Error(stack) : undefined)
  })
}

// ============ 窗口控制 ============

function registerWindowHandlers(): void {
  ipcMain.on('window-minimize', () => mainWindow?.minimize())
  
  ipcMain.on('window-maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow?.maximize()
    }
  })
  
  ipcMain.on('window-close', () => mainWindow?.close())
}

// ============ 对话框 ============

function registerDialogHandlers(): void {
  // 修复：增加 null 检查，避免窗口关闭后调用 dialog 抛出异常
  ipcMain.handle('dialog:openFile', async (_, options) => {
    if (!mainWindow) {
      return { canceled: true, error: 'Window not available' }
    }
    return dialog.showOpenDialog(mainWindow, options)
  })
  
  ipcMain.handle('dialog:saveFile', async (_, options) => {
    if (!mainWindow) {
      return { canceled: true, error: 'Window not available' }
    }
    return dialog.showSaveDialog(mainWindow, options)
  })
}

// ============ 应用路径 ============

function registerAppHandlers(): void {
  ipcMain.handle('app:getPath', async (_, name: string) => {
    // 修复 RM-SEC-008：参数必须落在白名单内，避免渲染进程枚举任意应用路径
    if (!(PATHS.ALLOWED_PATH_NAMES as readonly string[]).includes(name)) {
      logger.warn('app:getPath 参数不在白名单，已拒绝', { name })
      throw new Error(`不允许的路径名称：${name}`)
    }
    const { app } = require('electron')
    return app.getPath(name as any)
  })
}

// ============ Bot 设置 ============

function registerBotSettingHandlers(): void {
  // P0-003 修复：移除遗留的 bot:setApiKey 处理器（无代码调用，存在安全风险）
  // 所有 API Key 现在通过 bot:updateBotSettings 和 secureStorage IPC 处理

  /**
   * 应用 Bot 设置（含端点安全校验）
   *
   * 安全修复（阻断-06 第二条密钥外传通路）：本 handler 会把**渲染层传入的
   * provider.endpoint** 写入 AI 设置，之后 AIService 会拿着这个 endpoint 配
   * `Authorization: Bearer <真实 apiKey>` 发请求（见 AIService.grade / gradeWithImage /
   * analyzeCorrection / recognizeRegion）。若不校验，被注入的渲染层即可把真实密钥
   * 外送到任意主机（密钥外传）并借机探测内网（SSRF）——与 bot:test-api 是同一漏洞类。
   *
   * 校验失败时**整体拒绝写入**（不部分生效），配置保持原值，并返回明确错误对象。
   */
  function applyBotSettings(settings: any): { success: boolean; error?: string } {
    if (!settings || typeof settings !== 'object') {
      return { success: false, error: '设置参数无效' }
    }

    // 渲染进程不再发送 API Key（主进程直接从 secureStorage 读取），
    // 这里同时清除可能残留的 apiKey 字段，防止意外传递。
    const providers: any[] = Array.isArray(settings.providers) ? settings.providers : []

    for (const provider of providers) {
      if (provider && typeof provider === 'object' && provider.apiKey) {
        delete provider.apiKey
      }
    }

    // 逐个校验端点（只有校验通过才会走到最后的 updateSettings，故为原子写入）
    for (const provider of providers) {
      const rawEndpoint = typeof provider?.endpoint === 'string' ? provider.endpoint.trim() : ''

      // 未配置端点：AIService 会走本地评分、不会外发密钥，属于安全状态，
      // 允许保存（否则用户新建服务商、还没填地址时会被卡住无法保存模型名等）。
      if (!rawEndpoint) continue

      const providerId = String(provider?.id || '')
      const check = assertSafeAIEndpoint(rawEndpoint, providerId)
      if (!check.ok) {
        logger.warn('bot:updateBotSettings 拒绝写入：服务商端点未通过安全校验', {
          providerId: provider?.id,
          providerName: provider?.name,
          reason: check.error,
        })
        return { success: false, error: check.error }
      }

      // 叠加绑定校验（阻断-06 残留收口）：assertSafeAIEndpoint 为保留"自定义 OpenAI 兼容
      // 端点"这一合法能力，会放行任意公网 https 域名。因此内置服务商（deepseek/openai/…）
      // 的真实 Key 仍可能被送往攻击者域名（实测曾 ALLOW）。绑定校验把内置服务商限定在其
      // 官方域名（含子域）；custom / uuid / 未知 id 返回 bound=false 放行，不做收紧。
      const binding = assertProviderEndpointBinding(check.endpoint, providerId)
      if (!binding.ok) {
        logger.warn('bot:updateBotSettings 拒绝写入：端点与服务商身份不匹配', {
          providerId: provider?.id,
          providerName: provider?.name,
          endpointHost: check.host,
          reason: binding.error,
        })
        // 返回可展示的 error 文案；此处 return 发生在 updateSettings 之前，
        // 因此整次写入被原子拒绝，配置保持原值
        return { success: false, error: binding.error }
      }

      // 存归一化后的端点，保证 AIService 实际请求的地址与校验通过的地址完全一致
      provider.endpoint = check.endpoint
    }

    // 更新 AI 服务设置
    aiService.updateSettings(settings)
    logger.info('Bot 设置已更新')
    return { success: true }
  }

  // 旧通道（兼容现状）：preload 目前用 ipcRenderer.send，属 fire-and-forget，
  // 主进程的返回值到不了渲染层。因此失败路径除了返回错误对象，还必须落 warn 日志，
  // 保证"拒绝写入"不被静默吞掉。注意：拒绝时配置保持原值，绝不带病生效。
  ipcMain.on('bot:updateBotSettings', (_, settings: any) => {
    const result = applyBotSettings(settings)
    if (!result.success) {
      logger.warn('bot:updateBotSettings 已拒绝本次设置写入，配置保持原值', { error: result.error })
    }
  })

  // 新通道：渲染层改用 invoke 后即可直接拿到明确错误并展示给用户
  // （preload 目前仍走 send，此 handler 为契约预留，不影响现有调用）
  ipcMain.handle('bot:updateBotSettings', (_, settings: any) => applyBotSettings(settings))
  
  ipcMain.handle('bot:get-settings', () => {
    return aiService.getSettings()
  })
  
  ipcMain.on('bot:setStandard', (_, standard) => {
    logger.info('Standard set:', standard?.name)
  })
  
  // P0 修复：API 测试通过主进程代理执行，渲染进程不接触 API Key
  ipcMain.handle('bot:test-api', async (_, params: {
    providerId: string
    endpoint: string
    model: string
    prompt: string
    temperature: number
    maxTokens: number
  }) => {
    const { providerId, endpoint, model, prompt, temperature, maxTokens } = params

    // 安全修复（阻断-06）：endpoint 来自渲染层，而下面会带上从 secureStorage 读出的
    // 真实 apiKey 发请求，因此必须先过端点守卫（协议 / 白名单 / 内网与 IP 直连 / URL 内嵌凭据）。
    // 之后一律使用守卫返回的归一化端点，避免"手工归一化 + 守卫归一化"两套逻辑漂移。
    const endpointCheck = assertSafeAIEndpoint(endpoint, providerId)
    if (!endpointCheck.ok) {
      logger.warn('bot:test-api 请求被拒绝：端点未通过安全校验', {
        providerId,
        reason: endpointCheck.error,
      })
      return { error: endpointCheck.error }
    }

    // 叠加绑定校验（阻断-06 残留收口）：守卫会放行任意公网 https 域名，
    // 内置服务商的真实 Key 仍可能被送往攻击者域名。绑定校验把内置服务商限定在官方域名；
    // custom / uuid / 未知 id 放行（bound=false，不做收紧）。
    const binding = assertProviderEndpointBinding(endpointCheck.endpoint, providerId)
    if (!binding.ok) {
      logger.warn('bot:test-api 请求被拒绝：端点与服务商身份不匹配', {
        providerId,
        endpointHost: endpointCheck.host,
        reason: binding.error,
      })
      return { error: binding.error }
    }

    if (!(model || '').trim()) {
      return { error: '未填写模型名称，请先在设置中填写该服务商的模型名' }
    }

    const apiKey = await storageService.getApiKey(providerId)
    if (!apiKey) {
      return { error: '未配置服务商的 API Key，请先在设置中填写并保存' }
    }

    // 端点（已由守卫归一化，保证以 /chat/completions 结尾）
    const normalizedEndpoint = endpointCheck.endpoint

    const startTime = Date.now()

    try {
      const response = await axios.post(
        normalizedEndpoint,
        {
          model,
          messages: [
            { role: 'system', content: '你是一个有帮助的助手。' },
            { role: 'user', content: prompt },
          ],
          temperature: temperature || 0.7,
          // 200 太小：思考模式会先用思维链消耗输出额度，正文容易被挤空
          max_tokens: maxTokens || 1000,
          stream: false,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          timeout: 30000,
        }
      )

      const elapsed = Date.now() - startTime
      const choice = response.data?.choices?.[0]
      const content = choice?.message?.content?.trim() || ''
      // DeepSeek 思考模式会先输出思维链（reasoning_content），正文在 content。
      // 若 max_tokens 偏小，会被思维链耗尽导致 content 为空。
      const reasoningContent = choice?.message?.reasoning_content?.trim() || ''

      if (!content) {
        // 修复：此前 content 为空会回退成 "(测试响应)" 这种假结果，并谎报"调用成功"
        const hint = reasoningContent
          ? '模型只返回了思维链、正文为空：通常是 max_tokens 被思考模式耗尽，请调大 max_tokens 或关闭思考模式'
          : '模型返回内容为空：请检查模型名称是否正确、该服务商是否支持当前调用格式'
        return { success: false, error: hint, time: elapsed, reasoning: reasoningContent || undefined }
      }

      return { success: true, content, time: elapsed }
    } catch (error: any) {
      const elapsed = Date.now() - startTime
      if (error.response) {
        // 服务器返回了非 2xx 响应
        const errorData = error.response.data
        const remoteMsg =
          errorData?.error?.message ||
          errorData?.message ||
          errorData?.error ||
          error.response.statusText
        const hint =
          error.response.status === 401 || error.response.status === 403
            ? '（请检查 API Key 是否正确、是否有该模型权限）'
            : error.response.status === 404
              ? '（请检查 API 地址是否正确，模型名是否存在）'
              : ''
        return {
          error: `HTTP ${error.response.status}: ${remoteMsg}${hint}`,
          time: elapsed,
        }
      }
      if (error.code === 'ECONNABORTED') {
        return { error: '请求超时（30s），请检查网络或 API 地址', time: elapsed }
      }
      if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
        return { error: `无法连接 ${error.code === 'ENOTFOUND' ? '（域名无法解析）' : '（连接被拒绝）'}，请检查 API 地址与网络`, time: elapsed }
      }
      return {
        error: String(error?.message || error),
        time: elapsed,
      }
    }
  })
}

// ============ 安全存储 ============

function registerSecureStorageHandlers(): void {
  ipcMain.handle('secure:get', (_, key: string) => {
    return storageService.get(key)
  })
  
  ipcMain.handle('secure:set', (_, key: string, value: string) => {
    return storageService.set(key, value)
  })
  
  ipcMain.handle('secure:delete', (_, key: string) => {
    return storageService.delete(key)
  })
  
  ipcMain.handle('secure:has', (_, key: string) => {
    return storageService.has(key)
  })
  
  ipcMain.handle('secure:is-available', () => {
    return storageService.isAvailable()
  })
}

// ============ PaddleOCR 配置 ============

function registerPaddleOCRHandlers(): void {
  ipcMain.on('bot:configurePaddleOCR', (_, config: any) => {
    ocrService.configure(config)
    logger.info('PaddleOCR 配置已更新')
  })
}

// ============ 浏览器操作 ============

function registerBrowserHandlers(): void {
  ipcMain.handle('bot:launch', async (_, headless: boolean) => {
    return browserService.launch(headless)
  })
  
  ipcMain.handle('bot:connect', async () => {
    return browserService.connect()
  })
  
  ipcMain.handle('bot:navigate', async (_, url: string) => {
    // 修复 RM-SEC-003：渲染进程传入的 URL 必须经过协议校验后才能导航
    const check = validateNavigateUrl(url)
    if (!check.ok) {
      logger.warn('bot:navigate 请求被拒绝', { url: String(url).slice(0, 200), reason: check.error })
      return { error: check.error }
    }
    return browserService.navigate(check.url)
  })

  // 补全 shell:openExternal handler（此前 preload 暴露但主进程未注册，调用必然失败）
  ipcMain.handle('shell:openExternal', async (_, url: string) => {
    const check = validateExternalUrl(url)
    if (!check.ok) {
      logger.warn('shell:openExternal 请求被拒绝', { url: String(url).slice(0, 200), reason: check.error })
      return { success: false, error: check.error }
    }
    try {
      const { shell } = require('electron')
      await shell.openExternal(check.url)
      return { success: true }
    } catch (e: any) {
      logger.error('打开外部链接失败', e)
      return { success: false, error: e?.message || '打开失败' }
    }
  })
  
  ipcMain.handle('bot:analyze', async () => {
    return browserService.analyzePage()
  })
  
  ipcMain.handle('bot:getCurrentUrl', () => {
    return browserService.getCurrentUrl()
  })
  
  // 从用户 Edge 重新同步配置文件（Cookie、登录凭据等）
  ipcMain.handle('bot:sync-edge-profile', async () => {
    return browserService.syncFromEdge()
  })
}

// ============ 截图 ============

function registerCaptureHandlers(): void {
  ipcMain.handle('bot:capture', async () => {
    return browserService.captureAnswerImage()
  })
  
  ipcMain.handle('bot:capture-auto', async () => {
    return browserService.captureAnswerImage()
  })
  
  ipcMain.handle('bot:capture-coordinate', async (_, x: number, y: number, width: number, height: number) => {
    return browserService.captureCoordinate(x, y, width, height)
  })
  
  ipcMain.handle('bot:capture-fullpage', async () => {
    return browserService.captureFullPage()
  })
}

// ============ 交互 ============

function registerInteractionHandlers(): void {
  ipcMain.handle('bot:click-at', async (_, x: number, y: number) => {
    return browserService.clickAt(x, y)
  })
  
  ipcMain.handle('bot:type-at', async (_, x: number, y: number, text: string) => {
    return browserService.typeAt(x, y, text)
  })
}

// ============ OCR 识别 ============

function registerOCRHandlers(): void {
  ipcMain.handle('bot:recognize', async (_, imageBase64: string) => {
    return ocrService.recognize(imageBase64)
  })
}

// ============ AI 评分 ============

function registerAIGradingHandlers(): void {
  ipcMain.handle('bot:grade', async (_, text: string, standard: any, correctionHistory?: any[]) => {
    // 输入验证
    if (!text || typeof text !== 'string') {
      logger.warn('Invalid grade request: text is required')
      // 修复（红线）：早退分支必须带 needsHumanReview，否则渲染层会把 0 分当正常结果自动提交
      return { score: 0, comment: '错误：缺少题目内容', needsHumanReview: true }
    }
    
    if (!standard || typeof standard !== 'object') {
      logger.warn('Invalid grade request: standard is required')
      // 修复（红线）：同上，缺失评分标准绝不能被当作"正常 0 分"
      return { score: 0, comment: '错误：缺少评分标准', needsHumanReview: true }
    }
    
    return aiService.grade(text, standard, correctionHistory)
  })

  // 图像直评（首选路径）：直接把答题截图交给视觉模型识别并评分。
  // 返回 { ok, result?, reason? }，ok=false 时由渲染端回退到 OCR + 文本评分。
  ipcMain.handle('bot:grade-image', async (_, imageDataUrl: string, standard: any, correctionHistory?: any[]) => {
    if (!imageDataUrl || typeof imageDataUrl !== 'string') {
      return { ok: false, reason: '缺少答题图片' }
    }
    if (!standard || typeof standard !== 'object') {
      return { ok: false, reason: '缺少评分标准' }
    }

    return aiService.gradeWithImage(imageDataUrl, standard, correctionHistory)
  })

  // 纠错分析：修复此前只有白名单没有 handler、渲染端调用一直静默失败的问题
  ipcMain.handle('bot:analyzeCorrection', async (_, payload: any) => {
    if (!payload || typeof payload !== 'object') {
      return { success: false, error: '参数错误' }
    }
    try {
      return await aiService.analyzeCorrection(payload)
    } catch (e: any) {
      return { success: false, error: e?.message || '纠错分析失败' }
    }
  })

  ipcMain.handle('bot:recognize-region', async (_, imageDataUrl: string, hint?: string) => {
    if (!imageDataUrl || typeof imageDataUrl !== 'string') {
      return { error: '缺少页面截图' }
    }
    try {
      return await aiService.recognizeRegion(imageDataUrl, hint)
    } catch (e: any) {
      return { error: e?.message || '区域识别失败' }
    }
  })
}

// ============ 提交和导航 ============

function registerNavigationHandlers(): void {
  ipcMain.handle('bot:submit', async (_, score: number) => {
    // 输入验证
    if (typeof score !== 'number' || isNaN(score)) {
      logger.warn('Invalid submit request: score must be a number')
      return { success: false, error: 'Invalid score' }
    }
    
    if (score < 0 || score > 150) {
      logger.warn('Invalid submit request: score out of range', { score })
      return { success: false, error: 'Score out of range' }
    }

    // 契约统一：无论成功或失败都返回对象 { success, error? }。
    // 修复：此前正常路径直接返回 submitScore 的 boolean，渲染层会拿到两种形态（对象/布尔）
    // 而误判提交结果——提交未被平台确认接受却被当成成功。
    const ok = await browserService.submitScore(score)
    if (!ok) {
      logger.warn('提交未被平台确认接受，已标记为需人工复核', { score })
      return { success: false, error: '平台未确认接受本次提交，请检查页面状态后人工复核' }
    }
    return { success: true }
  })
  
  ipcMain.handle('bot:next', async () => {
    // 三态契约（类型 NextPaperResult，见 electron/adapters/PlatformAdapter.interface.ts）：
    //   'ok'    已成功切到下一题
    //   'last'  已确认是最后一题（唯一允许作为"批改正常结束"依据的值）
    //   'error' 切题出错（页面未就绪 / 选择器失效 / 点击失败 / 适配器异常等）
    // 渲染层必须区分：'error' 绝不可被当作"没有更多试卷"而静默结束批改。
    const result: NextPaperResult = await browserService.goToNext()
    if (result === 'error') {
      logger.warn('bot:next 切题失败（三态返回 error），渲染层不得据此判定为"已到最后一题"')
    }
    return result
  })
  
  ipcMain.handle('bot:close', async () => {
    await browserService.close()
  })
}

// ============ 自动更新 ============

function registerAutoUpdateHandlers(): void {
  try {
    // 修复（静默失败）：更新相关 IPC 通道（update:check / download / install / status /
    // set-skip）在 AutoUpdateService 构造阶段就已注册——构造函数调用 setupAutoUpdater()，
    // 其末尾调用 private setupIpcHandlers()（注意是小写 pc）。
    // 此前这里写的是 autoUpdateService.setupIPCHandlers()，该方法并不存在，
    // 会抛 TypeError 并被下面的 catch 吞掉：功能因构造函数已注册而侥幸可用，
    // 但每次启动都会误报 "Failed to setup auto-update handlers"，掩盖真实故障。
    // 该方法为 private 且已由构造函数调用，此处只负责触发单例构造（幂等）。
    const { getAutoUpdateService } = require('./autoUpdater')
    getAutoUpdateService()
  } catch (error) {
    logger.error('Failed to setup auto-update handlers:', error)
  }
}

// ============ 文件操作 ============

function registerFileHandlers(): void {
  /**
   * 获取允许的文件路径列表
   */
  function getAllowedPaths(): string[] {
    try {
      return [
        app.getPath('userData'),
        app.getPath('documents'),
        app.getPath('downloads'),
        app.getPath('pictures'),
      ]
    } catch (error) {
      logger.warn('Failed to get allowed paths, using userData only')
      return [app.getPath('userData')]
    }
  }

  /**
   * 验证文件路径是否在允许范围内
   */
  function validateFileAccess(filePath: string): { valid: boolean; normalizedPath?: string; error?: string } {
    try {
      const resolvedPath = path.resolve(filePath)
      const normalizedPath = resolvedPath.toLowerCase().replace(/\\/g, '/')
      
      // 检查路径遍历攻击
      if (filePath.includes('..') || filePath.includes('~')) {
        return { valid: false, error: 'Path traversal detected' }
      }
      
      // 检查空字节注入
      if (filePath.includes('\0')) {
        return { valid: false, error: 'Null byte detected' }
      }
      
      // 检查是否在允许的目录下
      const allowedPaths = getAllowedPaths()
      const isAllowed = allowedPaths.some(allowedPath => {
        const normalizedAllowed = allowedPath.toLowerCase().replace(/\\/g, '/')
        return normalizedPath === normalizedAllowed || normalizedPath.startsWith(normalizedAllowed + '/')
      })
      
      if (!isAllowed) {
        return { valid: false, error: 'Access denied: path not in allowed directories' }
      }
      
      return { valid: true, normalizedPath: resolvedPath }
    } catch (error) {
      return { valid: false, error: `Path validation failed: ${(error as Error).message}` }
    }
  }

  // file:read - 读取文件
  ipcMain.handle('file:read', async (_, filePath: string) => {
    try {
      const validation = validateFileAccess(filePath)
      if (!validation.valid) {
        return { success: false, error: validation.error }
      }

      const content = fs.readFileSync(validation.normalizedPath!, 'utf-8')
      return { success: true, data: content }
    } catch (error) {
      logger.error('Failed to read file:', error as Error, { filePath })
      return { success: false, error: (error as Error).message }
    }
  })

  // file:write - 写入文件
  ipcMain.handle('file:write', async (_, filePath: string, content: string) => {
    try {
      const validation = validateFileAccess(filePath)
      if (!validation.valid) {
        return { success: false, error: validation.error }
      }

      // 确保目录存在
      const dir = path.dirname(validation.normalizedPath!)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }

      fs.writeFileSync(validation.normalizedPath!, content, 'utf-8')
      logger.info('File written successfully:', { filePath })
      return { success: true }
    } catch (error) {
      logger.error('Failed to write file:', error as Error, { filePath })
      return { success: false, error: (error as Error).message }
    }
  })

  // file:readImage - 读取图片并转为 base64
  ipcMain.handle('file:readImage', async (_, filePath: string) => {
    try {
      const validation = validateFileAccess(filePath)
      if (!validation.valid) {
        return { success: false, error: validation.error }
      }

      const imageBuffer = fs.readFileSync(validation.normalizedPath!)
      const base64 = imageBuffer.toString('base64')
      
      // 确定 MIME 类型
      const ext = path.extname(validation.normalizedPath!).toLowerCase()
      const mimeType = ext === '.png' ? 'image/png' : 
                      ext === '.gif' ? 'image/gif' : 
                      ext === '.webp' ? 'image/webp' : 
                      ext === '.bmp' ? 'image/bmp' : 
                      'image/jpeg'
      
      return { 
        success: true, 
        data: `data:${mimeType};base64,${base64}` 
      }
    } catch (error) {
      logger.error('Failed to read image:', error as Error, { filePath })
      return { success: false, error: (error as Error).message }
    }
  })

  // file:exists - 检查文件是否存在
  ipcMain.handle('file:exists', async (_, filePath: string) => {
    try {
      const validation = validateFileAccess(filePath)
      if (!validation.valid) {
        return { success: false, error: validation.error }
      }

      const exists = fs.existsSync(validation.normalizedPath!)
      return { success: true, exists }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  // file:delete - 删除文件
  ipcMain.handle('file:delete', async (_, filePath: string) => {
    try {
      const validation = validateFileAccess(filePath)
      if (!validation.valid) {
        return { success: false, error: validation.error }
      }

      if (!fs.existsSync(validation.normalizedPath!)) {
        return { success: false, error: 'File not found' }
      }

      fs.unlinkSync(validation.normalizedPath!)
      logger.info('File deleted successfully:', { filePath })
      return { success: true }
    } catch (error) {
      logger.error('Failed to delete file:', error as Error, { filePath })
      return { success: false, error: (error as Error).message }
    }
  })
}
