/**
 * AI 评分服务
 * 管理 AI 服务商配置，调用 AI API，构建评分提示词，解析评分结果，重试和降级逻辑
 */

import axios from 'axios'
import { LogService } from './LogService'
import { StorageService } from './StorageService'
import { isString, isObject, isNumber, isArray } from '../utils/validators'
import { GRADING, AI, RETRY, TIMEOUT, STORAGE_KEYS } from '../utils/constants'
import { buildThinkingParams, explainEmptyContent } from '../utils/thinkingParams'

// ============ 类型定义 ============

export interface BotSettings {
  providers: Array<{
    id: string
    name: string
    endpoint: string
    model: string
    // 视觉模型（选填）：图像直评使用；留空则回退用 model
    visionModel?: string
    // 思考模式（DeepSeek）：true=enabled / false=disabled / 未配置=不传该参数
    thinkingEnabled?: boolean
    // 推理强度（DeepSeek）：low / high / max，未配置则不传
    reasoningEffort?: 'low' | 'high' | 'max'
    isActive: boolean
  }>
  activeProviderId: string
  temperature: number
  maxTokens: number
}

export interface RubricDimension {
  id?: string
  description?: string
  desc?: string
  score?: number
  type?: 'positive' | 'negative'
}

export interface GradingStandard {
  id?: string
  name?: string
  // 题目正文（界面"题目内容"字段）。此前的版本从未把它传给模型，仅传了 name（标准名称）
  question?: string
  totalScore?: number
  questionNumber?: string
  /** 学科（选填）：选择后系统提示词角色变为「专业的XX批改老师」 */
  subject?: string
  // 兼容两种形态：渲染端传结构化数组（ScoringRule[]），旧形态为字符串
  scoringRules?: string | RubricDimension[]
  referenceAnswer?: string
  // 兼容 {score, comment} 与渲染端 {content, score, comment}
  examples?: Array<{ score?: number; comment?: string; content?: string }>
  otherRequirements?: string
  processMatters?: boolean
}

export interface Correction {
  originalScore: number
  correctedScore: number
  reason: string
  text?: string
}

export interface GradeResult {
  score: number
  comment: string
  // 评分依据：说明按哪条规则给/扣了多少分、为什么是这个分数。
  // 无论得分多少（含 0 分与满分）都必须有值，便于教师复核。
  reasoning?: string
  // 图像直评路径附带：模型对图中作答内容的逐字转录（原样文字，用于存档与核对）
  transcript?: string
  // 以下为可选字段（保持向后兼容）
  errorTags?: string[]
  needsHumanReview?: boolean
  rubricBreakdown?: Array<{ id: string; awarded: number }>
}

// ============ 评分输出要求（文本/图像两条路径共用，保证输出结构一致） ============
// 输入结构固定为五项：题目、满分、参考答案、评分细则、学生作答（图片或文本）
// 输出结构固定为两项：最终分数 + 简短的评分依据
const GRADING_OUTPUT_INSTRUCTION = `请严格按以上评分细则批改。必须且只返回如下 JSON（不要任何额外文字）：
{"score": <整数, 0~满分>, "reasoning": "<简短评分依据：按评分细则的哪几条给了几分、扣了几分，50~100字>"}
注意：
- score 字段的值必须且只能是整数阿拉伯数字（如 8、10、15），0 ≤ score ≤ 满分；
- 严禁返回汉字（如"满分"）、小数（如 8.5）、分数（如 7/10）、范围（如"8-9"）、百分数或任何描述性文字；模型无法给出确定数字时也必须输出一个整数占位，并在 reasoning 中说明存疑；
- 无论得分多少（包括 0 分与满分），reasoning 都必须填写，要具体到"哪几条细则给了分 / 扣了分 / 依据是什么"，便于教师复核。`

// ============ 图像直评专用输出要求 ============
// 与文本路径的区别：多一个 transcript 字段——模型须先逐字、原样把图中作答转成文字，
// 再基于这段转录评分。这样转录结果可审计、可存档（记录里的答题内容也来自它）。
const VISION_OUTPUT_INSTRUCTION = `请先严格按评分细则评分，再把图片中的作答内容逐字、原样转成文字存档。必须且只返回如下 JSON（不要任何额外文字）：
{"score": <整数, 0~满分>, "reasoning": "<简短评分依据：按评分细则的哪几条给了几分、扣了几分，50~100字>", "transcript": "<图中作答文字的逐字转录，原样保留换行与标点，不改字、不补字、不纠错、不翻译；看不清处标[无法辨认]>"}
注意：
- 字段顺序不可调换：先评分、后转录。评分完全依据图片中的作答内容，不得受后面转录内容的影响；transcript 仅用于存档与教师核对，其中的 [无法辨认] 不代表作答缺失，不得据此扣分；
- score 字段的值必须且只能是整数阿拉伯数字（如 8、10、15），0 ≤ score ≤ 满分；
- 严禁返回汉字（如"满分"）、小数（如 8.5）、分数（如 7/10）、范围（如"8-9"）、百分数或任何描述性文字；模型无法给出确定数字时也必须输出一个整数占位，并在 reasoning 中说明存疑；
- 无论得分多少（包括 0 分与满分），reasoning 都必须填写，要具体到"哪几条细则给了分 / 扣了分 / 依据是什么"，便于教师复核。`

// ============ 区域识别结果（自动获取坐标） ============
export interface RegionResult {
  // 批改区/答题区（矩形）
  answerArea: { x: number; y: number; width: number; height: number }
  // 成绩区/分数输入框（中心点）
  scoreInput: { x: number; y: number }
  // 提交区/提交按钮（中心点）
  submitButton: { x: number; y: number }
  // 下一张按钮（可选）
  nextButton?: { x: number; y: number }
}

// ============ AI 服务类 ============

export class AIService {
  private logger: LogService
  private storageService: StorageService
  private settings: BotSettings

  constructor(logger: LogService, storageService: StorageService) {
    this.logger = logger
    this.storageService = storageService
    this.settings = {
      providers: [],
      activeProviderId: '',
      temperature: AI.DEFAULT_TEMPERATURE,
      maxTokens: AI.DEFAULT_MAX_TOKENS,
    }
  }

