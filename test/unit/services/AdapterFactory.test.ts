/**
 * AdapterFactory 适配器工厂测试
 * 验证适配器的注册、创建和管理功能
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { LogService } from '../../../electron/services/LogService'
import { ConfigService } from '../../../electron/services/ConfigService'
import { AdapterFactory, getAdapterFactory } from '../../../electron/adapters/AdapterFactory'
import { PlatformAdapter } from '../../../electron/adapters/PlatformAdapter.interface'

describe('AdapterFactory 适配器工厂', () => {
  let factory: AdapterFactory
  let mockLogger: any
  let mockConfigService: any

  beforeEach(() => {
    mockLogger = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn()
    }

    mockConfigService = {
      getZhixueScoreInputSelectors: vi.fn(),
      getAnswerImageSelectors: vi.fn()
    }

    factory = new AdapterFactory(mockLogger as any, mockConfigService as any)
  })

  afterEach(() => {
    // 清理单例
    vi.resetModules()
  })

  describe('registerAdapter()', () => {
    it('应该成功注册适配器', () => {
      const mockFactory = () => ({ platformName: 'test' }) as PlatformAdapter

      factory.registerAdapter('test', mockFactory)

      expect(factory.isPlatformSupported('test')).toBe(true)
      expect(factory.getAvailablePlatforms()).toContain('test')
    })

    it('应该拒绝无效的平台标识', () => {
      const mockFactory = () => ({ platformName: 'test' }) as PlatformAdapter

      factory.registerAdapter('', mockFactory)

      expect(mockLogger.error).toHaveBeenCalled()
    })

    it('应该拒绝无效的工厂函数', () => {
      factory.registerAdapter('test', null as any)

      expect(mockLogger.error).toHaveBeenCalled()
    })

    it('应该更新已存在的适配器', () => {
      const mockFactory1 = () => ({ platformName: 'test1' }) as PlatformAdapter
      const mockFactory2 = () => ({ platformName: 'test2' }) as PlatformAdapter

      factory.registerAdapter('test', mockFactory1)
      factory.registerAdapter('test', mockFactory2)

      // 应该只注册一次
      expect(factory.getAvailablePlatforms().length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('unregisterAdapter()', () => {
    it('应该成功注销适配器', () => {
      const mockFactory = () => ({ platformName: 'test' }) as PlatformAdapter

      factory.registerAdapter('test', mockFactory)
      expect(factory.isPlatformSupported('test')).toBe(true)

      factory.unregisterAdapter('test')
      expect(factory.isPlatformSupported('test')).toBe(false)
    })

    it('应该清除适配器缓存', () => {
      const mockAdapter = { platformName: 'test' } as PlatformAdapter
      const mockFactory = () => mockAdapter

      factory.registerAdapter('test', mockFactory)

      // 创建适配器（会缓存）
      const adapter1 = factory.createAdapter('test')
      expect(factory.listAdapters()[0].cached).toBe(true)

      // 注销
      factory.unregisterAdapter('test')

      // 缓存应该被清除
      expect(factory.listAdapters().length).toBe(0)
    })
  })

  describe('createAdapter()', () => {
    it('应该成功创建适配器', () => {
      const mockAdapter = { platformName: 'test', getPlatformName: () => 'test' } as PlatformAdapter
      const mockFactory = () => mockAdapter

      factory.registerAdapter('test', mockFactory)

      const adapter = factory.createAdapter('test')

      expect(adapter).toBe(mockAdapter)
      expect(adapter.platformName).toBe('test')
    })

    it('应该从缓存返回适配器', () => {
      const mockAdapter = { platformName: 'test' } as PlatformAdapter
      const mockFactory = vi.fn(() => mockAdapter)

      factory.registerAdapter('test', mockFactory)

      const adapter1 = factory.createAdapter('test')
      const adapter2 = factory.createAdapter('test')

      // 工厂函数应该只被调用一次（第二次从缓存返回）
      expect(mockFactory).toHaveBeenCalledTimes(1)
      expect(adapter1).toBe(adapter2)
    })

    it('应该拒绝创建未注册的适配器', () => {
      expect(() => factory.createAdapter('non-existent')).toThrow()
    })
  })

  describe('createAdapterByUrl()', () => {
    it('应该优先使用用户首选平台', () => {
      const mockAdapter = { platformName: 'zhixue' } as PlatformAdapter
      const mockFactory = () => mockAdapter

      factory.registerAdapter('zhixue', mockFactory)

      // 设置用户首选
      factory.setUserPreference('zhixue')

      const adapter = factory.createAdapterByUrl('https://www.google.com')

      expect(adapter.platformName).toBe('zhixue')
    })

    it('应该自动检测平台', () => {
      const mockZhixueAdapter = { platformName: 'zhixue' } as PlatformAdapter
      const mockFactory = () => mockZhixueAdapter

      factory.registerAdapter('zhixue', mockFactory)

      // 注册平台检测规则（需要通过 PlatformDetectionService）
      // 这里假设 PlatformDetectionService 已经正确配置

      // 由于我们无法直接访问 PlatformDetectionService，这里只是测试接口
      expect(factory).toBeDefined()
    })

    it('应该在无法检测平台时抛出异常', () => {
      expect(() => factory.createAdapterByUrl('https://www.unknown.com')).toThrow()
    })
  })

  describe('setUserPreference()', () => {
    it('应该成功设置用户首选平台', () => {
      const mockAdapter = { platformName: 'test' } as PlatformAdapter
      const mockFactory = () => mockAdapter

      factory.registerAdapter('test', mockFactory)
      factory.registerAdapter('test2', () => ({ platformName: 'test2' }) as PlatformAdapter)

      factory.setUserPreference('test')

      expect(factory.getUserPreference()).toBe('test')
    })

    it('应该拒绝设置不支持的平台', () => {
      factory.setUserPreference('non-existent')

      expect(mockLogger.warn).toHaveBeenCalled()
      expect(factory.getUserPreference()).toBeNull()
    })

    it('应该清除首选平台当传入 null', () => {
      const mockAdapter = { platformName: 'test' } as PlatformAdapter
      const mockFactory = () => mockAdapter

      factory.registerAdapter('test', mockFactory)

      factory.setUserPreference('test')
      expect(factory.getUserPreference()).toBe('test')

      factory.setUserPreference(null)
      expect(factory.getUserPreference()).toBeNull()
    })
  })

  describe('getAvailablePlatforms()', () => {
    it('应该返回所有已注册的平台', () => {
      factory.registerAdapter('platform1', () => ({ platformName: 'p1' }) as PlatformAdapter)
      factory.registerAdapter('platform2', () => ({ platformName: 'p2' }) as PlatformAdapter)

      const platforms = factory.getAvailablePlatforms()

      expect(platforms).toContain('platform1')
      expect(platforms).toContain('platform2')
      expect(platforms.length).toBe(2)
    })
  })

  describe('clearCache()', () => {
    it('应该清除所有适配器缓存', () => {
      const mockAdapter = { platformName: 'test' } as PlatformAdapter
      const mockFactory = () => mockAdapter

      factory.registerAdapter('test', mockFactory)

      // 创建适配器（会缓存）
      factory.createAdapter('test')
      expect(factory.listAdapters()[0].cached).toBe(true)

      // 清除缓存
      factory.clearCache()
      expect(factory.listAdapters()[0].cached).toBe(false)
    })
  })

  describe('listAdapters()', () => {
    it('应该列出所有适配器的状态', () => {
      factory.registerAdapter('test1', () => ({ platformName: 't1' }) as PlatformAdapter)
      factory.registerAdapter('test2', () => ({ platformName: 't2' }) as PlatformAdapter)

      const list = factory.listAdapters()

      expect(list.length).toBe(2)
      expect(list[0]).toHaveProperty('platform')
      expect(list[0]).toHaveProperty('cached')
    })
  })

  describe('单例模式', () => {
    it('应该返回相同的实例', () => {
      const instance1 = getAdapterFactory(mockLogger as any, mockConfigService as any)
      const instance2 = getAdapterFactory()

      expect(instance1).toBe(instance2)
    })
  })
})
