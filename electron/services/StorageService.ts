/**
 * 存储服务
 * 封装 SecureStorage，提供类型安全的存储接口，管理 API Key、配置等敏感数据
 */

import { SecureStorage } from '../SecureStorage'
import { LogService } from './LogService'
import { STORAGE_KEYS, DEFAULTS } from '../utils/constants'
import { isString, isObject } from '../utils/validators'

// ============ 存储服务类 ============

export class StorageService {
  private secureStorage: SecureStorage | null = null
  private logger: LogService
  private initialized: boolean = false

  constructor(logger?: LogService) {
    this.logger = logger || new LogService()
    try {
      this.secureStorage = new SecureStorage()
      this.initialized = true
      this.logger.info('StorageService initialized successfully')
    } catch (error) {
      this.logger.error('StorageService initialization failed', error as Error)
      this.secureStorage = null
      this.initialized = false
    }
  }

  // ============ 初始化方法 ============

  /**
   * 初始化存储服务（已废弃，初始化在构造函数中完成）
   * 为向后兼容保留此方法
   * @returns 是否初始化成功
   */
  async init(): Promise<boolean> {
    // SecureStorage 在构造函数中已初始化
    if (!this.initialized) {
      this.logger.warn('StorageService 未初始化，请在构造函数中检查 SecureStorage 是否可用')
    }
    return Promise.resolve(this.initialized)
  }

  /**
   * 检查是否已初始化
   */
  isInitialized(): boolean {
    return this.initialized && this.secureStorage !== null
  }

  /**
   * 检查 SecureStorage 是否可用
   */
  isAvailable(): boolean {
    return this.secureStorage?.isAvailable() || false
  }

  // ============ API Key 管理方法 ============

  /**
   * 获取活跃服务商的 API Key
   * @param providerId - 服务商 ID
   * @returns API Key 或 null
   */
  async getApiKey(providerId: string): Promise<string | null> {
    if (!this.isInitialized()) {
      this.logger.warn('StorageService not initialized when getting API key')
      return null
    }

    if (!isString(providerId) ||!providerId.trim()) {
      this.logger.warn('Invalid providerId when getting API key')
      return null
    }

    const key = `${STORAGE_KEYS.API_KEY_PREFIX}${providerId}`
    
    try {
      const result = this.secureStorage!.get(key)
      return result || null
    } catch (error) {
      this.logger.error('Failed to get API key', error as Error, { providerId })
      return null
    }
  }

  /**
   * 设置活跃服务商的 API Key
   * @param providerId - 服务商 ID
   * @param apiKey - API Key
   * @returns 是否设置成功
   */
  async setApiKey(providerId: string, apiKey: string): Promise<boolean> {
    if (!this.isInitialized()) {
      this.logger.warn('StorageService not initialized when setting API key')
      return false
    }

    if (!isString(providerId) ||!providerId.trim()) {
      this.logger.warn('Invalid providerId when setting API key')
      return false
    }

    if (!isString(apiKey)) {
      this.logger.warn('Invalid apiKey when setting API key')
      return false
    }

    const key = `${STORAGE_KEYS.API_KEY_PREFIX}${providerId}`
    
    try {
      this.secureStorage!.set(key, apiKey)
      this.logger.info(`API key set for provider: ${providerId}`)
      return true
    } catch (error) {
      this.logger.error('Failed to set API key', error as Error, { providerId })
      return false
    }
  }

  /**
   * 删除活跃服务商的 API Key
   * @param providerId - 服务商 ID
   * @returns 是否删除成功
   */
  async deleteApiKey(providerId: string): Promise<boolean> {
    if (!this.isInitialized()) {
      this.logger.warn('StorageService not initialized when deleting API key')
      return false
    }

    if (!isString(providerId) ||!providerId.trim()) {
      this.logger.warn('Invalid providerId when deleting API key')
      return false
    }

    const key = `${STORAGE_KEYS.API_KEY_PREFIX}${providerId}`
    
    try {
      this.secureStorage!.delete(key)
      this.logger.info(`API key deleted for provider: ${providerId}`)
      return true
    } catch (error) {
      this.logger.error('Failed to delete API key', error as Error, { providerId })
      return false
    }
  }

  /**
   * 检查 API Key 是否存在
   * @param providerId - 服务商 ID
   * @returns 是否存在
   */
  async hasApiKey(providerId: string): Promise<boolean> {
    if (!this.isInitialized()) {
      this.logger.warn('StorageService not initialized when checking API key')
      return false
    }

    if (!isString(providerId) ||!providerId.trim()) {
      this.logger.warn('Invalid providerId when checking API key')
      return false
    }

    const key = `${STORAGE_KEYS.API_KEY_PREFIX}${providerId}`
    
    try {
      return this.secureStorage!.has(key)
    } catch (error) {
      this.logger.error('Failed to check API key', error as Error, { providerId })
      return false
    }
  }

