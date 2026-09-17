/**
 * 平台适配器接口定义
 * 定义所有平台适配器必须实现的方法
 */

import { PageAnalysisResult } from '../services/BrowserService'

/**
 * 切题（进入下一题/下一份）的三态结果
 * - 'ok'    已成功切换并进入下一题
 * - 'last'  【确认】已经是最后一题 / 页面明确表示没有下一题
 *            （唯一允许作为"批改正常结束"依据的值）
 * - 'error' 其它一切情况：抛异常、页面未就绪、选择器失效、点击失败、
 *           超时、无法判断。**异常绝不允许被映射为 'last'。**
 */
export type NextPaperResult = 'ok' | 'last' | 'error'

/**
 * 页面分析结果接口
 * 扩展自 BrowserService 的 PageAnalysisResult，增加平台通用字段
 */
export interface PlatformPageAnalysisResult extends PageAnalysisResult {
  /** 平台名称 */
  platformName?: string
  /** 是否有答案图片 */
  hasAnswerImage?: boolean
  /** 是否有分数输入框 */
  hasScoreInput?: boolean
  /** 是否有提交按钮 */
  hasSubmitButton?: boolean
  /** 题目内容 */
  questionContent?: string
  /** 页面标题 */
  pageTitle?: string
  /** 额外信息 */
  extra?: Record<string, any>
}

/**
 * 平台适配器接口
 * 所有平台适配器必须实现此接口
 */
export interface PlatformAdapter {
  /** 平台名称 */
  readonly platformName: string

  /**
   * 分析页面结构
   * @param page - Playwright Page 对象
   * @returns 页面分析结果
   */
  analyzePage(page: any): Promise<PlatformPageAnalysisResult>

  /**
   * 捕获答案图片
   * @param page - Playwright Page 对象
   * @returns base64 编码的图片数据或 null
   */
  captureAnswerImage(page: any): Promise<string | null>

  /**
   * 提交分数
   * @param page - Playwright Page 对象
   * @param score - 分数
   * @returns 是否成功
   */
  submitScore(page: any, score: number): Promise<boolean>

  /**
   * 切换到下一题
   * @param page - Playwright Page 对象
   * @returns 三态结果（'ok' | 'last' | 'error'），详见 NextPaperResult
   */
  goToNext(page: any): Promise<NextPaperResult>

  /**
   * 获取平台名称
   * @returns 平台名称
   */
  getPlatformName(): string

  /**
   * 验证页面是否为当前平台
   * @param page - Playwright Page 对象
   * @returns 是否为当前平台
   */
  validatePage(page: any): Promise<boolean>
}

/**
 * 适配器构造函数类型
 */
export type PlatformAdapterFactory = () => PlatformAdapter

/**
 * 平台检测规则
 */
export interface PlatformDetectionRule {
  /** 平台标识 */
  platform: string
  /** URL 正则匹配模式 */
  urlPatterns: RegExp[]
  /** 优先级（数字越大优先级越高） */
  priority: number
}
