import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { GradingMode } from '@/types'
import { createResilientPersistStorage } from './resilientStorage'

/**
 * 日志级别枚举
 */
export type LogLevel = 'info' | 'success' | 'warning' | 'error'

/**
 * 结构化日志条目接口
 */
export interface LogEntry {
  time: string      // ISO 时间戳
  level: LogLevel   // 日志级别
  message: string   // 日志消息
  verbose?: boolean // 是否为冗长步骤日志（精简模式下隐藏）
}

interface GradingState {
  // 页面状态
  url: string
  isRunning: boolean
  isPaused: boolean
  gradingMode: GradingMode
  
  // 浏览器连接状态（跨页面持久化）
  browserConnected: boolean
  isZhixuePage: boolean
  browserLaunched: boolean
  
  // 日志（跨页面保持）- 改为结构化日志
  logs: LogEntry[]
  
  // 日志过滤状态
  logFilterLevel: LogLevel | 'all'
  logSearchKeyword: string
  logCompact: boolean   // 精简模式：隐藏冗长步骤日志（默认开启）
  
  // 批改进度
  stats: {
    total: number
    completed: number
    blank: number
    failed: number
    currentScore: number
  }
  
  // 批改时间记录（用于计算速度和估算剩余时间）
  startTime: number | null           // 批改开始时间戳
  recentTimes: number[]             // 最近批改时间数组（毫秒）
  fastestTime: number | null        // 最快批改时间（毫秒）
  slowestTime: number | null       // 最慢批改时间（毫秒）
  
  // 当前批改内容
  previewImage: string | null
  recognizedText: string
  aiComment: string

  // 当前份的 AI 评分分析（为什么打这个分）
  aiAnalysis: {
    breakdown: Array<{ id: string; awarded: number }>
    errorTags: string[]
    // 评分依据：无论得分多少都会有的文字说明
    reasoning: string
    // 人工复核标记：AI 未能可靠判分（解析失败/输入无效/本地降级）时为 true
    needsHumanReview: boolean
  }

  // 分数纠错
  showCorrection: boolean
  correctionScore: string
  correctionReason: string
  
  // 试改模式等待确认
  waitingConfirm: boolean
  
  // 倒计时
  countdown: number
  
  // 纠错学习历史
  correctionHistory: Array<{
    originalScore: number
    correctedScore: number
    reason: string
    text: string
    timestamp: number
  }>
  
  // 当前平台信息
  currentPlatform: string
  currentPlatformName: string

  // 批改进度持久化（用于断点续传）
  gradingProgress: {
    isActive: boolean        // 是否有未完成的批改任务
    lastCompletedCount: number  // 最后完成的份数
    currentConfigId: string     // 当前使用的配置ID
    currentStandardId: string   // 当前使用的评分标准ID
    gradingMode: GradingMode    // 当前批改模式
    lastTimestamp: number       // 最后批改时间
  }
  
  // 操作方法
  setUrl: (url: string) => void
  setIsRunning: (isRunning: boolean) => void
  setIsPaused: (isPaused: boolean) => void
  setGradingMode: (mode: GradingMode) => void
  setBrowserConnected: (connected: boolean) => void
  setIsZhixuePage: (isZhixue: boolean) => void
  setBrowserLaunched: (launched: boolean) => void
  updateStats: (updates: Partial<GradingState['stats']> | ((stats: GradingState['stats']) => Partial<GradingState['stats']>)) => void
  resetStats: () => void
  setPreviewImage: (image: string | null) => void
  setRecognizedText: (text: string) => void
  setAiComment: (comment: string) => void
  setAiAnalysis: (analysis: { breakdown: Array<{ id: string; awarded: number }>; errorTags: string[]; reasoning?: string; needsHumanReview?: boolean }) => void
  setShowCorrection: (show: boolean) => void
  setCorrectionScore: (score: string) => void
  setCorrectionReason: (reason: string) => void
  setWaitingConfirm: (waiting: boolean) => void
  setCurrentPlatform: (platform: string, platformName: string) => void
  addCorrectionHistory: (item: { originalScore: number; correctedScore: number; reason: string; text: string }) => void
  clearCorrectionHistory: () => void
  setCountdown: (countdown: number) => void
  
