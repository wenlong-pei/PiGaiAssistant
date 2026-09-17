/**
 * 适配器初始化集成测试
 * 验证适配器系统的初始化流程
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { LogService } from '../../electron/services/LogService'
import { ConfigService, getConfigService } from '../../electron/services/ConfigService'
import { initializeAdapters, getAdapterFactoryInstance } from '../../electron/adapters/init'
import { AdapterFactory } from '../../electron/adapters/AdapterFactory'

describe('适配器系统初始化', () => {
  let logger: LogService
  let configService: ConfigService

  beforeAll(async () => {
    logger = new LogService()
    configService = getConfigService(logger)
    await configService.init()
  })

  describe('initializeAdapters()', () => {
    it('应该成功初始化适配器系统', async () => {
      const factory = await initializeAdapters(logger, configService)

      expect(factory).toBeInstanceOf(AdapterFactory)
    })

    it('应该注册所有默认适配器', async () => {
      const factory = await initializeAdapters(logger, configService)

      const platforms = factory.getAvailablePlatforms()

      expect(platforms).toContain('zhixue')
      expect(platforms).toContain('generic')
      expect(platforms).toContain('configurable')
    })

    it('应该记录初始化日志', async () => {
      const mockLogger = {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn()
      }

      await initializeAdapters(mockLogger as any, configService)

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('开始初始化适配器系统')
      )

      // 2026-09-17：init 的完成日志已带第二个元数据参数（{ availablePlatforms }），
      // 旧的单参数断言因实参个数不匹配而恒失败，这里按当前调用形态精确匹配。
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('适配器系统初始化完成'),
        expect.objectContaining({ availablePlatforms: expect.any(Array) })
      )
    })
  })

  describe('getAdapterFactoryInstance()', () => {
    it('应该返回相同的工厂实例', async () => {
      const factory1 = await initializeAdapters(logger, configService)
      const factory2 = getAdapterFactoryInstance()

      expect(factory1).toBe(factory2)
    })
  })
})
