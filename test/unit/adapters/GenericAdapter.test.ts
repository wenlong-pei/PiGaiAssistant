/**
 * GenericAdapter 通用适配器测试
 * 验证通用适配器可以适配大部分在线阅卷平台
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { LogService } from '../../../electron/services/LogService'
import { ConfigService } from '../../../electron/services/ConfigService'
import { GenericAdapter } from '../../../electron/adapters/GenericAdapter'

describe('GenericAdapter 通用适配器', () => {
  let adapter: GenericAdapter
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
      getAnswerImageSelectors: vi.fn().mockReturnValue(['img.answer']),
      getScoreInputSelectors: vi.fn().mockReturnValue(['input[type="number"]']),
      getSubmitButtonSelectors: vi.fn().mockReturnValue({
        text: '提交',
        selectors: ['button.submit']
      }),
      getNextButtonSelectors: vi.fn().mockReturnValue({
        text: '下一题',
        selectors: ['button.next']
      }),
      getQuestionTitleSelectors: vi.fn().mockReturnValue(['h3', 'h4'])
    }

    adapter = new GenericAdapter(mockLogger as any, mockConfigService as any)
  })

  describe('platformName', () => {
    it('应该返回 "generic"', () => {
      expect(adapter.platformName).toBe('generic')
      expect(adapter.getPlatformName()).toBe('generic')
    })
  })

  describe('analyzePage()', () => {
    it('应该检测页面基本结构', async () => {
      const mockPage = {
        evaluate: vi.fn((fn) => {
          return Promise.resolve({
            url: 'https://www.example.com/grading',
            title: '在线阅卷',
            hasImages: true,
            hasInputs: true,
            hasButtons: true
          })
        })
      }

      // Mock evaluateSelector
      ;(adapter as any).evaluateSelector = vi.fn()
        .mockResolvedValueOnce(true)  // answerImage
        .mockResolvedValueOnce(true)  // scoreInput
        .mockResolvedValueOnce(true)  // submitButton
        .mockResolvedValueOnce(true)  // nextButton

      const result = await adapter.analyzePage(mockPage)

      expect(result.found).toBe(true)
      expect(result.platformName).toBe('generic')
      expect(result.hasAnswerImage).toBe(true)
      expect(result.hasScoreInput).toBe(true)
    })

    it('应该只要有答案图片或分数输入框就认为可用', async () => {
      const mockPage = {
        evaluate: vi.fn((fn) => {
          return Promise.resolve({
            url: 'https://www.example.com',
            title: '测试',
            hasImages: true,
            hasInputs: false,
            hasButtons: false
          })
        })
      }

      // 只有答案图片，没有分数输入框
      ;(adapter as any).evaluateSelector = vi.fn()
        .mockResolvedValueOnce(true)   // answerImage = true
        .mockResolvedValueOnce(false)  // scoreInput = false
        .mockResolvedValueOnce(false)  // submitButton = false
        .mockResolvedValueOnce(false)  // nextButton = false

      const result = await adapter.analyzePage(mockPage)

      // found 应该是 true，因为 hasAnswerImage = true
      expect(result.found).toBe(true)
    })

    it('应该提取题目内容', async () => {
      const mockPage = {
        evaluate: vi.fn((fn) => {
          if (typeof fn === 'function') {
            return Promise.resolve({
              url: 'https://www.example.com',
              title: '测试',
              hasImages: true,
              hasInputs: true,
              hasButtons: true
            })
          } else {
            // 题目内容查询
            return Promise.resolve('第一题：计算 2+2')
          }
        })
      }

      ;(adapter as any).evaluateSelector = vi.fn()
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true)

      const result = await adapter.analyzePage(mockPage)

      expect(result.questionContent).toBeDefined()
    })
  })

  describe('captureAnswerImage()', () => {
    it('应该成功捕获答案图片', async () => {
      const mockPage = {
        evaluate: vi.fn((fn, selectors) => {
          return Promise.resolve('https://example.com/answer.png')
        })
      }

      ;(adapter as any).fetchImageAsBase64 = vi.fn().mockResolvedValue(
        'data:image/png;base64,mocked'
      )

      const result = await adapter.captureAnswerImage(mockPage)

      expect(result).toContain('base64')
    })

    it('应该降级查找较大的图片', async () => {
      const mockPage = {
        evaluate: vi.fn((fn, selectors) => {
          // 第一次调用：找不到指定选择器
          // 第二次调用：查找所有图片，找到大图
          if (fn === selectors) {
            return Promise.resolve(null)
          }
          return Promise.resolve('https://example.com/large-image.png')
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
    it('应该成功填入分数并提交', async () => {
      // 2026-09-17 随「阻断-03 提交结果核验」更新：
      // submitScore 在填分后会做三次 page.evaluate 核验：inspectScoreInput →
      // clickSubmitTarget(含 clickFired) → verifySubmitOutcome。桩件需按顺序返回对应结构。
      const mockPage = {
        evaluate: vi.fn()
          .mockResolvedValueOnce({ found: true, visible: true, enabled: true, occluded: false, accepted: true, actual: '95' }) // inspectScoreInput
          .mockResolvedValueOnce({ found: true, visible: true, enabled: true, occluded: false, clickable: true, clickFired: true }) // clickSubmitTarget
          .mockResolvedValueOnce({ verdict: 'success', reason: '检测到提交成功提示' }), // verifySubmitOutcome
        waitForTimeout: vi.fn().mockResolvedValue(undefined),
        url: vi.fn().mockReturnValue('https://www.example.com/grading'),
        keyboard: {
          press: vi.fn().mockResolvedValue(undefined)
        }
      }

      // Mock fillInput 成功
      ;(adapter as any).fillInput = vi.fn().mockResolvedValue(true)

      const result = await adapter.submitScore(mockPage, 95)

      expect(result).toBe(true)
      expect((adapter as any).fillInput).toHaveBeenCalledWith(
        mockPage,
        expect.any(Array),
        '95'
      )
    })

    it('应该在找不到分数输入框时返回 false', async () => {
      const mockPage = {}

      // Mock fillInput 失败
      ;(adapter as any).fillInput = vi.fn().mockResolvedValue(false)

      const result = await adapter.submitScore(mockPage, 80)

      expect(result).toBe(false)
    })
  })

  describe('goToNext()', () => {
    it('应该成功点击下一题按钮（三态：ok）', async () => {
      // 2026-09-17 随「阻断-01 切题三态」更新：goToNext 返回 'ok' | 'last' | 'error'
      const mockPage = {
        evaluate: vi.fn().mockResolvedValue({ state: 'clicked', reason: '已点击下一题控件' }),
        waitForTimeout: vi.fn().mockResolvedValue(undefined),
        keyboard: {
          press: vi.fn().mockResolvedValue(undefined)
        }
      }

      const result = await adapter.goToNext(mockPage)

      expect(result).toBe('ok')
    })

    it('找不到下一题控件时返回 error（不再用右箭头兜底伪造结束）', async () => {
      // 2026-09-17 随「阻断-01 切题三态」更新：
      // 旧实现找不到按钮即返回布尔 false（会被上层当"没有更多试卷"），
      // 新契约要求无法确认时返回 'error'，且不再使用无法确认结果的 ArrowRight 兜底。
      const mockPage = {
        evaluate: vi.fn().mockResolvedValue({ state: 'missing', reason: '未找到可用的下一题控件' }),
        waitForTimeout: vi.fn().mockResolvedValue(undefined),
        keyboard: {
          press: vi.fn().mockResolvedValue(undefined)
        }
      }

      const result = await adapter.goToNext(mockPage)

      expect(result).toBe('error')
      expect(mockPage.keyboard.press).not.toHaveBeenCalledWith('ArrowRight')
    })
  })

  describe('validatePage()', () => {
    it('应该验证页面是否有输入框或按钮', async () => {
      const mockPage = {
        evaluate: vi.fn((fn) => {
          return Promise.resolve({
            hasInputs: true,
            hasButtons: true
          })
        })
      }

      const result = await adapter.validatePage(mockPage)

      expect(result).toBe(true)
    })

    it('应该在页面没有任何输入元素时返回 false', async () => {
      const mockPage = {
        evaluate: vi.fn((fn) => {
          return Promise.resolve({
            hasInputs: false,
            hasButtons: false
          })
        })
      }

      const result = await adapter.validatePage(mockPage)

      expect(result).toBe(false)
    })
  })
})
