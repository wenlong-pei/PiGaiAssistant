import { describe, it, expect, vi } from 'vitest'

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
  svc.settings = { providers: [], activeProviderId: '', temperature: 0, maxTokens: 4000 }
  return svc
}

const standard: any = { totalScore: 20, name: '测试题' }

function resp(message: any) {
  return { data: { choices: [{ message }] } }
}

describe('评分解析健壮性（思考模式耗尽 max_tokens 场景）', () => {
  it('正文为空时判定为解析失败转人工，不静默本地给分', () => {
    const svc = makeService()
    // DeepSeek 思考模式：思维链在 reasoning_content，content 被 max_tokens 耗尽
    const r = svc.parseGradingResult(
      resp({ content: '', reasoning_content: '让我先分析这道题……' }),
      standard,
      '学生作答内容'
    )

    expect(r.score).toBe(0)
    expect(r.needsHumanReview).toBe(true)
    expect(r.errorTags).toContain('AI返回解析失败')
    expect(r.reasoning).toContain('思维链')
    // 关键：不能出现"有分数但没依据"的情况
    expect(r.reasoning && r.reasoning.length).toBeGreaterThan(10)
  })

  it('正文为空且无思维链时给出明确原因', () => {
    const svc = makeService()
    const r = svc.parseGradingResult(resp({ content: '   ' }), standard, '')
    expect(r.needsHumanReview).toBe(true)
    expect(r.reasoning).toContain('返回内容为空')
  })

  it('正常返回时解析出分数、评语与评分依据', () => {
    const svc = makeService()
    const r = svc.parseGradingResult(
      resp({
        content: JSON.stringify({
          score: 14,
          comment: '要点基本齐全',
          reasoning: '按规则：观点明确给 8 分，举例说明给 6 分，未涉及制度层面不扣分。',
          rubricBreakdown: [{ id: 'r-a', awarded: 8 }, { id: 'r-b', awarded: 6 }],
        }),
      }),
      standard,
      '作答'
    )

    expect(r.score).toBe(14)
    expect(r.comment).toBe('要点基本齐全')
    expect(r.reasoning).toContain('观点明确给 8 分')
    expect(r.rubricBreakdown?.length).toBe(2)
    // 置信度机制已完全移除，结果中不再有该字段
    expect('confidence' in r).toBe(false)
  })

  it('JSON 缺少 score 字段时转人工，不冒充 AI 判分', () => {
    const svc = makeService()
    const r = svc.parseGradingResult(
      resp({ content: JSON.stringify({ comment: '写得不错' }) }),
      standard,
      '作答'
    )
    expect(r.needsHumanReview).toBe(true)
    expect(r.score).toBe(0)
    expect(r.reasoning).toContain('缺少 score')
  })

  it('模型未给依据时自动合成可读依据（保证任何分数都有依据）', () => {
    const svc = makeService()
    const r = svc.parseGradingResult(
      resp({
        content: JSON.stringify({
          score: 18,
          comment: '优秀',
          rubricBreakdown: [{ id: 'r-a', awarded: 10 }, { id: 'r-b', awarded: 8 }],
        }),
      }),
      standard,
      '作答'
    )
    expect(r.score).toBe(18)
    expect(r.reasoning).toContain('满分 20 分')
    expect(r.reasoning).toContain('r-a')
  })
})
