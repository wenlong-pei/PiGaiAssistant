/**
 * 基础适配器抽象类
 * 提供所有适配器的通用功能实现
 */

import { LogService } from '../services/LogService'
import { ConfigService } from '../services/ConfigService'
import { PlatformAdapter, PlatformPageAnalysisResult, NextPaperResult } from './PlatformAdapter.interface'
import { TIMEOUT } from '../utils/constants'

/**
 * 分数输入框状态（提交前核验用）
 */
export interface ScoreInputState {
  /** 是否找到可见的输入框 */
  found: boolean
  /** 是否可见 */
  visible: boolean
  /** 是否可编辑（未被 disabled / aria-disabled） */
  enabled: boolean
  /** 是否被其它元素遮挡 */
  occluded: boolean
  /** 平台是否接受了期望的分数（值存在且数值等于期望值） */
  accepted: boolean
  /** 输入框当前实际值 */
  actual: string
}

/**
 * 点击目标（提交按钮等）的可点击性状态
 */
export interface ClickTargetState {
  /** 是否存在匹配元素 */
  found: boolean
  /** 是否可见 */
  visible: boolean
  /** 是否可用（未被 disabled / aria-disabled / disabled 类名） */
  enabled: boolean
  /** 是否被其它元素遮挡 */
  occluded: boolean
  /** 综合判断是否可点击（可见 + 可用 + 未遮挡） */
  clickable: boolean
  /**
   * 点击后，click 事件是否真的派发到了目标元素。
   * 被弹窗遮罩 / 被改写的 HTMLElement.prototype.click 吞掉时为 false。
   * 这是区分"点击被拦截"与"点击送达但页面无可见变化"的关键信号。
   */
  clickFired: boolean
}

/**
 * 提交结果核验结论
 * - 'success' 明确成功
 * - 'failure' 测得强否定信号（弹窗拦截 / 输入被禁用 / 未生效等）
 * - 'unknown' 无法判断（调用方按"保持现状"处理，但要记 warn 日志）
 */
export type SubmitOutcomeVerdict = 'success' | 'failure' | 'unknown'

/**
 * 提交结果核验结果
 */
export interface SubmitOutcome {
  verdict: SubmitOutcomeVerdict
  reason: string
}

/**
 * 基础适配器抽象类
 * 实现通用逻辑，具体平台适配器只需继承此类并实现必要方法
 */
export abstract class BaseAdapter implements PlatformAdapter {
  /** 平台名称 - 由子类实现 */
  abstract readonly platformName: string

  /** 日志服务 */
  protected logger: LogService
  
  /** 配置服务 */
  protected configService: ConfigService

  /**
   * 构造函数
   * @param logger - 日志服务实例
   * @param configService - 配置服务实例
   */
  constructor(logger: LogService, configService: ConfigService) {
    this.logger = logger
    this.configService = configService
  }

  /**
   * 分析页面结构 - 由子类实现
   */
  abstract analyzePage(page: any): Promise<PlatformPageAnalysisResult>

  /**
   * 捕获答案图片 - 由子类实现
   */
  abstract captureAnswerImage(page: any): Promise<string | null>

  /**
   * 提交分数 - 由子类实现
   */
  abstract submitScore(page: any, score: number): Promise<boolean>

  /**
   * 切换到下一题 - 由子类实现
   * @returns 三态结果（'ok' | 'last' | 'error'）
   */
  abstract goToNext(page: any): Promise<NextPaperResult>

  /**
   * 获取平台名称
   * @returns 平台名称
   */
  getPlatformName(): string {
    return this.platformName
  }

  /**
   * 获取平台展示名称
   * @returns 平台展示名称
   */
  getPlatformDisplayName(): string {
    return this.configService.getPlatformDisplayName(this.platformName)
  }

  /**
   * 验证页面是否为当前平台 - 由子类实现
   */
  abstract validatePage(page: any): Promise<boolean>

