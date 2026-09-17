/**
 * 批改历史记录 Store
 * 使用 Zustand 管理历史记录的状态
 */

import { create } from 'zustand'
import { v4 as uuidv4 } from 'uuid'
import type { 
  GradingHistory, 
  GradingHistoryFilter, 
  GradingHistoryStatistics,
  HistoryCompareResult 
} from '@/types'
import gradingHistoryRepository from '@/shared/db/gradingHistoryRepository'

/**
 * 历史记录 Store 状态接口
 */
interface GradingHistoryState {
  // 数据状态
  histories: GradingHistory[]
  totalCount: number
  currentPage: number
  pageSize: number
  totalPages: number
  
  // 筛选和加载状态
  filter: GradingHistoryFilter
  isLoading: boolean
  error: string | null
  
  // 选中的记录（用于详情和对比）
  selectedHistoryId: string | null
  compareHistoryIds: string[]
  
  // 统计信息
  statistics: GradingHistoryStatistics | null

  // ==================== 数据操作方法 ====================

  /**
   * 初始化数据库
   */
  initDatabase: () => Promise<void>

  /**
   * 获取历史记录列表
   * @param page 页码
   * @param filter 筛选条件
   */
  fetchHistories: (page?: number, filter?: GradingHistoryFilter) => Promise<void>

  /**
   * 获取单条历史记录
   * @param id 记录ID
   * @returns 历史记录
   */
  getHistoryById: (id: string) => Promise<GradingHistory | null>

  /**
   * 保存历史记录
   * @param history 历史记录数据（不含 id 和 createdAt）
   */
  saveHistory: (history: Omit<GradingHistory, 'id' | 'createdAt'>) => Promise<string>

  /**
   * 删除历史记录
   * @param id 记录ID
   */
  deleteHistory: (id: string) => Promise<void>

  /**
   * 批量删除历史记录
   * @param ids 记录ID数组
   */
  deleteHistories: (ids: string[]) => Promise<void>

  /**
   * 获取统计信息
   */
  fetchStatistics: () => Promise<void>

  // ==================== 状态操作方法 ====================

  /**
   * 设置筛选条件
   * @param filter 筛选条件（部分）
   */
  setFilter: (filter: Partial<GradingHistoryFilter>) => void

  /**
   * 清除筛选条件
   */
  clearFilter: () => void

  /**
   * 设置页码
   * @param page 页码
   */
  setPage: (page: number) => void

  /**
   * 设置每页数量
   * @param size 每页数量
   */
  setPageSize: (size: number) => void

  /**
   * 选中历史记录（用于查看详情）
   * @param id 记录ID
   */
  selectHistory: (id: string | null) => void

  /**
   * 添加/移除对比记录
   * @param id 记录ID
   */
  toggleCompare: (id: string) => void

  /**
   * 清除对比选择
   */
  clearCompare: () => void

  /**
   * 获取对比结果
   * @returns 对比结果或null
   */
  getCompareResult: () => Promise<HistoryCompareResult | null>

  /**
   * 清除错误状态
   */
  clearError: () => void
}

/**
 * 默认筛选条件
 */
const defaultFilter: GradingHistoryFilter = {}

/**
 * 创建 Store
 */
