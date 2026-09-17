/**
 * 系统设置页面 - 完整功能版
 * 支持 AI配置、OCR配置、评分标准、导出设置、界面设置、帮助与支持
 */

import { useState, useEffect, useMemo, useRef } from 'react'
import { motion } from 'framer-motion'
import {
  Save, RotateCcw, Check, RefreshCw,
  Eye, Type, Palette, Settings, Cpu, ScanLine,
  FileText, Download, Monitor, HelpCircle, Code, TestTube, Plus, Trash2
} from 'lucide-react'
import toast from 'react-hot-toast'
import { useSettingsStore } from '@/store/settingsStore'
import { useSound } from '@/hooks/useSound'
import type { ThemeCustomConfig, AiProvider } from '@/types'
import { PRESET_THEMES } from '@/utils/themeGenerator'
import {
  PROVIDER_PRESETS,
  ProviderPreset,
  buildProviderId,
  guessPresetByProviderId,
} from '@/utils/aiProviders'
import UpdateChecker from '@/components/common/UpdateChecker'
import './SettingsPage.scss'

// ===========================================
// Tab 定义
// ===========================================
const SETTINGS_TABS = [
  { id: 'ai', label: 'AI 配置', icon: <Cpu size={16} /> },
  { id: 'ocr', label: 'OCR 配置', icon: <ScanLine size={16} /> },
  { id: 'standards', label: '评分标准', icon: <FileText size={16} /> },
  { id: 'export', label: '导出设置', icon: <Download size={16} /> },
  { id: 'ui', label: '界面设置', icon: <Monitor size={16} /> },
  { id: 'help', label: '帮助与支持', icon: <HelpCircle size={16} /> },
] as const

type TabId = typeof SETTINGS_TABS[number]['id']