  /**
   * 执行选择器查询
   * 在页面上下文中执行选择器查询，返回查询结果
   * @param page - Playwright Page 对象
   * @param selectors - CSS 选择器数组
   * @param multiple - 是否返回多个结果
   * @returns 查询结果（元素是否存在或元素列表）
   */
  protected async evaluateSelector(
    page: any,
    selectors: string[],
    multiple: boolean = false
  ): Promise<any> {
    try {
      const result = await page.evaluate((selectorList: string[]) => {
        const results: any[] = []
        
        for (const selector of selectorList) {
          try {
            const elements = document.querySelectorAll(selector)
            if (elements.length > 0) {
              if (multiple) {
                results.push(...Array.from(elements))
              } else {
                return true // 找到第一个匹配元素就返回
              }
            }
          } catch (error) {
            // 选择器语法错误，继续尝试下一个
            console.warn(`Invalid selector: ${selector}`, error)
          }
        }
        
        return multiple ? results : false
      }, selectors)

      return result
    } catch (error) {
      this.logger.error('执行选择器查询失败', error as Error, { selectors })
      return multiple ? [] : false
    }
  }

  /**
   * 等待元素出现
   * @param page - Playwright Page 对象
   * @param selectors - CSS 选择器数组
   * @param timeout - 超时时间（毫秒）
   * @returns 是否找到元素
   */
  protected async waitForElement(
    page: any,
    selectors: string[],
    timeout: number = TIMEOUT.ELEMENT_WAIT
  ): Promise<boolean> {
    try {
      const startTime = Date.now()
      
      while (Date.now() - startTime < timeout) {
        const found = await this.evaluateSelector(page, selectors, false)
        if (found) {
          return true
        }
        
        // 等待一段时间后重试
        await page.waitForTimeout(100)
      }
      
      return false
    } catch (error) {
      this.logger.error('等待元素失败', error as Error, { selectors, timeout })
      return false
    }
  }

  /**
   * 获取图片并转为 base64
   * @param imageUrl - 图片 URL
   * @returns base64 编码的图片数据或 null
   */
  protected async fetchImageAsBase64(imageUrl: string): Promise<string | null> {
    try {
      // 如果已经是 base64 数据，直接返回
      if (imageUrl.startsWith('data:')) {
        return imageUrl
      }

      // 使用 axios 获取图片
      const axios = require('axios')
      const response = await axios.get(imageUrl, {
        responseType: 'arraybuffer',
        timeout: TIMEOUT.OCR_RECOGNIZE,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      })

      const contentType = response.headers['content-type'] || 'image/png'
      const base64 = Buffer.from(response.data, 'binary').toString('base64')
      return `data:${contentType};base64,${base64}`
    } catch (error) {
      this.logger.error('获取图片失败', error as Error, { imageUrl })
      return null
    }
  }

  /**
   * 在页面中填入文本
   * @param page - Playwright Page 对象
   * @param selectors - CSS 选择器数组
   * @param text - 要填入的文本
   * @returns 是否成功填入
   */
  protected async fillInput(page: any, selectors: string[], text: string): Promise<boolean> {
    try {
      // 修复 BUG-EXE-001：Playwright 的 page.evaluate 只接受一个参数，
      // 传多个参数会抛 "Too many arguments"，导致填分/填值永远失败。
      // 统一改为单对象参数。
      const fillResult = await page.evaluate(
        ({ selectorList, value }: { selectorList: string[]; value: string }) => {
          for (const selector of selectorList) {
            try {
              const input = document.querySelector(selector) as HTMLInputElement
              if (input) {
                // 修复（QA EXE-4）：不得向 disabled / aria-disabled / 不可见的输入框写入，
                // 否则会触发 input 事件、把分数"填"进一个平台根本不会接受的控件里。
                const style = window.getComputedStyle(input)
                const rect = input.getBoundingClientRect()
                const visible = style.display !== 'none' && style.visibility !== 'hidden' &&
                  style.opacity !== '0' && rect.width > 0 && rect.height > 0
                const enabled = !input.disabled && input.getAttribute('aria-disabled') !== 'true'
                if (!visible || !enabled) {
                  continue
                }

                // 使用 setter 触发 React/Vue 等框架的更新
                const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
                if (setter) {
                  setter.call(input, value)
                } else {
                  input.value = value
                }
                
                // 触发输入事件
                input.dispatchEvent(new Event('input', { bubbles: true }))
                input.dispatchEvent(new Event('change', { bubbles: true }))
                input.dispatchEvent(new Event('blur', { bubbles: true }))
                return true
              }
            } catch (error) {
              console.warn(`Failed to fill input with selector: ${selector}`, error)
            }
          }
          return false
        },
        { selectorList: selectors, value: text }
      )

      return fillResult
    } catch (error) {
      this.logger.error('填入文本失败', error as Error, { selectors, text })
      return false
    }
  }

