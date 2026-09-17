/**
 * AI 服务商端点守卫（安全修复：阻断-06 / 密钥外传 + SSRF）
 *
 * 背景：bot:test-api 会把已存储的真实 API Key 以 `Authorization: Bearer <key>`
 * 发往渲染层传入的 endpoint。若不做校验，渲染层（或被注入的渲染层代码）可以把
 * 真实密钥送往任意主机（密钥外传），并借此探测内网服务（SSRF）。
 *
 * 本模块是纯函数、零依赖、不触碰网络，便于单元测试与主进程接线：
 *   const check = assertSafeAIEndpoint(rawEndpoint, providerId)
 *   if (!check.ok) return { error: check.error }
 *   // 后续请求一律使用 check.endpoint（已归一化）
 */

export type EndpointCheckResult =
  | { ok: true; endpoint: string; host: string }
  | { ok: false; error: string }

/** chat/completions 后缀（与 electron/ipc.ts 的自动补全规则保持一致） */
const CHAT_COMPLETIONS_SUFFIX = '/chat/completions'

/**
 * 内置服务商域名白名单（来源 src/utils/aiProviders.ts 的预设 endpoint）
 * 精确匹配或子域匹配（如 foo.api.openai.com）
 */
const BUILTIN_AI_HOSTS: readonly string[] = [
  'api.deepseek.com',
  'open.bigmodel.cn',
  'dashscope.aliyuncs.com',
  'ark.cn-beijing.volces.com',
  'api.moonshot.cn',
  'api.siliconflow.cn',
  'api.openai.com',
]

/** 内置本地模型服务商（Ollama，见 aiProviders.ts 中 http://localhost:11434/v1） */
const LOCAL_PROVIDER_KEYS: readonly string[] = ['ollama']

/** 允许使用 http: 的本地主机（仅本地服务商可用） */
const LOCAL_HTTP_HOSTS: readonly string[] = ['localhost', '127.0.0.1']

/** 保留/内部域名后缀（内网解析风险） */
const RESERVED_HOST_SUFFIXES: readonly string[] = ['.local', '.internal', '.localhost', '.home.arpa']

/** 用户可见的中文提示（不包含任何密钥内容） */
const ERR_BLANK = '未配置服务商的 API 地址，请先在设置中填写服务商地址'
const ERR_MALFORMED = 'API 地址格式不正确，请填写完整的服务商地址（例如 https://api.deepseek.com/v1）'
const ERR_PROTOCOL = '出于安全考虑，API Key 只能发送到 https:// 地址（本地 Ollama 允许 http://localhost）'
const ERR_USERINFO = '出于安全考虑，API 地址中不允许包含用户名或密码'
const ERR_IP_LITERAL = '出于安全考虑，不允许把 API Key 发送到 IP 直连地址，请填写服务商的域名地址'
const ERR_PRIVATE_HOST = '出于安全考虑，不允许把 API Key 发送到内网地址（私有/保留网段），请填写服务商的公网域名地址'
const ERR_RESERVED_SUFFIX = '出于安全考虑，不允许把 API Key 发送到内网域名（.local/.internal/.localhost/.home.arpa）'

/**
 * 提取服务商标识前缀
 * 服务商 id 形如 `ollama_1712345678`（预设 key + 时间戳）或 uuid
 */
function resolveProviderKey(providerId: string): string {
  return String(providerId || '').trim().split('_')[0].toLowerCase()
}

/** 该服务商是否为内置本地模型服务商（Ollama） */
function isLocalProvider(providerId: string): boolean {
  return LOCAL_PROVIDER_KEYS.includes(resolveProviderKey(providerId))
}

/** 归一化端点的路径部分：去掉尾部 `/`，必要时补全 /chat/completions */
function normalizeEndpointPath(rawEndpoint: string): string {
  const trimmed = String(rawEndpoint || '').trim()
  const withoutTrailingSlash = trimmed.replace(/\/+$/, '')
  if (withoutTrailingSlash === '') return ''
  return withoutTrailingSlash.endsWith(CHAT_COMPLETIONS_SUFFIX)
    ? withoutTrailingSlash
    : withoutTrailingSlash + CHAT_COMPLETIONS_SUFFIX
}

