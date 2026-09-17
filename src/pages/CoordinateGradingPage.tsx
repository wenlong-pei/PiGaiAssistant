import { useState, useRef, useEffect, useCallback } from 'react'
import {
  Play,
  Pause,
  Square,
  Target,
  FileText,
  CheckCircle,
  Clock,
  Award,
  Image,
  Zap,
  UserCheck,
  Bot,
  X,
  Send,
  Pencil,
  RotateCcw,
  Monitor,
  MousePointer,
  Save,
  Trash2,
  Plus
} from 'lucide-react'
import toast from 'react-hot-toast'
import { useStandardsStore } from '@/store/standardsStore'
import { useGradingStore, type LogEntry } from '@/store/gradingStore'
import {
  useRecordsStore,
  getRecordsPersistError,
  clearRecordsPersistError,
} from '@/store/recordsStore'
import { useSound } from '@/hooks/useSound'
import { gradingBotProxy } from '@/services/playwrightProxy'
import GradingLogs from '@/components/grading/GradingLogs'
import AiAnalysisPanel from '@/components/grading/AiAnalysisPanel'
import './CoordinateGradingPage.scss'
import type { GradingMode } from '@/types'

// 坐标配置接口
interface CoordinateConfig {
  id: string
  name: string
  // 答题区域坐标
  answerArea: { x: number; y: number; width: number; height: number }
  // 分数输入框坐标
  scoreInput: { x: number; y: number }
  // 提交按钮坐标
  submitButton: { x: number; y: number }
  // 下一张按钮坐标（可选）
  nextButton?: { x: number; y: number }
}

// 默认配置
const defaultConfigs: CoordinateConfig[] = [
  {
    id: 'default',
    name: '默认配置',
    answerArea: { x: 100, y: 200, width: 800, height: 600 },
    scoreInput: { x: 900, y: 300 },
    submitButton: { x: 900, y: 400 },
    nextButton: { x: 1000, y: 500 }
  }
]

// 从 localStorage 加载配置
const loadConfigs = (): CoordinateConfig[] => {
  try {
    const saved = localStorage.getItem('coordinateConfigs')
    if (saved) {
      const parsed = JSON.parse(saved)
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed
      }
    }
  } catch (e) {
    console.error('加载坐标配置失败:', e)
  }
  return defaultConfigs
}

// 保存配置到 localStorage
const saveConfigs = (configs: CoordinateConfig[]) => {
  try {
    localStorage.setItem('coordinateConfigs', JSON.stringify(configs))
  } catch (e) {
    console.error('保存坐标配置失败:', e)
  }
}

/** 提交后等待平台完成「提交 → 翻页 → 下一份图像加载」的时间。
 * 过短会导致下一份试卷图像尚未加载完成就开始识图批改。 */
const SUBMIT_SETTLE_DELAY_MS = 2000

/** 连续失败阈值（高-02）：任一环节连续失败达到该次数即自动暂停批改，
 * 避免坐标配错 / 页面未就绪时每 2 秒重截同一屏、无人值守下无限空转刷日志。 */
const MAX_CONSECUTIVE_FAILURES = 3

/**
 * 判定一次提交/点击是否被平台「显式确认成功」。
 *
 * 为什么需要它：主进程 bot:submit 目前是混合形态——校验失败返回 { success:false, error }，
 * 正常路径返回 boolean（下一轮会归一化为统一的 { success: boolean; error?: string }）。
 * 页面提交走的是坐标点击（bot:click-at）与 bot:submit 同类，都可能返回这种混合形态。
 *
 * 只有「显式成功」才算成功：true 或 { success:true }。
 * false / undefined / null / { error } / { success:false } 一律视为未确认，
 * 绝不能因为「没抛错」就误记为已批改（阻断-03：静默漏卷）。
 */
const isSubmitAcknowledged = (res: unknown): boolean => {
  if (res === true) return true
  if (res !== null && typeof res === 'object' && 'success' in res) {
    // 唯一的显式转型：兼容上面所述的双形态返回，不是用 any/@ts-ignore 掩盖类型问题
    return (res as { success?: unknown }).success === true
  }
  return false
}

/**
 * 把一次坐标动作（`clickAt` / `typeAt`）的**失败**结果翻译成可诊断文案。
 *
 * 配套用法：调用点必须用**显式白名单**判定成功（`res === true`），
 * 其余一切取值（`false` / `{ error }` / `undefined` / `null`）都视为失败，
 * 再由本函数渲染原因。这样「点击分数框 → 输入分数 → 点击提交」任一环节
 * 失败都会走到 `noteLoopFailure` + 暂停，**绝不进入提交与 completed 记录**
 * （P0：坐标落在视口外时旧实现返回 `false` 被静默忽略，分数没进输入框却照样报成功）。
 */
const describeCoordinateActionFailure = (res: unknown): string => {
  if (res !== null && typeof res === 'object' && 'error' in res) {
    return describeGradingError(String((res as { error?: unknown }).error))
  }
  if (res === false) return '主进程返回 false（动作未派发成功）'
  if (res === undefined || res === null) return '主进程未返回结果（页面可能已失效）'
  return `未确认成功（返回值类型：${typeof res}）`
}

/**
 * 错误翻译：把技术错误翻译为用户能看懂、且**能照着做**的提示。
 *
 * 注意 `GRADING_ERROR_FALLBACK` 是"没命中任何模式"的兜底文案。历史上它把原始错误
 * 完全吞掉，用户只看到「操作失败，请查看日志或重新尝试」，而日志里同样只有这句翻译
 * 结果——真实原因（QuotaExceededError）被彻底丢失，无法定位。
 * 因此：错误日志必须用 `describeGradingError()`（会带上原始错误），
 * 只有需要"纯友好文案"时才直接调用 `translateError()`。
 */
export const GRADING_ERROR_FALLBACK = '操作失败，请查看日志或重新尝试'

const STORAGE_QUOTA_HINT =
  '浏览器存储空间已满，批改记录无法保存；请到「记录」页清理历史记录后重试'

/** 错误翻译表：**越具体的模式越要放在前面**（匹配是 includes + 顺序遍历） */
const gradingErrorMap: Record<string, string> = {
  // ==== 存储 / 持久化（本次 bug 的真实原因）====
  'exceeded the quota': STORAGE_QUOTA_HINT,
  'QuotaExceeded': STORAGE_QUOTA_HINT,
  'NS_ERROR_DOM_QUOTA_REACHED': STORAGE_QUOTA_HINT,
  'setItem': STORAGE_QUOTA_HINT,
  'localStorage': STORAGE_QUOTA_HINT,
  "'Storage'": STORAGE_QUOTA_HINT,
  'SecurityError': '浏览器拒绝了本地存储访问（存储可能已被禁用），请检查系统存储权限',

  // ==== 渲染进程 ↔ 主进程 通信（提交/点击走 IPC）====
  'Error invoking remote method': '与主进程通信失败（自动化服务可能已退出），请重启浏览器后重试',
  'No handler registered': '主进程缺少对应能力（版本不匹配），请重新安装或更新到最新版本',
  'render frame was disposed': '批改页面已关闭，请重新连接浏览器',

  // ==== 浏览器 / 页面 ====
  'Target closed': '浏览器页面已关闭，请重新启动浏览器',
  'Target page': '浏览器页面已关闭，请重新启动浏览器',
  'browser has been closed': '浏览器已关闭，请重新连接',
  'Browser has been closed': '浏览器已关闭，请重新连接',
  'has been closed': '浏览器已关闭，请重新连接',
  'browserContext': '浏览器上下文已失效，请重新启动浏览器',
  'net::ERR_INTERNET_DISCONNECTED': '网络已断开，请检查网络连接',
  'net::ERR_CONNECTION': '网络连接失败，请检查网络',
  'ETIMEDOUT': '请求超时，请检查网络或稍后重试',
  'Timeout': '操作超时，请检查网络或页面状态后重试',
  'ECONNRESET': '连接被重置，请重试',
  'ENOTFOUND': '服务器地址未找到，请检查配置',

  // ==== 磁盘 / 内存 ====
  'ENOSPC': '磁盘空间不足，请清理磁盘后重试',
  'Array buffer allocation failed': '内存不足，请关闭其他程序后重试',

  // ==== AI 服务 ====
  // 注意：这里**不能用纯数字做 key**。JS 对象的整数型键会被枚举引擎排到最前面，
  // 于是 '500' 会抢在任何文本模式之前命中——例如 "Timeout 5000ms exceeded"
  // 会被误判成「服务器内部错误」。改成带上下文的写法，既能命中 axios 的
  // "Request failed with status code 500"，又不会误伤。
  'status code 401': 'API 认证失败，请检查 API Key 是否正确',
  'HTTP 401': 'API 认证失败，请检查 API Key 是否正确',
  'Unauthorized': 'API 认证失败，请检查 API Key 是否正确',
  'status code 403': 'API 权限不足，请检查账户状态',
  'HTTP 403': 'API 权限不足，请检查账户状态',
  'status code 429': 'API 请求过于频繁，请稍后重试',
  'HTTP 429': 'API 请求过于频繁，请稍后重试',
  'Too Many Requests': 'API 请求过于频繁，请稍后重试',
  'status code 500': '服务器内部错误，请稍后重试',
  'HTTP 500': '服务器内部错误，请稍后重试',
  'Internal Server Error': '服务器内部错误，请稍后重试',
  'status code 502': '网关错误，AI 服务暂时不可用',
  'HTTP 502': '网关错误，AI 服务暂时不可用',
  'Bad Gateway': '网关错误，AI 服务暂时不可用',
  'status code 503': 'AI 服务暂时不可用，请稍后重试',
  'HTTP 503': 'AI 服务暂时不可用，请稍后重试',
  'Service Unavailable': 'AI 服务暂时不可用，请稍后重试',
  '浏览器连接已断开': '浏览器连接已断开，请重新启动浏览器',
}

export function translateError(error: string): string {
  const raw = String(error ?? '')
  for (const [key, value] of Object.entries(gradingErrorMap)) {
    if (raw.includes(key)) return value
  }
  return GRADING_ERROR_FALLBACK
}