  // ============ 提交结果核验（阻断-03）============
  // 提交分数只判断"是否点到按钮"是不够的：弹窗拦截、输入框 disabled、
  // 值未被平台接受等情况都会让"点到按钮"变成假成功。
  // 以下三个方法用于采集强否定/强成功信号，供各平台适配器的 submitScore 复用。

  /**
   * 核验分数输入框状态（提交前）
   * 检测：是否有可见输入框、是否被禁用、是否被遮挡、平台是否接受了期望分数值
   * @param page - Playwright Page 对象
   * @param selectors - 分数输入框选择器（按优先级排序）
   * @param expected - 期望填入的分数
   */
  protected async inspectScoreInput(
    page: any,
    selectors: string[],
    expected: number
  ): Promise<ScoreInputState> {
    const empty: ScoreInputState = {
      found: false, visible: false, enabled: false, occluded: false, accepted: false, actual: '',
    }
    try {
      const state = await page.evaluate(
        ({ selectorList, expectedValue }: { selectorList: string[]; expectedValue: number }) => {
          const isVisible = (el: Element): boolean => {
            const he = el as HTMLElement
            const style = window.getComputedStyle(he)
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false
            const rect = he.getBoundingClientRect()
            return rect.width > 0 && rect.height > 0
          }
          const isEnabled = (el: Element): boolean => {
            const he = el as HTMLInputElement
            if (he.disabled) return false
            if (he.getAttribute('aria-disabled') === 'true') return false
            return true
          }
          const isOccluded = (el: Element): boolean => {
            const rect = (el as HTMLElement).getBoundingClientRect()
            const cx = rect.left + rect.width / 2
            const cy = rect.top + rect.height / 2
            if (cx <= 0 || cy <= 0 || cx >= window.innerWidth || cy >= window.innerHeight) return false
            const top = document.elementFromPoint(cx, cy)
            if (!top) return false
            return top !== el && !el.contains(top)
          }

          for (const selector of selectorList) {
            if (!selector) continue
            let el: HTMLInputElement | null = null
            try {
              el = document.querySelector(selector) as HTMLInputElement | null
            } catch {
              continue
            }
            if (!el) continue
            if (!isVisible(el)) continue
            const enabled = isEnabled(el)
            const occluded = isOccluded(el)
            const actual = el.value == null ? '' : String(el.value)
            const accepted = actual.trim() !== '' && Number(actual) === Number(String(expectedValue))
            return { found: true, visible: true, enabled, occluded, accepted, actual }
          }
          return { found: false, visible: false, enabled: false, occluded: false, accepted: false, actual: '' }
        },
        { selectorList: selectors, expectedValue: expected }
      )
      return state as ScoreInputState
    } catch (error) {
      this.logger.error('检查分数输入框状态失败', error as Error, { selectors })
      return empty
    }
  }

