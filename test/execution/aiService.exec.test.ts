/**
 * 第三轮：AIService 异常路径执行实证
 *
 * 目标缺陷：
 * - EXE-NEW-A1: parseScore 在 AI 返回 score 字段但无法解析为数字时，
 *   静默用本地评分返回分数，且不携带 errorTags / needsHumanReview 标记，
 *   与 parseGradingResult 中"AI 返回的 JSON 里没有分数字段时不再静默用本地评分冒充 AI 判分"
 *   的修复意图冲突 —— 上层会把该结果当作正常 AI 判分处理（completed++、照常提交）。
 * - EXE-NEW-A2: grade() 输入文本超长/无效时返回 { score: 0, comment: '输入文本无效' }，
 *   无 needsHumanReview 标记 —— 上层可能当正常评分结果提交 0 分。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const postMock = vi.fn()

vi.mock('axios', () => ({
  default: { post: (...args: any[]) => postMock(...args) },
}))

// AIService 的 StorageService / LogService 仅为类型引用，运行时无副作用
import { AIService } from '../../electron/services/AIService'

const fakeLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}

const fakeStorage = {
  getApiKey: vi.fn(async () => 'test-key'),
}

function createService(): AIService {
  const service = new AIService(fakeLogger as any, fakeStorage as any)
  service.updateSettings({
    providers: [
      {
        id: 'p1',
        name: 'test-provider',
        endpoint: 'https://api.example.com/v1',
        model: 'test-model',
        isActive: true,
      },
    ],
    activeProviderId: 'p1',
    temperature: 0,
    maxTokens: 1000,
  })
  return service
}

const standard = {
  id: 's1',
  name: '作文题',
  question: '请以"春天"为题写一段话',
  totalScore: 10,
  scoringRules: [] as any[],
}

describe('AIService 异常路径（第三轮）', () => {
  beforeEach(() => {
    postMock.mockReset()
  })

  it('EXE-NEW-A1a-修复后: AI 返回 score="满分"（无法解析为数字）→ 转人工复核，不再本地评分冒充', async () => {
    const service = createService()
    postMock.mockResolvedValue({
      data: {
        choices: [{ message: { content: '{"score":"满分","comment":"答得很好"}' } }],
      },
    })

    const result = await service.grade('学生写了完整的作答内容，要点齐全', standard)

    // 修复验证：无法解析的分数必须带人工复核标记且不猜分（score=0）
    expect(result.score).toBe(0)
    expect(result.needsHumanReview).toBe(true)
    expect(result.errorTags).toContain('AI返回解析失败')
    console.log('[EXE-NEW-A1a-修复后] 返回结果：', JSON.stringify(result))

    // 与"AI 未返回 score 字段"分支（应带 errorTags + needsHumanReview）形成对比：
    postMock.mockResolvedValue({
      data: {
        choices: [{ message: { content: '{"comment":"答得很好"}' } }],
      },
    })
    const noScoreResult = await service.grade('学生作答内容', standard)
    console.log('[EXE-NEW-A1a-对照] 缺 score 字段的结果：', JSON.stringify(noScoreResult))
    expect(noScoreResult.needsHumanReview).toBe(true)
    expect(noScoreResult.errorTags).toContain('AI返回解析失败')
  })

  it('EXE-NEW-A1b: AI 返回 score="满分20"（含数字）→ 解析为 20 并被 clamp 到满分 10（数字可解析按设计处理）', async () => {
    const service = createService()
    postMock.mockResolvedValue({
      data: {
        choices: [{ message: { content: '{"score":"满分20","comment":"很好"}' } }],
      },
    })

    const result = await service.grade('学生作答内容', standard)
    console.log('[EXE-NEW-A1b] 返回结果：', JSON.stringify(result))
    expect(result.score).toBe(10) // clamp 到满分，但"满分20"本意为满分
    expect(result.needsHumanReview).toBeUndefined()
  })

  it('EXE-NEW-A2-修复后: 输入文本超长 → 返回 0 分且带 needsHumanReview 人工复核标记', async () => {
    const service = createService()
    const longText = 'x'.repeat(200000)

    const result = await service.grade(longText, standard)
    console.log('[EXE-NEW-A2-修复后] 返回结果：', JSON.stringify(result))
    expect(result.score).toBe(0)
    // 修复验证：非法输入必须带人工复核标记，防止照常提交 0 分
    expect(result.needsHumanReview).toBe(true)
    expect(result.errorTags).toContain('输入无效')
  })

  it('对照组: 正常数字 score 解析链路可用（证明 mock 有效）', async () => {
    const service = createService()
    postMock.mockResolvedValue({
      data: {
        choices: [{ message: { content: '{"score":8,"comment":"好"}' } }],
      },
    })

    const result = await service.grade('正常作答', standard)
    expect(result.score).toBe(8)
    expect(result.errorTags).toBeUndefined()
  })
})
