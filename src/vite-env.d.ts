/// <reference types="vite/client" />

declare const __APP_VERSION__: string

interface ImportMetaEnv {
  readonly VITE_APP_TITLE: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module '*.svg' {
  const content: string
  export default content
}

declare module '*.png' {
  const content: string
  export default content
}

declare module '*.jpg' {
  const content: string
  export default content
}


// Electron API type (mirrors electron/preload.ts)
interface ElectronAPI {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
  send: (channel: string, ...args: unknown[]) => void
  minimizeWindow: () => void
  maximizeWindow: () => void
  closeWindow: () => void
  openFile: (options: any) => Promise<any>
  saveFile: (options: any) => Promise<any>
  readFile: (filePath: string) => Promise<{ success: boolean; data?: string; error?: string }>
  writeFile: (filePath: string, content: string) => Promise<{ success: boolean; error?: string }>
  openExternal: (url: string) => Promise<void>
  getPath: (name: string) => Promise<string>
  // 走 invoke：主进程端点安全校验可能拒绝写入，需回传 { success:false, error } 供渲染层展示
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
  configurePaddleOCR: (config: any) => void
  secureStorage: {
    get: (key: string) => Promise<string | null>
    set: (key: string, value: string) => Promise<boolean>
    delete: (key: string) => Promise<boolean>
    has: (key: string) => Promise<boolean>
    isAvailable: () => Promise<boolean>
  }
  // 批改历史加密存储（主进程）：渲染层只搬运整库字节，明文 PII 不落 localStorage
  history?: {
    load: () => Promise<Uint8Array | null>
    save: (bytes: Uint8Array) => Promise<{ ok: boolean; error?: string }>
    clear: () => Promise<{ ok: boolean; error?: string }>
  }
  // OCR 连接测试（主进程代理）：渲染层不接触真实 Token
  testOcrConnection?: (params: { url: string; model?: string }) => Promise<{
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
    getStatus: () => Promise<any>
    setSkip: (skip: boolean) => Promise<void>
    onStateChanged: (callback: (state: any) => void) => () => void
    onAvailable: (callback: (info: any) => void) => () => void
    onDownloaded: (callback: (info: any) => void) => () => void
  }
}

interface Window {
  electronAPI?: ElectronAPI
}