  /**
   * 检查提交目标的可点击性并执行点击，同时探测 click 事件是否真的送达目标元素。
   *
   * 为什么要探测 click 事件：真实平台上"点击被弹窗/遮罩吞掉"与"点击成功但页面
   * 没有可见变化（如输入框不清空、不跳转）"在 DOM 上完全一样。仅凭 DOM 状态无法
   * 区分二者（会把真实提交误报为失败）。而"click 事件是否派发到目标"能精确区分：
   * - 被拦截（如页面改写了 HTMLElement.prototype.click）→ clickFired = false
   * - 点击送达（无论页面是否清空输入/跳转）→ clickFired = true
   *
   * @param page - Playwright Page 对象
   * @param selectors - 目标选择器数组
   * @param textHint - 目标文案（可选，用于按文本兜底匹配）
   */
  protected async clickSubmitTarget(
    page: any,
    selectors: string[],
    textHint?: string
  ): Promise<ClickTargetState> {
    const notFound: ClickTargetState = {
      found: false, visible: false, enabled: false, occluded: false, clickable: false, clickFired: false,
    }
    try {
      const state = await page.evaluate(
        ({ selectorList, hint }: { selectorList: string[]; hint?: string }) => {
          const normalize = (s: string | null): string => (s == null ? '' : s).replace(/\s+/g, '')
          const isVisible = (el: Element): boolean => {
            const he = el as HTMLElement
            const style = window.getComputedStyle(he)
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false
            const rect = he.getBoundingClientRect()
            return rect.width > 0 && rect.height > 0
          }
          const isEnabled = (el: Element): boolean => {
            const he = el as HTMLButtonElement & { disabled?: boolean }
            if (he.disabled) return false
            if (el.getAttribute('aria-disabled') === 'true') return false
            if (/disabled/i.test(el.getAttribute('class') || '')) return false
            return true
          }
          const isOccluded = (el: Element): boolean => {
            const rect = (el as HTMLElement).getBoundingClientRect()
            const cx = rect.left + rect.width / 2
            const cy = rect.top + rect.height / 2
            if (cx <= 0 || cy <= 0 || cx >= window.innerWidth || cy >= window.innerHeight) return false
            const top = document.elementFromPoint(cx, cy)
            if (!top) return false
            return top !== el && !el.contains(top)
          }
          const miss = (found: boolean): {
            found: boolean; visible: boolean; enabled: boolean; occluded: boolean
            clickable: boolean; clickFired: boolean
          } => ({ found, visible: false, enabled: false, occluded: false, clickable: false, clickFired: false })

          const candidates: Element[] = []
          const seen = new Set<Element>()
          const push = (el: Element): void => {
            if (!seen.has(el)) {
              seen.add(el)
              candidates.push(el)
            }
          }

          for (const selector of selectorList) {
            if (!selector) continue
            try {
              document.querySelectorAll(selector).forEach((el) => push(el))
            } catch {
              // 忽略 Playwright 专有或非法选择器
            }
          }
          if (hint) {
            const target = normalize(hint)
            document
              .querySelectorAll('button, a, [role="button"], input[type="button"], input[type="submit"]')
              .forEach((el) => {
                if (normalize(el.textContent).includes(target)) push(el)
              })
          }

          if (candidates.length === 0) return miss(false)

          let target: Element | null = null
          for (const el of candidates) {
            if (isVisible(el)) {
              target = el
              break
            }
          }
          if (!target) return miss(true)

          const enabled = isEnabled(target)
          const occluded = isOccluded(target)
          const clickable = enabled && !occluded
          if (!clickable) {
            return { found: true, visible: true, enabled, occluded, clickable: false, clickFired: false }
          }

          // 安装一次性 capture 监听器，探测 click 事件是否真的派发到目标
          let clickFired = false
          try {
            target.addEventListener('click', () => { clickFired = true }, { once: true, capture: true })
          } catch {
            // 忽略：极少数环境下 addEventListener 不可用，退化为不探测
          }
          try {
            ;(target as HTMLElement).click()
          } catch {
            return { found: true, visible: true, enabled, occluded, clickable: true, clickFired: false }
          }
          return { found: true, visible: true, enabled, occluded, clickable: true, clickFired }
        },
        { selectorList: selectors, hint: textHint }
      )
      return state as ClickTargetState
    } catch (error) {
      this.logger.error('点击提交目标失败', error as Error, { selectors })
      return notFound
    }
  }

