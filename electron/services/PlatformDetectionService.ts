/**
 * 平台检测服务
 * 负责根据 URL 自动检测当前平台
 */

import { LogService } from './LogService'
import { PlatformDetectionRule } from '../adapters/PlatformAdapter.interface'

/**
 * 平台检测服务类
 * 提供平台自动检测功能
 */
export class PlatformDetectionService {
  /** 日志服务 */
  private logger: LogService
  
  /** 检测规则列表 */
  private rules: PlatformDetectionRule[] = []

  /**
   * 构造函数
   * @param logger - 日志服务实例
   */
  constructor(logger?: LogService) {
    this.logger = logger || new LogService()
    this.initializeDefaultRules()
  }

  /**
   * 初始化默认检测规则
   */
  private initializeDefaultRules(): void {
    // 智学网检测规则
    this.registerRule({
      platform: 'zhixue',
      urlPatterns: [
        /zhixue\.com/i,
        /zhixueyun\.com/i,
      ],
      priority: 100,
    })

    // 可扩展：添加更多平台的检测规则
    // 例如：
    // this.registerRule({
    //   platform: 'other-platform',
    //   urlPatterns: [/other-platform\.com/i],
    //   priority: 50,
    // })
  }

  /**
   * 注册检测规则
   * @param rule - 平台检测规则
   */
  registerRule(rule: PlatformDetectionRule): void {
    // 检查是否已存在相同平台的规则
    const existingIndex = this.rules.findIndex(r => r.platform === rule.platform)
    
    if (existingIndex >= 0) {
      // 更新现有规则
      this.rules[existingIndex] = rule
      this.logger.info(`更新平台检测规则: ${rule.platform}`)
    } else {
      // 添加新规则
      this.rules.push(rule)
      this.logger.info(`注册平台检测规则: ${rule.platform}`)
    }

    // 按优先级排序（优先级高的在前面）
    this.rules.sort((a, b) => b.priority - a.priority)
  }

  /**
   * 注销检测规则
   * @param platform - 平台标识
   */
  unregisterRule(platform: string): void {
    const initialLength = this.rules.length
    this.rules = this.rules.filter(r => r.platform !== platform)
    
    if (this.rules.length < initialLength) {
      this.logger.info(`注销平台检测规则: ${platform}`)
    }
  }

  /**
   * 根据 URL 检测平台
   * @param url - 要检测的 URL
   * @returns 平台标识，未找到则返回 null
   */
  detect(url: string): string | null {
    if (!url || typeof url !== 'string') {
      this.logger.warn('无效的 URL', { url })
      return null
    }

    try {
      const urlObj = new URL(url)
      const hostname = urlObj.hostname

      // 遍历所有规则，找到第一个匹配的规则
      // 仅匹配 hostname：此前 `|| pattern.test(fullUrl)` 会让任何路径/查询串里
      // 含平台域名的 URL 被误判（如 https://www.example.com/path/zhixue.com/...）。
      for (const rule of this.rules) {
        for (const pattern of rule.urlPatterns) {
          if (pattern.test(hostname)) {
            this.logger.info(`平台检测成功: ${rule.platform}`, { url, pattern: pattern.source })
            return rule.platform
          }
        }
      }

      this.logger.warn('未找到匹配的平台', { url })
      return null
    } catch (error) {
      this.logger.error('平台检测失败', error as Error, { url })
      return null
    }
  }

  /**
   * 获取所有注册的规则
   * @returns 规则列表
   */
  getRules(): PlatformDetectionRule[] {
    return [...this.rules] // 返回副本，防止外部修改
  }

  /**
   * 获取所有支持的平台列表
   * @returns 平台标识列表
   */
  getSupportedPlatforms(): string[] {
    return this.rules.map(rule => rule.platform)
  }

  /**
   * 检查是否支持指定平台
   * @param platform - 平台标识
   * @returns 是否支持
   */
  isPlatformSupported(platform: string): boolean {
    return this.rules.some(rule => rule.platform === platform)
  }

  /**
   * 清除所有规则
   */
  clearRules(): void {
    this.rules = []
    this.logger.info('已清除所有平台检测规则')
  }

  /**
   * 重置为默认规则
   */
  resetToDefaults(): void {
    this.rules = []
    this.initializeDefaultRules()
    this.logger.info('已重置为默认平台检测规则')
  }
}

/**
 * 默认平台检测服务实例（单例）
 */
let defaultPlatformDetectionService: PlatformDetectionService | null = null

/**
 * 获取默认平台检测服务实例
 */
export function getPlatformDetectionService(logger?: LogService): PlatformDetectionService {
  if (!defaultPlatformDetectionService) {
    defaultPlatformDetectionService = new PlatformDetectionService(logger)
  }
  return defaultPlatformDetectionService
}

/**
 * 创建新的平台检测服务实例
 */
export function createPlatformDetectionService(logger?: LogService): PlatformDetectionService {
  return new PlatformDetectionService(logger)
}

export default PlatformDetectionService
