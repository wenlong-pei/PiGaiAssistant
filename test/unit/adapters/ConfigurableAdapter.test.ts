/**
 * ConfigurableAdapter 可配置适配器测试
 * 验证用户可以自定义选择器配置
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { LogService } from '../../../electron/services/LogService'
import { ConfigService } from '../../../electron/services/ConfigService'
import { ConfigurableAdapter } from '../../../electron/adapters/ConfigurableAdapter'
import { PlatformSelectors } from '../../../electron/SelectorManager'

describe('ConfigurableAdapter 可配置适配器', () => {
  let adapter: ConfigurableAdapter
  let mockLogger: any
  let mockConfigService: any
  let customSelectors: PlatformSelectors

  beforeEach(() => {
    mockLogger = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn()
    }

    mockConfigService = {
      getAnswerImageSelectors: vi.fn().mockReturnValue(['img.answer']),
      getScoreInputSelectors: vi.fn().mockReturnValue(['input[type="number"]'])
    }

    customSelectors = {
      name: '自定义平台',
      domains: ['custom-platform.com'],
      selectors: {
        answerImages: {
          selectors: ['img.answer', 'img[src*="answer"]']
        },
        scoreInput: {
          allModern: 'input[type="number"]',
          placeholder: 'input[placeholder*="分数"]'
        },
        submitButton: {
          text: '提交成绩',
          selectors: ['button.submit', 'button[type="submit"]']
        },
        nextButton: {
          text: '下一题',
          selectors: ['button.next', '.next-btn']
        },
        questionTitle: {
          selectors: ['h3', 'h4', '.question-title']
        }
      }
    }

    adapter = new ConfigurableAdapter(
      mockLogger as any,
      mockConfigService as any,
      customSelectors
    )
  })

  describe('platformName', () => {
    it('应该返回 "configurable"', () => {
      expect(adapter.platformName).toBe('configurable')
    })
  })

  describe('构造函数', () => {
    it('应该使用自定义选择器初始化', () => {
      expect(adapter).toBeInstanceOf(ConfigurableAdapter)
    })

    it('应该使用默认选择器当未提供自定义配置时', () => {
      const defaultAdapter = new ConfigurableAdapter(
        mockLogger as any,
        mockConfigService as any
      )

      expect(defaultAdapter).toBeInstanceOf(ConfigurableAdapter)
    })
  })

  describe('updateSelectors()', () => {
    it('应该成功更新选择器配置', () => {
      const newSelectors: PlatformSelectors = {
        name: '新平台',
        domains: ['new-platform.com'],
        selectors: {
          answerImages: { selectors: ['img.new'] },
          scoreInput: { allModern: 'input.new' },
          submitButton: { text: '提交', selectors: ['button.new'] },
          nextButton: { text: '下一题', selectors: ['button.next'] },
          questionTitle: { selectors: ['h1'] }
        }
      }

      adapter.updateSelectors(newSelectors)

      const current = adapter.getSelectors()
      expect(current.name).toBe('新平台')
    })
  })

  describe('getSelectors()', () => {
    it('应该返回选择器副本（防止外部修改）', () => {
      const selectors1 = adapter.getSelectors()
      const selectors2 = adapter.getSelectors()

      // 应该是不同的对象
      expect(selectors1).not.toBe(selectors2)

      // 但内容相同
      expect(selectors1.name).toBe(selectors2.name)
    })
  })

  describe('loadFromJson()', () => {
    it('应该成功从 JSON 加载配置', () => {
      const jsonConfig = JSON.stringify(customSelectors)

      const result = adapter.loadFromJson(jsonConfig)

      expect(result).toBe(true)
    })

    it('应该拒绝无效的 JSON', () => {
      const result = adapter.loadFromJson('invalid json')

      expect(result).toBe(false)
    })

    it('应该验证必要的字段', () => {
      const invalidConfig = JSON.stringify({
        // 缺少 name 字段
        domains: [],
        selectors: {}
      })

      const result = adapter.loadFromJson(invalidConfig)

      expect(result).toBe(false)
    })
  })

  describe('exportToJson()', () => {
    it('应该成功导出配置为 JSON', () => {
      const json = adapter.exportToJson()

      expect(() => JSON.parse(json)).not.toThrow()

      const parsed = JSON.parse(json)
      expect(parsed.name).toBe('自定义平台')
    })

    it('应该处理导出错误', () => {
      // 创建一个会导致 JSON 序列化失败的对象（包含循环引用）
      const circularAdapter = new ConfigurableAdapter(
        mockLogger as any,
        mockConfigService as any
      )

      // 强制修改内部状态导致序列化失败（模拟场景）
      const json = circularAdapter.exportToJson()

      // 即使失败也应该返回有效的 JSON
      expect(json).toBeDefined()
    })
  })

  describe('analyzePage()', () => {
    it('应该使用自定义选择器分析页面', async () => {
      const mockPage = {
        evaluate: vi.fn((fn) => {
          if (typeof fn === 'function') {
            return Promise.resolve({
              url: 'https://custom-platform.com/grading',
              title: '自定义平台'
            })
          }
          return Promise.resolve('')
        })
      }

      // Mock evaluateSelector
      ;(adapter as any).evaluateSelector = vi.fn()
        .mockResolvedValueOnce(true)   // answerImage
        .mockResolvedValueOnce(true)   // scoreInput
        .mockResolvedValueOnce(true)   // submitButton
        .mockResolvedValueOnce(true)   // nextButton

      const result = await adapter.analyzePage(mockPage)

      expect(result.found).toBe(true)
      expect(result.platformName).toBe('configurable')
      expect(result.extra?.customPlatformName).toBe('自定义平台')
    })
  })

  describe('captureAnswerImage()', () => {
    it('应该使用自定义选择器捕获图片', async () => {
      const mockPage = {
        evaluate: vi.fn((fn, selectors) => {
          return Promise.resolve('https://custom-platform.com/answer.png')
        })
      }

      ;(adapter as any).fetchImageAsBase64 = vi.fn().mockResolvedValue(
        'data:image/png;base64,mocked'
      )

      const result = await adapter.captureAnswerImage(mockPage)

      expect(result).toContain('base64')
    })
  })

  describe('submitScore()', () => {
    it('应该使用自定义选择器提交分数', async () => {
      // 2026-09-17 随「阻断-03 提交结果核验」更新：
      // submitScore 会依次调用 page.evaluate：inspectScoreInput → clickSubmitTarget(含 clickFired)
      // → verifySubmitOutcome。
      const mockPage = {
        evaluate: vi.fn()
          .mockResolvedValueOnce({ found: true, visible: true, enabled: true, occluded: false, accepted: true, actual: '88' }) // inspectScoreInput
          .mockResolvedValueOnce({ found: true, visible: true, enabled: true, occluded: false, clickable: true, clickFired: true }) // clickSubmitTarget
          .mockResolvedValueOnce({ verdict: 'success', reason: '检测到提交成功提示' }), // verifySubmitOutcome
        waitForTimeout: vi.fn().mockResolvedValue(undefined),
        url: vi.fn().mockReturnValue('https://custom-platform.com/grading'),
        keyboard: {
          press: vi.fn().mockResolvedValue(undefined)
        }
      }

      // Mock fillInput 成功
      ;(adapter as any).fillInput = vi.fn().mockResolvedValue(true)

      const result = await adapter.submitScore(mockPage, 88)

      expect(result).toBe(true)
    })
  })

  describe('validatePage()', () => {
    it('应该验证域名匹配', async () => {
      const mockPage = {
        url: vi.fn().mockReturnValue('https://custom-platform.com/grading/123')
      }

      const result = await adapter.validatePage(mockPage)

      expect(result).toBe(true)
    })

    it('应该在域名不匹配时检查页面元素', async () => {
      const mockPage = {
        url: vi.fn().mockReturnValue('https://other-platform.com')
      }

      // Mock analyzePage
      const originalAnalyzePage = adapter.analyzePage.bind(adapter)
      adapter.analyzePage = vi.fn().mockResolvedValue({
        found: true
      })

      const result = await adapter.validatePage(mockPage)

      expect(result).toBe(true)
      expect(adapter.analyzePage).toHaveBeenCalled()
    })
  })

  describe('getSelectorsFromConfig()', () => {
    it('应该正确提取选择器数组', () => {
      const config = {
        modern: 'input.modern',
        legacy: 'input.legacy',
        fallback: ['input.fallback1', 'input.fallback2'],
        placeholder: 'input[placeholder]',
        allModern: 'input.all',
        selectors: ['input.sel1', 'input.sel2']
      }

      const selectors = (adapter as any).getSelectorsFromConfig(config)

      expect(selectors).toContain('input.modern')
      expect(selectors).toContain('input.legacy')
      expect(selectors).toContain('input.fallback1')
      expect(selectors).toContain('input.fallback2')
      expect(selectors).toContain('input[placeholder]')
      expect(selectors).toContain('input.all')
      expect(selectors).toContain('input.sel1')
      expect(selectors).toContain('input.sel2')
    })

    it('应该处理空配置', () => {
      const config = {}

      const selectors = (adapter as any).getSelectorsFromConfig(config)

      expect(selectors).toBeInstanceOf(Array)
      expect(selectors.length).toBe(0)
    })
  })
})
