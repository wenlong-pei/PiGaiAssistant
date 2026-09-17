/**
 * ZhixueAdapter 智学网适配器测试
 * 验证智学网专用逻辑的正确性
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { LogService } from '../../../electron/services/LogService'
import { ConfigService } from '../../../electron/services/ConfigService'
import { ZhixueAdapter } from '../../../electron/adapters/ZhixueAdapter'

describe('ZhixueAdapter 智学网适配器', () => {
  let adapter: ZhixueAdapter
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
      // BaseAdapter.getPlatformDisplayName() 会调用 configService.getPlatformDisplayName()，
      // 旧桩件缺少此方法导致构造函数抛 TypeError、整个套件 13 条用例全灭。
      getPlatformDisplayName: vi.fn().mockReturnValue('智学网'),
      getZhixueScoreInputSelectors: vi.fn().mockReturnValue({
        SCORE_INPUT: 'input[type="number"]',
        SCORE_INPUT_NEW: '#inputScore',
        SCORE_INPUT_ALL_NEW: '#allScore',
        SCORE_INPUT_PLACEHOLDER: 'input[placeholder*="分数"]'
      }),
      getZhixueAnswerAreaSelector: vi.fn().mockReturnValue('img.answer-image'),
      // captureAnswerImage() 通过 getAnswerImageSelectors() 取选择器列表，旧桩件缺此方法
      // 会让 for...of 遍历 undefined 抛错、被 catch 吞掉后恒返回 null。
      getAnswerImageSelectors: vi.fn().mockReturnValue(['img.answer-image']),
      getZhixueSubmitButtonSelectors: vi.fn().mockReturnValue({
        SUBMIT_BUTTON_NEW: 'button.submit',
        SUBMIT_BUTTON_TEXT: '提交分数'
      }),
      getZhixueNextButtonSelectors: vi.fn().mockReturnValue({
        NEXT_BUTTON_TEXT: '下一题'
      })
    }

    adapter = new ZhixueAdapter(mockLogger as any, mockConfigService as any)
  })

  describe('platformName', () => {
    it('应该返回 "zhixue"', () => {
      expect(adapter.platformName).toBe('zhixue')
      expect(adapter.getPlatformName()).toBe('zhixue')
    })
  })

  describe('analyzePage()', () => {
    it('应该识别智学网页面（旧版 UI）', async () => {
      const mockPage = {
        // 2026-09-17 随「阻断-03 提交结果核验」更新：analyzePage 连续调用 page.evaluate，
        //   1) 采集页面信息（对象） 2) 探测分数输入框（布尔） 3) 探测提交按钮（布尔）。
        // 旧桩件对每次调用都返回同一个对象，导致 hasScoreInput/found 变成对象而非布尔。
        evaluate: vi.fn()
          .mockResolvedValueOnce({
            isZhixue: true,
            isOldUI: true,
            isNewUI: false,
            questionContent: '第一题：计算 1+1',
            pageTitle: '智学网 - 在线阅卷'
          })
          .mockResolvedValue(true),
        url: vi.fn().mockReturnValue('https://www.zhixue.com/grading/123')
      }

      const result = await adapter.analyzePage(mockPage)

      expect(result.found).toBe(true)
      expect(result.platformName).toBe('zhixue')
      expect(result.hasAnswerImage).toBe(true)
    })

    it('应该识别智学网页面（新版 UI）', async () => {
      const mockPage = {
        // 同上：第一次返回页面信息对象，后续返回布尔探测结果
        evaluate: vi.fn()
          .mockResolvedValueOnce({
            isZhixue: true,
            isOldUI: false,
            isNewUI: true,
            questionContent: '第二题：选择题',
            pageTitle: '智学网'
          })
          .mockResolvedValue(true),
        url: vi.fn().mockReturnValue('https://www.zhixueyun.com/paper/456')
      }

      const result = await adapter.analyzePage(mockPage)

      expect(result.found).toBe(true)
      expect(result.hasAnswerImage).toBe(true)
    })

    it('应该拒绝非智学网页面', async () => {
      const mockPage = {
        evaluate: vi.fn((fn, args) => {
          return Promise.resolve({
            isZhixue: false,
            isOldUI: false,
            isNewUI: false
          })
        }),
        url: vi.fn().mockReturnValue('https://www.google.com')
      }

      const result = await adapter.analyzePage(mockPage)

      expect(result.found).toBe(false)
      expect(result.error).toContain('不是智学网平台')
    })

    it('应该处理页面连接断开的情况', async () => {
      const mockPage = {
        evaluate: vi.fn().mockRejectedValue(new Error('Target closed')),
        url: vi.fn().mockReturnValue('https://www.zhixue.com')
      }

      const result = await adapter.analyzePage(mockPage)

      expect(result.found).toBe(false)
      expect(result.error).toContain('页面连接已断开')
    })
  })

  describe('captureAnswerImage()', () => {
    it('应该成功捕获答案图片', async () => {
      const mockPage = {
        evaluate: vi.fn((fn, selectors) => {
          return Promise.resolve('https://www.zhixue.com/images/answer123.png')
        })
      }

      // Mock fetchImageAsBase64
      const base64Result = 'data:image/png;base64,mockedImageData'
      ;(adapter as any).fetchImageAsBase64 = vi.fn().mockResolvedValue(base64Result)

      const result = await adapter.captureAnswerImage(mockPage)

      expect(result).toBe(base64Result)
    })

    it('应该在图片不存在时返回 null', async () => {
      const mockPage = {
        evaluate: vi.fn((fn, selectors) => {
          return Promise.resolve(null)
        })
      }

      const result = await adapter.captureAnswerImage(mockPage)

      expect(result).toBeNull()
    })
  })

  describe('submitScore()', () => {
    it('应该成功提交分数', async () => {
      // 2026-09-17 随「阻断-03 提交结果核验」更新：
      // submitScore 分多次 page.evaluate：填分(返回 'filled') → inspectScoreInput
      // → clickSubmitTarget(含 clickFired) → verifySubmitOutcome。
      // 桩件必须按调用顺序返回匹配结构，否则走不到"成功"分支。
      const mockPage = {
        evaluate: vi.fn()
          .mockResolvedValueOnce('filled') // fillStatus：写入前已判可见/可用
          .mockResolvedValueOnce({ found: true, visible: true, enabled: true, occluded: false, accepted: true, actual: '85' }) // inspectScoreInput
          .mockResolvedValueOnce({ found: true, visible: true, enabled: true, occluded: false, clickable: true, clickFired: true }) // clickSubmitTarget
          .mockResolvedValueOnce({ verdict: 'success', reason: '检测到提交成功提示' }), // verifySubmitOutcome
        waitForTimeout: vi.fn().mockResolvedValue(undefined),
        url: vi.fn().mockReturnValue('https://www.zhixue.com/grading/123'),
        keyboard: {
          press: vi.fn().mockResolvedValue(undefined)
        }
      }

      // 点击提交按钮现由 BaseAdapter.clickSubmitTarget 统一负责（并探测 clickFired）
      const clickSpy = vi.spyOn(adapter as any, 'clickSubmitTarget')

      const result = await adapter.submitScore(mockPage, 85)

      expect(result).toBe(true)
      expect(clickSpy).toHaveBeenCalled()
    })

    it('提交按钮点击被拦截（clickFired=false）时应上报失败', async () => {
      // 2026-09-17 随「阻断-03」更新：点击被弹窗/遮罩吞掉时 clickFired=false → 返回 false；
      // 不再使用无法验证结果的回车兜底。
      const mockPage = {
        evaluate: vi.fn()
          .mockResolvedValueOnce('filled')
          .mockResolvedValueOnce({ found: true, visible: true, enabled: true, occluded: false, accepted: true, actual: '90' })
          .mockResolvedValueOnce({ found: true, visible: true, enabled: true, occluded: false, clickable: true, clickFired: false }),
        waitForTimeout: vi.fn().mockResolvedValue(undefined),
        url: vi.fn().mockReturnValue('https://www.zhixue.com/grading/123'),
        keyboard: {
          press: vi.fn().mockResolvedValue(undefined)
        }
      }

      const result = await adapter.submitScore(mockPage, 90)

      expect(result).toBe(false)
      expect(mockPage.keyboard.press).not.toHaveBeenCalledWith('Enter')
    })
  })

  describe('goToNext()', () => {
    it('应该成功切换到下一题（三态：ok）', async () => {
      // 2026-09-17 随「阻断-01 切题三态」更新：goToNext 返回 'ok' | 'last' | 'error'，不再是布尔值
      const mockPage = {
        evaluate: vi.fn().mockResolvedValue({ state: 'clicked', reason: '已点击下一题控件' }),
        waitForTimeout: vi.fn().mockResolvedValue(undefined)
      }

      const result = await adapter.goToNext(mockPage)

      expect(result).toBe('ok')
    })

    it('无法确认下一题控件时返回 error（绝不当作正常结束）', async () => {
      // 2026-09-17 随「阻断-01 切题三态」更新：
      // 探测不到可用控件时必须返回 'error'；旧断言的布尔 false 会把"异常"与"最后一题"混为一谈。
      const mockPage = {
        evaluate: vi.fn().mockResolvedValue({ state: 'missing', reason: '未找到可用的下一题控件' }),
        waitForTimeout: vi.fn().mockResolvedValue(undefined),
        keyboard: {
          press: vi.fn().mockResolvedValue(undefined)
        }
      }

      const result = await adapter.goToNext(mockPage)

      // 即使无法确认也不应该抛出异常，而是返回 error 交由上层区分
      expect(result).toBe('error')
    })
  })

  describe('validatePage()', () => {
    it('应该验证智学网 URL', async () => {
      const mockPage = {
        url: vi.fn().mockReturnValue('https://www.zhixue.com/grading/123')
      }

      const result = await adapter.validatePage(mockPage)

      expect(result).toBe(true)
    })

    it('应该拒绝非智学网 URL', async () => {
      const mockPage = {
        url: vi.fn().mockReturnValue('https://www.example.com')
      }

      const result = await adapter.validatePage(mockPage)

      expect(result).toBe(false)
    })
  })
})
