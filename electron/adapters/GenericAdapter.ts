/**
 * 通用平台适配器
 * 使用通用选择器适配大部分在线阅卷平台
 */

import { LogService } from '../services/LogService'
import { ConfigService } from '../services/ConfigService'
import { BaseAdapter } from './BaseAdapter'
import { PlatformPageAnalysisResult, NextPaperResult } from './PlatformAdapter.interface'

/**
 * 通用选择器配置
 * 适配大部分在线阅卷平台的通用选择器
 */
const GENERIC_SELECTORS = {
  /** 答案图片选择器 */
  answerImage: [
    'img.answer',
    'img[src*="answer"]',
    '.answer-image img',
    'img[alt*="答案"]',
    'img[alt*="answer"]',
    '.question-image img',
    'img.question-img',
  ],

  /** 分数输入框选择器 */
  scoreInput: [
    'input[type="number"]',
    'input[placeholder*="分数"]',
    'input[placeholder*="score"]',
    '.score-input input',
    'input.score',
    'input[name*="score"]',
    'input[id*="score"]',
  ],

  /** 提交按钮配置 */
  submitButton: {
    text: '提交',
    selectors: [
      'button.submit',
      'button[type="submit"]',
      '.submit-btn',
      '.btn-submit',
    ],
  },

  /** 下一题按钮配置 */
  nextButton: {
    text: '下一题',
    selectors: [
      'button.next',
      '.next-btn',
      '.btn-next',
      'button.next-question',
    ],
  },

  /** 题目标题选择器 */
  questionTitle: [
    'h3',
    'h4',
    '.question-title',
    '.topic-title',
    '[class*="question"] [class*="title"]',
  ],
}

/**
 * 通用适配器类
 * 使用通用选择器，适配大部分在线阅卷平台
 */
export class GenericAdapter extends BaseAdapter {
  /** 平台名称 */
  readonly platformName: string = 'generic'

  /**
   * 构造函数
   * @param logger - 日志服务实例
   * @param configService - 配置服务实例
   */
  constructor(logger: LogService, configService: ConfigService) {
    super(logger, configService)
    this.logOperation('初始化通用适配器')
  }

