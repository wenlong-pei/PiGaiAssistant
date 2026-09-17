import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { v4 as uuidv4 } from 'uuid'
import type { GradingRecord, GradingProgress, FilterCondition } from '@/types'

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
    }
  )
)
