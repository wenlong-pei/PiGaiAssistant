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
          type: vi.fn().mockResolvedValue(undefined),
          press: vi.fn().mockResolvedValue(undefined)
        },
        waitForTimeout: vi.fn().mockResolvedValue(undefined),
        // 2026-09-17（iframe 下钻）：resolveElementAtDocumentPoint 会用
        // document.elementFromPoint 做命中测试，因此替身必须能提供 evaluateHandle。
        // 这里返回一个 INPUT 句柄 → iframeDepth = 0 → 走原有的鼠标坐标点击路径。
        evaluateHandle: vi.fn().mockResolvedValue({
          asElement: () => ({
            evaluate: vi.fn().mockResolvedValue('INPUT'),
            click: vi.fn().mockResolvedValue(undefined),
            boundingBox: vi.fn().mockResolvedValue({ x: 0, y: 0, width: 10, height: 10 }),
            contentFrame: vi.fn().mockResolvedValue(null)
          })
        })
      }
      // 2026-09-17（P0）：clickAt/typeAt 现在多两步「需要真实 DOM」的前置步骤——
      //   1) resolveViewportPoint：文档坐标 → 视口坐标（必要时先滚动）；
      //   2) readFocusedElement：输入后回读焦点元素做落值校验。
      // 本文件专注断言「返回契约」，这两步单独打桩；其内部逻辑由
      // src/tests/viewportPoint.test.ts 用纯函数 + evaluate 桩件覆盖。
      ;(browserService as any).resolveViewportPoint = vi
        .fn()
        .mockImplementation(async (_page: any, x: number, y: number) => ({ ok: true, x, y }))
      ;(browserService as any).readFocusedElement = vi.fn().mockResolvedValue({
        tagName: 'input',
        value: '测试文本',
        isContentEditable: false,
        readOnly: false,
        isDisabled: false
      })
    })

    it('clickAt() 成功后返回 true（契约：true | { error }）', async () => {
      const result = await browserService.clickAt(100, 200)

      expect(result).toBe(true)
      expect((browserService as any).page.mouse.click).toHaveBeenCalledWith(100, 200)
    })

    it('typeAt() 成功后返回 true，并逐字符输入', async () => {
      const result = await browserService.typeAt(100, 200, '测试文本')

      expect(result).toBe(true)
      expect((browserService as any).page.mouse.click).toHaveBeenCalledWith(100, 200)
      // 2026-09-17：typeAt 现在逐字符输入并附带 delay 参数，断言需匹配第二参数
      expect((browserService as any).page.keyboard.type).toHaveBeenCalledWith(
        '测试文本',
        expect.objectContaining({ delay: expect.any(Number) })
      )
    })

    it('应该拒绝无效的坐标（返回 { error } 而不是 false）', async () => {
      const result1 = await browserService.clickAt(NaN, 200)
      expect(result1).toMatchObject({ error: expect.stringContaining('坐标') })

      const result2 = await browserService.clickAt(100, 'invalid' as any)
      expect(result2).toMatchObject({ error: expect.stringContaining('坐标') })
    })

    it('应该拒绝无效的文本（返回 { error } 而不是 false）', async () => {
      const result = await browserService.typeAt(100, 200, null as any)
      expect(result).toMatchObject({ error: expect.any(String) })
    })

    it('P0：坐标换算失败（目标在视口外）时返回 { error }，且绝不真的去点', async () => {
      ;(browserService as any).resolveViewportPoint = vi
        .fn()
        .mockResolvedValue({ ok: false, reason: '目标坐标不在可视区域内，已放弃操作以免误点' })

      const result = await browserService.clickAt(100, 200)

      expect(result).toMatchObject({ error: expect.stringContaining('不在可视区域内') })
      // 关键：没有派发任何点击（旧实现会点到视口外，且返回 true）
      expect((browserService as any).page.mouse.click).not.toHaveBeenCalled()
    })

    it('P0：输入落值校验不通过时返回 { error }（分数没进输入框绝不谎报成功）', async () => {
      // 焦点落在了非输入元素上（例如点击没点中输入框）
      ;(browserService as any).readFocusedElement = vi.fn().mockResolvedValue({
        tagName: 'body',
        value: null,
        isContentEditable: false,
        readOnly: false,
        isDisabled: false
      })

      const result = await browserService.typeAt(100, 200, '7')

      expect(result).toMatchObject({ error: expect.stringContaining('未写入输入框') })
    })

    it('iframe：命中 <iframe> 时下钻并用元素句柄点击，而不是主框架鼠标坐标', async () => {
      const innerClick = vi.fn().mockResolvedValue(undefined)
      const innerHandle = {
        evaluate: vi.fn().mockResolvedValue('INPUT'),
        click: innerClick,
        boundingBox: vi.fn(),
        contentFrame: vi.fn()
      }
      const iframeHandle = {
        evaluate: vi.fn().mockResolvedValue('IFRAME'),
        click: vi.fn(),
        boundingBox: vi.fn().mockResolvedValue({ x: 10, y: 20, width: 300, height: 200 }),
        contentFrame: vi.fn().mockResolvedValue({
          evaluateHandle: vi.fn().mockResolvedValue({ asElement: () => innerHandle })
        })
      }

      // 第一次命中 iframe，第二次（子框架内）命中真正的 input
      const evalHandleMock = (browserService as any).page.evaluateHandle
      evalHandleMock
        .mockResolvedValueOnce({ asElement: () => iframeHandle })
        .mockResolvedValue({ asElement: () => innerHandle })

      const result = await browserService.clickAt(100, 200)

      expect(result).toBe(true)
      // 关键：主框架鼠标坐标**没有**被使用（那样只会点到 iframe 外壳）
      expect((browserService as any).page.mouse.click).not.toHaveBeenCalled()
      expect(innerClick).toHaveBeenCalled()
    })

    it('iframe：typeAt 从子框架读回焦点元素（否则会误报"焦点元素=iframe"）', async () => {
      const childFrame = {
        evaluate: vi.fn().mockResolvedValue({
          tagName: 'input',
          value: '7',
          isContentEditable: false,
          readOnly: false,
          isDisabled: false
        }),
        evaluateHandle: vi.fn().mockResolvedValue({
          asElement: () => ({
            evaluate: vi.fn().mockResolvedValue('INPUT'),
            click: vi.fn().mockResolvedValue(undefined),
            boundingBox: vi.fn(),
            contentFrame: vi.fn()
          })
        })
      }
      const iframeHandle = {
        evaluate: vi.fn().mockResolvedValue('IFRAME'),
        click: vi.fn(),
        boundingBox: vi.fn().mockResolvedValue({ x: 0, y: 0, width: 300, height: 200 }),
        contentFrame: vi.fn().mockResolvedValue(childFrame)
      }
      ;(browserService as any).page.evaluateHandle
        .mockResolvedValueOnce({ asElement: () => iframeHandle })
        .mockResolvedValue({
          asElement: () => ({
            evaluate: vi.fn().mockResolvedValue('INPUT'),
            click: vi.fn().mockResolvedValue(undefined),
            boundingBox: vi.fn(),
            contentFrame: vi.fn()
          })
        })
      // 恢复真实实现，验证「确实传了子框架」
      delete (browserService as any).readFocusedElement
      const readSpy = vi
        .spyOn(browserService as any, 'readFocusedElement')
        .mockResolvedValue({
          tagName: 'input',
          value: '7',
          isContentEditable: false,
          readOnly: false,
          isDisabled: false
        })

      const result = await browserService.typeAt(100, 200, '7')

      expect(result).toBe(true)
      expect(readSpy).toHaveBeenCalledWith(expect.anything(), childFrame)
    })

    it('P0：输入前先清空，避免与残留值拼接（"0" + "8" = "08"）', async () => {
      await browserService.typeAt(100, 200, '测试文本')

      const pressMock = (browserService as any).page.keyboard.press
      expect(pressMock).toHaveBeenCalledWith('Control+A')
      expect(pressMock).toHaveBeenCalledWith('Backspace')
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
