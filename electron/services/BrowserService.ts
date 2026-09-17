/**
 * 浏览器自动化服务
 * 封装 Playwright 浏览器操作，提供启动、导航、交互、截图等功能
 * 
 * 已重构为使用平台适配层架构，支持多平台自动批改
 */

import { app, screen } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { createRequire } from 'module'
import { LogService } from './LogService'
import { ConfigService } from './ConfigService'
import { AdapterFactory, getAdapterFactory } from '../adapters/AdapterFactory'
import { PlatformAdapter, NextPaperResult } from '../adapters/PlatformAdapter.interface'
import { isString, isNumber } from '../utils/validators'
import { TIMEOUT, BROWSER, VIEWPORT } from '../utils/constants'
import {
  documentToViewport,
  isPointInsideViewport,
  formatOutOfViewportReason,
  verifyTypedValue,
  computeScrollTarget,
  type FocusedElementSnapshot,
  type ViewportPoint,
} from '../utils/viewportPoint'

// ============ 加载 Playwright ============
//
// ⚠️ 这里**必须走 CJS require，不能写 `await import('playwright')`**。
//
// 原因（打包后必现的启动失败）：打包后主进程代码位于 `app.asar` 内，而 Electron
// 对 asar 的支持是**给 Node 的 CommonJS 加载器打补丁**实现的（`require` / `fs`
// 把 asar 当虚拟目录读）。ESM 加载器不走这套补丁，所以从 asar 内部发起的
// `import('playwright')` 解析不到 `app.asar.unpacked/node_modules/playwright`，
// 直接抛 ERR_MODULE_NOT_FOUND —— 表现为「启动浏览器失败 / Playwright 加载失败」。
// 开发环境（无 asar）反而正常，所以这个缺陷只在打包版出现，极易漏测。
//
// 用 `createRequire(__filename)` 得到的 require 与 Electron 打过补丁的解析器同源，
// 开发版和打包版都能命中 playwright。

let chromium: any = null

function loadChromiumSync(): any {
  const req = createRequire(__filename)
  const mod = req('playwright')
  if (!mod || !mod.chromium) {
    throw new Error('playwright 模块已加载，但未导出 chromium')
  }
  return mod.chromium
}

async function ensureChromium(): Promise<any> {
  if (!chromium) {
    try {
      chromium = loadChromiumSync()
    } catch (syncError) {
      // 兜底：万一未来改成 ESM 打包，仍保留动态导入这条路
      try {
        const { chromium: chromiumModule } = await import('playwright')
        chromium = chromiumModule
      } catch (asyncError) {
        // 关键：把原始错误带出去，否则只能看到一句无信息量的"请重新安装依赖"
        throw new Error(
          `Playwright 模块加载失败（CJS: ${(syncError as Error).message}；` +
            `ESM: ${(asyncError as Error).message}）。请重新安装依赖后重试`
        )
      }
    }
  }
  return chromium
}

/**
 * 把启动失败的底层异常翻译成**用户能照着做**的提示。
 *
 * 之前统一返回「启动浏览器失败: <原始异常>」，而原始异常常常是英文的
 * ERR_MODULE_NOT_FOUND / Executable doesn't exist，用户完全无法自助。
 */
function describeLaunchError(error: unknown): string {
  const raw = String((error as Error)?.message || error || '未知错误')

  if (raw.includes('Playwright 模块加载失败')) {
    return `Playwright 依赖未正确加载：${raw}。请重新安装本软件（或执行 npm install）后重试。`
  }
  if (/executable doesn'?t exist/i.test(raw)) {
    return `浏览器可执行文件缺失：${raw}。请在联网状态下执行 npx playwright install chromium 后重试。`
  }
  if (raw.includes('未找到 Microsoft Edge')) {
    return '未找到 Microsoft Edge 浏览器，请先安装 Edge（Windows 10/11 自带）后重试。'
  }
  if (raw.includes('EBUSY') || raw.includes('EPERM') || raw.includes('Permission denied')) {
    return `浏览器配置文件被占用或无权限：${raw}。请先完全关闭已打开的 Edge，再重试。`
  }
  if (raw.includes('Timeout') || raw.includes('timed out')) {
    return `启动浏览器超时：${raw}。若配置文件目录损坏，可在「设置 → 同步 Edge 配置」重新同步后重试。`
  }
  return `启动浏览器失败: ${raw}`
}

// ============ 类型定义 ============

export interface LaunchResult {
  success: boolean
  method?: 'edge' | 'chromium'
  error?: string
}

export interface PageAnalysisResult {
  found: boolean
  error?: string
  platformName?: string
  platformDisplayName?: string
  isZhixue?: boolean
  isOldUI?: boolean
  isNewUI?: boolean
  hasAnswerImage?: boolean
  hasScoreInput?: boolean
  hasSubmitButton?: boolean
  questionContent?: string
  pageTitle?: string
}

export interface NavigateResult {
  success: boolean
  error?: string
}

/**
 * 坐标型动作（点击 / 输入）的返回契约。
 *
 * `true` —— 动作已成功派发（且在输入场景下已通过落值校验）；
 * `{ error }` —— 失败，并带**可直接展示给用户**的原因。
 *
 * 为什么不沿用 `boolean`：调用方（`CoordinateGradingPage`）只检查 `{ error }` 对象，
 * 于是失败时返回的 `false` 被静默忽略 —— 「分数没点中/没输进去」照样继续提交并
 * 记成 `completed`，造成静默错分。带上原因后，调用方必须显式处理。
 */
export type CoordinateActionResult = true | { error: string }

// ============ 浏览器服务类 ============

export class BrowserService {
  private logger: LogService
  private configService: ConfigService
  private adapterFactory: AdapterFactory
  private currentAdapter: PlatformAdapter | null = null
  private browser: any = null
  private context: any = null
  private page: any = null
  private isRunning: boolean = false
  // 截图操作锁，防止并发调用导致 page 状态冲突
  private screenshotLock: Promise<string | null> = Promise.resolve(null)

  constructor(logger: LogService, configService: ConfigService, adapterFactory?: AdapterFactory) {
    this.logger = logger
    this.configService = configService
    // 使用提供的 AdapterFactory 或获取默认实例
    this.adapterFactory = adapterFactory || getAdapterFactory(logger, configService)
  }

  // ============ 公共方法 ============

