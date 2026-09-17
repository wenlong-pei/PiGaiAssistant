/**
 * 批改记录持久化 / localStorage 配额 回归测试（阻断-04）
 *
 * 背景（皮老板反馈）：试改模式点击「确认提交」后弹出
 *   「批改中断: 操作失败，请查看日志或重新尝试」
 * 但分数已经正常生成。
 *
 * 根因：`addRecord()` 把整张答题区截图的 base64 写进 `localStorage`，
 * zustand persist 每次 `set()` 都会重写整个 `grading-records` 键，
 * 配额（Chromium 实测约 5,242,880 字符）用满后 `setItem` **同步**抛
 * QuotaExceededError → 异常从 store.set() 冒泡到批改主循环的 catch，
 * 被显示成"批改中断"。
 *
 * 本文件把三件事钉死：
 *   1. 持久化时按「最近优先 + 预算」裁剪图片（内存态不受影响）；
 *   2. 任何持久化失败都**不得**从 addRecord 抛出（否则会打断批改循环）；
 *   3. 正常写入路径没有被破坏。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  useRecordsStore,
  stripImagesBeyondBudget,
  PERSISTED_IMAGE_BUDGET,
  MAX_SINGLE_PERSISTED_IMAGE,
  getRecordsPersistError,
  clearRecordsPersistError,
} from '@/store/recordsStore'
import type { GradingRecord } from '@/types'

/** Chromium 实测配额：写到 5,167,620 字符仍成功，第 46 条（5,282,456）开始抛 QuotaExceededError */
const CHROMIUM_QUOTA_CHARS = 5_242_880

/** 实测：800x600 答题区截图转 base64 约 11 万字符（这里取同样量级） */
const REAL_IMAGE_CHARS = 114_000

const QUOTA_MESSAGE =
  "Failed to execute 'setItem' on 'Storage': Setting the value of 'grading-records' exceeded the quota."

function makeImage(size = REAL_IMAGE_CHARS): string {
  return 'data:image/png;base64,' + 'A'.repeat(size)
}

function makeRecord(index: number, imageSize = REAL_IMAGE_CHARS) {
  return {
    studentId: `student_${index}`,
    studentName: `学生${index}`,
    questionNumber: '1',
    standardId: 'std-1',
    standardName: '标准',
    answerImage: makeImage(imageSize),
    ocrText: `第${index}份作答`,
    score: 7,
    maxScore: 10,
    aiScore: 7,
    aiComment: '不错',
    reasoning: '依据细则',
    evaluationMode: 'ai' as const,
    status: 'completed' as const,
    isBlank: false,
  }
}

type FakeStorageOptions = {
  quotaChars: number
  /** 无视配额，任何写入都抛 QuotaExceededError */
  alwaysThrow: boolean
}

/** 用真实行为模拟 localStorage：配额用满时**同步**抛 QuotaExceededError */
function installFakeLocalStorage(options: FakeStorageOptions) {
  const map = new Map<string, string>()
  const fake = {
    getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
    setItem: (key: string, value: string) => {
      if (options.alwaysThrow) {
        throw new DOMException(QUOTA_MESSAGE, 'QuotaExceededError')
      }
      let used = 0
      for (const [k, v] of map) {
        if (k !== key) used += k.length + v.length
      }
      const next = used + key.length + String(value).length
      if (next > options.quotaChars) {
        throw new DOMException(QUOTA_MESSAGE, 'QuotaExceededError')
      }
      map.set(key, String(value))
    },
    removeItem: (key: string) => {
      map.delete(key)
    },
    clear: () => map.clear(),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    get length() {
      return map.size
    },
  }

  const target = window.localStorage as unknown as Record<string, unknown>
  const originals: Record<string, unknown> = {}
  for (const name of ['getItem', 'setItem', 'removeItem', 'clear']) {
    originals[name] = target[name]
    target[name] = (fake as unknown as Record<string, unknown>)[name]
  }

  return {
    raw: () => map.get('grading-records') ?? null,
    totalChars: () => {
      let total = 0
      for (const [k, v] of map) total += k.length + v.length
      return total
    },
    restore: () => {
      for (const [name, fn] of Object.entries(originals)) {
        target[name] = fn
      }
    },
  }
}

