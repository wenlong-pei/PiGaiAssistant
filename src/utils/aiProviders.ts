/**
 * AI 服务商预设
 * 全部为 OpenAI 兼容的 /chat/completions 协议（含本地 Ollama 的 /v1 兼容模式）。
 * 说明：厂商模型名会持续更新，这里只列常见型号作为输入参考（不是下拉选项）；
 *      模型名称一律手填，新模型随时可用，不受预设清单限制。
 */

export interface ProviderPreset {
  /** 预设标识 */
  key: string
  /** 显示名称 */
  name: string
  /** API 地址（base 或完整 chat 路径均可，主进程会自动补全 /chat/completions） */
  endpoint: string
  /** 默认模型 */
  model: string
  /** 常见模型（仅作为输入框下方的参考提示，不作为下拉选项） */
  models: string[]
  /** 默认视觉模型（选填）：支持图片输入的模型；留空表示跟随 model */
  visionModel?: string
  /** 思考模式（DeepSeek）：开启后 temperature 会被忽略 */
  thinkingEnabled?: boolean
  /** 推理强度（DeepSeek）：low / high / max */
  reasoningEffort?: 'low' | 'high' | 'max'
  /** API Key 输入提示 */
  keyHint: string
  /** 备注 */
  note?: string
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    key: 'deepseek',
    name: 'DeepSeek',
    endpoint: 'https://api.deepseek.com/v1',
    model: 'deepseek-flash',
    // V4.1 Flash 原生多模态：同一模型既可看图直评，也可文本评分，无需分设两个模型
    models: ['deepseek-flash', 'deepseek-chat', 'deepseek-reasoner'],
    // 官方默认即开启思考模式、强度 high；关闭后 temperature=0 才会生效（同卷同分）
    thinkingEnabled: true,
    reasoningEffort: 'high',
    keyHint: 'sk-...',
    note: '推荐 deepseek-flash（V4.1 Flash，原生支持图像与文本）；思考模式开启时 temperature 无效',
  },
  {
    key: 'zhipu',
    name: '智谱 GLM',
    endpoint: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4-flash',
    models: ['glm-4-flash', 'glm-4.6', 'glm-4.5', 'glm-4.5-flash'],
    keyHint: '控制台 API Key（形如 id.secret）',
    note: '开放平台 base 为 /api/paas/v4',
  },
  {
    key: 'qwen',
    name: '通义千问（阿里云百炼）',
    endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
    models: ['qwen-plus', 'qwen-turbo', 'qwen-max', 'qwen-long'],
    keyHint: 'sk-...（百炼控制台）',
    note: '需使用「OpenAI 兼容模式」地址',
  },
  {
    key: 'volcengine',
    name: '火山引擎（豆包）',
    endpoint: 'https://ark.cn-beijing.volces.com/api/v3',
    model: '',
    models: ['doubao-pro-32k', 'doubao-lite-32k'],
    keyHint: '方舟 API Key',
    note: '模型名通常填方舟控制台的「模型 ID / Endpoint ID」',
  },
  {
    key: 'moonshot',
    name: 'Kimi（月之暗面）',
    endpoint: 'https://api.moonshot.cn/v1',
    model: 'moonshot-v1-8k',
    models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
    keyHint: 'sk-...',
  },
  {
    key: 'siliconflow',
    name: '硅基流动',
    endpoint: 'https://api.siliconflow.cn/v1',
    model: 'Qwen/Qwen2.5-7B-Instruct',
    models: ['Qwen/Qwen2.5-7B-Instruct', 'deepseek-ai/DeepSeek-V3', 'THUDM/glm-4-9b-chat'],
    keyHint: 'sk-...',
  },
  {
    key: 'openai',
    name: 'OpenAI',
    endpoint: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini'],
    keyHint: 'sk-...',
  },
  {
    key: 'ollama',
    name: '本地 Ollama',
    endpoint: 'http://localhost:11434/v1',
    model: 'qwen2.5:7b',
    models: ['qwen2.5:7b', 'llama3.1:8b', 'glm4:9b'],
    keyHint: '本地无需 Key，可填 ollama',
    note: '需先 ollama serve，模型名填本地已拉取的 tag（如 qwen2.5:7b）',
  },
  {
    key: 'custom',
    name: '自定义（OpenAI 兼容）',
    endpoint: '',
    model: '',
    models: [],
    keyHint: 'sk-...',
    note: '任意 OpenAI 兼容接口，如各类中转/聚合/私有化部署',
  },
]

/**
 * 根据预设 key 获取预设
 */
export function getPreset(key: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find(p => p.key === key)
}

/**
 * 依据服务商 ID 猜测其预设（ID 形如 zhipu_1712345678）
 */
export function guessPresetByProviderId(id: string): ProviderPreset | undefined {
  if (!id) return undefined
  const prefix = id.split('_')[0]
  return PROVIDER_PRESETS.find(p => p.key === prefix)
}

/**
 * 生成服务商 ID（预设 key + 时间戳，保证唯一且可反查预设）
 */
export function buildProviderId(presetKey: string): string {
  return `${presetKey}_${Date.now()}`
}

/**
 * 预设对应的视觉模型：显式配置优先，未配置则回退用主模型（全能模型无需分设）
 */
export function getPresetVisionModel(presetKey: string, mainModel: string): string {
  return getPreset(presetKey)?.visionModel || mainModel
}
