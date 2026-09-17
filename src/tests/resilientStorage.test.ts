/**
 * 容错持久化存储层回归测试（8.4 / 8.5）
 * ===========================================================================
 * 背景：zustand `persist` 每次 `set()` 都会重写整个 localStorage 键，配额满时
 * `setItem` **同步抛** `QuotaExceededError`，异常冒泡进批改主循环 → 假"批改中断"。
 *
 * 本文件把「所有 persisted store 的写入都永不抛错」这件事钉死，并证明降级是**可见的**：
 *   1. 正常写入成功 → 无降级标记；
 *   2. 配额失败 + 可瘦身 → 写入瘦身版本（丢图片、保业务数据），降级标记保留；
 *   3. 配额失败 + 无法瘦身 → 不抛错，只 console.error + 记错误；
 *   4. 具体 store：评分标准（examples[].image）与设置（blankSampleImage）
 *      在配额满时优雅降级而不是整个保存动作炸掉。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  createResilientStateStorage,
  createResilientPersistStorage,
  errorToMessage,
} from '@/store/resilientStorage'
import { useGradingStore } from '@/store/gradingStore'
import { useSettingsStore } from '@/store/settingsStore'
import { useStandardsStore } from '@/store/standardsStore'
import { useRecordsStore } from '@/store/recordsStore'

const QUOTA_MESSAGE =
  "Failed to execute 'setItem' on 'Storage': Setting the value of 'grading-records' exceeded the quota."

interface Patch {
  restore: () => void
  raw: (key: string) => string | null
}

/** 用真实行为模拟 localStorage：配额用满时**同步**抛 QuotaExceededError */
function patchLocalStorage(opts: { quotaChars?: number; alwaysThrow?: boolean }): Patch {
  const map = new Map<string, string>()
  const quota = opts.quotaChars ?? Number.POSITIVE_INFINITY

  const fake = {
    getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
    setItem: (key: string, value: string) => {
      if (opts.alwaysThrow) throw new DOMException(QUOTA_MESSAGE, 'QuotaExceededError')
      let used = 0
      for (const [k, v] of map) {
        if (k !== key) used += k.length + v.length
      }
      if (used + key.length + String(value).length > quota) {
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
    restore: () => {
      for (const [name, fn] of Object.entries(originals)) {
        target[name] = fn
      }
    },
    raw: (key: string) => map.get(key) ?? null,
  }
}

let active: Patch | null = null
let consoleError: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  active?.restore()
  active = null
  consoleError.mockRestore()
})

describe('errorToMessage', () => {
  it('DOMException 取 message 而不是 "[object DOMException]"', () => {
    expect(errorToMessage(new DOMException(QUOTA_MESSAGE, 'QuotaExceededError'))).toContain(
      'exceeded the quota'
    )
  })

  it('非 Error 值也能转成字符串', () => {
    expect(errorToMessage('boom')).toBe('boom')
  })
})

describe('createResilientStateStorage：三级降级', () => {
  it('正常写入成功 → 不标记降级', () => {
    active = patchLocalStorage({})
    const { storage, errors } = createResilientStateStorage({ label: 'test' })

    storage.setItem('k', '{"a":1}')

    expect(active.raw('k')).toBe('{"a":1}')
    expect(errors.get()).toBeNull()
  })

  it('配额失败 + 可瘦身 → 写入瘦身版本，且降级标记保留（降级必须可见）', () => {
    active = patchLocalStorage({ quotaChars: 200 })
    const { storage, errors } = createResilientStateStorage({
      label: 'test',
      shrink: (raw) => {
        const payload = JSON.parse(raw)
        payload.state.records = payload.state.records.map((r: any) => ({ ...r, image: '' }))
        return JSON.stringify(payload)
      },
    })

    const big = JSON.stringify({
      state: { records: [{ id: 1, score: 7, image: 'A'.repeat(5000) }] },
    })
    expect(() => storage.setItem('k', big)).not.toThrow()

    const stored = JSON.parse(active.raw('k')!)
    expect(stored.state.records[0].image).toBe('')
    expect(stored.state.records[0].score).toBe(7)
    // 降级可见：调用方据此提示用户"没写全"
    expect(errors.get()).toContain('exceeded the quota')
  })

  it('配额失败且无法瘦身 → 不抛错，只 console.error + 记错误', () => {
    active = patchLocalStorage({ alwaysThrow: true })
    const { storage, errors } = createResilientStateStorage({ label: 'test' })

    expect(() => storage.setItem('k', '{"a":1}')).not.toThrow()

    expect(errors.get()).toContain('exceeded the quota')
    expect(consoleError).toHaveBeenCalled()
    expect(String(consoleError.mock.calls[0][0])).toContain('[test]')
  })

  it('shrink 返回 null（无法瘦身）时同样安全降级', () => {
    active = patchLocalStorage({ alwaysThrow: true })
    const { storage } = createResilientStateStorage({ label: 'test', shrink: () => null })

    expect(() => storage.setItem('k', '{"a":1}')).not.toThrow()
  })

  it('removeItem 抛错也不冒泡', () => {
    active = patchLocalStorage({})
    const target = window.localStorage as unknown as Record<string, unknown>
    target.removeItem = () => {
      throw new DOMException('nope', 'SecurityError')
    }

    const { storage, errors } = createResilientStateStorage({ label: 'test' })
    expect(() => storage.removeItem('k')).not.toThrow()
    expect(errors.get()).toBeTruthy()
  })
})