  // 时间记录方法
  startGrading: () => void              // 开始批改，记录开始时间
  recordGradingTime: (time: number) => void  // 记录一次批改完成的时间
  finishGrading: () => void             // 结束批改
  getSpeed: () => number               // 获取批改速度（份/分钟）
  getEstimatedTimeRemaining: () => number | null  // 估算剩余时间（秒）
  getAverageTime: () => number | null  // 获取平均批改时间（秒）
  getElapsedTime: () => number | null  // 获取已用时间（秒）
  
  // 日志相关方法（更新）
  addLog: (message: string, level?: LogLevel, verbose?: boolean) => void
  clearLogs: () => void
  setLogFilterLevel: (level: LogLevel | 'all') => void
  setLogSearchKeyword: (keyword: string) => void
  setLogCompact: (compact: boolean) => void
  getFilteredLogs: () => LogEntry[]
  exportLogs: (format: 'txt' | 'json') => string
  
  // 进度持久化方法
  startGradingProgress: (configId: string, standardId: string, mode: GradingMode) => void
  updateGradingProgress: (completedCount: number) => void
  finishGradingProgress: () => void
  resetAll: () => void
}

const defaultStats = {
  total: 0,
  completed: 0,
  blank: 0,
  failed: 0,
  currentScore: 0,
}

const defaultProgress = {
  isActive: false,
  lastCompletedCount: 0,
  currentConfigId: '',
  currentStandardId: '',
  gradingMode: 'normal' as GradingMode,
  lastTimestamp: 0,
}

/**
 * 持久化载荷形状（`partialize` 的返回类型，供 `storage` 泛型对齐）。
 * 只包含需要落盘的字段：运行时状态（isRunning / waitingConfirm / previewImage ...）
 * 一律不持久化。
 */
interface PersistedGradingState {
  url: string
  gradingMode: GradingMode
  stats: GradingState['stats']
  logs: LogEntry[]
  logFilterLevel: LogLevel | 'all'
  logCompact: boolean
  gradingProgress: GradingState['gradingProgress']
  correctionHistory: GradingState['correctionHistory']
}

/**
 * 容错存储（8.5）：批改过程中每次 addLog / updateGradingProgress 都会触发一次
 * `localStorage.setItem`；配额被批改记录撑满时它**同步抛错**，异常会冒泡进批改主循环的
 * catch 被渲染成「批改中断」假故障。接上容错存储后，写不进去只会降级 + 记错误，绝不打断批改。
 */
const { storage: gradingStorage } = createResilientPersistStorage<PersistedGradingState>({
  label: 'gradingStore',
})

