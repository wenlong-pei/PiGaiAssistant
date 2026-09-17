import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { v4 as uuidv4 } from 'uuid'
import type { AppSettings, AiProvider, ThemeCustomConfig } from '@/types'
import { createResilientPersistStorage } from './resilientStorage'

interface SettingsState {
  settings: AppSettings
  apiKeysLoaded: boolean
  updateSettings: (updates: Partial<AppSettings>) => Promise<void>
  updateProvider: (providerId: string, updates: Partial<AiProvider>) => void
  addProvider: (provider: Omit<AiProvider, 'id' | 'isActive'>) => string
  removeProvider: (providerId: string) => void
  setActiveProvider: (providerId: string) => void
  getActiveProvider: () => AiProvider | undefined
  resetSettings: () => void
  loadApiKeys: () => Promise<void>
  setApiKey: (providerId: string, apiKey: string) => Promise<void>
  getApiKey: (providerId: string) => Promise<string | null>
  deleteApiKey: (providerId: string) => Promise<void>
  hasApiKey: (providerId: string) => Promise<boolean>
}

// 安全存储的键名前缀（须与 electron/utils/constants.ts 中的 STORAGE_KEYS.API_KEY_PREFIX 保持一致）
export const API_KEY_PREFIX = 'apikey_'
export const PADDLE_OCR_KEY = 'paddle_ocr_token'
export const SECURED_API_KEY = '__SECURED__'

// 默认服务商模板（API Key 为空，需用户在设置中自行配置）
const defaultProviders: AiProvider[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    endpoint: 'https://api.deepseek.com/v1/chat/completions',
    apiKey: '',
    model: 'deepseek-flash',
    visionModel: 'deepseek-flash',
    thinkingEnabled: true,
    reasoningEffort: 'high',
    isActive: true,
  },
  {
    id: 'volcengine',
    name: '火山引擎',
    endpoint: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
    apiKey: '',
    model: '',
    isActive: false,
  },
  {
    id: 'siliconflow',
    name: '硅基流动',
    endpoint: 'https://api.siliconflow.cn/v1/chat/completions',
    apiKey: '',
    model: 'Qwen/Qwen2.5-7B-Instruct',
    isActive: false,
  },
  {
    id: 'custom',
    name: '自定义 (OpenAI 兼容)',
    endpoint: '',
    apiKey: '',
    model: '',
    isActive: false,
  },
]