  // ============ 公共方法 ============

  /**
   * 更新 AI 设置
   * @param settings - Bot 设置对象
   */
  updateSettings(settings: BotSettings): void {
    if (!isObject(settings)) {
      this.logger.warn('Invalid settings: not an object')
      return
    }

    this.settings = {
      providers: settings.providers || [],
      activeProviderId: settings.activeProviderId || '',
      temperature: settings.temperature ?? AI.DEFAULT_TEMPERATURE,
      maxTokens: settings.maxTokens ?? AI.DEFAULT_MAX_TOKENS,
    }

    this.logger.info('AI 设置已更新', {
      activeProviderId: this.settings.activeProviderId,
      providerCount: this.settings.providers.length,
    })
  }

  /**
   * 获取当前设置（脱敏，供渲染进程回读诊断）
   * 修复：此前 ipc.ts 的 bot:get-settings 调用了不存在的方法，会抛 TypeError
   */
  getSettings(): {
    activeProviderId: string
    temperature: number
    maxTokens: number
    providers: Array<{ id: string; name: string; endpoint: string; model: string; isActive: boolean }>
  } {
    return {
      activeProviderId: this.settings.activeProviderId,
      temperature: this.settings.temperature,
      maxTokens: this.settings.maxTokens,
    providers: this.settings.providers.map(p => ({
      id: p.id,
      name: p.name,
      endpoint: p.endpoint,
      model: p.model,
      visionModel: p.visionModel || '',
      isActive: p.id === this.settings.activeProviderId,
    })),
    }
  }

  /**
   * 获取活跃服务商配置
   * @returns 活跃服务商或 null
   */
  getActiveProvider(): (BotSettings['providers'][0] & { apiKey?: string }) | null {
    if (!this.settings.providers || this.settings.providers.length === 0) {
      return null
    }

    const active = this.settings.providers.find(
      p => p.id === this.settings.activeProviderId
    ) || this.settings.providers[0]

    return active || null
  }