  // ============ 通用存储方法 ============

  /**
   * 获取存储值
   * @param key - 键名
   * @returns 值或 null
   */
  get(key: string): string | null {
    if (!this.isInitialized()) {
      this.logger.warn('StorageService not initialized when getting value')
      return null
    }

    try {
      return this.secureStorage!.get(key)
    } catch (error) {
      this.logger.error('Failed to get value', error as Error, { key })
      return null
    }
  }

  /**
   * 设置存储值
   * @param key - 键名
   * @param value - 值
   * @returns 是否设置成功
   */
  set(key: string, value: string): boolean {
    if (!this.isInitialized()) {
      this.logger.warn('StorageService not initialized when setting value')
      return false
    }

    try {
      this.secureStorage!.set(key, value)
      return true
    } catch (error) {
      this.logger.error('Failed to set value', error as Error, { key })
      return false
    }
  }

  /**
   * 删除存储值
   * @param key - 键名
   * @returns 是否删除成功
   */
  delete(key: string): boolean {
    if (!this.isInitialized()) {
      this.logger.warn('StorageService not initialized when deleting value')
      return false
    }

    try {
      this.secureStorage!.delete(key)
      return true
    } catch (error) {
      this.logger.error('Failed to delete value', error as Error, { key })
      return false
    }
  }

  /**
   * 检查键是否存在
   * @param key - 键名
   * @returns 是否存在
   */
  has(key: string): boolean {
    if (!this.isInitialized()) {
      this.logger.warn('StorageService not initialized when checking key')
      return false
    }

    try {
      return this.secureStorage!.has(key)
    } catch (error) {
      this.logger.error('Failed to check key', error as Error, { key })
      return false
    }
  }

  // ============ 配置存储方法 ============

  /**
   * 获取配置对象（自动 JSON 解析）
   * @param key - 配置键名
   * @returns 配置对象或 null
   */
  getConfig<T = any>(key: string): T | null {
    const raw = this.get(key)
    if (!raw) return null

    try {
      return JSON.parse(raw) as T
    } catch (error) {
      this.logger.error('Failed to parse config', error as Error, { key })
      return null
    }
  }

  /**
   * 设置配置对象（自动 JSON 序列化）
   * @param key - 配置键名
   * @param value - 配置对象
   * @returns 是否设置成功
   */
  setConfig<T = any>(key: string, value: T): boolean {
    try {
      const raw = JSON.stringify(value)
      return this.set(key, raw)
    } catch (error) {
      this.logger.error('Failed to serialize config', error as Error, { key })
      return false
    }
  }

  // ============ 兼容旧逻辑 ============

  /**
   * 获取默认 API Key（向后兼容）
   * @returns API Key 或 null
   */
  async getDefaultApiKey(): Promise<string | null> {
    return this.getApiKey('default')
  }

  /**
   * 设置默认 API Key（向后兼容）
   * @param apiKey - API Key
   * @returns 是否设置成功
   */
  async setDefaultApiKey(apiKey: string): Promise<boolean> {
    return this.setApiKey('default', apiKey)
  }

  // ============ 清理方法 ============

  /**
   * 清除所有 API Key
   * @returns 是否清除成功
   */
  async clearAllApiKeys(): Promise<boolean> {
    if (!this.isInitialized()) {
      return false
    }

    try {
      // 获取所有键
      const allKeys = this.secureStorage!.keys()
      
      // 删除所有 API Key
      for (const key of allKeys) {
        if (key.startsWith(STORAGE_KEYS.API_KEY_PREFIX)) {
          this.secureStorage!.delete(key)
        }
      }
      
      this.logger.info('All API keys cleared')
      return true
    } catch (error) {
      this.logger.error('Failed to clear all API keys', error as Error)
      return false
    }
  }

  /**
   * 获取所有存储的键
   * @returns 键名数组
   */
  getAllKeys(): string[] {
    if (!this.isInitialized()) {
      return []
    }

    try {
      return this.secureStorage!.keys()
    } catch (error) {
      this.logger.error('Failed to get all keys', error as Error)
      return []
    }
  }
}

// ============ 默认存储服务实例 ============

let defaultStorageService: StorageService | null = null

/**
 * 获取默认存储服务实例（单例）
 */
export function getStorageService(logger?: LogService): StorageService {
  if (!defaultStorageService) {
    defaultStorageService = new StorageService(logger)
  }
  return defaultStorageService
}

/**
 * 创建新的存储服务实例
 */
export function createStorageService(logger?: LogService): StorageService {
  return new StorageService(logger)
}

// ============ 导出 ============

export default StorageService
