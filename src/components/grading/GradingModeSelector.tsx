import { Zap, UserCheck, Bot } from 'lucide-react'
import type { GradingMode } from '@/types'

/**
 * 批改模式配置
 */
const modeConfigs = [
  {
    key: 'normal' as GradingMode,
    icon: <Zap size={18} />,
    name: '普通模式',
    desc: 'AI评分后5秒自动提交，期间可暂停或取消'
  },
  {
    key: 'trial' as GradingMode,
    icon: <UserCheck size={18} />,
    name: '试改模式',
    desc: 'AI评分后等待教师确认，支持分数纠错和标准优化'
  },
  {
    key: 'unattended' as GradingMode,
    icon: <Bot size={18} />,
    name: '无人值守',
    desc: '全自动批改，1秒提交，错误自动重试（最多3次）'
  }
]

/**
 * 批改模式选择器组件 Props 接口
 */
interface GradingModeSelectorProps {
  currentMode: GradingMode
  isRunning: boolean
  onModeChange: (mode: GradingMode) => void
}

/**
 * 批改模式选择器组件
 * 负责显示三种批改模式（智能批改/极速批改/试改模式）并提供切换功能
 */
export default function GradingModeSelector({
  currentMode,
  isRunning,
  onModeChange
}: GradingModeSelectorProps) {
  return (
    <div className="card">
      <div className="card-header">
        <Zap size={16} />
        <h3>批改模式</h3>
      </div>
      <div className="card-body">
        <div className="mode-selector">
          {modeConfigs.map(mode => (
            <div
              key={mode.key}
              className={`mode-card ${currentMode === mode.key ? 'active' : ''}`}
              onClick={() => !isRunning && onModeChange(mode.key)}
            >
              <div className="mode-header">
                <span className="mode-icon">{mode.icon}</span>
                <span className="mode-name">{mode.name}</span>
              </div>
              <div className="mode-desc">{mode.desc}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/**
 * 导出模式配置，供其他组件使用
 */
export { modeConfigs }
