/**
 * 批改会话语义回归测试（2026-09-17，皮老板第二轮反馈）
 *
 * 反馈原话：
 *   「试改模式只会改一份，再改完一份后会自动停止，所以会让系统判定为中断错误；
 *     还有批改记录要实时保存，我刚刚进行试改，发现试改的卷子分数和答案并没有被保存」
 *
 * 根因（代码级）：
 *   - 主循环 `while (true)` 唯一的正常出口是 `!runningRef.current`，其余全靠抛异常结束；
 *     一旦某一份在处理中抛出任何意外异常，异常冒泡到外层 catch → toast「批改中断」→
 *     finally 里 runningRef=false → **整场会话在第 1 份之后死掉**，表现就是"改完一份自动停止"。
 *   - 批改记录只在「平台确认提交成功」这一条路径上写。提交未被确认（坐标点空 / 平台没回应）
 *     时分数与作答原文直接丢弃，「记录」页里既没分数也没答案。
 *
 * 本文件把修复后的三条语义钉死：
 *   1. 单份隔离：某一份抛错 → 只影响这一份，会话继续；
 *   2. 实时保存：平台未确认提交也要以 status=pending 落库，保留分数 + 作答原文；
 *   3. 结束语义：教师主动停止 = 预期结束（不报「批改中断」），且会释放等待确认的 Promise。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { installFakeLocalStorage, type FakeLocalStorageHandle } from './fakeQuotaStorage'

const toastError = vi.fn()
vi.mock('react-hot-toast', () => ({
  default: {
    error: (...args: unknown[]) => toastError(...args),
    success: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  },
}))

vi.mock('@/hooks/useSound', () => ({
  useSound: () => ({ playSuccess: vi.fn(), playError: vi.fn(), playClick: vi.fn() }),
}))

vi.mock('@/services/playwrightProxy', () => ({
  gradingBotProxy: {
    setGradingStandard: vi.fn(),
    captureByCoordinate: vi.fn(),
    clickAt: vi.fn(),
    typeAt: vi.fn(),
    recognizeText: vi.fn(),
    gradeWithAI: vi.fn(),
    gradeWithImage: vi.fn(),
  },
}))

vi.mock('@/components/grading/GradingLogs', () => ({ default: () => null }))
vi.mock('@/components/grading/AiAnalysisPanel', () => ({ default: () => null }))
vi.mock('@/pages/CoordinateGradingPage.scss', () => ({}))

import CoordinateGradingPage from '@/pages/CoordinateGradingPage'
import { gradingBotProxy } from '@/services/playwrightProxy'
import { useGradingStore } from '@/store/gradingStore'
import { useStandardsStore } from '@/store/standardsStore'
import { useRecordsStore } from '@/store/recordsStore'
import type { GradingStandard } from '@/types'

const bot = gradingBotProxy as unknown as Record<string, ReturnType<typeof vi.fn>>

const IMG = 'data:image/png;base64,' + 'A'.repeat(1024)

/** 默认坐标配置：scoreInput=(900,300) / submitButton=(900,400)（见页面 DEFAULT 配置） */
const SCORE_INPUT_Y = 300
const SUBMIT_BUTTON_Y = 400

const standard: GradingStandard = {
  id: 'std-1',
  name: '标准',
  totalScore: 10,
  scoringRules: '按要点给分',
  referenceAnswer: '参考答案',
  examples: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}

const flush = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const logs = () => useGradingStore.getState().logs.map((entry) => entry.message)
const interrupted = () => logs().filter((message) => message.includes('批改中断'))
const interruptedToasts = () =>
  toastError.mock.calls.filter((args) => String(args[0] ?? '').includes('批改中断'))

let storage: FakeLocalStorageHandle | null = null
let addRecordCalls: Record<string, unknown>[] = []

/**
 * 原始 addRecord 只在模块加载时取一次。
 *
 * 为什么不能每次 beforeEach 都包一层：`useRecordsStore.setState({ addRecord })`
 * 会覆盖当前实现，若每次都环绕"当前实现"，包装器会**层层叠加**（第 N 个测试
 * 一次真实调用被重复记录 N 次），断言数量就完全不可信了。
 */
