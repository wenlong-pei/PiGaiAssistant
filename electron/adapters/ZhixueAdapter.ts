/**
 * 智学网平台适配器
 * 实现智学网专用的页面分析、答案捕获、分数提交等功能
 */

import { LogService } from '../services/LogService'
import { ConfigService } from '../services/ConfigService'
import { BaseAdapter } from './BaseAdapter'
import { PlatformPageAnalysisResult, NextPaperResult } from './PlatformAdapter.interface'

/**
 * 智学网适配器类
 * 继承自 BaseAdapter，实现智学网专用逻辑
 */
export class ZhixueAdapter extends BaseAdapter {
  /** 平台名称 */
  readonly platformName: string = 'zhixue'

  /**
   * 构造函数
   * @param logger - 日志服务实例
   * @param configService - 配置服务实例
   */
  constructor(logger: LogService, configService: ConfigService) {
    super(logger, configService)
    this.logOperation(`初始化${this.getPlatformDisplayName()}适配器`)
  }

  /**
   * 分析页面结构
   * @param page - Playwright Page 对象
   * @returns 页面分析结果
   */
  async analyzePage(page: any): Promise<PlatformPageAnalysisResult> {
    this.logOperation('开始分析页面')

    try {
      // 获取选择器配置
      const zhixueSelectors = this.configService.getZhixueScoreInputSelectors()
      const answerSelectors = this.configService.getZhixueAnswerAreaSelector()

      // 检测页面结构和内容
      const pageInfo = await page.evaluate((selectors: any) => {
        const url = window.location.href
        const isZhixue = url.includes('zhixue.com') || url.includes('zhixueyun.com')

        if (!isZhixue) {
          return { isZhixue: false, isOldUI: false, isNewUI: false }
        }

        // 检测新旧版 UI
        const hasOldUI = document.querySelector(selectors.ANSWER_IMAGE) !== null
        const hasNewUI = document.querySelector(selectors.ANSWER_IMAGE_NEW) !== null

        // 获取题目内容
        let questionContent = ''
        const questionSelectors = [
          '.question-content', '.topic-content', '.stem-content',
          '.question-stem', '[class*="question"] [class*="content"]',
        ]
        for (const sel of questionSelectors) {
          const el = document.querySelector(sel)
          if (el && el.textContent?.trim()) {
            questionContent = el.textContent.trim().substring(0, 500)
            break
          }
        }

        return {
          isZhixue: true,
          isOldUI: hasOldUI,
          isNewUI: hasNewUI,
          url: url,
          questionContent,
          pageTitle: document.title || '',
        }
      }, { ANSWER_IMAGE: answerSelectors })

      // 如果不是智学网页面
      if (!pageInfo.isZhixue) {
        return {
          found: false,
          error: `当前页面不是${this.configService.getPlatformDisplayName('zhixue')}平台`,
          platformName: this.platformName,
        }
      }

      // 检测智学网特定元素
      const hasAnswerImage = pageInfo.isOldUI || pageInfo.isNewUI
      let hasScoreInput = false
      let hasSubmitButton = false

      try {
        hasScoreInput = await page.evaluate((selectors: any) => {
          return !!(document.querySelector(selectors.SCORE_INPUT_NEW) ||
                    document.querySelector(selectors.SCORE_INPUT_ALL_NEW) ||
                    document.querySelector(selectors.SCORE_INPUT_PLACEHOLDER) ||
                    document.querySelector(selectors.SCORE_INPUT))
        }, zhixueSelectors)

        hasSubmitButton = await page.evaluate((selectors: any) => {
          return !!(document.querySelector(selectors.SUBMIT_BUTTON_NEW) ||
                    Array.from(document.querySelectorAll('button')).some((btn: any) =>
                      btn.textContent?.includes(selectors.SUBMIT_BUTTON_TEXT)))
        }, this.configService.getZhixueSubmitButtonSelectors())
      } catch (evaluateError: any) {
        if (evaluateError.message?.includes('closed') || evaluateError.message?.includes('Target')) {
          return {
            found: false,
            error: '页面连接已断开，请重新打开链接',
            platformName: this.platformName,
          }
        }
        throw evaluateError
      }

      const result: PlatformPageAnalysisResult = {
        found: hasAnswerImage && hasScoreInput,
        platformName: this.platformName,
        hasAnswerImage,
        hasScoreInput,
        hasSubmitButton,
        questionContent: pageInfo.questionContent || '',
        pageTitle: pageInfo.pageTitle || '',
      }

      this.logOperation('页面分析完成', result)
      return result
    } catch (error: any) {
      this.logError('分析页面', error)
      if (error.message?.includes('closed') || error.message?.includes('Target')) {
        return {
          found: false,
          error: '页面连接已断开，请重新打开链接',
          platformName: this.platformName,
        }
      }
      return {
        found: false,
        error: String(error),
        platformName: this.platformName,
      }
    }
  }

