import axios from 'axios'
import FormData from 'form-data'
import type { LogService } from './LogService'

// 修复：使用注入的 LogService 替代硬编码 console logger
// 保留 console 作为降级方案，签名与 LogService 保持一致以支持联合类型调用
const fallbackLogger = {
  info: (message: string, meta?: Record<string, any>) => {
    console.log('[OCRService]', message, meta ?? '')
  },
  error: (message: string, error?: Error, meta?: Record<string, any>) => {
    console.error('[OCRService]', message, error ?? '', meta ?? '')
  },
  warn: (message: string, meta?: Record<string, any>) => {
    console.warn('[OCRService]', message, meta ?? '')
  },
  debug: (message: string, meta?: Record<string, any>) => {
    console.debug('[OCRService]', message, meta ?? '')
  },
}

// 简化 isString 检查
function isString(value: any): value is string {
  return typeof value === 'string'
}

// AI Studio PaddleOCR API 配置
const AISTUDIO_API = {
  BASE_URL: 'https://paddleocr.aistudio-app.com',
  SUBMIT_PATH: '/api/v2/ocr/jobs',
  RESULT_PATH: (jobId: string) => `/api/v2/ocr/jobs/${jobId}`,
  // 支持的模型列表（2026-07 更新，旧模型 PP-OCRv5/PaddleOCR-VL/VL-1.5 已下线）
  MODELS: {
    'PaddleOCR-VL-1.6': 'PaddleOCR-VL-1.6',
    'PP-OCRv6': 'PP-OCRv6',
    'PP-StructureV3': 'PP-StructureV3',
  },
  DEFAULT_MODEL: 'PaddleOCR-VL-1.6',
}

export interface OCRResult {
  text: string
  isBlank: boolean
  error?: string
}

export class OCRService {
  private static instance: OCRService
  // 修复：使用注入的 LogService 类型，支持降级到 console
  private logger: LogService | typeof fallbackLogger
  private config: {
    enabled: boolean
    source: 'aistudio' | 'qianfan' | 'local'
    aiStudioToken: string
    serverUrl: string  // 用户可能自定义 URL
    model: string
    timeout: number
  }
  private isRecognizing: boolean = false
  private cancelFlag: boolean = false

  private constructor(logger?: LogService) {
    // 修复：优先使用注入的 LogService，降级到 console
    this.logger = logger || fallbackLogger
    this.config = {
      enabled: false,
      source: 'aistudio',
      aiStudioToken: '',
      serverUrl: AISTUDIO_API.BASE_URL,
      model: AISTUDIO_API.DEFAULT_MODEL,
      timeout: 300000,  // 5分钟超时（异步任务）
    }
  }

  static getInstance(logger?: LogService): OCRService {
    if (!OCRService.instance) {
      OCRService.instance = new OCRService(logger)
    } else if (logger) {
      // 修复：如果已有实例但传入了新的 logger，更新它
      OCRService.instance.logger = logger
    }
    return OCRService.instance
  }

  /**
   * 配置 OCR 服务
   */
  configure(config: {
    enabled?: boolean
    source?: 'aistudio' | 'qianfan' | 'local'
    aiStudioToken?: string
    serverUrl?: string
    model?: string
    timeout?: number
  }): void {
    if (config.enabled !== undefined) this.config.enabled = config.enabled
    if (config.source !== undefined) this.config.source = config.source
    if (config.aiStudioToken !== undefined) this.config.aiStudioToken = config.aiStudioToken
    if (config.serverUrl !== undefined) this.config.serverUrl = config.serverUrl || AISTUDIO_API.BASE_URL
    if (config.model !== undefined) this.config.model = config.model || AISTUDIO_API.DEFAULT_MODEL
    if (config.timeout !== undefined) this.config.timeout = config.timeout

    this.logger.info('OCR 服务配置已更新', {
      enabled: this.config.enabled,
      source: this.config.source,
      hasToken: !!this.config.aiStudioToken,
      serverUrl: this.config.serverUrl,
      model: this.config.model,
    })
  }

  /**
   * 检查是否已配置
   */
  isConfigured(): boolean {
    if (!this.config.enabled) {
      return false
    }
    // AI Studio 需要 Token；本地 PaddleOCR 不需要
    if (this.config.source === 'aistudio' && !this.config.aiStudioToken) {
      return false
    }
    return true
  }

  private handleMissingConfig(): OCRResult {
    if (!this.config.enabled) {
      return { text: '', isBlank: false, error: 'PaddleOCR 服务未启用，请在设置中启用。' }
    }
    if (this.config.source === 'aistudio' && !this.config.aiStudioToken) {
      return { text: '', isBlank: false, error: 'PaddleOCR Token 未配置，请在设置中填写 Access Token。' }
    }
    return { text: '', isBlank: false, error: 'PaddleOCR 服务未配置' }
  }