// ===========================================
// 主组件
// ===========================================
export default function SettingsPage() {
  const { settings, updateSettings, resetSettings } = useSettingsStore()
  const { playSuccess, playClick } = useSound()

  const [activeTab, setActiveTab] = useState<TabId>('ai')
  const [hasChanges, setHasChanges] = useState(false)
  const [saving, setSaving] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  // 表单状态（本地，保存时写入 store）
  const [formData, setFormData] = useState({
    providers: settings.providers || [],
    paddleOcrToken: settings.paddleOcrToken || '',
    paddleOcrUrl: settings.paddleOcrUrl || 'https://paddleocr.aistudio-app.com',
    paddleOcrModel: settings.paddleOcrModel || 'PaddleOCR-VL-1.6',
    paddleOcrEnabled: settings.paddleOcrEnabled ?? false,
    defaultExportFormat: settings.defaultExportFormat || 'pdf',
    exportIncludeImages: settings.exportIncludeImages ?? true,
    exportFileNameTemplate: settings.exportFileNameTemplate || '{日期}_{考试名称}_批改结果',
    themeCustom: settings.themeCustom || { presetTheme: 'blue', primaryColor: '#1976d2', mode: 'light', fontSize: 3, highContrast: false },
    devMode: settings.devMode || false,
    soundEnabled: settings.soundEnabled ?? true,
  })

  // 同步 store -> formData（重置时）
  // 注意：存在未保存编辑时跳过同步，避免用户正在输入的内容被覆盖
  useEffect(() => {
    if (dirtyRef.current) return
    setFormData({
      providers: settings.providers || [],
      paddleOcrToken: settings.paddleOcrToken || '',
      paddleOcrUrl: settings.paddleOcrUrl || 'https://paddleocr.aistudio-app.com',
      paddleOcrModel: settings.paddleOcrModel || 'PaddleOCR-VL-1.6',
      defaultExportFormat: settings.defaultExportFormat || 'pdf',
      exportIncludeImages: settings.exportIncludeImages ?? true,
      exportFileNameTemplate: settings.exportFileNameTemplate || '{日期}_{考试名称}_批改结果',
      themeCustom: settings.themeCustom || { presetTheme: 'blue', primaryColor: '#1976d2', mode: 'light', fontSize: 3, highContrast: false },
      devMode: settings.devMode || false,
      soundEnabled: settings.soundEnabled ?? true,
      paddleOcrEnabled: settings.paddleOcrEnabled ?? false,
    })
  }, [settings])

  // 标记有变更
  // 有未保存编辑时，禁止 settings 变化反向覆盖表单（例如「设为当前」会立刻更新 store）
  const dirtyRef = useRef(false)
  const markChanged = () => {
    dirtyRef.current = true
    setHasChanges(true)
  }

  // 保存设置
  const handleSave = async () => {
    setSaving(true)
    try {
      await updateSettings({
        providers: formData.providers,
        paddleOcrToken: formData.paddleOcrToken,
        paddleOcrUrl: formData.paddleOcrUrl,
        paddleOcrModel: formData.paddleOcrModel,
        defaultExportFormat: formData.defaultExportFormat,
        exportIncludeImages: formData.exportIncludeImages,
        exportFileNameTemplate: formData.exportFileNameTemplate,
        themeCustom: formData.themeCustom,
        devMode: formData.devMode,
        soundEnabled: formData.soundEnabled,
        paddleOcrEnabled: formData.paddleOcrEnabled ?? false,
      })
      playSuccess()
      toast.success('设置已保存')
      setHasChanges(false)
      dirtyRef.current = false
    } catch (err: any) {
      toast.error('保存失败：' + (err.message || '未知错误'))
    } finally {
      setSaving(false)
    }
  }

  const handleReset = () => {
    playClick()
    if (confirm('确定要重置所有设置为默认值吗？')) {
      resetSettings()
      toast.success('设置已重置')
      playSuccess()
      setHasChanges(false)
      dirtyRef.current = false
    }
  }

  // 根据 searchQuery 过滤 tabs
  const filteredTabs = useMemo(() => {
    if (!searchQuery) return SETTINGS_TABS
    const q = searchQuery.toLowerCase()
    return SETTINGS_TABS.filter(t => t.label.toLowerCase().includes(q))
  }, [searchQuery])

  return (
    <div className="settings-page">
      {/* 页面头部 */}
      <div className="settings-page__header">
        <div>
          <h1 className="settings-page__title">系统设置</h1>
          <p className="settings-page__subtitle">自定义你的批改工具体验</p>
        </div>
        <div className="settings-page__actions">
          <button className="btn btn--secondary" onClick={handleReset}>
            <RotateCcw size={16} />
            重置所有
          </button>
          <button className="btn btn--primary" onClick={handleSave} disabled={!hasChanges || saving}>
            <Save size={16} />
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>

      {/* 主体：左侧导航 + 右侧内容 */}
      <div className="settings-page__body">
        {/* 左侧导航栏 */}
        <nav className="settings-nav">
          {/* 搜索框 */}
          <div className="settings-search">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
            <input
              type="text"
              placeholder="搜索设置..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button className="clear-btn" onClick={() => setSearchQuery('')}>×</button>
            )}
          </div>

          {/* 导航项 */}
          {filteredTabs.map(tab => (
            <button
              key={tab.id}
              className={`settings-nav__item${activeTab === tab.id ? ' settings-nav__item--active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </nav>

        {/* 右侧内容区 */}
        <div className="settings-content">
          {activeTab === 'ai' && (
            <AiConfigSection
              formData={formData}
              setFormData={setFormData}
              markChanged={markChanged}
            />
          )}
          {activeTab === 'ocr' && (
            <OcrConfigSection
              formData={formData}
              setFormData={setFormData}
              markChanged={markChanged}
            />
          )}
          {activeTab === 'standards' && <StandardsSection />}
          {activeTab === 'export' && (
            <ExportSection
              formData={formData}
              setFormData={setFormData}
              markChanged={markChanged}
            />
          )}
          {activeTab === 'ui' && (
            <UiSettingsSection
              formData={formData}
              setFormData={setFormData}
              markChanged={markChanged}
              setHasChanges={setHasChanges}
            />
          )}
          {activeTab === 'help' && <HelpSection />}
        </div>
      </div>
    </div>
  )
}

// ===========================================
// AI 配置 Section
// ===========================================
interface SectionProps {
  formData: any
  setFormData: (fn: (prev: any) => any) => void
  markChanged: () => void
}

// API Key 前缀常量（与 settingsStore.ts 保持一致）
const API_KEY_PREFIX = 'apikey_'
const SECURED_API_KEY = '__SECURED__'

function AiConfigSection({ formData, setFormData, markChanged }: SectionProps) {
  const { settings, setActiveProvider, updateSettings } = useSettingsStore()
  const [testing, setTesting] = useState<string | null>(null)

  const providers: AiProvider[] = formData.providers || []
  const activeId = settings.activeProviderId

  const handleUpdateProvider = (id: string, updates: Partial<AiProvider>) => {
    setFormData(prev => ({
      ...prev,
      providers: prev.providers.map((p: AiProvider) =>
        p.id === id ? { ...p, ...updates } : p
      )
    }))
    markChanged()
  }

  const handleDeleteProvider = (id: string) => {
    if (!confirm('确定要删除这个服务商配置吗？')) return
    setFormData(prev => ({
      ...prev,
      providers: prev.providers.filter((p: AiProvider) => p.id !== id)
    }))
    markChanged()
  }

  /**
   * 设为当前使用的服务商（立即同步到主进程，无需等保存）
   * 修复：此前页面只有 isActive 开关，而真正生效的是 activeProviderId，
   *       导致"切换服务商"永远不生效，实际始终用默认的 deepseek。
   */
  const handleSetActive = async (id: string) => {
    const nextProviders = providers.map((p: AiProvider) => ({ ...p, isActive: p.id === id }))
    setFormData(prev => ({ ...prev, providers: nextProviders }))
    markChanged()

    // 先落库：保证新建/刚编辑的服务商已同步到主进程，
    // 否则主进程找不到该 id 会回落到列表第一个（默认 deepseek）
    // 修复：主进程若因安全校验拒绝该配置，updateSettings 会抛错；
    // 若此处不捕获，会变成未处理的 promise 拒绝，且 setActiveProvider/成功提示被跳过 →
    // 用户点「设为当前」毫无反应、也无提示。
    try {
      await updateSettings({ providers: nextProviders })
    } catch (e: any) {
      toast.error('切换失败：' + (e?.message || '未知错误'))
      return
    }
    setActiveProvider(id)

    const target = nextProviders.find(p => p.id === id)
    toast.success(`已切换当前服务商：${target?.name || id}`)
  }

  const handleAddPreset = (preset: ProviderPreset) => {
    const id = buildProviderId(preset.key)
    setFormData(prev => ({
      ...prev,
      providers: [...prev.providers, {
        id,
        name: preset.name,
        endpoint: preset.endpoint,
        apiKey: '',
        model: preset.model,
        // 视觉模型：预设显式配置优先，否则跟随主模型（全能模型如 deepseek-flash 无需分设）
        visionModel: preset.visionModel || preset.model,
        // 思考模式参数：仅 DeepSeek 等支持的厂商在预设里声明
        thinkingEnabled: preset.thinkingEnabled,
        reasoningEffort: preset.reasoningEffort,
        isActive: false,
      }]
    }))
    markChanged()
    toast.success(`已添加「${preset.name}」，填好 Key 后点「测试连接」`)
  }

  // 用户新输入但还没保存的 Key，先落安全存储，保证测试连接可用
  const ensureApiKeySaved = async (provider: AiProvider) => {
    const api = window.electronAPI as any
    if (
      provider.apiKey &&
      provider.apiKey.trim() !== '' &&
      provider.apiKey !== SECURED_API_KEY &&
      api?.secureStorage
    ) {
      try {
        await api.secureStorage.set(`${API_KEY_PREFIX}${provider.id}`, provider.apiKey.trim())
        handleUpdateProvider(provider.id, { apiKey: SECURED_API_KEY })
      } catch {
        // 忽略存储错误，继续
      }
    }
  }

  const handleTestConnection = async (provider: AiProvider) => {
    if (!provider.endpoint || provider.endpoint.trim() === '') {
      toast.error('请先填写 API 地址再测试连接')
      return
    }
    if (!provider.model || provider.model.trim() === '') {
      toast.error('请先填写模型名称')
      return
    }

    const api = window.electronAPI as any
    if (!api?.testApi) {
      toast.error('Electron API 未初始化，请重启应用')
      return
    }

    await ensureApiKeySaved(provider)

    setTesting(provider.id)
    try {
      const result = await api.testApi({
        providerId: provider.id,
        endpoint: provider.endpoint,
        model: provider.model,
        prompt: 'Hello',
        temperature: 0.7,
        // 修复：此前只给 10 个 token，且从不透传思考开关。DeepSeek 服务端默认开启思考模式，
        // 10 个 token 会被思维链耗尽、正文为空，报错却让用户去"关闭思考模式"（他其实早已关掉）。
        // 这里复用设置里的 maxTokens（默认 4000）作为兜底，并把思考开关一并透传给主进程。
        maxTokens: settings.maxTokens || 4000,
        thinkingEnabled: provider.thinkingEnabled,
        reasoningEffort: provider.reasoningEffort,
      })

      if (result.success) {
        toast.success(`连接成功！模型：${provider.model}`)
      } else {
        toast.error(`连接失败：${result.error}`)
      }
    } catch (err: any) {
      toast.error('测试失败：' + (err.message || '网络错误'))
    } finally {
      setTesting(null)
    }
  }

  // 预设厂商的常见模型（仅供参考，模型名以服务商控制台为准，随时可手输新模型）
  const getModelHints = (provider: AiProvider): string[] => {
    return guessPresetByProviderId(provider.id)?.models || []
  }

  return (
    <motion.div
      className="settings-section"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <h2>模型配置</h2>
      <p className="section-desc">
        点击预设按钮即可新增一组配置（地址与默认模型自动填好）；各组配置相互独立，可分别编辑、删除，「设为当前」的即为批改所用。
      </p>

      {/* 预设供应商按钮：点击在下方新增一组输入 */}
      <div className="preset-bar">
        {PROVIDER_PRESETS.map(preset => (
          <button
            key={preset.key}
            className="preset-bar__btn"
            onClick={() => handleAddPreset(preset)}
            title={preset.note || preset.endpoint || '自定义 OpenAI 兼容接口'}
          >
            <Plus size={14} />
            {preset.name}
          </button>
        ))}
      </div>
      <p className="field-hint preset-bar__tip">
        API Key 仅存储在本地，不会上传到任何服务器；模型名随时手输，新模型直接填写即可。
      </p>

      {/* 配置组列表 */}
      <div className="provider-list">
        {providers.map((provider: AiProvider) => {
          const isCurrent = provider.id === activeId
          const hints = getModelHints(provider)
          const endpointPreview = (provider.endpoint || '').replace(/\/+$/, '')
          const requestUrl = endpointPreview
            ? (endpointPreview.endsWith('/chat/completions') ? endpointPreview : `${endpointPreview}/chat/completions`)
            : ''

          return (
            <div key={provider.id} className={`provider-card${isCurrent ? ' provider-card--active' : ''}`}>
              <div className="provider-card__header">
                <div className="provider-card__title">
                  <Settings size={18} />
                  <input
                    className="provider-card__name"
                    type="text"
                    value={provider.name}
                    onChange={(e) => handleUpdateProvider(provider.id, { name: e.target.value })}
                    placeholder="服务商名称"
                  />
                </div>
                <span className={`provider-card__badge${isCurrent ? '' : ' provider-card__badge--disabled'}`}>
                  {isCurrent ? '当前使用' : '未启用'}
                </span>
              </div>

              {isCurrent && (() => {
                const missing: string[] = []
                if (!(provider.endpoint || '').trim()) missing.push('API 地址')
                if (!(provider.model || '').trim()) missing.push('模型名')
                const keyOk = provider.apiKey === SECURED_API_KEY || (provider.apiKey || '').trim() !== ''
                if (!keyOk) missing.push('API Key')
                return (
                  <p className={`provider-card__status${missing.length ? ' provider-card__status--warn' : ''}`}>
                    {missing.length
                      ? `配置不完整，缺少：${missing.join('、')}，批改会退化为本地评分`
                      : `配置完整，批改时将调用 ${provider.model}，切换立即生效`}
                  </p>
                )
              })()}

              <div className="provider-card__body">
                <div className="provider-field">
                  <label><Code size={14} /> API 地址</label>
                  <input
                    type="text"
                    value={provider.endpoint}
                    onChange={(e) => handleUpdateProvider(provider.id, { endpoint: e.target.value })}
                    placeholder="https://api.deepseek.com/v1"
                  />
                  <p className="field-hint">
                    {requestUrl ? `请求地址：${requestUrl}` : '支持 base 地址（如 https://x/v1）或完整 /chat/completions 地址'}
                  </p>
                </div>

                <div className="provider-field">
                  <label><Code size={14} /> API Key</label>
                  <input
                    type="password"
                    className="input-api"
                    value={provider.apiKey === SECURED_API_KEY ? '' : provider.apiKey}
                    onChange={(e) => handleUpdateProvider(provider.id, { apiKey: e.target.value })}
                    placeholder={
                      provider.apiKey === SECURED_API_KEY
                        ? '已保存，留空表示不修改；重新输入可覆盖'
                        : 'sk-...'
                    }
                  />
                </div>

                <div className="provider-field">
                  <label><Code size={14} /> 模型名称</label>
                  <input
                    type="text"
                    value={provider.model}
                    onChange={(e) => handleUpdateProvider(provider.id, { model: e.target.value })}
                    placeholder="deepseek-chat"
                  />
                  <p className="field-hint">
                    文本模型：OCR 兜底路径使用。模型名手填，必填；留空会退化为本地评分。
                    {hints.length > 0 && ` 该厂商常见：${hints.join('、')}（以官方控制台为准）`}
                  </p>
                </div>

                <div className="provider-field">
                  <label><Code size={14} /> 视觉模型名称（选填）</label>
                  <input
                    type="text"
                    value={provider.visionModel || ''}
                    onChange={(e) => handleUpdateProvider(provider.id, { visionModel: e.target.value })}
                    placeholder="deepseek-flash"
                  />
                  <p className="field-hint">
                    图像直评（首选路径）使用，必须支持图片输入。
                    <strong>若你的模型同时支持文本和图像（如 deepseek-flash），这里填同一个名字即可</strong>，留空则自动跟随上面的模型；
                    若模型不支持图片，会自动切换到 OCR 兜底并在日志中记录原因。
                  </p>
                </div>
                <div className="provider-field provider-field--inline">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={provider.thinkingEnabled === true}
                      onChange={(e) => handleUpdateProvider(provider.id, { thinkingEnabled: e.target.checked })}
                    />
                    <span>
                      开启思考模式（DeepSeek）
                      {provider.thinkingEnabled === true && ' · 注意：开启后 temperature 会被忽略，同卷同分保证会减弱'}
                    </span>
                  </label>
                </div>

                <div className="provider-field">
                  <label><Code size={14} /> 推理强度（选填）</label>
                  <select
                    value={provider.reasoningEffort || ''}
                    onChange={(e) => handleUpdateProvider(provider.id, {
                      reasoningEffort: (e.target.value || undefined) as 'low' | 'high' | 'max' | undefined
                    })}
                  >
                    <option value="">不传（跟随服务端默认）</option>
                    <option value="low">low · 轻度推理，快</option>
                    <option value="high">high · 增强推理（默认）</option>
                    <option value="max">max · 深度推理，慢但更准</option>
                  </select>
                  <p className="field-hint">仅 DeepSeek 支持；其他服务商请留空，避免接口报参数错误。</p>
                </div>
              </div>

              <div className="provider-card__actions">
                <button
                  className="btn btn--primary btn--sm"
                  onClick={() => handleSetActive(provider.id)}
                  disabled={isCurrent}
                >
                  <Check size={14} />
                  {isCurrent ? '当前使用中' : '设为当前'}
                </button>
                <button
                  className="btn btn--secondary btn--sm"
                  onClick={() => handleTestConnection(provider)}
                  disabled={testing === provider.id}
                >
                  <TestTube size={14} />
                  {testing === provider.id ? '测试中...' : '测试连接'}
                </button>
                <button
                  className="btn btn--danger btn--sm"
                  onClick={() => handleDeleteProvider(provider.id)}
                >
                  <Trash2 size={14} />
                  删除
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </motion.div>
  )
}

// ===========================================
// OCR 配置 Section
// ===========================================
function OcrConfigSection({ formData, setFormData, markChanged }: SectionProps) {
  return (
    <motion.div
      className="settings-section"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <h2>OCR 识别配置</h2>
      <p className="section-desc">配置 PaddleOCR 或其他 OCR 服务，用于识别学生作答内容。</p>

      <div className="setting-item">
        <div className="setting-item__info">
          <h4>启用 OCR 识别</h4>
          <p>开启后，系统将使用 OCR 服务识别学生作答内容</p>
        </div>
        <div className="setting-item__control">
          <label className="toggle">
            <input
              type="checkbox"
              checked={formData.paddleOcrEnabled ?? false}
              onChange={(e) => {
                setFormData(prev => ({ ...prev, paddleOcrEnabled: e.target.checked }))
                markChanged()
              }}
            />
            <span className="toggle__slider"></span>
          </label>
        </div>
      </div>

      <div className="setting-item">
        <div className="setting-item__info">
          <h4><ScanLine size={14} /> OCR 模型名称</h4>
          <p>手填模型名，新模型发布后直接填写即可（推荐 PaddleOCR-VL-1.6）</p>
        </div>
        <div className="setting-item__control">
          <input
            type="text"
            value={formData.paddleOcrModel}
            onChange={(e) => {
              setFormData(prev => ({ ...prev, paddleOcrModel: e.target.value }))
              markChanged()
            }}
            placeholder="PaddleOCR-VL-1.6"
          />
        </div>
      </div>

      <div className="setting-item">
        <div className="setting-item__info">
          <h4>Token / API Key</h4>
          <p>用于身份验证的密钥（加密保存在本地安全存储，不会明文写入配置文件）</p>
        </div>
        <div className="setting-item__control setting-item__control--wide">
          <input
            type="password"
            value={formData.paddleOcrToken === SECURED_API_KEY ? '' : formData.paddleOcrToken}
            onChange={(e) => {
              setFormData(prev => ({ ...prev, paddleOcrToken: e.target.value }))
              markChanged()
            }}
            placeholder={
              formData.paddleOcrToken === SECURED_API_KEY
                ? '已保存（••••••••），留空表示不修改；重新输入可覆盖'
                : '输入 Token 或 API Key'
            }
          />
          {formData.paddleOcrToken === SECURED_API_KEY && (
            <p className="field-hint">Token 已保存到安全存储；出于安全考虑不再回显原文，留空即保持不变。</p>
          )}
        </div>
      </div>

      <div className="setting-item">
        <div className="setting-item__info">
          <h4>服务地址</h4>
          <p>OCR 服务的 URL 地址</p>
        </div>
        <div className="setting-item__control setting-item__control--wide">
          <input
            type="text"
            value={formData.paddleOcrUrl}
            onChange={(e) => {
              setFormData(prev => ({ ...prev, paddleOcrUrl: e.target.value }))
              markChanged()
            }}
            placeholder="https://paddleocr.aistudio-app.com"
          />
        </div>
      </div>

        <div className="setting-item__control">
          <button
            className="btn btn--secondary btn--sm"
            onClick={async () => {
              const api = window.electronAPI as any
              try {
                const testUrl = formData.paddleOcrUrl.trim()
                if (!testUrl) {
                  toast.error('请先填写 OCR 服务地址')
                  return
                }
                if (!api?.testOcrConnection) {
                  toast.error('Electron API 未初始化，请重启应用')
                  return
                }

                // 安全修复（高-05 回归）：settings 里的 Token 只是哨兵值/空串。
                // 若是用户新输入的真值，先落到安全存储（与 AI 服务商 ensureApiKeySaved 行为一致），
                // 再将表单值换成哨兵值——真值绝不回传给渲染层。
                const rawToken = (formData.paddleOcrToken || '').trim()
                if (rawToken && rawToken !== SECURED_API_KEY) {
                  try {
                    await api.secureStorage.set('paddle_ocr_token', rawToken)
                    setFormData(prev => ({ ...prev, paddleOcrToken: SECURED_API_KEY }))
                    markChanged()
                  } catch {
                    toast.error('Token 保存到安全存储失败，无法测试连接')
                    return
                  }
                }

                // 测试连接由主进程发起：主进程从 secureStorage 读取真实 Token，
                // 渲染层只发送地址与模型名，永不接触真值。
                // （此前渲染层直发 Authorization: Bearer <哨兵值>，必然 401。）
                const result = await api.testOcrConnection({
                  url: testUrl,
                  model: formData.paddleOcrModel,
                })

                if (result.ok) {
                  if (result.jobId) {
                    toast.success(`OCR 服务连接成功！任务已提交 (jobId: ${String(result.jobId).substring(0, 8)}...)`)
                  } else {
                    toast.success('OCR 服务连接成功！')
                  }
                } else if (result.status === 401) {
                  toast.error('Token 验证失败 (401)，请检查 Access Token 是否正确')
                } else if (result.status === 403) {
                  toast.error('权限不足 (403)，请检查 Token 是否有 OCR 权限或是否已超出配额')
                } else if (result.status === 429) {
                  toast('请求频率过高 (429)，但服务连接正常', { icon: '⚠️' })
                } else if (result.status === 400) {
                  toast.error(`请求参数错误 (400): ${result.msg || '请检查模型名称是否正确'}`)
                } else if (result.code && result.code !== 0) {
                  toast.error(`OCR 服务返回错误: ${result.msg || '未知错误'} (code: ${result.code})`)
                } else if (result.status && result.status !== 200) {
                  toast(`OCR 服务响应异常 (HTTP ${result.status})`, { icon: '⚠️' })
                } else {
                  toast.error(`OCR 连接失败：${result.error || '未知错误'}`)
                }
              } catch (err: any) {
                if (err?.name === 'AbortError' || err?.name === 'TimeoutError') {
                  toast.error('OCR 连接超时（15秒），请检查服务地址和网络')
                } else {
                  toast.error(`OCR 连接失败：${err?.message || '未知错误'}`)
                }
              }
            }}
          >
            <TestTube size={14} />
            测试连接
          </button>
        </div>
    </motion.div>
  )
}

// ===========================================
// 评分标准 Section
// ===========================================
function StandardsSection() {
  return (
    <motion.div
      className="settings-section"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <h2>评分标准管理</h2>
      <p className="section-desc">创建和管理评分标准，AI 将根据这些标准进行评分。</p>

      <div className="help-cards">
        <div className="help-card">
          <h4>如何创建评分标准</h4>
          <ol>
            <li>点击左侧「<strong>评分标准</strong>」进入管理页面</li>
            <li>点击<strong>「添加标准」</strong>按钮</li>
            <li>填写题目、满分值、参考答案和关键词</li>
            <li>保存后即可在批改时选择使用</li>
          </ol>
        </div>
        <div className="help-card">
          <h4>关键词的重要性</h4>
          <p>关键词是 AI 评分的核心依据。建议为每道题提供 3-5 个关键得分点。</p>
          <details>
            <summary>查看示例</summary>
            <p>
              例如数学解答题的关键词：<code>"通分"</code> <code>"化简"</code>
              <code>"代入求值"</code> <code>"答案正确"</code>
            </p>
          </details>
        </div>
      </div>
    </motion.div>
  )
}

// ===========================================
// 导出设置 Section
// ===========================================
function ExportSection({ formData, setFormData, markChanged }: SectionProps) {
  return (
    <motion.div
      className="settings-section"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <h2>导出设置</h2>
      <p className="section-desc">自定义导出格式和选项。</p>

      <div className="setting-item">
        <div className="setting-item__info">
          <h4><Download size={14} /> 默认导出格式</h4>
          <p>选择批改结果的主要导出格式</p>
        </div>
        <div className="setting-item__control">
          <select
            value={formData.defaultExportFormat}
            onChange={(e) => {
              setFormData(prev => ({ ...prev, defaultExportFormat: e.target.value }))
              markChanged()
            }}
          >
            <option value="pdf">PDF 报告</option>
            <option value="csv">CSV 表格</option>
            <option value="json">JSON 数据</option>
          </select>
        </div>
      </div>

      <div className="setting-item">
        <div className="setting-item__info">
          <h4>包含图片</h4>
          <p>导出时是否包含学生作答截图</p>
        </div>
        <div className="setting-item__control">
          <label className="toggle">
            <input
              type="checkbox"
              checked={formData.exportIncludeImages}
              onChange={(e) => {
                setFormData(prev => ({ ...prev, exportIncludeImages: e.target.checked }))
                markChanged()
              }}
            />
            <span className="toggle__slider"></span>
          </label>
        </div>
      </div>

      <div className="setting-item">
        <div className="setting-item__info">
          <h4>文件名模板</h4>
          <p>自定义导出文件的命名规则</p>
        </div>
        <div className="setting-item__control setting-item__control--wide">
          <input
            type="text"
            value={formData.exportFileNameTemplate}
            onChange={(e) => {
              setFormData(prev => ({ ...prev, exportFileNameTemplate: e.target.value }))
              markChanged()
            }}
            placeholder="{日期}_{考试名称}_批改结果"
          />
        </div>
      </div>
    </motion.div>
  )
}

// ===========================================
// 界面设置 Section（含主题定制）
// ===========================================
interface UiSettingsProps {
  formData: any
  setFormData: (fn: (prev: any) => any) => void
  markChanged: () => void
  setHasChanges: (v: boolean) => void
}

function UiSettingsSection({ formData, setFormData, markChanged, setHasChanges }: UiSettingsProps) {
  const [showPreview, setShowPreview] = useState(false)
  const [previewConfig, setPreviewConfig] = useState<ThemeCustomConfig | null>(null)

  return (
    <motion.div
      className="settings-section"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <div className="settings-section__header">
        <h2>界面设置</h2>
      </div>

      {/* ===== 主题定制 ===== */}
      <div className="subsection-title"><Palette size={16} style={{ display: 'inline' }} /> 主题定制</div>

      {/* 预览区域 */}
      {showPreview && previewConfig && (
        <div className="theme-preview">
          <h3>主题预览</h3>
          <div className="preview-container">
            <div className="preview-card" style={{
              backgroundColor: previewConfig.mode === 'dark' ? '#1e293b' : '#f8fafc',
            }}>
              <div className="preview-header" style={{
                backgroundColor: previewConfig.primaryColor,
              }}>
                <h4>预览标题</h4>
              </div>
              <div className="preview-body" style={{
                color: previewConfig.mode === 'dark' ? '#f8fafc' : '#0f172a',
                fontSize: `${12 + (previewConfig.fontSize - 3) * 2}px`,
              }}>
                <p>这是一段预览文字</p>
                <button className="preview-btn" style={{
                  backgroundColor: previewConfig.primaryColor,
                }}>示例按钮</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 预设主题 */}
      <div className="setting-item">
        <div className="setting-item__info">
          <h4><Palette size={14} /> 预设主题</h4>
          <p>选择预设的主题配色方案</p>
        </div>
        <div className="setting-item__control">
          <div className="preset-themes">
            {Object.entries(PRESET_THEMES).map(([key, theme]) => (
              <button
                key={key}
                className={`preset-theme-btn${formData.themeCustom?.presetTheme === key ? ' preset-theme-btn--active' : ''}`}
                onClick={() => {
                  setFormData(prev => ({
                    ...prev,
                    themeCustom: {
                      ...prev.themeCustom,
                      presetTheme: key,
                      primaryColor: theme.primaryColor,
                    }
                  }))
                  markChanged()
                }}
              >
                <div className="preset-color" style={{ backgroundColor: theme.primaryColor }} />
                <span>{theme.name}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 自定义主题色 */}
      <div className="setting-item">
        <div className="setting-item__info">
          <h4>自定义主题色</h4>
          <p>使用取色器自定义主色调</p>
        </div>
        <div className="setting-item__control">
          <div className="color-picker-wrapper">
            <input
              type="color"
              className="color-picker"
              value={formData.themeCustom?.primaryColor || '#1976d2'}
              onChange={(e) => {
                setFormData(prev => ({
                  ...prev,
                  themeCustom: {
                    ...prev.themeCustom,
                    primaryColor: e.target.value,
                    presetTheme: 'custom',
                  }
                }))
                markChanged()
              }}
            />
            <span className="color-value">{formData.themeCustom?.primaryColor || '#1976d2'}</span>
          </div>
        </div>
      </div>

      {/* 主题模式 */}
      <div className="setting-item">
        <div className="setting-item__info">
          <h4><Monitor size={14} /> 主题模式</h4>
          <p>选择浅色或深色主题</p>
        </div>
        <div className="setting-item__control">
          <select
            value={formData.themeCustom?.mode || 'light'}
            onChange={(e) => {
              setFormData(prev => ({
                ...prev,
                themeCustom: {
                  ...prev.themeCustom,
                  mode: e.target.value,
                }
              }))
              markChanged()
            }}
          >
            <option value="light">浅色模式</option>
            <option value="dark">深色模式</option>
            <option value="system">跟随系统</option>
            <option value="highContrast">高对比度</option>
          </select>
        </div>
      </div>

      {/* 字体大小 */}
      <div className="setting-item">
        <div className="setting-item__info">
          <h4><Type size={14} /> 字体大小</h4>
          <p>调整界面字体大小</p>
        </div>
        <div className="setting-item__control">
          <div className="font-size-selector">
            {[1, 2, 3, 4, 5].map((size) => (
              <button
                key={size}
                className={`font-size-btn${formData.themeCustom?.fontSize === size ? ' font-size-btn--active' : ''}`}
                onClick={() => {
                  setFormData(prev => ({
                    ...prev,
                    themeCustom: {
                      ...prev.themeCustom,
                      fontSize: size as 1 | 2 | 3 | 4 | 5,
                    }
                  }))
                  markChanged()
                }}
              >
                {['极小', '小', '中', '大', '极大'][size - 1]}
              </button>
            ))}
          </div>
          <span className="font-size-hint">
            当前: {12 + ((formData.themeCustom?.fontSize || 3) - 3) * 2}px
          </span>
        </div>
      </div>

      {/* 高对比度 */}
      <div className="setting-item">
        <div className="setting-item__info">
          <h4>高对比度模式</h4>
          <p>提升可读性（符合 WCAG 2.1 AA 标准）</p>
        </div>
        <div className="setting-item__control">
          <label className="toggle">
            <input
              type="checkbox"
              checked={formData.themeCustom?.highContrast || false}
              onChange={(e) => {
                setFormData(prev => ({
                  ...prev,
                  themeCustom: {
                    ...prev.themeCustom,
                    highContrast: e.target.checked,
                  }
                }))
                markChanged()
              }}
            />
            <span className="toggle__slider"></span>
          </label>
        </div>
      </div>

      {/* 操作按钮 */}
      <div style={{ display: 'flex', gap: '12px', marginTop: '24px' }}>
        <button
          className="btn btn--secondary btn--sm"
          onClick={() => {
            setShowPreview(!showPreview)
            if (!showPreview) {
              setPreviewConfig({ ...formData.themeCustom })
            }
          }}
        >
          <Eye size={14} />
          {showPreview ? '关闭预览' : '预览主题'}
        </button>
        <button
          className="btn btn--warning btn--sm"
          onClick={() => {
            setFormData(prev => ({
              ...prev,
              themeCustom: { presetTheme: 'blue', primaryColor: '#1976d2', mode: 'light', fontSize: 3, highContrast: false }
            }))
            toast.success('主题已恢复默认')
            markChanged()
          }}
        >
          <RefreshCw size={14} />
          恢复默认主题
        </button>
      </div>

      {/* ===== 其他界面设置 ===== */}
      <div className="subsection-title" style={{ marginTop: '32px' }}><Monitor size={16} style={{ display: 'inline' }} /> 显示设置</div>

      <div className="setting-item">
        <div className="setting-item__info">
          <h4>音效</h4>
          <p>操作反馈音效</p>
        </div>
        <div className="setting-item__control">
          <label className="toggle">
            <input
              type="checkbox"
              checked={formData.soundEnabled}
              onChange={(e) => {
                setFormData(prev => ({ ...prev, soundEnabled: e.target.checked }))
                markChanged()
              }}
            />
            <span className="toggle__slider"></span>
          </label>
        </div>
      </div>

      {/* 开发者模式 */}
      <div className="setting-item">
        <div className="setting-item__info">
          <h4><Code size={14} /> 开发者模式</h4>
          <p>显示性能监控面板（调试用）</p>
        </div>
        <div className="setting-item__control">
          <label className="toggle">
            <input
              type="checkbox"
              checked={formData.devMode || false}
              onChange={(e) => {
                setFormData(prev => ({ ...prev, devMode: e.target.checked }))
                markChanged()
              }}
            />
            <span className="toggle__slider"></span>
          </label>
        </div>
      </div>
    </motion.div>
  )
}

// ===========================================
// 帮助与支持 Section
// ===========================================
function HelpSection() {
  return (
    <motion.div
      className="settings-section"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <h2>帮助与支持</h2>
      <p className="section-desc">获取帮助、查看快捷键、了解应用信息。</p>

      <div className="shortcuts-info">
        <h4>键盘快捷键</h4>
        <div className="shortcuts-list">
          {[
            { key: 'Ctrl/Cmd + S', desc: '开始/暂停批改' },
            { key: 'Ctrl/Cmd + O', desc: '打开链接' },
            { key: 'Ctrl/Cmd + E', desc: '导出结果' },
            { key: 'F1', desc: '打开帮助面板' },
            { key: 'Esc', desc: '关闭弹窗/取消操作' },
          ].map(s => (
            <div key={s.key} className="shortcut-item">
              <span className="shortcut-desc">{s.desc}</span>
              <span className="shortcut-key">{s.key}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="help-cards">
        <div className="help-card">
          <h4>快速开始指南</h4>
          <ol>
            <li>在<strong>「系统设置」</strong>中配置 AI 服务商 API Key</li>
            <li>在<strong>「OCR 配置」</strong>中设置识别服务</li>
            <li>在<strong>「评分标准」</strong>中创建标准</li>
            <li>进入<strong>「坐标批改」</strong>页面开始批改</li>
          </ol>
        </div>

        <div className="help-card">
          <h4>常见问题</h4>
          <details>
            <summary>API 连接失败怎么办？</summary>
            <p>检查网络连接、API Key 是否正确、API 地址是否可访问。</p>
          </details>
          <details>
            <summary>如何提高识别准确率？</summary>
            <p>确保截图清晰、光线充足，并在 OCR 设置中调整参数。</p>
          </details>
          <details>
            <summary>数据存储在哪里？</summary>
            <p>所有数据均存储在本地，路径：<code>%APPDATA%\pilaoban-grading-tool/</code></p>
          </details>
        </div>

        <div className="help-card">
          <h4>关于</h4>
          <p><strong>皮老板智能阅卷工具</strong></p>
          {/* 修复：此前版本号硬编码为 2.2.1，早已与实际版本脱节，会误导用户报障 */}
          <p>版本：{__APP_VERSION__}</p>
          <p>基于 Electron + React + TypeScript 构建</p>
        </div>
      </div>

      {/* 软件更新：此前 UpdateChecker 是孤儿组件，没有任何页面引用它，
          导致客户端根本没有更新入口 —— 必须挂在这里才谈得上"能自动更新" */}
      <div style={{ marginTop: '24px' }}>
        <UpdateChecker />
      </div>

      <div style={{ marginTop: '24px', display: 'flex', gap: '12px' }}>
        <button
          className="btn btn--secondary btn--sm"
          onClick={() => {
            // 触发新手引导
            const event = new CustomEvent('start-onboarding-guide')
            window.dispatchEvent(event)
          }}
        >
          <Eye size={14} />
          交互式教程
        </button>
        <button
          className="btn btn--secondary btn--sm"
          onClick={() => toast('用户手册开发中...', { icon: '📖' })}
        >
          <FileText size={14} />
          用户手册
        </button>
      </div>
    </motion.div>
  )
}
