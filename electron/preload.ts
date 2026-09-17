import { contextBridge, ipcRenderer } from 'electron'

// 白名单 IPC 通道白名单
const VALID_CHANNELS: Record<string, string[]> = {
  // 窗口控制
  send: ['window-minimize', 'window-maximize', 'window-close', 'renderer-error'],
  // 对话框
  invoke: ['dialog:openFile', 'dialog:saveFile',
    // Bot 相关功能
    'bot:launch', 'bot:connect', 'bot:navigate', 'bot:getCurrentUrl', 'bot:analyze',
    'bot:capture', 'bot:capture-auto', 'bot:capture-coordinate', 'bot:capture-fullpage', 'bot:click-at', 'bot:type-at',
    'bot:recognize',
    'bot:recognize-region',
    'bot:grade', 'bot:submit', 'bot:next', 'bot:close',
    'bot:analyzeCorrection',
    'bot:sync-edge-profile',
  ],
  // 文件操作（白名单限制）
  file: ['file:read', 'file:write', 'file:readImage'],
  // 外部链接
  shell: ['shell:openExternal'],
  // 应用路径
  app: ['app:getPath'],
  // Bot 相关
  bot: ['bot:updateBotSettings', 'bot:get-settings', 'bot:configurePaddleOCR', 'bot:setStandard', 'bot:test-api', 'bot:grade-image'],
  // 安全存储
  secure: ['secure:get', 'secure:set', 'secure:delete', 'secure:has', 'secure:is-available'],
  // 批改历史（主进程加密存储，PII 不落 localStorage）
  history: ['history:load', 'history:save', 'history:clear'],
  // OCR 连接测试（主进程代理，渲染层不接触真实 Token）
  ocr: ['ocr:test-connection'],
  // 自动更新
  update: ['update:check', 'update:download', 'update:install', 'update:status', 'update:set-skip'],
  // 可监听的事件
  on: ['update:state-changed', 'update:available', 'update:downloaded', 'window:maximize-change'],
}

// 验证通道是否在白名单中
function validateChannel(type: keyof typeof VALID_CHANNELS, channel: string): boolean {
  return VALID_CHANNELS[type]?.includes(channel) ?? false
}

// 暴露给渲染进程的API
contextBridge.exposeInMainWorld('electronAPI', {
  // 通用 invoke 方法（用于调用 Bot 相关功能）
  invoke: (channel: string, ...args: unknown[]) => {
    if (
      validateChannel('invoke', channel) ||
      validateChannel('bot', channel) ||
      validateChannel('history', channel) ||
      validateChannel('ocr', channel)
    ) {
      return ipcRenderer.invoke(channel, ...args)
    }
    throw new Error(`IPC channel "${channel}" is not allowed`)
  },
  // 通用 send 方法
  send: (channel: string, ...args: unknown[]) => {
    if (validateChannel('send', channel) || validateChannel('bot', channel)) {
      ipcRenderer.send(channel, ...args)
      return
    }
    throw new Error(`IPC channel "${channel}" is not allowed`)
  },

  // 窗口控制
  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  maximizeWindow: () => ipcRenderer.send('window-maximize'),
  closeWindow: () => ipcRenderer.send('window-close'),
  onWindowMaximizeChange: (callback: (isMaximized: boolean) => void) => {
    const handler = (_: any, isMaximized: boolean) => callback(isMaximized)
    ipcRenderer.on('window:maximize-change', handler)
    return () => ipcRenderer.removeListener('window:maximize-change', handler)
  },

  // 文件对话框
  openFile: (options: Electron.OpenDialogOptions) => 
    ipcRenderer.invoke('dialog:openFile', options),
  saveFile: (options: Electron.SaveDialogOptions) => 
    ipcRenderer.invoke('dialog:saveFile', options),

  // 文件操作（只允许访问应用数据目录）
  readFile: (filePath: string) => ipcRenderer.invoke('file:read', filePath),
  writeFile: (filePath: string, content: string) => 
    ipcRenderer.invoke('file:write', filePath, content),
  readImage: (filePath: string) => ipcRenderer.invoke('file:readImage', filePath),

  // 外部链接
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),

  // 应用路径
  getPath: (name: string) => ipcRenderer.invoke('app:getPath', name),

  // Bot 设置同步（多服务商支持）——改走 invoke 以拿到主进程的错误回执
  // （主进程端点安全校验可能拒绝写入，需把 { success:false, error } 回传给渲染层展示）
  updateBotSettings: (settings: any): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('bot:updateBotSettings', settings),
  // API 测试（由主进程代理，渲染进程不接触 API Key）
  testApi: (params: { providerId: string; endpoint: string; model: string; prompt: string; temperature: number; maxTokens: number }) =>
    ipcRenderer.invoke('bot:test-api', params),
  // 图像直评（首选路径）：传截图 + 评分标准，返回 { ok, result?, reason? }
  gradeImage: (imageDataUrl: string, standard: any, correctionHistory?: any[]) =>
    ipcRenderer.invoke('bot:grade-image', imageDataUrl, standard, correctionHistory),
  getBotSettings: () => ipcRenderer.invoke('bot:get-settings'),
  
  // 从用户 Edge 重新同步配置文件
  syncEdgeProfile: () => ipcRenderer.invoke('bot:sync-edge-profile'),
  
  // 配置 PaddleOCR 服务
  configurePaddleOCR: (config: any) => ipcRenderer.send('bot:configurePaddleOCR', config),

  // 安全存储（API Key 加密）
  secureStorage: {
    get: (key: string) => ipcRenderer.invoke('secure:get', key),
    set: (key: string, value: string) => ipcRenderer.invoke('secure:set', key, value),
    delete: (key: string) => ipcRenderer.invoke('secure:delete', key),
    has: (key: string) => ipcRenderer.invoke('secure:has', key),
    isAvailable: () => ipcRenderer.invoke('secure:is-available'),
  },

  // 批改历史加密存储（PII 由主进程加密落盘到 userData，不写 localStorage 明文）
  history: {
    load: (): Promise<Uint8Array | null> => ipcRenderer.invoke('history:load'),
    save: (bytes: Uint8Array): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('history:save', bytes),
    clear: (): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('history:clear'),
  },

  // OCR 连接测试（主进程从 secureStorage 读取真实 Token 发请求，渲染层不接触真值）
  testOcrConnection: (params: { url: string; model?: string }): Promise<{
    ok: boolean
    status?: number
    jobId?: string
    code?: number
    msg?: string
    error?: string
  }> => ipcRenderer.invoke('ocr:test-connection', params),

  // 自动更新
  update: {
    check: () => ipcRenderer.invoke('update:check'),
    download: () => ipcRenderer.invoke('update:download'),
    install: () => ipcRenderer.invoke('update:install'),
    getStatus: () => ipcRenderer.invoke('update:status'),
    setSkip: (skip: boolean) => ipcRenderer.invoke('update:set-skip', skip),
    onStateChanged: (callback: (state: any) => void) => {
      const handler = (_: any, state: any) => callback(state)
      ipcRenderer.on('update:state-changed', handler)
      // 返回取消订阅函数
      return () => ipcRenderer.removeListener('update:state-changed', handler)
    },
    onAvailable: (callback: (info: any) => void) => {
      const handler = (_: any, info: any) => callback(info)
      ipcRenderer.on('update:available', handler)
      return () => ipcRenderer.removeListener('update:available', handler)
    },
    onDownloaded: (callback: (info: any) => void) => {
      const handler = (_: any, info: any) => callback(info)
      ipcRenderer.on('update:downloaded', handler)
      return () => ipcRenderer.removeListener('update:downloaded', handler)
    },
  },
})

