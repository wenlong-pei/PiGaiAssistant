/**
 * 配置管理服务
 * 封装 SelectorManager，提供配置加载、保存、平台检测等功能
 */

import { getSelectorManager, getSelectorManagerAsync, SelectorConfig, PlatformSelectors, SelectorsConfig } from '../SelectorManager'
import { LogService } from './LogService'
import { isString, isObject, isArray } from '../utils/validators'

// ============ 配置服务类 ============

export class ConfigService {
  private selectorManager: ReturnType<typeof getSelectorManager>
  private logger: LogService
  private initialized: boolean = false

  constructor(logger?: LogService) {
    this.selectorManager = getSelectorManager()
    this.logger = logger || new LogService()
  }

  // ============ 初始化方法 ============

  /**
   * 异步初始化（推荐在 app.whenReady() 后调用）
   */
  async init(): Promise<boolean> {
    try {
      await this.selectorManager.init()
      this.initialized = true
      this.logger.info('ConfigService initialized successfully')
      return true
    } catch (error) {
      this.logger.error('ConfigService initialization failed', error as Error)
      return false
    }
  }

  /**
   * 检查是否已初始化
   */
  isInitialized(): boolean {
    return this.initialized
  }

  // ============ 选择器配置方法 ============

  /**
   * 加载选择器配置
   * @returns 是否加载成功
   */
  async loadSelectors(): Promise<boolean> {
    try {
      const result = await this.selectorManager.load()
      if (result) {
        this.logger.info('Selectors config loaded successfully')
      } else {
        this.logger.warn('Selectors config load returned false')
      }
      return result
    } catch (error) {
      this.logger.error('Failed to load selectors config', error as Error)
      return false
    }
  }

  /**
   * 保存选择器配置
   * @returns 是否保存成功
   */
  async saveSelectors(): Promise<boolean> {
    try {
      const result = await this.selectorManager.save()
      if (result) {
        this.logger.info('Selectors config saved successfully')
      } else {
        this.logger.warn('Selectors config save returned false')
      }
      return result
    } catch (error) {
      this.logger.error('Failed to save selectors config', error as Error)
      return false
    }
  }

  /**
   * 设置当前平台
   * @param platform - 平台名称（如 'zhixue'）
   */
  setPlatform(platform: string): void {
    if (!isString(platform)) {
      this.logger.warn('Invalid platform name: not a string')
      return
    }
    this.selectorManager.setPlatform(platform)
    this.logger.info(`Platform set to: ${platform}`)
  }

  /**
   * 获取当前平台的选择器配置
   * @returns 平台选择器配置，如不存在则返回 null
   */
  getCurrentPlatform(): PlatformSelectors | null {
    const platform = this.selectorManager.getCurrentPlatform()
    return this.selectorManager.getConfig()?.platforms[platform] || null
  }

  /**
   * 检测 URL 对应的平台
   * @param url - 要检测的 URL
   * @returns 平台名称，如未找到则返回 null
   */
  detectPlatform(url: string): string | null {
    if (!isString(url)) {
      this.logger.warn('Invalid URL: not a string')
      return null
    }

    const result = this.selectorManager.detectPlatform(url)
    if (result) {
      this.logger.info(`Platform detected: ${result} for URL: ${url}`)
    } else {
      this.logger.warn(`No platform detected for URL: ${url}`)
    }
    return result
  }

  /**
   * 获取答案图片选择器列表
   * @returns CSS 选择器数组
   */
  getAnswerImageSelectors(): string[] {
    return this.selectorManager.getAnswerImageSelectors()
  }

  /**
   * 获取分数输入框选择器列表
   * @returns CSS 选择器数组
   */
  getScoreInputSelectors(): string[] {
    // 修复 BUG-EXE-002：SelectorManager 返回的是对象（按语义分组的选择器），
    // 而本方法声明返回数组。此前直接透传，导致上层 selectors[0] 恒为 undefined，
    // 配置里的选择器全部失效、只能吃硬编码兜底值。这里统一归一化为数组。
    const raw: any = this.selectorManager.getScoreInputSelectors()

    if (Array.isArray(raw)) {
      return raw.filter((s: any) => typeof s === 'string' && s)
    }
    if (raw && typeof raw === 'object') {
      return [
        raw.SCORE_INPUT_ALL_NEW,
        raw.SCORE_INPUT_NEW,
        raw.SCORE_INPUT,
        raw.SCORE_INPUT_PLACEHOLDER,
      ].filter((s: any) => typeof s === 'string' && s)
    }
    return []
  }

