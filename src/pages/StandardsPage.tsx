import { useState } from 'react'
import { motion } from 'framer-motion'
import { 
  Plus, 
  Edit3, 
  Trash2, 
  Copy, 
  ChevronDown,
  ChevronRight,
  Save,
  X,
  BookOpen,
  ListChecks,
  Hash,
  FileText
} from 'lucide-react'
import toast from 'react-hot-toast'
import { useStandardsStore } from '@/store/standardsStore'
import { useSound } from '@/hooks/useSound'
import type { GradingStandard, ScoringRule } from '@/types'
import './StandardsPage.scss'

/** 可选学科：选择后系统提示词角色变为「专业的XX批改老师」；「通用」表示不指定 */
export const SUBJECT_OPTIONS = ['通用', '语文', '数学', '英语', '物理', '化学', '生物', '历史', '地理', '政治', '科学']

/** 勾选"重视过程分"时写入评分细则的默认说明（用户可自行修改或删除） */
export const PROCESS_CREDIT_HINT = '步骤与过程：最终答案错误但推导步骤正确的，按步骤给分（不因最终答案错误而整体清零）。'

/**
 * 勾选"重视过程分"时，把步骤分说明写入评分细则文本。
 * 设计要点：过程分不再作为独立规则段落注入 API，而是变成用户可见可改的细则文字；
 * 幂等处理（已包含该说明则不重复追加）；取消勾选不删除文本，避免误伤用户编辑。
 */
export function applyProcessCreditHint(rules: ScoringRule[] | string | undefined, checked: boolean): string {
  const current = rulesToText(rules)
  if (!checked) return current
  if (current.includes(PROCESS_CREDIT_HINT)) return current
  return current.trim() ? `${current.trim()}
${PROCESS_CREDIT_HINT}` : PROCESS_CREDIT_HINT
}

/**
 * 评分细则统一成文本：兼容旧的「分点数组」形态与新的「自由文本」形态。
 * 正式流程已与测试流程统一为单文本框录入。
 */
export function rulesToText(rules?: ScoringRule[] | string): string {
  if (!rules) return ''
  if (typeof rules === 'string') return rules
  return rules
    .map((rule) => {
      const raw = rule?.score ?? 0
      const sc = rule?.type === 'negative' ? -Math.abs(raw) : raw
      return `- ${rule?.description || ''}：${sc > 0 ? '+' : ''}${sc}分${rule?.type === 'negative' ? '（扣分）' : ''}`
    })
    .join('\n')
}