const pristineAddRecord = useRecordsStore.getState().addRecord

beforeEach(() => {
  vi.clearAllMocks()
  addRecordCalls = []

  bot.captureByCoordinate.mockResolvedValue(IMG)
  bot.gradeWithImage.mockResolvedValue({
    ok: true,
    result: { score: 7, comment: '不错', reasoning: '依据细则' },
  })
  bot.gradeWithAI.mockResolvedValue({ score: 6, comment: 'OCR 评分', reasoning: '按要点给分' })
  bot.recognizeText.mockResolvedValue({ text: 'OCR 作答原文', isBlank: false })
  bot.clickAt.mockResolvedValue(true)
  bot.typeAt.mockResolvedValue(true)

  // 无人值守：跳过倒计时与教师确认，直接走到"提交 + 保存记录"
  useGradingStore.setState({
    isRunning: false,
    isPaused: false,
    waitingConfirm: false,
    showCorrection: false,
    browserLaunched: true,
    gradingMode: 'unattended',
    stats: { total: 0, completed: 0, blank: 0, failed: 0, currentScore: 0 },
    logs: [],
  })
  useStandardsStore.setState({ standards: [standard], currentStandardId: standard.id })
  useRecordsStore.setState({ records: [] })

  useRecordsStore.setState({
    addRecord: (record) => {
      addRecordCalls.push(record as unknown as Record<string, unknown>)
      return pristineAddRecord(record)
    },
  })
})

afterEach(async () => {
  cleanup()
  // 循环是脱离组件生命周期的长驻异步循环：先把 store 里的运行标记关掉，
  // 再等它走完收尾，避免上一场的循环"漏"到下一个用例里（双循环会污染断言）。
  useGradingStore.setState({ isRunning: false, isPaused: false, waitingConfirm: false })
  await flush(400)
  storage?.restore()
  storage = null
  useRecordsStore.setState({ records: [], addRecord: pristineAddRecord })
})

function startGrading() {
  render(<CoordinateGradingPage />)
  const startButton = screen.getByRole('button', { name: /开始批改/ })
  expect(startButton).not.toBeDisabled()
  fireEvent.click(startButton)
}

describe('单份隔离：一份出问题不再拖垮整场会话', () => {
  it('某一份 typeAt 抛错 → 会话继续处理下一份，只记一条可诊断日志，不报「批改中断」', async () => {
    storage = installFakeLocalStorage()
    // 第一份的"输入分数"抛错（旧实现：这里会把整个 while 循环带走）
    bot.typeAt.mockRejectedValueOnce(new Error('IPC 通道已断开'))

    startGrading()
    await flush(9000)

    // 关键：会话还在跑，后面几份照常完成
    expect(
      addRecordCalls.length,
      `实际保存了 ${addRecordCalls.length} 份，日志: ${JSON.stringify(logs())}`
    ).toBeGreaterThanOrEqual(2)

    // 异常被隔离成一条带原始错误的日志
    expect(
      logs().some((m) => m.includes('本份处理异常') && m.includes('IPC 通道已断开'))
    ).toBe(true)

    // 绝不能出现"批改中断"
    expect(interrupted()).toEqual([])
    expect(interruptedToasts()).toEqual([])
  }, 40000)
})

