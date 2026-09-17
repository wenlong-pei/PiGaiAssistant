/**
 * DOM 选择器管理器
 * 负责管理多平台的 DOM 选择器配置
 */

import * as fs from 'fs'
import * as fsp from 'fs/promises'
import * as path from 'path'
import { app } from 'electron'

export interface SelectorConfig {
  description?: string
  legacy?: string
  modern?: string
  fallback?: string[]
  placeholder?: string
  text?: string
  selectors?: string[]
  allModern?: string
}

export interface PlatformSelectors {
  name: string
  domains: string[]
  selectors: {
    answerImages: SelectorConfig
    scoreInput: SelectorConfig
    submitButton: SelectorConfig
    nextButton: SelectorConfig
    questionTitle: SelectorConfig
  }
}

export interface SelectorsConfig {
  name: string
  version: string
  description?: string
  platforms: {
    [key: string]: PlatformSelectors
  }
  metadata?: {
    lastUpdated?: string
    author?: string
    usage?: string
  }
}

class SelectorManager {
  private config: SelectorsConfig | null = null
  private currentPlatform: string = 'zhixue' // 默认平台

  constructor() {
    this.loadDefaultConfig()
  }

  /**
   * 加载默认配置
   */
  private loadDefaultConfig(): void {
    try {
      const defaultConfig: SelectorsConfig = {
        name: 'Default Selectors',
        version: '1.0.0',
        platforms: {
          zhixue: {
            name: '智学网',
            domains: ['zhixue.com', 'zhixueyun.com'],
            selectors: {
              answerImages: {
                description: '答案图片选择器',
                legacy: '.answer-image img',
                modern: '.question-image img',
                fallback: ['img[src*="answer"]', 'img[alt*="答案"]'],
              },
              scoreInput: {
                description: '分数输入框选择器',
                legacy: 'input[type="number"]',
                modern: 'input.score-input',
                placeholder: '请输入分数',
                fallback: ['input[name*="score"]', 'input[id*="score"]'],
              },
              submitButton: {
                description: '提交按钮选择器',
                text: '提交',
                selectors: ['button.submit', 'button[type="submit"]', '.submit-btn'],
              },
              nextButton: {
                description: '下一题按钮选择器',
                text: '下一题',
                selectors: ['button.next', '.next-btn', '.btn-next'],
              },
              questionTitle: {
                description: '题目标题选择器',
                selectors: ['.question-title', '.topic-title', 'h3', 'h4'],
              },
            },
          },
          generic: {
            name: '通用平台',
            domains: ['*'],
            selectors: {
              answerImages: {
                description: '答案图片选择器（通用）',
                fallback: ['img.answer', 'img[src*="answer"]', '.answer-image img', 'img[alt*="答案"]'],
              },
              scoreInput: {
                description: '分数输入框选择器（通用）',
                fallback: ['input[type="number"]', 'input[placeholder*="分数"]', '.score-input input'],
              },
              submitButton: {
                description: '提交按钮选择器（通用）',
                text: '提交',
                selectors: ['button.submit', 'button[type="submit"]', '.submit-btn'],
              },
              nextButton: {
                description: '下一题按钮选择器（通用）',
                text: '下一题',
                selectors: ['button.next', '.next-btn', '.btn-next'],
              },
              questionTitle: {
                description: '题目标题选择器（通用）',
                selectors: ['.question-title', '.topic-title', 'h3', 'h4'],
              },
            },
          },
        },
      }

      this.config = defaultConfig
      this.log('默认选择器配置已加载')
    } catch (error) {
      console.error('[SelectorManager] 加载默认配置失败:', error)
    }
  }

  /**
   * 异步初始化
   */
  async init(): Promise<boolean> {
    try {
      // 尝试从配置文件加载
      await this.load()
      return true
    } catch (error) {
      console.error('[SelectorManager] 初始化失败:', error)
      return false
    }
  }

  /**
   * 加载选择器配置（从配置文件）
   */
  async load(): Promise<boolean> {
    try {
      const configPath = this.getConfigPath()
      if (!fs.existsSync(configPath)) {
        this.log('配置文件不存在，使用默认配置')
        return true
      }

      const data = await fsp.readFile(configPath, 'utf-8')
      const config = JSON.parse(data) as SelectorsConfig
      this.config = config
      this.log(`配置已从文件加载: ${configPath}`)
      return true
    } catch (error) {
      console.error('[SelectorManager] 加载配置失败:', error)
      return false
    }
  }

  /**
   * 保存选择器配置（到配置文件）
   */
  async save(): Promise<boolean> {
    try {
      const configPath = this.getConfigPath()
      const dir = path.dirname(configPath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }

      await fsp.writeFile(configPath, JSON.stringify(this.config, null, 2), 'utf-8')
      this.log(`配置已保存到文件: ${configPath}`)
      return true
    } catch (error) {
      console.error('[SelectorManager] 保存配置失败:', error)
      return false
    }
  }

  /**
   * 获取配置文件路径
   */
  private getConfigPath(): string {
    const userDataPath = app.getPath('userData')
    return path.join(userDataPath, 'selectors.json')
  }

  /**
   * 获取当前平台的答案图片选择器
   */
  getAnswerImageSelectors(): string[] {
    const platform = this.config?.platforms[this.currentPlatform]
    if (!platform) return []

    const config = platform.selectors.answerImages
    return [config.legacy, config.modern, ...(config.fallback || [])].filter(Boolean) as string[]
  }

