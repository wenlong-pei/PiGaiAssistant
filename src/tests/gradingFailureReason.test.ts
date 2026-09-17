import { describe, it, expect, beforeEach, vi } from 'vitest'
import axios from 'axios'

vi.mock('axios')

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: any) => b.toString(),
  },
  app: { getPath: () => '/tmp', isPackaged: false, whenReady: async () => {} },
}))

import { AIService } from '../../electron/services/AIService'

const logger: any = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }

function makeService() {
  const svc: any = Object.create(AIService.prototype)
  svc.logger = logger
  svc.settings = {
    providers: [
      { id: 'deepseek', name: 'DeepSeek', endpoint: 'https://api.deepseek.com/v1', model: 'deepseek-flash', visionModel: 'deepseek-flash', isActive: true },
    ],
    activeProviderId: 'deepseek',
    temperature: 0,
    maxTokens: 4000,
  }
  svc.storageService = { getApiKey: async () => 'sk-test-key' }
  return svc
}

const IMG = 'data:image/png;base64,iVBORw0KGgo='
const standard: any = { totalScore: 20, name: '测试题', scoringRules: '按细则给分' }

function apiReturns(message: any) {
  vi.mocked(axios.post).mockResolvedValue({ data: { choices: [{ message }] } } as any)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('图像直评失败原因透传（不再笼统报"非合法 JSON"）', () => {
  it('思考模式耗尽 max_tokens（正文为空）时，原因指向 max_tokens 而非 JSON 格式', async () => {
    const svc = makeService()
    apiReturns({ content: '', reasoning_content: '让我先看看这张图片上的作答……' })

    const r = await svc.gradeWithImage(IMG, standard, [])

    expect(r.ok).toBe(false)
    expect(r.reason).toContain('未返回评分内容')
    expect(r.reason).toContain('max_tokens')
    expect(r.reason).not.toContain('非合法 JSON')
  })

  it('模型返回说明性文字（非结构化）时，归因为"未返回结构化结果"', async () => {
    const svc = makeService()
    apiReturns({ content: '这张图片太模糊，我无法辨认学生的作答内容。' })

    const r = await svc.gradeWithImage(IMG, standard, [])

    expect(r.ok).toBe(false)
    expect(r.reason).toContain('未返回结构化结果')
  })

  it('JSON 缺 score 字段时，归因明确指向缺字段', async () => {
    const svc = makeService()
    apiReturns({ content: JSON.stringify({ reasoning: '看不太清' }) })

    const r = await svc.gradeWithImage(IMG, standard, [])

    expect(r.ok).toBe(false)
    expect(r.reason).toContain('缺少 score')
  })

  it('失败结果里带上模型返回片段，便于直接排查', () => {
    const svc = makeService()
    const res = svc.parseGradingResult(
      { data: { choices: [{ message: { content: '图片太模糊，无法辨认。' } }] } },
      standard,
      ''
    )
    expect(res.needsHumanReview).toBe(true)
    expect(res.reasoning).toContain('图片太模糊')
  })

  it('成功返回时不再走降级分支', async () => {
    const svc = makeService()
    apiReturns({
      content: JSON.stringify({ score: 16, reasoning: '按细则第 1 条给 8 分、第 2 条给 8 分。', confidence: 0.9 }),
    })

    const r = await svc.gradeWithImage(IMG, standard, [])

    expect(r.ok).toBe(true)
    expect(r.result?.score).toBe(16)
    expect(r.result?.reasoning).toContain('细则第 1 条')
  })
})

describe('置信度机制已完全移除', () => {
  it('模型即使返回 confidence 也不会影响判分与人工复核标记', async () => {
    const svc = makeService()
    apiReturns({
      content: JSON.stringify({ score: 15, reasoning: '按细则给分', confidence: 0.1 }),
    })

    const r = await svc.gradeWithImage(IMG, standard, [])

    // 低置信度不再触发 OCR 回退，也不影响结果
    expect(r.ok).toBe(true)
    expect(r.result?.score).toBe(15)
    expect(r.result && 'confidence' in r.result).toBe(false)
  })
})