  /**
   * 核验提交结果（点击提交后）
   * - 强成功：成功提示 / 页面跳转
   * - 强否定：校验错误或阻断弹窗、分数输入框被禁用
   * - 其它：无法判断（调用方保持现状，但需记 warn 日志）
   *
   * 注意：不再以"提交按钮仍可点击 + 输入框仍为同一分数"判 failure —— 实测该状态在
   * "真实提交成功但平台不清空输入框、不跳转"时同样出现。"点击是否真的送达"改由
   * {@link clickSubmitTarget} 的 clickFired 精确判定。
   * @param page - Playwright Page 对象
   * @param opts - 核验参数
   */
  protected async verifySubmitOutcome(
    page: any,
    opts: {
      score: number
      scoreInputSelectors: string[]
      submitButtonSelectors: string[]
      beforeUrl?: string
    }
  ): Promise<SubmitOutcome> {
    try {
      const state = await page.evaluate(
        (o: {
          score: number
          scoreInputSelectors: string[]
          submitButtonSelectors: string[]
          beforeUrl: string
        }) => {
          const normalize = (s: string | null): string => (s == null ? '' : s).replace(/\s+/g, '')
          const isVisible = (el: Element): boolean => {
            const he = el as HTMLElement
            const style = window.getComputedStyle(he)
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false
            const rect = he.getBoundingClientRect()
            return rect.width > 0 && rect.height > 0
          }
          const isEnabled = (el: Element): boolean => {
            const he = el as HTMLButtonElement & { disabled?: boolean }
            if (he.disabled) return false
            if (el.getAttribute('aria-disabled') === 'true') return false
            return true
          }

          const FAILURE_TEXTS = [
            '提交失败', '保存失败', '操作失败', '错误', '不能为空', '请输入', '请填写',
            '无效', '不合格', '超出', '必须', '请先', '校验', '异常', '格式不正确',
            '不允许', '未通过', '失败',
          ]
          const SUCCESS_TEXTS = [
            '提交成功', '保存成功', '提交完成', '已完成', '已提交', '已保存',
            '批改完成', '操作成功', '成功',
          ]
          const MESSAGE_SELECTORS = [
            '.el-message', '.el-message-box', '.el-notification', '.ant-message', '.ant-notification',
            '.el-message--error', '.el-message--success', '.ant-message-error', '.ant-message-success',
            '.toast', '.toast-message', '.layui-layer', '.swal2-popup', '.v-snack', '.van-toast',
            '.ivu-message', '[role="alert"]', '[role="status"]',
            '[class*="message"]', '[class*="notify"]', '[class*="toast"]',
            '[class*="success"]', '[class*="error"]',
          ]
          const OVERLAY_SELECTORS = [
            '.el-message-box', '.el-overlay', '.ant-modal', '.ant-modal-mask', '.swal2-popup',
            '.layui-layer', '.modal.show', '[role="dialog"]', '.v-modal', '.mask.show', '.van-dialog',
          ]

          const visibleTexts: string[] = []
          for (const sel of MESSAGE_SELECTORS) {
            try {
              document.querySelectorAll(sel).forEach((el) => {
                if (el instanceof HTMLElement && isVisible(el)) visibleTexts.push(normalize(el.textContent))
              })
            } catch {
              // 忽略非法选择器
            }
          }

          if (visibleTexts.some((t) => FAILURE_TEXTS.some((k) => t.includes(k)))) {
            return { verdict: 'failure', reason: '检测到阻止提交的弹窗/校验错误提示' }
          }
          if (visibleTexts.some((t) => SUCCESS_TEXTS.some((k) => t.includes(k)))) {
            return { verdict: 'success', reason: '检测到提交成功提示' }
          }
          if (o.beforeUrl && location.href !== o.beforeUrl) {
            return { verdict: 'success', reason: '提交后页面已跳转' }
          }

          const blocking = OVERLAY_SELECTORS.some((sel) => {
            try {
              return Array.from(document.querySelectorAll(sel)).some(
                (el) => el instanceof HTMLElement && isVisible(el)
              )
            } catch {
              return false
            }
          })
          if (blocking) {
            return { verdict: 'failure', reason: '存在阻断提交的弹窗/遮罩' }
          }

          let input: HTMLInputElement | null = null
          for (const sel of o.scoreInputSelectors) {
            if (!sel) continue
            try {
              const el = document.querySelector(sel) as HTMLInputElement | null
              if (el && isVisible(el)) {
                input = el
                break
              }
            } catch {
              // 忽略非法选择器
            }
          }
          if (input && !isEnabled(input)) {
            return { verdict: 'failure', reason: '分数输入框被禁用，提交未生效' }
          }

          // 修复（QA EXE-1/EXE-5 实测）：此前把"提交按钮仍可点击 + 输入框仍为同一分数"
          // 判为 failure。但该组合在"提交成功、平台不清空输入框、页面不跳转"的常见页面上
          // 同样成立，会把真实提交误报为失败（教师看到假失败 → 重试 → 重复提交）。
          // 因此不再据此判 failure；"点击是否真的送达"改由 clickSubmitTarget.clickFired 判定。
          if (input) {
            const actual = normalize(input.value)
            if (actual !== '' && Number(actual) === Number(String(o.score))) {
              return { verdict: 'unknown', reason: '提交后页面无可见变化，无法确认结果' }
            }
          }
          return { verdict: 'unknown', reason: '未检测到明确的成功或失败信号' }
        },
        {
          score: opts.score,
          scoreInputSelectors: opts.scoreInputSelectors,
          submitButtonSelectors: opts.submitButtonSelectors,
          beforeUrl: opts.beforeUrl ?? '',
        }
      )
      return state as SubmitOutcome
    } catch (error) {
      this.logger.error('校验提交结果失败', error as Error)
      return { verdict: 'unknown', reason: `校验过程异常: ${(error as Error).message}` }
    }
  }