/** 是否为白名单域名（精确或子域匹配） */
function isBuiltinAIHost(host: string): boolean {
  const normalized = host.toLowerCase()
  return BUILTIN_AI_HOSTS.some(builtin => normalized === builtin || normalized.endsWith('.' + builtin))
}

/** 是否为 IPv4 字面量（允许非规范写法，如 127.1 / 0x7f.1 里的纯数字段） */
function isIPv4Literal(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host)
}

/** 是否为 IPv6 字面量（URL 解析后带方括号，如 [::1]） */
function isIPv6Literal(host: string): boolean {
  if (host.startsWith('[') && host.endsWith(']')) return true
  // 不带方括号但包含冒号的形态（防御性；正常 URL 解析会带方括号）
  return host.includes(':')
}

/** 是否为私有/保留网段地址 */
function isPrivateOrReservedAddress(host: string): boolean {
  const bare = host.replace(/^\[/, '').replace(/\]$/, '').toLowerCase()

  // IPv6 环回 / 唯一本地地址(fc00::/7) / 链路本地(fe80::/10)
  if (bare === '::1' || bare === '::') return true
  if (/^f[cd][0-9a-f]{2}:/.test(bare)) return true
  if (/^fe[89ab][0-9a-f]:/.test(bare)) return true

  // IPv4-mapped IPv6（::ffff:192.168.1.1）
  const mapped = bare.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/)
  if (mapped) return isPrivateOrReservedAddress(mapped[1])

  if (!isIPv4Literal(bare)) return false
  const [a, b] = bare.split('.').map(Number)
  if (a === 0 || a === 10 || a === 127) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  return false
}

/** 是否为 .local / .internal / .localhost / .home.arpa 等保留域名 */
function hasReservedSuffix(host: string): boolean {
  const normalized = host.toLowerCase().replace(/\.$/, '')
  return RESERVED_HOST_SUFFIXES.some(suffix => normalized.endsWith(suffix))
}

/** 是否为明文禁止的本地主机名（仅本地服务商可用 localhost） */
function isLocalOnlyHost(host: string): boolean {
  const normalized = host.toLowerCase().replace(/^\[/, '').replace(/\]$/, '')
  return LOCAL_HTTP_HOSTS.includes(normalized)
}

/**
 * 校验并归一化 AI 服务商端点
 * @param rawEndpoint 渲染层传入的原始端点
 * @param providerId 服务商标识（用于放行内置本地模型服务商）
 */
export function assertSafeAIEndpoint(rawEndpoint: string, providerId: string): EndpointCheckResult {
  const endpoint = normalizeEndpointPath(rawEndpoint)
  if (endpoint === '') {
    return { ok: false, error: ERR_BLANK }
  }

  let parsed: URL
  try {
    parsed = new URL(endpoint)
  } catch {
    return { ok: false, error: ERR_MALFORMED }
  }

  const host = parsed.hostname
  if (!host) {
    return { ok: false, error: ERR_MALFORMED }
  }

  const localProvider = isLocalProvider(providerId)

  // 协议：默认必须 https；仅本地服务商 + 本地主机允许 http
  if (parsed.protocol !== 'https:') {
    const allowedLocalHttp =
      parsed.protocol === 'http:' && localProvider && isLocalOnlyHost(host)
    if (!allowedLocalHttp) {
      return { ok: false, error: ERR_PROTOCOL }
    }
  }

  // URL 内不允许内嵌凭据（避免密钥/口令被写入 URL 并被日志记录）
  if (parsed.username || parsed.password) {
    return { ok: false, error: ERR_USERINFO }
  }

  // 内置服务商白名单：放行（含子域）
  if (isBuiltinAIHost(host)) {
    return { ok: true, endpoint, host }
  }

  // 非白名单（自定义服务商）：
  // 本地服务商允许 localhost / 127.0.0.1（Ollama 等本地推理服务）
  if (localProvider && isLocalOnlyHost(host)) {
    return { ok: true, endpoint, host }
  }

  // IP 字面量直连（含 IPv6 / [::1] 形态）一律拒绝
  if (isIPv4Literal(host) || isIPv6Literal(host)) {
    return { ok: false, error: ERR_IP_LITERAL }
  }

  // 私有 / 保留网段
  if (isPrivateOrReservedAddress(host)) {
    return { ok: false, error: ERR_PRIVATE_HOST }
  }

  // 保留内网域名后缀 + 裸 localhost（非本地服务商不可用，防止绕过）
  if (hasReservedSuffix(host) || isLocalOnlyHost(host)) {
    return { ok: false, error: ERR_RESERVED_SUFFIX }
  }

  // 其余合法公网 https 域名放行（自定义服务商是产品的合法能力）
  return { ok: true, endpoint, host }
}

