/**
 * 可配置平台适配器
 * 支持用户自定义选择器配置，可以动态更新
 */

import { LogService } from '../services/LogService'
import { ConfigService } from '../services/ConfigService'
import { BaseAdapter } from './BaseAdapter'
import { PlatformPageAnalysisResult, NextPaperResult } from './PlatformAdapter.interface'
import { PlatformSelectors } from '../SelectorManager'

/**
 * 可配置适配器类
 * 允许用户通过配置文件自定义选择器
 */
export class ConfigurableAdapter extends BaseAdapter {
  /** 平台名称 */
  readonly platformName: string = 'configurable'

  /** 用户自定义选择器配置 */
  private customSelectors: PlatformSelectors

  /**
   * 构造函数
   * @param logger - 日志服务实例
   * @param configService - 配置服务实例
   * @param customSelectors - 用户自定义选择器配置
   */
  constructor(
    logger: LogService,
    configService: ConfigService,
    customSelectors?: PlatformSelectors
  ) {
    super(logger, configService)

    // 初始化自定义选择器配置
    this.customSelectors = customSelectors || this.createDefaultSelectors()

    this.logOperation('初始化可配置适配器', {
      platformName: this.customSelectors.name,
    })
  }

  /**
   * 创建默认选择器配置
   * @returns 默认选择器配置
   */
  private createDefaultSelectors(): PlatformSelectors {
    return {
      name: '自定义平台',
      domains: [],
      selectors: {
        answerImages: {
          selectors: ['img.answer', 'img[src*="answer"]', '.answer-image img'],
        },
        scoreInput: {
          allModern: 'input[type="number"]',
          placeholder: 'input[placeholder*="分数"]',
        },
        submitButton: {
          text: '提交',
          selectors: ['button[type="submit"]', 'button.submit', '.submit-btn'],
        },
        nextButton: {
          text: '下一题',
          selectors: ['button.next', '.next-btn', 'button:contains("下一")'],
        },
        questionTitle: {
          selectors: ['h3', 'h4', '.question-title'],
        },
      },
    }
  }

  /**
   * 更新选择器配置
   * @param selectors - 新的选择器配置
   */
  updateSelectors(selectors: PlatformSelectors): void {
    this.customSelectors = selectors
    this.logOperation('更新选择器配置', { platformName: selectors.name })
  }

  /**
   * 获取当前选择器配置
   * @returns 当前选择器配置
   */
  getSelectors(): PlatformSelectors {
    return { ...this.customSelectors } // 返回副本，防止外部修改
  }

  /**
   * 从 JSON 配置文件加载选择器
   * @param jsonConfig - JSON 配置字符串
   * @returns 是否加载成功
   */
  loadFromJson(jsonConfig: string): boolean {
    try {
      const config = JSON.parse(jsonConfig) as PlatformSelectors
      this.validateSelectors(config)
      this.customSelectors = config
      this.logOperation('从 JSON 加载配置成功', { platformName: config.name })
      return true
    } catch (error) {
      this.logError('从 JSON 加载配置', error as Error)
      return false
    }
  }

  /**
   * 导出选择器配置为 JSON
   * @returns JSON 配置字符串
   */
  exportToJson(): string {
    try {
      const json = JSON.stringify(this.customSelectors, null, 2)
      this.logOperation('导出配置为 JSON')
      return json
    } catch (error) {
      this.logError('导出配置为 JSON', error as Error)
      return '{}'
    }
  }

  /**
   * 验证选择器配置是否合法
   * @param selectors - 要验证的配置
   * @throws 如果不合法
   */
  private validateSelectors(selectors: PlatformSelectors): void {
    if (!selectors.name) {
      throw new Error('选择器配置缺少 name 字段')
    }

    if (!selectors.selectors) {
      throw new Error('选择器配置缺少 selectors 字段')
    }

    // 验证必要的选择器配置
    const requiredSelectors = ['answerImages', 'scoreInput', 'submitButton', 'nextButton']
    for (const key of requiredSelectors) {
      if (!selectors.selectors[key as keyof typeof selectors.selectors]) {
        this.logger.warn(`选择器配置缺少 ${key} 字段`)
      }
    }
  }