  /**
   * 获取当前平台的分数输入框选择器
   */
  getScoreInputSelectors(): any {
    const platform = this.config?.platforms[this.currentPlatform]
    if (!platform) return {}

    const config: any = platform.selectors.scoreInput || {}
    return {
      SCORE_INPUT: config.legacy,
      SCORE_INPUT_NEW: config.modern,
      SCORE_INPUT_PLACEHOLDER: config.placeholder ? `[placeholder*="${config.placeholder}"]` : '',
      // 修复 BUG-EXE-002：配置里"全部分数框"用的是 allModern 字段，此前误用 modern，
      // 导致 #txt_marking_all 这类选择器从未生效。
      SCORE_INPUT_ALL_NEW: config.allModern || config.modern,
      SCORE_INPUT_TEXT: config.text,
    }
  }

  /**
   * 获取当前平台的提交按钮选择器
   */
  getSubmitButtonSelectors(): any {
    const platform = this.config?.platforms[this.currentPlatform]
    if (!platform) return {}

    // 修复 BUG-EXE-002：配置结构是 { modern, fallback[] }，此前读的是不存在的
    // config.selectors，导致提交按钮选择器恒为空串、配置完全失效。
    const config: any = platform.selectors.submitButton || {}
    const selectors = [
      config.modern,
      ...(Array.isArray(config.fallback) ? config.fallback : []),
      ...(Array.isArray(config.selectors) ? config.selectors : []),
    ].filter((x: any) => typeof x === 'string' && x.trim())

    return {
      SUBMIT_BUTTON: selectors[0] || '',
      SUBMIT_BUTTON_NEW: selectors[0] || '',
      SUBMIT_BUTTON_TEXT: config.text || '提交',
      selectors,
    }
  }

  /**
   * 获取当前平台的下一题按钮选择器
   */
  getNextButtonSelectors(): any {
    const platform = this.config?.platforms[this.currentPlatform]
    if (!platform) return {}

    // 修复 BUG-EXE-002：此前只返回 text、没有选择器数组，
    // 上层 ConfigService 解构 selectors 后取 [0] 会抛 TypeError，导致"切换下一题"必然失败。
    const config: any = platform.selectors.nextButton || {}
    const selectors = [
      config.modern,
      ...(Array.isArray(config.fallback) ? config.fallback : []),
      ...(Array.isArray(config.selectors) ? config.selectors : []),
    ].filter((x: any) => typeof x === 'string' && x.trim())

    return {
      NEXT_BUTTON: selectors[0] || '',
      NEXT_BUTTON_TEXT: config.text || '下一题',
      selectors,
    }
  }

  /**
   * 获取题目标题选择器列表
   */
  getQuestionTitleSelectors(): string[] {
    const platform = this.config?.platforms[this.currentPlatform]
    if (!platform) return []

    const config = platform.selectors.questionTitle
    return config.selectors || []
  }

  /**
   * 设置当前平台
   */
  setCurrentPlatform(platform: string): void {
    if (this.config?.platforms[platform]) {
      this.currentPlatform = platform
      this.log(`切换到平台: ${platform}`)
    } else {
      this.log(`未知平台: ${platform}，保持当前平台: ${this.currentPlatform}`)
    }
  }

  /**
   * 设置当前平台（别名：setPlatform）
   */
  setPlatform(platform: string): void {
    this.setCurrentPlatform(platform)
  }

  /**
   * 获取当前平台
   */
  getCurrentPlatform(): string {
    return this.currentPlatform
  }

  /**
   * 检测 URL 对应的平台
   * @param url - 要检测的 URL
   * @returns 平台名称，如未找到则返回 null
   */
  detectPlatform(url: string): string | null {
    if (!this.config) return null

    for (const [platform, config] of Object.entries(this.config.platforms)) {
      for (const domain of config.domains) {
        if (domain === '*') return platform
        if (url.includes(domain)) return platform
      }
    }

    return null
  }

  /**
   * 获取完整配置
   */
  getConfig(): SelectorsConfig | null {
    return this.config
  }

  /**
   * 更新平台配置
   */
  async updatePlatformConfig(platform: string, updates: Partial<PlatformSelectors>): Promise<boolean> {
    try {
      if (!this.config?.platforms[platform]) {
        throw new Error(`平台不存在: ${platform}`)
      }

      // 合并更新
      this.config.platforms[platform] = {
        ...this.config.platforms[platform],
        ...updates,
      }

      // 保存到文件
      await this.save()

      this.log(`平台配置已更新: ${platform}`)
      return true
    } catch (error) {
      console.error('[SelectorManager] 更新平台配置失败:', error)
      return false
    }
  }

  /**
   * 导出平台配置
   */
  exportPlatformConfig(platform: string): string {
    const platformConfig = this.config?.platforms[platform]
    if (!platformConfig) {
      throw new Error(`平台不存在: ${platform}`)
    }
    return JSON.stringify(platformConfig, null, 2)
  }

  /**
   * 导入平台配置
   */
  importPlatformConfig(platform: string, jsonConfig: string): void {
    try {
      const platformConfig = JSON.parse(jsonConfig) as PlatformSelectors
      if (!this.config) {
        this.config = { name: 'Custom Config', version: '1.0.0', platforms: {} }
      }
      this.config.platforms[platform] = platformConfig
      this.log(`导入平台配置: ${platform}`)
    } catch (error) {
      throw new Error(`导入配置失败: ${error}`)
    }
  }

  /**
   * 日志记录
   */
  private log(message: string): void {
    console.log(`[SelectorManager] ${message}`)
  }
}

// 导出单例
let defaultSelectorManager: SelectorManager | null = null

export function getSelectorManager(): SelectorManager {
  if (!defaultSelectorManager) {
    defaultSelectorManager = new SelectorManager()
  }
  return defaultSelectorManager
}

/**
 * 异步获取选择器管理器（别名：getSelectorManagerAsync）
 */
export async function getSelectorManagerAsync(): Promise<SelectorManager> {
  const manager = getSelectorManager()
  await manager.init()
  return manager
}

export default SelectorManager