/** 是否是「存储配额/写入失败」类错误（用于追加"去记录页清理"的可行动建议） */
export function isStorageQuotaError(error: string): boolean {
  return /exceeded the quota|QuotaExceeded|setItem|localStorage|'Storage'|NS_ERROR_DOM_QUOTA_REACHED/i.test(
    String(error ?? '')
  )
}

/**
 * 生成「用户可读 + 可诊断」的错误描述。
 * 命中翻译表时只给友好文案；未命中时把原始错误（截断为单行 120 字符）附在后面，
 * 这样即使用户只截一张 toast 图，也能看到真实原因。
 */
export function describeGradingError(error: string): string {
  const raw = String(error ?? '')
  const friendly = translateError(raw)
  if (friendly !== GRADING_ERROR_FALLBACK) return friendly
  const snippet = raw.replace(/\s+/g, ' ').trim().slice(0, 120)
  if (!snippet) return friendly
  return `${friendly}（原始错误：${snippet}）`
}

/**
 * 不可恢复错误（致命）：出现这些错误说明浏览器 / 主进程已经不可用，
 * 继续循环只会在死页面上空转，因此必须结束本次会话并给出明确说明。
 *
 * 刻意**只**收录真正不可恢复的情况。以下都属于「可恢复」，绝不在此列：
 *  - 存储配额写入失败（接上容错存储后已不再抛）
 *  - 坐标点未命中 / 分数未写入输入框（暂停后人工处理即可）
 *  - 平台未确认提交（暂停后人工补录即可）
 * 这些走「单份隔离 + 自动暂停」，不应该把整个会话判成"批改中断"。
 */
const FATAL_GRADING_ERROR_PATTERNS = [
  'has been closed',
  'Target closed',
  'Target page',
  'browserContext',
  'browser has been closed',
  'Error invoking remote method',
  'No handler registered',
  'render frame was disposed',
  '浏览器连接已断开',
  '浏览器已关闭',
] as const

export function isFatalGradingError(error: string): boolean {
  const raw = String(error ?? '')
  return FATAL_GRADING_ERROR_PATTERNS.some((pattern) => raw.includes(pattern))
}