let activeStorage: { restore: () => void } | null = null

beforeEach(() => {
  useRecordsStore.setState({ records: [] })
  clearRecordsPersistError()
})

afterEach(() => {
  activeStorage?.restore()
  activeStorage = null
  useRecordsStore.setState({ records: [] })
})

describe('stripImagesBeyondBudget（图片预算裁剪，纯函数）', () => {
  // 每张 300,022 字符；预算 700,000 → 只装得下最新的 2 张
  const records = [
    makeRecord(1, 300_000),
    makeRecord(2, 300_000),
    makeRecord(3, 300_000),
    makeRecord(4, 300_000),
  ] as GradingRecord[]

  it('按「最近优先」保留图片：新的保留，超预算的旧的被裁为空串而不是 undefined', () => {
    const out = stripImagesBeyondBudget(records, 700_000)
    expect(out).toHaveLength(4)
    expect(out[3].answerImage).not.toBe('')
    expect(out[2].answerImage).not.toBe('')
    expect(out[1].answerImage).toBe('')
    expect(out[0].answerImage).toBe('')
  })

  it('任何情况下 answerImage 都是字符串（界面不会出现破图 / undefined）', () => {
    const out = stripImagesBeyondBudget(records, 700_000)
    for (const record of out) {
      expect(typeof record.answerImage).toBe('string')
      expect(record.answerImage === undefined).toBe(false)
    }
  })

  it('不修改入参，其它字段原样保留', () => {
    const snapshot = JSON.parse(JSON.stringify(records))
    const out = stripImagesBeyondBudget(records, 700_000)
    expect(JSON.parse(JSON.stringify(records))).toEqual(snapshot)
    expect(out[0].studentId).toBe(records[0].studentId)
    expect(out[0].ocrText).toBe(records[0].ocrText)
    expect(out[0].reasoning).toBe(records[0].reasoning)
    expect(out[0].score).toBe(records[0].score)
  })

  it('单张超过上限的图片即使预算充足也会被裁（防止单条撑爆）', () => {
    const huge = [makeRecord(1, MAX_SINGLE_PERSISTED_IMAGE + 1)] as GradingRecord[]
    const out = stripImagesBeyondBudget(huge, PERSISTED_IMAGE_BUDGET)
    expect(out[0].answerImage).toBe('')
  })

  it('空字符串图片不会被误当成超预算（无图记录不受影响）', () => {
    const noImage = [makeRecord(1, 0)] as GradingRecord[]
    const out = stripImagesBeyondBudget(noImage, 0)
    expect(out[0].answerImage).toBe('')
    expect(out).toHaveLength(1)
  })
})