export const useGradingHistoryStore = create<GradingHistoryState>()((set, get) => ({
  // 初始状态
  histories: [],
  totalCount: 0,
  currentPage: 1,
  pageSize: 20,
  totalPages: 0,
  
  filter: defaultFilter,
  isLoading: false,
  error: null,
  
  selectedHistoryId: null,
  compareHistoryIds: [],
  
  statistics: null,

  // ==================== 数据操作方法实现 ====================

  initDatabase: async () => {
    try {
      set({ isLoading: true, error: null })
      await gradingHistoryRepository.init()
      console.log('[GradingHistoryStore] 数据库初始化成功')
    } catch (error: any) {
      console.error('[GradingHistoryStore] 数据库初始化失败:', error)
      set({ error: error.message || '数据库初始化失败' })
      throw error
    } finally {
      set({ isLoading: false })
    }
  },

  fetchHistories: async (page?: number, filter?: GradingHistoryFilter) => {
    try {
      set({ isLoading: true, error: null })

      const currentPage = page || get().currentPage
      const currentFilter = filter || get().filter
      const pageSize = get().pageSize

      const { histories, total } = gradingHistoryRepository.getHistories(
        currentFilter,
        currentPage,
        pageSize
      )

      const totalPages = Math.ceil(total / pageSize)

      set({
        histories,
        totalCount: total,
        currentPage: currentPage,
        totalPages,
        filter: currentFilter,
      })

      console.log(`[GradingHistoryStore] 获取历史记录成功: ${histories.length} 条`)
    } catch (error: any) {
      console.error('[GradingHistoryStore] 获取历史记录失败:', error)
      set({ error: error.message || '获取历史记录失败' })
    } finally {
      set({ isLoading: false })
    }
  },

  getHistoryById: async (id: string) => {
    try {
      const history = gradingHistoryRepository.getHistoryById(id)
      return history
    } catch (error: any) {
      console.error('[GradingHistoryStore] 获取历史记录详情失败:', error)
      set({ error: error.message || '获取历史记录详情失败' })
      return null
    }
  },

  saveHistory: async (history) => {
    try {
      set({ isLoading: true, error: null })

      const id = uuidv4()
      const now = new Date().toISOString()

      const fullHistory: GradingHistory = {
        ...history,
        id,
        createdAt: now,
      }

      // 修复 高-06：repository 写入现在会因持久化失败而抛错，必须 await 才能让错误进入本 catch，
      // 从而 set({ error }) 并上抛给 UI（此前未 await，失败会变成静默的未处理 Promise）
      await gradingHistoryRepository.saveHistory(fullHistory)

      // 刷新列表
      await get().fetchHistories()

      console.log(`[GradingHistoryStore] 历史记录保存成功: ${id}`)
      return id
    } catch (error: any) {
      console.error('[GradingHistoryStore] 保存历史记录失败:', error)
      set({ error: error.message || '保存历史记录失败' })
      throw error
    } finally {
      set({ isLoading: false })
    }
  },

  deleteHistory: async (id: string) => {
    try {
      set({ isLoading: true, error: null })

      await gradingHistoryRepository.deleteHistory(id)

      // 如果删除的是当前选中的记录，清除选中状态
      if (get().selectedHistoryId === id) {
        set({ selectedHistoryId: null })
      }

      // 从对比列表中移除
      const compareIds = get().compareHistoryIds.filter((cid) => cid !== id)
      set({ compareHistoryIds: compareIds })

      // 刷新列表
      await get().fetchHistories()

      console.log(`[GradingHistoryStore] 历史记录删除成功: ${id}`)
    } catch (error: any) {
      console.error('[GradingHistoryStore] 删除历史记录失败:', error)
      set({ error: error.message || '删除历史记录失败' })
      throw error
    } finally {
      set({ isLoading: false })
    }
  },

  deleteHistories: async (ids: string[]) => {
    try {
      set({ isLoading: true, error: null })

      await gradingHistoryRepository.deleteHistories(ids)

      // 清除选中状态和对比列表
      set({ 
        selectedHistoryId: null,
        compareHistoryIds: [],
      })

      // 刷新列表
      await get().fetchHistories()

      console.log(`[GradingHistoryStore] 批量删除历史记录成功: ${ids.length} 条`)
    } catch (error: any) {
      console.error('[GradingHistoryStore] 批量删除历史记录失败:', error)
      set({ error: error.message || '批量删除历史记录失败' })
      throw error
    } finally {
      set({ isLoading: false })
    }
  },

  fetchStatistics: async () => {
    try {
      const filter = get().filter
      const statistics = gradingHistoryRepository.getStatistics(filter)
      set({ statistics })
      console.log('[GradingHistoryStore] 获取统计信息成功')
    } catch (error: any) {
      console.error('[GradingHistoryStore] 获取统计信息失败:', error)
      set({ error: error.message || '获取统计信息失败' })
    }
  },

  // ==================== 状态操作方法实现 ====================

  setFilter: (filter: Partial<GradingHistoryFilter>) => {
    const newFilter = { ...get().filter, ...filter }
    set({ filter: newFilter, currentPage: 1 }) // 重置到第一页
    
    // 自动刷新数据
    get().fetchHistories(1, newFilter)
  },

  clearFilter: () => {
    set({ filter: defaultFilter, currentPage: 1 })
    
    // 自动刷新数据
    get().fetchHistories(1, defaultFilter)
  },

  setPage: (page: number) => {
    if (page < 1 || page > get().totalPages) return
    
    set({ currentPage: page })
    
    // 自动刷新数据
    get().fetchHistories(page)
  },

  setPageSize: (size: number) => {
    set({ pageSize: size, currentPage: 1 })
    
    // 自动刷新数据
    get().fetchHistories(1)
  },

  selectHistory: (id: string | null) => {
    set({ selectedHistoryId: id })
  },

  toggleCompare: (id: string) => {
    const compareIds = get().compareHistoryIds
    
    if (compareIds.includes(id)) {
      // 如果已经选中，移除
      set({ compareHistoryIds: compareIds.filter((cid) => cid !== id) })
    } else {
      // 如果未选中，添加（最多选2条）
      if (compareIds.length < 2) {
        set({ compareHistoryIds: [...compareIds, id] })
      } else {
        // 如果已满2条，替换第一条
        set({ compareHistoryIds: [compareIds[1], id] })
      }
    }
  },

  clearCompare: () => {
    set({ compareHistoryIds: [] })
  },

  getCompareResult: async () => {
    const compareIds = get().compareHistoryIds
    
    if (compareIds.length !== 2) {
      return null
    }

    try {
      const history1 = await get().getHistoryById(compareIds[0])
      const history2 = await get().getHistoryById(compareIds[1])

      if (!history1 || !history2) {
        return null
      }

      // 计算差异
      const scoreDiff = history2.finalScore - history1.finalScore
      const timeDiff = history2.gradingTime - history1.gradingTime

      // 解析快照，比较变化
      const snapshot1 = JSON.parse(history1.criteriaSnapshot)
      const snapshot2 = JSON.parse(history2.criteriaSnapshot)

      const criteriaChanges: string[] = []
      
      // 比较评分标准变化（简化版）
      if (snapshot1.totalScore !== snapshot2.totalScore) {
        criteriaChanges.push(`满分变化: ${snapshot1.totalScore} → ${snapshot2.totalScore}`)
      }

      const result: HistoryCompareResult = {
        historyId1: compareIds[0],
        historyId2: compareIds[1],
        scoreDiff,
        timeDiff,
        details: {
          criteriaChanges,
          scoreChanges: [
            `分数差异: ${scoreDiff > 0 ? '+' : ''}${scoreDiff.toFixed(1)}`,
            `时间差异: ${timeDiff > 0 ? '+' : ''}${(timeDiff / 1000).toFixed(1)}秒`,
          ],
        },
      }

      return result
    } catch (error: any) {
      console.error('[GradingHistoryStore] 获取对比结果失败:', error)
      set({ error: error.message || '获取对比结果失败' })
      return null
    }
  },

  clearError: () => {
    set({ error: null })
  },
}))

// 导出初始化钩子，方便在组件中使用
export function useInitGradingHistory() {
  const initDatabase = useGradingHistoryStore((state) => state.initDatabase)
  const fetchHistories = useGradingHistoryStore((state) => state.fetchHistories)

  const initialize = async () => {
    await initDatabase()
    await fetchHistories()
  }

  return initialize
}
