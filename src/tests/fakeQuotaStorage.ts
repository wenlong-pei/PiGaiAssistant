/**
 * 测试辅助：模拟 Chromium 的 localStorage 行为。
 *
 * 为什么要自己模拟：
 *  - `src/tests/setup.ts` 里的 localStorage 是**无副作用的空壳**（setItem 什么都不做），
 *    永远测不出配额问题；
 *  - jsdom 自带的 localStorage 不实现配额，也不会抛 QuotaExceededError。
 *
 * 真实行为（Playwright + 真实 Chromium 实测）：
 *  写入 localStorage 时若超出配额，`setItem` 会**同步**抛
 *  `QuotaExceededError: Failed to execute 'setItem' on 'Storage':
 *   Setting the value of 'grading-records' exceeded the quota.`
 *  —— 这正是"批改中断"假故障的来源。
 *
 * 注意：本文件不是 `*.test.*`，不会被 vitest 收集为测试用例。
 */

export interface FakeLocalStorageOptions {
  /** 总容量（字符数）。Chromium 实测约 5,242,880（5MB） */
  quotaChars?: number
  /** 单次写入允许的最大值长度（字符数）；用于模拟"配额已接近写满、小写入能成功而大写入失败" */
  maxValueChars?: number
  /** 无视一切，任何写入都抛 QuotaExceededError（模拟配额完全耗尽 / 存储被禁用） */
  alwaysThrow?: boolean
}

export interface FakeLocalStorageHandle {
  /** 读取原始字符串值 */
  raw: (key: string) => string | null
  /** 当前所有键值占用的字符数合计 */
  totalChars: () => number
  /** 是否有该键 */
  has: (key: string) => boolean
  /** 恢复被临时替换掉的 localStorage 方法 */
  restore: () => void
}

export const CHROMIUM_QUOTA_CHARS = 5_242_880

export function quotaExceededError(key = 'grading-records'): DOMException {
  return new DOMException(
    `Failed to execute 'setItem' on 'Storage': Setting the value of '${key}' exceeded the quota.`,
    'QuotaExceededError'
  )
}

/**
 * 把 `window.localStorage` 的方法替换成带配额检查的实现。
 *
 * 只替换方法（不重新 defineProperty），因为 setup.ts 里 `window.localStorage`
 * 被定义为不可重新配置的属性。
 */
export function installFakeLocalStorage(
  options: FakeLocalStorageOptions = {}
): FakeLocalStorageHandle {
  const quotaChars = options.quotaChars ?? CHROMIUM_QUOTA_CHARS
  const map = new Map<string, string>()

  const fake = {
    getItem: (key: string): string | null => (map.has(key) ? map.get(key)! : null),
    setItem: (key: string, value: string): void => {
      const text = String(value)
      if (options.alwaysThrow) throw quotaExceededError(key)
      if (options.maxValueChars !== undefined && text.length > options.maxValueChars) {
        throw quotaExceededError(key)
      }
      let used = key.length + text.length
      for (const [k, v] of map) {
        if (k !== key) used += k.length + v.length
      }
      if (used > quotaChars) throw quotaExceededError(key)
      map.set(key, text)
    },
    removeItem: (key: string): void => {
      map.delete(key)
    },
    clear: (): void => map.clear(),
    key: (index: number): string | null => Array.from(map.keys())[index] ?? null,
    get length(): number {
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
    raw: (key: string) => map.get(key) ?? null,
    has: (key: string) => map.has(key),
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
