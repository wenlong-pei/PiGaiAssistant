/**
 * BrowserService 适配器集成测试
 * 验证 BrowserService 正确使用适配器模式
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { LogService } from '../../electron/services/LogService'
import { ConfigService } from '../../electron/services/ConfigService'
import { AdapterFactory } from '../../electron/adapters/AdapterFactory'
import { BrowserService } from '../../electron/services/BrowserService'
import { PlatformAdapter } from '../../electron/adapters/PlatformAdapter.interface'

describe('BrowserService 适配器集成', () => {
  let browserService: BrowserService
  let mockLogger: any
  let mockConfigService: any
  let mockAdapterFactory: any

  beforeEach(() => {
    mockLogger = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn()
    }

    mockConfigService = {
      getZhixueScoreInputSelectors: vi.fn(),
      getAnswerImageSelectors: vi.fn(),
      getZhixueSubmitButtonSelectors: vi.fn(),
      // analyzePage 现在会读取 getFullConfig() 拼接平台展示名，旧桩件缺此方法会抛错
      getFullConfig: vi.fn().mockReturnValue(null)
    }

    // 创建 mock AdapterFactory
    mockAdapterFactory = {
      setUserPreference: vi.fn(),
      createAdapterByUrl: vi.fn(),
      createAdapter: vi.fn(),
      getUserPreference: vi.fn().mockReturnValue(null)
    }

    browserService = new BrowserService(
      mockLogger as any,
      mockConfigService as any,
      mockAdapterFactory as any
    )

    // 2026-09-17：BrowserService 各公开方法现在先经 ensureValidPage() 取页面，
    // 旧桩件未打桩该方法导致点击/分析一律因"浏览器未启动"短路。
    // 这里让其返回测试用例设置的 this.page（未设置则回退为 undefined，即未启动）。
    ;(browserService as any).ensureValidPage = vi
      .fn()
      .mockImplementation(async () => (browserService as any).page)
  })

  describe('构造函数', () => {
    it('应该正确初始化 AdapterFactory', () => {
      expect(browserService).toBeInstanceOf(BrowserService)
    })
  })

  describe('setPlatform()', () => {
    it('应该设置用户首选平台', () => {
      browserService.setPlatform('zhixue')

      expect(mockAdapterFactory.setUserPreference).toHaveBeenCalledWith('zhixue')
    })

    it('应该清除首选平台当传入 null', () => {
      // 2026-09-17：清除语义改为 setUserPreference(undefined)（null 走同一分支），
      // 旧断言期望 null，与当前实现不符。
      browserService.setPlatform(null)

      expect(mockAdapterFactory.setUserPreference).toHaveBeenCalledWith(undefined)
    })

    it('应该处理无效平台', () => {
      // 模拟工厂拒绝无效平台
      mockAdapterFactory.setUserPreference.mockImplementation((platform: string) => {
        if (platform === 'invalid') {
          throw new Error('Unsupported platform')
        }
      })

      expect(() => browserService.setPlatform('invalid')).not.toThrow()
    })
  })

  describe('analyzePage()', () => {
    it('应该使用适配器分析页面', async () => {
      const mockAdapter = {
        platformName: 'zhixue',
        analyzePage: vi.fn().mockResolvedValue({
          found: true,
          platformName: 'zhixue',
          hasAnswerImage: true,
          hasScoreInput: true
        })
      }

      // Mock ensureAdapter
      ;(browserService as any).ensureAdapter = vi.fn().mockResolvedValue(mockAdapter)

      // Mock this.page
      ;(browserService as any).page = { url: () => 'https://www.zhixue.com' }

      const result = await browserService.analyzePage()

      expect(result.found).toBe(true)
      expect(mockAdapter.analyzePage).toHaveBeenCalled()
    })

    it('应该返回错误当无法获取适配器时', async () => {
      // 需要先有一张"有效页面"，否则会在 ensureValidPage 阶段就返回"浏览器未启动"
      ;(browserService as any).page = { url: () => 'https://www.unknown.com' }

      // Mock ensureAdapter 返回 null
      ;(browserService as any).ensureAdapter = vi.fn().mockResolvedValue(null)

      const result = await browserService.analyzePage()

      expect(result.found).toBe(false)
      expect(result.error).toContain('无法检测平台')
    })

    it('应该保持向后兼容的字段', async () => {
      const mockAdapter = {
        platformName: 'zhixue',
        analyzePage: vi.fn().mockResolvedValue({
          found: true,
          platformName: 'zhixue',
          hasAnswerImage: true,
          hasScoreInput: true
        })
      }

      ;(browserService as any).ensureAdapter = vi.fn().mockResolvedValue(mockAdapter)
      ;(browserService as any).page = { url: () => 'https://www.zhixue.com' }

      const result = await browserService.analyzePage()

      // 检查向后兼容字段
      expect(result.isZhixue).toBe(true)
      expect(result.isOldUI).toBeDefined()
      expect(result.isNewUI).toBeDefined()
    })
  })

  describe('坐标批改功能', () => {
    beforeEach(() => {
      ;(browserService as any).page = {
        mouse: {
          click: vi.fn().mockResolvedValue(undefined),
          move: vi.fn().mockResolvedValue(undefined)
        },
        keyboard: {
          type: vi.fn().mockResolvedValue(undefined)
        },
        waitForTimeout: vi.fn().mockResolvedValue(undefined)
      }
    })

    it('clickAt() 应该保持不变', async () => {
      const result = await browserService.clickAt(100, 200)

      expect(result).toBe(true)
      expect((browserService as any).page.mouse.click).toHaveBeenCalledWith(100, 200)
    })

    it('typeAt() 应该保持不变', async () => {
      const result = await browserService.typeAt(100, 200, '测试文本')

      expect(result).toBe(true)
      expect((browserService as any).page.mouse.click).toHaveBeenCalledWith(100, 200)
      // 2026-09-17：typeAt 现在逐字符输入并附带 delay 参数，断言需匹配第二参数
      expect((browserService as any).page.keyboard.type).toHaveBeenCalledWith(
        '测试文本',
        expect.objectContaining({ delay: expect.any(Number) })
      )
    })

    it('应该拒绝无效的坐标', async () => {
      const result1 = await browserService.clickAt(NaN, 200)
      expect(result1).toBe(false)

      const result2 = await browserService.clickAt(100, 'invalid' as any)
      expect(result2).toBe(false)
    })

    it('应该拒绝无效的文本', async () => {
      const result = await browserService.typeAt(100, 200, null as any)
      expect(result).toBe(false)
    })
  })

  describe('ensureAdapter()', () => {
    it('应该返回当前适配器如果已存在', async () => {
      const mockAdapter = { platformName: 'test' }
      ;(browserService as any).currentAdapter = mockAdapter

      const result = await (browserService as any).ensureAdapter()

      expect(result).toBe(mockAdapter)
    })

    it('应该自动检测平台当没有当前适配器时', async () => {
      const mockAdapter = { platformName: 'zhixue' }
      mockAdapterFactory.createAdapterByUrl.mockResolvedValue(mockAdapter)

      ;(browserService as any).page = { url: () => 'https://www.zhixue.com' }
      ;(browserService as any).currentAdapter = null

      const result = await (browserService as any).ensureAdapter()

      expect(result).toBe(mockAdapter)
      expect(mockAdapterFactory.createAdapterByUrl).toHaveBeenCalledWith(
        'https://www.zhixue.com'
      )
    })

    it('应该回退到通用适配器当自动检测失败时', async () => {
      const mockGenericAdapter = { platformName: 'generic' }
      mockAdapterFactory.createAdapterByUrl.mockImplementation(() => {
        throw new Error('Detection failed')
      })
      mockAdapterFactory.createAdapter.mockReturnValue(mockGenericAdapter)

      ;(browserService as any).page = { url: () => 'https://www.unknown.com' }
      ;(browserService as any).currentAdapter = null

      const result = await (browserService as any).ensureAdapter()

      expect(result).toBe(mockGenericAdapter)
      expect(mockAdapterFactory.createAdapter).toHaveBeenCalledWith('generic')
    })
  })

  describe('向后兼容性', () => {
    it('应该保留所有旧的 IPC 接口方法', () => {
      // 检查 BrowserService 是否还有这些公共方法
      expect(typeof browserService.launch).toBe('function')
      expect(typeof browserService.navigate).toBe('function')
      expect(typeof browserService.analyzePage).toBe('function')
      expect(typeof browserService.captureAnswerImage).toBe('function')
      expect(typeof browserService.submitScore).toBe('function')
      expect(typeof browserService.goToNext).toBe('function')
      expect(typeof browserService.clickAt).toBe('function')
      expect(typeof browserService.typeAt).toBe('function')
      expect(typeof browserService.close).toBe('function')
    })
  })
})