  /**
   * 评分
   * @param text - 学生作答文本
   * @param standard - 评分标准
   * @param correctionHistory - 纠错历史（可选）
   * @returns 评分结果 { score, comment }
   */
  async grade(
    text: string,
    standard: GradingStandard,
    correctionHistory?: Correction[]
  ): Promise<GradeResult> {
    // 输入验证
    if (!text || !isString(text) || text.length > GRADING.TEXT_MAX_LENGTH) {
      // 修复 BUG-NEW-002：非法输入必须带人工复核标记，防止上层按正常 0 分提交
      return {
        score: 0,
        comment: '输入文本无效，未自动打分，请人工复核',
        reasoning: '输入文本为空或超出允许长度，系统未自动给分，请人工判断本题得分。',
        needsHumanReview: true,
        errorTags: ['输入无效'],
      }
    }

    if (!standard || !isObject(standard)) {
      return {
        score: 0,
        comment: '评分标准无效，未自动打分，请人工复核',
        reasoning: '评分标准缺失或格式错误，系统未自动给分，请人工判断本题得分。',
        needsHumanReview: true,
        errorTags: ['评分标准无效'],
      }
    }

    // 获取活跃服务商
    const activeProvider = this.getActiveProvider()

    this.logger.info('=== AI 评分 ===', {
      provider: activeProvider?.name,
      model: activeProvider?.model,
      textLength: text.length,
      correctionHistoryCount: correctionHistory?.length || 0,
    })

    // 如果没有配置活跃服务商或 API Key，使用本地评分
    if (!activeProvider) {
      this.logger.info('未配置活跃服务商，使用本地评分')
      return this.buildLocalFallback(text, standard, '未配置 AI 服务商')
    }

    // 从 StorageService 获取 API Key
    const apiKey = await this.storageService.getApiKey(activeProvider.id)
    
    // 验证 endpoint 是否已配置
    if (!activeProvider.endpoint) {
      this.logger.warn('活跃服务商的 endpoint 未配置，使用本地评分', {
        provider: activeProvider.name,
        providerId: activeProvider.id,
      })
      return this.buildLocalFallback(text, standard, '服务商 API 地址未配置')
    }
    
    if (!apiKey) {
      this.logger.info('活跃服务商没有 API Key，使用本地评分')
      return this.buildLocalFallback(text, standard, '服务商 API Key 未配置')
    }

    // 模型名必须显式配置。
    // 修复：此前 model 为空会 fallback 成 'deepseek-chat'，把 deepseek 的模型名发到别的厂商，
    // 结果是"填了自定义地址却始终报模型不存在"，表现为只能使用 deepseek。
    const modelName = (activeProvider.model || '').trim()
    if (!modelName) {
      this.logger.warn('活跃服务商未配置模型名称，使用本地评分', {
        provider: activeProvider.name,
        providerId: activeProvider.id,
      })
      return this.buildLocalFallback(text, standard, '未配置模型名称')
    }

    // 构建评分提示词
    const prompt = this.buildGradingPrompt(text, standard, correctionHistory)

    // 规范化 endpoint，确保以 /chat/completions 结尾（与 ipc.ts 中 bot:test-api 行为一致）
    const normalizedEndpoint = this.resolveEndpoint(activeProvider.endpoint)

    // 调用 AI API（带重试机制）
    let response: any = null
    let lastApiError: any = null
    // 强制 JSON 输出：部分 OpenAI 兼容接口不支持 response_format 参数（返回 400），
    // 遇到这种情况自动降级：本次及后续重试不再携带该参数。
    let supportsJsonFormat = true

    for (let attempt = 0; attempt < RETRY.AI_API_MAX; attempt++) {
      try {
        response = await axios.post(
          normalizedEndpoint,
          {
            model: modelName,
            messages: [
              {
                role: 'system',
                content: this.buildSystemPrompt(standard),
              },
              {
                role: 'user',
                content: prompt,
              },
            ],
            // 改进方案第一层：评分锁温度=0，保证同卷同分、可复现、可审计
            temperature: AI.GRADING_TEMPERATURE,
            max_tokens: this.settings.maxTokens,
            ...buildThinkingParams(activeProvider),
            ...(supportsJsonFormat ? { response_format: { type: 'json_object' as const } } : {}),
          },
          {
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${apiKey}`,
            },
            timeout: TIMEOUT.AI_API_CALL,
          }
        )

        break // 成功则跳出重试循环
      } catch (apiErr: any) {
        lastApiError = apiErr
        this.logger.error(`AI评分第${attempt + 1}次尝试失败:`, apiErr.message)

        // 400 通常是参数不被支持：降级为不带 response_format 重试
        if (supportsJsonFormat && apiErr?.response?.status === 400) {
          supportsJsonFormat = false
          this.logger.warn('服务商似乎不支持 response_format 参数，降级为普通文本模式重试')
        }

        if (attempt < RETRY.AI_API_MAX - 1) {
          const retryDelay = RETRY.AI_API_INTERVAL * (attempt + 1)
          this.logger.info(`等待${retryDelay}ms后重试...`)
          await new Promise(resolve => setTimeout(resolve, retryDelay))
        }
      }
    }

    // 如果所有重试都失败，降级到本地评分
    if (!response) {
      this.logger.error('AI评分3次重试均失败:', lastApiError?.message)
      return this.buildLocalFallback(text, standard, 'AI 服务调用失败（已重试 3 次）')
    }

    // 解析评分结果
    return this.parseGradingResult(response, standard, text, activeProvider.thinkingEnabled)
  }

  /**
   * 图像直评（首选路径）：把答题截图直接交给具备原生视觉能力的模型，
   * 由模型完成"内容识别 + 评分"一步到位，输出结构与 OCR 文本路径完全一致。
   *
   * 返回 { ok, result?, reason? }：
   * - ok=true：视觉路径评分成功，result 可直接当 GradeResult 使用
   * - ok=false：调用方应回退到 OCR + 文本评分，reason 为切换原因（需记入日志）
   *
   * 触发回退的条件：未配置视觉模型/地址/Key、请求异常、返回结果不可解析。
   */
  async gradeWithImage(
    imageDataUrl: string,
    standard: GradingStandard,
    correctionHistory?: Correction[]
  ): Promise<{ ok: boolean; result?: GradeResult; reason?: string }> {
    if (!imageDataUrl || !isString(imageDataUrl)) {
      return { ok: false, reason: '缺少答题图片' }
    }
    if (!standard || !isObject(standard)) {
      return { ok: false, reason: '缺少评分标准' }
    }

    const activeProvider = this.getActiveProvider()
    if (!activeProvider) {
      return { ok: false, reason: '未配置 AI 服务商' }
    }
    if (!activeProvider.endpoint) {
      return { ok: false, reason: '服务商未配置 API 地址' }
    }

    // 视觉模型：优先取服务商的 visionModel，未配置则回退用主模型
    const modelName = (activeProvider.visionModel || activeProvider.model || '').trim()
    if (!modelName) {
      return { ok: false, reason: '未配置视觉模型名称' }
    }

    const apiKey = await this.storageService.getApiKey(activeProvider.id)
    if (!apiKey) {
      return { ok: false, reason: '服务商未配置 API Key' }
    }

    const prompt = this.buildVisionGradingPrompt(standard, correctionHistory)
    const normalizedEndpoint = this.resolveEndpoint(activeProvider.endpoint)

    let supportsJsonFormat = true
    let response: any = null
    let lastApiError: any = null

    for (let attempt = 0; attempt < RETRY.AI_API_MAX; attempt++) {
      try {
        response = await axios.post(
          normalizedEndpoint,
          {
            model: modelName,
            messages: [
              {
                role: 'system',
                content: this.buildSystemPrompt(standard),
              },
              {
                role: 'user',
                content: [
                  { type: 'text', text: prompt },
                  { type: 'image_url', image_url: { url: imageDataUrl } },
                ],
              },
            ],
            // 与文本路径一致：锁温度 0，保证同卷同分
            temperature: AI.GRADING_TEMPERATURE,
            max_tokens: this.settings.maxTokens,
            ...buildThinkingParams(activeProvider),
            ...(supportsJsonFormat ? { response_format: { type: 'json_object' as const } } : {}),
          },
          {
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${apiKey}`,
            },
            timeout: TIMEOUT.AI_API_CALL,
          }
        )
        break
      } catch (apiErr: any) {
        lastApiError = apiErr
        this.logger.error(`图像直评第${attempt + 1}次尝试失败:`, apiErr?.message)
        if (supportsJsonFormat && apiErr?.response?.status === 400) {
          supportsJsonFormat = false
          this.logger.warn('服务商似乎不支持 response_format 参数，降级为普通文本模式重试')
        }
        if (attempt < RETRY.AI_API_MAX - 1) {
          await new Promise(resolve => setTimeout(resolve, RETRY.AI_API_INTERVAL * (attempt + 1)))
        }
      }
    }

    if (!response) {
      const msg = lastApiError?.response?.data?.error?.message || lastApiError?.message || '未知错误'
      return { ok: false, reason: `图像识别请求失败：${msg}` }
    }

    const result = this.parseGradingResult(response, standard, '', activeProvider.thinkingEnabled)

    // parseGradingResult 在 JSON 无法解析时会打上该标签，据此判定"结果不可解析"。
    // 修复：此前统一文案为"非合法 JSON"，掩盖了真实原因（空正文 / 缺 score 字段等），
    // 现改为把模型返回的真实归因透传给上层。
    if (result.errorTags?.includes('AI返回解析失败')) {
      const detail = (result.comment || '图像识别返回结果不可解析')
        .replace('，未自动打分，请人工复核', '')
      return { ok: false, reason: detail }
    }