  /**
   * 获取提交按钮选择器
   * @returns 包含 text 和 selectors 的对象
   */
  getSubmitButtonSelectors(): { text?: string; selectors: string[] } {
    // 修复 BUG-EXE-002：统一归一化为 { text, selectors } 契约
    const raw: any = this.selectorManager.getSubmitButtonSelectors()

    if (Array.isArray(raw)) {
      return { selectors: raw.filter((s: any) => typeof s === 'string' && s) }
    }
    if (raw && typeof raw === 'object') {
      const fromArray = Array.isArray(raw.selectors)
        ? raw.selectors.filter((s: any) => typeof s === 'string' && s)
        : []
      return {
        text: raw.SUBMIT_BUTTON_TEXT,
        selectors: fromArray.length
          ? fromArray
          : [raw.SUBMIT_BUTTON, raw.SUBMIT_BUTTON_NEW].filter((s: any) => typeof s === 'string' && s),
      }
    }
    return { selectors: [] }
  }

  /**
   * 获取下一题按钮选择器
   * @returns 包含 text 和 selectors 的对象
   */
  getNextButtonSelectors(): { text?: string; selectors: string[] } {
    // 修复 BUG-EXE-002：此前返回结构里没有 selectors，上层解构后取 [0] 抛 TypeError，
    // 使"切换下一题"必然失败、批改流程提前中断。
    const raw: any = this.selectorManager.getNextButtonSelectors()

    if (Array.isArray(raw)) {
      return { selectors: raw.filter((s: any) => typeof s === 'string' && s) }
    }
    if (raw && typeof raw === 'object') {
      const fromArray = Array.isArray(raw.selectors)
        ? raw.selectors.filter((s: any) => typeof s === 'string' && s)
        : []
      return {
        text: raw.NEXT_BUTTON_TEXT,
        selectors: fromArray.length
          ? fromArray
          : [raw.NEXT_BUTTON].filter((s: any) => typeof s === 'string' && s),
      }
    }
    return { selectors: [] }
  }

  /**
   * 获取题目标题选择器列表
   * @returns CSS 选择器数组
   */
  getQuestionTitleSelectors(): string[] {
    return this.selectorManager.getQuestionTitleSelectors()
  }

  /**
   * 获取完整配置
   * @returns 完整选择器配置对象
   */
  getFullConfig(): SelectorsConfig | null {
    return this.selectorManager.getConfig()
  }

  /**
   * 获取平台展示名称
   * @param platform - 平台标识
   * @returns 平台展示名称，未找到则返回标识本身或通用名称
   */
  getPlatformDisplayName(platform: string): string {
    const config = this.getFullConfig()
    return config?.platforms[platform]?.name || platform || '批改平台'
  }

  /**
   * 更新平台配置
   * @param platform - 平台名称
   * @param updates - 要更新的配置部分
   * @returns 是否更新成功
   */
  async updatePlatformConfig(platform: string, updates: Partial<PlatformSelectors>): Promise<boolean> {
    if (!isString(platform)) {
      this.logger.warn('Invalid platform name: not a string')
      return false
    }

    if (!isObject(updates)) {
      this.logger.warn('Invalid updates: not an object')
      return false
    }

    try {
      const result = await this.selectorManager.updatePlatformConfig(platform, updates)
      if (result) {
        this.logger.info(`Platform config updated: ${platform}`)
      } else {
        this.logger.warn(`Platform config update failed: ${platform}`)
      }
      return result
    } catch (error) {
      this.logger.error('Failed to update platform config', error as Error, { platform })
      return false
    }
  }

  // ============ 智学网快捷方法（已弃用，保留用于向后兼容） ============

