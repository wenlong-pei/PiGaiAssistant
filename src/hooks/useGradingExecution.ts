import { useRef, useCallback } from 'react'
import { useGradingStore } from '@/store/gradingStore'
import { gradingBotProxy } from '@/services/playwrightProxy'
import { useSound } from './useSound'
import type { GradingMode } from '@/types'

/**
 * 批改执行管理自定义 Hook
 * 封装自动批改的主要执行逻辑
 */
export function useGradingExecution() {
  const { playSuccess, playError, playClick } = useSound()

  const runningRef = useRef(false)
  const pausedRef = useRef(false)

  const gradingStore = useGradingStore()
  const {
    setPreviewImage,
    setRecognizedText,
    setAiComment,
    setShowCorrection,
    setCorrectionScore,
    setCorrectionReason,
    setCountdown,
    setWaitingConfirm,
    resetStats,
    updateStats,
    addLog,
    setIsRunning,
    setIsPaused
  } = gradingStore

  // 添加日志
  const addLogWithType = (message: string, type: 'info' | 'success' | 'error' | 'warning' = 'info', verbose = false) => {
    const timestamp = new Date().toLocaleTimeString()
    const prefix = type === 'success' ? '[OK]' : type === 'error' ? '[ERR]' : type === 'warning' ? '[WARN]' : '[INFO]'
    addLog(`[${timestamp}] ${prefix} ${message}`, type, verbose)
  }

  // 执行自动批改
  const executeGrading = useCallback(async (
    currentStandard: any,
    gradingMode: GradingMode,
    browserConnected: boolean,
    startCountdown: (seconds: number) => Promise<boolean>,
    cancelCountdown: () => void,
    handleCorrection: (aiScore: number) => Promise<number>
  ) => {
    if (!browserConnected) {
      return { success: false, message: '请先连接浏览器' }
    }

    playClick()
    runningRef.current = true
    pausedRef.current = false
    setIsRunning(true)
    setIsPaused(false)
    resetStats()
    setPreviewImage(null)
    setRecognizedText('')
    setAiComment('')
    gradingStore.setAiAnalysis({ breakdown: [], errorTags: [] })
    setShowCorrection(false)
    setCorrectionScore('')
    setCorrectionReason('')
    setCountdown(0)
    setWaitingConfirm(false)
    
    // 记录批改开始时间
    gradingStore.startGrading()

    gradingBotProxy.setGradingStandard(currentStandard)
    gradingBotProxy.start()

    const modeLabel = gradingMode === 'normal' ? '普通' : gradingMode === 'trial' ? '试改' : '无人值守'
    addLogWithType(`开始${modeLabel}模式自动批改...`)

    try {
      let consecutiveCount = 0

      while (true) {
        if (!runningRef.current) break
        if (pausedRef.current) {
          await new Promise(r => setTimeout(r, 500))
          continue
        }

        updateStats((prev) => ({ total: prev.total + 1 }))

        // 记录单份开始时间
        const paperStartTime = Date.now()

        // 1. 获取图片
        addLogWithType('正在获取答题图片...', 'info', true)
        let image: string | null = null
        try {
          image = await gradingBotProxy.captureAnswer()
        } catch (captureError) {
          addLogWithType(`获取图片异常: ${captureError}`, 'error')
        }

        if (!image) {
          addLogWithType('获取图片失败，可能已批改完毕或页面未就绪', 'warning')
          updateStats((prev) => ({ failed: prev.failed + 1 }))
          await new Promise(r => setTimeout(r, 2000))
          try {
            const nextState = await gradingBotProxy.nextPaper()
            if (nextState === 'last') {
              addLogWithType('没有更多试卷了', 'success')
              break
            }
            if (nextState === 'error') {
              // 修复 BUG-EXE-006：切换出错不等于批改结束，明确告警并暂停
              addLogWithType('切换下一张失败（非批改结束），已暂停等待处理', 'error')
              pausedRef.current = true
              setIsPaused(true)
              continue
            }
          } catch (nextError) {
            addLogWithType(`切换下一张异常: ${nextError}，已暂停等待处理`, 'error')
            pausedRef.current = true
            setIsPaused(true)
            continue
          }
          continue
        }

        addLogWithType(`获取图片成功 (${(image.length / 1024).toFixed(0)}KB)`, 'success', true)
        setPreviewImage(image)

        // 2. AI 评分：首选「图像直评」（视觉模型看图直接识别并评分）；
        //    失败 / 结果不可解析时，自动回退到「OCR + 文本评分」，
        //    并在日志中记录切换原因。
        addLogWithType('正在图像直评...', 'info', true)
        let gradeResult: { score: number; comment: string; reasoning?: string; needsHumanReview?: boolean; errorTags?: string[]; rubricBreakdown?: Array<{ id: string; awarded: number }> } = { score: 0, comment: '评分失败' }
        let gradingPath: 'vision' | 'ocr' = 'vision'

        const correctionHistory = gradingStore.correctionHistory

        let visionOutcome: { ok: boolean; result?: typeof gradeResult; reason?: string } | null = null
        try {
          visionOutcome = await gradingBotProxy.gradeWithImage(image, correctionHistory)
        } catch (err) {
          visionOutcome = { ok: false, reason: `图像直评异常：${err}` }
        }

        if (visionOutcome?.ok && visionOutcome.result) {
          gradeResult = visionOutcome.result
          addLogWithType(`图像直评完成（视觉模型直接读图评分）`, 'success', true)
        } else {
          // ==== 回退：OCR + 文本评分 ====
          gradingPath = 'ocr'
          const fallbackReason = visionOutcome?.reason || '未知原因'
          addLogWithType(`图像直评不可用（${fallbackReason}），自动切换 OCR 兜底`, 'warning')

          addLogWithType('正在OCR识别文字...', 'info', true)
          const ocrResult = await gradingBotProxy.recognizeText(image)

          // 检查 OCR 识别错误，避免对错误信息进行 AI 评分
          if (ocrResult.error) {
            addLogWithType(`OCR识别失败: ${ocrResult.error}`, 'error')
            updateStats((prev) => ({ failed: prev.failed + 1 }))
            await new Promise(r => setTimeout(r, 2000))
            try {
              const nextState = await gradingBotProxy.nextPaper()
              if (nextState === 'last') {
                addLogWithType('没有更多试卷了', 'success')
                break
              }
              if (nextState === 'error') {
                addLogWithType('切换下一张失败（非批改结束），已暂停等待处理', 'error')
                pausedRef.current = true
                setIsPaused(true)
                continue
              }
            } catch (nextError) {
              addLogWithType(`切换下一张异常: ${nextError}，已暂停等待处理`, 'error')
              pausedRef.current = true
              setIsPaused(true)
              continue
            }
            continue
          }

          setRecognizedText(ocrResult.text)

          // 空白卷检测
          if (ocrResult.isBlank) {
            addLogWithType('检测到空白卷，直接打0分', 'warning')
            setAiComment('空白卷')
            const blankSubmitOk = await gradingBotProxy.submitScore(0)
            if (!blankSubmitOk) {
              addLogWithType('空白卷 0 分提交失败，已暂停等待人工核对', 'error')
              updateStats((prev) => ({ failed: prev.failed + 1 }))
              playError()
              pausedRef.current = true
              setIsPaused(true)
              continue
            }
            updateStats((prev) => ({ blank: prev.blank + 1, completed: prev.completed + 1, currentScore: 0 }))

            const paperTime = Date.now() - paperStartTime
            gradingStore.recordGradingTime(paperTime)

            consecutiveCount++
            playClick()
            const nextState = await gradingBotProxy.nextPaper()
            if (nextState === 'last') {
              addLogWithType('没有更多试卷了', 'success')
              break
            }
            if (nextState === 'error') {
              addLogWithType('切换下一张失败（非批改结束），已暂停等待处理', 'error')
              pausedRef.current = true
              setIsPaused(true)
              continue
            }
            await new Promise(r => setTimeout(r, 500))
            continue
          }

          // OCR 文本评分（带重试）
          const maxRetries = gradingMode === 'unattended' ? 3 : 1
          let retryCount = 0
          while (retryCount < maxRetries) {
            try {
              gradeResult = await gradingBotProxy.gradeWithAI(ocrResult.text, correctionHistory)
              break
            } catch (err) {
              retryCount++
              if (retryCount >= maxRetries) {
                addLogWithType(`AI评分失败（已重试${maxRetries}次）: ${err}`, 'error')
                updateStats((prev) => ({ failed: prev.failed + 1 }))
                gradeResult = { score: 0, comment: '评分失败' }
                break
              }
              addLogWithType(`AI评分失败，正在重试(${retryCount}/${maxRetries})...`, 'warning')
              await new Promise(r => setTimeout(r, 1000))
            }
          }
        }

        const finalScore = gradeResult.score
        const maxScore = currentStandard?.totalScore || 10
        const scorePercent = Math.round((finalScore / maxScore) * 100)
        updateStats({ currentScore: finalScore })

        // 存储本份的评分分析（维度得分/错因标签/评分依据），供界面展示"为什么打这个分"
        gradingStore.setAiAnalysis({
          breakdown: gradeResult.rubricBreakdown || [],
          errorTags: gradeResult.errorTags || [],
          reasoning: gradeResult.reasoning || '',
          needsHumanReview: gradeResult.needsHumanReview === true,
        })

        // 判分未成功（解析失败 / 本地降级）时提示人工复核
        let aiComment = gradeResult.comment
        if (gradeResult.needsHumanReview) {
          addLogWithType('本次判分未能由模型完成，建议人工复核该份', 'warning')
          aiComment = (aiComment ? aiComment + ' ' : '') + '[建议人工复核]'
        }

        setAiComment(aiComment)
        // 每份试卷的核心结果行（精简模式下也保留）
        addLogWithType(
          `第 ${consecutiveCount + 1} 份 → ${finalScore}分 / ${maxScore}分 (${scorePercent}%) ${gradingPath === 'vision' ? '[图像直评]' : '[OCR兜底]'}`,
          'success'
        )

        // 5. 根据模式处理提交
        let submitScore = finalScore

        if (gradingMode === 'normal') {
          if (gradeResult.needsHumanReview) {
            // 修复（第三轮）：AI 未能可靠判分（解析失败/输入无效/本地降级）时，
            // 普通模式也不自动提交，降级为等待教师人工确认（与试改模式一致），
            // 避免"无依据分数"被静默提交到阅卷平台。
            addLogWithType('本次判分未由模型可靠完成，暂停自动提交，请教师确认', 'warning')
            setWaitingConfirm(true)
            submitScore = await handleCorrection(finalScore)
            setWaitingConfirm(false)
            if (!runningRef.current) {
              addLogWithType('已停止批改，当前份未提交', 'warning')
              break
            }
          } else {
            addLogWithType('普通模式：5秒后自动提交...', 'info', true)
            const shouldSubmit = await startCountdown(5)
            if (!shouldSubmit) {
              // 修复 BUG-EXE-004：此前取消倒计时 = 静默放弃当前份并继续下一份。
              // 改为暂停等待人工决策，当前份不提交、不跳过。
              addLogWithType('已取消自动提交，当前份未提交，已暂停等待处理', 'warning')
              pausedRef.current = true
              setIsPaused(true)
              await new Promise(r => setTimeout(r, 300))
              continue
            }
            if (!runningRef.current) {
              addLogWithType('已停止批改，当前份未提交', 'warning')
              break
            }
            submitScore = finalScore
          }
        } else if (gradingMode === 'trial') {
          addLogWithType('试改模式：等待教师确认...', 'warning')
          setWaitingConfirm(true)
          submitScore = await handleCorrection(finalScore)
          setWaitingConfirm(false)
          if (!runningRef.current) {
            addLogWithType('已停止批改，当前份未提交', 'warning')
            break
          }
        } else if (gradingMode === 'unattended') {
          await new Promise(r => setTimeout(r, 1000))
          submitScore = finalScore
        }

        // 6. 提交前的最后可取消点（修复 BUG-EXE-003）：
        // 暂停/停止只翻转标志位，无法中断已发出的 AI 调用；
        // 因此在真正提交之前再做一次校验，已暂停/停止则丢弃本次结果、不提交。
        if (!runningRef.current) {
          addLogWithType('已停止批改，当前份结果已丢弃、未提交', 'warning')
          break
        }
        if (pausedRef.current) {
          addLogWithType('已暂停，当前份结果未提交；恢复后将重新处理该份', 'warning')
          continue
        }

        // 7. 提交（修复 BUG-EXE-005：失败不再静默，不误计 completed）
        const submitOk = await gradingBotProxy.submitScore(submitScore)
        if (!submitOk) {
          addLogWithType(`提交失败：${submitScore}分 未能确认提交，已暂停等待人工核对`, 'error')
          updateStats((prev) => ({ failed: prev.failed + 1 }))
          playError()
          pausedRef.current = true
          setIsPaused(true)
          continue
        }

        addLogWithType(`已提交 ${submitScore}分`, 'success', true)
        updateStats((prev) => ({ completed: prev.completed + 1 }))
        
        // 记录批改时间
        const paperTime = Date.now() - paperStartTime
        gradingStore.recordGradingTime(paperTime)
        
        consecutiveCount++
        playClick()

        // 7. 下一张
        const nextState = await gradingBotProxy.nextPaper()
        if (nextState === 'last') {
          addLogWithType('没有更多试卷了', 'success')
          break
        }
        if (nextState === 'error') {
          addLogWithType('切换下一张失败（非批改结束），已暂停等待处理', 'error')
          pausedRef.current = true
          setIsPaused(true)
          continue
        }

        await new Promise(r => setTimeout(r, 800))
      }

      addLogWithType(`批改完成！共${consecutiveCount}份`, 'success')
      playSuccess()
      return { success: true, count: consecutiveCount }
    } catch (error) {
      addLogWithType(`批改中断: ${error}`, 'error')
      playError()
      return { success: false, error }
    } finally {
      runningRef.current = false
      pausedRef.current = false
      cancelCountdown()
      setIsRunning(false)
      setIsPaused(false)
      setWaitingConfirm(false)
      setShowCorrection(false)
      
      // 结束批改时间记录
      gradingStore.finishGrading()
    }
  }, [playClick, playSuccess, playError, setPreviewImage, setRecognizedText, setAiComment, setShowCorrection, setCorrectionScore, setCorrectionReason, setCountdown, setWaitingConfirm, resetStats, updateStats, addLog, setIsRunning, setIsPaused, gradingStore])

  // 暂停/继续批改
  const handlePause = useCallback(() => {
    playClick()
    const newPausedState = !pausedRef.current
    pausedRef.current = newPausedState
    setIsPaused(newPausedState)

    if (newPausedState) {
      addLogWithType('已暂停批改')
    } else {
      addLogWithType('继续批改...')
    }
  }, [playClick, setIsPaused, addLog])

  // 停止批改
  const handleStop = useCallback((cancelCountdown: () => void) => {
    playClick()
    runningRef.current = false
    pausedRef.current = false
    cancelCountdown()
    setIsRunning(false)
    setIsPaused(false)
    setWaitingConfirm(false)
    setShowCorrection(false)
    addLogWithType('已停止批改')
  }, [playClick, setIsRunning, setIsPaused, setWaitingConfirm, setShowCorrection, addLog])

  return {
    runningRef,
    pausedRef,
    executeGrading,
    handlePause,
    handleStop
  }
}