  /**
   * 捕获答案图片
   * @param page - Playwright Page 对象
   * @returns base64 编码的图片数据或 null
   */
  async captureAnswerImage(page: any): Promise<string | null> {
    this.logOperation('开始捕获答案图片')

    try {
      // 获取答案图片选择器
      const imageSelectors = this.configService.getAnswerImageSelectors()

      // 查找答案图片
      const imageUrl = await page.evaluate((selectors: string[]) => {
        for (const selector of selectors) {
          const el = document.querySelector(selector) as HTMLImageElement
          if (el && el.src) {
            return el.src
          }
        }
        return null
      }, imageSelectors)

      if (!imageUrl) {
        this.logger.warn(`[${this.configService.getPlatformDisplayName('zhixue')}适配器] 未找到答案图片`)
        return null
      }

      // 获取图片并转为 base64
      const base64 = await this.fetchImageAsBase64(imageUrl)
      this.logOperation('答案图片捕获完成')
      return base64
    } catch (error) {
      this.logError('捕获答案图片', error as Error)
      return null
    }
  }

  /**
   * 提交分数
   * @param page - Playwright Page 对象
   * @param score - 分数
   * @returns 是否成功
   */
  async submitScore(page: any, score: number): Promise<boolean> {
    this.logOperation('开始提交分数', { score })

    try {
      const selectors = this.configService.getZhixueScoreInputSelectors()

      const scoreInputSelectors = [
        selectors.SCORE_INPUT_ALL_NEW,
        selectors.SCORE_INPUT_NEW,
        selectors.SCORE_INPUT_PLACEHOLDER,
        selectors.SCORE_INPUT,
      ]

      // 填入分数
      // 修复 BUG-EXE-001：page.evaluate 只接受一个参数，此前传 (score, selectors)
      // 会抛 "Too many arguments"，导致分数永远填不进去、提交必然失败。
      // 修复 QA EXE-4：写入前先判断输入框可见且可用；disabled / 不可见时不写入、不触发事件。
      const fillStatus = await page.evaluate(({ scoreValue, s }: { scoreValue: number; s: any }) => {
        const list = [s.SCORE_INPUT_ALL_NEW, s.SCORE_INPUT_NEW, s.SCORE_INPUT_PLACEHOLDER, s.SCORE_INPUT]
        let anyFound = false
        for (const selector of list) {
          if (!selector) continue
          let input: HTMLInputElement | null = null
          try {
            input = document.querySelector(selector) as HTMLInputElement | null
          } catch {
            continue
          }
          if (!input) continue
          anyFound = true

          const style = window.getComputedStyle(input)
          const rect = input.getBoundingClientRect()
          const visible = style.display !== 'none' && style.visibility !== 'hidden' &&
            style.opacity !== '0' && rect.width > 0 && rect.height > 0
          if (!visible) continue
          if (input.disabled || input.getAttribute('aria-disabled') === 'true') return 'disabled'

          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
          if (setter) {
            setter.call(input, String(scoreValue))
          } else {
            input.value = String(scoreValue)
          }

          input.dispatchEvent(new Event('input', { bubbles: true }))
          input.dispatchEvent(new Event('change', { bubbles: true }))
          input.dispatchEvent(new Event('blur', { bubbles: true }))
          return 'filled'
        }
        return anyFound ? 'not-visible' : 'not-found'
      }, { scoreValue: score, s: selectors })

      // 修复 BUG-EXE-005：此前忽略填充结果、且无论点击是否成功都 return true，
      // 导致"提交失败"被上层当成成功（日志记已提交、completed 仍 +1）。
      if (fillStatus === 'disabled') {
        this.logger.warn('提交失败：分数输入框被禁用，未写入任何值', { score, platform: this.platformName })
        return false
      }
      if (fillStatus === 'not-visible') {
        this.logger.warn('提交失败：分数输入框不可见，未写入任何值', { score, platform: this.platformName })
        return false
      }
      if (fillStatus !== 'filled') {
        this.logger.warn('未找到分数输入框，提交未执行', { score })
        return false
      }

      // 阻断-03 强否定①：输入框被禁用/被遮挡，或平台未接受填入的分数
      const inputState = await this.inspectScoreInput(page, scoreInputSelectors, score)
      if (!inputState.found) {
        this.logger.warn('提交失败：分数输入框不存在或不可见', { score, platform: this.platformName })
        return false
      }
      if (!inputState.enabled) {
        this.logger.warn('提交失败：分数输入框被禁用', { score, platform: this.platformName })
        return false
      }
      if (inputState.occluded) {
        this.logger.warn('提交失败：分数输入框被遮挡', { score, platform: this.platformName })
        return false
      }
      if (!inputState.accepted) {
        this.logger.warn('提交失败：分数未被平台接受', {
          score, actual: inputState.actual, platform: this.platformName,
        })
        return false
      }

      // 等待一下让页面响应
      await page.waitForTimeout(500)

      const submitConfig = this.configService.getZhixueSubmitButtonSelectors()
      const submitButtonSelectors = [submitConfig.SUBMIT_BUTTON_NEW, submitConfig.SUBMIT_BUTTON]

      const beforeUrl = (() => {
        try {
          return page.url() as string
        } catch {
          return ''
        }
      })()

      // 阻断-03 强否定②：提交按钮不存在 / 不可见 / 被禁用 / 被遮挡，
      // 以及点击被弹窗/遮罩吞掉（clickFired=false）。clickFired 能精确区分
      // "点击被拦截"与"点击成功但页面无可见变化（输入框未清空 / 未跳转）"。
      const target = await this.clickSubmitTarget(page, submitButtonSelectors, submitConfig.SUBMIT_BUTTON_TEXT)
      if (!target.found || !target.visible) {
        this.logger.warn('提交失败：未找到可见的提交按钮', { score, platform: this.platformName })
        return false
      }
      if (!target.enabled) {
        this.logger.warn('提交失败：提交按钮被禁用', { score, platform: this.platformName })
        return false
      }
      if (target.occluded) {
        this.logger.warn('提交失败：提交按钮被遮挡', { score, platform: this.platformName })
        return false
      }
      if (!target.clickFired) {
        this.logger.warn('提交失败：提交按钮点击被拦截（click 事件未送达）', {
          score, platform: this.platformName,
        })
        return false
      }

      await page.waitForTimeout(700)

      // 阻断-03 结果核验：强否定 → false；明确成功 → true；无法确认 → 放行但记 warn
      const outcome = await this.verifySubmitOutcome(page, {
        score, scoreInputSelectors, submitButtonSelectors, beforeUrl,
      })
      if (outcome.verdict === 'failure') {
        this.logger.warn(`提交失败：${outcome.reason}`, { score, platform: this.platformName })
        return false
      }
      if (outcome.verdict === 'success') {
        this.logOperation('分数提交完成', { score, reason: outcome.reason })
        return true
      }
      this.logger.warn(
        `[${this.platformName}适配器] 提交结果无法确认，按成功放行待人工复核`,
        { score, platform: this.platformName }
      )
      return true
    } catch (error) {
      this.logError('提交分数', error as Error)
      return false
    }
  }

