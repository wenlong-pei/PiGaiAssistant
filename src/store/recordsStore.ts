import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { v4 as uuidv4 } from 'uuid'
import type { GradingRecord, GradingProgress, FilterCondition } from '@/types'
import { createResilientPersistStorage } from './resilientStorage'

interface RecordsState {
  records: GradingRecord[]
  progress: GradingProgress
  filters: FilterCondition
  
  // 记录操作
  addRecord: (record: Omit<GradingRecord, 'id' | 'createdAt'>) => string
  updateRecord: (id: string, updates: Partial<GradingRecord>) => void
  deleteRecord: (id: string) => void
  deleteRecords: (ids: string[]) => void
  clearRecords: () => void
  
  // 批量操作
  addRecords: (records: Omit<GradingRecord, 'id' | 'createdAt'>[]) => string[]
  
  // 进度管理
  setProgress: (progress: Partial<GradingProgress>) => void
  resetProgress: () => void
  
  // 筛选
  setFilters: (filters: Partial<FilterCondition>) => void
  clearFilters: () => void
  getFilteredRecords: () => GradingRecord[]
  
  // 统计
  getStatistics: () => RecordStatistics
}

interface RecordStatistics {
  total: number
  completed: number
  pending: number
  failed: number
  averageScore: number
  aiAccuracy: number
}

const defaultProgress: GradingProgress = {
  total: 0,
  completed: 0,
  failed: 0,
  current: 0,
  status: 'idle',
}

const defaultFilters: FilterCondition = {}

/**
 * 持久化时允许写入 localStorage 的 base64 图片总量上限（字符数，约 1.9MB）。
 *
 * 为什么需要：zustand persist 每次 `set()` 都会把**整个 records 数组**重新序列化写一遍，
 * 而 `answerImage` 是整张答题区截图的 base64（实测 800x600 截图约 11 万字符）。
 * localStorage 配额约 5MB（实测 Chromium 写到约 5.17M 字符 / 第 46 条记录时开始抛
 * QuotaExceededError），且 `setItem` 是**同步**抛错 → 异常从 store.set() 冒泡到
 * 批改主循环的 catch，被显示成"批改中断"（皮老板反馈的假故障）。
 *
 * 策略：持久化时按「最近优先」保留原图，超预算的旧记录把 answerImage 置为空串；
 * **内存态始终保留完整图片**，因此本次会话内「记录」页查看原图 / 导出都不受影响，
 * 且界面只会显示「无」，不会出现破图或 undefined。
 */
export const PERSISTED_IMAGE_BUDGET = 2_000_000

/** 单条记录图片的最大字符数；超过它的记录在持久化时也会被裁掉（防止单条撑爆） */
export const MAX_SINGLE_PERSISTED_IMAGE = 600_000

/** 持久化载荷形状（只包含需要落盘的字段） */
export interface PersistedRecordsState {
  records: GradingRecord[]
  progress: GradingProgress
  filters: FilterCondition
}

/**
 * 按「最近优先 + 总字符预算」裁剪图片后返回可持久化的记录数组。
 *
 * 纯函数，不修改入参；`answerImage` 一定被写成字符串（空串而不是 undefined），
 * 保证反序列化后 `record.answerImage` 仍是 string，界面不会破图。
 */
export function stripImagesBeyondBudget(
  records: GradingRecord[],
  budget: number = PERSISTED_IMAGE_BUDGET
): GradingRecord[] {
  const out: GradingRecord[] = new Array(records.length)
  let used = 0
  for (let i = records.length - 1; i >= 0; i--) {
    const record = records[i]
    const image = typeof record.answerImage === 'string' ? record.answerImage : ''
    const overSingle = image.length > MAX_SINGLE_PERSISTED_IMAGE
    const overBudget = used + image.length > budget
    if (image && (overSingle || overBudget)) {
      out[i] = { ...record, answerImage: '' }
    } else {
      out[i] = record
      used += image.length
    }
  }
  return out
}

/**
 * 「瘦身重试」：配额写失败后剥离**全部**图片再写一次。
 *
 * 丢掉图片，但保住分数 / 评语 / 打分依据（业务数据优先）。
 * 由 `createResilientStateStorage` 在**真正写失败时**调用，正常路径不受影响。
 */
function shrinkRecordsPayload(rawJson: string): string | null {
  try {
    const payload = JSON.parse(rawJson) as { state?: Partial<PersistedRecordsState> }
    const records = payload?.state?.records
    if (!Array.isArray(records)) return null
    payload.state!.records = records.map((record) => ({ ...record, answerImage: '' }))
    return JSON.stringify(payload)
  } catch {
    return null
  }
}

/**
 * 容错存储：写入失败只会降级 + 记录 lastPersistError，绝不把异常抛回 addRecord。
 * 实现见共享模块 `src/store/resilientStorage.ts`（批改日志 / 设置 / 评分标准同款）。
 */
const { storage: resilientStorage, errors: recordsPersistErrors } =
  createResilientPersistStorage<PersistedRecordsState>({
    label: 'recordsStore',
    shrink: shrinkRecordsPayload,
  })

/** 读取最近一次持久化失败的原始错误；无失败返回 null */
export function getRecordsPersistError(): string | null {
  return recordsPersistErrors.get()
}

