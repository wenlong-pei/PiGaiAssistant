import { useRef, useCallback } from 'react'
import { useGradingStore } from '@/store/gradingStore'

/**
 * 倒计时管理自定义 Hook
 * 封装倒计时相关的逻辑
 *
 * 修复记录：
 * 1. 修复 cancelCountdown 被调用时 Promise 永不 resolve 的严重 Bug
 *    —— 现在通过 resolveRef 保存 resolve 函数，cancel 时以 false 调用
 * 2. 移除通过 window.__pausedRef 的不安全全局访问
 *    —— 改为通过 useGradingStore.getState().isPaused 读取暂停状态
 */
export function useCountdown() {
  const countdownRef = useRef(0)
  const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // 保存当前 Promise 的 resolve 函数，供 cancel 时调用
  const resolveRef = useRef<((value: boolean) => void) | null>(null)

  const gradingStore = useGradingStore()
  const { setCountdown } = gradingStore

  // 开始倒计时
  const startCountdown = useCallback((seconds: number): Promise<boolean> => {
    return new Promise((resolve) => {
      // 如果已有正在进行的倒计时，先取消（以 false resolve）
      resolveRef.current?.(false)

      countdownRef.current = seconds
      setCountdown(seconds)
      // 保存 resolve 供 cancel 使用
      resolveRef.current = resolve

      if (countdownTimerRef.current) {
        clearInterval(countdownTimerRef.current)
      }

      countdownTimerRef.current = setInterval(() => {
        // 通过 store 读取暂停状态，替代不安全的 window.__pausedRef
        const isPaused = useGradingStore.getState().isPaused
        if (isPaused) return

        countdownRef.current--
        setCountdown(countdownRef.current)

        if (countdownRef.current <= 0) {
          if (countdownTimerRef.current) {
            clearInterval(countdownTimerRef.current)
            countdownTimerRef.current = null
          }
          setCountdown(0)
          resolveRef.current = null
          resolve(true)
        }
      }, 1000)
    })
  }, [setCountdown])

  // 取消倒计时（以 false resolve Promise，表示被取消）
  const cancelCountdown = useCallback(() => {
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current)
      countdownTimerRef.current = null
    }
    countdownRef.current = 0
    setCountdown(0)
    // 关键修复：resolve Promise 以 false，避免调用方永久挂起
    if (resolveRef.current) {
      resolveRef.current(false)
      resolveRef.current = null
    }
  }, [setCountdown])

  // 清理定时器（组件卸载时调用）
  const cleanup = useCallback(() => {
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current)
      countdownTimerRef.current = null
    }
    // 清理时也要 resolve 以避免悬挂的 Promise
    if (resolveRef.current) {
      resolveRef.current(false)
      resolveRef.current = null
    }
  }, [])

  return {
    startCountdown,
    cancelCountdown,
    cleanup,
    countdownTimerRef
  }
}