// 更新状态类型
interface UpdateState {
  status: 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error'
  progress: number
  version?: string
  releaseNotes?: string
  error?: string
}

// TypeScript 类型声明
export interface ElectronAPI {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
  send: (channel: string, ...args: unknown[]) => void
  minimizeWindow: () => void
  maximizeWindow: () => void
  closeWindow: () => void
  onWindowMaximizeChange: (callback: (isMaximized: boolean) => void) => () => void
  openFile: (options: Electron.OpenDialogOptions) => Promise<Electron.OpenDialogReturnValue>
  saveFile: (options: Electron.SaveDialogOptions) => Promise<Electron.SaveDialogReturnValue>
  readFile: (filePath: string) => Promise<{ success: boolean; data?: string; error?: string }>
  writeFile: (filePath: string, content: string) => Promise<{ success: boolean; error?: string }>
  readImage: (filePath: string) => Promise<{ success: boolean; data?: string; error?: string }>
  openExternal: (url: string) => Promise<void>
  getPath: (name: string) => Promise<string>
  updateBotSettings: (settings: any) => Promise<{ success: boolean; error?: string }>
  // API 测试（由主进程代理，渲染进程不接触 API Key）
  testApi: (params: {
    providerId: string
    endpoint: string
    model: string
    prompt: string
    temperature: number
    maxTokens: number
  }) => Promise<{ success?: boolean; content?: string; error?: string; time?: number }>
  getBotSettings: () => Promise<any>
  syncEdgeProfile: () => Promise<{ success: boolean; message: string }>
  configurePaddleOCR: (config: any) => void
  secureStorage: {
    get: (key: string) => Promise<string | null>
    set: (key: string, value: string) => Promise<boolean>
    delete: (key: string) => Promise<boolean>
    has: (key: string) => Promise<boolean>
    isAvailable: () => Promise<boolean>
  }
  // 批改历史加密存储（主进程）：渲染层只搬运整库字节，明文 PII 不落 localStorage
  history: {
    load: () => Promise<Uint8Array | null>
    save: (bytes: Uint8Array) => Promise<{ ok: boolean; error?: string }>
    clear: () => Promise<{ ok: boolean; error?: string }>
  }
  // OCR 连接测试（主进程代理）：渲染层不接触真实 Token
  testOcrConnection: (params: { url: string; model?: string }) => Promise<{
    ok: boolean
    status?: number
    jobId?: string
    code?: number
    msg?: string
    error?: string
  }>
  update: {
    check: () => Promise<any>
    download: () => Promise<boolean>
    install: () => Promise<void>
    getStatus: () => Promise<UpdateState>
    setSkip: (skip: boolean) => Promise<void>
    onStateChanged: (callback: (state: UpdateState) => void) => () => void
    onAvailable: (callback: (info: any) => void) => () => void
    onDownloaded: (callback: (info: any) => void) => () => void
  }
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