export default function StandardsPage() {
  const { 
    standards, 
    presetSets,
    currentPresetId,
    addStandard, 
    updateStandard, 
    deleteStandard, 
    duplicateStandard,
    switchPresetSet,
    setCurrentStandard 
  } = useStandardsStore()
  const { playSuccess, playClick, playError } = useSound()

  const [editingId, setEditingId] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [formData, setFormData] = useState<Partial<GradingStandard>>({})

  // 开始创建新标准
  const handleCreate = () => {
    playClick()
    setIsCreating(true)
    setFormData({
      name: '',
      subject: '',
      questionNumber: '',
      totalScore: 10,
      referenceAnswer: '',
      scoringRules: [],
      examples: [],
    })
  }

  // 保存标准
  const handleSave = () => {
    if (!formData.name || !formData.totalScore) {
      toast.error('请填写完整信息')
      playError()
      return
    }

    if (isCreating) {
      const id = addStandard(formData as Omit<GradingStandard, 'id' | 'createdAt' | 'updatedAt'>)
      setCurrentStandard(id)
      toast.success('评分标准创建成功')
    } else if (editingId) {
      updateStandard(editingId, formData)
      toast.success('评分标准更新成功')
    }

    playSuccess()
    setIsCreating(false)
    setEditingId(null)
    setFormData({})
  }

  // 取消编辑
  const handleCancel = () => {
    playClick()
    setIsCreating(false)
    setEditingId(null)
    setFormData({})
  }

  // 编辑标准
  const handleEdit = (standard: GradingStandard) => {
    playClick()
    setEditingId(standard.id)
    setFormData(standard)
  }

  // 删除标准
  const handleDelete = (id: string) => {
    playClick()
    if (confirm('确定要删除这个评分标准吗？')) {
      deleteStandard(id)
      toast.success('已删除')
      playSuccess()
    }
  }

  // 复制标准
  const handleDuplicate = (id: string) => {
    playClick()
    const newId = duplicateStandard(id)
    if (newId) {
      toast.success('已创建副本')
      playSuccess()
    }
  }

  // 切换预设套
  const handleSwitchPreset = (presetId: string) => {
    playClick()
    switchPresetSet(presetId)
    toast.success('已切换预设套')
    playSuccess()
  }

  return (
    <div className="standards-page">
      <div className="standards-page__header">
        <div>
          <h1 className="standards-page__title">评分标准</h1>
          <p className="standards-page__subtitle">创建和管理评分标准，支持预设套快速切换</p>
        </div>
        <button className="btn btn--primary standards-add-btn" onClick={handleCreate}>
          <Plus size={18} />
          新建标准
        </button>
      </div>

      {/* 预设套选择 */}
      {presetSets.length > 0 && (
        <div className="standards-page__presets">
          <h3>预设套</h3>
          <div className="preset-tabs">
            {presetSets.map((preset) => (
              <button
                key={preset.id}
                className={`preset-tab ${preset.id === currentPresetId ? 'preset-tab--active' : ''}`}
                onClick={() => handleSwitchPreset(preset.id)}
              >
                {preset.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 编辑/创建表单 */}
      {(isCreating || editingId) && (
        <motion.div 
          className="standards-page__editor"
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div className="editor-header">
            <h3>{isCreating ? '创建新标准' : '编辑标准'}</h3>
            <div className="editor-actions">
              <button className="btn btn--secondary btn--sm" onClick={handleCancel}>
                <X size={16} />
                取消
              </button>
              <button className="btn btn--primary btn--sm" onClick={handleSave}>
                <Save size={16} />
                保存
              </button>
            </div>
          </div>

          <div className="editor-body">
            <div className="editor-row">
              <div className="editor-field editor-field--lg">
                <label>标准名称 *</label>
                <input
                  type="text"
                  value={formData.name || ''}
                  onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="如：现代文阅读理解"
                />
              </div>
              <div className="editor-field">
                <label><Hash size={14} /> 题号（选填）</label>
                <input
                  type="text"
                  value={formData.questionNumber || ''}
                  onChange={(e) => setFormData(prev => ({ ...prev, questionNumber: e.target.value }))}
                  placeholder="如：第5题"
                />
              </div>
              <div className="editor-field editor-field--lg">
                <label>问题</label>
                <input
                  type="text"
                  value={formData.question || ''}
                  onChange={(e) => setFormData(prev => ({ ...prev, question: e.target.value }))}
                  placeholder="输入问题内容..."
                />
              </div>
              <div className="editor-field">
                <label>满分 *</label>
                <input
                  type="number"
                  value={formData.totalScore || ''}
                  onChange={(e) => setFormData(prev => ({ ...prev, totalScore: Number(e.target.value) }))}
                  min={1}
                />
              </div>
            </div>

            <div className="editor-field">
              <label><BookOpen size={14} /> 参考答案</label>
              <textarea
                value={formData.referenceAnswer || ''}
                onChange={(e) => setFormData(prev => ({ ...prev, referenceAnswer: e.target.value }))}
                placeholder="输入标准答案..."
                rows={4}
              />
            </div>

            <div className="editor-field">
              <label><FileText size={14} /> 其他要求（选填）</label>
              <textarea
                value={formData.otherRequirements || ''}
                onChange={(e) => setFormData(prev => ({ ...prev, otherRequirements: e.target.value }))}
                placeholder="输入其他评分要求，如：字数限制、格式要求、必须使用的术语等..."
                rows={3}
              />
            </div>

            {/* 评分细则：与测试流程一致，直接输入文字，无需分点 */}
            <div className="editor-field">
              <label><ListChecks size={14} /> 评分细则</label>
              <textarea
                value={rulesToText(formData.scoringRules)}
                onChange={(e) => setFormData(prev => ({ ...prev, scoringRules: e.target.value }))}
                placeholder={`直接写评分细则即可，例如：
满分 20 分。
1. 指出核心局限，观点明确（8 分）
2. 结合材料或史实举例说明（6 分）
3. 有对当代启示的阐述（6 分）
4. 完全未涉及制度层面分析，扣 3 分`}
                rows={6}
              />
              <p className="field-hint">
                直接输入文字即可，无需分点。这段内容会原样作为「评分细则」发给模型，
                用于逐条比对给分。
              </p>
            </div>

            {/* 学科（选填）：影响系统提示词的角色描述 */}
            <div className="editor-field">
              <label>学科（选填）</label>
              <select
                value={formData.subject || ''}
                onChange={(e) => setFormData(prev => ({ ...prev, subject: e.target.value === '通用' ? '' : e.target.value }))}
              >
                {SUBJECT_OPTIONS.map((opt) => (
                  <option key={opt} value={opt === '通用' ? '' : opt}>{opt}</option>
                ))}
              </select>
              <p className="field-hint">
                选择后，AI 收到的角色描述会变成「你是一名专业的XX批改老师」，例如选「语文」即以语文名师的视角判卷。
              </p>
            </div>

            {/* 过程分：可选开关。勾选后把说明写进评分细则文本，由用户自行修改或删除；
                不再作为独立规则段落注入，模型只认评分细则。 */}
            <div className="editor-field editor-field--inline">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={formData.processMatters ?? false}
                  onChange={(e) => setFormData(prev => {
                    const checked = e.target.checked
                    return {
                      ...prev,
                      processMatters: checked,
                      scoringRules: applyProcessCreditHint(prev.scoringRules, checked),
                    }
                  })}
                />
                <span>重视过程分（选填）：勾选后会在评分细则末尾加入一条步骤分说明</span>
              </label>
              <p className="field-hint">
                过程分不再是独立规则，而是写进评分细则一起发给模型，你可以直接修改或删除那一行。
                取消勾选不会自动删除，避免误伤已编辑的内容。
              </p>
            </div>
          </div>
        </motion.div>
      )}

      {/* 标准列表 */}
      <div className="standards-page__list">
        {standards.length === 0 ? (
          <div className="standards-page__empty">
            <BookOpen size={48} />
            <p>暂无评分标准</p>
            <span>点击上方"新建标准"按钮创建</span>
          </div>
        ) : (
          standards.map((standard) => (
            <motion.div
              key={standard.id}
              className="standard-card"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <div 
                className="standard-card__header"
                onClick={() => setExpandedId(expandedId === standard.id ? null : standard.id)}
              >
                <div className="standard-card__info">
                  <h4>{standard.name}</h4>
                  <div className="standard-card__meta">
                    {standard.questionNumber && (
                      <span className="tag tag--primary">{standard.questionNumber}</span>
                    )}
                    <span className="tag tag--success">满分{standard.totalScore}分</span>
                  </div>
                </div>
                <div className="standard-card__toggle">
                  {expandedId === standard.id ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
                </div>
              </div>

              {expandedId === standard.id && (
                <div className="standard-card__body">
                  <div className="standard-card__section">
                    <h5>参考答案</h5>
                    <p>{standard.referenceAnswer || '未填写'}</p>
                  </div>

                  {standard.subject && (
                    <div className="standard-card__section">
                      <h5>学科</h5>
                      <span className="keyword">{standard.subject}</span>
                    </div>
                  )}

                  {(() => {
                    const rulesText = rulesToText(standard.scoringRules).trim()
                    if (!rulesText) return null
                    return (
                      <div className="standard-card__section">
                        <h5>评分细则</h5>
                        <pre className="rules-text">{rulesText}</pre>
                      </div>
                    )
                  })()}
                </div>
              )}

              <div className="standard-card__actions">
                <button className="btn-icon" onClick={() => handleEdit(standard)} title="编辑">
                  <Edit3 size={16} />
                </button>
                <button className="btn-icon" onClick={() => handleDuplicate(standard.id)} title="复制">
                  <Copy size={16} />
                </button>
                <button className="btn-icon btn-icon--danger" onClick={() => handleDelete(standard.id)} title="删除">
                  <Trash2 size={16} />
                </button>
              </div>
            </motion.div>
          ))
        )}
      </div>
    </div>
  )
}
