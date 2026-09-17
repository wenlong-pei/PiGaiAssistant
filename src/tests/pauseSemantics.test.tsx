/**
 * 渲染层暂停/取消/停止语义回归测试（EXE-P* → 修复后版本）
 *
 * 背景：QA 报告（2026-09-12）以 EXE-P1/P2/P4 复现了三处缺陷：
 *   - 暂停无法中断已发出的 AI 调用，评分完成后分数仍被提交；
 *   - 普通模式取消倒计时 = 静默跳过当前份并继续下一份；
 *   - 提交失败静默：日志仍记"已提交"且 completed 仍 +1。
 * 本文件在修复后改为断言**期望行为**，作为回归守卫。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useGradingExecution } from '@/hooks/useGradingExecution'
import { useGradingStore } from '@/store/gradingStore'
import { gradingBotProxy } from '@/services/playwrightProxy'

vi.mock('@/services/playwrightProxy', () => ({
  gradingBotProxy: {
    setGradingStandard: vi.fn(),
    start: vi.fn(),
    captureAnswer: vi.fn(),
    gradeWithImage: vi.fn(),
    recognizeText: vi.fn(),
    submitScore: vi.fn(),
    nextPaper: vi.fn(),
    stop: vi.fn(),
  },
}))

vi.mock('@/hooks/useSound', () => ({
  useSound: () => ({ playSuccess: vi.fn(), playError: vi.fn(), playClick: vi.fn() }),
}))

const bot = gradingBotProxy as any

function defer() {
  let resolve!: (v: any) => void
  let reject!: (e: any) => void
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

const standard = { totalScore: 10, name: '标准' }
const IMG = 'data:image/png;base64,iVBORw0KGgo='
const flush = (ms: number) => new Promise((r) => setTimeout(r, ms))
const logs = () => useGradingStore.getState().logs.map((l) => l.message)

beforeEach(() => {
  vi.clearAllMocks()
  useGradingStore.setState({
    isRunning: false, isPaused: false, waitingConfirm: false, showCorrection: false,
    stats: { total: 0, completed: 0, blank: 0, failed: 0, currentScore: 0 },
    logs: [],
  })
  bot.captureAnswer.mockReset().mockResolvedValue(IMG)
  bot.gradeWithImage.mockReset().mockResolvedValue({ ok: true, result: { score: 7, comment: '不错' } })
  // 修复后的 proxy 会返回 boolean：true = 提交已确认
  bot.submitScore.mockReset().mockResolvedValue(true)
  // 切换结果为三态：'last' 表示确实没有更多试卷（修复 BUG-EXE-006 后不再用 boolean）
  bot.nextPaper.mockReset().mockResolvedValue('last')
})

describe('EXE-P 暂停/取消/停止语义（修复后回归）', () => {
  it('EXE-P1-R 暂停后，已发出 AI 调用的结果被丢弃、分数不再提交', async () => {
    const gradeDefer = defer()
    bot.gradeWithImage.mockReturnValueOnce(gradeDefer.promise)

    const { result } = renderHook(() => useGradingExecution())
    const execPromise = result.current.executeGrading(standard, 'unattended', true, async () => true, () => {}, async (s: number) => s)
    await flush(150) // capture 完成，gradeWithImage 挂起

    result.current.handlePause()
    expect(useGradingStore.getState().isPaused).toBe(true)

    // AI 调用此时返回：修复后应命中"提交前最后可取消点"，丢弃结果
    gradeDefer.resolve({ ok: true, result: { score: 7, comment: '不错' } })
    await flush(1500)

    expect(bot.submitScore).not.toHaveBeenCalled()
    expect(logs().some((m) => m.includes('已暂停，当前份结果未提交'))).toBe(true)

    // 收尾：恢复后让循环自然结束
    bot.captureAnswer.mockResolvedValue(null)
    result.current.handlePause() // 解除暂停
    await flush(2400)
    await execPromise
  }, 30000)

  it('EXE-P2-R 普通模式取消倒计时 = 暂停且不跳过当前份', async () => {
    bot.captureAnswer.mockResolvedValue(IMG)

    const { result } = renderHook(() => useGradingExecution())
    const execPromise = result.current.executeGrading(standard, 'normal', true, async () => false, () => {}, async (s: number) => s)
    await flush(600) // 第一轮：capture → 评分 → 倒计时被取消 → 暂停

    expect(bot.submitScore).not.toHaveBeenCalled()
    // 修复后：取消倒计时不会再去截下一份
    expect(bot.captureAnswer.mock.calls.length).toBe(1)
    expect(useGradingStore.getState().isPaused).toBe(true)
    expect(logs().some((m) => m.includes('已取消自动提交'))).toBe(true)

    // 收尾
    result.current.handleStop(() => {})
    await flush(600)
    await execPromise
  }, 30000)

  it('EXE-P3-R 停止后不再提交（提交前拦截）', async () => {
    const gradeDefer = defer()
    bot.gradeWithImage.mockReturnValueOnce(gradeDefer.promise)

    const { result } = renderHook(() => useGradingExecution())
    const execPromise = result.current.executeGrading(standard, 'unattended', true, async () => true, () => {}, async (s: number) => s)
    await flush(150) // grade 挂起

    result.current.handleStop(() => {})
    gradeDefer.resolve({ ok: true, result: { score: 7, comment: '不错' } })
    await flush(1500)
    await execPromise

    expect(bot.submitScore).not.toHaveBeenCalled()
    expect(logs().some((m) => m.includes('已停止批改'))).toBe(true)
  }, 30000)

  it('EXE-P4-R 提交失败不再静默：不计完成、明确告警并暂停', async () => {
    bot.submitScore.mockResolvedValue(false) // 主进程确认提交失败

    const { result } = renderHook(() => useGradingExecution())
    const execPromise = result.current.executeGrading(standard, 'unattended', true, async () => true, () => {}, async (s: number) => s)
    await flush(2000)

    expect(logs().some((m) => m.includes('提交失败'))).toBe(true)
    expect(logs().some((m) => m.includes('已提交 7分'))).toBe(false)
    expect(useGradingStore.getState().stats.completed).toBe(0)
    expect(useGradingStore.getState().stats.failed).toBeGreaterThanOrEqual(1)

    // 收尾
    result.current.handleStop(() => {})
    await flush(600)
    await execPromise
  }, 30000)

  it('EXE-P5-R 试改模式等待确认期间不提交，确认后才提交（保持正确路径）', async () => {
    const confirmDefer = defer()
    const { result } = renderHook(() => useGradingExecution())
    const execPromise = result.current.executeGrading(standard, 'trial', true, async () => true, () => {}, () => confirmDefer.promise as Promise<number>)
    await flush(300)

    expect(useGradingStore.getState().waitingConfirm).toBe(true)
    expect(bot.submitScore).not.toHaveBeenCalled()

    confirmDefer.resolve(7)
    await flush(800)
    expect(bot.submitScore).toHaveBeenCalledWith(7)

    await execPromise
  }, 30000)
  it('EXE-NEW-R1 普通模式遇到 needsHumanReview：不自动提交，进入教师确认，确认后才提交', async () => {
    // 模拟主进程修复后行为：AI 分数无法解析 → needsHumanReview + score 0
    bot.gradeWithImage.mockResolvedValue({
      ok: true,
      result: { score: 0, comment: 'AI 返回的分数无法解析为数字，请人工复核', needsHumanReview: true, errorTags: ['AI返回解析失败'] },
    })

    const confirmDefer = defer()
    const { result } = renderHook(() => useGradingExecution())
    const execPromise = result.current.executeGrading(standard, 'normal', true, async () => true, () => {}, () => confirmDefer.promise as Promise<number>)
    await flush(800)

    // 修复验证：普通模式也不自动提交，进入教师确认
    expect(bot.submitScore).not.toHaveBeenCalled()
    expect(useGradingStore.getState().waitingConfirm).toBe(true)
    expect(logs().some((m) => m.includes('暂停自动提交'))).toBe(true)

    // 教师确认分数后才提交
    confirmDefer.resolve(3)
    await flush(800)
    expect(bot.submitScore).toHaveBeenCalledWith(3)

    // 收尾
    result.current.handleStop(() => {})
    await flush(600)
    await execPromise
  }, 30000)
})