  /**
   * 分析页面结构
   * @param page - Playwright Page 对象
   * @returns 页面分析结果
   */
  async analyzePage(page: any): Promise<PlatformPageAnalysisResult> {
    this.logOperation('开始分析页面（可配置模式）')

    try {
      const selectors = this.customSelectors.selectors

      // 获取答案图片选择器
      const answerImageSelectors = this.getSelectorsFromConfig(selectors.answerImages)

      // 获取分数输入框选择器
      const scoreInputSelectors = this.getSelectorsFromConfig(selectors.scoreInput)

      // 获取提交按钮和下一题按钮配置
      const submitButtonConfig = {
        text: selectors.submitButton.text || '提交',
        selectors: this.getSelectorsFromConfig(selectors.submitButton),
      }
      const nextButtonConfig = {
        text: selectors.nextButton.text || '下一题',
        selectors: this.getSelectorsFromConfig(selectors.nextButton),
      }

      // 检测关键元素
      const hasAnswerImage = await this.evaluateSelector(page, answerImageSelectors, false)
      const hasScoreInput = await this.evaluateSelector(page, scoreInputSelectors, false)
      const hasSubmitButton = await this.checkButtonExists(page, submitButtonConfig)
      const hasNextButton = await this.checkButtonExists(page, nextButtonConfig)

      // 获取题目内容
      let questionContent = ''
      const questionTitleSelectors = selectors.questionTitle?.selectors || ['h3', 'h4']
      try {
        questionContent = await page.evaluate((sels: string[]) => {
          for (const selector of sels) {
            const el = document.querySelector(selector)
            if (el && el.textContent?.trim()) {
              return el.textContent.trim().substring(0, 500)
            }
          }
          return ''
        }, questionTitleSelectors)
      } catch {
        // 忽略错误
      }

      // 获取页面信息
      const pageInfo = await page.evaluate(() => {
        return {
          url: window.location.href,
          title: document.title || '',
        }
      })

      const result: PlatformPageAnalysisResult = {
        found: hasAnswerImage || hasScoreInput,
        platformName: this.platformName,
        hasAnswerImage,
        hasScoreInput,
        hasSubmitButton,
        questionContent,
        pageTitle: pageInfo.title || '',
        extra: {
          customPlatformName: this.customSelectors.name,
          url: pageInfo.url,
        },
      }

      this.logOperation('页面分析完成（可配置模式）', {
        found: result.found,
        hasAnswerImage,
        hasScoreInput,
      })

      return result
    } catch (error: any) {
      this.logError('分析页面（可配置模式）', error)
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
    this.logOperation('开始捕获答案图片（可配置模式）')

    try {
      const answerImageSelectors = this.getSelectorsFromConfig(this.customSelectors.selectors.answerImages)

      // 查找答案图片
      const imageUrl = await page.evaluate((selectors: string[]) => {
        for (const selector of selectors) {
          const el = document.querySelector(selector) as HTMLImageElement
          if (el && el.src) {
            return el.src
          }
        }
        return null
      }, answerImageSelectors)

      if (!imageUrl) {
        this.logger.warn('[可配置适配器] 未找到答案图片')
        return null
      }

      // 获取图片并转为 base64
      const base64 = await this.fetchImageAsBase64(imageUrl)
      this.logOperation('答案图片捕获完成（可配置模式）')
      return base64
    } catch (error) {
      this.logError('捕获答案图片（可配置模式）', error as Error)
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
    this.logOperation('开始提交分数（可配置模式）', { score })

    try {
      const scoreInputSelectors = this.getSelectorsFromConfig(this.customSelectors.selectors.scoreInput)

      // 填入分数
      const fillSuccess = await this.fillInput(page, scoreInputSelectors, String(score))

      if (!fillSuccess) {
        this.logger.warn('[可配置适配器] 未找到分数输入框')
        return false
      }

      // 阻断-03 强否定①：输入框被禁用/被遮挡，或平台未接受填入的分数
      const inputState = await this.inspectScoreInput(page, scoreInputSelectors, score)
      if (!inputState.found || !inputState.enabled || inputState.occluded || !inputState.accepted) {
        this.logger.warn('[可配置适配器] 提交失败：分数输入框异常或分数未被平台接受', {
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
      const submitButtonConfig = this.customSelectors.selectors.submitButton
      const submitButtonSelectors = this.getSelectorsFromConfig(submitButtonConfig)

      const beforeUrl = (() => {
        try {
          return page.url() as string
        } catch {
          return ''
        }
      })()

      const target = await this.clickSubmitTarget(page, submitButtonSelectors, submitButtonConfig.text)
      if (!target.found || !target.visible) {
        this.logger.warn('[可配置适配器] 提交失败：未找到可见的提交按钮', {
          score,
          platform: this.platformName,
        })
        return false
      }
      if (!target.enabled) {
        this.logger.warn('[可配置适配器] 提交失败：提交按钮被禁用', {
          score,
          platform: this.platformName,
        })
        return false
      }
      if (target.occluded) {
        this.logger.warn('[可配置适配器] 提交失败：提交按钮被遮挡', {
          score,
          platform: this.platformName,
        })
        return false
      }
      if (!target.clickFired) {
        this.logger.warn('[可配置适配器] 提交失败：提交按钮点击被拦截（click 事件未送达）', {
          score,
          platform: this.platformName,
        })
        return false
      }

      await page.waitForTimeout(700)

      // 阻断-03 结果核验：强否定 → false；明确成功 → true；无法确认 → 放行但记 warn
      const outcome = await this.verifySubmitOutcome(page, {
        score,
        scoreInputSelectors,
        submitButtonSelectors,
        beforeUrl,
      })
      if (outcome.verdict === 'failure') {
        this.logger.warn(`[可配置适配器] 提交失败：${outcome.reason}`, {
          score,
          platform: this.platformName,
        })
        return false
      }
      if (outcome.verdict === 'success') {
        this.logOperation('分数提交完成（可配置模式）', { score, reason: outcome.reason })
        return true
      }
      this.logger.warn(
        `[${this.platformName}适配器] 提交结果无法确认，按成功放行待人工复核`,
        { score, platform: this.platformName }
      )
      return true
    } catch (error) {
      this.logError('提交分数（可配置模式）', error as Error)
      return false
    }
  }

  /**
   * 切换到下一题（三态，可配置模式）
   * - 'ok'    已点击语义化的"下一题"控件并成功切换
   * - 'last'  明确的"已是最后一题"文案，或"下一题"控件存在但被禁用
   * - 'error' 未找到可确认的下一题控件 / 点击抛异常 / 任何其它情况
   * @param page - Playwright Page 对象
   * @returns NextPaperResult
   */
  async goToNext(page: any): Promise<NextPaperResult> {
    this.logOperation('开始切换到下一题（可配置模式）')

    try {
      const nextButtonConfig = this.customSelectors.selectors.nextButton
      const nextButtonSelectors = this.getSelectorsFromConfig(nextButtonConfig)
      const nextButtonText = nextButtonConfig.text || '下一题'

      const result = await this.probeNextPaper(page, {
        nextTexts: [nextButtonText, '下一题', '下一张', '下一页', '下一份'],
        nextSelectors: nextButtonSelectors,
      })

      await page.waitForTimeout(1500)
      this.logOperation('切换下一题结束（可配置模式）', { result })
      return result
    } catch (error) {
      // 抛出的异常必须映射为 'error'，绝不允许映射为 'last'
      this.logError('切换下一道题（可配置模式）', error as Error)
      return 'error'
    }
  }

  /**
   * 验证页面是否适合使用当前配置
   * @param page - Playwright Page 对象
   * @returns 是否适合
   */
  async validatePage(page: any): Promise<boolean> {
    try {
      const url = page.url()
      const domains = this.customSelectors.domains || []

      // 检查 URL 是否匹配配置的域名
      if (domains.length > 0) {
        for (const domain of domains) {
          if (url.includes(domain)) {
            this.logOperation('验证页面平台（可配置模式）', { isValid: true, reason: 'domain matched' })
            return true
          }
        }
      }

      // 如果不匹配域名，检查页面是否有必要的元素
      const analysis = await this.analyzePage(page)
      const isValid = analysis.found

      this.logOperation('验证页面平台（可配置模式）', { isValid, url })
      return isValid
    } catch (error) {
      this.logError('验证页面（可配置模式）', error as Error)
      return false
    }
  }

  /**
   * 从配置对象中提取选择器数组
   * @param config - 选择器配置对象
   * @returns 选择器数组
   */
  private getSelectorsFromConfig(config: any): string[] {
    const selectors: string[] = []

    if (config.modern) selectors.push(config.modern)
    if (config.legacy) selectors.push(config.legacy)
    if (config.fallback) selectors.push(...config.fallback)
    if (config.placeholder) selectors.push(config.placeholder)
    if (config.allModern) selectors.push(config.allModern)
    if (config.selectors) selectors.push(...config.selectors)

    return selectors
  }

  /**
   * 检查按钮是否存在
   * @param page - Playwright Page 对象
   * @param buttonConfig - 按钮配置
   * @returns 是否存在
   */
  private async checkButtonExists(page: any, buttonConfig: { text?: string; selectors?: string[] }): Promise<boolean> {
    try {
      const selectors = buttonConfig.selectors || []
      
      // 先检查选择器
      if (selectors.length > 0) {
        const hasSelector = await this.evaluateSelector(page, selectors, false)
        if (hasSelector) {
          return true
        }
      }

      // 再检查按钮文本
      if (buttonConfig.text) {
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
      }

      return false
    } catch {
      return false
    }
  }
}