/**
 * 内置服务商 → 官方域名绑定表（providerId 前缀 → 官方域名 / 显示名）
 * 来源 src/utils/aiProviders.ts 的预设 endpoint。
 *
 * 为什么需要绑定：assertSafeAIEndpoint 只做"协议 + 防内网/防 IP 直连"，
 * 为了保留自定义服务商能力，它**放行任意公网 https 域名**。
 * 但内置服务商（deepseek/openai/...）的真实 Key 价值很高，
 * 若被注入的渲染层把 endpoint 改成攻击者域名，主进程仍会把真实 Key 发过去。
 * 因此内置服务商必须做域名绑定：只允许其官方域名（含子域）。
 */
const BUILTIN_PROVIDER_BINDINGS: Record<string, { host: string; name: string }> = {
  deepseek: { host: 'api.deepseek.com', name: 'DeepSeek' },
  zhipu: { host: 'open.bigmodel.cn', name: '智谱 GLM' },
  qwen: { host: 'dashscope.aliyuncs.com', name: '通义千问' },
  volcengine: { host: 'ark.cn-beijing.volces.com', name: '火山引擎' },
  moonshot: { host: 'api.moonshot.cn', name: 'Kimi' },
  siliconflow: { host: 'api.siliconflow.cn', name: '硅基流动' },
  openai: { host: 'api.openai.com', name: 'OpenAI' },
}

export type ProviderBindingResult =
  | { ok: true; bound: boolean; host: string }
  | { ok: false; error: string }

/**
 * 内置服务商端点绑定校验（在 assertSafeAIEndpoint 之后叠加调用）
 *
 * 规则：
 * - 内置服务商（deepseek/openai/...）：只允许其官方域名（含子域），否则拒绝
 * - 本地 Ollama：只允许 localhost / 127.0.0.1
 * - 自定义（custom）/ uuid 服务商 / 未知 providerId：无可绑定的官方域名，
 *   bound=false 放行（其 Key 本就是用户为该自定义地址申请的）
 *
 * 注意：这是"降低被注入渲染层把内置服务商真实 Key 送往攻击者域名"的加固，
 * 并非根治。自定义服务商仍可指向任意公网域名，根治需在渲染层被注入这一环治理
 * （CSP / 禁用远程内容 / 端点变更走主进程原生确认弹窗）。
 *
 * @param rawEndpoint 渲染层传入的原始端点（未归一化亦可）
 * @param providerId 服务商标识（形如 `deepseek` 或 `deepseek_1712345678`）
 */
export function assertProviderEndpointBinding(
  rawEndpoint: string,
  providerId: string
): ProviderBindingResult {
  const endpoint = normalizeEndpointPath(rawEndpoint)

  let parsed: URL
  try {
    parsed = new URL(endpoint)
  } catch {
    return { ok: false, error: ERR_MALFORMED }
  }

  const host = parsed.hostname.toLowerCase()
  if (!host) {
    return { ok: false, error: ERR_MALFORMED }
  }

  const key = resolveProviderKey(providerId)

  // 本地模型服务商：只允许本机地址
  if (key === 'ollama') {
    if (!isLocalOnlyHost(host)) {
      return { ok: false, error: '出于安全考虑，「本地 Ollama」只能使用 localhost 或 127.0.0.1 地址' }
    }
    return { ok: true, bound: true, host }
  }

  const binding = BUILTIN_PROVIDER_BINDINGS[key]
  if (!binding) {
    // 自定义 / uuid / 未知服务商：交回 assertSafeAIEndpoint 把关（公网 https 域名）
    return { ok: true, bound: false, host }
  }

  if (host !== binding.host && !host.endsWith('.' + binding.host)) {
    return {
      ok: false,
      error: `出于安全考虑，「${binding.name}」只允许使用官方地址 ${binding.host}；如需使用中转/镜像地址，请在设置中新建「自定义（OpenAI 兼容）」服务商并单独填写其 API Key`,
    }
  }

  return { ok: true, bound: true, host }
}

export default assertSafeAIEndpoint