describe('实时保存：平台没确认提交，数据也不许丢', () => {
  it('提交未被平台确认 → 以 status=pending 落库，分数 + 作答原文都保留', async () => {
    storage = installFakeLocalStorage()
    bot.gradeWithImage.mockResolvedValue({
      ok: true,
      result: { score: 7, comment: '不错', reasoning: '依据细则', transcript: '学生作答原文' },
    })
    // 只有"提交按钮"那一次点击没被平台确认；点分数输入框仍然成功
    bot.clickAt.mockImplementation((_x: number, y: number) =>
      Promise.resolve(y === SUBMIT_BUTTON_Y ? { error: '目标坐标不在可视区域内' } : true)
    )

    startGrading()
    await flush(5200)

    const pending = addRecordCalls.filter((record) => record.status === 'pending')
    expect(
      pending.length,
      `实际记录: ${JSON.stringify(addRecordCalls)}，日志: ${JSON.stringify(logs())}`
    ).toBe(1)
    const record = pending[0]
    expect(record.score).toBe(7)
    expect(record.ocrText).toBe('学生作答原文')
    expect(record.maxScore).toBe(10)
    expect(record.reasoning).toBe('依据细则')

    // 没落库的份绝不能记成"已完成"
    expect(addRecordCalls.some((record) => record.status === 'completed')).toBe(false)

    // 也未写入输入框的那条路径同样不能报"批改中断"
    expect(interrupted()).toEqual([])
    expect(interruptedToasts()).toEqual([])
  }, 40000)

  it('作答原文只取本份：图像直评无 transcript 时如实留空，不会串上一份的答案', async () => {
    storage = installFakeLocalStorage()
    // 第一份走 OCR 兜底（带识别文本），之后走图像直评且不返回 transcript
    bot.gradeWithImage.mockResolvedValueOnce({ ok: false, reason: '视觉模型不可用' })
    bot.recognizeText.mockResolvedValue({ text: '第一份的作答原文', isBlank: false })

    startGrading()
    await flush(9000)

    expect(addRecordCalls.length).toBeGreaterThanOrEqual(2)
    const [first, second] = addRecordCalls
    expect(first.ocrText).toBe('第一份的作答原文')
    // 第二份没有 transcript 也没有 OCR 文本 → 必须为空，不能是"第一份的作答原文"
    expect(second.ocrText).toBe('')
    expect(logs().some((m) => m.includes('本份未取得作答原文'))).toBe(true)
  }, 40000)
})

describe('结束语义：教师主动停止是预期结束，不是"中断"', () => {
  it('试改模式：确认提交一份后点「停止」→ 不报「批改中断」，记录已保存，状态收干净', async () => {
    storage = installFakeLocalStorage()
    bot.gradeWithImage.mockResolvedValue({
      ok: true,
      result: { score: 8, comment: '良好', reasoning: '依据细则', transcript: '试改作答原文' },
    })
    useGradingStore.setState({ gradingMode: 'trial' })

    startGrading()

    // 试改模式每份都要教师确认
    const confirmButton = await screen.findByRole('button', { name: /确认提交/ }, { timeout: 10000 })
    fireEvent.click(confirmButton)
    await flush(3200)

    // 改完一份后点停止（皮老板的实际操作）
    fireEvent.click(screen.getByRole('button', { name: /停止/ }))
    await flush(1800)

    // 1) 预期结束，不能出现"批改中断"
    expect(interrupted()).toEqual([])
    expect(interruptedToasts()).toEqual([])
    expect(logs().some((m) => m.includes('批改会话结束'))).toBe(true)

    // 2) 记录实时保存：分数与答案都在
    expect(addRecordCalls.length).toBeGreaterThanOrEqual(1)
    expect(addRecordCalls[0].score).toBe(8)
    expect(addRecordCalls[0].ocrText).toBe('试改作答原文')
    expect(addRecordCalls[0].status).toBe('completed')

    // 3) 停止必须释放等待确认的 Promise：不能卡在"正在批改"
    expect(useGradingStore.getState().isRunning).toBe(false)
    expect(useGradingStore.getState().waitingConfirm).toBe(false)
  }, 40000)

  it('停止后可以重新开始：不会残留悬挂循环（旧循环不再抢跑）', async () => {
    storage = installFakeLocalStorage()
    startGrading()
    await flush(3500)

    fireEvent.click(screen.getByRole('button', { name: /停止/ }))
    await flush(1500)
    const capturesAfterStop = bot.captureByCoordinate.mock.calls.length

    // 停稳之后不应再有新的截图（悬挂循环会导致"点了停止还在继续跑"）
    await flush(3000)
    expect(bot.captureByCoordinate.mock.calls.length).toBe(capturesAfterStop)

    // 状态收干净后可以再次开始
    const startButton = screen.getByRole('button', { name: /开始批改/ })
    expect(startButton).not.toBeDisabled()
    fireEvent.click(startButton)
    await flush(1500)
    expect(bot.captureByCoordinate.mock.calls.length).toBeGreaterThan(capturesAfterStop)
    fireEvent.click(screen.getByRole('button', { name: /停止/ }))
    await flush(500)
  }, 40000)
})
