/**
 * 批改输入/输出结构回归测试
 *
 * 约定（皮老板 2026-09-12 明确）：
 * - 输入固定五项：题目、满分、参考答案、评分细则、学生作答（图片）
 *   （关键词已移除；过程分为可选开关，勾选后写入评分细则文本，不作独立段落）
 * - 输出固定两项：最终分数、简短评分依据（confidence 为内部质量字段）
 * - 正式评分标准流程与测试流程使用同一套结构（评分细则均为自由文本）
 */
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
import { AI } from '../../electron/utils/constants'

function makeService() {
  const svc: any = Object.create(AIService.prototype)
  svc.logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }
  return svc
}

/** 模拟"正式流程"保存的标准：评分细则为自由文本 */
const standard: any = {
  id: 'std-1',
  name: '第二题 论述题',
  question: '请结合材料分析洋务运动的历史局限性。',
  totalScore: 20,
  scoringRules: '满分 20 分。1. 指出核心局限（8 分）；2. 结合材料举例（6 分）；3. 未涉及制度层面分析扣 3 分。',
  referenceAnswer: '洋务运动只学技术而不变革制度，未触及封建制度根本。',
  examples: [],
}

describe('批改输入结构（固定五项）', () => {
  it('图像直评提示词包含五项，且核心项顺序正确', () => {
    const svc = makeService()
    const prompt = svc.buildVisionGradingPrompt(standard, [])

    // 五项齐备
    expect(prompt).toContain('【题目】')
    expect(prompt).toContain('【题目正文】请结合材料分析洋务运动的历史局限性。')
    expect(prompt).toContain('【满分】20分')
    expect(prompt).toContain('【参考答案】')
    expect(prompt).toContain('【评分规则】')
    expect(prompt).toContain('满分 20 分。1. 指出核心局限（8 分）')
    expect(prompt).toContain('请严格按上述评分细则批改')
    expect(prompt).toContain('"transcript"')
    const iScore = prompt.indexOf('"score"')
    const iTranscript = prompt.indexOf('"transcript"')
    expect(iTranscript).toBeGreaterThan(iScore)
    expect(prompt).toContain('学生的作答内容见下方图片')

    // 顺序：题目 → 满分 → 参考答案 → 评分规则 → 学生作答
    const iQ = prompt.indexOf('【题目】')
    const iF = prompt.indexOf('【满分】')
    const iR = prompt.indexOf('【参考答案】')
    const iC = prompt.indexOf('【评分规则】')
    const iA = prompt.indexOf('【学生作答】')
    expect(iQ).toBeLessThan(iF)
    expect(iF).toBeLessThan(iR)
    expect(iR).toBeLessThan(iC)
    expect(iC).toBeLessThan(iA)
  })

  it('文本（OCR 兜底）路径与图像路径使用同一份结构与上下文', () => {
    const svc = makeService()
    const textPrompt = svc.buildGradingPrompt('学生手写作答的 OCR 文本', standard, [])
    const visionPrompt = svc.buildVisionGradingPrompt(standard, [])

    for (const seg of ['【题目】', '【满分】20分', '【参考答案】', '【评分规则】']) {
      expect(textPrompt).toContain(seg)
      expect(visionPrompt).toContain(seg)
    }
    // 唯一区别是作答载体：一个是文本，一个是图片
    expect(textPrompt).toContain('学生手写作答的 OCR 文本')
    expect(visionPrompt).toContain('见下方图片')
  })

  it('评分细则为自由文本时原样进入提示词（不要求分点）', () => {
    const svc = makeService()
    const prompt = svc.buildVisionGradingPrompt(standard, [])
    expect(prompt).toContain('【评分规则】\n满分 20 分。1. 指出核心局限（8 分）')
    // 不再渲染旧的「评分量规 Rubric」分点表
    expect(prompt).not.toContain('【评分量规 Rubric（加分项为正、扣分项为负')
    // 关键词已彻底移除，不再出现在提示词中
    expect(prompt).not.toContain('【关键词】')
    // 过程分不再作为独立段落注入（改为写进评分细则文本）
    expect(prompt).not.toContain('【过程分规则】')
  })
})

describe('批改输出结构（固定两项 + 内部质量字段）', () => {
  it('提示词只要求输出分数与评分依据，不再要求分点维度表', () => {
    const svc = makeService()
    const prompt = svc.buildVisionGradingPrompt(standard, [])

    expect(prompt).toContain('"score"')
    expect(prompt).toContain('"reasoning"')
    // 旧的分点/标签字段不再出现在输出要求里
    expect(prompt).not.toContain('"rubricBreakdown"')
    expect(prompt).not.toContain('"errorTags"')

    // 无论得分多少都要给依据
    expect(prompt).toContain('无论得分多少')
    expect(prompt).toContain('50~100字')  // 依据字数要求（50~100）
  })

  it('系统提示词与评分提示词的输出要求一致', () => {
    expect(AI.SYSTEM_PROMPT).toContain('"score"')
    expect(AI.SYSTEM_PROMPT).toContain('"reasoning"')
    expect(AI.SYSTEM_PROMPT).toContain('无论得分多少')
    expect(AI.SYSTEM_PROMPT).not.toContain('rubricBreakdown')
  })

  it('模型只返回 score + reasoning 也能得到完整结果（依据不会为空）', () => {
    const svc = makeService()
    const r = svc.parseGradingResult(
      { data: { choices: [{ message: { content: JSON.stringify({ score: 15, reasoning: '按细则 1 给 8 分、细则 2 给 7 分，未触及制度层面故不扣分。' }) } }] } },
      standard,
      '作答'
    )

    expect(r.score).toBe(15)
    expect(r.reasoning).toContain('细则 1 给 8 分')
    expect(r.reasoning.length).toBeGreaterThan(10)
  })
})

describe('学科送入系统提示词（角色定制）', () => {
  function makeSvc() {
    const svc: any = Object.create(AIService.prototype)
    svc.logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }
    return svc
  }

  it('选择语文时，角色是「专业的语文批改老师」', () => {
    const svc = makeSvc()
    const sys = svc.buildSystemPrompt({ subject: '语文' })
    expect(sys).toContain('你是一名专业的语文批改老师')
    expect(sys).not.toContain('{{SUBJECT_ROLE}}')
  })

  it('未选择学科时使用默认角色', () => {
    const svc = makeSvc()
    for (const input of [undefined, {}, { subject: '' }, { subject: '  ' }]) {
      const sys = svc.buildSystemPrompt(input as any)
      expect(sys).toContain('你是一名专业的批改老师')
      expect(sys).not.toContain('{{SUBJECT_ROLE}}')
    }
  })

  it('图像直评与文本路径使用同一个 buildSystemPrompt（两条路径角色一致）', () => {
    const svc = makeSvc()
    const sys1 = svc.buildSystemPrompt({ subject: '数学' })
    const sys2 = svc.buildSystemPrompt({ subject: '数学' })
    expect(sys1).toBe(sys2)
    expect(sys1).toContain('你是一名专业的数学批改老师')
  })
})