  /**
   * 取消当前识别
   */
  cancel(): void {
    this.cancelFlag = true
  }

  /**
   * 识别图片（主入口）
   * AI Studio API 是异步的：提交任务 → 轮询结果
   */
  async recognize(imageBase64: string): Promise<OCRResult> {
    if (!isString(imageBase64) || !imageBase64) {
      return { text: '', isBlank: false, error: 'Invalid image data' }
    }

    if (!this.isConfigured()) {
      return this.handleMissingConfig()
    }

    this.isRecognizing = true
    this.cancelFlag = false

    try {
      this.logger.info('=== PaddleOCR 识别开始 ===')
      this.logger.info('配置检查:', {
        enabled: this.config.enabled,
        source: this.config.source,
        serverUrl: this.config.serverUrl,
        model: this.config.model,
        hasToken: !!this.config.aiStudioToken,
      })

      // 提交 OCR 任务
      const jobId = await this.submitJob(imageBase64)
      if (!jobId) {
        return { text: '', isBlank: false, error: '提交 OCR 任务失败，请查看运行日志获取详细错误（设置 → 高级 → 打开运行日志）' }
      }

      // 轮询等待结果
      const result = await this.pollForResult(jobId)
      return result
    } catch (error: any) {
      this.logger.error('OCR 识别失败', error)
      return {
        text: '',
        isBlank: false,
        error: error.message || 'OCR 识别失败',
      }
    } finally {
      this.isRecognizing = false
    }
  }