  /**
   * 启动浏览器
   * 使用用户系统安装的 Edge 浏览器，通过复制用户配置文件（Cookie、登录凭据等）
   * 到应用独立目录来避免与已运行 Edge 实例的冲突
   * @param headless - 是否无头模式（使用用户配置文件时强制为 false）
   * @returns 启动结果
   */
  async launch(headless: boolean = false): Promise<LaunchResult> {
    try {
      await ensureChromium()
      
      // 查找 Edge 可执行文件
      const edgePaths = this.getEdgePaths()
      const foundEdge = edgePaths.find(p => { try { return fs.existsSync(p) } catch { return false } })
      
      if (!foundEdge) {
        throw new Error('未找到 Microsoft Edge 浏览器，请先安装 Edge 后重试')
      }
      
      // 准备应用专用的 Edge 配置文件目录（从用户 Edge 复制关键文件）
      const userDataDir = this.ensureEdgeProfileCopy()
      
      // 清理可能的锁文件
      this.removeSingletonLocks(userDataDir)
      
      // 获取屏幕尺寸，设置自适应视口
      const primaryDisplay = screen.getPrimaryDisplay()
      const { width, height } = primaryDisplay.workAreaSize
      const viewportWidth = Math.min(Math.floor(width * VIEWPORT.SCALE_FACTOR), VIEWPORT.WIDTH_MAX)
      const viewportHeight = Math.min(Math.floor(height * VIEWPORT.SCALE_FACTOR), VIEWPORT.HEIGHT_MAX)
      
      this.logger.info(`屏幕尺寸: ${width}x${height}, 设置视口: ${viewportWidth}x${viewportHeight}`)
      this.logger.info(`使用配置文件目录: ${userDataDir}`)
      
      // 使用 launchPersistentContext 加载复制后的配置文件
      // 这样可以复用用户已保存的登录状态、Cookie、密码等数据
      // 同时不会与已运行的 Edge 产生文件锁冲突
      this.context = await chromium.launchPersistentContext(userDataDir, {
        headless: false,
        executablePath: foundEdge,
        args: [
          '--disable-blink-features=AutomationControlled',
          '--no-first-run',
          '--no-default-browser-check',
          '--disable-features=Translate,MediaRouter',
          '--restore-last-session=false',
          '--disable-extensions',
        ],
        viewport: { width: viewportWidth, height: viewportHeight },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        ignoreDefaultArgs: ['--enable-automation'],
      })
      
      // 获取或创建页面
      const pages = this.context.pages()
      this.page = pages.length > 0 ? pages[0] : await this.context.newPage()
      
      // 注册页面生命周期事件监听器
      this.registerPageEventListeners()
      
      // 隐藏自动化特征
      await this.page.evaluate(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
      })
      
      this.isRunning = true
      this.logger.info('Edge 浏览器启动成功（使用复制的用户配置文件，含已保存的登录状态）')
      
      return { success: true, method: 'edge' }
    } catch (error) {
      this.logger.error('浏览器启动失败', error as Error)
      return { success: false, error: describeLaunchError(error) }
    }
  }

  /**
   * 连接已有浏览器（通过 CDP 协议）
   * 当 Edge 已以调试模式运行时，可通过 CDP 连接
   * @returns 是否连接成功
   */
  async connect(): Promise<boolean> {
    try {
      await ensureChromium()
      
      // 尝试通过 CDP 连接已运行的 Edge（默认调试端口 9222）
      try {
        this.browser = await chromium.connectOverCDP('http://localhost:9222')
        const contexts = this.browser.contexts()
        this.context = contexts[0] || await this.browser.newContext()
        const pages = this.context.pages()
        this.page = pages[0] || await this.context.newPage()
        this.registerPageEventListeners()
        this.isRunning = true
        this.logger.info('已通过 CDP 连接到运行中的 Edge 浏览器')
        return true
      } catch (cdpError) {
        this.logger.warn('CDP 连接失败，请确保 Edge 以 --remote-debugging-port=9222 参数启动', { error: String(cdpError) })
        return false
      }
    } catch (error) {
      this.logger.error('浏览器连接失败', error as Error)
      return false
    }
  }

  /**
   * 导航到指定 URL
   * @param url - 目标 URL
   * @returns 导航结果
   */
  async navigate(url: string): Promise<NavigateResult> {
    const page = await this.ensureValidPage()
    if (!page) {
      return { success: false, error: '浏览器未启动' }
    }

    if (!isString(url)) {
      return { success: false, error: 'Invalid URL' }
    }

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: TIMEOUT.PAGE_NAVIGATION })
      
      // 重置适配器（页面已导航到新 URL）
      this.resetAdapter()
      
      this.logger.info(`导航成功: ${url}`)
      return { success: true }
    } catch (error) {
      this.logger.error('页面导航失败', error as Error, { url })
      return { success: false, error: (error as Error).message }
    }
  }

  /**
   * 获取当前 URL
   * @returns 当前页面 URL
   */
  getCurrentUrl(): string | null {
    if (!this.page) return null
    try {
      return this.page.url()
    } catch {
      // 页面可能已关闭
      this.logger.warn('获取当前 URL 失败: 页面可能已关闭')
      this.page = null
      return null
    }
  }

  /**
   * 分析页面（检测页面结构）
   * 使用适配器模式支持多平台
   * @returns 页面分析结果
   */
  async analyzePage(): Promise<PageAnalysisResult> {
    const page = await this.ensureValidPage()
    if (!page) {
      return { found: false, error: '浏览器未启动' }
    }

    try {
      // 获取或创建适配器
      const adapter = await this.ensureAdapter()
      
      if (!adapter) {
        return { 
          found: false, 
          error: '无法检测平台，请手动选择平台或检查页面 URL' 
        }
      }

      // 使用适配器分析页面
      const result = await adapter.analyzePage(page)
      
      this.logger.info(`页面分析完成，使用适配器: ${adapter.platformName}`, result)
      
      // 转换结果为 PageAnalysisResult 格式（保持向后兼容）
      const config = this.configService.getFullConfig()
      const platformDisplayName = config?.platforms[adapter.platformName]?.name || adapter.platformName || '批改平台'
      return {
        found: result.found,
        error: result.error,
        platformName: result.platformName,
        platformDisplayName,
        // 保留旧的字段以兼容现有代码
        isZhixue: result.platformName === 'zhixue',
        isOldUI: false,
        isNewUI: false,
        hasAnswerImage: result.hasAnswerImage,
        hasScoreInput: result.hasScoreInput,
        hasSubmitButton: result.hasSubmitButton,
        questionContent: result.questionContent,
        pageTitle: result.pageTitle,
      }
    } catch (error: any) {
      this.logger.error('分析页面失败', error)
      return { found: false, error: String(error) }
    }
  }

  /**
   * 捕获答案图片
   * 使用适配器模式支持多平台
   * @returns base64 编码的图片数据或 null
   */
  async captureAnswerImage(): Promise<string | null> {
    const page = await this.ensureValidPage()
    if (!page) {
      this.logger.error('captureAnswerImage 失败: 浏览器未连接')
      return null
    }

    try {
      // 获取或创建适配器
      const adapter = await this.ensureAdapter()
      
      if (!adapter) {
        this.logger.error('captureAnswerImage 失败: 无法获取适配器')
        return null
      }

      // 使用适配器捕获答案图片
      this.logger.info(`使用适配器 ${adapter.platformName} 捕获答案图片`)
      const result = await adapter.captureAnswerImage(page)
      
      return result
    } catch (error) {
      this.logger.error('捕获答案图片失败', error as Error)
      return null
    }
  }

  /**
   * 全页面截图
   * 截取当前页面的完整内容，用于坐标选区功能
   * 使用截图锁确保不会并发调用，避免页面状态冲突
   * @returns base64 编码的 PNG 图片数据或 null
   */
  async captureFullPage(): Promise<string | null> {
    // 使用锁机制串行化截图操作，防止并发导致页面状态冲突
    return this.withScreenshotLock(async () => {
      const page = await this.ensureValidPage()
      if (!page) {
        this.logger.error('captureFullPage 失败: 浏览器未连接')
        return null
      }

      try {
        this.logger.info('开始全页面截图')
        const screenshot = await page.screenshot({
          fullPage: true,
          type: 'png',
        })
        const base64 = Buffer.from(screenshot).toString('base64')
        this.logger.info(`全页面截图成功 (${(base64.length / 1024).toFixed(0)}KB)`)
        return `data:image/png;base64,${base64}`
      } catch (error) {
        this.logger.error('全页面截图失败', error as Error)
        // 截图失败后检查页面是否仍然有效
        try {
          page.url()
        } catch {
          this.logger.warn('截图失败后检测到页面已失效，清除引用')
          this.page = null
          this.resetAdapter()
        }
        return null
      }
    })
  }

  /**
   * 按坐标截取区域图片
   * 使用截图锁确保不会并发调用
   * @param x - 截取区域左上角 X 坐标
   * @param y - 截取区域左上角 Y 坐标
   * @param width - 截取区域宽度
   * @param height - 截取区域高度
   * @returns base64 编码的 PNG 图片数据或 null
   */
  async captureCoordinate(x: number, y: number, width: number, height: number): Promise<string | null> {
    return this.withScreenshotLock(async () => {
      const page = await this.ensureValidPage()
      if (!page) {
        this.logger.error('captureCoordinate 失败: 浏览器未连接')
        return null
      }

      if (!isNumber(x) || !isNumber(y) || !isNumber(width) || !isNumber(height)) {
        this.logger.error('captureCoordinate 失败: 坐标参数无效', undefined, { x, y, width, height })
        return null
      }

      if (width <= 0 || height <= 0) {
        this.logger.error('captureCoordinate 失败: 截取区域宽高必须大于 0', undefined, { width, height })
        return null
      }

      try {
        this.logger.info(`坐标截图: (${x}, ${y}) ${width}x${height}`)
        const screenshot = await page.screenshot({
          type: 'png',
          clip: { x, y, width, height },
        })
        const base64 = Buffer.from(screenshot).toString('base64')
        this.logger.info(`坐标截图成功 (${(base64.length / 1024).toFixed(0)}KB)`)
        return `data:image/png;base64,${base64}`
      } catch (error) {
        this.logger.error('坐标截图失败', error as Error, { x, y, width, height })
        // 截图失败后检查页面是否仍然有效
        try {
          page.url()
        } catch {
          this.logger.warn('截图失败后检测到页面已失效，清除引用')
          this.page = null
          this.resetAdapter()
        }
        return null
      }
    })
  }

  /**
   * 截图操作锁
   * 确保截图操作串行执行，防止并发调用导致 Playwright 内部状态冲突
   * 参考 local-grading-automation 项目的设计：每次截图都是独立的、可重复的操作
   */
  private async withScreenshotLock(fn: () => Promise<string | null>): Promise<string | null> {
    const previousLock = this.screenshotLock
    let resolveCurrent!: (value: string | null) => void
    this.screenshotLock = new Promise<string | null>((resolve) => {
      resolveCurrent = resolve
    })

    // 等待上一个截图操作完成
    await previousLock

    try {
      const result = await fn()
      return result
    } finally {
      resolveCurrent(null)
    }
  }

  /**
   * 点击指定坐标
   * @param x - X 坐标
   * @param y - Y 坐标
   * @returns 是否成功
   */
  // ============ 人类操作节奏控制 ============
  // 两次真实动作（点击/输入）之间的最小间隔，避免点击过快或连续触发两次
  private static readonly MIN_ACTION_GAP_MS = 500
  // 每次点击完成后的稳定等待，给页面响应时间
  private static readonly POST_CLICK_DELAY_MS = 300
  // 打字时逐字符延迟，模拟真人输入节奏
  private static readonly TYPE_CHAR_DELAY_MS = 60
  // 坐标命中测试时最多下钻多少层 iframe（防嵌套死循环，也防异常页面把栈打爆）
  private static readonly MAX_IFRAME_DEPTH = 5

  /** 上次动作的时间戳（clickAt / typeAt 共用） */
  private lastActionAt = 0

  /**
   * 人类节奏控制：距上次动作不足最小间隔时等待补足。
   * 防止连续点击过快导致重复触发（如双击提交、在下一份图像加载完成前就开始批改）。
   */
  private async enforceHumanPacing(): Promise<void> {
    if (this.lastActionAt > 0) {
      const gap = Date.now() - this.lastActionAt
      if (gap < BrowserService.MIN_ACTION_GAP_MS) {
        await new Promise((r) => setTimeout(r, BrowserService.MIN_ACTION_GAP_MS - gap))
      }
    }
  }

  private markAction(): void {
    this.lastActionAt = Date.now()
  }

  /**
   * 把「文档坐标」解析为「相对视口的坐标」，必要时先把目标滚动进视口。
   *
   * 为什么必须做这件事：选区截图用的是 `captureFullPage()`（`fullPage: true`，
   * 即**整个可滚动文档**），所以配置里存的 `scoreInput` / `submitButton`
   * 是**文档坐标**；而 Playwright 的 `page.mouse.click(x, y)` 接受的是
   * **相对浏览器视口**的 CSS 像素。不换算时，文档 y 一旦超过
   * 「滚动位置 + 视口高度」，点击就被派发到视口之外 —— Chromium **既不点击也不抛错**，
   * 表现为「分数没填进输入框，但程序认为成功」的静默失败。
   *
   * 主路径：在目标文档坐标处插一个 1px 探针元素，用 `scrollIntoView` 让它可见
   * （`scrollIntoView` 会自动找到**正确的滚动容器**，window 滚动与 SPA 内层
   * 可滚动祖先都能处理），再用 `getBoundingClientRect()` 读回相对视口的坐标。
   * 回退路径：探针不可用（如页面脚本受限）时，退化为「显式滚动 window + 按滚动偏移换算」。
   */
  private async resolveViewportPoint(
    page: any,
    docX: number,
    docY: number
  ): Promise<{ ok: true; x: number; y: number } | { ok: false; reason: string }> {
    if (!isNumber(docX) || !isNumber(docY)) {
      return { ok: false, reason: `坐标不是有效数值：(${docX}, ${docY})` }
    }

    // ---------- 主路径：探针 + scrollIntoView ----------
    try {
      const measured = await page.evaluate(
        ({ x, y }: { x: number; y: number }) => {
          const root = document.documentElement || document.body
          if (!root) return { ok: false as const, reason: '页面没有可用的根元素，无法定位坐标' }

          const probe = document.createElement('div')
          probe.setAttribute('data-grading-coordinate-probe', '1')
          const s = probe.style
          s.position = 'absolute'
          s.left = `${x}px`
          s.top = `${y}px`
          s.width = '1px'
          s.height = '1px'
          s.margin = '0'
          s.padding = '0'
          s.border = '0'
          s.opacity = '0'
          s.pointerEvents = 'none'
          root.appendChild(probe)

          try {
            // 自动滚动正确的滚动容器（window 或 SPA 内层可滚动祖先）
            probe.scrollIntoView({ block: 'center', inline: 'center' })
            const rect = probe.getBoundingClientRect()
            return {
              ok: true as const,
              x: rect.left,
              y: rect.top,
              viewportWidth: window.innerWidth,
              viewportHeight: window.innerHeight,
              scrollX: window.scrollX,
              scrollY: window.scrollY,
            }
          } finally {
            probe.remove()
          }
        },
        { x: docX, y: docY }
      )

      if (measured && measured.ok === true) {
        const point: ViewportPoint = { x: measured.x, y: measured.y }
        if (isPointInsideViewport(point, measured.viewportWidth, measured.viewportHeight)) {
          return { ok: true, x: point.x, y: point.y }
        }
        return {
          ok: false,
          reason: formatOutOfViewportReason({
            docX,
            docY,
            point,
            scrollX: measured.scrollX,
            scrollY: measured.scrollY,
            viewportWidth: measured.viewportWidth,
            viewportHeight: measured.viewportHeight,
          }),
        }
      }
      if (measured && measured.ok === false) {
        return { ok: false, reason: `坐标定位失败：${measured.reason}` }
      }
    } catch (error) {
      this.logger.warn('探针定位不可用，回退到滚动偏移换算', {
        docX,
        docY,
        error: String((error as any)?.message || error),
      })
    }

    // ---------- 回退路径：显式滚动 window 后按偏移换算 ----------
    try {
      // 只读页面度量（不做数学），把「滚动到哪里」交给共享纯函数计算，便于单测
      const metrics = await page.evaluate(() => {
        const docEl = document.documentElement
        return {
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
          scrollWidth: Math.max(docEl?.scrollWidth || 0, document.body?.scrollWidth || 0),
          scrollHeight: Math.max(docEl?.scrollHeight || 0, document.body?.scrollHeight || 0),
        }
      })

      const targetScrollY = computeScrollTarget(docY, metrics.viewportHeight, metrics.scrollHeight)

      const afterScroll = await page.evaluate(
        ({ top }: { top: number }) => {
          window.scrollTo(0, top)
          return { scrollX: window.scrollX, scrollY: window.scrollY }
        },
        { top: targetScrollY }
      )

      const point = documentToViewport(docX, docY, afterScroll.scrollX, afterScroll.scrollY)
      if (isPointInsideViewport(point, metrics.viewportWidth, metrics.viewportHeight)) {
        return { ok: true, x: point.x, y: point.y }
      }
      return {
        ok: false,
        reason: formatOutOfViewportReason({
          docX,
          docY,
          point,
          scrollX: afterScroll.scrollX,
          scrollY: afterScroll.scrollY,
          viewportWidth: metrics.viewportWidth,
          viewportHeight: metrics.viewportHeight,
        }),
      }
    } catch (error) {
      return {
        ok: false,
        reason: `坐标换算失败：${String((error as any)?.message || error)}`,
      }
    }
  }

  /**
   * 把「文档坐标」解析成**真正的 DOM 元素句柄**，必要时逐层下钻 iframe。
   *
   * ==========================================================================
   * 为什么必须有这一步（2026-09-17 修复「分数未写入输入框：焦点不在输入框上（iframe）」）
   * ==========================================================================
   * 智学网等批改平台的答题/给分区**嵌在 iframe 里**。`page.mouse.click(x, y)` 只能
   * 对**主框架视口**派发事件，点在 iframe 区域时命中的是 `<iframe>` 元素本身：
   *   - 输入框拿不到焦点；
   *   - `document.activeElement` 读回来是 `iframe`；
   *   - 于是 `keyboard.type()` 把分数打给了空气，落值校验报「焦点不在输入框上」。
   *
   * 解决办法：先用 `document.elementFromPoint` 做命中测试，若命中的是 `<iframe>`，
   * 就用 Playwright 的 `handle.contentFrame()` 下钻到子框架，并把坐标换算成子框架
   * 视口坐标后继续命中测试，直到拿到真正的目标元素。之后用**元素句柄**点击，
   * 由 Playwright 负责滚动与派发，跨 iframe 也能正确命中。
   */
  private async resolveElementAtDocumentPoint(
    page: any,
    docX: number,
    docY: number
  ): Promise<
    | {
        ok: true
        frame: any
        handle: any
        tag: string
        iframeDepth: number
        /** 主框架视口坐标（仅 iframeDepth === 0 时用于鼠标点击） */
        point: { x: number; y: number }
      }
    | { ok: false; reason: string }
  > {
    // 先滚动主文档并拿到视口坐标（沿用既有换算，含越界判定）
    const point = await this.resolveViewportPoint(page, docX, docY)
    if (!point.ok) return { ok: false, reason: point.reason }

    // 拿不到 mainFrame（如测试替身）时退化为直接操作 page —— Page 与 Frame 的
    // evaluate 签名一致，主框架场景下两者等价
    let frame: any = typeof page.mainFrame === 'function' ? page.mainFrame() : page
    let x = point.x
    let y = point.y
    let depth = 0

    for (;;) {
      let handle: any = null
      try {
        handle = (
          await frame.evaluateHandle(
            ({ x, y }: { x: number; y: number }) => document.elementFromPoint(x, y),
            { x, y }
          )
        ).asElement()
      } catch (error) {
        return { ok: false, reason: `坐标命中测试失败：${String((error as any)?.message || error)}` }
      }

      if (!handle) {
        return {
          ok: false,
          reason:
            `坐标 (${docX}, ${docY}) 处没有可点击元素（该位置可能在视口外或被遮挡），` +
            `请在「坐标配置」里重新框选后重试`,
        }
      }

      let tag = ''
      try {
        tag = String((await handle.evaluate((el: any) => el.tagName)) || '').toLowerCase()
      } catch {
        tag = ''
      }

      if (tag === 'iframe' && depth < BrowserService.MAX_IFRAME_DEPTH) {
        const box = await handle.boundingBox().catch(() => null)
        const childFrame = await handle.contentFrame().catch(() => null)
        if (box && childFrame) {
          // boundingBox 是相对**主框架视口**的，减去 iframe 左上角即为子框架视口坐标
          x = x - box.x
          y = y - box.y
          frame = childFrame
          depth++
          continue
        }
        this.logger.warn('命中 iframe 但无法下钻（跨域或已卸载），退回顶层点击')
      }

      return { ok: true, frame, handle, tag, iframeDepth: depth, point: { x: point.x, y: point.y } }
    }
  }

  /**
   * 点击已解析出的元素句柄。
   *
   * 先在 iframe 内按正常可操作性检查点击；若被遮挡/不够稳定（批改页常有悬浮层），
   * 退一步用 `force` 强制派发——总比什么都不做、让分数静默丢掉要好。
   */
  private async clickResolvedHandle(handle: any): Promise<void> {
    try {
      await handle.click({ timeout: TIMEOUT.ELEMENT_WAIT })
    } catch (error) {
      this.logger.warn('元素点击被拦截，改用 force 点击', {
        error: String((error as any)?.message || error),
      })
      await handle.click({ timeout: TIMEOUT.ELEMENT_WAIT, force: true })
    }
  }

  /**
   * 读回「当前焦点元素」快照，用于输入落值校验。
   *
   * @param frame - **必须传入实际接收输入的那个框架**。目标在 iframe 里时若仍从
   *   主框架读 `document.activeElement`，读回来的是 `<iframe>` 本身，会把
   *   「分数没打进去」误报成「焦点不在输入框上」，掩盖真实原因。
   */
  private async readFocusedElement(page: any, frame?: any): Promise<FocusedElementSnapshot | null> {
    try {
      return await (frame || page).evaluate(() => {
        const el = document.activeElement as (HTMLElement & {
          value?: string
          readOnly?: boolean
          disabled?: boolean
        }) | null
        if (!el) return null
        const tag = (el.tagName || '').toLowerCase()
        const isInputLike = tag === 'input' || tag === 'textarea'
        const isContentEditable = el.isContentEditable === true
        return {
          tagName: tag,
          value: isInputLike
            ? String(el.value ?? '')
            : isContentEditable
              ? String(el.textContent ?? '')
              : null,
          isContentEditable,
          readOnly: el.readOnly === true,
          isDisabled: el.disabled === true,
        }
      })
    } catch (error) {
      this.logger.warn('读取焦点元素失败', {
        error: String((error as any)?.message || error),
      })
      return null
    }
  }

  /**
   * 坐标点击。
   *
   * 返回契约：`true` = 点击已派发且坐标在视口内；`{ error }` = 失败并带**可诊断原因**
   * （此前失败只返回 `false`，而渲染层只检查 `{ error }` 对象，于是 `false` 被静默忽略——
   * 分数没点中却照样去提交并记 `completed`）。
   */
  async clickAt(x: number, y: number): Promise<CoordinateActionResult> {
    const page = await this.ensureValidPage()
    if (!page) return { error: '浏览器未启动或页面不可用，请先启动浏览器' }
    if (!isNumber(x) || !isNumber(y)) {
      return { error: `点击坐标不是有效数值：(${x}, ${y})` }
    }

    try {
      // 节奏控制：与上一次动作保持最小间隔，点击后等待页面响应
      await this.enforceHumanPacing()

      // 文档坐标 → 目标元素（必要时逐层下钻 iframe）
      const target = await this.resolveElementAtDocumentPoint(page, x, y)
      if (!target.ok) {
        this.logger.error(`点击失败：${target.reason}`, undefined, { x, y })
        return { error: target.reason }
      }

      if (target.iframeDepth > 0) {
        // 目标在 iframe 内：鼠标坐标只够点到 iframe 外壳，必须交给 Playwright
        // 用元素句柄点击（它会自动滚动并在正确的框架内派发事件）
        await this.clickResolvedHandle(target.handle)
      } else {
        // 主框架：沿用鼠标坐标点击（既有行为不变），用已换算好的视口坐标
        await page.mouse.click(target.point.x, target.point.y)
      }
      this.markAction()
      this.logger.info(
        `点击坐标: 文档(${x}, ${y}) → ${target.tag || '元素'}` +
          (target.iframeDepth > 0 ? `（iframe 第 ${target.iframeDepth} 层）` : '（主框架）')
      )
      await page.waitForTimeout(BrowserService.POST_CLICK_DELAY_MS)
      return true
    } catch (error) {
      this.logger.error('点击失败', error as Error, { x, y })
      return { error: `点击失败：${String((error as any)?.message || error)}` }
    }
  }

  /**
   * 在指定坐标输入文本。
   *
   * 相比旧实现补了三件事（顺序即执行顺序）：
   *  1. **文档坐标 → 视口坐标**：否则点击会落到视口外且不报错；
   *  2. **先清空**：旧实现直接 `keyboard.type()`，若框里已有 "0" 会拼成 "08"；
   *  3. **落值校验**：输入后回读焦点元素的值并比对，不一致就返回 `{ error }`，
   *     杜绝「没输进去却报成功」。
   *
   * @param x - X 坐标（**文档坐标**，与选区截图同一坐标系）
   * @param y - Y 坐标（**文档坐标**）
   * @param text - 要输入的文本
   */
  async typeAt(x: number, y: number, text: string): Promise<CoordinateActionResult> {
    const page = await this.ensureValidPage()
    if (!page) return { error: '浏览器未启动或页面不可用，请先启动浏览器' }
    if (!isNumber(x) || !isNumber(y)) {
      return { error: `输入坐标不是有效数值：(${x}, ${y})` }
    }
    if (!isString(text)) {
      return { error: '要输入的内容不是字符串' }
    }

    try {
      await this.enforceHumanPacing()

      // 文档坐标 → 目标元素（必要时逐层下钻 iframe）
      const target = await this.resolveElementAtDocumentPoint(page, x, y)
      if (!target.ok) {
        this.logger.error(`输入失败（坐标定位）：${target.reason}`, undefined, { x, y })
        return { error: target.reason }
      }

      if (target.iframeDepth > 0) {
        // 目标在 iframe 内：鼠标坐标点不到，用元素句柄点击以真正拿到焦点
        await this.clickResolvedHandle(target.handle)
      } else {
        // 主框架：沿用鼠标坐标点击（既有行为不变），用已换算好的视口坐标
        await page.mouse.click(target.point.x, target.point.y)
      }
      this.markAction()
      // 聚焦后稍候再输入，模拟真人操作
      await page.waitForTimeout(300)

      // 清空已有内容：防止与输入框里的原值拼接（如 "0" + "8" = "08"）
      await page.keyboard.press('Control+A')
      await page.keyboard.press('Backspace')

      await page.keyboard.type(text, { delay: BrowserService.TYPE_CHAR_DELAY_MS })

      // 落值校验：确认文本真的进了输入框（反静默失败的关键）。
      // 注意必须传 **target.frame**：目标在 iframe 里时从主框架读 activeElement
      // 只能读到 <iframe> 本身，会把真实原因掩盖掉。
      const snapshot = await this.readFocusedElement(page, target.frame)
      const verified = verifyTypedValue(snapshot, text)
      if (!verified.ok) {
        this.logger.error(`输入未生效：${verified.reason}`, undefined, {
          x,
          y,
          text,
          focused: snapshot?.tagName,
        })
        return { error: `分数未写入输入框：${verified.reason}` }
      }

      this.logger.info(
        `在坐标 文档(${x}, ${y}) → ${target.tag || '元素'}` +
          (target.iframeDepth > 0 ? `（iframe 第 ${target.iframeDepth} 层）` : '（主框架）') +
          ` 输入并校验通过: ${text.substring(0, 20)}`
      )
      return true
    } catch (error) {
      this.logger.error('输入失败', error as Error, { x, y, textLength: text.length })
      return { error: `输入失败：${String((error as any)?.message || error)}` }
    }
  }

  /**
   * 提交分数
   * 使用适配器模式支持多平台
   * @param score - 分数
   * @returns 是否成功
   */
  async submitScore(score: number): Promise<boolean> {
    const page = await this.ensureValidPage()
    if (!page) return false
    if (!isNumber(score)) return false

    try {
      // 获取或创建适配器
      const adapter = await this.ensureAdapter()
      
      if (!adapter) {
        this.logger.error('提交分数失败: 无法获取适配器')
        return false
      }

      // 使用适配器提交分数
      this.logger.info(`使用适配器 ${adapter.platformName} 提交分数: ${score}`)
      const result = await adapter.submitScore(page, score)
      
      return result
    } catch (error) {
      this.logger.error('提交分数失败', error as Error, { score })
      return false
    }
  }

  /**
   * 切换到下一题（三态）
   * 使用适配器模式支持多平台
   * - 'ok'   / 'last' 原样透传适配器结果
   * - 'error' 无页面 / 无法获取适配器 / 适配器抛异常（绝不允许映射为 'last'）
   * @returns NextPaperResult
   */
  async goToNext(): Promise<NextPaperResult> {
    const page = await this.ensureValidPage()
    if (!page) {
      this.logger.warn('切换到下一题失败: 浏览器未启动或页面不可用')
      return 'error'
    }

    try {
      // 获取或创建适配器
      const adapter = await this.ensureAdapter()
      
      if (!adapter) {
        this.logger.error('切换到下一题失败: 无法获取适配器')
        return 'error'
      }

      // 使用适配器切换到下一题
      this.logger.info(`使用适配器 ${adapter.platformName} 切换到下一题`)
      const result = await adapter.goToNext(page)
      
      // 重置适配器（页面可能已经导航到新 URL）
      this.resetAdapter()
      
      return result
    } catch (error) {
      // 关键修复（阻断-01）：切换异常绝不能被当成"没有更多试卷"，
      // 必须映射为 'error'，交由上层区分"正常结束('last')"与"出错('error')"。
      this.logger.error('切换下一道题失败', error as Error)
      return 'error'
    }
  }

  /**
   * 关闭浏览器
   * 使用 launchPersistentContext 时，关闭 context 即可关闭所有页面和浏览器进程
   */
  async close(): Promise<void> {
    this.isRunning = false
    this.resetAdapter()
    
    try {
      if (this.page) {
        try { await this.page.close() } catch { /* page 可能已关闭 */ }
      }
      if (this.context) {
        try { await this.context.close() } catch { /* context 可能已关闭 */ }
      }
      if (this.browser) {
        // browser 仅在 connectOverCDP 模式下存在
        try { await this.browser.close() } catch { /* browser 可能已关闭 */ }
      }
    } catch (e) {
      this.logger.warn('关闭浏览器时发生错误', { error: String(e) })
    }
    
    this.browser = null
    this.context = null
    this.page = null
    this.logger.info('浏览器已关闭')
  }

  /**
   * 检查浏览器健康状态
   * @returns 是否健康
   */
  async checkHealth(): Promise<boolean> {
    if (!this.context) return false
    const page = await this.ensureValidPage()
    if (!page) return false
    try {
      await page.evaluate(() => document.readyState)
      return true
    } catch {
      this.logger.warn('[健康检查] 浏览器连接已断开')
      return false
    }
  }

  /**
   * 获取浏览器状态
   */
  getStatus(): { isRunning: boolean; hasPage: boolean } {
    return {
      isRunning: this.isRunning,
      hasPage: !!this.page,
    }
  }

  /**
   * 设置当前平台（用于手动选择平台）
   * @param platform - 平台标识，传入 null 则清除手动选择
   */
  setPlatform(platform?: string): void {
    try {
      if (platform === undefined || platform === null) {
        // 清除手动选择，使用自动检测
        this.adapterFactory.setUserPreference(undefined)
        this.currentAdapter = null
        this.logger.info('清除手动平台选择，将使用自动检测')
      } else {
        // 手动选择平台
        this.adapterFactory.setUserPreference(platform)
        this.currentAdapter = this.adapterFactory.createAdapter(platform)
        this.logger.info(`手动选择平台: ${platform}`)
      }
    } catch (error) {
      this.logger.error('设置平台失败', error as Error, { platform })
    }
  }

  /**
   * 获取当前使用的适配器
   * @returns 当前适配器实例或 null
   */
  private async ensureAdapter(): Promise<PlatformAdapter | null> {
    // 如果已有当前适配器，直接返回
    if (this.currentAdapter) {
      return this.currentAdapter
    }

    // 确保页面有效
    const page = await this.ensureValidPage()
    if (!page) {
      this.logger.warn('无法获取适配器: 浏览器未启动')
      return null
    }

    try {
      // 自动检测并创建适配器
      const url = page.url()
      this.currentAdapter = this.adapterFactory.createAdapterByUrl(url)
      this.logger.info(`自动检测并创建适配器: ${(this.currentAdapter as any).platformName}`)
      return this.currentAdapter
    } catch (error) {
      // 自动检测失败，尝试使用通用适配器
      this.logger.warn('自动检测平台失败，尝试使用通用适配器', { error })
      
      try {
        this.currentAdapter = this.adapterFactory.createAdapter('generic')
        this.logger.info('使用通用适配器')
        return this.currentAdapter
      } catch (genericError) {
        this.logger.error('创建通用适配器失败', genericError as Error)
        return null
      }
    }
  }

  /**
   * 注册页面和上下文的生命周期事件监听器
   * 当用户关闭页面标签或浏览器窗口时，自动更新内部状态
   */
  private registerPageEventListeners(): void {
    if (!this.page) return

    // 页面被关闭时（用户关闭标签页等）
    this.page.on('close', () => {
      this.logger.info('页面已被关闭，清除 page 引用')
      this.page = null
      this.resetAdapter()
    })

    // 上下文被关闭时（浏览器窗口关闭等）
    if (this.context) {
      this.context.on('close', () => {
        this.logger.info('浏览器上下文已关闭，清除所有引用')
        this.page = null
        this.context = null
        this.isRunning = false
        this.resetAdapter()
      })
    }
  }

  /**
   * 确保当前页面有效
   * 如果 this.page 已失效（被关闭等），尝试从上下文获取新页面
   * @returns 有效的页面对象或 null
   */
  private async ensureValidPage(): Promise<any | null> {
    // 检查当前 page 是否仍然有效
    if (this.page) {
      try {
        // 尝试访问 page.url()，如果页面已关闭会抛出异常
        this.page.url()
        return this.page
      } catch {
        this.logger.warn('当前页面已失效，尝试获取新页面')
        this.page = null
        this.resetAdapter()
      }
    }

    // 尝试从上下文获取或创建新页面
    if (!this.context) {
      this.logger.error('浏览器上下文不可用，无法获取页面')
      return null
    }

    try {
      // 检查上下文是否仍然有效
      const pages = this.context.pages()
      if (pages.length > 0) {
        this.page = pages[0]
        this.logger.info('从上下文获取已有页面')
      } else {
        this.page = await this.context.newPage()
        this.logger.info('创建了新页面')
      }

      // 为新页面注册事件监听器
      if (this.page) {
        this.page.on('close', () => {
          this.logger.info('页面已被关闭，清除 page 引用')
          this.page = null
          this.resetAdapter()
        })
      }

      return this.page
    } catch (error) {
      this.logger.error('获取有效页面失败', error as Error)
      return null
    }
  }

  /**
   * 重置当前适配器（在页面导航后调用）
   */
  private resetAdapter(): void {
    this.currentAdapter = null
  }

  // ============ 私有方法 ============

  /**
   * 获取 Edge 浏览器路径
   */
  private getEdgePaths(): string[] {
    const paths: string[] = [
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    ]
    if (process.env.LOCALAPPDATA) paths.push(`${process.env.LOCALAPPDATA}\\Microsoft\\Edge\\Application\\msedge.exe`)
    if (process.env.PROGRAMFILES) paths.push(`${process.env.PROGRAMFILES}\\Microsoft\\Edge\\Application\\msedge.exe`)
    if (process.env['PROGRAMFILES(X86)']) paths.push(`${process.env['PROGRAMFILES(X86)']}\\Microsoft\\Edge\\Application\\msedge.exe`)
    return paths
  }

  /**
   * 获取用户 Edge 配置文件目录（原始 User Data 目录）
   * 该目录包含用户已保存的登录凭据、Cookie、书签、历史记录等
   */
  private getEdgeUserDataDir(): string {
    const localAppData = process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || 'C:\\Users\\Default', 'AppData', 'Local')
    return path.join(localAppData, 'Microsoft', 'Edge', 'User Data')
  }

  /**
   * 获取应用专用的 Edge 配置文件目录
   * 位于 app.getPath('userData') 下，与用户原始 Edge 目录隔离
   * 首次使用时从用户 Edge 复制关键配置文件，后续直接复用
   */
  private getAppEdgeProfileDir(): string {
    return path.join(app.getPath('userData'), 'edge-profile')
  }

  /**
   * 确保应用专用 Edge 配置文件目录已准备好
   * 首次使用时从用户 Edge 复制关键文件（Cookie、登录凭据等）
   * 后续直接复用已有目录（保留在应用中产生的登录状态）
   * @returns 应用专用配置文件目录路径
   */
  private ensureEdgeProfileCopy(): string {
    const appProfileDir = this.getAppEdgeProfileDir()
    
    // 检查是否已复制过（以 Local State 文件为标志）
    if (fs.existsSync(path.join(appProfileDir, 'Local State'))) {
      this.logger.info('复用已有应用配置文件目录')
      return appProfileDir
    }
    
    // 首次使用：从用户 Edge 复制关键配置文件
    const sourceDir = this.getEdgeUserDataDir()
    
    if (!fs.existsSync(sourceDir)) {
      this.logger.warn(`用户 Edge 配置目录不存在: ${sourceDir}，将使用空白配置`)
      // 目录不存在时直接返回空目录，launchPersistentContext 会自动创建
      fs.mkdirSync(appProfileDir, { recursive: true })
      return appProfileDir
    }
    
    this.logger.info('首次使用，正在从 Edge 复制配置文件...')
    this.copyEdgeProfile(sourceDir, appProfileDir)
    
    return appProfileDir
  }

  /**
   * 从用户 Edge 目录复制关键配置文件到应用目录
   * 只复制登录状态相关的文件，避免复制整个目录（可能数 GB）
   * @param sourceDir - 用户 Edge 的 User Data 目录
   * @param targetDir - 应用专用配置文件目录
   */
  private copyEdgeProfile(sourceDir: string, targetDir: string): void {
    // 创建目标目录
    fs.mkdirSync(targetDir, { recursive: true })
    
    // 1. 复制根目录文件
    // Local State: 包含加密密钥，用于解密 Cookie 和密码
    const rootFiles = ['Local State']
    for (const file of rootFiles) {
      const src = path.join(sourceDir, file)
      const dst = path.join(targetDir, file)
      if (fs.existsSync(src)) {
        try {
          fs.copyFileSync(src, dst)
          this.logger.info(`已复制: ${file}`)
        } catch (e) {
          this.logger.warn(`复制失败: ${file}`, { error: String(e) })
        }
      }
    }
    
    // 2. 复制 Default 配置文件目录下的关键文件
    const defaultSrcDir = path.join(sourceDir, 'Default')
    const defaultDstDir = path.join(targetDir, 'Default')
    
    if (!fs.existsSync(defaultSrcDir)) {
      this.logger.warn('Edge Default 配置文件目录不存在，跳过配置复制')
      return
    }
    
    fs.mkdirSync(defaultDstDir, { recursive: true })
    
    // 需要复制的关键文件列表
    const profileFiles = [
      'Cookies',              // 会话 Cookie（登录状态）
      'Login Data',           // 保存的密码
      'Login Data For Account', // 账户密码
      'Preferences',          // 浏览器偏好设置
      'Secure Preferences',   // 安全偏好设置
      'Web Data',             // 表单数据、自动填充
      'Bookmarks',            // 书签
      'History',              // 历史记录
      'Favicons',             // 网站图标缓存
      'Top Sites',            // 常用网站
      'Network/Cookies',      // 网络层 Cookie（部分版本）
    ]
    
    let copiedCount = 0
    for (const file of profileFiles) {
      const src = path.join(defaultSrcDir, file)
      const dst = path.join(defaultDstDir, file)
      
      if (fs.existsSync(src)) {
        try {
          // 确保目标子目录存在（如 Network/Cookies）
          const dstDir = path.dirname(dst)
          if (!fs.existsSync(dstDir)) {
            fs.mkdirSync(dstDir, { recursive: true })
          }
          fs.copyFileSync(src, dst)
          copiedCount++
        } catch (e) {
          // 部分文件可能被 Edge 锁定，跳过即可
          this.logger.warn(`复制失败（可能被占用）: ${file}`, { error: String(e) })
        }
      }
    }
    
    this.logger.info(`配置文件复制完成，共复制 ${copiedCount} 个文件`)
    
    // 3. 检查是否有非 Default 的配置文件（如 Profile 1, Profile 2）
    const profiles = fs.readdirSync(sourceDir).filter(
      name => name.startsWith('Profile ') && fs.statSync(path.join(sourceDir, name)).isDirectory()
    )
    
    for (const profileDir of profiles) {
      const srcDir = path.join(sourceDir, profileDir)
      const dstDir = path.join(targetDir, profileDir)
      fs.mkdirSync(dstDir, { recursive: true })
      
      for (const file of profileFiles) {
        const src = path.join(srcDir, file)
        const dst = path.join(dstDir, file)
        if (fs.existsSync(src)) {
          try {
            const dDir = path.dirname(dst)
            if (!fs.existsSync(dDir)) fs.mkdirSync(dDir, { recursive: true })
            fs.copyFileSync(src, dst)
          } catch {
            // 忽略被锁定的文件
          }
        }
      }
    }
  }

  /**
   * 重新从用户 Edge 同步配置文件
   * 用户可以在 Edge 中重新登录后，调用此方法刷新应用内的登录状态
   * 注意：这会覆盖应用内已有的配置文件
   */
  syncFromEdge(): { success: boolean; message: string } {
    try {
      const sourceDir = this.getEdgeUserDataDir()
      const targetDir = this.getAppEdgeProfileDir()
      
      if (!fs.existsSync(sourceDir)) {
        return { success: false, message: '未找到 Edge 用户数据目录' }
      }
      
      // 清空旧的应用配置目录
      if (fs.existsSync(targetDir)) {
        this.removeDirectory(targetDir)
      }
      
      // 重新复制
      this.copyEdgeProfile(sourceDir, targetDir)
      
      this.logger.info('已从 Edge 重新同步配置文件')
      return { success: true, message: '配置文件已从 Edge 同步' }
    } catch (error) {
      this.logger.error('同步 Edge 配置失败', error as Error)
      return { success: false, message: `同步失败: ${(error as Error).message}` }
    }
  }

  /**
   * 递归删除目录
   */
  private removeDirectory(dir: string): void {
    if (!fs.existsSync(dir)) return
    const entries = fs.readdirSync(dir)
    for (const entry of entries) {
      const fullPath = path.join(dir, entry)
      if (fs.statSync(fullPath).isDirectory()) {
        this.removeDirectory(fullPath)
      } else {
        try { fs.unlinkSync(fullPath) } catch { /* 忽略 */ }
      }
    }
    try { fs.rmdirSync(dir) } catch { /* 忽略 */ }
  }

  /**
   * 清理 SingletonLock 等锁文件
   * 浏览器进程会在配置文件目录创建锁文件，防止多实例冲突
   */
  private removeSingletonLocks(userDataDir: string): void {
    const lockFiles = ['SingletonLock', 'SingletonCookie', 'SingletonSocket']
    for (const lockFile of lockFiles) {
      const lockPath = path.join(userDataDir, lockFile)
      try {
        if (fs.existsSync(lockPath)) {
          fs.unlinkSync(lockPath)
          this.logger.info(`已清理锁文件: ${lockFile}`)
        }
      } catch (error) {
        this.logger.warn(`清理锁文件失败: ${lockFile}`, { error: String(error) })
      }
    }
  }

  /**
   * 获取图片并转为 base64
   */
  private async fetchImageAsBase64(imageUrl: string): Promise<string | null> {
    try {
      if (imageUrl.startsWith('data:')) {
        return imageUrl
      }

      const axios = require('axios')
      const response = await axios.get(imageUrl, {
        responseType: 'arraybuffer',
        timeout: TIMEOUT.OCR_RECOGNIZE,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      })

      const contentType = response.headers['content-type'] || 'image/png'
      const base64 = Buffer.from(response.data, 'binary').toString('base64')
      return `data:${contentType};base64,${base64}`
    } catch (error) {
      this.logger.error('获取图片失败', error as Error)
      return null
    }
  }
}

// ============ 默认浏览器服务实例 ============

let defaultBrowserService: BrowserService | null = null

/**
 * 获取默认浏览器服务实例（单例）
 * @param logger - 日志服务实例（首次调用时必须提供）
 * @param configService - 配置服务实例（首次调用时必须提供）
 * @param adapterFactory - 适配器工厂实例（可选，会使用单例）
 */
export function getBrowserService(
  logger?: LogService,
  configService?: ConfigService,
  adapterFactory?: AdapterFactory
): BrowserService {
  if (!defaultBrowserService) {
    if (!logger || !configService) {
      throw new Error('首次获取 BrowserService 必须提供 logger 和 configService')
    }
    defaultBrowserService = new BrowserService(logger, configService, adapterFactory)
  }
  return defaultBrowserService
}

/**
 * 创建新的浏览器服务实例
 * @param logger - 日志服务实例
 * @param configService - 配置服务实例
 * @param adapterFactory - 适配器工厂实例（可选，会使用单例）
 */
export function createBrowserService(
  logger: LogService,
  configService: ConfigService,
  adapterFactory?: AdapterFactory
): BrowserService {
  return new BrowserService(logger, configService, adapterFactory)
}

// ============ 导出 ============

export default BrowserService
