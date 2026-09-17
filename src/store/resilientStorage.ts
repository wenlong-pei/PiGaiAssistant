/**
 * 共享的「容错持久化存储层」（zustand `persist` 用的 `StateStorage` / `PersistStorage`）。
 *
 * ===========================================================================
 * 为什么需要它（阻断-04 的通用化）
 * ===========================================================================
 * zustand 的 `persist` 在每次 `set()` 时都会把**整个持久化载荷**重新序列化写一遍，
 * 并调用 `localStorage.setItem`。`setItem` 在配额（Chromium 实测约 5,242,880 字符）
 * 用满时是**同步抛错**的：`QuotaExceededError` 会从 `store.set()` 一路冒泡到调用方。
 *
 * 当这个调用方是批改主循环时，异常被渲染成「批改中断: 操作失败，请查看日志或重新尝试」，
 * 而实际上分数早已生成 —— 这正是皮老板反馈的假故障根因。
 *
 * 因此把所有 persisted store 的写入都收敛到本模块，统一保证：
 *   1) **非关键副作用永不抛回调用方**（写不进去就降级为「仅内存保留」）；
 *   2) 配额失败时先尝试「瘦身重试」（丢掉 base64 图片，保住分数 / 评语 / 判分依据）；
 *   3) 失败原因被记下来（`PersistErrorTracker`），让界面能提示用户"没写盘"，
 *      而不是静默丢数据。
 *
 * 注意：瘦身重试**只在真正写失败时**发生，正常路径写入的字段集合与旧版本完全一致
 * （`partialize` 保持身份映射），不会因为引入本模块而悄悄少存字段。
 */

import { createJSONStorage, type PersistStorage, type StateStorage } from 'zustand/middleware'

/** 把任意异常转成可读文案（`DOMException` 真正有用的是它的 `message`） */
export function errorToMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message?: unknown }).message || error)
  }
  return String(error)
}

/**
 * 安全获取 localStorage。
 * 存储被禁用（隐私模式 / 权限受限）时，连**访问** `window.localStorage` 都可能抛错，
 * 所以取值本身也必须包在 try 里。
 */
function resolveLocalStorage(): Storage | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null
    return window.localStorage
  } catch {
    return null
  }
}

/** 每个 store 独立的「最近一次持久化失败」记录器 */
export interface PersistErrorTracker {
  /** 读取最近一次失败原因；无失败返回 null */
  get: () => string | null
  /** 清空失败标记（界面提示过之后调用） */
  clear: () => void
}

export interface ResilientStorageOptions {
  /** 仅用于 `console.error` 定位是哪个 store 的持久化失败 */
  label: string
  /**
   * 「瘦身重试」：把原始 JSON 载荷改写为更小的版本（例如剥离全部 base64 图片）。
   * 返回改写后的 JSON 字符串；返回 `null` 表示无法瘦身（直接进入最后一级降级）。
   */
  shrink?: (rawJson: string) => string | null
}

export interface ResilientStateStorageBundle {
  storage: StateStorage
  errors: PersistErrorTracker
}

/**
 * 生成一个带三级降级的 `StateStorage`（字符串进 / 字符串出）：
 *
 *  1) 正常写入 `setItem`；
 *  2) 若失败且提供了 `shrink` → 瘦身后再写一次（丢掉图片，保住业务数据）；
 *  3) 仍失败 → 只记录错误 + `console.error`，**绝不向上抛**。
 *
 * 第 3 条是关键：持久化属于非关键副作用，任何情况下都不允许把异常抛回
 * 调用方进而打断批改主循环。
 *
 * 语义细节：瘦身**成功**时**不清空** `lastError` —— 降级必须保持可见，
 * 界面据此提示用户「记录已保留在本次会话，但磁盘写入降级」。
 */
export function createResilientStateStorage(
  options: ResilientStorageOptions
): ResilientStateStorageBundle {
  let lastError: string | null = null

  const errors: PersistErrorTracker = {
    get: () => lastError,
    clear: () => {
      lastError = null
    },
  }

  const storage: StateStorage = {
    getItem: (name: string): string | null => {
      const store = resolveLocalStorage()
      if (!store) return null
      try {
        return store.getItem(name)
      } catch (error) {
        lastError = errorToMessage(error)
        return null
      }
    },

    setItem: (name: string, value: string): void => {
      const store = resolveLocalStorage()
      if (!store) return

      try {
        store.setItem(name, value)
        lastError = null
        return
      } catch (error) {
        lastError = errorToMessage(error)
      }

      // 第 2 级：瘦身后重试（例如丢掉全部 base64 图片，优先保住批改结果本身）
      if (options.shrink) {
        try {
          const shrunk = options.shrink(value)
          if (shrunk) {
            store.setItem(name, shrunk)
            // 刻意不清空 lastError：让「降级」在界面上保持可见
            return
          }
        } catch (error) {
          lastError = errorToMessage(error)
        }
      }

      // 第 3 级：放弃写盘，绝不抛回调用方
      console.error(
        `[${options.label}] 持久化失败（已降级为仅内存保留，不影响继续运行）:`,
        lastError
      )
    },

    removeItem: (name: string): void => {
      const store = resolveLocalStorage()
      if (!store) return
      try {
        store.removeItem(name)
      } catch (error) {
        lastError = errorToMessage(error)
      }
    },
  }

  return { storage, errors }
}

/**
 * 容错 JSON 存储：`createJSONStorage` 包裹上面的 `StateStorage`，
 * 类型与 zustand `persist` 的 `storage` 选项（`PersistStorage<S>`）一致。
 */
export function createResilientPersistStorage<S>(
  options: ResilientStorageOptions
): { storage: PersistStorage<S> | undefined; errors: PersistErrorTracker } {
  const { storage, errors } = createResilientStateStorage(options)
  return { storage: createJSONStorage<S>(() => storage), errors }
}
