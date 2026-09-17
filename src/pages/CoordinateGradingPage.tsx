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
import { useRecordsStore } from '@/store/recordsStore'
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
  const runningRef = useRef(false)
  const pausedRef = useRef(false)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const confirmResolveRef = useRef<((score: number) => void) | null>(null)
  const countdownRef = useRef(0)
  const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const abortRef = useRef(false)  // 用于中断批改循环

  // 错误翻译函数：将技术错误翻译为用户友好提示
  const translateError = useCallback((error: string): string => {
    const errorMap: Record<string, string> = {
      'Target closed': '浏览器页面已关闭，请重新启动浏览器',
      'browser has been closed': '浏览器已关闭，请重新连接',
      'net::ERR_INTERNET_DISCONNECTED': '网络已断开，请检查网络连接',
      'net::ERR_CONNECTION': '网络连接失败，请检查网络',
      'ETIMEDOUT': '请求超时，请检查网络或稍后重试',
      'ECONNRESET': '连接被重置，请重试',
      'ENOTFOUND': '服务器地址未找到，请检查配置',
      '401': 'API 认证失败，请检查 API Key 是否正确',
      '403': 'API 权限不足，请检查账户状态',
      '429': 'API 请求过于频繁，请稍后重试',
      '500': '服务器内部错误，请稍后重试',
      '502': '网关错误，AI 服务暂时不可用',
      '503': 'AI 服务暂时不可用，请稍后重试',
      '浏览器连接已断开': '浏览器连接已断开，请重新启动浏览器',
    }
    for (const [key, value] of Object.entries(errorMap)) {
      if (error.includes(key)) return value
    }
    return '操作失败，请查看日志或重新尝试'
  }, [])

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
        if (!runningRef.current || pausedRef.current) {
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

    playClick()
    runningRef.current = true
    pausedRef.current = false
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
      const noteLoopFailure = (reason: string): void => {
        consecutiveFailures++
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          addLog(`连续 ${consecutiveFailures} 次失败，已自动暂停：${reason}`, 'error')
          addLog('请检查答题区坐标或页面状态，确认无误后点击「继续」恢复批改', 'warning')
          toast.error(`连续 ${consecutiveFailures} 次失败，已自动暂停，请检查答题区坐标或页面状态`)
          playError()
          pausedRef.current = true
          setIsPaused(true)
        }
      }

      while (true) {
        if (!runningRef.current) break
        if (pausedRef.current) {
          await new Promise(r => setTimeout(r, 500))
          continue
        }

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
            const reason = `截图失败: ${translateError((captureResult as any).error)}`
            addLog(reason, 'error')
            updateStats((prev) => ({ failed: prev.failed + 1 }))
            noteLoopFailure(reason)
            await new Promise(r => setTimeout(r, 2000))
            continue
          }
          image = captureResult
        } catch (captureError: any) {
          const errMsg = String(captureError?.message || captureError || '未知错误')
          addLog(`截图异常: ${translateError(errMsg)}`, 'error')
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
            const reason = `OCR识别失败: ${translateError(ocrResult.error)}`
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

            await gradingBotProxy.clickAt(currentConfig.scoreInput.x, currentConfig.scoreInput.y)
            await new Promise(r => setTimeout(r, 200))
            await gradingBotProxy.typeAt(currentConfig.scoreInput.x, currentConfig.scoreInput.y, '0')

            await new Promise(r => setTimeout(r, 500))
            const blankSubmitAck = await gradingBotProxy.clickAt(currentConfig.submitButton.x, currentConfig.submitButton.y)
            // 空白卷提交同样必须确认落库（阻断-03）：clickAt 返回 false / { error } 时不得记 completed
            if (!isSubmitAcknowledged(blankSubmitAck)) {
              addLog('空白卷 0 分未被平台确认提交，已暂停等待人工核对', 'error')
              updateStats((prev) => ({ failed: prev.failed + 1 }))
              toast.error('空白卷 0 分未落库，已暂停，请人工核对')
              playError()
              pausedRef.current = true
              setIsPaused(true)
              await new Promise(r => setTimeout(r, 1500))
              continue
            }

            updateStats((prev) => ({ blank: prev.blank + 1, completed: prev.completed + 1, currentScore: 0 }))
            consecutiveCount++
            consecutiveFailures = 0
            playClick()

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
          if (!runningRef.current) {
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
            pausedRef.current = true
            setIsPaused(true)
            await new Promise(r => setTimeout(r, 300))
            continue
          }
          if (!runningRef.current) {
            addLog('已停止批改，当前份未提交', 'warning')
            break
          }
        } else if (gradingMode === 'trial') {
          addLog('试改模式: 等待教师确认...', 'warning')
          setWaitingConfirm(true)
          submitScore = await handleCorrection(finalScore)
          setWaitingConfirm(false)
          if (!runningRef.current) {
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
        if (!runningRef.current) {
          addLog('已停止批改，当前份结果已丢弃、未提交', 'warning')
          break
        }
        if (pausedRef.current) {
          addLog('已暂停，当前份结果未提交；恢复后将重新处理该份', 'warning')
          continue
        }

        // 6. 输入分数并提交
        addLog(`输入分数: ${submitScore}分`, 'info', true)

        // 点击分数输入框
        const clickResult1 = await gradingBotProxy.clickAt(currentConfig.scoreInput.x, currentConfig.scoreInput.y)
        if (clickResult1 && typeof clickResult1 === 'object' && 'error' in clickResult1) {
          const reason = `点击失败: ${translateError((clickResult1 as any).error)}`
          addLog(reason, 'error')
          updateStats((prev) => ({ failed: prev.failed + 1 }))
          noteLoopFailure(reason)
          await new Promise(r => setTimeout(r, 2000))
          continue
        }
        await new Promise(r => setTimeout(r, 200))
        
        // 输入分数
        const typeResult = await gradingBotProxy.typeAt(currentConfig.scoreInput.x, currentConfig.scoreInput.y, submitScore.toString())
        if (typeResult && typeof typeResult === 'object' && 'error' in typeResult) {
          const reason = `输入失败: ${translateError((typeResult as any).error)}`
          addLog(reason, 'error')
          updateStats((prev) => ({ failed: prev.failed + 1 }))
          noteLoopFailure(reason)
          await new Promise(r => setTimeout(r, 2000))
          continue
        }
        await new Promise(r => setTimeout(r, 300))
        
        // 点击提交按钮
        addLog('点击提交按钮...', 'info', true)
        const clickResult2 = await gradingBotProxy.clickAt(currentConfig.submitButton.x, currentConfig.submitButton.y)
        // 阻断-03：提交结果判定。此前只检查 { error }，clickAt 返回 false（页面失效/点击失败）
        // 时会落到下面的"已提交"分支，把未落库的分数记成 completed，导致静默漏卷。
        // 改为显式白名单：只有平台确认成功（true / { success:true }）才记 completed。
        if (!isSubmitAcknowledged(clickResult2)) {
          const platformError =
            clickResult2 && typeof clickResult2 === 'object' && 'error' in clickResult2
              ? translateError(String((clickResult2 as any).error))
              : clickResult2 === false
                ? '平台未确认（点击/提交返回 false）'
                : '平台未返回成功确认'
          const reason = `提交失败: ${submitScore}分 未被平台确认（${platformError}）`
          addLog(reason, 'error')
          updateStats((prev) => ({ failed: prev.failed + 1 }))
          // 标记本份需人工复核：不记 completed、不写"已批改"记录、不进入下一份
          setAiAnalysis({
            breakdown: gradeResult.rubricBreakdown || [],
            errorTags: gradeResult.errorTags || [],
            reasoning: gradeResult.reasoning || '',
            needsHumanReview: true,
          })
          addLog('当前份提交未成功，已暂停等待人工核对（不会计入已批改）', 'warning')
          toast.error(`提交失败：${submitScore}分 未落库，已暂停，请人工核对`)
          playError()
          pausedRef.current = true
          setIsPaused(true)
          await new Promise(r => setTimeout(r, 1500))
          continue
        }
        
        addLog(`已提交 ${submitScore}分`, 'success', true)
        updateStats((prev) => ({ completed: prev.completed + 1 }))
        
        // 保存批改记录
        addRecord({
          studentId: `student_${Date.now()}`,
          studentName: `学生${Date.now() % 10000}`,
          questionNumber: currentStandard?.questionNumber || currentStandard?.name || '未知题目',
          standardId: currentStandard?.id || '',
          standardName: currentStandard?.name || '',
          answerImage: image || '',
          // 图像直评时优先用模型逐字转录的作答原文（此前该路径记录里答题内容为空）
          ocrText: gradeResult.transcript || ocrTextForRecord || recognizedText,
          score: submitScore,
          maxScore: maxScore,
          aiScore: finalScore,
          aiComment: gradeResult.comment || '',
          reasoning: gradeResult.reasoning || '',
          evaluationMode: 'ai',
          status: 'completed',
          isBlank: gradingPath === 'ocr' && !ocrTextForRecord.trim(),
        })
        
        consecutiveCount++
        consecutiveFailures = 0
        playClick()

        // 更新进度持久化
        gradingStore.updateGradingProgress(consecutiveCount)

        // 7. 提交后等待平台完成「提交 → 翻页 → 下一份图像加载」。
        // 此前这里是 1500ms 固定等待 + 一段无用的预加载截图（该截图从未被使用，
        // 且时机在翻页完成之前，会拍到切换中的页面）——两处都已按操作节奏要求修正。
        await new Promise((r) => setTimeout(r, SUBMIT_SETTLE_DELAY_MS))
      }

      addLog(`批改完成！共${consecutiveCount}份`, 'success')
      playSuccess()
      toast.success(`批改完成！共${consecutiveCount}份`)
    } catch (error: any) {
      const errMsg = String(error?.message || error || '未知错误')
      addLog(`批改中断: ${translateError(errMsg)}`, 'error')
      playError()
      toast.error(`批改中断: ${translateError(errMsg)}`)
    } finally {
      runningRef.current = false
      pausedRef.current = false
      cancelCountdown()
      setIsRunning(false)
      setIsPaused(false)
      setWaitingConfirm(false)
      setShowCorrection(false)
      // 标记批改进度已完成
      gradingStore.finishGradingProgress()
    }
  }

  const handlePause = () => {
    playClick()
    const newPausedState = !pausedRef.current
    pausedRef.current = newPausedState
    setIsPaused(newPausedState)
    
    if (newPausedState) {
      addLog('已暂停批改')
    } else {
      addLog('继续批改...')
    }
  }

  const handleStop = () => {
    playClick()
    runningRef.current = false
    pausedRef.current = false
    cancelCountdown()
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
          <Target size={24} />
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

          {/* 进度条 */}
          {isRunning && stats.total > 0 && (
            <div className="progress-bar-container">
              <div className="progress-header">
                <span>批改进度</span>
                <span className="progress-percent">
                  {Math.round((stats.completed / stats.total) * 100)}%
                </span>
              </div>
              <div className="progress-track">
                <div 
                  className="progress-fill" 
                  style={{ width: `${Math.round((stats.completed / stats.total) * 100)}%` }}
                />
              </div>
              <div className="progress-legend">
                <div className="legend-item">
                  <span className="dot success" />
                  <span>成功 {stats.completed}</span>
                </div>
                <div className="legend-item">
                  <span className="dot warning" />
                  <span>空白 {stats.blank}</span>
                </div>
                <div className="legend-item">
                  <span className="dot error" />
                  <span>失败 {stats.failed}</span>
                </div>
              </div>
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