  /**
   * 探测"下一题"控件并给出三态结果（切题契约的统一实现，阻断-01）
   *
   * 判定依据：
   * - 命中语义化的"下一题"控件（文案 / aria-label / 显式选择器）且可用 → 点击 → 'ok'
   * - "下一题"控件存在但被禁用 → 'last'（明确信号）
   * - 页面出现明确的"已是最后一题 / 没有下一题"文案 → 'last'（明确信号）
   * - 其它（找不到可用控件 / 点击抛异常）→ 'error'（绝不允许当作正常结束）
   *
   * 注意：不使用 `[class*="next"]` 这类超宽选择器，避免假 'ok' / 假 'last'。
   * @param page - Playwright Page 对象
   * @param opts - nextTexts：下一题文案候选；nextSelectors：显式选择器候选
   */
  protected async probeNextPaper(
    page: any,
    opts: { nextTexts: string[]; nextSelectors: string[] }
  ): Promise<NextPaperResult> {
    try {
      const probe = await page.evaluate(
        ({ nextTexts, nextSelectors }: { nextTexts: string[]; nextSelectors: string[] }) => {
          const normalize = (s: string | null): string => (s == null ? '' : s).replace(/\s+/g, '')
          const isVisible = (el: Element): boolean => {
            const he = el as HTMLElement
            const style = window.getComputedStyle(he)
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false
            const rect = he.getBoundingClientRect()
            return rect.width > 0 && rect.height > 0
          }
          const isEnabled = (el: Element): boolean => {
            const he = el as HTMLButtonElement & { disabled?: boolean }
            if (he.disabled) return false
            if (el.getAttribute('aria-disabled') === 'true') return false
            if (/disabled/i.test(el.getAttribute('class') || '')) return false
            return true
          }

          const NEXT_TEXTS = nextTexts.filter(Boolean)
          // 明确表示"已是最后一题 / 没有下一题"的文案（唯一可作为正常结束依据的信号）
          const LAST_TEXTS = [
            '已是最后一题', '最后一题', '没有下一题', '没有更多', '已到最后', '已到最后一题',
            '全部完成', '已完成全部', '批改完成', '考试已结束', '答题已结束', '已结束',
          ]

          const controls = Array.from(
            document.querySelectorAll('button, a, [role="button"], input[type="button"], input[type="submit"]')
          )
          const textOf = (el: Element): string => normalize(el.textContent)
          const ariaOf = (el: Element): string =>
            normalize((el.getAttribute('aria-label') || '') + (el.getAttribute('title') || ''))

          // 语义化定位"下一题"控件：仅接受文案 / aria-label 命中，或显式选择器命中
          const candidates: Element[] = []
          const seen = new Set<Element>()
          const push = (el: Element | null): void => {
            if (el && !seen.has(el)) {
              seen.add(el)
              candidates.push(el)
            }
          }
          for (const el of controls) {
            const t = textOf(el)
            const a = ariaOf(el)
            if (NEXT_TEXTS.some((k) => (t && t.includes(k)) || (a && a.includes(k)))) push(el)
          }
          for (const sel of nextSelectors) {
            if (!sel) continue
            try {
              document.querySelectorAll(sel).forEach((el) => push(el))
            } catch {
              // 忽略 Playwright 专有或非法选择器
            }
          }

          const enabledCandidates = candidates.filter((el) => isVisible(el) && isEnabled(el))
          if (enabledCandidates.length > 0) {
            try {
              ;(enabledCandidates[0] as HTMLElement).click()
            } catch {
              return { state: 'error', reason: '点击下一题控件抛出异常' }
            }
            return { state: 'clicked', reason: '已点击下一题控件' }
          }

          // 无可用控件：先看"已禁用"这一明确信号
          if (candidates.some((el) => isVisible(el) && !isEnabled(el))) {
            return { state: 'last', reason: '下一题控件存在但被禁用' }
          }

          // 再看明确的结束文案（控件与普通文本节点）
          for (const el of controls) {
            const t = textOf(el)
            if (t && LAST_TEXTS.some((k) => t.includes(k)) && isVisible(el)) {
              return { state: 'last', reason: `检测到结束文案：${t.slice(0, 20)}` }
            }
          }
          for (const el of Array.from(document.querySelectorAll('div, span, p, em, i'))) {
            const t = textOf(el)
            if (t && t.length > 0 && t.length <= 12 && LAST_TEXTS.some((k) => t.includes(k)) && isVisible(el)) {
              return { state: 'last', reason: `检测到结束提示：${t.slice(0, 20)}` }
            }
          }

          return { state: 'missing', reason: '未找到可用的下一题控件' }
        },
        { nextTexts: opts.nextTexts, nextSelectors: opts.nextSelectors }
      )

      if (probe.state === 'clicked') {
        this.logger.info(`[${this.platformName}] 切题探测：${probe.reason}`)
        return 'ok'
      }
      if (probe.state === 'last') {
        this.logger.info(`[${this.platformName}] 切题探测：${probe.reason}`)
        return 'last'
      }
      this.logger.warn(`[${this.platformName}] 切题探测未确认下一题是否存在：${probe.reason}`)
      return 'error'
    } catch (error) {
      // 抛出的异常必须映射为 'error'，绝不允许映射为 'last'
      this.logger.error('探测下一题控件失败', error as Error, { nextTexts: opts.nextTexts })
      return 'error'
    }
  }

  /**
   * 记录适配器操作日志
   * @param operation - 操作名称
   * @param details - 详细信息
   */
  protected logOperation(operation: string, details?: any): void {
    this.logger.info(`[${this.platformName}] ${operation}`, details)
  }

  /**
   * 记录适配器错误日志
   * @param operation - 操作名称
   * @param error - 错误对象
   */
  protected logError(operation: string, error: Error): void {
    this.logger.error(`[${this.platformName}] ${operation} 失败`, error)
  }
}