    this.logger.info('=== 图像直评完成 ===', {
      model: modelName,
      score: result.score,
    })
    return { ok: true, result }
  }

  /**
   * 纠错分析：教师在试改模式纠正评分后，调用 AI 分析差异原因并优化关键词。
   * 此前 bot:analyzeCorrection 只有白名单没有 handler，调用一直静默失败。
   */
  async analyzeCorrection(payload: {
    aiScore: number
    teacherScore: number
    reason?: string
    standard?: GradingStandard
    recognizedText?: string
  }): Promise<{ success: boolean; analysis?: string; optimizedKeywords?: string[]; error?: string }> {
    const activeProvider = this.getActiveProvider()
    if (!activeProvider) {
      return { success: false, error: '未配置 AI 服务商' }
    }
    if (!activeProvider.endpoint) {
      return { success: false, error: '未配置 API 地址' }
    }
    const modelName = (activeProvider.model || '').trim()
    if (!modelName) {
      return { success: false, error: '未配置模型名称' }
    }
    const apiKey = await this.storageService.getApiKey(activeProvider.id)
    if (!apiKey) {
      return { success: false, error: '未配置 API Key' }
    }

    const standard = payload.standard || {}
    const aiScore = Number(payload.aiScore) || 0
    const teacherScore = Number(payload.teacherScore) || 0
    const reason = (payload.reason || '未填写').trim()
    const recognizedText = (payload.recognizedText || '').substring(0, 2000)

    const rubricText = isArray(standard.scoringRules)
      ? standard.scoringRules.map((r: any, i: number) => {
          const desc = r?.description || r?.desc || ''
          const isNeg = r?.type === 'negative'
          const sc = isNeg ? -Math.abs(r?.score ?? 0) : (r?.score ?? 0)
          return `${i + 1}. ${desc} ${isNeg ? sc : '+' + sc}分`
        }).join('\n')
      : ''

    const prompt = `【背景】教师在试改模式中纠正了 AI 的评分，请分析差异原因，帮助后续批改改进。
【题目】${standard.name || ''}${standard.question ? `\n【题目正文】${standard.question}` : ''}
【满分】${standard.totalScore || 10}分
${rubricText ? `\n【评分量规】\n${rubricText}` : ''}
${standard.referenceAnswer ? `\n【参考答案】\n${standard.referenceAnswer}` : ''}

【AI 原评分】${aiScore} 分
【教师纠正为】${teacherScore} 分
【教师填写的原因】${reason}
【学生作答（节选）】
${recognizedText || '（无文本）'}

请分析：1) AI 为什么打低了/打高了；2) 给出 3~5 个可用于后续批改的优化关键词（如易错点、必须覆盖的要点）。
必须且只返回如下 JSON（不要任何额外文字）：
{"analysis": "<不超过150字的原因分析>", "optimizedKeywords": ["关键词1", "关键词2"]}`

    const normalizedEndpoint = this.resolveEndpoint(activeProvider.endpoint)
    let supportsJsonFormat = true
    let response: any = null
    let lastApiError: any = null

    for (let attempt = 0; attempt < RETRY.AI_API_MAX; attempt++) {
      try {
        response = await axios.post(
          normalizedEndpoint,
          {
            model: modelName,
            messages: [
              {
                role: 'system',
                content: '你是批改质量分析助手。根据教师纠错信息分析评分差异，只返回 JSON。',
              },
              { role: 'user', content: prompt },
            ],
            // 分析类任务不锁温度 0，但保持较低值保证稳定
            temperature: AI.DEFAULT_TEMPERATURE,
            max_tokens: this.settings.maxTokens,
            ...buildThinkingParams(activeProvider),
            ...(supportsJsonFormat ? { response_format: { type: 'json_object' as const } } : {}),
          },
          {
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${apiKey}`,
            },
            timeout: TIMEOUT.AI_API_CALL,
          }
        )
        break
      } catch (apiErr: any) {
        lastApiError = apiErr
        this.logger.error(`纠错分析第${attempt + 1}次尝试失败:`, apiErr?.message)
        if (supportsJsonFormat && apiErr?.response?.status === 400) {
          supportsJsonFormat = false
          this.logger.warn('服务商似乎不支持 response_format 参数，降级为普通文本模式重试')
        }
        if (attempt < RETRY.AI_API_MAX - 1) {
          await new Promise(resolve => setTimeout(resolve, RETRY.AI_API_INTERVAL * (attempt + 1)))
        }
      }
    }

    if (!response) {
      const msg = lastApiError?.response?.data?.error?.message || lastApiError?.message || '未知错误'
      return { success: false, error: `纠错分析请求失败：${msg}` }
    }

    const content = response.data.choices?.[0]?.message?.content?.trim() || ''
    let analysis = content
    let optimizedKeywords: string[] = []

    const applyParsed = (parsed: any) => {
      if (parsed?.analysis) analysis = String(parsed.analysis)
      if (isArray(parsed?.optimizedKeywords)) {
        optimizedKeywords = parsed.optimizedKeywords.map((k: unknown) => String(k)).filter(Boolean).slice(0, 5)
      }
    }

    try {
      applyParsed(JSON.parse(content))
    } catch {
      const m = content.match(/\{[\s\S]*\}/)
      if (m) {
        try {
          applyParsed(JSON.parse(m[0]))
        } catch {
          // 整段文本作为分析结果使用
        }
      }
    }

    this.logger.info('纠错分析完成', { hasAnalysis: !!analysis, keywords: optimizedKeywords.length })
    return { success: true, analysis, optimizedKeywords }
  }

  /**
   * 解析失败结果：绝不猜分数，标记人工复核，并保留模型原始输出便于排查。
   * 典型场景：思考模式耗尽 max_tokens 导致正文为空、服务商不支持 JSON 输出格式。
   */
  buildUnparsableResult(reason: string, reasoningContent?: string, rawContent?: string): GradeResult {
    const preview = (rawContent || '').replace(/\s+/g, ' ').trim().slice(0, 160)
    const reasoningPreview = (reasoningContent || '').replace(/\s+/g, ' ').trim()

    this.logger.warn(`AI 返回无法解析：${reason}`, {
      hasReasoningContent: !!reasoningPreview,
      contentPreview: preview,
      reasoningPreview: reasoningPreview.slice(0, 300),
    })

    return {
      score: 0,
      comment: `${reason}，未自动打分，请人工复核`,
      reasoning:
        `${reason}。因此系统未自动给分，请人工判断本题得分。` +
        (preview ? `模型返回片段：${preview}` : '') +
        (reasoningPreview ? '（模型只产出了思维链，正文为空）' : ''),
      needsHumanReview: true,
      errorTags: ['AI返回解析失败'],
    }
  }

  /**
   * 本地降级评分结果（未调用 AI 或 AI 不可用时）
   * 统一带 comment + reasoning + 人工复核标记，保证任何情况下都有评分依据可看。
   * @param reason - 未调用 AI 的原因，写入依据说明
   */
  buildLocalFallback(text: string, standard: GradingStandard, reason: string): GradeResult {
    const localScore = this.gradeLocally(text, standard)
    const maxScore = standard?.totalScore || 10
    const score = Math.floor(localScore)
    const comment = this.generateLocalComment(text, standard, localScore)

    return {
      score,
      comment: `${comment}（${reason}）`,
      reasoning:
        `未取得 AI 判分（${reason}）。系统按本地规则粗略估算：` +
        `关键词命中、作答长度等指标得出 ${score} 分（满分 ${maxScore} 分）。` +
        '本地评分不依据评分量规，结果仅供参考，建议人工复核或补全 AI 配置后重新批改。',
      needsHumanReview: true,
      errorTags: ['使用本地评分'],
    }
  }

  /**
   * 本地评分（降级方案）
   * @param text - 学生作答文本
   * @param standard - 评分标准
   * @returns 本地评分分数
   */
  gradeLocally(text: string, standard: GradingStandard): number {
    let score = GRADING.LOCAL_GRADING.BASE_SCORE

    // 包含题目关键词加分
    const questionKeywords = (standard.name || '').split('')
    const hasQuestionKeyword = questionKeywords.some(keyword =>
      keyword && text.includes(keyword)
    )
    if (hasQuestionKeyword) {
      score += GRADING.LOCAL_GRADING.HAS_QUESTION_BONUS
    }

    // 内容长度加分
    if (text.length > GRADING.TEXT_MIN_LENGTH_FOR_BONUS) {
      score += GRADING.LOCAL_GRADING.LENGTH_BONUS
    }

    // 限制在有效范围内
    const maxScore = standard.totalScore || GRADING.SCORE_MAX
    return Math.min(maxScore, Math.max(GRADING.SCORE_MIN, score))
  }

  /**
   * 生成本地评语
   * @param text - 学生作答文本
   * @param standard - 评分标准
   * @param score - 分数
   * @returns 评语
   */
  generateLocalComment(text: string, standard: GradingStandard, score: number): string {
    if (!standard) return '已使用本地评分标准完成评分'

    const maxScore = standard.totalScore || 10
    const ratio = score / maxScore

    if (ratio >= 0.9) return '回答非常优秀，要点齐全，表述清晰'
    if (ratio >= 0.7) return '回答基本正确，但部分要点不够完整'
    if (ratio >= 0.5) return '回答有一定内容，但缺少关键要点'
    if (ratio > 0) return '回答不够完整，建议补充更多内容'
    return '未检测到有效作答内容'
  }

  // ============ 私有方法 ============

  /**
   * 去除首尾空白与末尾斜杠
   */
  private normalizeUrl(raw: string): string {
    return (raw || '').trim().replace(/\/+$/, '')
  }

  /**
   * 解析对话接口完整地址
   * 兼容用户填写 base（https://x/v1）或完整路径（https://x/v1/chat/completions）
   */
  private resolveEndpoint(raw: string): string {
    const base = this.normalizeUrl(raw)
    if (!base) return ''
    if (base.endsWith('/chat/completions')) return base
    return `${base}/chat/completions`
  }

  /**
   * 构建评分上下文（题目 + 满分 + 量规 + 参考答案 + 示例 + 关键词 + 其他要求 + 纠错学习）
   * 文本路径与图像路径共用，保证两条路径的评分维度完全一致。
   * @param standard - 评分标准
   * @param correctionHistory - 纠错历史
   * @returns 评分上下文文本
   */
  /**
   * 按评分标准选择的学科构建系统提示词。
   * 选择了学科（如「语文」）时，模型收到的角色是「你是一名专业的语文批改老师」；
   * 未选择时使用默认角色「你是一名专业的批改老师」。
   */
  private buildSystemPrompt(standard?: { subject?: string }): string {
    const subject = (standard?.subject || '').trim()
    const roleText = subject ? `你是一名专业的${subject}批改老师` : '你是一名专业的批改老师'
    return AI.SYSTEM_PROMPT.replace('{{SUBJECT_ROLE}}', roleText)
  }

  private buildStandardContext(
    standard: GradingStandard,
    correctionHistory?: Correction[]
  ): string {
    // 构建纠错学习提示
    let learningPrompt = ''
    if (correctionHistory && correctionHistory.length > 0) {
      const recentCorrections = correctionHistory.slice(-5) // 最近5条
      learningPrompt = `
【历史纠错学习】
以下是之前批改中教师纠正的案例，请学习并在本次批改中应用：
${recentCorrections.map((c, i) => `
${i + 1}. AI原评分：${c.originalScore}分 → 教师纠正：${c.correctedScore}分
   原因：${c.reason}
   学生作答片段：${c.text?.substring(0, 100) || '(无文本)'}...
`).join('')}

请特别注意以上纠错原因，避免在本次批改中犯同样的错误。
`
    }

    // 构建题目信息
    // 修复：此前只传 name（标准名称），题目正文 question 从未进入 prompt，
    // 导致模型看不到"题目到底问什么"。这里保留 name 段并追加【题目正文】，
    // 兼容"题目写在名称里"和"题目写在题目内容里"两种填写习惯。
    let questionPrompt = ''
    if (standard.name) {
      questionPrompt = `【题目】${standard.name}`
    }
    const questionText = (standard.question || '').trim()
    if (questionText) {
      questionPrompt += questionPrompt ? `\n【题目正文】${questionText}` : `【题目正文】${questionText}`
    }

    // 构建评分量规（rubric）：兼容结构化数组与旧字符串形态
    let rubricPrompt = ''
    if (standard.scoringRules) {
      if (isArray(standard.scoringRules) && standard.scoringRules.length > 0) {
        rubricPrompt = `\n【评分量规 Rubric（加分项为正、扣分项为负，各维度实得相加即总分）】\n` +
          standard.scoringRules.map((rule, i) => {
            const desc = (rule as RubricDimension).description || (rule as RubricDimension).desc || ''
            const raw = (rule as RubricDimension).score ?? 0
            const isNegative = (rule as RubricDimension).type === 'negative'
            // 修复：此前统一渲染成 "+N分（扣分项）"，模型会把扣分项当加分处理。
            // 扣分项强制取负（界面填 3 或 -3 都渲染为 -3分），加分项保留原值。
            const sc = isNegative ? -Math.abs(raw) : raw
            const scoreLabel = isNegative ? `${sc}分` : `+${sc}分`
            const typeLabel = isNegative ? '（扣分项）' : ''
            const idLabel = (rule as RubricDimension).id ? `[${(rule as RubricDimension).id}] ` : `[r${i + 1}] `
            return `${i + 1}. ${idLabel}${desc} ${scoreLabel}${typeLabel}`
          }).join('\n')

        // 新增：量规分值对账。合计与满分不一致时明确告知模型，避免其自行凑满或困惑。
        const rubricTotal = (standard.scoringRules as RubricDimension[]).reduce((sum: number, rule) => {
          const raw = rule?.score ?? 0
          return sum + ((rule as RubricDimension).type === 'negative' ? -Math.abs(raw) : raw)
        }, 0)
        const fullScore = standard.totalScore || 10
        if (rubricTotal !== fullScore) {
          rubricPrompt += `\n注意：当前量规各维度合计为 ${rubricTotal} 分，与满分 ${fullScore} 分不一致。请严格按各维度分值评分，score 不得超过满分，也不要自行凑满 ${fullScore} 分。`
        }
      } else if (isString(standard.scoringRules) && standard.scoringRules.trim()) {
        rubricPrompt = `\n【评分规则】\n${standard.scoringRules}`
      }
    }

    // 构建参考答案
    let referenceAnswerPrompt = ''
    if (standard.referenceAnswer) {
      referenceAnswerPrompt = `
【参考答案】
${standard.referenceAnswer}`
    }

    // 构建示例（兼容 {score, comment} 与渲染端 {content, score, comment}）
    let examplesPrompt = ''
    if (standard.examples && isArray(standard.examples) && standard.examples.length > 0) {
      examplesPrompt = `
【评分示例】
${standard.examples.map((ex, i) => {
        const content = ex.content ? `（${ex.content}）` : ''
        return `示例${i + 1}：${ex.score}分 - ${ex.comment || ''}${content}`
      }).join('\n')}`
    }

    // 构建其他要求
    // 注：过程分已改为「可选开关 + 自动写入评分细则文本框」，不再作为独立段落注入，
    // 因此这里只处理用户填写的其他要求。
    let otherRequirementsPrompt = ''
    if (standard.otherRequirements) {
      otherRequirementsPrompt += `
【其他要求】
${standard.otherRequirements}`
    }

    // 输入结构固定为五项，核心项按序排在最前，其余为可选补充：
    // 【题目】→【满分】→【参考答案】→【评分细则】→【学生作答】(文本或图片)
    // 补充项：【题号】【关键词】【评分示例】【其他要求】【历史纠错学习】
    // 文本路径与图像路径共用这一段，保证两条路径的评分依据完全一致。
    return `${questionPrompt}
【满分】${standard.totalScore || 10}分
${referenceAnswerPrompt}
${rubricPrompt}
${standard.questionNumber ? `【题号】${standard.questionNumber}` : ''}
${examplesPrompt}
${otherRequirementsPrompt}
${learningPrompt}`
  }

  /**
   * 构建【文本作答】评分提示词（OCR 兜底路径使用）
   */
  private buildGradingPrompt(
    text: string,
    standard: GradingStandard,
    correctionHistory?: Correction[]
  ): string {
    return `${this.buildStandardContext(standard, correctionHistory)}

【学生作答】
${text}

${GRADING_OUTPUT_INSTRUCTION}`
  }

  /**
   * 构建【图像作答】评分提示词（图像直评首选路径使用）
   * 除作答载体由文本换成图片外，其余评分维度与输出要求与文本路径完全一致。
   */
  private buildVisionGradingPrompt(
    standard: GradingStandard,
    correctionHistory?: Correction[]
  ): string {
    return `${this.buildStandardContext(standard, correctionHistory)}

【学生作答】
学生的作答内容见下方图片（答题区截图）。请严格按上述评分细则批改；评分完成后，再把图片中的作答内容逐字、原样转成文字存档（不改字、不补字、不纠错、不翻译，看不清处标[无法辨认]）。

${VISION_OUTPUT_INSTRUCTION}`
  }

  /**
   * 解析评分结果
   * @param response - AI API 响应
   * @param standard - 评分标准
   * @param text - 学生作答文本
   * @returns 评分结果
   */
  private parseGradingResult(
    response: any,
    standard: GradingStandard,
    text: string,
    thinkingEnabled?: boolean
  ): GradeResult {
    const choice = response.data?.choices?.[0]
    const content = choice?.message?.content?.trim() || '{}'
    const reasoningContent = choice?.message?.reasoning_content?.trim() || ''
    const maxScore = standard?.totalScore || 10
    let parsed: any = {}

    // 修复：此前解析失败会调用 parseScore 抓取文本中"第一个数字"当分数，
    // 可能把"满分20""第3点"之类的数字当成得分，属于错分。
    // 改为：不猜分数，给 0 分并强制标记人工复核，同时把原始返回记入日志便于排查。
    // 修复：正文为空时必须判定为解析失败并转人工，
    // 不能落进 parsed={} 分支被静默按本地关键词评分（那会给出无依据的分数）。
    if (!choice?.message?.content || !String(choice.message.content).trim()) {
      // 文案与 bot:test-api 共用同一实现（explainEmptyContent）：
      // 用户已关闭思考却仍收到思维链时，不再叫他去"关闭思考模式"。
      const hint = explainEmptyContent(reasoningContent, thinkingEnabled)
      return this.buildUnparsableResult(`AI 未返回评分内容（${hint}）`, reasoningContent, '')
    }

    const unparsable = (reason: string): GradeResult => {
      this.logger.warn('AI 返回内容预览', { preview: content.substring(0, 500) })
      return this.buildUnparsableResult(reason, reasoningContent, content === '{}' ? '' : content)
    }

    try {
      parsed = JSON.parse(content)
    } catch {
      // 尝试从文本中提取 JSON（模型可能夹带额外文字）
      const jsonMatch = content.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        try {
          parsed = JSON.parse(jsonMatch[0])
        } catch {
          return unparsable('AI 返回的内容不是合法 JSON')
        }
      } else {
        return unparsable('AI 未返回结构化结果')
      }
    }

    // 分数：兼容英文/中文键名。
    // 修复：AI 返回的 JSON 里没有分数字段时，不再静默用本地评分冒充 AI 判分，
    // 而是标记解析失败转人工（避免出现"有分数、无依据"的结果）。
    const rawScore = parsed?.score ?? parsed?.得分 ?? parsed?.总分
    if (rawScore === undefined) {
      return unparsable('AI 返回的 JSON 中缺少 score 字段')
    }
    const rawScoreStr = String(rawScore)
    const score = this.parseScore(rawScoreStr, maxScore)
    if (score === null) {
      // 修复 BUG-NEW-001：字段存在但无法解析为数字（如"满分"）→ 转人工复核
      return unparsable(`AI 返回的分数无法解析为数字：${JSON.stringify(rawScoreStr)}`)
    }

    // 评语
    const comment = parsed?.comment ?? parsed?.评语 ?? ''

    // 图像直评的逐字转录（仅有该字段时才写入）
    const transcript = typeof parsed?.transcript === 'string' && parsed.transcript.trim()
      ? parsed.transcript.trim()
      : undefined

    // 错因标签
    let errorTags: string[] | undefined
    const rawTags = parsed?.errorTags ?? parsed?.错因标签
    if (isArray(rawTags)) {
      errorTags = rawTags.map((t: unknown) => String(t))
    }

    // 维度得分（用于审计/一致性）
    let rubricBreakdown: Array<{ id: string; awarded: number }> | undefined
    const rawBreakdown = parsed?.rubricBreakdown ?? parsed?.维度得分
    if (isArray(rawBreakdown)) {
      rubricBreakdown = rawBreakdown
        .map((b: any) => ({
          id: String(b?.id ?? b?.维度 ?? ''),
          awarded: Number(b?.awarded ?? b?.实得 ?? 0) || 0,
        }))
        .filter((b: { id: string }) => b.id)
    }

    // 评分依据：无论得分多少都必须有值（prompt 已强制要求，这里再做兜底合成）
    let reasoning = String(parsed?.reasoning ?? parsed?.评分依据 ?? '').trim()

    // 兜底：模型未返回依据时，用维度得分 + 评语合成一条可读依据，
    // 确保"无论批改出多少分，都能看到为什么是这个分数"。
    if (!reasoning) {
      const parts: string[] = [`本题满分 ${maxScore} 分，判定得分 ${score} 分。`]
      if (rubricBreakdown && rubricBreakdown.length > 0) {
        parts.push(
          '各维度实得：' +
          rubricBreakdown.map(b => `${b.id} ${b.awarded}分`).join('；') + '。'
        )
      }
      if (comment) {
        parts.push(`评语：${comment}`)
      }
      if (rubricBreakdown?.length === 0 && !comment) {
        parts.push('模型未返回详细依据，建议人工复核。')
        this.logger.warn('模型未返回评分依据，已合成兜底说明')
      }
      reasoning = parts.join('')
    }

    this.logger.info('=== AI 评分完成 ===', {
      score,
      errorTagsCount: errorTags?.length || 0,
      breakdownCount: rubricBreakdown?.length || 0,
      hasReasoning: !!reasoning,
    })

    return {
      score,
      comment,
      reasoning,
      ...(transcript ? { transcript } : {}),
      ...(errorTags ? { errorTags } : {}),
      ...(rubricBreakdown ? { rubricBreakdown } : {}),
    }
  }

  /**
   * 区域识别（自动获取坐标）：将整页截图发送给支持多模态的模型，
   * 由模型识别批改区/成绩区/提交区的像素坐标。
   * 注意：依赖模型支持图像输入；若所用模型为纯文本模型，会抛出友好错误。
   * @param imageDataUrl - 整页截图的 data URL（data:image/png;base64,...）
   * @param hint - 可选的补充提示（如平台特征）
   * @returns 三类区域的坐标
   */
  async recognizeRegion(imageDataUrl: string, hint?: string): Promise<RegionResult> {
    if (!imageDataUrl || typeof imageDataUrl !== 'string') {
      throw new Error('缺少页面截图')
    }

    const activeProvider = this.getActiveProvider()
    if (!activeProvider) {
      throw new Error('未配置 AI 服务商，请先在设置中配置')
    }
    if (!activeProvider.endpoint) {
      throw new Error('服务商 endpoint 未配置')
    }
    const apiKey = await this.storageService.getApiKey(activeProvider.id)
    if (!apiKey) {
      throw new Error('服务商 API Key 未配置')
    }
    if (!(activeProvider.model || '').trim()) {
      throw new Error('服务商未配置模型名称，请先在设置中填写支持视觉的模型')
    }

    const normalizedEndpoint = this.resolveEndpoint(activeProvider.endpoint)

    const prompt = `你是一个界面坐标识别助手。给定一张网页截图，请识别以下三个区域在截图原始像素坐标系下的位置（使用图片真实宽高，不要归一化、不要用百分比）：
1. 批改区/答题区(answerArea)：包含学生作答内容的矩形区域，x/y 为左上角，width/height 为宽高。
2. 成绩区/分数输入框(scoreInput)：用于输入分数的输入框中心点的像素坐标。
3. 提交区/提交按钮(submitButton)：提交按钮中心点的像素坐标。
${hint ? `补充提示：${hint}` : ''}
必须且只返回如下 JSON（不要任何额外文字或 Markdown 代码块）：
{"answerArea":{"x":<int>,"y":<int>,"width":<int>,"height":<int>},"scoreInput":{"x":<int>,"y":<int>},"submitButton":{"x":<int>,"y":<int>},"nextButton":{"x":<int>,"y":<int>}}
注意：所有坐标为非负整数；answerArea 的 width 与 height 必须大于 0。`

    let response: any = null
    let lastApiError: any = null

    for (let attempt = 0; attempt < RETRY.AI_API_MAX; attempt++) {
      try {
        response = await axios.post(
          normalizedEndpoint,
          {
            model: (activeProvider.model || '').trim(),
            messages: [
              {
                role: 'user',
                content: [
                  { type: 'text', text: prompt },
                  { type: 'image_url', image_url: { url: imageDataUrl } },
                ],
              },
            ],
            // 区域识别同样锁温度，保证可复现
            temperature: AI.GRADING_TEMPERATURE,
            max_tokens: this.settings.maxTokens,
          },
          {
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${apiKey}`,
            },
            timeout: TIMEOUT.AI_API_CALL,
          }
        )
        break
      } catch (apiErr: any) {
        lastApiError = apiErr
        this.logger.error(`区域识别第${attempt + 1}次尝试失败:`, apiErr?.message)
        if (attempt < RETRY.AI_API_MAX - 1) {
          await new Promise((resolve) => setTimeout(resolve, RETRY.AI_API_INTERVAL * (attempt + 1)))
        }
      }
    }

    if (!response) {
      const msg =
        lastApiError?.response?.data?.error?.message ||
        lastApiError?.message ||
        '未知错误'
      // 常见的"不支持图像"类错误给出针对性提示
      if (/image|vision|multimodal|not support|does not support|base64|content/i.test(String(msg))) {
        throw new Error('当前模型似乎不支持图像识别（多模态）。请在设置中将模型切换为支持视觉的模型（如 Qwen-VL / GPT-4o 类），或改用"手动获取"坐标。')
      }
      throw new Error(`区域识别请求失败：${msg}`)
    }

    return this.parseRegionResult(response)
  }

  /**
   * 解析区域识别结果，校验坐标完整性
   */
  private parseRegionResult(response: any): RegionResult {
    const content = response?.data?.choices?.[0]?.message?.content?.trim() || '{}'
    let parsed: any = {}
    try {
      parsed = JSON.parse(content)
    } catch {
      const jsonMatch = content.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        try {
          parsed = JSON.parse(jsonMatch[0])
        } catch {
          throw new Error('模型未返回有效 JSON，请确认所用模型支持图像识别（多模态），或改用"手动获取"坐标')
        }
      } else {
        throw new Error('模型未返回结构化坐标，请确认所用模型支持图像识别（多模态），或改用"手动获取"坐标')
      }
    }

    const answerArea = parsed?.answerArea
    const scoreInput = parsed?.scoreInput
    const submitButton = parsed?.submitButton

    if (!answerArea
      || !isNumber(answerArea.x) || !isNumber(answerArea.y)
      || !isNumber(answerArea.width) || !isNumber(answerArea.height)
      || Number(answerArea.width) <= 0 || Number(answerArea.height) <= 0) {
      throw new Error('识别结果缺少有效的批改区(answerArea)坐标')
    }
    if (!scoreInput || !isNumber(scoreInput.x) || !isNumber(scoreInput.y)) {
      throw new Error('识别结果缺少有效的成绩区(scoreInput)坐标')
    }
    if (!submitButton || !isNumber(submitButton.x) || !isNumber(submitButton.y)) {
      throw new Error('识别结果缺少有效的提交区(submitButton)坐标')
    }

    const toInt = (n: any) => Math.max(0, Math.round(Number(n)))

    const result: RegionResult = {
      answerArea: {
        x: toInt(answerArea.x),
        y: toInt(answerArea.y),
        width: toInt(answerArea.width),
        height: toInt(answerArea.height),
      },
      scoreInput: { x: toInt(scoreInput.x), y: toInt(scoreInput.y) },
      submitButton: { x: toInt(submitButton.x), y: toInt(submitButton.y) },
    }

    if (parsed?.nextButton && isNumber(parsed.nextButton.x) && isNumber(parsed.nextButton.y)) {
      result.nextButton = { x: toInt(parsed.nextButton.x), y: toInt(parsed.nextButton.y) }
    }

    this.logger.info('=== 区域识别完成 ===', {
      answerArea: result.answerArea,
      scoreInput: result.scoreInput,
      submitButton: result.submitButton,
      hasNext: !!result.nextButton,
    })

    return result
  }

  /**
   * 解析分数
   * @param result - 分数字符串
   * @param maxScore - 满分
   * @returns 解析后的分数
   */
  private parseScore(result: string, maxScore: number): number | null {
    // 提取数字
    const match = result.match(/(\d+)/)
    if (match) {
      const score = parseInt(match[1], 10)
      // 确保在有效范围内
      return Math.min(maxScore, Math.max(0, score))
    }

    // 修复 BUG-NEW-001：分数无法解析为数字时不再用本地评分冒充 AI 判分，
    // 返回 null，由调用方转人工复核（与"缺 score 字段"分支行为一致）
    return null
  }
}

// ============ 默认 AI 服务实例 ============

let defaultAIService: AIService | null = null

/**
 * 获取默认 AI 服务实例（单例）
 */
export function getAIService(logger?: LogService, storageService?: StorageService): AIService {
  if (!defaultAIService && logger && storageService) {
    defaultAIService = new AIService(logger, storageService)
  }
  return defaultAIService!
}

/**
 * 创建新的 AI 服务实例
 */
export function createAIService(logger: LogService, storageService: StorageService): AIService {
  return new AIService(logger, storageService)
}

// ============ 导出 ============

export default AIService
