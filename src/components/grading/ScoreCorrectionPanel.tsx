import { Pencil, RotateCcw, Send, X, CheckCircle, UserCheck } from 'lucide-react'

/**
 * 分数纠错面板组件 Props 接口
 */
interface ScoreCorrectionPanelProps {
  showCorrection: boolean
  waitingConfirm: boolean
  isAnalyzing: boolean
  aiScore: number | null
  correctionScore: string
  correctionReason: string
  currentStandard: any
  stats: any
  onCorrectionScoreChange: (score: string) => void
  onCorrectionReasonChange: (reason: string) => void
  onSubmitCorrection: () => void
  onCancelCorrection: () => void
  onShowCorrection: () => void
  onConfirmTrialSubmit: () => void
  /** 是否显示快捷键提示 */
  showShortcutHints?: boolean
}

/**
 * 分数纠错面板组件
 * 负责显示 AI 评分、手动调整分数、提交分数纠错
 */
export default function ScoreCorrectionPanel({
  showCorrection,
  waitingConfirm,
  isAnalyzing,
  aiScore,
  correctionScore,
  correctionReason,
  currentStandard,
  stats,
  onCorrectionScoreChange,
  onCorrectionReasonChange,
  onSubmitCorrection,
  onCancelCorrection,
  onShowCorrection,
  onConfirmTrialSubmit,
  showShortcutHints = false
}: ScoreCorrectionPanelProps) {
  // 如果不需要显示纠错面板，返回 null
  if (!showCorrection && !waitingConfirm) {
    return null
  }

  return (
    <div className="correction-panel">
      {/* 分数纠错界面 */}
      {showCorrection && (
        <>
          <div className="correction-header">
            <h4>
              <Pencil size={16} />
              分数纠错
              {showShortcutHints && <span className="shortcut-hint">Ctrl+E</span>}
            </h4>
            <button className="btn-close" onClick={onCancelCorrection}>
              <X size={16} />
            </button>
          </div>
          {isAnalyzing ? (
            <div className="correction-analyzing">
              <div className="spinner" />
              <span>AI 正在分析评分差异原因，优化评分标准...</span>
            </div>
          ) : (
            <div className="correction-body">
              {/* AI 评分显示 */}
              <div className="correction-row">
                <label>AI 评分</label>
                <input
                  type="text"
                  value={`${stats.currentScore} 分`}
                  disabled
                />
              </div>

              {/* 正确分数输入 */}
              <div className="correction-row">
                <label>正确分数</label>
                <input
                  type="number"
                  value={correctionScore}
                  onChange={(e) => onCorrectionScoreChange(e.target.value)}
                  placeholder="输入你认为正确的分数"
                  min={0}
                  max={currentStandard?.totalScore || 100}
                />
              </div>

              {/* 纠错原因输入 */}
              <div className="correction-row">
                <label>纠错原因</label>
                <textarea
                  value={correctionReason}
                  onChange={(e) => onCorrectionReasonChange(e.target.value)}
                  placeholder="描述AI评分错误的原因（可选）"
                />
              </div>

              {/* 操作按钮 */}
              <div className="correction-actions">
                <button className="btn btn-secondary" onClick={onCancelCorrection}>
                  <RotateCcw size={14} />
                  使用AI评分
                </button>
                <button className="btn btn-primary" onClick={onSubmitCorrection}>
                  <Send size={14} />
                  提交纠错
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* 试改模式确认界面 */}
      {waitingConfirm && !showCorrection && (
        <>
          <div className="correction-header">
            <h4>
              <UserCheck size={16} />
              请确认AI评分
            </h4>
          </div>
          <div className="correction-body">
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>
              AI 评分为 <strong style={{ color: '#60a5fa', fontSize: 18 }}>{stats.currentScore}</strong> 分，
              请确认是否提交，或点击纠错修改分数。
            </div>
            <div className="correction-actions">
              <button className="btn btn-secondary" onClick={onShowCorrection}>
                <Pencil size={14} />
                分数纠错
                {showShortcutHints && <span className="shortcut-hint">Ctrl+E</span>}
              </button>
              <button className="btn btn-primary" onClick={onConfirmTrialSubmit}>
                <CheckCircle size={14} />
                确认提交
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