/** 清空持久化失败标记（界面提示过之后调用） */
export function clearRecordsPersistError(): void {
  recordsPersistErrors.clear()
}

export const useRecordsStore = create<RecordsState>()(
  persist(
    (set, get) => ({
      records: [],
      progress: defaultProgress,
      filters: defaultFilters,

      addRecord: (record) => {
        const id = uuidv4()
        set((state) => ({
          records: [
            ...state.records,
            { ...record, id, createdAt: new Date().toISOString() },
          ],
        }))
        return id
      },

      updateRecord: (id, updates) => {
        set((state) => ({
          records: state.records.map((r) =>
            r.id === id ? { ...r, ...updates } : r
          ),
        }))
      },

      deleteRecord: (id) => {
        set((state) => ({
          records: state.records.filter((r) => r.id !== id),
        }))
      },

      deleteRecords: (ids) => {
        set((state) => ({
          records: state.records.filter((r) => !ids.includes(r.id)),
        }))
      },

      clearRecords: () => {
        set({ records: [] })
      },

      addRecords: (records) => {
        const ids = records.map(() => uuidv4())
        const now = new Date().toISOString()
        set((state) => ({
          records: [
            ...state.records,
            ...records.map((r, i) => ({ ...r, id: ids[i], createdAt: now })),
          ],
        }))
        return ids
      },

      setProgress: (progress) => {
        set((state) => ({
          progress: { ...state.progress, ...progress },
        }))
      },

      resetProgress: () => {
        set({ progress: defaultProgress })
      },

      setFilters: (filters) => {
        set((state) => ({
          filters: { ...state.filters, ...filters },
        }))
      },

      clearFilters: () => {
        set({ filters: defaultFilters })
      },

      getFilteredRecords: () => {
        const { records, filters } = get()
        let filtered = [...records]

        if (filters.questionNumber) {
          filtered = filtered.filter(
            (r) => r.questionNumber === filters.questionNumber
          )
        }

        if (filters.evaluationMode) {
          filtered = filtered.filter(
            (r) => r.evaluationMode === filters.evaluationMode
          )
        }

        if (filters.status) {
          filtered = filtered.filter((r) => r.status === filters.status)
        }

        if (filters.dateRange) {
          const start = new Date(filters.dateRange.start).getTime()
          const end = new Date(filters.dateRange.end).getTime()
          filtered = filtered.filter((r) => {
            const date = new Date(r.createdAt).getTime()
            return date >= start && date <= end
          })
        }

        if (filters.scoreRange) {
          filtered = filtered.filter(
            (r) =>
              r.score >= filters.scoreRange!.min &&
              r.score <= filters.scoreRange!.max
          )
        }

        if (filters.searchText) {
          const search = filters.searchText.toLowerCase()
          filtered = filtered.filter(
            (r) =>
              r.studentName?.toLowerCase().includes(search) ||
              r.studentId?.toLowerCase().includes(search) ||
              r.ocrText?.toLowerCase().includes(search)
          )
        }

        return filtered
      },

      getStatistics: () => {
        const { records } = get()
        const completed = records.filter((r) => r.status === 'completed')
        const total = records.length
        const pending = records.filter((r) => r.status === 'pending').length
        const failed = records.filter((r) => r.status === 'failed').length

        const averageScore =
          completed.length > 0
            ? completed.reduce((sum, r) => sum + r.score, 0) / completed.length
            : 0

        const aiScored = completed.filter((r) => r.evaluationMode === 'ai')
        const aiAccuracy =
          aiScored.length > 0
            ? aiScored.reduce((sum, r) => sum + (r.aiScore || r.score), 0) /
              aiScored.length
            : 0

        return {
          total,
          completed: completed.length,
          pending,
          failed,
          averageScore,
          aiAccuracy,
        }
      },
    }),
    {
      name: 'grading-records',
      // 容错存储：写入失败只会降级 + 记 lastPersistError，绝不把异常抛回 addRecord
      storage: resilientStorage,
      // 关键：不要把整张 base64 截图写进 localStorage。否则配额（约 5MB）用满后
      // setItem 同步抛 QuotaExceededError，会把批改循环打断成"批改中断"假故障。
      partialize: (state): PersistedRecordsState => ({
        records: stripImagesBeyondBudget(state.records),
        progress: state.progress,
        filters: state.filters,
      }),
    }
  )
)

/**
 * 启动时自愈一次：把历史遗留的超大载荷立刻改写成「裁剪后」的版本。
 *
 * 为什么需要：旧版本把整张 base64 截图写进了 localStorage，用户的
 * `grading-records` 可能已经接近/顶到配额上限。那种状态下，即使本版本不再写大图，
 * 其它 store（批改日志 / 设置 / 评分标准）的小写入仍可能因为"总量已接近配额"而抛错，
 * 依旧会表现为"批改中断"。开机压缩一次就能把空间腾出来。
 *
 * 失败也绝不影响启动（这是锦上添花的副作用）。
 */
try {
  useRecordsStore.setState({})
} catch (error) {
  console.warn('[recordsStore] 启动压缩写入失败（不影响使用）:', error)
}