export const useGradingStore = create<GradingState>()(
  persist(
    (set, get) => ({
      // 初始状态
      url: '',
      isRunning: false,
      isPaused: false,
      gradingMode: 'normal',
      // 浏览器连接状态：每次应用启动都重置为 false
      // （主进程重启后浏览器实例已丢失，不能从 localStorage 恢复）
      browserConnected: false,
      isZhixuePage: false,
      browserLaunched: false,
      logs: [],
      logFilterLevel: 'all',
      logSearchKeyword: '',
      logCompact: true,
      stats: { ...defaultStats },
      // 初始化时间记录状态
      startTime: null,
      recentTimes: [],
      fastestTime: null,
      slowestTime: null,
      previewImage: null,
      recognizedText: '',
      aiComment: '',
      aiAnalysis: { breakdown: [], errorTags: [], reasoning: '', needsHumanReview: false },
      showCorrection: false,
      correctionScore: '',
      correctionReason: '',
      waitingConfirm: false,
      countdown: 0,
      correctionHistory: [],
      currentPlatform: '',
      currentPlatformName: '批改平台',
      gradingProgress: { ...defaultProgress },
      
      // 操作方法
      setUrl: (url) => set({ url }),
      setIsRunning: (isRunning) => set({ isRunning }),
      setIsPaused: (isPaused) => set({ isPaused }),
      setGradingMode: (gradingMode) => set({ gradingMode }),
      setBrowserConnected: (browserConnected) => set({ browserConnected }),
      setIsZhixuePage: (isZhixuePage) => set({ isZhixuePage }),
      setBrowserLaunched: (browserLaunched) => set({ browserLaunched }),
      updateStats: (updates) => set((state) => {
        const newUpdates = typeof updates === 'function' ? updates(state.stats) : updates
        return { stats: { ...state.stats, ...newUpdates } }
      }),
      resetStats: () => set({ stats: { ...defaultStats } }),
      setPreviewImage: (previewImage) => set({ previewImage }),
      setRecognizedText: (recognizedText) => set({ recognizedText }),
      setAiComment: (aiComment) => set({ aiComment }),
      setAiAnalysis: (analysis) => set({ aiAnalysis: { breakdown: analysis.breakdown, errorTags: analysis.errorTags, reasoning: analysis.reasoning || '', needsHumanReview: analysis.needsHumanReview === true } }),
      setShowCorrection: (showCorrection) => set({ showCorrection }),
      setCorrectionScore: (correctionScore) => set({ correctionScore }),
      setCorrectionReason: (correctionReason) => set({ correctionReason }),
      setWaitingConfirm: (waitingConfirm) => set({ waitingConfirm }),
      setCurrentPlatform: (currentPlatform, currentPlatformName) => set({ currentPlatform, currentPlatformName }),
      addCorrectionHistory: (item) => set((state) => ({
        correctionHistory: [...state.correctionHistory, { ...item, timestamp: Date.now() }].slice(-50)
      })),
      clearCorrectionHistory: () => set({ correctionHistory: [] }),
      setCountdown: (countdown) => set({ countdown }),
      
      // ============ 时间记录方法 ============
      
      /**
       * 开始批改 - 记录开始时间
       * 在批改开始时调用，初始化时间记录
       */
      startGrading: () => set({
        startTime: Date.now(),
        recentTimes: [],
        fastestTime: null,
        slowestTime: null,
      }),
      
      /**
       * 记录一次批改完成的时间
       * @param time 本次批改耗时（毫秒）
       */
      recordGradingTime: (time) => set((state) => {
        // 只保留最近 20 条记录用于计算速度
        const newRecentTimes = [...state.recentTimes, time].slice(-20)
        
        // 更新最快和最慢时间
        let newFastestTime = state.fastestTime
        let newSlowestTime = state.slowestTime
        
        if (newFastestTime === null || time < newFastestTime) {
          newFastestTime = time
        }
        if (newSlowestTime === null || time > newSlowestTime) {
          newSlowestTime = time
        }
        
        return {
          recentTimes: newRecentTimes,
          fastestTime: newFastestTime,
          slowestTime: newSlowestTime,
        }
      }),
      
      /**
       * 结束批改 - 清空时间记录
       */
      finishGrading: () => set({
        startTime: null,
        recentTimes: [],
        fastestTime: null,
        slowestTime: null,
      }),
      
      /**
       * 获取批改速度（份/分钟）
       * 基于最近 20 条记录的平均时间计算
       * @returns 速度（份/分钟），如果没有记录则返回 0
       */
      getSpeed: () => {
        const state = get()
        if (state.recentTimes.length === 0) return 0
        
        // 计算平均时间（毫秒）
        const avgTime = state.recentTimes.reduce((sum, t) => sum + t, 0) / state.recentTimes.length
        
        // 转换为份/分钟
        if (avgTime === 0) return 0
        return Math.round(60000 / avgTime * 10) / 10  // 保留1位小数
      },
      
      /**
       * 估算剩余时间（秒）
       * 基于最近平均速度计算完成剩余任务所需时间
       * @returns 剩余时间（秒），如果无法估算则返回 null
       */
      getEstimatedTimeRemaining: () => {
        const state = get()
        const remaining = state.stats.total - state.stats.completed
        
        if (remaining <= 0) return 0
        if (state.recentTimes.length === 0) return null
        
        // 计算平均时间（毫秒）
        const avgTime = state.recentTimes.reduce((sum, t) => sum + t, 0) / state.recentTimes.length
        
        // 转换为秒
        return Math.round(avgTime * remaining / 1000)
      },
      
      /**
       * 获取平均批改时间（秒）
       * @returns 平均时间（秒），如果没有记录则返回 null
       */
      getAverageTime: () => {
        const state = get()
        if (state.recentTimes.length === 0) return null
        
        const avgTime = state.recentTimes.reduce((sum, t) => sum + t, 0) / state.recentTimes.length
        return Math.round(avgTime / 1000 * 10) / 10  // 保留1位小数
      },
      
      /**
       * 获取已用时间（秒）
       * @returns 已用时间（秒），如果未开始则返回 null
       */
      getElapsedTime: () => {
        const state = get()
        if (state.startTime === null) return null
        
        return Math.round((Date.now() - state.startTime) / 1000)
      },
      
      // 添加结构化日志
      addLog: (message, level = 'info', verbose = false) => set((state) => {
        const newLog: LogEntry = {
          time: new Date().toISOString(),
          level,
          message,
          verbose
        }
        const newLogs = [...state.logs, newLog]
        // 限制日志数量，最多保留500条
        if (newLogs.length > 500) {
          return { logs: newLogs.slice(-500) }
        }
        return { logs: newLogs }
      }),
      
      // 清空日志
      clearLogs: () => set({ logs: [] }),
      
      // 设置日志过滤级别
      setLogFilterLevel: (level) => set({ logFilterLevel: level }),
      
      // 设置日志搜索关键词
      setLogSearchKeyword: (keyword) => set({ logSearchKeyword: keyword }),

      // 设置精简模式
      setLogCompact: (compact) => set({ logCompact: compact }),

      // 获取过滤后的日志
      getFilteredLogs: () => {
        const state = get()
        let filtered = state.logs

        // 精简模式：隐藏冗长步骤日志（verbose）
        if (state.logCompact) {
          filtered = filtered.filter(log => !log.verbose)
        }

        // 按级别过滤
        if (state.logFilterLevel !== 'all') {
          filtered = filtered.filter(log => log.level === state.logFilterLevel)
        }

        // 按关键词搜索
        if (state.logSearchKeyword.trim()) {
          const keyword = state.logSearchKeyword.toLowerCase()
          filtered = filtered.filter(log =>
            log.message.toLowerCase().includes(keyword) ||
            log.level.toLowerCase().includes(keyword)
          )
        }

        return filtered
      },
      
      // 导出日志
      exportLogs: (format) => {
        const state = get()
        const logs = state.logs
        
        if (format === 'json') {
          return JSON.stringify(logs, null, 2)
        } else {
          // TXT 格式
          return logs.map(log => {
            const time = new Date(log.time).toLocaleString('zh-CN', {
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit'
            })
            const levelTag = log.level.toUpperCase()
            return `[${time}] [${levelTag}] ${log.message}`
          }).join('\n')
        }
      },
      
      // 进度持久化方法
      startGradingProgress: (configId, standardId, mode) => set({
        gradingProgress: {
          isActive: true,
          lastCompletedCount: 0,
          currentConfigId: configId,
          currentStandardId: standardId,
          gradingMode: mode,
          lastTimestamp: Date.now(),
        }
      }),
      updateGradingProgress: (completedCount) => set((state) => ({
        gradingProgress: {
          ...state.gradingProgress,
          lastCompletedCount: completedCount,
          lastTimestamp: Date.now(),
        }
      })),
      finishGradingProgress: () => set({
        gradingProgress: { ...defaultProgress }
      }),
      resetAll: () => set({
        url: '',
        isRunning: false,
        isPaused: false,
        browserConnected: false,
        isZhixuePage: false,
        browserLaunched: false,
        stats: { ...defaultStats },
        startTime: null,
        recentTimes: [],
        fastestTime: null,
        slowestTime: null,
        previewImage: null,
        recognizedText: '',
        aiComment: '',
        aiAnalysis: { breakdown: [], errorTags: [], reasoning: '', needsHumanReview: false },
        showCorrection: false,
        correctionScore: '',
        correctionReason: '',
        waitingConfirm: false,
        countdown: 0,
        // 修复：resetAll 应清除 correctionHistory，避免重置后残留旧数据
        correctionHistory: [],
        gradingProgress: { ...defaultProgress },
      }),
    }),
    {
      name: 'grading-session',
      // 容错存储：写入失败（配额满）只降级 + 记错误，绝不抛回批改主循环
      storage: gradingStorage,
      // 恢复时重置浏览器连接状态（应用重启后浏览器实例已丢失）
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.browserConnected = false
          state.isZhixuePage = false
          state.browserLaunched = false
        }
      },
      // 只持久化这些字段，运行时不持久化
      partialize: (state): PersistedGradingState => ({
        url: state.url,
        gradingMode: state.gradingMode,
        stats: state.stats,
        logs: state.logs.slice(-100), // 只持久化最近100条日志
        logFilterLevel: state.logFilterLevel,
        logCompact: state.logCompact,
        gradingProgress: state.gradingProgress,
        correctionHistory: state.correctionHistory,
        // 注意：browserConnected/isZhixuePage/browserLaunched 不持久化
        // 因为 Electron 主进程重启后浏览器实例已丢失
      }),
    }
  )
)
