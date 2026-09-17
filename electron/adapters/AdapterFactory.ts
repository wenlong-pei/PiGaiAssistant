/**
 * 适配器工厂
 * 负责创建和管理平台适配器实例
 */

import { LogService } from '../services/LogService'
import { ConfigService } from '../services/ConfigService'
import { PlatformDetectionService, getPlatformDetectionService } from '../services/PlatformDetectionService'
import { PlatformAdapter, PlatformAdapterFactory } from './PlatformAdapter.interface'

/**
 * 适配器工厂类
 * 提供适配器的注册、创建和管理功能
 */
export class AdapterFactory {
  /** 日志服务 */
  private logger: LogService
  
  /** 配置服务 */
  private configService: ConfigService
  
  /** 平台检测服务 */
  private platformDetectionService: PlatformDetectionService
  
  /** 适配器注册表 */
  private adapterRegistry: Map<string, PlatformAdapterFactory> = new Map()
  
  /** 适配器实例缓存 */
  private adapterCache: Map<string, PlatformAdapter> = new Map()
  
  /** 用户首选平台 */
  private userPreferredPlatform: string | null = null

  /**
   * 构造函数
   * @param logger - 日志服务实例
   * @param configService - 配置服务实例
   * @param platformDetectionService - 平台检测服务实例
   */
  constructor(
    logger: LogService,
    configService: ConfigService,
    platformDetectionService?: PlatformDetectionService
  ) {
    this.logger = logger
    this.configService = configService
    this.platformDetectionService = platformDetectionService || getPlatformDetectionService(logger)
  }

  /**
   * 注册适配器
   * @param platform - 平台标识
   * @param factory - 适配器工厂函数
   */
  registerAdapter(platform: string, factory: PlatformAdapterFactory): void {
    if (!platform || typeof platform !== 'string') {
      this.logger.error('注册适配器失败: 无效的平台标识', new Error('Invalid platform'))
      return
    }

    if (!factory || typeof factory !== 'function') {
      this.logger.error('注册适配器失败: 无效的工厂函数', new Error('Invalid factory'))
      return
    }

    this.adapterRegistry.set(platform, factory)
    this.logger.info(`注册适配器: ${platform}`)
  }

  /**
   * 注销适配器
   * @param platform - 平台标识
   */
  unregisterAdapter(platform: string): void {
    const deleted = this.adapterRegistry.delete(platform)
    this.adapterCache.delete(platform) // 同时清除缓存
    
    if (deleted) {
      this.logger.info(`注销适配器: ${platform}`)
    }
  }

  /**
   * 创建指定平台的适配器
   * @param platform - 平台标识
   * @returns 适配器实例
   * @throws 如果平台不支持
   */
  createAdapter(platform: string): PlatformAdapter {
    // 检查缓存
    if (this.adapterCache.has(platform)) {
      this.logger.info(`从缓存获取适配器: ${platform}`)
      return this.adapterCache.get(platform)!
    }

    // 查找适配器工厂
    const factory = this.adapterRegistry.get(platform)
    if (!factory) {
      const error = new Error(`不支持的平台: ${platform}`)
      this.logger.error('创建适配器失败', error, { platform })
      throw error
    }

    // 创建适配器实例
    try {
      const adapter = factory()
      this.adapterCache.set(platform, adapter) // 缓存实例
      this.logger.info(`创建适配器成功: ${platform}`)
      return adapter
    } catch (error) {
      this.logger.error('创建适配器实例失败', error as Error, { platform })
      throw error
    }
  }

  /**
   * 根据 URL 自动检测并创建适配器
   * @param url - 当前页面 URL
   * @returns 适配器实例
   * @throws 如果无法检测平台或平台不支持
   */
  createAdapterByUrl(url: string): PlatformAdapter {
    // 优先使用用户首选平台
    if (this.userPreferredPlatform) {
      this.logger.info(`使用用户首选平台: ${this.userPreferredPlatform}`)
      return this.createAdapter(this.userPreferredPlatform)
    }

    // 自动检测平台
    const detectedPlatform = this.platformDetectionService.detect(url)
    if (!detectedPlatform) {
      const error = new Error(`无法检测平台: ${url}`)
      this.logger.error('自动检测平台失败', error, { url })
      throw error
    }

    this.logger.info(`自动检测平台: ${detectedPlatform}`, { url })
    return this.createAdapter(detectedPlatform)
  }

  /**
   * 设置用户首选平台
   * @param platform - 平台标识，传入 null 则清除首选
   */
  setUserPreference(platform?: string): void {
    if (platform === undefined || platform === null) {
      this.userPreferredPlatform = null
      this.logger.info('清除用户首选平台')
    } else {
      // 验证平台是否支持
      if (!this.adapterRegistry.has(platform)) {
        this.logger.warn('设置首选平台失败: 平台不支持', { platform })
        return
      }
      
      this.userPreferredPlatform = platform
      this.logger.info(`设置用户首选平台: ${platform}`)
    }
  }

  /**
   * 获取用户首选平台
   * @returns 首选平台标识或 null
   */
  getUserPreference(): string | null {
    return this.userPreferredPlatform
  }

  /**
   * 获取所有已注册的平台列表
   * @returns 平台标识列表
   */
  getAvailablePlatforms(): string[] {
    return Array.from(this.adapterRegistry.keys())
  }

  /**
   * 检查平台是否支持
   * @param platform - 平台标识
   * @returns 是否支持
   */
  isPlatformSupported(platform: string): boolean {
    return this.adapterRegistry.has(platform)
  }

  /**
   * 清除适配器缓存
   * 强制下次创建新的适配器实例
   */
  clearCache(): void {
    this.adapterCache.clear()
    this.logger.info('已清除适配器缓存')
  }

  /**
   * 列出所有已注册的适配器信息
   * @returns 适配器信息列表
   */
  listAdapters(): Array<{ platform: string; cached: boolean }> {
    const result: Array<{ platform: string; cached: boolean }> = []
    
    for (const platform of this.adapterRegistry.keys()) {
      result.push({
        platform,
        cached: this.adapterCache.has(platform),
      })
    }
    
    return result
  }
}

/**
 * 默认适配器工厂实例（单例）
 */
let defaultAdapterFactory: AdapterFactory | null = null

/**
 * 获取默认适配器工厂实例
 */
export function getAdapterFactory(
  logger?: LogService,
  configService?: ConfigService,
  platformDetectionService?: PlatformDetectionService
): AdapterFactory {
  if (!defaultAdapterFactory) {
    if (!logger || !configService) {
      throw new Error('首次获取 AdapterFactory 必须提供 logger 和 configService')
    }
    defaultAdapterFactory = new AdapterFactory(logger, configService, platformDetectionService)
  }
  return defaultAdapterFactory
}

/**
 * 创建新的适配器工厂实例
 */
export function createAdapterFactory(
  logger: LogService,
  configService: ConfigService,
  platformDetectionService?: PlatformDetectionService
): AdapterFactory {
  return new AdapterFactory(logger, configService, platformDetectionService)
}

export default AdapterFactory