describe('recordsStore 持久化在配额压力下的行为', () => {
  it('正常情况：记录会被真正写入 localStorage（功能未被改坏）', () => {
    activeStorage = installFakeLocalStorage({ quotaChars: CHROMIUM_QUOTA_CHARS, alwaysThrow: false })
    const store = useRecordsStore.getState()
    store.addRecord(makeRecord(1, 1_000))

    const raw = (activeStorage as any).raw()
    expect(raw).toBeTruthy()
    const parsed = JSON.parse(raw)
    expect(parsed.state.records).toHaveLength(1)
    expect(parsed.state.records[0].studentName).toBe('学生1')
    expect(parsed.state.records[0].answerImage).not.toBe('')
    expect(getRecordsPersistError()).toBeNull()
  })

  it('配额受限时连写 60 份带图记录：addRecord 不再抛错，写入量始终不超配额', () => {
    // 60 份 × 11.4 万字符远超 5MB：旧实现在第 46 份就会抛 QuotaExceededError
    activeStorage = installFakeLocalStorage({ quotaChars: CHROMIUM_QUOTA_CHARS, alwaysThrow: false })

    const store = useRecordsStore.getState()
    for (let i = 1; i <= 60; i++) {
      expect(
        () => useRecordsStore.getState().addRecord(makeRecord(i)),
        `第 ${i} 份记录不应抛错（旧实现会抛 QuotaExceededError 并显示"批改中断"）`
      ).not.toThrow()
      expect((activeStorage as any).totalChars()).toBeLessThanOrEqual(CHROMIUM_QUOTA_CHARS)
    }

    // 内存态保留完整图片：本次会话内「记录」页查看原图 / 导出不受影响
    const inMemory = useRecordsStore.getState().records
    expect(inMemory).toHaveLength(60)
    expect(inMemory[0].answerImage.length).toBeGreaterThan(REAL_IMAGE_CHARS)
    expect(inMemory[59].answerImage.length).toBeGreaterThan(REAL_IMAGE_CHARS)
    expect(store).toBeTruthy()

    // 走的是「预算内优雅保留」而不是「最后兜底全丢」：最近的记录仍带图，
    // 且图片总量不超过预算（证明 partialize 真的在生效）
    const persisted = JSON.parse((activeStorage as any).raw())
    const persistedRecords: GradingRecord[] = persisted.state.records
    expect(persistedRecords).toHaveLength(60)
    const withImage = persistedRecords.filter((record) => record.answerImage.length > 0)
    expect(withImage.length).toBeGreaterThan(0)
    const imageChars = persistedRecords.reduce((sum, r) => sum + r.answerImage.length, 0)
    expect(imageChars).toBeLessThanOrEqual(PERSISTED_IMAGE_BUDGET)
    // 保留的必须是「最近的」：最后一份一定带图，最老的一份一定被裁
    expect(persistedRecords[59].answerImage).not.toBe('')
    expect(persistedRecords[0].answerImage).toBe('')
    // 全程没走到"降级"，说明预算策略本身就够用
    expect(getRecordsPersistError()).toBeNull()
  })

  it('写入彻底失败（alwaysThrow）时：addRecord 不抛错、记录仍在内存、失败原因可见', () => {
    activeStorage = installFakeLocalStorage({ quotaChars: 0, alwaysThrow: true })

    expect(() => useRecordsStore.getState().addRecord(makeRecord(1))).not.toThrow()

    // 记录没有丢，只是没能落盘
    expect(useRecordsStore.getState().records).toHaveLength(1)
    expect(useRecordsStore.getState().records[0].studentName).toBe('学生1')
    // 原始错误被保留下来，供界面给出可行动提示
    expect(getRecordsPersistError()).toContain('exceeded the quota')
  })

  it('降级兜底：配额只够放"无图"载荷时，分数/评语/打分依据仍然落盘', () => {
    // 配额 100,000：带图载荷（约 115,000 字符）必失败 → 兜底剥离全部图片后应成功
    activeStorage = installFakeLocalStorage({ quotaChars: 100_000, alwaysThrow: false })

    expect(() => useRecordsStore.getState().addRecord(makeRecord(1, 114_000))).not.toThrow()
    expect(() => useRecordsStore.getState().addRecord(makeRecord(2, 114_000))).not.toThrow()

    const raw = (activeStorage as any).raw()
    expect(raw).toBeTruthy()
    const parsed = JSON.parse(raw)
    expect(parsed.state.records).toHaveLength(2)
    // 图片被丢弃，但批改结果本身必须保住
    expect(parsed.state.records[0].answerImage).toBe('')
    expect(parsed.state.records[1].answerImage).toBe('')
    expect(parsed.state.records[1].score).toBe(7)
    expect(parsed.state.records[1].aiComment).toBe('不错')
    expect(parsed.state.records[1].reasoning).toBe('依据细则')
    // 内存态仍保留原图，本次会话内查看原图 / 导出不受影响
    expect(useRecordsStore.getState().records[0].answerImage.length).toBeGreaterThan(114_000)
  })

  it('partialize 确实接在 persist 选项上（防止"写了裁剪函数但没接线"）', () => {
    const options = useRecordsStore.persist.getOptions()
    expect(typeof options.partialize).toBe('function')
    const persisted = options.partialize!(useRecordsStore.getState()) as {
      records: GradingRecord[]
    }
    const big = [makeRecord(1, MAX_SINGLE_PERSISTED_IMAGE + 1)] as GradingRecord[]
    const stripped = options.partialize!({ ...useRecordsStore.getState(), records: big }) as {
      records: GradingRecord[]
    }
    expect(persisted.records).toBeDefined()
    expect(stripped.records[0].answerImage).toBe('')
  })
})
