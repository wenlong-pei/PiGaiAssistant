/**
 * 批改主循环韧性回归测试（阻断-04，用户报告的现象本身）
 *
 * 用户报告（皮老板）：
 *   试改模式点击「确认提交」后弹出
 *   「批改中断: 操作失败，请查看日志或重新尝试」，但分数其实已经正常生成。
 *
 * 根因：提交成功后保存批改记录时，整张 base64 截图把 localStorage 配额写满，
 * `setItem` 同步抛 QuotaExceededError，异常从 store.set() 冒泡到批改主循环的 catch，
 * 被渲染成"批改中断"。
 *
 * 本文件渲染**真实页面组件**、跑**真实批改循环**，把下面两件事钉死：
 *   1. 配额写满（真实 store + 真实抛错的 localStorage）→ 循环不中断、不再出现「批改中断」；
 *   2. 即使 addRecord 直接抛错（防御未来改动）→ 循环依然继续，只记一条非致命告警。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import {
  installFakeLocalStorage,
  type FakeLocalStorageHandle,
} from './fakeQuotaStorage'

const toastError = vi.fn()
vi.mock('react-hot-toast', () => ({
  default: { error: (...args: unknown[]) => toastError(...args), success: vi.fn(), loading: vi.fn(), dismiss: vi.fn() },
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

// 展示组件（另一位成员正在并行改布局）与样式在测试里隔离
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

/** 实测：800x600 答题区截图 base64 约 11 万字符 */
const IMG = 'data:image/png;base64,' + 'A'.repeat(114_000)

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

let storage: FakeLocalStorageHandle | null = null
let addRecordCalls: unknown[] = []

beforeEach(() => {
  cleanup()
  vi.clearAllMocks()
  addRecordCalls = []

  bot.captureByCoordinate.mockResolvedValue(IMG)
  bot.gradeWithImage.mockResolvedValue({
    ok: true,
    result: { score: 7, comment: '不错', reasoning: '依据细则' },
  })
  bot.clickAt.mockResolvedValue(true)
  bot.typeAt.mockResolvedValue(true)

  // 无人值守模式：跳过倒计时与教师确认，直接走到"保存批改记录"这一步
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

  // 记录真实 store 的 addRecord 调用次数（保留原实现）
  const realAddRecord = useRecordsStore.getState().addRecord
  useRecordsStore.setState({
    addRecord: (record) => {
      addRecordCalls.push(record)
      return realAddRecord(record)
    },
  })
})

afterEach(() => {
  storage?.restore()
  storage = null
  useGradingStore.setState({ isRunning: false, isPaused: false })
  useRecordsStore.setState({ records: [] })
})

function startGrading() {
  render(<CoordinateGradingPage />)
  const startButton = screen.getByRole('button', { name: /开始批改/ })
  expect(startButton).not.toBeDisabled()
  fireEvent.click(startButton)
}

describe('配额写满时的批改主循环（用户报告现象的回归守卫）', () => {
  it('配额接近写满：循环继续跑完整的两份，不再出现「批改中断」', async () => {
    // 模拟"历史记录已把 localStorage 撑到接近上限"：大于 5 万字符的写入必失败
    storage = installFakeLocalStorage({ maxValueChars: 50_000 })

    startGrading()
    await flush(5200)

    // 循环没有被中断：至少处理完两份
    expect(addRecordCalls.length, `实际保存了 ${addRecordCalls.length} 份`).toBeGreaterThanOrEqual(2)
    expect(bot.captureByCoordinate.mock.calls.length).toBeGreaterThanOrEqual(2)

    // 用户看到的那句错误必须彻底消失
    expect(interrupted()).toEqual([])
    const interruptedToasts = toastError.mock.calls.filter((args) =>
      String(args[0] ?? '').includes('批改中断')
    )
    expect(interruptedToasts).toEqual([])

    // 降级必须是"可见"的，而不是静默丢数据
    expect(logs().some((message) => message.includes('降级'))).toBe(true)
  }, 30000)

  it('addRecord 直接抛 QuotaExceededError：循环不中断，只记一条非致命告警', async () => {
    storage = installFakeLocalStorage()
    const quotaError = new DOMException(
      "Failed to execute 'setItem' on 'Storage': Setting the value of 'grading-records' exceeded the quota.",
      'QuotaExceededError'
    )
    useRecordsStore.setState({
      addRecord: () => {
        addRecordCalls.push('throwing')
        throw quotaError
      },
    })

    startGrading()
    await flush(5200)

    // 关键：抛错之后循环仍然继续（旧实现在这里就 catch 成"批改中断"并结束）
    expect(addRecordCalls.length).toBeGreaterThanOrEqual(2)
    expect(bot.captureByCoordinate.mock.calls.length).toBeGreaterThanOrEqual(2)

    // 失败被降级成非致命告警，并且带上原始错误
    const warning = logs().find((message) => message.includes('非致命') && message.includes('保存批改记录'))
    expect(warning, `实际日志: ${JSON.stringify(logs())}`).toBeTruthy()
    expect(warning).toContain('exceeded the quota')

    // 绝不能出现"批改中断"
    expect(interrupted()).toEqual([])
    expect(
      toastError.mock.calls.filter((args) => String(args[0] ?? '').includes('批改中断'))
    ).toEqual([])
  }, 30000)

  it('核心业务不受影响：分数照常生成、提交照常发生、completed 正常累加', async () => {
    storage = installFakeLocalStorage({ maxValueChars: 50_000 })

    startGrading()
    await flush(5200)

    const stats = useGradingStore.getState().stats
    expect(stats.completed).toBeGreaterThanOrEqual(2)
    expect(stats.currentScore).toBe(7)
    // 每份都要"点击分数框 → 输入分数 → 点击提交"，即 3 次 clickAt + 1 次 typeAt
    expect(bot.typeAt).toHaveBeenCalledWith(900, 300, '7')
    expect(bot.clickAt.mock.calls.length).toBeGreaterThanOrEqual(6)
    expect(logs().some((message) => message.includes('已提交 7分'))).toBe(true)
  }, 30000)
})