  /**
   * 切换到下一题（三态）
   * - 'ok'    已点击语义化的"下一题"控件并成功切换
   * - 'last'  明确的"已是最后一题"文案，或"下一题"控件存在但被禁用
   * - 'error' 未找到可确认的下一题控件 / 点击抛异常 / 任何其它情况
   * @param page - Playwright Page 对象
   * @returns NextPaperResult
   */
  async goToNext(page: any): Promise<NextPaperResult> {
    this.logOperation('开始切换到下一题')

    try {
      const selectors = this.configService.getZhixueNextButtonSelectors()
      const nextText = selectors.NEXT_BUTTON_TEXT || '下一题'

      // 统一走 BaseAdapter.probeNextPaper：
      // 仅用文案 / aria-label / 显式选择器定位"下一题"，不再使用 [class*="next"] 超宽选择器
      const result = await this.probeNextPaper(page, {
        nextTexts: [nextText, '下一题', '下一张', '下一页', '下一份'],
        nextSelectors: [selectors.NEXT_BUTTON],
      })

      await page.waitForTimeout(1500)
      this.logOperation('切换下一题结束', { result })
      return result
    } catch (error) {
      // 修复 BUG-EXE-006：切换异常绝不能被当成"没有更多试卷"。
      // 抛出的异常必须映射为 'error'，绝不允许映射为 'last'。
      this.logError('切换下一道题', error as Error)
      return 'error'
    }
  }

  /**
   * 验证页面是否为智学网平台
   * @param page - Playwright Page 对象
   * @returns 是否为智学网平台
   */
  async validatePage(page: any): Promise<boolean> {
    try {
      const url = page.url()
      const isZhixue = url.includes('zhixue.com') || url.includes('zhixueyun.com')
      this.logOperation('验证页面平台', { url, isZhixue })
      return isZhixue
    } catch (error) {
      this.logError('验证页面', error as Error)
      return false
    }
  }
}
