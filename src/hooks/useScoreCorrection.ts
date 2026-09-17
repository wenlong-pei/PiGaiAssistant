import { useState, useCallback, useRef } from 'react'
import toast from 'react-hot-toast'
import { useGradingStore } from '@/store/gradingStore'
import { useSound } from './useSound'

/**
 * 分数纠错管理自定义 Hook
 * 封装分数纠错相关的逻辑
 */
export function useScoreCorrection() {
  const { playSuccess } = useSound()
  const [isAnalyzing, setIsAnalyzing] = useState(false)

  const gradingStore = useGradingStore()
  const {
    stats,
    correctionScore,
    correctionReason,
    setShowCorrection,
    setCorrectionScore,
    setCorrectionReason,
    addLog
  } = gradingStore

  const confirmResolveRef = useRef<((score: number) => void) | null>(null)

  // 添加日志
  const addLogWithType = (message: string, type: 'info' | 'success' | 'error' | 'warning' = 'info') => {
    const timestamp = new Date().toLocaleTimeString()
    const prefix = type === 'success' ? '[OK]' : type === 'error' ? '[ERR]' : type === 'warning' ? '[WARN]' : '[INFO]'
    addLog(`[${timestamp}] ${prefix} ${message}`, type)
  }

  // 显示纠错面板并处理纠错
  const handleCorrection = useCallback(async (_aiScore: number): Promise<number> => {
    setShowCorrection(true)
    setCorrectionScore('')
    setCorrectionReason('')
    setIsAnalyzing(false)

    return new Promise((resolve) => {
      confirmResolveRef.current = (finalScore: number) => {
        setShowCorrection(false)
        confirmResolveRef.current = null
        resolve(finalScore)
      }
    })
  }, [setShowCorrection, setCorrectionScore, setCorrectionReason])

  // 提交纠错
  const submitCorrection = useCallback(async (
    currentStandard: any,
    recognizedText: string
  ) => {
    const score = parseInt(correctionScore, 10)
    // 修复：增加上界校验，防止教师输入超过满分的分数
    const maxScore = currentStandard?.totalScore || 100
    if (isNaN(score) || score < 0) {
      toast.error('请输入有效的分数')
      return
    }
    if (score > maxScore) {
      toast.error(`分数不能超过满分 ${maxScore} 分`)
      return
    }

    setIsAnalyzing(true)
    addLogWithType(`正在分析纠错原因... AI评分与教师评分不一致`, 'warning')

    try {
      const isElectron = typeof window !== 'undefined' && !!(window as any).electronAPI
      if (isElectron) {
        const electronAPI = (window as any).electronAPI
        try {
          const response = await electronAPI.invoke('bot:analyzeCorrection', {
            aiScore: useGradingStore.getState().stats.currentScore,
            teacherScore: score,
            reason: correctionReason,
            standard: currentStandard,
            recognizedText
          })
          if (response?.optimizedKeywords) {
            addLogWithType(`AI 已优化评分标准: ${response.optimizedKeywords.join('、')}`, 'success')
          }
          if (response?.analysis) {
            addLogWithType(`纠错分析: ${response.analysis}`, 'info')
          }
        } catch {
          addLogWithType('纠错分析请求失败，直接提交教师评分', 'warning')
        }
      }
    } finally {
      setIsAnalyzing(false)
    }

    addLogWithType(`提交纠错分数: ${score}分`, 'success')
    playSuccess()
    confirmResolveRef.current?.(score)
  }, [correctionScore, correctionReason, setCorrectionScore, addLog, playSuccess])

  // 取消纠错
  const cancelCorrection = useCallback(() => {
    addLogWithType('取消纠错，使用AI评分', 'info')
    confirmResolveRef.current?.(useGradingStore.getState().stats.currentScore || 0)
  }, [addLog])

  // 确认试改模式提交
  const confirmTrialSubmit = useCallback(() => {
    addLogWithType('教师确认，提交AI评分', 'success')
    playSuccess()
    confirmResolveRef.current?.(useGradingStore.getState().stats.currentScore || 0)
  }, [addLog, playSuccess])

  return {
    isAnalyzing,
    handleCorrection,
    submitCorrection,
    cancelCorrection,
    confirmTrialSubmit,
    confirmResolveRef
  }
}