  /**
   * 分析页面结构
   * @param page - Playwright Page 对象
   * @returns 页面分析结果
   */
  async analyzePage(page: any): Promise<PlatformPageAnalysisResult> {
    this.logOperation('开始分析页面（通用模式）')

    try {
      // 检测页面基本结构
      const pageInfo = await page.evaluate(() => {
        return {
          url: window.location.href,
          title: document.title || '',
          hasImages: document.querySelectorAll('img').length > 0,
          hasInputs: document.querySelectorAll('input').length > 0,
          hasButtons: document.querySelectorAll('button').length > 0,
        }
      })

      // 检测关键元素
      const hasAnswerImage = await this.evaluateSelector(page, GENERIC_SELECTORS.answerImage, false)
      const hasScoreInput = await this.evaluateSelector(page, GENERIC_SELECTORS.scoreInput, false)
      const hasSubmitButton = await this.checkButtonExists(page, GENERIC_SELECTORS.submitButton)
      const hasNextButton = await this.checkButtonExists(page, GENERIC_SELECTORS.nextButton)

      // 获取题目内容
      let questionContent = ''
      try {
        questionContent = await page.evaluate((selectors: string[]) => {
          for (const selector of selectors) {
            const el = document.querySelector(selector)
            if (el && el.textContent?.trim()) {
              return el.textContent.trim().substring(0, 500)
            }
          }
          return ''
        }, GENERIC_SELECTORS.questionTitle)
      } catch {
        // 忽略获取题目内容的错误
      }

      const result: PlatformPageAnalysisResult = {
        found: hasAnswerImage || hasScoreInput, // 只要有答案图片或分数输入框就认为可用
        platformName: this.platformName,
        hasAnswerImage,
        hasScoreInput,
        hasSubmitButton,
        questionContent,
        pageTitle: pageInfo.title || '',
        extra: {
          url: pageInfo.url,
          hasImages: pageInfo.hasImages,
          hasInputs: pageInfo.hasInputs,
          hasButtons: pageInfo.hasButtons,
        },
      }

      this.logOperation('页面分析完成（通用模式）', {
        found: result.found,
        hasAnswerImage,
        hasScoreInput,
        hasSubmitButton,
      })

      return result
    } catch (error: any) {
      this.logError('分析页面（通用模式）', error)
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
    this.logOperation('开始捕获答案图片（通用模式）')

    try {
      // 查找答案图片
      const imageUrl = await page.evaluate((selectors: string[]) => {
        for (const selector of selectors) {
          const el = document.querySelector(selector) as HTMLImageElement
          if (el && el.src) {
            return el.src
          }
        }

        // 降级：查找页面中第一个较大的图片
        const allImages = document.querySelectorAll('img')
        for (const img of Array.from(allImages)) {
          if (img.src && img.naturalWidth > 100 && img.naturalHeight > 100) {
            return img.src
          }
        }

        return null
      }, GENERIC_SELECTORS.answerImage)

      if (!imageUrl) {
        this.logger.warn('[通用适配器] 未找到答案图片')
        return null
      }

      // 获取图片并转为 base64
      const base64 = await this.fetchImageAsBase64(imageUrl)
      this.logOperation('答案图片捕获完成（通用模式）')
      return base64
    } catch (error) {
      this.logError('捕获答案图片（通用模式）', error as Error)
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
    this.logOperation('开始提交分数（通用模式）', { score })

    try {
      // 填入分数
      const fillSuccess = await this.fillInput(page, GENERIC_SELECTORS.scoreInput, String(score))

      if (!fillSuccess) {
        this.logger.warn('[通用适配器] 未找到分数输入框')
        return false
      }

      // 阻断-03 强否定①：输入框被禁用/被遮挡，或平台未接受填入的分数
      const inputState = await this.inspectScoreInput(page, GENERIC_SELECTORS.scoreInput, score)
      if (!inputState.found || !inputState.enabled || inputState.occluded || !inputState.accepted) {
        this.logger.warn('[通用适配器] 提交失败：分数输入框异常或分数未被平台接受', {
          score,
          platform: this.platformName,
          found: inputState.found,
          enabled: inputState.enabled,
          occluded: inputState.occluded,
          actual: inputState.actual,
        })
        return false
      }

      // 等待一下让页面响应
      await page.waitForTimeout(500)

      // 阻断-03 强否定②：提交按钮不存在 / 不可见 / 被禁用 / 被遮挡，或点击被拦截
      const submitButtonSelectors = GENERIC_SELECTORS.submitButton.selectors

      const beforeUrl = (() => {
        try {
          return page.url() as string
        } catch {
          return ''
        }
      })()

      const target = await this.clickSubmitTarget(
        page,
        submitButtonSelectors,
        GENERIC_SELECTORS.submitButton.text
      )
      if (!target.found || !target.visible) {
        this.logger.warn('[通用适配器] 提交失败：未找到可见的提交按钮', {
          score,
          platform: this.platformName,
        })
        return false
      }
      if (!target.enabled) {
        this.logger.warn('[通用适配器] 提交失败：提交按钮被禁用', {
          score,
          platform: this.platformName,
        })
        return false
      }
      if (target.occluded) {
        this.logger.warn('[通用适配器] 提交失败：提交按钮被遮挡', {
          score,
          platform: this.platformName,
        })
        return false
      }
      if (!target.clickFired) {
        this.logger.warn('[通用适配器] 提交失败：提交按钮点击被拦截（click 事件未送达）', {
          score,
          platform: this.platformName,
        })
        return false
      }

      await page.waitForTimeout(700)

      // 阻断-03 结果核验：强否定 → false；明确成功 → true；无法确认 → 放行但记 warn
      const outcome = await this.verifySubmitOutcome(page, {
        score,
        scoreInputSelectors: GENERIC_SELECTORS.scoreInput,
        submitButtonSelectors,
        beforeUrl,
      })
      if (outcome.verdict === 'failure') {
        this.logger.warn(`[通用适配器] 提交失败：${outcome.reason}`, {
          score,
          platform: this.platformName,
        })
        return false
      }
      if (outcome.verdict === 'success') {
        this.logOperation('分数提交完成（通用模式）', { score, reason: outcome.reason })
        return true
      }
      this.logger.warn(
        `[${this.platformName}适配器] 提交结果无法确认，按成功放行待人工复核`,
        { score, platform: this.platformName }
      )
      return true
    } catch (error) {
      this.logError('提交分数（通用模式）', error as Error)
      return false
    }
  }

  /**
   * 切换到下一题（三态，通用模式）
   * - 'ok'    已点击语义化的"下一题"控件并成功切换
   * - 'last'  明确的"已是最后一题"文案，或"下一题"控件存在但被禁用
   * - 'error' 未找到可确认的下一题控件 / 点击抛异常 / 任何其它情况
   * @param page - Playwright Page 对象
   * @returns NextPaperResult
   */
  async goToNext(page: any): Promise<NextPaperResult> {
    this.logOperation('开始切换到下一题（通用模式）')

    try {
      const result = await this.probeNextPaper(page, {
        nextTexts: [GENERIC_SELECTORS.nextButton.text, '下一题', '下一张', '下一页', '下一份'],
        nextSelectors: GENERIC_SELECTORS.nextButton.selectors,
      })

      await page.waitForTimeout(1500)
      this.logOperation('切换下一题结束（通用模式）', { result })
      return result
    } catch (error) {
      // 抛出的异常必须映射为 'error'，绝不允许映射为 'last'
      this.logError('切换下一道题（通用模式）', error as Error)
      return 'error'
    }
  }

  /**
   * 验证页面是否适合使用通用适配器
   * @param page - Playwright Page 对象
   * @returns 是否适合
   */
  async validatePage(page: any): Promise<boolean> {
    try {
      // 通用适配器适用于大多数页面，只要页面有输入框和按钮即可
      const pageInfo = await page.evaluate(() => {
        return {
          hasInputs: document.querySelectorAll('input').length > 0,
          hasButtons: document.querySelectorAll('button').length > 0,
        }
      })

      const isValid = pageInfo.hasInputs || pageInfo.hasButtons
      this.logOperation('验证页面平台（通用模式）', { isValid, ...pageInfo })
      return isValid
    } catch (error) {
      this.logError('验证页面（通用模式）', error as Error)
      return false
    }
  }

  /**
   * 检查按钮是否存在
   * @param page - Playwright Page 对象
   * @param buttonConfig - 按钮配置
   * @returns 是否存在
   */
  private async checkButtonExists(page: any, buttonConfig: { text: string; selectors: string[] }): Promise<boolean> {
    try {
      // 先检查选择器
      const hasSelector = await this.evaluateSelector(page, buttonConfig.selectors, false)
      if (hasSelector) {
        return true
      }

      // 再检查按钮文本
      const hasText = await page.evaluate((text: string) => {
        const buttons = document.querySelectorAll('button')
        for (const btn of Array.from(buttons)) {
          if (btn.textContent?.includes(text)) {
            return true
          }
        }
        return false
      }, buttonConfig.text)

      return hasText
    } catch {
      return false
    }
  }
}
