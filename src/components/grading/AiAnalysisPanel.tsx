import { AlertCircle, FileText, ListChecks, Tag } from 'lucide-react'
import './AiAnalysisPanel.scss'

export interface AiAnalysisData {
  breakdown: Array<{ id: string; awarded: number }>
  errorTags: string[]
  /** 评分依据：无论得分多少都有值 */
  reasoning?: string
  /** 判分未能由模型完整完成（解析失败 / 本地降级）时为 true —— 与置信度无关 */
  needsHumanReview?: boolean
}

interface Props {
  analysis: AiAnalysisData
  /** 当前评分标准的规则列表（用于把维度 id 映射回可读描述）。
   *  评分细则已统一为自由文本，此时传字符串即可，面板会跳过维度映射。 */
  scoringRules?: Array<{ id: string; description: string; score: number; type: 'positive' | 'negative' }> | string
}

/**
 * AI 评分分析面板：展示"为什么打这个分"。
 * 数据来自模型返回的 rubricBreakdown（维度实得分）、errorTags（错因标签）与评分依据。
 * 注：置信度机制已完全移除，不再展示或判断置信度。
 */
export default function AiAnalysisPanel({ analysis, scoringRules }: Props) {
  const { breakdown, errorTags, reasoning, needsHumanReview } = analysis
  const needsReview = needsHumanReview === true
  // 评分细则为自由文本时没有结构化维度 id，跳过映射（依据里已说明给分来源）
  const ruleList = Array.isArray(scoringRules) ? scoringRules : []
  const hasBreakdown = breakdown && breakdown.length > 0
  const hasTags = errorTags && errorTags.length > 0

  if (!hasBreakdown && !hasTags && !reasoning) return null

  return (
    <div className="ai-analysis-panel">
      <div className="ai-analysis-panel__header">
        <ListChecks size={14} />
        <span>评分分析</span>
      </div>

      {reasoning && (
        <div className="ai-analysis-panel__reasoning">
          <div className="ai-analysis-panel__reasoning-label">
            <FileText size={13} />
            <span>评分依据</span>
          </div>
          <p className="ai-analysis-panel__reasoning-text">{reasoning}</p>
        </div>
      )}

      {hasBreakdown && (
        <ul className="ai-analysis-panel__rules">
          {breakdown.map((item, i) => {
            const rule = ruleList.find(r => r.id === item.id)
            const desc = rule?.description || item.id || `维度${i + 1}`
            return (
              <li key={`${item.id}-${i}`}>
                <span className="rule-desc">{desc}</span>
                <span className={`rule-awarded${item.awarded < 0 ? ' is-negative' : ''}`}>
                  {item.awarded > 0 ? '+' : ''}{item.awarded}分
                </span>
              </li>
            )
          })}
        </ul>
      )}

      {hasTags && (
        <div className="ai-analysis-panel__tags">
          <Tag size={12} />
          {errorTags.map((t, i) => (
            <span key={i} className="tag">{t}</span>
          ))}
        </div>
      )}

      {needsReview && (
        <div className="ai-analysis-panel__warn">
          <AlertCircle size={12} />
          <span>本次判分由模型完成的部分可能不完整，建议人工复核后再提交</span>
        </div>
      )}
    </div>
  )
}
