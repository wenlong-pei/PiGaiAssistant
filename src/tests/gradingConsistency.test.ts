import { describe, it, expect } from 'vitest'
import {
  extractStructuredGrade,
  clampScore,
  evaluateConsistency,
  type LabeledSample,
} from '../utils/gradingConsistency'

describe('extractStructuredGrade', () => {
  it('解析干净的 JSON', () => {
    const json = JSON.stringify({
      score: 8,
      comment: '步骤正确',
      errorTags: ['计算错误'],
      rubricBreakdown: [{ id: 'r1', awarded: 3 }],
    })
    const r = extractStructuredGrade(json)
    expect(r.score).toBe(8)
    expect(r.comment).toBe('步骤正确')
    expect(r.errorTags).toEqual(['计算错误'])
    expect(r.rubricBreakdown?.[0]).toEqual({ id: 'r1', awarded: 3 })
  })

  it('容错：模型在 JSON 外夹带说明文字', () => {
    const messy = '好的，这是评分结果：\n{"score": 6, "comment": "部分正确"}\n如有疑问请复核。'
    const r = extractStructuredGrade(messy)
    expect(r.score).toBe(6)
    expect(r.comment).toBe('部分正确')
  })

  it('兼容中文键名', () => {
    const cn = '{"得分": 9, "评语": "优秀", "错因标签": ["书写潦草"]}'
    const r = extractStructuredGrade(cn)
    expect(r.score).toBe(9)
    expect(r.comment).toBe('优秀')
    expect(r.errorTags).toEqual(['书写潦草'])
  })

  it('无法解析时返回空对象而不抛错', () => {
    const r = extractStructuredGrade('模型跑题了，没有返回 JSON')
    expect(r.score).toBeUndefined()
    expect(r.comment).toBeUndefined()
  })

  // 置信度机制已完全移除：模型即使返回该字段也不再解析
  it('返回内容中的置信度字段被忽略（机制已移除）', () => {
    const r = extractStructuredGrade('{"score": 5, "confidence": 0.9, "reasoning": "依据"}')
    expect(r.score).toBe(5)
    expect('confidence' in r).toBe(false)
  })
})

describe('clampScore', () => {
  it('约束到 [0, maxScore] 并四舍五入', () => {
    expect(clampScore(12, 10)).toBe(10)
    expect(clampScore(-3, 10)).toBe(0)
    expect(clampScore(7.4, 10)).toBe(7)
    expect(clampScore(NaN, 10)).toBe(0)
  })
})

describe('evaluateConsistency', () => {
  const samples: LabeledSample[] = [
    { id: 's1', expectedScore: 8, parsedScore: 8 },
    { id: 's2', expectedScore: 5, parsedScore: 5 },
    { id: 's3', expectedScore: 10, parsedScore: 7 },
    { id: 's4', expectedScore: 3, parsedScore: 4 },
  ]

  it('完全一致率（tolerance=0）', () => {
    const report = evaluateConsistency(samples, 0)
    expect(report.total).toBe(4)
    expect(report.exactMatch).toBe(2)
    expect(report.exactRate).toBeCloseTo(0.5)
  })

  it('容差内一致率（tolerance=1）', () => {
    const report = evaluateConsistency(samples, 1)
    // s4 diff=1 在容差内；s3 diff=3 不在
    expect(report.withinTolerance).toBe(3)
    expect(report.toleranceRate).toBeCloseTo(0.75)
  })

  it('空样本不报错', () => {
    const report = evaluateConsistency([])
    expect(report.total).toBe(0)
    expect(report.exactRate).toBe(0)
  })
})