  /**
   * 提交 OCR 任务到 AI Studio
   * 返回 jobId
   * 参考：https://ai.baidu.com/ai-doc/AISTUDIO/fml7mozw5
   */
  private async submitJob(imageBase64: string): Promise<string | null> {
    try {
      // 移除 base64 前缀
      const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '')

      // 构建请求 URL（根据用户输入的 serverUrl 或默认 URL）
      let submitUrl = this.config.serverUrl
      if (!submitUrl.endsWith('/api/v2/ocr/jobs')) {
        submitUrl = `${submitUrl.replace(/\/$/, '')}/api/v2/ocr/jobs`
      }

      // 构建请求头（根据 Python 示例）
      const headers: Record<string, string> = {
        'Authorization': `bearer ${this.config.aiStudioToken}`,
      }

      // 构建请求体（根据 Python 示例）
      // 方式：通过 multipart/form-data 上传文件
      const imageBuffer = Buffer.from(base64Data, 'base64')

      const formData = new FormData()
      formData.append('file', imageBuffer, 'image.png')
      formData.append('model', this.config.model)

      // optionalPayload（根据模型类型设置）
      const optionalPayload = this.getOptionalPayload()
      formData.append('optionalPayload', JSON.stringify(optionalPayload))

      this.logger.info('=== 提交 OCR 任务 ===')
      this.logger.info('URL:', { url: submitUrl })
      this.logger.info('Model:', { model: this.config.model })
      this.logger.info('Headers:', { auth: `bearer ${this.config.aiStudioToken.substring(0, 10)}...` })
      this.logger.info('OptionalPayload:', optionalPayload)

      const submitResponse = await axios.post(
        submitUrl,
        formData,
        {
          headers: {
            'Authorization': `bearer ${this.config.aiStudioToken}`,
            ...formData.getHeaders(),
          },
          timeout: 60000,  // 提交任务超时 60 秒
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
        }
      )

      this.logger.info('=== 提交响应 ===')
      this.logger.info('Status:', { status: submitResponse.status })
      this.logger.info('Response:', { data: JSON.stringify(submitResponse.data).substring(0, 1000) })

      if (submitResponse.status !== 200) {
        throw new Error(`提交任务失败: ${submitResponse.status} ${submitResponse.statusText}`)
      }

      const responseData = submitResponse.data

      // 检查错误码（根据 API 文档）
      if (responseData.code && responseData.code !== 0) {
        const errorMsg = this.getErrorMessage(responseData.code, responseData.msg)
        throw new Error(`提交任务失败 (code=${responseData.code}): ${errorMsg}`)
      }

      const jobId = responseData?.data?.jobId
      if (!jobId) {
        this.logger.error('未获取到 jobId', undefined, { data: JSON.stringify(responseData) })
        throw new Error('未获取到 jobId，请检查 Token 是否正确')
      }

      this.logger.info('任务已提交', { jobId })
      return jobId
    } catch (error: any) {
      this.logger.error('提交任务失败', error, {
        message: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
        responseData: error.response?.data ? JSON.stringify(error.response.data).substring(0, 1000) : null,
      })

      // 改进错误提示
      if (error.response?.status === 401) {
        throw new Error('Token 验证失败 (401)，请检查 Access Token 是否正确（从 https://aistudio.baidu.com/account/accessToken 获取）')
      } else if (error.response?.status === 403) {
        throw new Error('权限不足 (403)，请检查 Token 是否有 OCR 权限，或是否已超出每日配额')
      } else if (error.response?.status === 429) {
        throw new Error('请求频率过高 (429)，请稍后重试')
      } else if (error.response?.status === 400) {
        const errorMsg = error.response?.data?.msg || '请求参数错误'
        throw new Error(`请求参数错误 (400): ${errorMsg}`)
      } else if (!error.response) {
        throw new Error(`网络连接失败，请检查服务地址和网络：${error.message}`)
      }

      return null
    }
  }

  /**
   * 根据模型类型获取 optionalPayload
   * 参考官方 Python 示例
   */
  private getOptionalPayload(): Record<string, any> {
    if (this.config.model === 'PP-OCRv6') {
      return {
        useDocOrientationClassify: false,
        useDocUnwarping: false,
        useTextlineOrientation: false,
      }
    } else if (this.config.model === 'PaddleOCR-VL-1.6') {
      // 与官方示例一致
      return {
        useDocOrientationClassify: false,
        useDocUnwarping: false,
        useChartRecognition: false,
      }
    } else if (this.config.model === 'PP-StructureV3') {
      return {
        useDocOrientationClassify: false,
        useDocUnwarping: false,
      }
    } else {
      // 默认（兼容未知模型）
      return {
        useDocOrientationClassify: false,
        useDocUnwarping: false,
      }
    }
  }

  /**
   * 获取错误码对应的错误信息
   */
  private getErrorMessage(code: number, msg: string): string {
    const errorMessages: Record<number, string> = {
      10001: '空文件',
      10002: '文件 URL 无法识别',
      10003: '文件大小超出限制（最大 50MB）',
      10004: '文件格式不支持',
      10005: '文件内容无法解析',
      10006: '文件页数超过限制',
      10007: '模型参数错误',
      10008: '请求参数错误',
      10009: '同一 batchId 的任务仅允许创建 100 条',
      10010: '任务提交队列已满',
      11001: 'jobId 不存在',
      11002: 'job 已过期',
      11003: 'job 解析失败',
      12001: '已达每日页数上限',
      12002: '请求频率过高',
    }
    return errorMessages[code] || msg || '未知错误'
  }

  /**
   * 轮询任务结果
   */
  private async pollForResult(jobId: string): Promise<OCRResult> {
    const maxAttempts = 120  // 最多轮询 120 次（10分钟）
    const interval = 5000  // 每 5 秒轮询一次

    // 构建轮询 URL
    let pollUrl = this.config.serverUrl
    if (!pollUrl.endsWith('/api/v2/ocr/jobs')) {
      pollUrl = `${pollUrl.replace(/\/$/, '')}/api/v2/ocr/jobs`
    }
    pollUrl = `${pollUrl}/${jobId}`

    const headers = {
      'Authorization': `bearer ${this.config.aiStudioToken}`,
      'Content-Type': 'application/json',
    }

    this.logger.info('=== 开始轮询任务结果 ===', { jobId, pollUrl })

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (this.cancelFlag) {
        this.logger.info('用户取消 OCR 识别')
        return { text: '', isBlank: false, error: '用户取消识别' }
      }

      try {
        const resultResponse = await axios.get(pollUrl, {
          headers,
          timeout: 30000,
        })

        const responseData = resultResponse.data

        // 检查错误码
        if (responseData.code && responseData.code !== 0) {
          throw new Error(`查询任务失败 (code=${responseData.code}): ${responseData.msg || '未知错误'}`)
        }

        const jobData = responseData?.data
        if (!jobData) {
          throw new Error('响应数据格式错误，缺少 data 字段')
        }

        const state = jobData.state

        this.logger.info(`轮询 ${attempt + 1}/${maxAttempts}`, {
          state,
          progress: jobData.extractProgress ? {
            totalPages: jobData.extractProgress.totalPages,
            extractedPages: jobData.extractProgress.extractedPages,
          } : null,
        })

        if (state === 'pending') {
          this.logger.info('任务排队中...')
        } else if (state === 'running') {
          const progress = jobData.extractProgress
          if (progress) {
            this.logger.info(`任务处理中... 总页数: ${progress.totalPages}, 已处理: ${progress.extractedPages}`)
          }
        } else if (state === 'done') {
          // 任务完成，获取结果
          this.logger.info('任务完成，正在获取结果...')
          const { text, error } = await this.extractTextFromResult(jobData)
          // 修复：提取失败时向上传递 error，不再把中文占位串当作识别文本返回
          if (error) {
            return { text: '', isBlank: false, error }
          }
          return { text, isBlank: false }
        } else if (state === 'failed') {
          const errorMsg = jobData.errorMsg || '未知错误'
          this.logger.error('任务失败', undefined, { errorMsg })
          return { text: '', isBlank: false, error: `OCR 任务失败：${errorMsg}` }
        }

        // 等待后继续轮询
        await new Promise(resolve => setTimeout(resolve, interval))
      } catch (error: any) {
        this.logger.error('轮询失败', error)
        if (attempt === maxAttempts - 1) {
          return { text: '', isBlank: false, error: `轮询超时，任务可能仍在处理中，请稍后查看：jobId=${jobId}` }
        }
        // 继续轮询
        await new Promise(resolve => setTimeout(resolve, interval))
      }
    }

    return { text: '', isBlank: false, error: `轮询超时（${maxAttempts} 次），任务可能仍在处理中` }
  }

  /**
   * 从任务结果中提取文本
   * AI Studio 返回的是 JSONL URL，需要下载后解析
   * 根据模型类型，结果字段不同：
   * - PP-OCRv6: ocrResults
   * - PaddleOCR-VL-1.6 / PP-StructureV3: layoutParsingResults
   */
  private async extractTextFromResult(jobData: any): Promise<{ text: string; error?: string }> {
    try {
      const resultUrl = jobData?.resultUrl?.jsonUrl
      if (!resultUrl) {
        this.logger.warn('任务完成但未找到结果 URL')
        return { text: '', error: 'OCR 任务完成，但未返回结果文件地址' }
      }

      this.logger.info('下载 OCR 结果', { url: resultUrl })

      // 下载 JSONL 结果
      // 关键修复：强制 responseType: 'text' 并禁用自动 JSON 解析
      // 否则当服务器返回 Content-Type: application/json 时，axios 会自动
      // 把 JSONL 解析为对象，导致后续 .trim().split('\n') 抛出异常
      const resultResponse = await axios.get(resultUrl, {
        timeout: 60000,
        responseType: 'text',
        transformResponse: [(data: string) => data], // 禁止 axios 自动解析
      })

      const jsonlText = resultResponse.data
      if (!jsonlText || typeof jsonlText !== 'string') {
        this.logger.warn('OCR 结果为空或非文本', { type: typeof jsonlText })
        return { text: '', error: 'OCR 结果为空或格式异常，无法解析' }
      }

      this.logger.info('OCR 原始结果长度', { length: jsonlText.length })
      this.logger.debug('OCR 结果前500字符', { preview: jsonlText.substring(0, 500) })

      // 解析 JSONL（每行一个 JSON）
      const lines = jsonlText.trim().split('\n')
      let fullText = ''

      this.logger.info('JSONL 行数', { lines: lines.length })

      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const parsed = JSON.parse(line)

          // 兼容：结果可能在顶层，也可能在 result 字段内
          const result = parsed.result || parsed

          // 通用提取：优先尝试 layoutParsingResults，其次 ocrResults
          if (result.layoutParsingResults) {
            // PaddleOCR-VL-1.6 / PP-StructureV3
            for (const res of result.layoutParsingResults) {
              if (res.markdown?.text) {
                fullText += res.markdown.text + '\n\n'
              }
            }
          } else if (result.ocrResults) {
            // PP-OCRv6
            for (const ocrResult of result.ocrResults) {
              if (ocrResult.text) {
                fullText += ocrResult.text + '\n'
              } else if (ocrResult.recText) {
                // 部分 API 版本用 recText
                fullText += ocrResult.recText + '\n'
              }
            }
          } else {
            // 兜底：尝试直接提取 text 字段
            if (result.text) {
              fullText += result.text + '\n'
            }
          }
        } catch (e) {
          this.logger.warn('解析结果行失败', { error: String(e), line: line.substring(0, 200) })
        }
      }

      this.logger.info('OCR 文本提取完成', { length: fullText.length })
      
      // 修复：此前返回中文占位串，会被上层当成"学生作答"送进 AI 评分。
      // 这里改为返回 error，由调用方跳过本份（不计分、不提交）。
      if (!fullText.trim()) {
        this.logger.warn('OCR 未提取到任何文本')
        return { text: '', error: 'OCR 未识别出任何文字，请检查截图区域是否正确' }
      }
      
      return { text: fullText }
    } catch (error: any) {
      this.logger.error('提取文本失败', error)
      return { text: '', error: `OCR 结果提取失败：${error?.message || '未知错误'}` }
    }
  }
}

// 导出单例获取函数（保持向后兼容）
// 修复：实际使用传入的 logger 参数
export function getOCRService(logger?: any, configService?: any): OCRService {
  const instance = OCRService.getInstance(logger)
  return instance
}