describe('createResilientPersistStorage：给 zustand 用的 JSON 存储', () => {
  it('JSON 序列化写入 / 读出往返正常', () => {
    active = patchLocalStorage({})
    const { storage, errors } = createResilientPersistStorage<{ count: number }>({ label: 'test' })

    storage!.setItem('k', { state: { count: 3 }, version: 0 })
    expect(storage!.getItem('k')).toEqual({ state: { count: 3 }, version: 0 })
    expect(errors.get()).toBeNull()
  })

  it('配额满时写入不抛错', () => {
    active = patchLocalStorage({ alwaysThrow: true })
    const { storage } = createResilientPersistStorage<{ count: number }>({ label: 'test' })

    expect(() => storage!.setItem('k', { state: { count: 3 }, version: 0 })).not.toThrow()
  })
})

describe('各个 persisted store 在配额满时都不再抛错（8.4 / 8.5 接线）', () => {
  it('批改状态：addLog 级别的写入不再抛错（这正是"批改中断"的触发点）', () => {
    active = patchLocalStorage({ alwaysThrow: true })
    expect(() => useGradingStore.getState().addLog('测试日志')).not.toThrow()
  })

  it('批改记录：addRecord 不再抛错', () => {
    active = patchLocalStorage({ alwaysThrow: true })
    expect(() =>
      useRecordsStore.getState().addRecord({
        studentId: 's1',
        studentName: '学生1',
        questionNumber: '1',
        standardId: 'std',
        standardName: '标准',
        answerImage: '',
        ocrText: '作答',
        score: 7,
        maxScore: 10,
        aiScore: 7,
        aiComment: '不错',
        reasoning: '依据',
        evaluationMode: 'ai',
        status: 'completed',
        isBlank: false,
      })
    ).not.toThrow()
  })

  it('设置：写入不再抛错，且 blankSampleImage 在配额满时被优雅剥离（不是整个保存炸掉）', () => {
    // 配额只够放"小"载荷：带 5 万字符示例图的主写入必失败 → 瘦身后成功
    active = patchLocalStorage({ quotaChars: 20_000 })

    const hugeImage = 'data:image/png;base64,' + 'A'.repeat(50_000)
    expect(() =>
      useSettingsStore.setState((state) => ({
        settings: { ...state.settings, blankSampleImage: hugeImage, soundVolume: 42 },
      }))
    ).not.toThrow()

    const stored = JSON.parse(active.raw('grading-settings')!)
    expect(stored.state.settings.blankSampleImage).toBe('')
    // 业务字段必须保住
    expect(stored.state.settings.soundVolume).toBe(42)
  })

  it('评分标准：写入不再抛错，且 examples[].image 在配额满时被优雅剥离', () => {
    active = patchLocalStorage({ quotaChars: 20_000 })

    const hugeImage = 'data:image/png;base64,' + 'B'.repeat(50_000)
    expect(() =>
      useStandardsStore.setState({
        standards: [
          {
            id: 'std-1',
            name: '标准',
            totalScore: 10,
            scoringRules: '按要点给分',
            referenceAnswer: '参考答案',
            examples: [
              { id: 'ex-1', content: '示例', score: 10, comment: '很好', image: hugeImage },
            ],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      })
    ).not.toThrow()

    const stored = JSON.parse(active.raw('grading-standards')!)
    expect(stored.state.standards[0].examples[0].image).toBe('')
    expect(stored.state.standards[0].name).toBe('标准')
    expect(stored.state.standards[0].examples[0].comment).toBe('很好')
  })

  it('partialize 必须接在四个 store 的 persist 选项上（防止"写了裁剪函数但没接线"）', () => {
    for (const store of [useGradingStore, useRecordsStore, useSettingsStore, useStandardsStore]) {
      const options = (store as { persist: { getOptions: () => { partialize?: unknown } } }).persist.getOptions()
      expect(typeof options.partialize).toBe('function')
    }
  })
})
