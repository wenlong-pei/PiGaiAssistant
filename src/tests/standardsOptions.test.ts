/**
 * 评分标准「关键词移除 + 过程分开关改造」回归测试
 *
 * 约定（皮老板 2026-09-12 决定）：
 * - 关键词彻底删除：不再出现在界面、类型与提示词中
 * - 过程分为可选项（A+B 组合）：
 *   A. 系统提示词不再无条件要求给步骤分，只由开关决定
 *   B. 勾选开关 = 把说明写入评分细则文本框（可编辑），不再作为独立段落注入 API
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

import {
  applyProcessCreditHint,
  PROCESS_CREDIT_HINT,
} from '../pages/StandardsPage'
import { AI } from '../../electron/utils/constants'

describe('过程分开关（A+B 组合）', () => {
  it('空细则 + 勾选：只写入过程分说明', () => {
    const r = applyProcessCreditHint(undefined, true)
    expect(r).toBe(PROCESS_CREDIT_HINT)
  })

  it('已有细则 + 勾选：追加到末尾，保留原内容', () => {
    const r = applyProcessCreditHint('满分 10 分。1. 要点完整（6 分）；2. 表达清楚（4 分）。', true)
    expect(r).toContain('满分 10 分。1. 要点完整（6 分）；2. 表达清楚（4 分）。')
    expect(r).toContain(PROCESS_CREDIT_HINT)
    expect(r.indexOf('满分') ).toBeLessThan(r.indexOf('步骤与过程'))
  })

  it('重复勾选不会重复追加（幂等）', () => {
    const once = applyProcessCreditHint('满分 10 分。', true)
    const twice = applyProcessCreditHint(once, true)
    expect(twice).toBe(once)
    expect(twice.split(PROCESS_CREDIT_HINT).length - 1).toBe(1)
  })

  it('取消勾选不删除已写入的说明（避免误伤用户编辑）', () => {
    const withHint = applyProcessCreditHint('满分 10 分。', true)
    const off = applyProcessCreditHint(withHint, false)
    expect(off).toBe(withHint)
  })

  it('旧的分点数组形态也能追加说明（兼容历史标准）', () => {
    const legacyRules = [
      { id: 'r1', description: '要点完整', score: 6, type: 'positive' as const },
    ]
    const r = applyProcessCreditHint(legacyRules, true)
    expect(r).toContain('- 要点完整：+6分')
    expect(r).toContain(PROCESS_CREDIT_HINT)
  })
})

describe('系统提示词不再无条件要求给步骤分', () => {
  it('SYSTEM_PROMPT 以评分细则为步骤分的唯一来源', () => {
    // 旧版硬伤：无条件条款「即使最终答案错误，推导正确的步骤也应给步骤分」导致开关失效
    expect(AI.SYSTEM_PROMPT).not.toContain('推导正确的步骤也应给步骤分')
    expect(AI.SYSTEM_PROMPT).toContain('以评分细则中的规定为准')
  })

  it('输出要求中不再包含置信度与关键词（历史回归）', () => {
    expect(AI.SYSTEM_PROMPT).not.toContain('confidence')
    expect(AI.SYSTEM_PROMPT).not.toContain('rubricBreakdown')
    expect(AI.SYSTEM_PROMPT).not.toContain('关键词')
  })
})
