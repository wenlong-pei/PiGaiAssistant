import { createContext, useContext, useRef, useCallback, ReactNode } from 'react'
import { useSettingsStore } from '@/store/settingsStore'

// 音效类型
type SoundType = 
  | 'click'      // 按钮点击
  | 'success'    // 操作成功
  | 'error'      // 操作失败
  | 'warning'    // 警告提示
  | 'complete'   // 任务完成
  | 'score'      // 打分完成
  | 'navigate'   // 页面切换

interface SoundContextType {
  play: (type: SoundType) => void
  playClick: () => void
  playSuccess: () => void
  playError: () => void
  playWarning: () => void
  playComplete: () => void
  playScore: () => void
}

const SoundContext = createContext<SoundContextType | null>(null)

// 音效数据 (Base64编码的简短音效)
const sounds: Record<SoundType, string> = {
  click: 'data:audio/wav;base64,UklGRl9vT19teleWQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YU',
  success: 'data:audio/wav;base64,UklGRl9vT19teleWQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YU',
  error: 'data:audio/wav;base64,UklGRl9vT19teleWQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YU',
  warning: 'data:audio/wav;base64,UklGRl9vT19teleWQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YU',
  complete: 'data:audio/wav;base64,UklGRl9vT19teleWQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YU',
  score: 'data:audio/wav;base64,UklGRl9vT19teleWQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YU',
  navigate: 'data:audio/wav;base64,UklGRl9vT19teleWQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YU',
}

export function SoundProvider({ children }: { children: ReactNode }) {
  const audioRefs = useRef<Map<SoundType, HTMLAudioElement>>(new Map())
  const { settings } = useSettingsStore()

  const play = useCallback((type: SoundType) => {
    if (!settings.soundEnabled) return

    let audio = audioRefs.current.get(type)
    if (!audio) {
      audio = new Audio(sounds[type])
      audio.volume = settings.soundVolume / 100
      audioRefs.current.set(type, audio)
    }

    audio.currentTime = 0
    audio.play().catch(() => {
      // 忽略自动播放限制错误
    })
  }, [settings.soundEnabled, settings.soundVolume])

  const value: SoundContextType = {
    play,
    playClick: () => play('click'),
    playSuccess: () => play('success'),
    playError: () => play('error'),
    playWarning: () => play('warning'),
    playComplete: () => play('complete'),
    playScore: () => play('score'),
  }

  return (
    <SoundContext.Provider value={value}>
      {children}
    </SoundContext.Provider>
  )
}

export function useSound() {
  const context = useContext(SoundContext)
  if (!context) {
    throw new Error('useSound must be used within SoundProvider')
  }
  return context
}
