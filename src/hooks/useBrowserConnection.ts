import { useState, useCallback } from 'react'
import toast from 'react-hot-toast'
import { useGradingStore } from '@/store/gradingStore'
import { gradingBotProxy } from '@/services/playwrightProxy'
import { useSound } from './useSound'

/**
 * 浏览器连接相关的自定义 Hook
 * 封装浏览器启动、页面检测等逻辑
 */
export function useBrowserConnection() {
  const { playSuccess, playError, playClick } = useSound()
  const [isConnecting, setIsConnecting] = useState(false)

  const gradingStore = useGradingStore()
  const {
    browserLaunched,
    isZhixuePage,
    currentPlatformName,
    setBrowserConnected,
    setIsZhixuePage,
    setBrowserLaunched,
    setCurrentPlatform,
    addLog
  } = gradingStore

  // 添加日志（直接写入 store，不重复拼接时间戳前缀）
  const addLogWithType = (message: string, type: 'info' | 'success' | 'error' | 'warning' = 'info') => {
    addLog(message, type)
  }

  // 启动浏览器
  const handleConnect = useCallback(async (currentStandard: any) => {
    if (!currentStandard) {
      toast.error('请先选择评分标准')
      return
    }

    playClick()
    setIsConnecting(true)

    try {
      if (!browserLaunched) {
        addLogWithType('正在启动 Edge 浏览器...')
        const result = await gradingBotProxy.launchBrowser(false)
        if (!result.success) {
          throw new Error(result.error || '启动浏览器失败')
        }
        setBrowserLaunched(true)
        addLogWithType('Edge 浏览器已启动', 'success')
        addLogWithType(`请在 Edge 中登录${currentPlatformName || '批改平台'}，进入批改页面后点击「检测页面元素」`, 'info')
      }
    } catch (error) {
      addLogWithType(`启动失败: ${error}`, 'error')
      playError()
      toast.error('启动失败')
    } finally {
      setIsConnecting(false)
    }
  }, [browserLaunched, playClick, playError, setBrowserLaunched, addLog, currentPlatformName])

  // 分析当前页面
  const analyzeCurrentPage = useCallback(async () => {
    addLogWithType(`正在分析${currentPlatformName || '批改平台'}页面...`)
    const elements = await gradingBotProxy.analyzePage()

    if (elements.found) {
      // 同步当前平台信息到 store
      if (elements.platformName || elements.platformDisplayName) {
        setCurrentPlatform(
          elements.platformName || '',
          elements.platformDisplayName || currentPlatformName
        )
      }
      setBrowserConnected(true)
      setIsZhixuePage(true)
      addLogWithType(`已连接到${currentPlatformName || '批改平台'}`, 'success')
      if (elements.isOldUI) {
        addLogWithType('检测到旧版UI', 'success')
      }
      if (elements.isNewUI) {
        addLogWithType('检测到新版UI', 'success')
      }
      addLogWithType('找到答题图片区域', 'success')
      addLogWithType('找到分数输入框', 'success')
      if (elements.questionContent) {
        addLogWithType(`获取到题目内容: ${elements.questionContent.substring(0, 50)}...`, 'info')
      }
      playSuccess()
      toast.success(`${currentPlatformName || '批改平台'}页面分析完成，可以开始批改`)
    } else {
      setBrowserConnected(false)
      setIsZhixuePage(false)
      // 修复：使用正确的属性名（answerArea, scoreInput, submitButton）
      const imgOk = elements.answerArea ? '✅ 已找到' : '❌ 未找到'
      const inputOk = elements.scoreInput ? '✅ 已找到' : '❌ 未找到'
      const btnOk = elements.submitButton ? '✅ 已找到' : '❌ 未找到'
      addLogWithType(`元素检测结果: 答题图片区域 ${imgOk}`, elements.answerArea ? 'success' : 'error')
      addLogWithType(`元素检测结果: 分数输入框 ${inputOk}`, elements.scoreInput ? 'success' : 'error')
      addLogWithType(`元素检测结果: 提交按钮 ${btnOk}`, elements.submitButton ? 'success' : 'error')

      if (elements.error) {
        addLogWithType(`页面检测未通过: ${elements.error}`, 'warning')
        toast('页面可能需要登录，请在浏览器中登录后点击「重新检测」', { icon: '🔑', duration: 5000 })
      } else {
        const missing: string[] = []
        if (!elements.answerArea) missing.push('答题图片区域')
        if (!elements.scoreInput) missing.push('分数输入框')
        if (!elements.submitButton) missing.push('提交按钮')
        addLogWithType(`未能识别: ${missing.join('、')}`, 'warning')
        toast(`未找到: ${missing.join('、')}，请确认已进入阅卷页面后点击「重新检测」`, { icon: '⚠️', duration: 5000 })
      }
    }
  }, [setBrowserConnected, setIsZhixuePage, addLog, playSuccess, currentPlatformName, setCurrentPlatform])

  // 手动检测页面元素
  const handleReanalyze = useCallback(async () => {
    playClick()
    setIsConnecting(true)
    addLogWithType('正在检测页面元素...')
    try {
      await analyzeCurrentPage()
    } catch (error: any) {
      if (String(error).includes('closed') || String(error).includes('Target')) {
        addLogWithType('浏览器连接已断开，请重新启动', 'warning')
        setBrowserLaunched(false)
        setBrowserConnected(false)
        setIsZhixuePage(false)
        toast('浏览器已关闭，请重新启动', { icon: '⚠️', duration: 4000 })
      } else {
        addLogWithType(`检测失败: ${error}`, 'error')
        playError()
        toast.error('检测失败')
      }
    } finally {
      setIsConnecting(false)
    }
  }, [playClick, analyzeCurrentPage, setBrowserLaunched, setBrowserConnected, setIsZhixuePage, addLog, playError])

  return {
    isConnecting,
    handleConnect,
    handleReanalyze
  }
}