export default function CoordinateGradingPage() {
  const { standards, currentStandardId, setCurrentStandard } = useStandardsStore()
  const { playSuccess, playError, playClick } = useSound()

  // 从 gradingStore 获取持久化状态
  const gradingStore = useGradingStore()
  const {
    isRunning,
    isPaused,
    gradingMode,
    stats,
    previewImage,
    recognizedText,
    aiComment,
    showCorrection,
    correctionScore,
    correctionReason,
    countdown,
    setIsRunning,
    setIsPaused,
    setGradingMode,
    setBrowserConnected,
    setIsZhixuePage,
    setBrowserLaunched,
    updateStats,
    resetStats,
    setPreviewImage,
    setRecognizedText,
    setAiComment,
    setAiAnalysis,
    aiAnalysis,
    setShowCorrection,
    setCorrectionScore,
    setCorrectionReason,
    setWaitingConfirm,
    addCorrectionHistory,
    setCountdown,
    addLog: addLogToStore,
    currentPlatformName,
  } = gradingStore

  // 批改记录
  const { addRecord } = useRecordsStore()

  // 从 store 获取状态（用于页面切换保持）
  const waitingConfirm = gradingStore.waitingConfirm
  const correctionHistory = gradingStore.correctionHistory

  // 从 store 获取浏览器连接状态
  const browserLaunched = gradingStore.browserLaunched

  // 本地状态
  const [isConnecting, setIsConnecting] = useState(false)
  // 运行 / 暂停状态以 gradingStore 为唯一事实来源（不再用组件内 useRef）：
  // 批改主循环是脱离组件生命周期的长驻异步循环，切换页面再回来时组件会重新挂载、
  // useRef 会重置为 false —— 界面显示"未在批改"，而旧循环仍在后台点击平台，
  // 老师再点一次「开始批改」就会两个循环同时批改。用 store 既保留了跨页面状态，
  // 也让「停止」和测试清理能真正叫停循环。
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const confirmResolveRef = useRef<((score: number) => void) | null>(null)
  const countdownRef = useRef(0)
  const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const abortRef = useRef(false)  // 用于中断批改循环

  /**
   * 非关键副作用的「安全执行」包装（阻断-04）。
   *
   * 背景：皮老板反馈「试改模式确认提交后弹『批改中断: 操作失败，请查看日志或重新尝试』，
   * 但分数已正常生成」。根因是「保存批改记录」把整张 base64 截图写进 localStorage，
   * 配额耗尽时 setItem **同步**抛 QuotaExceededError，异常一路冒泡到批改主循环的 catch，
   * 被当成"批改中断"。
   *
   * 规则：保存记录 / 音效 / 进度持久化这类"锦上添花"的副作用，失败只能降级为一条
   * warning 日志，**绝不允许**冒泡成"批改中断"；核心业务（AI 判分、平台提交确认）
   * 依然保持原语义抛错。
   *
   * 注意：配额耗尽时所有 persisted store 的写入都会抛，连 addLog 自己也会抛，
   * 因此日志写入必须再包一层 try/catch，保证"报告失败"这件事本身不会失败。
   */
  const runSideEffect = useCallback((label: string, action: () => void): void => {
    try {
      action()
    } catch (error: any) {
      const raw = String(error?.message || error || '未知错误')
      try {
        addLogToStore(
          `[非致命] ${label}失败，已跳过并继续批改（原始错误：${raw}）`,
          'warning'
        )
      } catch (logError) {
        console.error(`[非致命] ${label}失败，且日志写入也失败:`, raw, logError)
      }
    }
  }, [addLogToStore])

  /** 持久化降级提示：记录已在内存里，但没能写盘（配额满），给出可行动建议 */
  const reportPersistDegradation = useCallback((): void => {
    const persistError = getRecordsPersistError()
    if (!persistError) return
    clearRecordsPersistError()
    try {
      addLogToStore(
        `批改记录已保留在本次会话中，但磁盘写入降级（${persistError}）；建议在「记录」页清理历史记录后重试`,
        'warning'
      )
    } catch (error) {
      console.error('[recordsStore] 持久化降级提示写入日志失败:', persistError, error)
    }
  }, [addLogToStore])

  /**
   * 跨页面导航状态保留：重新进入本页时，用 store 里的真实运行状态把界面接回来。
   *
   * 背景：批改主循环是脱离组件生命周期的长驻异步循环——切到「记录」/「设置」页
   * 并不会让它停止。而组件重新挂载时 `isRunning` 若按默认值渲染，界面会显示成
   * "未在批改"（大字「开始批改」按钮又冒出来），老师以为批改停了，
   * 再点一次就会触发双循环。这里以 store 为准恢复界面状态。
   */
  useEffect(() => {
    const { isRunning: stillRunning, isPaused: stillPaused } = useGradingStore.getState()
    if (stillRunning) {
      setIsRunning(true)
      setIsPaused(stillPaused)
    }
  }, [setIsRunning, setIsPaused])

  // 坐标配置状态（从 localStorage 加载）
  const [configs, setConfigs] = useState<CoordinateConfig[]>(loadConfigs)
  const [currentConfigId, setCurrentConfigId] = useState<string>(() => {
    const saved = localStorage.getItem('currentConfigId')
    return saved || 'default'
  })
  const [showConfigEditor, setShowConfigEditor] = useState(false)
  const [editingConfig, setEditingConfig] = useState<CoordinateConfig | null>(null)

  // 可视化选区状态
  const [fullPageImage, setFullPageImage] = useState<string | null>(null)
  const [showSelector, setShowSelector] = useState(false)
  const [selectingTarget, setSelectingTarget] = useState<'answerArea' | 'scoreInput' | 'submitButton' | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null)
  const [dragEnd, setDragEnd] = useState<{ x: number; y: number } | null>(null)
  const [imageNaturalSize, setImageNaturalSize] = useState({ width: 0, height: 0 })
  const selectorRef = useRef<HTMLDivElement>(null)

  // 坐标获取模式：手动框选 / 大模型自动识别
  const [coordMode, setCoordMode] = useState<'manual' | 'auto'>('manual')
  // 可交互坐标预览：拖拽编辑已有区域框
  const [dragRegion, setDragRegion] = useState<'answerArea' | 'scoreInput' | 'submitButton' | null>(null)
  const [dragMode, setDragMode] = useState<'move' | 'resize' | null>(null)
  const dragStartRef = useRef<{ mx: number; my: number; orig: any } | null>(null)

  const currentStandard = standards.find(s => s.id === currentStandardId)
  const currentConfig = configs.find(c => c.id === currentConfigId) || configs[0]

  // 修复：此前只接受 2 个参数，调用方传入的 verbose 标记被静默丢弃（且类型不匹配），
  // 导致"详细日志"开关对这一页失效。
  const addLog = (
    message: string,
    type: 'info' | 'success' | 'error' | 'warning' = 'info',
    verbose = false
  ) => {
    addLogToStore(message, type, verbose)
  }

  // 保存配置到 localStorage
  useEffect(() => {
    saveConfigs(configs)
    localStorage.setItem('currentConfigId', currentConfigId)
  }, [configs, currentConfigId])

  // 启动浏览器
  const handleConnect = async () => {
    if (!currentStandard) {
      toast.error('请先选择评分标准')
      return
    }

    playClick()
    setIsConnecting(true)

    try {
      if (!browserLaunched) {
        addLog('正在启动 Edge 浏览器...')
        const result = await gradingBotProxy.launchBrowser(false)
        if (!result.success) {
          throw new Error(result.error || '启动浏览器失败')
        }
        setBrowserLaunched(true)
        addLog('Edge 浏览器已启动', 'success')
        addLog(`请在 Edge 中登录${currentPlatformName || '批改平台'}，进入批改页面`, 'info')
      }
    } catch (error) {
      addLog(`启动失败: ${error}`, 'error')
      playError()
      toast.error('启动失败')
    } finally {
      setIsConnecting(false)
    }
  }

  // 截取全页面用于选区
  const handleCaptureForSelection = async () => {
    if (!browserLaunched) {
      toast.error('请先启动浏览器')
      return
    }
    playClick()
    addLog('正在截取 Edge 页面...')
    try {
      const image = await gradingBotProxy.captureFullPage()
      if (image) {
        setFullPageImage(image)
        setShowSelector(true)
        addLog('页面截图成功，请框选区域', 'success')
      } else {
        addLog('截图失败', 'error')
      }
    } catch (error) {
      addLog(`截图异常: ${error}`, 'error')
    }
  }

  // 自动获取坐标：截图整页发送给大模型，识别批改区/成绩区/提交区坐标
  const handleAutoRecognize = async () => {
    if (!browserLaunched) {
      toast.error('请先启动浏览器')
      return
    }
    playClick()
    setIsAnalyzing(true)
    addLog('正在截取页面并调用大模型识别区域坐标...')
    try {
      const image = await gradingBotProxy.captureFullPage()
      if (!image) {
        addLog('截图失败', 'error')
        setIsAnalyzing(false)
        return
      }
      const result = await gradingBotProxy.recognizeRegion(image)
      if (result && typeof result === 'object' && 'error' in result) {
        addLog(`自动识别失败: ${(result as any).error}`, 'error')
        toast.error((result as any).error || '自动识别失败')
        setIsAnalyzing(false)
        return
      }
      const region = result as Extract<typeof result, { answerArea: any }>
      setConfigs(prev => prev.map(c => {
        if (c.id !== currentConfigId) return c
        return {
          ...c,
          answerArea: region.answerArea,
          scoreInput: region.scoreInput,
          submitButton: region.submitButton,
          ...(region.nextButton ? { nextButton: region.nextButton } : {}),
        }
      }))
      setFullPageImage(image)
      setCoordMode('auto')
      setShowSelector(true)
      addLog('大模型已识别坐标，请在预览中拖拽微调后确认', 'success')
    } catch (error: any) {
      addLog(`自动识别异常: ${error?.message || error}`, 'error')
      toast.error('自动识别失败，可改用手动获取')
    } finally {
      setIsAnalyzing(false)
    }
  }

  // 开始框选某个目标
  const startSelectTarget = (target: 'answerArea' | 'scoreInput' | 'submitButton') => {
    setSelectingTarget(target)
    setDragStart(null)
    setDragEnd(null)
    addLog(`请框选${target === 'answerArea' ? '答题区域' : target === 'scoreInput' ? '分数输入框' : '提交按钮'}`)
  }

  // 图片加载时获取原始尺寸
  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget
    setImageNaturalSize({ width: img.naturalWidth, height: img.naturalHeight })
  }

  // 获取鼠标在图片上的实际坐标（考虑缩放）
  const getImageCoords = (e: React.MouseEvent): { x: number; y: number } | null => {
    if (!selectorRef.current || imageNaturalSize.width === 0) return null
    const rect = selectorRef.current.querySelector('img')!.getBoundingClientRect()
    const scaleX = imageNaturalSize.width / rect.width
    const scaleY = imageNaturalSize.height / rect.height
    return {
      x: Math.round((e.clientX - rect.left) * scaleX),
      y: Math.round((e.clientY - rect.top) * scaleY),
    }
  }

  // 鼠标按下开始拖拽
  const handleMouseDown = (e: React.MouseEvent) => {
    if (!selectingTarget) return
    const coords = getImageCoords(e)
    if (coords) {
      setIsDragging(true)
      setDragStart(coords)
      setDragEnd(coords)
    }
  }

  // 鼠标移动：框选新区域 或 拖拽编辑已有区域框
  const handleMouseMove = (e: React.MouseEvent) => {
    // 1) 框选新区域（手动模式）
    if (isDragging && selectingTarget) {
      const coords = getImageCoords(e)
      if (coords) setDragEnd(coords)
      return
    }
    // 2) 拖拽编辑已有区域框
    if (dragRegion && dragStartRef.current) {
      const coords = getImageCoords(e)
      if (!coords) return
      const dx = coords.x - dragStartRef.current.mx
      const dy = coords.y - dragStartRef.current.my
      const orig = dragStartRef.current.orig
      if (dragMode === 'move') {
        if (dragRegion === 'answerArea') {
          const moved = { x: Math.max(0, Math.round(orig.x + dx)), y: Math.max(0, Math.round(orig.y + dy)), width: orig.width, height: orig.height }
          setConfigs(prev => prev.map(c => c.id === currentConfigId ? { ...c, answerArea: moved } : c))
        } else {
          const moved = { x: Math.max(0, Math.round(orig.x + dx)), y: Math.max(0, Math.round(orig.y + dy)) }
          setConfigs(prev => prev.map(c => c.id === currentConfigId ? { ...c, [dragRegion]: moved } : c))
        }
      } else if (dragMode === 'resize' && dragRegion === 'answerArea') {
        const width = Math.max(10, Math.round(orig.width + dx))
        const height = Math.max(10, Math.round(orig.height + dy))
        setConfigs(prev => prev.map(c => c.id === currentConfigId ? { ...c, answerArea: { ...orig, width, height } } : c))
      }
    }
  }

  // 开始拖拽移动某个已配置区域框
  const handleRegionMouseDown = (e: React.MouseEvent, region: 'answerArea' | 'scoreInput' | 'submitButton') => {
    e.stopPropagation()
    const coords = getImageCoords(e)
    if (!coords) return
    setDragRegion(region)
    setDragMode('move')
    dragStartRef.current = { mx: coords.x, my: coords.y, orig: JSON.parse(JSON.stringify(currentConfig[region])) }
  }

  // 开始拖拽缩放批改区（右下角 handle）
  const handleResizeMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation()
    const coords = getImageCoords(e)
    if (!coords) return
    setDragRegion('answerArea')
    setDragMode('resize')
    dragStartRef.current = { mx: coords.x, my: coords.y, orig: JSON.parse(JSON.stringify(currentConfig.answerArea)) }
  }

  // 鼠标松开完成选区（或结束拖拽编辑）
  const handleMouseUp = () => {
    if (dragRegion) {
      setDragRegion(null)
      setDragMode(null)
      dragStartRef.current = null
      return
    }
    if (!isDragging || !dragStart || !dragEnd || !selectingTarget) return
    setIsDragging(false)

    const x = Math.min(dragStart.x, dragEnd.x)
    const y = Math.min(dragStart.y, dragEnd.y)
    const width = Math.abs(dragEnd.x - dragStart.x)
    const height = Math.abs(dragEnd.y - dragStart.y)

    if (width < 10 || height < 10) {
      addLog('选区太小，请重新框选', 'warning')
      return
    }

    // 更新配置
    const updatedConfig = { ...currentConfig }
    if (selectingTarget === 'answerArea') {
      updatedConfig.answerArea = { x, y, width, height }
    } else if (selectingTarget === 'scoreInput') {
      updatedConfig.scoreInput = { x: x + width / 2, y: y + height / 2 }
    } else if (selectingTarget === 'submitButton') {
      updatedConfig.submitButton = { x: x + width / 2, y: y + height / 2 }
    }

    setConfigs(configs.map(c => c.id === currentConfig.id ? updatedConfig : c))
    addLog(`${selectingTarget === 'answerArea' ? '答题区域' : selectingTarget === 'scoreInput' ? '分数输入框' : '提交按钮'}坐标已更新: (${x}, ${y}) ${width}x${height}`, 'success')
    setSelectingTarget(null)
    setDragStart(null)
    setDragEnd(null)
  }

  // 测试坐标截图
  const handleTestCapture = async () => {
    if (!browserLaunched) {
      toast.error('请先启动浏览器')
      return
    }

    playClick()
    addLog(`测试截图: 答题区域 (${currentConfig.answerArea.x}, ${currentConfig.answerArea.y}) ${currentConfig.answerArea.width}x${currentConfig.answerArea.height}`)

    try {
      const image = await gradingBotProxy.captureByCoordinate(
        currentConfig.answerArea.x,
        currentConfig.answerArea.y,
        currentConfig.answerArea.width,
        currentConfig.answerArea.height
      )

      if (image) {
        addLog(`截图成功 (${(image.length / 1024).toFixed(0)}KB)`, 'success')
        setPreviewImage(image)
      } else {
        addLog('截图失败，请检查坐标是否正确', 'error')
      }
    } catch (error) {
      addLog(`截图异常: ${error}`, 'error')
    }
  }

  // 倒计时
  const startCountdown = (seconds: number): Promise<boolean> => {
    return new Promise((resolve) => {
      countdownRef.current = seconds
      setCountdown(seconds)

      countdownTimerRef.current = setInterval(() => {
if (!useGradingStore.getState().isRunning || useGradingStore.getState().isPaused) {
          clearInterval(countdownTimerRef.current!)
          resolve(false)
          return
        }

        countdownRef.current--
        setCountdown(countdownRef.current)

        if (countdownRef.current <= 0) {
          clearInterval(countdownTimerRef.current!)
          resolve(true)
        }
      }, 1000)
    })
  }

  const cancelCountdown = () => {
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current)
      countdownTimerRef.current = null
    }
    setCountdown(0)
  }

  // 试改模式处理
  const handleCorrection = useCallback(async (_originalScore: number): Promise<number> => {
    return new Promise((resolve) => {
      confirmResolveRef.current = resolve
    })
  }, [])

  const submitCorrection = useCallback(async () => {
    const score = Number(correctionScore)
    const maxScore = currentStandard?.totalScore || 10
    if (!Number.isInteger(score) || score < 0) {
      toast.error('请输入整数分数')
      return
    }
    if (score > maxScore) {
      toast.error(`分数不能超过满分 ${maxScore} 分`)
      return
    }

    const originalScore = stats.currentScore
    const reason = correctionReason.trim() || '未填写原因'

    // 保存纠错历史
    addCorrectionHistory({
      originalScore,
      correctedScore: score,
      reason,
      text: recognizedText,
    })

    addLog(`提交纠错: ${originalScore}分 → ${score}分, 原因: ${reason}`, 'success')
    if (correctionReason.trim()) {
      addLog(`纠错原因已记录，将用于优化后续批改`, 'info')
    }
    playSuccess()
    confirmResolveRef.current?.(score)
  }, [correctionScore, correctionReason, stats.currentScore, recognizedText, addCorrectionHistory, addLog])

  const cancelCorrection = useCallback(() => {
    addLog('取消纠错，使用AI评分', 'info')
    confirmResolveRef.current?.(useGradingStore.getState().stats.currentScore || 0)
  }, [])

  const confirmTrialSubmit = useCallback(() => {
    addLog('教师确认，提交AI评分', 'success')
    playSuccess()
    confirmResolveRef.current?.(useGradingStore.getState().stats.currentScore || 0)
  }, [])

  // 开始自动批改
  const handleCapture = async () => {
    if (!browserLaunched) {
      toast.error('请先启动浏览器')
      return
    }
    if (!currentConfig) {
      toast.error('请先配置坐标')
      return
    }
    // 双循环守卫：批改循环是脱离组件生命周期的长驻异步循环（切到「记录」页再回来
    // 它仍在跑）。已有循环在运行时绝不能启动第二个——否则两个循环同时点击平台、
    // 互相覆盖分数，且日志会交错，表现为"分数填错/状态混乱"。
    if (useGradingStore.getState().isRunning) {
      toast.error('已有批改任务在运行，请先点击「停止」再重新开始')
      return
    }

    playClick()
    abortRef.current = false
    setIsRunning(true)
    setIsPaused(false)
    resetStats()
    setPreviewImage(null)
    setRecognizedText('')
    setAiComment('')
    setShowCorrection(false)
    setCorrectionScore('')
    setCorrectionReason('')
    setCountdown(0)
    setWaitingConfirm(false)

    // 启动进度持久化
    gradingStore.startGradingProgress(
      currentConfig?.id || '',
      currentStandard?.id || '',
      gradingMode
    )

    gradingBotProxy.setGradingStandard(currentStandard)

    const modeLabel = gradingMode === 'normal' ? '普通' : gradingMode === 'trial' ? '试改' : '无人值守'
    addLog(`开始${modeLabel}模式坐标批改...`)
    addLog(`使用配置: ${currentConfig.name}`)
    addLog(`答题区域: (${currentConfig.answerArea.x}, ${currentConfig.answerArea.y}) ${currentConfig.answerArea.width}x${currentConfig.answerArea.height}`)

    // 执行批改循环
    runGradingLoop()
  }

  const runGradingLoop = async () => {
    try {
      let consecutiveCount = 0
      // 连续失败计数（高-02）：任一环节失败都累加，成功提交一份后清零。
      // 达到阈值即自动暂停，而不是无限重试同一屏。
      let consecutiveFailures = 0
      // 致命错误：一旦置值表示浏览器 / 主进程已不可用，本次会话必须结束。
      // 与"批改中断"区分处理——它属于环境终结，不是用户可修复的操作失败。
      let fatalError: string | null = null
      const noteLoopFailure = (reason: string): void => {
        consecutiveFailures++
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          addLog(`连续 ${consecutiveFailures} 次失败，已自动暂停：${reason}`, 'error')
          addLog('请检查答题区坐标或页面状态，确认无误后点击「继续」恢复批改', 'warning')
          toast.error(`连续 ${consecutiveFailures} 次失败，已自动暂停，请检查答题区坐标或页面状态`)
          runSideEffect('播放提示音', () => playError())
          setIsPaused(true)
        }
      }

      /**
       * 落盘一份批改记录（实时保存）。
       *
       * 为什么做成统一出口：皮老板反馈「试改的卷子分数和答案并没有被保存」。
       * 旧实现只在「平台确认提交成功」这一条路径上写记录——提交一旦未被确认
       * （坐标点空、平台弹窗、页面切走），这份的分数与作答原文就彻底丢了，
       * 「记录」页里既找不到分数也找不到答案。
       *
       * 现在改为：**只要完成判分就写记录**，用 status 区分是否已落库平台：
       *  - completed：平台已确认提交，记录即最终结果
       *  - pending  ：已判分但未确认提交（坐标未命中 / 平台未确认），需人工补录
       * 两条路径都保留分数、满分、作答原文与打分依据，不会再丢数据。
       *
       * 注意：记录写入属于非关键副作用，必须走 runSideEffect —— 任何持久化异常
       * 都不允许冒泡成"批改中断"。
       */
      const savePaperRecord = (params: {
        score: number
        aiScore: number
        comment: string
        reasoning: string
        answerText: string
        answerImage: string
        maxScore: number
        isBlank: boolean
        status: 'completed' | 'pending'
      }): void => {
        const now = Date.now()
        runSideEffect('保存批改记录', () => {
          addRecord({
            studentId: `student_${now}`,
            studentName: `学生${now % 10000}`,
            questionNumber: currentStandard?.questionNumber || currentStandard?.name || '未知题目',
            standardId: currentStandard?.id || '',
            standardName: currentStandard?.name || '',
            answerImage: params.answerImage,
            ocrText: params.answerText,
            score: params.score,
            maxScore: params.maxScore,
            aiScore: params.aiScore,
            aiComment: params.comment,
            reasoning: params.reasoning,
            evaluationMode: 'ai',
            status: params.status,
            isBlank: params.isBlank,
            completedAt: new Date(now).toISOString(),
          })
        })
        reportPersistDegradation()
      }

      while (true) {
if (!useGradingStore.getState().isRunning) break
if (useGradingStore.getState().isPaused) {
          await new Promise(r => setTimeout(r, 500))
          continue
        }

        // ==== 单份隔离（本次修复核心）====
        // 一份试卷处理过程中的任何意外异常都只能影响这一份，绝不允许把整个批改会话带走。
// 旧实现：异常一路冒泡到外层 catch → toast「批改中断」→ finally 里 isRunning=false
        // → 会话在第 1 份之后直接死掉，用户看到的就是"改完一份就自动停止"。
        try {
          updateStats((prev) => ({ total: prev.total + 1 }))

          // 1. 坐标截图答题区域
          addLog('正在截图答题区域...', 'info', true)
          let image: string | null = null
          try {
            const captureResult = await gradingBotProxy.captureByCoordinate(
              currentConfig.answerArea.x,
              currentConfig.answerArea.y,
              currentConfig.answerArea.width,
              currentConfig.answerArea.height
            )
            // 检查是否返回了错误对象
            if (captureResult && typeof captureResult === 'object' && 'error' in captureResult) {
              const reason = `截图失败: ${describeGradingError((captureResult as any).error)}`
              addLog(reason, 'error')
              updateStats((prev) => ({ failed: prev.failed + 1 }))
              noteLoopFailure(reason)
              await new Promise(r => setTimeout(r, 2000))
              continue
            }
            image = captureResult
          } catch (captureError: any) {
            const errMsg = String(captureError?.message || captureError || '未知错误')
            addLog(`截图异常: ${describeGradingError(errMsg)}`, 'error')
          }

          if (!image) {
            addLog('截图失败，跳过本份', 'warning')
            updateStats((prev) => ({ failed: prev.failed + 1 }))
            noteLoopFailure('截图失败，未能获取答题区图像')
            await new Promise(r => setTimeout(r, 2000))
            continue
          }

          addLog(`截图成功 (${(image.length / 1024).toFixed(0)}KB)`, 'success', true)
          setPreviewImage(image)

          // 2. AI 评分：首选「图像直评」（视觉模型看图直接识别并评分）；
          //    失败 / 结果不可解析时自动回退「OCR + 文本评分」，并记录切换原因。
          addLog('正在图像直评...', 'info', true)
          let gradeResult: { score: number; comment: string; reasoning?: string; needsHumanReview?: boolean; errorTags?: string[]; rubricBreakdown?: Array<{ id: string; awarded: number }>; transcript?: string } = { score: 0, comment: '评分失败', needsHumanReview: true }
          let gradingPath: 'vision' | 'ocr' = 'vision'
          let ocrTextForRecord = ''

          let visionOutcome: { ok: boolean; result?: typeof gradeResult; reason?: string } | null = null
          try {
            visionOutcome = await gradingBotProxy.gradeWithImage(image, correctionHistory)
          } catch (err) {
            visionOutcome = { ok: false, reason: `图像直评异常：${err}` }
          }

          if (visionOutcome?.ok && visionOutcome.result) {
            gradeResult = visionOutcome.result
            addLog('图像直评完成（视觉模型直接读图评分）', 'success', true)
          } else {
            // ==== 回退：OCR + 文本评分 ====
            gradingPath = 'ocr'
            addLog(`图像直评不可用（${visionOutcome?.reason || '未知原因'}），自动切换 OCR 兜底`, 'warning')

            addLog('正在识别文字...', 'info', true)
            const ocrResult = await gradingBotProxy.recognizeText(image)

            if (ocrResult.error) {
              const reason = `OCR识别失败: ${describeGradingError(ocrResult.error)}`
              addLog(reason, 'error')
              updateStats((prev) => ({ failed: prev.failed + 1 }))
              noteLoopFailure(reason)
              await new Promise(r => setTimeout(r, 2000))
              continue
            }

            setRecognizedText(ocrResult.text)
            ocrTextForRecord = ocrResult.text

            // 空白卷检测
            if (ocrResult.isBlank) {
              addLog('检测到空白卷，打0分', 'warning')
              setAiComment('空白卷')

              // 空白卷 0 分同样必须先「点中分数框 → 0 写入成功」才允许提交：
              // 坐标落在视口外时旧实现返回的 false 被忽略，会直接去点提交，
              // 提交的是空值或上一份残留的分数（P0 静默错分的同一根因）。
              const blankClickAck = await gradingBotProxy.clickAt(currentConfig.scoreInput.x, currentConfig.scoreInput.y)
              if (blankClickAck !== true) {
                const reason = `空白卷：分数输入框未点中，已暂停等待人工核对（${describeCoordinateActionFailure(blankClickAck)}）`
                addLog(reason, 'error')
                updateStats((prev) => ({ failed: prev.failed + 1 }))
                noteLoopFailure(reason)
                toast.error('空白卷分数框未点中，已暂停，请人工核对')
                runSideEffect('播放提示音', () => playError())
                setIsPaused(true)
                await new Promise(r => setTimeout(r, 1500))
                continue
              }
              await new Promise(r => setTimeout(r, 200))
              const blankTypeAck = await gradingBotProxy.typeAt(currentConfig.scoreInput.x, currentConfig.scoreInput.y, '0')
              if (blankTypeAck !== true) {
                const reason = `空白卷：0 分未写入输入框，已暂停等待人工核对（${describeCoordinateActionFailure(blankTypeAck)}）`
                addLog(reason, 'error')
                updateStats((prev) => ({ failed: prev.failed + 1 }))
                noteLoopFailure(reason)
                toast.error('空白卷 0 分未写入，已暂停，请人工核对')
                runSideEffect('播放提示音', () => playError())
                setIsPaused(true)
                await new Promise(r => setTimeout(r, 1500))
                continue
              }

              await new Promise(r => setTimeout(r, 500))
              const blankSubmitAck = await gradingBotProxy.clickAt(currentConfig.submitButton.x, currentConfig.submitButton.y)
              // 空白卷提交同样必须确认落库（阻断-03）：clickAt 返回 false / { error } 时不得记 completed
              if (!isSubmitAcknowledged(blankSubmitAck)) {
                addLog('空白卷 0 分未被平台确认提交，已暂停等待人工核对', 'error')
                updateStats((prev) => ({ failed: prev.failed + 1 }))
                // 实时保存：空白卷也要留痕（0 分 + 空白标记），避免"这份到底改没改"说不清。
                // 此处早于 `const maxScore` 声明，故直接取标准总分。
                savePaperRecord({
                  score: 0,
                  aiScore: 0,
                  comment: '空白卷',
                  reasoning: '检测到空白卷，按 0 分处理；平台未确认提交，需人工补录',
                  answerText: ocrTextForRecord,
                  answerImage: image || '',
                  maxScore: currentStandard?.totalScore || 10,
                  isBlank: true,
                  status: 'pending',
                })
                toast.error('空白卷 0 分未落库（已存入记录待处理），已暂停，请人工核对')
                runSideEffect('播放提示音', () => playError())
                setIsPaused(true)
                await new Promise(r => setTimeout(r, 1500))
                continue
              }

              updateStats((prev) => ({ blank: prev.blank + 1, completed: prev.completed + 1, currentScore: 0 }))
              consecutiveCount++
              consecutiveFailures = 0
              // 实时保存：空白卷此前完全不写记录，导致统计里有"空白"，「记录」页却查不到这一份
              savePaperRecord({
                score: 0,
                aiScore: 0,
                comment: '空白卷',
                reasoning: '检测到空白卷，按 0 分处理并已提交',
                answerText: ocrTextForRecord,
                answerImage: image || '',
                // 此处早于 `const maxScore` 的声明（它在空白卷分支之后），
                // 不能引用那个块级变量，否则运行时命中 TDZ ReferenceError。
                maxScore: currentStandard?.totalScore || 10,
                isBlank: true,
                status: 'completed',
              })
              runSideEffect('播放提示音', () => playClick())

              await new Promise(r => setTimeout(r, 1500))
              continue
            }

            const maxRetries = gradingMode === 'unattended' ? 3 : 1
            let retryCount = 0
            while (retryCount < maxRetries) {
              try {
                gradeResult = await gradingBotProxy.gradeWithAI(ocrResult.text, correctionHistory)
                break
              } catch (err) {
                retryCount++
                if (retryCount >= maxRetries) {
                  addLog(`AI评分失败: ${err}`, 'error')
                  updateStats((prev) => ({ failed: prev.failed + 1 }))
                  // 阻断-02：本地降级出口必须带 needsHumanReview，绝不能用 0 分占位冒充 AI 判分
                  gradeResult = { score: 0, comment: '评分失败', needsHumanReview: true }
                  break
                }
                addLog(`评分失败，重试(${retryCount}/${maxRetries})...`, 'warning')
                await new Promise(r => setTimeout(r, 1000))
              }
            }
          }

          const finalScore = gradeResult.score
          const maxScore = currentStandard?.totalScore || 10
          const scorePercent = Math.round((finalScore / maxScore) * 100)
          updateStats({ currentScore: finalScore })
          setAiComment(gradeResult.comment)
          // 存储本份的评分分析，供界面展示"为什么打这个分"
          setAiAnalysis({
            breakdown: gradeResult.rubricBreakdown || [],
            errorTags: gradeResult.errorTags || [],
            reasoning: gradeResult.reasoning || '',
            needsHumanReview: gradeResult.needsHumanReview === true,
          })
          // 每份试卷的核心结果行（精简模式下也保留）
          addLog(`第 ${consecutiveCount + 1} 份 → ${finalScore}分 / ${maxScore}分 (${scorePercent}%) ${gradingPath === 'vision' ? '[图像直评]' : '[OCR兜底]'}`, 'success')

          // 5. 根据模式处理
          let submitScore = finalScore

          // 显式白名单（阻断-02）：只有「已确认无需人工复核」的判分结果才允许进入自动提交路径。
          // needsHumanReview === true 表示本次分数来自降级出口（解析失败 / 本地兜底 / 模型明确标注），
          // 绝不能用占位分数冒充 AI 判分自动上屏——无论普通 / 试改 / 无人值守模式，一律停在人工复核。
          const requiresHumanReview = gradeResult.needsHumanReview === true

          if (requiresHumanReview) {
            const modeLabel = gradingMode === 'normal' ? '普通' : gradingMode === 'trial' ? '试改' : '无人值守'
            addLog(`${modeLabel}模式：本次判分未由模型可靠完成（需人工复核），暂停自动提交，请教师确认`, 'warning')
            toast.error('本次判分需人工复核，已暂停自动提交')
            setWaitingConfirm(true)
            submitScore = await handleCorrection(finalScore)
            setWaitingConfirm(false)
if (!useGradingStore.getState().isRunning) {
              addLog('已停止批改，当前份未提交', 'warning')
              break
            }
          } else if (gradingMode === 'normal') {
            addLog('普通模式: 5秒后自动提交...', 'info', true)
            const shouldSubmit = await startCountdown(5)
            if (!shouldSubmit) {
              // 修复 BUG-EXE-004：取消倒计时原为"静默放弃当前份并继续下一份"，
              // 改为暂停等待人工决策，当前份不提交、不跳过。
              addLog('已取消自动提交，当前份未提交，已暂停等待处理', 'warning')
              setIsPaused(true)
              await new Promise(r => setTimeout(r, 300))
              continue
            }
if (!useGradingStore.getState().isRunning) {
              addLog('已停止批改，当前份未提交', 'warning')
              break
            }
          } else if (gradingMode === 'trial') {
            addLog('试改模式: 等待教师确认...', 'warning')
            setWaitingConfirm(true)
            submitScore = await handleCorrection(finalScore)
            setWaitingConfirm(false)
if (!useGradingStore.getState().isRunning) {
              addLog('已停止批改，当前份未提交', 'warning')
              break
            }
          } else if (gradingMode === 'unattended') {
            // 无人值守仅在「已确认无需人工复核」时才允许自动提交；
            // 需要复核的分数在上面 requiresHumanReview 分支已被拦截。
            await new Promise(r => setTimeout(r, 1000))
          }

          // 提交前的最后可取消点（修复 BUG-EXE-003）：
          // 暂停/停止无法中断已发出的 AI 调用，因此在真正写分提交前再校验一次，
          // 已暂停/停止则丢弃本次结果、不提交，避免"想暂停但分数已提交"。
if (!useGradingStore.getState().isRunning) {
            addLog('已停止批改，当前份结果已丢弃、未提交', 'warning')
            break
          }
if (useGradingStore.getState().isPaused) {
            addLog('已暂停，当前份结果未提交；恢复后将重新处理该份', 'warning')
            continue
          }

          // 6. 输入分数并提交
          addLog(`输入分数: ${submitScore}分`, 'info', true)

          // 点击分数输入框
          // 显式白名单（P0 根因）：只有 `=== true` 才算成功。旧实现只检查 `{ error }`，
          // 于是坐标落在视口外时 `clickAt` 返回的 `false` 被静默忽略——分数没进输入框，
          // 程序却继续走去「点击提交 → 记 completed」，这就是"分数没填进智学网输入框"的静默错分。
          const clickResult1 = await gradingBotProxy.clickAt(currentConfig.scoreInput.x, currentConfig.scoreInput.y)
          if (clickResult1 !== true) {
            const reason = `点击分数输入框失败: ${describeCoordinateActionFailure(clickResult1)}`
            addLog(reason, 'error')
            updateStats((prev) => ({ failed: prev.failed + 1 }))
            noteLoopFailure(reason)
            setAiAnalysis({
              breakdown: gradeResult.rubricBreakdown || [],
              errorTags: gradeResult.errorTags || [],
              reasoning: gradeResult.reasoning || '',
              needsHumanReview: true,
            })
            addLog('当前份分数未输入，已暂停等待人工核对（不会计入已批改）', 'warning')
            toast.error('分数输入框未点中，已暂停，请人工核对')
            runSideEffect('播放提示音', () => playError())
            setIsPaused(true)
            await new Promise(r => setTimeout(r, 1500))
            continue
          }
          await new Promise(r => setTimeout(r, 200))
        
          // 输入分数
          // 显式白名单（P0 根因）：`typeAt` 失败（坐标越界 / 未聚焦输入框 / 回读不一致）
          // 必须判定为失败并暂停，绝不带着"分数其实没写进去"的状态去提交。
        const typeResult = await gradingBotProxy.typeAt(currentConfig.scoreInput.x, currentConfig.scoreInput.y, submitScore.toString())
        if (typeResult !== true) {
            const reason = `输入分数失败: ${describeCoordinateActionFailure(typeResult)}`
            addLog(reason, 'error')
            updateStats((prev) => ({ failed: prev.failed + 1 }))
            noteLoopFailure(reason)
            setAiAnalysis({
              breakdown: gradeResult.rubricBreakdown || [],
              errorTags: gradeResult.errorTags || [],
              reasoning: gradeResult.reasoning || '',
              needsHumanReview: true,
            })
            addLog('当前份分数未写入输入框，已暂停等待人工核对（不会计入已批改）', 'warning')
            toast.error(`${submitScore}分 未写入输入框，已暂停，请人工核对`)
            runSideEffect('播放提示音', () => playError())
            setIsPaused(true)
            await new Promise(r => setTimeout(r, 1500))
            continue
          }
          await new Promise(r => setTimeout(r, 300))
        
          // 点击提交按钮
          addLog('点击提交按钮...', 'info', true)
          const clickResult2 = await gradingBotProxy.clickAt(currentConfig.submitButton.x, currentConfig.submitButton.y)
          // 阻断-03：提交结果判定。只有显式成功（true / { success:true }）才记 completed，
          // 否则会落到下面的"已提交"分支，把未落库的分数记成已批改，导致静默漏卷。
          // 注意：clickAt 的类型是 `true | { error }`（CoordinateActionResult），
          // 旧代码里的 `=== false` 分支已不可能出现，会在编译期报 TS2367，因此统一走
          // describeCoordinateActionFailure 生成可诊断文案。
          if (!isSubmitAcknowledged(clickResult2)) {
            const platformError = describeCoordinateActionFailure(clickResult2)
            const reason = `提交失败: ${submitScore}分 未被平台确认（${platformError}）`
            addLog(reason, 'error')
            updateStats((prev) => ({ failed: prev.failed + 1 }))
            // 标记本份需人工复核：不计入 completed、不进入下一份
            setAiAnalysis({
              breakdown: gradeResult.rubricBreakdown || [],
              errorTags: gradeResult.errorTags || [],
              reasoning: gradeResult.reasoning || '',
              needsHumanReview: true,
            })
            // 实时保存（关键）：分数没落库不代表这份白改了——判分结果、作答原文、
            // 打分依据必须当场记下来（status=pending → 「记录」页显示"待处理"），
            // 否则老师要凭记忆回填，这就是"试改的卷子分数和答案没有被保存"。
            savePaperRecord({
              score: submitScore,
              aiScore: finalScore,
              comment: gradeResult.comment || '',
              reasoning: gradeResult.reasoning || '',
              answerText: gradeResult.transcript || ocrTextForRecord,
              answerImage: image || '',
              maxScore,
              isBlank: gradingPath === 'ocr' && !ocrTextForRecord.trim(),
              status: 'pending',
            })
            addLog('当前份提交未成功，已记入「记录」页（待处理）并暂停等待人工核对', 'warning')
            toast.error(`提交失败：${submitScore}分 未落库（已存入记录待处理），已暂停，请人工核对`)
            runSideEffect('播放提示音', () => playError())
            setIsPaused(true)
            await new Promise(r => setTimeout(r, 1500))
            continue
          }
        
          addLog(`已提交 ${submitScore}分`, 'success', true)
          updateStats((prev) => ({ completed: prev.completed + 1 }))
        
          // 保存批改记录（实时保存，非关键副作用：失败只降级告警，绝不打断批改循环）
          // 作答原文只允许取「本份」的数据：gradeResult.transcript（图像直评的逐字转录）
          // 或 ocrTextForRecord（本份 OCR 结果）。**不能**回退到 recognizedText ——
          // 它是跨份共享的组件状态（闭包捕获的还是启动那次渲染的值），会把上一份的答案
          // 记到这一份上，这正是"记录里答案不对/为空"的来源之一。
          const answerTextForRecord = gradeResult.transcript || ocrTextForRecord
          if (!answerTextForRecord.trim()) {
            addLog('本份未取得作答原文（模型未返回转录且未走 OCR），记录中答题内容为空', 'warning')
          }
          savePaperRecord({
            score: submitScore,
            aiScore: finalScore,
            comment: gradeResult.comment || '',
            reasoning: gradeResult.reasoning || '',
            answerText: answerTextForRecord,
            answerImage: image || '',
            maxScore,
            isBlank: gradingPath === 'ocr' && !ocrTextForRecord.trim(),
            status: 'completed',
          })
        
          consecutiveCount++
          consecutiveFailures = 0
          runSideEffect('播放提示音', () => playClick())

          // 更新进度持久化（非关键副作用：同样不允许打断批改）
          runSideEffect('保存批改进度', () => gradingStore.updateGradingProgress(consecutiveCount))

          // 7. 提交后等待平台完成「提交 → 翻页 → 下一份图像加载」。
          // 此前这里是 1500ms 固定等待 + 一段无用的预加载截图（该截图从未被使用，
          // 且时机在翻页完成之前，会拍到切换中的页面）——两处都已按操作节奏要求修正。
          await new Promise((r) => setTimeout(r, SUBMIT_SETTLE_DELAY_MS))
        } catch (paperError: any) {
          // 本份异常只记一次失败并继续；连续失败达阈值会自动暂停，而不是整场结束。
          // 只有浏览器 / 主进程确实不可用（致命错误）才结束会话，且用专门的文案说明。
          const rawPaperError = String(paperError?.message || paperError || '未知错误')
          try {
            addLogToStore(`本份处理异常，已跳过本份并继续: ${describeGradingError(rawPaperError)}`, 'error')
            addLogToStore(`原始错误: ${rawPaperError}`, 'error')
          } catch (logError) {
            console.error('[单份隔离] 日志写入失败:', rawPaperError, logError)
          }
          runSideEffect('统计失败次数', () => updateStats((prev) => ({ failed: prev.failed + 1 })))
          if (isFatalGradingError(rawPaperError)) {
            fatalError = rawPaperError
            break
          }
          noteLoopFailure(`本份处理异常: ${describeGradingError(rawPaperError)}`)
          await new Promise((r) => setTimeout(r, 2000))
          continue
        }
      }

      if (fatalError) {
        // 浏览器 / 页面已失效：这是「环境结束」，不是用户可修复的"操作失败"。
        // 单独给出可执行提示，避免和兜底文案"操作失败，请查看日志或重新尝试"混在一起。
        const friendly = translateError(fatalError)
        try {
          addLogToStore(`批改会话已结束: ${friendly}`, 'error')
          addLogToStore(`原始错误: ${fatalError}`, 'error')
        } catch (logError) {
          console.error('[批改结束] 日志写入失败:', fatalError, logError)
        }
        runSideEffect('播放提示音', () => playError())
        toast.error(`批改已结束（本次完成 ${consecutiveCount} 份）: ${friendly}`)
      } else if (consecutiveCount === 0) {
        // 一份都没完成：要么一上来就失败，要么老师在开跑后立刻点了「停止」。
        // 前者需要提示排查，后者只是正常取消——不能把"我主动停的"渲染成错误。
        if (consecutiveFailures > 0) {
          addLog('本次会话未完成任何一份批改，请检查坐标配置与页面状态', 'error')
          runSideEffect('播放提示音', () => playError())
          toast.error('本次未完成任何一份批改，请查看日志')
        } else {
          addLog('批改会话已取消，未处理任何一份', 'info')
          runSideEffect('播放提示音', () => playClick())
        }
      } else {
        // 正常收尾。**这是关键语义修正**：无论是"试改模式只改了一份就点停止"，
        // 还是普通模式跑完想跑的量，都属于预期结束，绝不能报"批改中断"。
        // 旧实现把所有非正常退出都渲染成中断，让皮老板误判成系统故障。
        addLog(`批改会话结束：本次共完成 ${consecutiveCount} 份`, 'success')
        runSideEffect('播放提示音', () => playSuccess())
        toast.success(`批改完成！共${consecutiveCount}份`)
      }
    } catch (error: any) {
      const errMsg = String(error?.message || error || '未知错误')
if (!useGradingStore.getState().isRunning) {
        // 老师已经点过「停止」，异常来自停止前在途的调用：属于预期结束，不是中断。
        const doneCount = useGradingStore.getState().stats.completed
        try {
          addLogToStore(
            `批改已停止（本次共完成 ${doneCount} 份）；停止过程中出现一次可忽略的异常：${errMsg}`,
            'warning'
          )
        } catch (logError) {
          console.error('[批改停止] 日志写入失败:', errMsg, logError)
        }
        toast.success(`批改已停止，本次共完成 ${doneCount} 份`)
        return
      }
      const friendly = translateError(errMsg)
      // 可诊断性（阻断-05）：界面引导用户"查看日志"，日志里就必须留下**原始错误**。
      // 旧实现只写翻译后的兜底文案，真实原因（QuotaExceededError）被彻底吞掉，
      // 用户和开发者都无从下手——本次 bug 的真正教训就在这里。
      try {
        addLogToStore(`批改中断: ${friendly}`, 'error')
        addLogToStore(`原始错误: ${errMsg}`, 'error')
        if (isStorageQuotaError(errMsg)) {
          addLogToStore(
            '存储空间不足：请在「记录」页清理历史记录后重试；本次已完成的分数不受影响',
            'warning'
          )
        }
      } catch (logError) {
        // 配额耗尽时 addLog 自身也可能抛错，绝不能让它把下面的 toast 一起吞掉
        console.error('[批改中断] 日志写入失败:', friendly, '|', errMsg, logError)
      }
      runSideEffect('播放提示音', () => playError())
      toast.error(`批改中断: ${friendly}`)
    } finally {
      cancelCountdown()
      setIsRunning(false)
      setIsPaused(false)
      setWaitingConfirm(false)
      setShowCorrection(false)
      // 标记批改进度已完成
      runSideEffect('保存批改进度', () => gradingStore.finishGradingProgress())
    }
  }

  const handlePause = () => {
    playClick()
const newPausedState = !useGradingStore.getState().isPaused
    setIsPaused(newPausedState)
    
    if (newPausedState) {
      addLog('已暂停批改')
    } else {
      addLog('继续批改...')
    }
  }

  const handleStop = () => {
    playClick()
    cancelCountdown()
    // 关键（死锁修复）：普通 / 试改模式会停在 `await handleCorrection()` 等教师确认。
    // 若不释放这个 Promise，循环会永远悬在那里——既走不到 break 收尾，也执行不到 finally；
    // 教师此时再点「开始批改」，就会出现"旧循环还挂着 + 新循环已启动"的双循环。
// 释放它，循环会在后续的 `if (!isRunning) break` 处干净收尾，且**不会**提交本份分数。
    confirmResolveRef.current?.(useGradingStore.getState().stats.currentScore || 0)
    confirmResolveRef.current = null
    setIsRunning(false)
    setIsPaused(false)
    setWaitingConfirm(false)
    setShowCorrection(false)
    addLog('已停止批改')
  }

  // 配置管理
  const handleAddConfig = () => {
    const newConfig: CoordinateConfig = {
      id: Date.now().toString(),
      name: '新配置',
      answerArea: { x: 100, y: 200, width: 800, height: 600 },
      scoreInput: { x: 900, y: 300 },
      submitButton: { x: 900, y: 400 },
      nextButton: { x: 1000, y: 500 }
    }
    setEditingConfig(newConfig)
    setShowConfigEditor(true)
  }

  const handleEditConfig = (config: CoordinateConfig) => {
    setEditingConfig({ ...config })
    setShowConfigEditor(true)
  }

  const handleSaveConfig = () => {
    if (!editingConfig) return
    
    if (editingConfig.id === 'default' || configs.find(c => c.id === editingConfig.id)) {
      // 更新现有配置
      setConfigs(configs.map(c => c.id === editingConfig.id ? editingConfig : c))
    } else {
      // 添加新配置
      setConfigs([...configs, editingConfig])
    }
    
    setShowConfigEditor(false)
    setEditingConfig(null)
    toast.success('配置已保存')
  }

  const handleDeleteConfig = (id: string) => {
    if (id === 'default') {
      toast.error('默认配置不能删除')
      return
    }
    setConfigs(configs.filter(c => c.id !== id))
    if (currentConfigId === id) {
      setCurrentConfigId('default')
    }
    toast.success('配置已删除')
  }

  const modeConfigs = [
    { key: 'normal' as GradingMode, icon: <Zap size={18} />, name: '普通模式', desc: 'AI评分后5秒自动提交' },
    { key: 'trial' as GradingMode, icon: <UserCheck size={18} />, name: '试改模式', desc: 'AI评分后等待教师确认' },
    { key: 'unattended' as GradingMode, icon: <Bot size={18} />, name: '无人值守', desc: '全自动连续批改' },
  ]

  return (
    <div className="coordinate-grading-page">
      <div className="page-header">
        <h1>
          <Target size={20} />
          试卷批改
        </h1>
        <p>坐标驱动批改 · 支持手动框选或大模型自动识别区域 · 自动评分与提交</p>
      </div>

      <div className="page-content">
        {/* 左侧面板 - 配置区 */}
        <div className="config-panel">
          {/* 浏览器连接 */}
          <div className="card">
            <div className="card-header">
              <Monitor size={16} />
              <h3>浏览器连接</h3>
            </div>
            <div className="card-body">
              <button
                className={`btn ${browserLaunched ? 'btn-success' : 'btn-primary'}`}
                onClick={handleConnect}
                disabled={isRunning || isConnecting || !currentStandard}
                style={{ width: '100%' }}
              >
                {isConnecting ? (
                  <><span className="spinner" />启动中...</>
                ) : browserLaunched ? (
                  <><CheckCircle size={16} />Edge 已启动</>
                ) : (
                  <><Monitor size={16} />启动 Edge 浏览器</>
                )}
              </button>
            </div>
          </div>

          {/* 坐标配置 */}
          <div className="card">
            <div className="card-header">
              <MousePointer size={16} />
              <h3>坐标配置</h3>
            </div>
            <div className="card-body">
              <div className="config-list">
                {configs.map(config => (
                  <div
                    key={config.id}
                    className={`config-item ${config.id === currentConfigId ? 'active' : ''}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => !isRunning && setCurrentConfigId(config.id)}
                    onKeyDown={(e) => { if (!isRunning && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setCurrentConfigId(config.id) } }}
                  >
                    <div className="config-name">{config.name}</div>
                    <div className="config-meta">
                      答题区: ({config.answerArea.x}, {config.answerArea.y})
                    </div>
                    {!isRunning && (
                      <div className="config-actions">
                        <button className="btn-icon" onClick={(e) => { e.stopPropagation(); handleEditConfig(config) }} aria-label={`编辑配置 ${config.name}`}>
                          <Pencil size={14} />
                        </button>
                        {config.id !== 'default' && (
                          <button className="btn-icon btn-danger" onClick={(e) => { e.stopPropagation(); handleDeleteConfig(config.id) }} aria-label={`删除配置 ${config.name}`}>
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <button className="btn btn-secondary" onClick={handleAddConfig} disabled={isRunning} style={{ width: '100%', marginTop: 8 }}>
                <Plus size={16} /> 添加配置
              </button>
              <div className="coord-mode-tabs">
                <button
                  className={`coord-tab ${coordMode === 'manual' ? 'active' : ''}`}
                  onClick={() => !isRunning && setCoordMode('manual')}
                  disabled={isRunning}
                >手动获取</button>
                <button
                  className={`coord-tab ${coordMode === 'auto' ? 'active' : ''}`}
                  onClick={() => !isRunning && setCoordMode('auto')}
                  disabled={isRunning}
                >自动获取</button>
              </div>
              {coordMode === 'manual' ? (
                <button className="btn btn-warning" onClick={handleCaptureForSelection} disabled={isRunning || !browserLaunched} style={{ width: '100%', marginTop: 8 }}>
                  <Target size={16} /> 截图选区（框选）
                </button>
              ) : (
                <button className="btn btn-primary" onClick={handleAutoRecognize} disabled={isRunning || !browserLaunched || isAnalyzing} style={{ width: '100%', marginTop: 8 }}>
                  <Bot size={16} /> {isAnalyzing ? '识别中...' : '自动识别坐标'}
                </button>
              )}
              <button className="btn btn-warning" onClick={handleTestCapture} disabled={isRunning || !browserLaunched} style={{ width: '100%', marginTop: 8 }}>
                <Image size={16} /> 测试截图
              </button>
            </div>
          </div>

          {/* 评分标准 */}
          <div className="card">
            <div className="card-header">
              <FileText size={16} />
              <h3>评分标准</h3>
            </div>
            <div className="card-body">
              {standards.length === 0 ? (
                <div className="empty-tip">
                  <p>暂无评分标准</p>
                  <a href="#/standards">去创建</a>
                </div>
              ) : (
                <div className="standards-list">
                  {standards.map(s => (
                    <div
                      key={s.id}
                      className={`standard-item ${s.id === currentStandardId ? 'active' : ''}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => !isRunning && setCurrentStandard(s.id)}
                      onKeyDown={(e) => { if (!isRunning && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setCurrentStandard(s.id) } }}
                    >
                      <div className="standard-name">{s.name}</div>
                      <div className="standard-meta">
                        {s.questionNumber && <span className="tag">{s.questionNumber}</span>}
                        <span>满分{s.totalScore}分</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* 批改模式 */}
          <div className="card">
            <div className="card-header">
              <Award size={16} />
              <h3>批改模式</h3>
            </div>
            <div className="card-body">
              <div className="mode-list">
                {modeConfigs.map(mode => (
                  <div
                    key={mode.key}
                    className={`mode-item ${gradingMode === mode.key ? 'active' : ''}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => !isRunning && setGradingMode(mode.key)}
                    onKeyDown={(e) => { if (!isRunning && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setGradingMode(mode.key) } }}
                  >
                    <div className="mode-icon">{mode.icon}</div>
                    <div className="mode-info">
                      <div className="mode-name">{mode.name}</div>
                      <div className="mode-desc">{mode.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* 控制按钮 */}
          <div className="card">
            <div className="card-header">
              <Send size={16} />
              <h3>开始批改</h3>
            </div>
            <div className="card-body">
              {!isRunning ? (
                <button
                  className="btn btn-primary btn-large"
                  onClick={handleCapture}
                  disabled={!browserLaunched || !currentConfig || !currentStandard}
                  style={{ width: '100%' }}
                >
                  <Play size={20} />
                  开始批改
                </button>
              ) : (
                <div className="control-buttons">
                  <button className={`btn ${isPaused ? 'btn-primary' : 'btn-warning'}`} onClick={handlePause}>
                    {isPaused ? <><Play size={16} /> 继续</> : <><Pause size={16} /> 暂停</>}
                  </button>
                  <button className="btn btn-danger" onClick={handleStop}>
                    <Square size={16} /> 停止
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 中间区域 - 主操作区 */}
        <div className="main-panel">
          {/* 答题图片预览 */}
          <div className="card preview-card">
            <div className="card-header">
              <Image size={16} />
              <h3>答题区域截图</h3>
            </div>
            <div className="card-body">
              {previewImage ? (
                <img src={previewImage} alt="答题预览" className="preview-img" />
              ) : (
                <div className="preview-placeholder">
                  <Image size={48} />
                  <p>点击"测试截图"或"开始批改"查看截图</p>
                </div>
              )}
            </div>
          </div>

          {/* AI 评分结果 */}
          {isRunning && (stats.currentScore > 0 || aiAnalysis.reasoning || aiAnalysis.needsHumanReview || aiComment) && (
            <div className="ai-result">
              <div className="score-display">
                <div className="score-number">{stats.currentScore}</div>
                <div className="score-label">AI 评分</div>
              </div>
              {aiComment && <div className="ai-comment">{aiComment}</div>}
              <AiAnalysisPanel analysis={aiAnalysis} scoringRules={currentStandard?.scoringRules} />
            </div>
          )}

          {/* 倒计时 */}
          {isRunning && gradingMode === 'normal' && countdown > 0 && (
            <div className="countdown-wrapper">
              <div className="countdown-header">
                <span className="countdown-text"><Clock size={14} /> 自动提交倒计时</span>
                <span className="countdown-seconds">{countdown}s</span>
              </div>
              <div className="countdown-bar-bg">
                <div className="countdown-bar" style={{ width: `${(countdown / 5) * 100}%` }} />
              </div>
            </div>
          )}

          {/* 试改模式确认面板 */}
          {waitingConfirm && !showCorrection && (
            <div className="correction-panel">
              <div className="correction-header">
                <h4><UserCheck size={16} /> 请确认AI评分</h4>
              </div>
              <div className="correction-body">
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>
                  AI 评分为 <strong style={{ color: 'var(--info-500)', fontSize: 18 }}>{stats.currentScore}</strong> 分
                </div>
                <div className="correction-actions">
                  <button className="btn btn-secondary" onClick={() => setShowCorrection(true)}>
                    <Pencil size={14} /> 分数纠错
                  </button>
                  <button className="btn btn-primary" onClick={confirmTrialSubmit}>
                    <CheckCircle size={14} /> 确认提交
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 分数纠错面板 */}
          {showCorrection && (
            <div className="correction-panel">
              <div className="correction-header">
                <h4><Pencil size={16} /> 分数纠错</h4>
                <button className="btn-close" onClick={cancelCorrection}><X size={16} /></button>
              </div>
              <div className="correction-body">
                <input
                  type="number"
                  value={correctionScore}
                  onChange={(e) => setCorrectionScore(e.target.value)}
                  placeholder="输入正确分数"
                  className="correction-input"
                  min="0"
                />
                <textarea
                  value={correctionReason}
                  onChange={(e) => setCorrectionReason(e.target.value)}
                  placeholder="输入纠错原因（如：AI误判了某个要点），用于优化后续批改"
                  className="correction-textarea"
                  rows={3}
                />
                <button className="btn btn-primary" onClick={submitCorrection}>
                  <Send size={14} /> 提交纠错
                </button>
              </div>
            </div>
          )}

          {/* 识别内容 */}
          {recognizedText && (
            <div className="card">
              <div className="card-header">
                <FileText size={16} />
                <h3>识别内容</h3>
              </div>
              <div className="card-body">
                <pre className="recognized-text">{recognizedText}</pre>
              </div>
            </div>
          )}
        </div>

        {/* 右侧面板 - 信息区 */}
        <div className="info-panel">
          {/* 统计数据 */}
          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-value">{stats.completed}</div>
              <div className="stat-label">已批改</div>
            </div>
            <div className="stat-card warning">
              <div className="stat-value">{stats.blank}</div>
              <div className="stat-label">空白卷</div>
            </div>
            <div className="stat-card error">
              <div className="stat-value">{stats.failed}</div>
              <div className="stat-label">失败</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{stats.total}</div>
              <div className="stat-label">已处理</div>
            </div>
          </div>

          {/* 当前分数 */}
          {stats.currentScore > 0 && (
            <div className="current-score">
              <span>当前得分</span>
              <strong>{stats.currentScore}</strong>
            </div>
          )}

          {/* 运行日志 */}
          <GradingLogs />
        </div>
      </div>

      {/* 可视化选区弹窗 */}
      {showSelector && fullPageImage && (
        <div className="modal-overlay" onClick={() => setShowSelector(false)}>
          <div className="selector-modal" onClick={(e) => e.stopPropagation()}>
            <div className="selector-header">
              <h3><Target size={18} /> {coordMode === 'auto' ? '坐标预览与微调' : '截图选区'} - 拖拽调整各区域边界框</h3>
              <button className="btn-close" onClick={() => setShowSelector(false)}><X size={18} /></button>
            </div>
            <div className="selector-toolbar">
              <span className="selector-mode-hint">
                {coordMode === 'auto' ? '已自动识别，可拖拽微调至准确位置' : '手动模式：先选区域再在图上框选'}
              </span>
              <button 
                className={`btn ${selectingTarget === 'answerArea' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => startSelectTarget('answerArea')}
              >
                <FileText size={16} /> 框选答题区域
              </button>
              <button 
                className={`btn ${selectingTarget === 'scoreInput' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => startSelectTarget('scoreInput')}
              >
                <Pencil size={16} /> 框选分数输入框
              </button>
              <button 
                className={`btn ${selectingTarget === 'submitButton' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => startSelectTarget('submitButton')}
              >
                <CheckCircle size={16} /> 框选提交按钮
              </button>
              <button className="btn btn-secondary" onClick={handleCaptureForSelection}>
                <RotateCcw size={16} /> 重新截图
              </button>
            </div>
            <div 
              className="selector-canvas"
              ref={selectorRef}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
            >
              <img src={fullPageImage} alt="Edge页面截图" onLoad={handleImageLoad} draggable={false} />
              {/* 已配置的区域标记 */}
              {currentConfig && (
                <>
                  <div 
                    className="region-marker answer-area"
                    style={{
                      left: `${(currentConfig.answerArea.x / imageNaturalSize.width) * 100}%`,
                      top: `${(currentConfig.answerArea.y / imageNaturalSize.height) * 100}%`,
                      width: `${(currentConfig.answerArea.width / imageNaturalSize.width) * 100}%`,
                      height: `${(currentConfig.answerArea.height / imageNaturalSize.height) * 100}%`,
                    }}
                    onMouseDown={(e) => handleRegionMouseDown(e, 'answerArea')}
                  >
                    <span>答题区域</span>
                    <div className="resize-handle se" onMouseDown={handleResizeMouseDown} />
                  </div>
                  <div 
                    className="region-marker point-marker score-input"
                    style={{
                      left: `${(currentConfig.scoreInput.x / imageNaturalSize.width) * 100}%`,
                      top: `${(currentConfig.scoreInput.y / imageNaturalSize.height) * 100}%`,
                    }}
                    onMouseDown={(e) => handleRegionMouseDown(e, 'scoreInput')}
                  >
                    <span>分数框</span>
                  </div>
                  <div 
                    className="region-marker point-marker submit-button"
                    style={{
                      left: `${(currentConfig.submitButton.x / imageNaturalSize.width) * 100}%`,
                      top: `${(currentConfig.submitButton.y / imageNaturalSize.height) * 100}%`,
                    }}
                    onMouseDown={(e) => handleRegionMouseDown(e, 'submitButton')}
                  >
                    <span>提交</span>
                  </div>
                </>
              )}
              {/* 当前拖拽选区 */}
              {isDragging && dragStart && dragEnd && (
                <div 
                  className="drag-selection"
                  style={{
                    left: `${(Math.min(dragStart.x, dragEnd.x) / imageNaturalSize.width) * 100}%`,
                    top: `${(Math.min(dragStart.y, dragEnd.y) / imageNaturalSize.height) * 100}%`,
                    width: `${(Math.abs(dragEnd.x - dragStart.x) / imageNaturalSize.width) * 100}%`,
                    height: `${(Math.abs(dragEnd.y - dragStart.y) / imageNaturalSize.height) * 100}%`,
                  }}
                />
              )}
              {/* 坐标提示 */}
              {selectingTarget && (
                <div className="select-hint">
                  请在截图上拖拽框选{selectingTarget === 'answerArea' ? '答题区域' : selectingTarget === 'scoreInput' ? '分数输入框' : '提交按钮'}
                </div>
              )}
            </div>
            <div className="selector-footer">
              <div className="coord-info">
                答题区: ({currentConfig.answerArea.x}, {currentConfig.answerArea.y}) {currentConfig.answerArea.width}×{currentConfig.answerArea.height}
                &nbsp;|&nbsp; 分数框: ({currentConfig.scoreInput.x}, {currentConfig.scoreInput.y})
                &nbsp;|&nbsp; 提交: ({currentConfig.submitButton.x}, {currentConfig.submitButton.y})
              </div>
              <button className="btn btn-primary" onClick={() => setShowSelector(false)}>
                <CheckCircle size={16} /> 完成坐标设置
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 配置编辑器弹窗 */}
      {showConfigEditor && editingConfig && (
        <div className="modal-overlay" onClick={() => setShowConfigEditor(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3><MousePointer size={18} /> 编辑坐标配置</h3>
              <button className="btn-close" onClick={() => setShowConfigEditor(false)}><X size={18} /></button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>配置名称</label>
                <input
                  type="text"
                  value={editingConfig.name}
                  onChange={(e) => setEditingConfig({ ...editingConfig, name: e.target.value })}
                  placeholder="输入配置名称"
                />
              </div>
              
              <div className="form-section">
                <h4>答题区域（截图区域）</h4>
                <div className="form-row">
                  <div className="form-group">
                    <label>X 坐标</label>
                    <input type="number" value={editingConfig.answerArea.x} onChange={(e) => setEditingConfig({ ...editingConfig, answerArea: { ...editingConfig.answerArea, x: Number(e.target.value) } })} />
                  </div>
                  <div className="form-group">
                    <label>Y 坐标</label>
                    <input type="number" value={editingConfig.answerArea.y} onChange={(e) => setEditingConfig({ ...editingConfig, answerArea: { ...editingConfig.answerArea, y: Number(e.target.value) } })} />
                  </div>
                  <div className="form-group">
                    <label>宽度</label>
                    <input type="number" value={editingConfig.answerArea.width} onChange={(e) => setEditingConfig({ ...editingConfig, answerArea: { ...editingConfig.answerArea, width: Number(e.target.value) } })} />
                  </div>
                  <div className="form-group">
                    <label>高度</label>
                    <input type="number" value={editingConfig.answerArea.height} onChange={(e) => setEditingConfig({ ...editingConfig, answerArea: { ...editingConfig.answerArea, height: Number(e.target.value) } })} />
                  </div>
                </div>
              </div>

              <div className="form-section">
                <h4>分数输入框位置</h4>
                <div className="form-row">
                  <div className="form-group">
                    <label>X 坐标</label>
                    <input type="number" value={editingConfig.scoreInput.x} onChange={(e) => setEditingConfig({ ...editingConfig, scoreInput: { ...editingConfig.scoreInput, x: Number(e.target.value) } })} />
                  </div>
                  <div className="form-group">
                    <label>Y 坐标</label>
                    <input type="number" value={editingConfig.scoreInput.y} onChange={(e) => setEditingConfig({ ...editingConfig, scoreInput: { ...editingConfig.scoreInput, y: Number(e.target.value) } })} />
                  </div>
                </div>
              </div>

              <div className="form-section">
                <h4>提交按钮位置</h4>
                <div className="form-row">
                  <div className="form-group">
                    <label>X 坐标</label>
                    <input type="number" value={editingConfig.submitButton.x} onChange={(e) => setEditingConfig({ ...editingConfig, submitButton: { ...editingConfig.submitButton, x: Number(e.target.value) } })} />
                  </div>
                  <div className="form-group">
                    <label>Y 坐标</label>
                    <input type="number" value={editingConfig.submitButton.y} onChange={(e) => setEditingConfig({ ...editingConfig, submitButton: { ...editingConfig.submitButton, y: Number(e.target.value) } })} />
                  </div>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowConfigEditor(false)}>取消</button>
              <button className="btn btn-primary" onClick={handleSaveConfig}>
                <Save size={16} /> 保存配置
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