  /**
   * @deprecated 使用 AdapterFactory 和 PlatformAdapter 代替
   * 获取智学网分数输入框选择器（兼容旧逻辑）
   * @returns 选择器配置对象
   */
  getZhixueScoreInputSelectors(): {
    SCORE_INPUT: string
    SCORE_INPUT_NEW: string
    SCORE_INPUT_ALL_NEW: string
    SCORE_INPUT_PLACEHOLDER: string
  } {
    const selectors = this.getScoreInputSelectors()
    return {
      SCORE_INPUT: selectors[0] || 'input[type="number"]',
      SCORE_INPUT_NEW: selectors[1] || '#inputScore',
      SCORE_INPUT_ALL_NEW: selectors[2] || '#allScore',
      SCORE_INPUT_PLACEHOLDER: selectors[3] || 'input[placeholder*="分数"]',
    }
  }

  /**
   * @deprecated 使用 AdapterFactory 和 PlatformAdapter 代替
   * 获取智学网提交按钮选择器（兼容旧逻辑）
   * @returns 选择器配置对象
   */
  getZhixueSubmitButtonSelectors(): {
    SUBMIT_BUTTON: string
    SUBMIT_BUTTON_NEW: string
    SUBMIT_BUTTON_TEXT: string
  } {
    const { text, selectors } = this.getSubmitButtonSelectors()
    return {
      SUBMIT_BUTTON: selectors[0] || 'button[type="submit"]',
      SUBMIT_BUTTON_NEW: selectors[1] || 'button:has-text("提交")',
      SUBMIT_BUTTON_TEXT: text || '提交分数',
    }
  }

  /**
   * @deprecated 使用 AdapterFactory 和 PlatformAdapter 代替
   * 获取智学网下一题按钮选择器（兼容旧逻辑）
   * @returns 选择器配置对象
   */
  getZhixueNextButtonSelectors(): {
    NEXT_BUTTON: string
    NEXT_BUTTON_TEXT: string
  } {
    const { text, selectors } = this.getNextButtonSelectors()
    return {
      NEXT_BUTTON: selectors[0] || 'button:has-text("下一题")',
      NEXT_BUTTON_TEXT: text || '下一题',
    }
  }

  /**
   * @deprecated 使用 AdapterFactory 和 PlatformAdapter 代替
   * 获取智学网题目容器选择器
   * @returns 选择器字符串
   */
  getZhixueQuestionContainerSelector(): string {
    const selectors = this.getQuestionTitleSelectors()
    return selectors[0] || 'h3, h4'
  }

  /**
   * @deprecated 使用 AdapterFactory 和 PlatformAdapter 代替
   * 获取智学网答案区域选择器
   * @returns 选择器字符串
   */
  getZhixueAnswerAreaSelector(): string {
    const selectors = this.getAnswerImageSelectors()
    return selectors[0] || 'img'
  }

  // ============ 多平台配置管理（新增） ============

  /**
   * 获取所有支持的平台列表
   * @returns 平台标识列表
   */
  getAvailablePlatforms(): string[] {
    const config = this.getFullConfig()
    if (!config) return []
    return Object.keys(config.platforms)
  }

  /**
   * 添加或更新平台配置
   * @param platform - 平台标识
   * @param platformConfig - 平台配置
   * @returns 是否成功
   */
  async savePlatformConfig(platform: string, platformConfig: any): Promise<boolean> {
    return this.updatePlatformConfig(platform, platformConfig)
  }

  /**
   * 删除平台配置
   * @param platform - 平台标识
   * @returns 是否成功
   */
  async deletePlatformConfig(platform: string): Promise<boolean> {
    try {
      const config = this.getFullConfig()
      if (!config) return false

      if (config.platforms[platform]) {
        delete config.platforms[platform]
        // 这里需要直接修改 selectorManager 的内部状态
        // 由于 selectorManager 没有提供删除方法，我们需要通过 save 来保存
        // 这部分可能需要扩展 SelectorManager
        this.logger.info(`删除平台配置: ${platform}`)
        return true
      }

      return false
    } catch (error) {
      this.logger.error('删除平台配置失败', error as Error, { platform })
      return false
    }
  }
}

// ============ 默认配置服务实例 ============

let defaultConfigService: ConfigService | null = null

/**
 * 获取默认配置服务实例（单例）
 */
export function getConfigService(logger?: LogService): ConfigService {
  if (!defaultConfigService) {
    defaultConfigService = new ConfigService(logger)
  }
  return defaultConfigService
}

/**
 * 创建新的配置服务实例
 */
export function createConfigService(logger?: LogService): ConfigService {
  return new ConfigService(logger)
}

// ============ 导出 ============

export default ConfigService