const defaultSettings: AppSettings = {
  soundEnabled: true,
  soundVolume: 70,
  confirmBeforeScore: false,
  confirmBeforeSubmit: false,
  blankDetectionEnabled: false,
  blankDetectionThreshold: 85,
  providers: defaultProviders.map(provider => ({ ...provider })),
  activeProviderId: 'deepseek',
  temperature: 0.3,
  maxTokens: 4000,
  paddleOcrEnabled: false,
  paddleOcrToken: '',
  paddleOcrUrl: 'https://paddleocr.aistudio-app.com',
  paddleOcrModel: 'PaddleOCR-VL-1.6',
  paddleOcrTimeout: 300,
  autoSaveInterval: 30,
  batchSize: 10,
  retryAttempts: 3,
  theme: 'light',
  fontSize: 'medium',
  showScoreOnImage: true,
  // 主题定制配置（新功能）
  themeCustom: {
    mode: 'light',
    primaryColor: '#1976d2',
    fontSize: 3,
    highContrast: false,
    presetTheme: 'blue',
  },
  // 键盘快捷键设置
  keyboardShortcutsEnabled: true,  // 默认启用键盘快捷键
  showShortcutHints: true,         // 默认显示快捷键提示
  // 空白卷处理设置
  blankPaperHandling: 'manual',     // 默认手动确认（最安全）
  // 开发者模式
  devMode: false,                   // 默认关闭开发者模式

  // 导出设置
  defaultExportFormat: 'pdf',
  exportIncludeImages: true,
  exportFileNameTemplate: '{日期}_{考试名称}_批改结果',
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function normalizeNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function normalizeString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

function cloneDefaultProviders(): AiProvider[] {
  return defaultProviders.map(provider => ({ ...provider }))
}

function normalizeProviders(value: unknown, activeProviderId: string): AiProvider[] {
  const source = Array.isArray(value) && value.length > 0 ? value : cloneDefaultProviders()
  const providers = source.map((item, index) => {
    const candidate = (item && typeof item === 'object') ? item as Partial<AiProvider> : {}
    const fallback = defaultProviders.find(provider => provider.id === candidate.id) || defaultProviders[index] || defaultProviders[0]
    const endpoint = normalizeString(candidate.endpoint, fallback.endpoint || '')

    // 迁移：DeepSeek 的旧默认模型 deepseek-chat → deepseek-flash
    // （V4.1 Flash 原生图文全能，旧的 V4 Flash/Pro 已逐步下线并路由到它）
    // 只改"旧默认值"，用户自己填过的其他模型名一律不动。
    const isDeepSeek = /api\.deepseek\.com/i.test(endpoint) || candidate.id === 'deepseek'
    let model = normalizeString(candidate.model, fallback.model || '')
    if (isDeepSeek && model === 'deepseek-chat') {
      model = 'deepseek-flash'
    }
    let visionModel = normalizeString(candidate.visionModel, (fallback as any).visionModel || '')
    if (isDeepSeek && (visionModel === '' || visionModel === 'deepseek-chat')) {
      visionModel = 'deepseek-flash'
    }

    return {
      id: normalizeString(candidate.id, fallback.id || uuidv4()),
      name: normalizeString(candidate.name, fallback.name || 'AI 服务商'),
      endpoint,
      apiKey: normalizeString(candidate.apiKey, ''),
      model,
      visionModel,
      thinkingEnabled: typeof candidate.thinkingEnabled === 'boolean' ? candidate.thinkingEnabled : undefined,
      reasoningEffort: candidate.reasoningEffort === 'low' || candidate.reasoningEffort === 'high' || candidate.reasoningEffort === 'max'
        ? candidate.reasoningEffort
        : undefined,
      isActive: false,
    }
  })

  const hasActiveProvider = providers.some(provider => provider.id === activeProviderId)
  const normalizedActiveId = hasActiveProvider ? activeProviderId : providers[0]?.id || ''
  return providers.map((provider, index) => ({
    ...provider,
    isActive: normalizedActiveId ? provider.id === normalizedActiveId : index === 0,
  }))
}

export function normalizeSettings(value: unknown): AppSettings {
  const raw = (value && typeof value === 'object') ? value as Partial<AppSettings> : {}
  const activeProviderId = normalizeString(raw.activeProviderId, defaultSettings.activeProviderId)
  const providers = normalizeProviders(raw.providers, activeProviderId)
  const normalizedActiveId = providers.find(provider => provider.isActive)?.id || defaultSettings.activeProviderId

  // 标准化主题定制配置
  const rawThemeCustom = (raw.themeCustom && typeof raw.themeCustom === 'object') 
    ? raw.themeCustom as Partial<ThemeCustomConfig> 
    : {}
  
  // 安全地获取 fontSize
  const rawFontSize = rawThemeCustom.fontSize
  const normalizedFontSize: 1 | 2 | 3 | 4 | 5 = (
    rawFontSize !== undefined && 
    rawFontSize >= 1 && 
    rawFontSize <= 5
  ) ? rawFontSize as 1 | 2 | 3 | 4 | 5 : defaultSettings.themeCustom.fontSize
  
  const themeCustom: ThemeCustomConfig = {
    mode: (rawThemeCustom.mode === 'light' || rawThemeCustom.mode === 'dark' || rawThemeCustom.mode === 'system' || rawThemeCustom.mode === 'highContrast') 
      ? rawThemeCustom.mode 
      : defaultSettings.themeCustom.mode,
    primaryColor: normalizeString(rawThemeCustom.primaryColor, defaultSettings.themeCustom.primaryColor),
    fontSize: normalizedFontSize,
    highContrast: normalizeBoolean(rawThemeCustom.highContrast, defaultSettings.themeCustom.highContrast),
    presetTheme: normalizeString(rawThemeCustom.presetTheme, defaultSettings.themeCustom.presetTheme),
  }

  return {
    ...defaultSettings,
    // 修复：不再直接展开 raw，防止持久化数据中引入意外字段
    // 只显式提取已知字段并做标准化处理
    soundEnabled: normalizeBoolean(raw.soundEnabled, defaultSettings.soundEnabled),
    soundVolume: normalizeNumber(raw.soundVolume, defaultSettings.soundVolume),
    confirmBeforeScore: normalizeBoolean(raw.confirmBeforeScore, defaultSettings.confirmBeforeScore),
    confirmBeforeSubmit: normalizeBoolean(raw.confirmBeforeSubmit, defaultSettings.confirmBeforeSubmit),
    blankDetectionEnabled: normalizeBoolean(raw.blankDetectionEnabled, defaultSettings.blankDetectionEnabled),
    blankDetectionThreshold: normalizeNumber(raw.blankDetectionThreshold, defaultSettings.blankDetectionThreshold),
    providers,
    activeProviderId: normalizedActiveId,
    temperature: normalizeNumber(raw.temperature, defaultSettings.temperature),
    // 迁移：旧默认 500 / 1000 都会让思考模式耗尽输出额度（正文为空、无评分依据）。
    // 设置页没有 maxTokens 输入项，用户无法自行调大，故把旧默认值一次性升到 4000；
    // 用户显式设置过的其他数值不受影响。
    maxTokens: [500, 1000].includes(normalizeNumber(raw.maxTokens, defaultSettings.maxTokens))
      ? 4000
      : normalizeNumber(raw.maxTokens, defaultSettings.maxTokens),
    paddleOcrEnabled: normalizeBoolean(raw.paddleOcrEnabled, defaultSettings.paddleOcrEnabled),
    // 安全修复（高-05 / RM-SEC-004）：OCR Token 真值只存 secureStorage。
    // settings 会被 zustand persist 明文写入 localStorage，因此这里只保留哨兵值或空串；
    // 历史版本残留在 localStorage 的明文 Token 在首次加载时即被清除，
    // 真值仍可从 secureStorage 取得（见 resolvePaddleOcrToken）。
    paddleOcrToken: normalizeString(raw.paddleOcrToken, defaultSettings.paddleOcrToken) === SECURED_API_KEY
      ? SECURED_API_KEY
      : '',
    paddleOcrUrl: normalizeString(raw.paddleOcrUrl, defaultSettings.paddleOcrUrl),
    paddleOcrModel: normalizeString(raw.paddleOcrModel, defaultSettings.paddleOcrModel),
    paddleOcrTimeout: normalizeNumber(raw.paddleOcrTimeout, defaultSettings.paddleOcrTimeout),
    autoSaveInterval: normalizeNumber(raw.autoSaveInterval, defaultSettings.autoSaveInterval),
    batchSize: normalizeNumber(raw.batchSize, defaultSettings.batchSize),
    retryAttempts: normalizeNumber(raw.retryAttempts, defaultSettings.retryAttempts),
    theme: raw.theme === 'dark' || raw.theme === 'system' ? raw.theme : defaultSettings.theme,
    fontSize: raw.fontSize === 'small' || raw.fontSize === 'large' ? raw.fontSize : defaultSettings.fontSize,
    showScoreOnImage: normalizeBoolean(raw.showScoreOnImage, defaultSettings.showScoreOnImage),
    // 主题定制配置
    themeCustom,
    // 键盘快捷键设置
    keyboardShortcutsEnabled: normalizeBoolean(raw.keyboardShortcutsEnabled, defaultSettings.keyboardShortcutsEnabled),
    showShortcutHints: normalizeBoolean(raw.showShortcutHints, defaultSettings.showShortcutHints),
    // 空白卷处理设置
    blankPaperHandling: raw.blankPaperHandling === 'skip' || raw.blankPaperHandling === 'zero' || raw.blankPaperHandling === 'manual'
      ? raw.blankPaperHandling
      : defaultSettings.blankPaperHandling,
    // 开发者模式
    devMode: normalizeBoolean(raw.devMode, defaultSettings.devMode),
    // 导出设置
    defaultExportFormat: raw.defaultExportFormat === 'pdf' || raw.defaultExportFormat === 'csv' || raw.defaultExportFormat === 'json'
      ? raw.defaultExportFormat
      : defaultSettings.defaultExportFormat,
    exportIncludeImages: normalizeBoolean(raw.exportIncludeImages, defaultSettings.exportIncludeImages),
    exportFileNameTemplate: normalizeString(raw.exportFileNameTemplate, defaultSettings.exportFileNameTemplate),
  }
}

// 获取 Electron API（仅在 Electron 环境中可用）
function getElectronAPI() {
  if (typeof window !== 'undefined' && (window as any).electronAPI) {
    return (window as any).electronAPI
  }
  return null
}

/**
 * 纯函数：解析出可用的真实 OCR Token（安全修复 高-05 / RM-SEC-004）。
 * settings 中只允许存哨兵值（SECURED_API_KEY）或空串——哨兵值绝不能被当成真实 Token 使用。
 */
function pickRealPaddleOcrToken(
  storedToken: string | null | undefined,
  settingsValue: string | null | undefined
): string {
  const stored = (storedToken || '').trim()
  if (stored) return stored
  // 兜底：仅当 settings 中残留历史明文真值时才使用（明确跳过哨兵值）
  const fallback = (settingsValue || '').trim()
  if (fallback && fallback !== SECURED_API_KEY) return fallback
  return ''
}

/**
 * 从 secureStorage 读取 OCR Token 真值，哨兵值/空串不再作为 Token 回退。
 */
async function resolvePaddleOcrToken(
  api: any,
  settingsValue: string | null | undefined
): Promise<string> {
  let stored: string | null = null
  if (api?.secureStorage) {
    try {
      stored = await api.secureStorage.get(PADDLE_OCR_KEY)
    } catch (err) {
      console.error('Failed to read PaddleOCR token from secureStorage:', err)
      stored = null
    }
  }
  return pickRealPaddleOcrToken(stored, settingsValue)
}

// 同步服务商配置到主进程（不包含 API Key，主进程直接从 secureStorage 读取）
// 主进程会做 endpoint 安全校验（协议/内网/IP 直连/内置服务商域名绑定）；
// 被拒绝时抛出 Error，由调用方决定是否展示给用户。
async function syncProvidersToMain(
  api: any,
  providers: AiProvider[],
  activeProviderId: string,
  temperature: number,
  maxTokens: number
): Promise<void> {
  const safeProviders = normalizeProviders(providers, activeProviderId)
  const safeActiveProviderId = safeProviders.find(provider => provider.isActive)?.id || activeProviderId
  // 安全修复：渲染进程不读取/不发送真实 API Key
  // 主进程的 AIService 在需要时直接从 secureStorage 读取
  const safeProviderConfigs = safeProviders.map((p) => {
    // 仅检查 Key 是否存在（boolean），不读取真实值
    const hasKey = p.apiKey === SECURED_API_KEY
    return {
      id: p.id,
      name: p.name,
      endpoint: p.endpoint,
      model: p.model,
      visionModel: p.visionModel || '',
      thinkingEnabled: p.thinkingEnabled,
      reasoningEffort: p.reasoningEffort,
      isActive: p.id === safeActiveProviderId,
      hasKey,
    }
  })

  // 安全修复（阻断-06）：必须把主进程的校验结果带回渲染层，
  // 否则用户只会看到"评分莫名失败"而无从排查。
  // preload 仍为 send（fire-and-forget）时返回 undefined；
  // 改为 invoke 后返回 { success: false, error }，此处即抛出可展示的原因。
  const result = await api.updateBotSettings({
    providers: safeProviderConfigs,
    activeProviderId: safeActiveProviderId,
    temperature,
    maxTokens,
  })

  if (result && result.success === false) {
    throw new Error(result.error || '服务商配置未通过主进程安全校验，请检查 API 地址')
  }
}

/**
 * 「瘦身重试」：配额写失败时丢掉「示例空白卡图片」（base64）再写一次。
 *
 * 只在**真正写失败时**触发 —— 正常路径仍然完整保留 `blankSampleImage`，
 * 因此不改变持久化字段集合；代价是配额彻底满时宁可丢示例图，也不丢整套设置。
 */
function shrinkSettingsPayload(rawJson: string): string | null {
  try {
    const payload = JSON.parse(rawJson) as { state?: { settings?: AppSettings } }
    const settings = payload?.state?.settings
    if (!settings || typeof settings !== 'object') return null
    if (!settings.blankSampleImage) return null
    payload.state!.settings = { ...settings, blankSampleImage: '' }
    return JSON.stringify(payload)
  } catch {
    return null
  }
}

/**
 * 容错存储（8.4）：设置里含示例空白卡图片（base64），
 * 配额满时 `setItem` 会同步抛错，把"改设置/切主题"这类操作整个打断。
 */
const { storage: settingsStorage } = createResilientPersistStorage<SettingsState>({
  label: 'settingsStore',
  shrink: shrinkSettingsPayload,
})

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      settings: normalizeSettings(defaultSettings),
      apiKeysLoaded: false,

      // 从安全存储加载 API Key
      loadApiKeys: async () => {
        const api = getElectronAPI()
        if (!api?.secureStorage) return

        const currentSettings = normalizeSettings(get().settings)
        const updatedProviders = await Promise.all(currentSettings.providers.map(async (p) => ({
          ...p,
          apiKey: await api.secureStorage.has(`${API_KEY_PREFIX}${p.id}`) ? SECURED_API_KEY : '',
        })))

        set((state) => ({
          settings: normalizeSettings({ ...state.settings, providers: updatedProviders }),
          apiKeysLoaded: true,
        }))
      },

      // 设置 API Key（加密存储）
      setApiKey: async (providerId: string, apiKey: string) => {
        const api = getElectronAPI()
        
        // 存储到安全存储
        if (api?.secureStorage) {
          await api.secureStorage.set(`${API_KEY_PREFIX}${providerId}`, apiKey)
        }
        
        // 更新状态
        set((state) => {
          const newProviders = state.settings.providers.map(p =>
            p.id === providerId ? { ...p, apiKey: SECURED_API_KEY } : p
          )
          return {
            settings: normalizeSettings({ ...state.settings, providers: newProviders }),
          }
        })

        // 同步活跃服务商配置到主进程
        const currentState = get().settings
        if (api?.updateBotSettings) {
          syncProvidersToMain(api, currentState.providers, currentState.activeProviderId, currentState.temperature, currentState.maxTokens).catch(err => {
            console.error('Failed to sync providers in loadApiKeys:', err)
          })
        }
      },

      // 获取 API Key
      getApiKey: async (providerId: string) => {
        const api = getElectronAPI()
        if (!api?.secureStorage) return null
        return await api.secureStorage.get(`${API_KEY_PREFIX}${providerId}`)
      },

      // 删除 API Key
      deleteApiKey: async (providerId: string) => {
        const api = getElectronAPI()
        
        if (api?.secureStorage) {
          await api.secureStorage.delete(`${API_KEY_PREFIX}${providerId}`)
        }
        
        set((state) => {
          const newProviders = state.settings.providers.map(p =>
            p.id === providerId ? { ...p, apiKey: '' } : p
          )
          return {
            settings: normalizeSettings({ ...state.settings, providers: newProviders }),
          }
        })
      },

      // 检查 API Key 是否存在
      hasApiKey: async (providerId: string) => {
        const api = getElectronAPI()
        if (!api?.secureStorage) return false
        return await api.secureStorage.has(`${API_KEY_PREFIX}${providerId}`)
      },

      updateSettings: async (updates) => {
        const api = getElectronAPI()
        
        // P0 修复：如果 updates 中包含 providers，先将其 API Key 存入 secureStorage
        if (updates.providers) {
          for (const provider of updates.providers) {
            if (
              provider.apiKey &&
              provider.apiKey.trim() !== '' &&
              provider.apiKey !== SECURED_API_KEY
            ) {
              // 真实 Key 存在，存入 secureStorage
              if (api?.secureStorage) {
                try {
                  await api.secureStorage.set(`${API_KEY_PREFIX}${provider.id}`, provider.apiKey.trim())
                } catch (err) {
                  console.error(`Failed to save API key for provider ${provider.id}:`, err)
                }
              }
              // 把 updates 中的 Key 替换为哨兵值（避免明文存入 localStorage）
              provider.apiKey = SECURED_API_KEY
            }
          }
        }
        
        // 安全修复（高-05 / RM-SEC-004）：OCR Token 真值只写入 secureStorage，
        // settings 中一律回落为哨兵值（SECURED_API_KEY），
        // 避免经 zustand persist 明文落到 localStorage。
        const settingsUpdates: Partial<AppSettings> = { ...updates }
        if (updates.paddleOcrToken !== undefined) {
          const rawToken = (updates.paddleOcrToken || '').trim()
          if (rawToken === SECURED_API_KEY) {
            // 渲染层只传来哨兵占位：保持安全存储中的现有 Token 不变
            settingsUpdates.paddleOcrToken = SECURED_API_KEY
          } else if (rawToken === '') {
            // 清空：同步清除安全存储（SecureStorage.set('') 的语义即删除该键）
            if (api?.secureStorage) {
              try {
                await api.secureStorage.set(PADDLE_OCR_KEY, '')
              } catch (err) {
                console.error('Failed to clear PaddleOCR token:', err)
              }
            }
            settingsUpdates.paddleOcrToken = ''
          } else {
            if (api?.secureStorage) {
              try {
                await api.secureStorage.set(PADDLE_OCR_KEY, rawToken)
              } catch (err) {
                // 安全优先：写入失败也不把明文 Token 落回 settings（否则仍会进 localStorage）
                console.error('Failed to save PaddleOCR token to secureStorage:', err)
              }
            } else {
              console.warn('[settingsStore] secureStorage 不可用，OCR Token 未能持久化')
            }
            settingsUpdates.paddleOcrToken = SECURED_API_KEY
          }
        }

        set((state) => ({
          settings: normalizeSettings({ ...state.settings, ...settingsUpdates }),
        }))
        
        const currentState = get().settings
        
        // 如果更新了 PaddleOCR 配置
        if (updates.paddleOcrEnabled !== undefined ||
            updates.paddleOcrUrl !== undefined ||
            updates.paddleOcrModel !== undefined ||
            updates.paddleOcrTimeout !== undefined ||
            updates.paddleOcrToken !== undefined) {
          if (api?.configurePaddleOCR) {
            // 从安全存储读取真实 token（settings 中只有哨兵值/空串，绝不作为 Token 使用）
            const realToken = await resolvePaddleOcrToken(api, currentState.paddleOcrToken)
            api.configurePaddleOCR({
              enabled: currentState.paddleOcrEnabled,
              source: 'aistudio',
              aiStudioToken: realToken,
              serverUrl: currentState.paddleOcrUrl,
              model: currentState.paddleOcrModel || 'PaddleOCR-VL-1.6',
              timeout: currentState.paddleOcrTimeout,
            })
          }
        }

        // 同步活跃服务商配置到主进程（放在最后一步）：
        // 主进程会做 endpoint 安全校验，被拒绝时这里抛出 Error，
        // 交由 SettingsPage.handleSave 既有的 catch 提示「保存失败：<原因>」，
        // 且不会因此阻断上面已完成的本地设置与 OCR 配置。
        if (api?.updateBotSettings) {
          await syncProvidersToMain(api, currentState.providers, currentState.activeProviderId, currentState.temperature, currentState.maxTokens)
        }
      },

      updateProvider: (providerId, updates) => {
        const api = getElectronAPI()
        
        // 如果更新包含 apiKey，异步保存到 secureStorage（不阻塞 UI）
        if (updates.apiKey !== undefined && api?.secureStorage) {
          api.secureStorage.set(`${API_KEY_PREFIX}${providerId}`, updates.apiKey)
            .then(() => console.log(`[updateProvider] API Key saved to secureStorage for ${providerId}`))
            .catch((err: any) => console.error(`[updateProvider] 保存 API Key 失败:`, err))
        }
        
      set((state) => {
        const newProviders = state.settings.providers.map(p =>
          p.id === providerId
            ? {
                ...p,
                ...updates,
                // 如果更新包含 apiKey，替换为哨兵值（真实 Key 已存入 secureStorage）
                ...(updates.apiKey !== undefined ? { apiKey: SECURED_API_KEY } : {}),
              }
            : p
        )
        return {
          settings: normalizeSettings({ ...state.settings, providers: newProviders }),
        }
      })
        
        // 同步到主进程（异步，不阻塞）
        if (api?.updateBotSettings) {
          const currentState = get().settings
          syncProvidersToMain(api, currentState.providers, currentState.activeProviderId, currentState.temperature, currentState.maxTokens).catch(err => {
            console.error('Failed to sync providers in updateProvider:', err)
          })
        }
      },

      addProvider: (provider) => {
        const id = uuidv4()
        set((state) => ({
          settings: normalizeSettings({
            ...state.settings,
            providers: [...state.settings.providers, { ...provider, id, isActive: false }],
          }),
        }))
        return id
      },

      removeProvider: (providerId) => {
        // 删除存储的 API Key
        const api = getElectronAPI()
        if (api?.secureStorage) {
          api.secureStorage.delete(`${API_KEY_PREFIX}${providerId}`).catch((err: any) => {
            console.error('Failed to delete API key:', err)
          })
        }
        
        set((state) => ({
          settings: normalizeSettings({
            ...state.settings,
            providers: state.settings.providers.filter(p => p.id !== providerId),
            activeProviderId: state.settings.activeProviderId === providerId
              ? state.settings.providers[0]?.id || ''
              : state.settings.activeProviderId,
          }),
        }))
      },

      setActiveProvider: (providerId) => {
        set((state) => ({
          settings: normalizeSettings({
            ...state.settings,
            activeProviderId: providerId,
            providers: state.settings.providers.map(p => ({
              ...p,
              isActive: p.id === providerId,
            })),
          }),
        }))
        
        // 同步到主进程
        const currentState = get().settings
        const api = getElectronAPI()
        if (api?.updateBotSettings) {
          syncProvidersToMain(api, currentState.providers, providerId, currentState.temperature, currentState.maxTokens).catch(err => {
            console.error('Failed to sync providers in setActiveProvider:', err)
          })
        }
      },

      getActiveProvider: () => {
        const { settings } = get()
        const normalizedSettings = normalizeSettings(settings)
        return normalizedSettings.providers.find(p => p.id === normalizedSettings.activeProviderId) || normalizedSettings.providers[0]
      },

      resetSettings: () => {
        // 清除所有安全存储的 API Keys
        const api = getElectronAPI()
        if (api?.secureStorage) {
          const currentProviders = normalizeSettings(get().settings).providers
          Promise.all([
            ...currentProviders.map(p => 
              api.secureStorage.delete(`${API_KEY_PREFIX}${p.id}`).catch((err: any) => {
                console.error('Failed to delete API key:', err)
              })
            ),
            api.secureStorage.delete(PADDLE_OCR_KEY).catch((err: any) => {
              console.error('Failed to delete PaddleOCR key:', err)
            })
          ]).catch(err => {
            console.error('Failed to reset settings:', err)
          })
        }
        set({ settings: normalizeSettings(defaultSettings), apiKeysLoaded: false })
      },
    }),
    {
      name: 'grading-settings',
      // 容错存储：写入失败（配额满）只降级 + 记错误，绝不把异常抛给调用方
      storage: settingsStorage,
      // 持久化字段与旧版本完全一致（身份映射）；图片仅在写失败时由 shrink 兜底剥离
      partialize: (state): SettingsState => ({ ...state }),
      merge: (persistedState, currentState) => {
        const persisted = (persistedState && typeof persistedState === 'object')
          ? persistedState as Partial<SettingsState>
          : {}
        return {
          ...currentState,
          ...persisted,
          settings: normalizeSettings(persisted.settings),
          apiKeysLoaded: false,
        }
      },
      onRehydrateStorage: () => (state) => {
        if (state?.settings) {
          state.settings = normalizeSettings(state.settings)
        }

        // 应用恢复时加载安全存储的 API Keys
        const api = getElectronAPI()
        if (api?.secureStorage && state?.settings) {
          // 标记为需要加载
          state.apiKeysLoaded = false
          
          // 同步服务商配置到主进程（不包含敏感信息）
          if (api.updateBotSettings) {
            syncProvidersToMain(
              api,
              state.settings.providers,
              state.settings.activeProviderId,
              state.settings.temperature,
              state.settings.maxTokens
            ).catch(err => {
              console.error('Failed to sync providers during rehydrate:', err)
            })
          }
        }
        // 同步 PaddleOCR 配置到主进程
        if (state?.settings?.paddleOcrEnabled !== undefined) {
          // 修复：复用已声明的 api 变量，避免重复声明导致遮蔽
          if (api?.configurePaddleOCR) {
            // 从安全存储读取真实 token（异步，不阻塞 rehydrate）
            if (api.secureStorage) {
              api.secureStorage.get(PADDLE_OCR_KEY).then((realToken: string | null) => {
                api.configurePaddleOCR({
                enabled: state.settings.paddleOcrEnabled,
                source: 'aistudio',
                // 哨兵值/空串不会被当作真实 Token
                aiStudioToken: pickRealPaddleOcrToken(realToken, state.settings.paddleOcrToken),
                serverUrl: state.settings.paddleOcrUrl,
                model: state.settings.paddleOcrModel || 'PaddleOCR-VL-1.6',
                timeout: state.settings.paddleOcrTimeout,
              })
              })
            } else {
              api.configurePaddleOCR({
                enabled: state.settings.paddleOcrEnabled,
                source: 'aistudio',
                aiStudioToken: pickRealPaddleOcrToken(null, state.settings.paddleOcrToken),
                serverUrl: state.settings.paddleOcrUrl,
                model: state.settings.paddleOcrModel || 'PaddleOCR-VL-1.6',
                timeout: state.settings.paddleOcrTimeout,
              })
            }
          }
        }
      }
    }
  )
)

// Provider组件 - 直接透传children
export function SettingsProvider({ children }: { children: React.ReactNode }) {
  return children as JSX.Element
}
