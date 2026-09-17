import { useState, useRef } from 'react'
import { motion } from 'framer-motion'
import {
  Upload,
  Image as ImageIcon,
  FileText,
  Bot,
  CheckCircle,
  XCircle,
  Loader2,
  Trash2,
  Send,
  AlertCircle,
  Type,
  Eye,
  ClipboardList,
  Sparkles,
  Timer
} from 'lucide-react'
import toast from 'react-hot-toast'
import { useSettingsStore } from '@/store/settingsStore'
import { SUBJECT_OPTIONS } from './StandardsPage'
import { gradingBotProxy } from '@/services/playwrightProxy'
import AiAnalysisPanel from '@/components/grading/AiAnalysisPanel'
import './ApiTestPage.scss'

// P0 修复：API 测试改由主进程代理，渲染进程不接触 API Key

const api = typeof window !== 'undefined' && (window as any).electronAPI

export default function ApiTestPage() {
  // OCR 测试状态
  const [ocrImage, setOcrImage] = useState<string | null>(null)
  const [ocrImageName, setOcrImageName] = useState('')
  const [ocrLoading, setOcrLoading] = useState(false)
  const [ocrResult, setOcrResult] = useState('')
  const [ocrError, setOcrError] = useState('')
  const [ocrSuccess, setOcrSuccess] = useState<boolean | null>(null)
  const ocrFileRef = useRef<HTMLInputElement>(null)

  // DeepSeek 测试状态
  const [dsTestPrompt, setDsTestPrompt] = useState('请用一句话介绍你自己')
  const [dsResponse, setDsResponse] = useState('')

  // ===== 完整批改流程测试（图片 + 题目 + 评分规则 → 评分） =====
  const [flowImage, setFlowImage] = useState<string | null>(null)
  const [flowImageName, setFlowImageName] = useState('')
  const [flowQuestion, setFlowQuestion] = useState('')
  const [flowTotal, setFlowTotal] = useState('10')
  const [flowReference, setFlowReference] = useState('')
  // 评分规则：直接输入文字，无需分点（主进程支持字符串形态，会作为【评分规则】段传入）
  const [flowRulesText, setFlowRulesText] = useState('')
  // 学科（选填）：与正式批改一致，影响系统提示词角色
  const [flowSubject, setFlowSubject] = useState('')
  const [forceOcr, setForceOcr] = useState(false)
  const [flowLoading, setFlowLoading] = useState(false)
  const [flowResult, setFlowResult] = useState<null | {
    path: 'vision' | 'ocr'
    fallbackReason?: string
    ocrText?: string
    score: number
    comment: string
    reasoning?: string
    errorTags?: string[]
    rubricBreakdown?: Array<{ id: string; awarded: number }>
    needsHumanReview?: boolean
    elapsed: number
  }>(null)
  const [flowError, setFlowError] = useState('')
  const flowFileRef = useRef<HTMLInputElement>(null)
  const [dsLoading, setDsLoading] = useState(false)
  const [dsError, setDsError] = useState('')
  const [dsSuccess, setDsSuccess] = useState<boolean | null>(null)
  // 本次测试实际请求的目标（endpoint + 模型名），用于回显核对
  const [dsTarget, setDsTarget] = useState<{ endpoint: string; model: string } | null>(null)
  const [dsTime, setDsTime] = useState(0)

  // OCR 测试
  const handleOcrUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!file.type.startsWith('image/')) {
      toast.error('请选择图片文件')
      return
    }

    setOcrImageName(file.name)
    setOcrResult('')
    setOcrError('')
    setOcrSuccess(null)

    const reader = new FileReader()
    reader.onload = () => {
      setOcrImage(reader.result as string)
    }
    reader.readAsDataURL(file)
  }

  const handleOcrTest = async () => {
    if (!ocrImage) {
      toast.error('请先上传图片')
      return
    }

    // 检查 api 是否可用
    if (!api) {
      setOcrError('Electron API 未初始化，请重启应用')
      setOcrSuccess(false)
      toast.error('API 未初始化')
      return
    }

    setOcrLoading(true)
    setOcrResult('')
    setOcrError('')
    setOcrSuccess(null)

    try {
      console.log('开始 OCR 识别，图片大小:', ocrImage.length)
      const result = await api.invoke('bot:recognize', ocrImage)
      console.log('OCR 结果:', result)
      
      if (result.error) {
        setOcrError(result.error)
        setOcrSuccess(false)
      } else if (result.text && result.text.trim().length > 0) {
        setOcrResult(result.text)
        setOcrSuccess(true)
        toast.success('OCR 识别成功')
      } else {
        setOcrError(`未识别到文字内容 (isBlank: ${result.isBlank}, text: "${result.text}")`)
        setOcrSuccess(false)
      }
    } catch (error: any) {
      console.error('OCR 测试异常:', error)
      setOcrError(`调用失败: ${error.message || String(error)}`)
      setOcrSuccess(false)
      toast.error('OCR 测试失败')
    } finally {
      setOcrLoading(false)
    }
  }

  const handleOcrClear = () => {
    setOcrImage(null)
    setOcrImageName('')
    setOcrResult('')
    setOcrError('')
    setOcrSuccess(null)
    if (ocrFileRef.current) ocrFileRef.current.value = ''
  }

  /**
   * 完整批改流程测试：图片 + 题目 + 评分规则 → 评分
   * 与真实批改一致：先走图像直评，失败/结果不可解析自动回退 OCR + 文本评分
   */
  const handleFlowTest = async () => {
    if (!flowImage) {
      toast.error('请先上传答题图片')
      return
    }
    if (!flowQuestion.trim()) {
      toast.error('请填写题目')
      return
    }

    if (!flowRulesText.trim()) {
      toast.error('请填写评分规则')
      return
    }

    const totalScore = Number(flowTotal) || 10
    const standard = {
      id: 'test-standard',
      name: flowQuestion.trim().slice(0, 20),
      subject: flowSubject || undefined,
      question: flowQuestion.trim(),
      totalScore,
      // 字符串形态：主进程会渲染为【评分规则】段
      scoringRules: flowRulesText.trim(),
      referenceAnswer: flowReference.trim(),
      examples: [],
    }

    setFlowLoading(true)
    setFlowError('')
    setFlowResult(null)

    const t0 = Date.now()
    let fallbackReason: string | undefined
    let ocrText: string | undefined

    try {
      // ① 图像直评（首选）
      if (!forceOcr) {
        const vision = await gradingBotProxy.gradeImageWithStandard(flowImage, standard, [])
        if (vision?.ok && vision.result) {
          setFlowResult({
            path: 'vision',
            score: vision.result.score,
            comment: vision.result.comment,
            reasoning: vision.result.reasoning,
            errorTags: vision.result.errorTags,
            rubricBreakdown: vision.result.rubricBreakdown,
            needsHumanReview: vision.result.needsHumanReview,
            elapsed: Date.now() - t0,
          })
          toast.success(`图像直评完成：${vision.result.score} 分`)
          return
        }
        fallbackReason = vision?.reason || '未知原因'
      } else {
        fallbackReason = '测试时手动指定走 OCR 路径'
      }

      // ② 回退：OCR + 文本评分
      const ocr = await gradingBotProxy.recognizeText(flowImage)
      if (ocr?.error) {
        setFlowError(`OCR 识别失败：${ocr.error}`)
        toast.error('OCR 识别失败')
        return
      }
      ocrText = ocr.text || ''

      const graded = await gradingBotProxy.gradeWithStandard(ocrText, standard, [])
      setFlowResult({
        path: 'ocr',
        fallbackReason,
        ocrText,
        score: graded.score,
        comment: graded.comment,
        reasoning: graded.reasoning,
        errorTags: graded.errorTags,
        rubricBreakdown: graded.rubricBreakdown,
        needsHumanReview: graded.needsHumanReview,
        elapsed: Date.now() - t0,
      })
      toast.success(`OCR 兜底评分完成：${graded.score} 分`)
    } catch (err: any) {
      const msg = String(err?.message || err)
      setFlowError(msg)
      toast.error('批改流程测试失败')
    } finally {
      setFlowLoading(false)
    }
  }

  const handleFillSample = () => {
    setFlowSubject('历史')
    setFlowQuestion('请结合材料，分析洋务运动的历史局限性，并说明其对当代的启示。')
    setFlowTotal('20')
    setFlowReference('洋务运动只学西方技术而不变革制度，未触及封建制度根本，因此无法真正实现富强。')
    setFlowRulesText(
      '满分 20 分。1. 指出"只学技术不变制度"这一核心局限，观点明确（8 分）；' +
      '2. 能结合材料或史实举例说明（6 分）；' +
      '3. 有对当代启示的阐述（6 分）；' +
      '4. 完全未涉及制度层面分析，扣 3 分。'
    )
    toast.success('已填入示例题目与评分规则')
  }

  // 上传图片（拖拽/选择）
  const handleFlowUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast.error('请选择图片文件')
      return
    }
    setFlowImageName(file.name)
    setFlowResult(null)
    setFlowError('')
    const reader = new FileReader()
    reader.onload = () => setFlowImage(reader.result as string)
    reader.readAsDataURL(file)
  }

  // 测试 DeepSeek
  const handleDsTest = async () => {
    if (!dsTestPrompt.trim()) {
      toast.error('请输入测试内容')
      return
    }

    setDsLoading(true)
    setDsResponse('')
    setDsError('')
    setDsSuccess(null)
    setDsTime(0)
    setDsTarget(null)

    const startTime = Date.now()

    try {
      const settings = useSettingsStore.getState().settings
      // 修复：此前找不到激活服务商时会静默改测 providers[0]，导致"以为在测 A、实际测的是 B"
      //（例如明明配了 DeepSeek，实际请求发到了另一个服务商，出现"我是claude"这类答复）。
      // 现在找不到激活服务商时直接报错，绝不换服务商。
      const activeProvider = settings.providers.find(p => p.id === settings.activeProviderId)

      if (!activeProvider) {
        setDsError('未找到当前激活的服务商配置（可能已被删除或切换失败），请到「设置 → AI 配置」重新选择激活服务商后重试')
        setDsSuccess(false)
        setDsLoading(false)
        return
      }

      if (!activeProvider.endpoint) {
        setDsError('未配置服务商的 API Endpoint，请先在设置中填写服务商地址')
        setDsSuccess(false)
        setDsLoading(false)
        return
      }

      // P0 修复：通过主进程代理执行 API 测试，渲染进程不接触 API Key
      if (!api?.testApi) {
        setDsError('Electron API 未初始化，请重启应用')
        setDsSuccess(false)
        setDsLoading(false)
        return
      }

      setDsTarget({ endpoint: activeProvider.endpoint, model: activeProvider.model })

      const result = await api.testApi({
        providerId: activeProvider.id,
        endpoint: activeProvider.endpoint,
        // 修复：不再 fallback 成 deepseek-chat，否则会把 deepseek 的模型名发到其他厂商
        model: activeProvider.model || '',
        prompt: dsTestPrompt,
        temperature: settings.temperature || 0.7,
        // 修复：此前硬编码 200，思考模式会先用思维链耗尽输出额度，导致正文为空
        // （表现为只回 "(测试响应)" 或评分没有依据）
        maxTokens: settings.maxTokens || 4000,
      })

      const elapsed = Date.now() - startTime
      setDsTime(elapsed)

      if (result.error) {
        setDsError(result.error)
        setDsSuccess(false)
        toast.error(`API 测试失败 (${(elapsed / 1000).toFixed(1)}s)`)
      } else if (result.success) {
        setDsResponse(result.content)
        setDsSuccess(true)
        toast.success(`API 调用成功 (${(elapsed / 1000).toFixed(1)}s)`)
      }
    } catch (error: any) {
      setDsError(String(error))
      setDsSuccess(false)
      setDsTime(Date.now() - startTime)
      toast.error('DeepSeek API 测试失败')
    } finally {
      setDsLoading(false)
    }
  }

  return (
    <div className="api-test-page">
      <div className="page-header">
        <h1>
          <Bot size={28} />
          API 测试
        </h1>
        <p>测试 OCR 和 DeepSeek API 是否正常工作</p>
      </div>

      <div className="test-grid">
        {/* 完整批改流程测试卡片 */}
        <motion.div
          className="test-card test-card--flow"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0 }}
        >
          <div className="test-card__header">
            <div className="test-card__title">
              <ClipboardList size={20} />
              <h2>完整批改流程测试</h2>
            </div>
            <div className="test-card__header-actions">
              <button className="btn btn--ghost btn--sm" onClick={handleFillSample} title="填入示例题目与规则">
                <Sparkles size={13} />
                填入示例
              </button>
              <span className="test-card__badge">图片 + 题目 + 规则 → 评分</span>
            </div>
          </div>

          <div className="test-card__body">
            {/* 图片上传 */}
            <div className="flow-section">
              <div className="flow-section__label">
                <ImageIcon size={14} /> 答题图片
              </div>
              {flowImage ? (
                <div className="upload-preview">
                  <img src={flowImage} alt="preview" />
                  <div className="upload-preview__info">
                    <span>{flowImageName}</span>
                    <button
                      onClick={() => { setFlowImage(null); setFlowImageName(''); setFlowResult(null); if (flowFileRef.current) flowFileRef.current.value = '' }}
                      className="btn-icon"
                      title="清除"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ) : (
                <label className="upload-placeholder upload-placeholder--sm">
                  <Upload size={26} />
                  <span>点击上传学生作答图片</span>
                  <small>支持 JPG、PNG、BMP</small>
                  <input ref={flowFileRef} type="file" accept="image/*" onChange={handleFlowUpload} style={{ display: 'none' }} />
                </label>
              )}
            </div>

            {/* 题目 */}
            <div className="input-group">
              <label>
                <Type size={14} />
                题目
              </label>
              <textarea
                value={flowQuestion}
                onChange={(e) => setFlowQuestion(e.target.value)}
                placeholder="输入完整题目，例如：请结合材料分析洋务运动的历史局限性..."
                rows={3}
                disabled={flowLoading}
              />
            </div>

            {/* 输入顺序与正式批改完全一致：学科 → 题目 → 满分 → 参考答案 → 评分细则 */}
            <div className="input-group">
              <label>学科（选填）</label>
              <select
                value={flowSubject}
                onChange={(e) => setFlowSubject(e.target.value === '通用' ? '' : e.target.value)}
                disabled={flowLoading}
              >
                {SUBJECT_OPTIONS.map((opt) => (
                  <option key={opt} value={opt === '通用' ? '' : opt}>{opt}</option>
                ))}
              </select>
            </div>

            <div className="input-group input-group--xs">
              <label>满分</label>
              <input
                type="number"
                value={flowTotal}
                onChange={(e) => setFlowTotal(e.target.value)}
                disabled={flowLoading}
              />
            </div>

            <div className="input-group">
              <label>参考答案（选填）</label>
              <textarea
                value={flowReference}
                onChange={(e) => setFlowReference(e.target.value)}
                placeholder="输入参考答案，有助于模型判分"
                rows={2}
                disabled={flowLoading}
              />
            </div>

            {/* 评分规则（单个文本框，无需分点） */}
            <div className="input-group">
              <label>
                <FileText size={14} />
                评分规则
              </label>
              <textarea
                value={flowRulesText}
                onChange={(e) => setFlowRulesText(e.target.value)}
                placeholder={`直接写评分规则即可，例如：
满分 20 分。
1. 指出核心局限（8分）
2. 结合材料举例（6分）
3. 谈当代启示（6分）
4. 未涉及制度层面分析，扣3分`}
                rows={6}
                disabled={flowLoading}
              />
            </div>

            {/* 强制 OCR 对比 */}
            <label className="flow-checkbox">
              <input
                type="checkbox"
                checked={forceOcr}
                onChange={(e) => setForceOcr(e.target.checked)}
                disabled={flowLoading}
              />
              <span>强制走 OCR 路径（用于对比两种方案的评分差异）</span>
            </label>

            <button
              className="btn btn-primary btn-block"
              onClick={handleFlowTest}
              disabled={!flowImage || flowLoading}
            >
              {flowLoading ? <Loader2 size={16} className="spin" /> : <Send size={16} />}
              {flowLoading ? '批改中...' : '开始批改'}
            </button>

            {/* 结果 */}
            {flowError && (
              <div className="test-result error">
                <div className="test-result__header">
                  <XCircle size={16} />
                  <span>批改失败</span>
                </div>
                <div className="test-result__error">
                  <AlertCircle size={14} />
                  <p>{flowError}</p>
                </div>
              </div>
            )}

            {flowResult && (
              <motion.div
                className="flow-result"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
              >
                <div className="flow-result__score">
                  <div className="flow-result__number">{flowResult.score}</div>
                  <div className="flow-result__total">/ {flowTotal} 分</div>
                  <span className={`flow-result__path flow-result__path--${flowResult.path}`}>
                    {flowResult.path === 'vision' ? '图像直评' : 'OCR 兜底'}
                  </span>
                </div>

                <div className="flow-result__meta">
                  <span><Timer size={12} /> 耗时 {(flowResult.elapsed / 1000).toFixed(2)}s</span>
                  {flowResult.fallbackReason && (
                    <span className="flow-result__reason">切换原因：{flowResult.fallbackReason}</span>
                  )}
                </div>

                {flowResult.comment && <div className="flow-result__comment">{flowResult.comment}</div>}

                {flowResult.reasoning && (
                  <div className="flow-result__reasoning">
                    <div className="flow-result__reasoning-label">评分依据</div>
                    <p>{flowResult.reasoning}</p>
                  </div>
                )}

                <AiAnalysisPanel
                  analysis={{
                    breakdown: flowResult.rubricBreakdown || [],
                    errorTags: flowResult.errorTags || [],
                    reasoning: flowResult.reasoning,
                    needsHumanReview: flowResult.needsHumanReview === true,
                  }}
                />

                {flowResult.ocrText !== undefined && (
                  <details className="flow-result__ocr">
                    <summary>查看 OCR 识别文本（{flowResult.ocrText.length} 字）</summary>
                    <pre>{flowResult.ocrText || '（空）'}</pre>
                  </details>
                )}
              </motion.div>
            )}
          </div>
        </motion.div>

        {/* OCR 测试卡片 */}
        <motion.div
          className="test-card"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0 }}
        >
          <div className="test-card__header">
            <div className="test-card__title">
              <Eye size={20} />
              <h2>OCR 文字识别测试</h2>
            </div>
            <span className="test-card__badge">{useSettingsStore.getState().settings.paddleOcrModel || 'PaddleOCR-VL-1.6'}</span>
          </div>

          <div className="test-card__body">
            {/* 上传区域 */}
            <div className="upload-area">
              {ocrImage ? (
                <div className="upload-preview">
                  <img src={ocrImage} alt="preview" />
                  <div className="upload-preview__info">
                    <span>{ocrImageName}</span>
                    <button onClick={handleOcrClear} className="btn-icon" title="清除">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ) : (
                <label className="upload-placeholder">
                  <Upload size={32} />
                  <span>点击或拖拽上传图片</span>
                  <small>支持 JPG、PNG、BMP 格式</small>
                  <input
                    ref={ocrFileRef}
                    type="file"
                    accept="image/*"
                    onChange={handleOcrUpload}
                    style={{ display: 'none' }}
                  />
                </label>
              )}
            </div>

            {/* 测试按钮 */}
            <button
              className="btn btn-primary btn-block"
              onClick={handleOcrTest}
              disabled={!ocrImage || ocrLoading}
            >
              {ocrLoading ? <Loader2 size={16} className="spin" /> : <ImageIcon size={16} />}
              {ocrLoading ? '识别中...' : '开始识别'}
            </button>

            {/* 结果区域 */}
            {(ocrResult || ocrError || ocrSuccess !== null) && (
              <motion.div
                className={`test-result ${ocrSuccess ? 'success' : ocrSuccess === false ? 'error' : ''}`}
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
              >
                <div className="test-result__header">
                  {ocrSuccess === true && <CheckCircle size={16} />}
                  {ocrSuccess === false && <XCircle size={16} />}
                  <span>{ocrSuccess ? '识别成功' : '识别失败'}</span>
                </div>
                {ocrResult && (
                  <div className="test-result__content">
                    <FileText size={14} />
                    <p>{ocrResult}</p>
                  </div>
                )}
                {ocrError && (
                  <div className="test-result__error">
                    <AlertCircle size={14} />
                    <p>{ocrError}</p>
                  </div>
                )}
              </motion.div>
            )}
          </div>
        </motion.div>

        {/* DeepSeek 测试卡片 */}
        <motion.div
          className="test-card"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <div className="test-card__header">
            <div className="test-card__title">
              <Bot size={20} />
              <h2>LLM API 测试</h2>
            </div>
            <span className="test-card__badge">
              {(() => {
                const s = useSettingsStore.getState().settings
                const p = s.providers.find(x => x.id === s.activeProviderId) || s.providers[0]
                return p ? `${p.name || p.id}${p.model ? ` · ${p.model}` : '（未填模型）'}` : '未配置'
              })()}
            </span>
          </div>

          <div className="test-card__body">
            {/* 输入区域 */}
            <div className="input-group">
              <label>
                <Type size={14} />
                测试提示词
              </label>
              <textarea
                value={dsTestPrompt}
                onChange={(e) => setDsTestPrompt(e.target.value)}
                placeholder="输入测试内容..."
                rows={3}
                disabled={dsLoading}
              />
            </div>

            {/* 测试按钮 */}
            <button
              className="btn btn-primary btn-block"
              onClick={handleDsTest}
              disabled={!dsTestPrompt.trim() || dsLoading}
            >
              {dsLoading ? <Loader2 size={16} className="spin" /> : <Send size={16} />}
              {dsLoading ? '调用中...' : '发送测试'}
            </button>

            {/* 响应时间 */}
            {dsTime > 0 && (
              <div className="response-time">
                响应时间：{(dsTime / 1000).toFixed(2)}s
              </div>
            )}

            {/* 结果区域 */}
            {(dsResponse || dsError || dsSuccess !== null) && (
              <motion.div
                className={`test-result ${dsSuccess ? 'success' : dsSuccess === false ? 'error' : ''}`}
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
              >
                <div className="test-result__header">
                  {dsSuccess === true && <CheckCircle size={16} />}
                  {dsSuccess === false && <XCircle size={16} />}
                  <span>{dsSuccess ? '调用成功' : '调用失败'}</span>
                </div>
                {dsResponse && (
                  <div className="test-result__content">
                    <Bot size={14} />
                    <p>{dsResponse}</p>
                  </div>
                )}
                {dsTarget && (
                  <div className="ds-request-target">
                    本次请求：{dsTarget.endpoint} · 模型：{dsTarget.model || '（未填写）'}
                    <br />
                    若答复内容与该模型不符（如自称其他厂商），说明该地址并非官方接口，或服务商做了模型映射，请核对外发地址。
                  </div>
                )}

                {dsError && (
                  <div className="test-result__error">
                    <AlertCircle size={14} />
                    <p>{dsError}</p>
                  </div>
                )}
              </motion.div>
            )}
          </div>
        </motion.div>
      </div>
    </div>
  )
}
