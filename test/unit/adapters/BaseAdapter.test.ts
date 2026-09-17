/**
 * BaseAdapter 抽象基类测试
 * 验证基类提供的通用功能
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { LogService } from '../../../electron/services/LogService'
import { ConfigService } from '../../../electron/services/ConfigService'
import { BaseAdapter } from '../../../electron/adapters/BaseAdapter'

// 创建具体实现用于测试
class TestAdapter extends BaseAdapter {
  readonly platformName: string = 'test'

  async analyzePage(page: any): Promise<any> {
    return { found: true, platformName: this.platformName }
  }

  async captureAnswerImage(page: any): Promise<string | null> {
    return null
  }

  async submitScore(page: any, score: number): Promise<boolean> {
    return true
  }

  async goToNext(page: any): Promise<boolean> {
    return true
  }

  async validatePage(page: any): Promise<boolean> {
    return true
  }
}

describe('BaseAdapter 抽象基类', () => {
  let adapter: TestAdapter
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
      getAnswerImageSelectors: vi.fn(),
      getZhixueSubmitButtonSelectors: vi.fn()
    }

    adapter = new TestAdapter(mockLogger as any, mockConfigService as any)
  })

  describe('构造函数', () => {
    it('应该正确初始化 logger 和 configService', () => {
      expect(adapter).toBeInstanceOf(BaseAdapter)
      expect(adapter.platformName).toBe('test')
    })
  })

  describe('getPlatformName()', () => {
    it('应该返回平台名称', () => {
      const name = adapter.getPlatformName()
      expect(name).toBe('test')
    })
  })

  describe('evaluateSelector()', () => {
    it('应该正确评估选择器', async () => {
      const mockPage = {
        evaluate: vi.fn((fn, selectors) => {
          // 模拟找到元素
          return Promise.resolve(true)
        })
      }

      const result = await (adapter as any).evaluateSelector(
        mockPage,
        ['.test-selector'],
        false
      )

      expect(result).toBe(true)
      expect(mockPage.evaluate).toHaveBeenCalled()
    })

    it('应该处理选择器语法错误', async () => {
      const mockPage = {
        evaluate: vi.fn().mockImplementation(() => {
          throw new Error('Invalid selector')
        })
      }

      const result = await (adapter as any).evaluateSelector(
        mockPage,
        ['.invalid-selector'],
        false
      )

      expect(result).toBe(false)
    })

    it('应该支持 multiple 模式返回多个元素', async () => {
      const mockPage = {
        evaluate: vi.fn((fn, selectors) => {
          return Promise.resolve([{ id: 'el1' }, { id: 'el2' }])
        })
      }

      const result = await (adapter as any).evaluateSelector(
        mockPage,
        ['.test-selector'],
        true
      )

      expect(result).toBeInstanceOf(Array)
    })
  })

  describe('waitForElement()', () => {
    it('应该在元素出现时返回 true', async () => {
      const mockPage = {
        waitForTimeout: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn()
          .mockResolvedValueOnce(false)  // 第一次检查
          .mockResolvedValueOnce(true)   // 第二次检查找到元素
      }

      const result = await (adapter as any).waitForElement(
        mockPage,
        ['.test-element'],
        1000
      )

      expect(result).toBe(true)
    })

    it('应该在超时时返回 false', async () => {
      const mockPage = {
        waitForTimeout: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockResolvedValue(false)
      }

      const result = await (adapter as any).waitForElement(
        mockPage,
        ['.non-existent'],
        100  // 短超时
      )

      expect(result).toBe(false)
    })
  })

  describe('fetchImageAsBase64()', () => {
    it('应该直接返回 data: URL', async () => {
      const dataUrl = 'data:image/png;base64,abc123'
      const result = await (adapter as any).fetchImageAsBase64(dataUrl)
      expect(result).toBe(dataUrl)
    })

    it('应该处理无效的 URL', async () => {
      // 模拟 axios 失败
      const result = await (adapter as any).fetchImageAsBase64('invalid-url')
      expect(result).toBeNull()
    })
  })

  describe('clickSubmitTarget()', () => {
    // 2026-09-17：BaseAdapter 已移除 clickElement()，"点击 + 可点性 + click 是否送达"探测
    // 统一由 clickSubmitTarget() 完成（返回 ClickTargetState，含 clickFired）。
    // 原 clickElement() 两条用例按此新契约改写，保留"成功点击 / 元素不存在"的原意。
    it('应该成功点击元素并回报 clickFired=true', async () => {
      const mockPage = {
        evaluate: vi.fn().mockResolvedValue({
          found: true, visible: true, enabled: true, occluded: false, clickable: true, clickFired: true
        })
      }

      const result = await (adapter as any).clickSubmitTarget(
        mockPage,
        ['.clickable-button']
      )

      expect(result.clickFired).toBe(true)
      expect(result.clickable).toBe(true)
    })

    it('应该在元素不存在时回报 found=false / clickFired=false', async () => {
      const mockPage = {
        evaluate: vi.fn().mockResolvedValue({
          found: false, visible: false, enabled: false, occluded: false, clickable: false, clickFired: false
        })
      }

      const result = await (adapter as any).clickSubmitTarget(
        mockPage,
        ['.non-existent']
      )

      expect(result.found).toBe(false)
      expect(result.clickFired).toBe(false)
    })
  })

  describe('fillInput()', () => {
    it('应该成功填入文本', async () => {
      const mockPage = {
        evaluate: vi.fn((fn, selectors, text) => {
          return Promise.resolve(true)
        })
      }

      const result = await (adapter as any).fillInput(
        mockPage,
        ['.text-input'],
        '测试文本'
      )

      expect(result).toBe(true)
    })

    it('应该在输入框不存在时返回 false', async () => {
      const mockPage = {
        evaluate: vi.fn((fn, selectors, text) => {
          return Promise.resolve(false)
        })
      }

      const result = await (adapter as any).fillInput(
        mockPage,
        ['.non-existent'],
        '测试'
      )

      expect(result).toBe(false)
    })
  })

  describe('日志记录', () => {
    it('应该记录操作日志', () => {
      (adapter as any).logOperation('测试操作', { key: 'value' })
      expect(mockLogger.info).toHaveBeenCalledWith(
        '[test] 测试操作',
        { key: 'value' }
      )
    })

    it('应该记录错误日志', () => {
      const error = new Error('测试错误')
      ;(adapter as any).logError('测试操作', error)
      expect(mockLogger.error).toHaveBeenCalledWith(
        '[test] 测试操作 失败',
        error
      )
    })
  })
})
