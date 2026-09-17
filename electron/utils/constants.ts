/**
 * 常量定义 - 集中管理所有魔术数字和硬编码配置
 * 修改配置时只需在此文件修改，无需修改业务代码
 */

// ============ 超时配置 ============
export const TIMEOUT = {
  // 浏览器操作超时
  BROWSER_LAUNCH: 30000,          // 浏览器启动超时 30s
  BROWSER_CONNECT: 10000,          // 浏览器连接超时 10s
  PAGE_NAVIGATION: 30000,         // 页面导航超时 30s
  PAGE_LOAD: 30000,                // 页面加载超时 30s
  ELEMENT_WAIT: 5000,             // 元素等待超时 5s
  SCREENSHOT: 10000,              // 截图超时 10s
  
  // OCR 服务超时
  OCR_RECOGNIZE: 30000,           // OCR 识别超时 30s
  
  // AI 服务超时
  AI_GRADE: 30000,                // AI 评分超时 30s
  AI_API_CALL: 30000,             // AI API 调用超时 30s
  
  // 文件操作超时
  FILE_READ: 10000,               // 文件读取超时 10s
  FILE_WRITE: 10000,              // 文件写入超时 10s
  
  // 通用超时
  DEFAULT: 30000,                 // 默认超时 30s
  SHORT: 1000,                   // 短超时 1s
  MEDIUM: 5000,                  // 中等超时 5s
  LONG: 60000,                    // 长超时 60s
} as const

// ============ 重试配置 ============
export const RETRY = {
  // 浏览器健康检查
  HEALTH_CHECK_MAX: 60,           // 最大重试次数 60 次
  HEALTH_CHECK_INTERVAL: 5000,     // 重试间隔 5s
  
  // AI API 调用
  AI_API_MAX: 3,                  // 最大重试次数 3 次
  AI_API_INTERVAL: 1000,          // 重试间隔基数 1s（会递增）
  
  // OCR 服务调用
  OCR_MAX: 2,                     // 最大重试次数 2 次
  OCR_INTERVAL: 2000,             // 重试间隔 2s
} as const

// ============ 视口配置 ============
export const VIEWPORT = {
  WIDTH_MAX: 1920,                // 最大宽度 1920px
  HEIGHT_MAX: 1080,               // 最大高度 1080px
  SCALE_FACTOR: 0.95,            // 缩放因子 95%
} as const

// ============ 评分配置 ============
export const GRADING = {
  TEXT_MAX_LENGTH: 100000,        // 文本最大长度 100K 字符
  TEXT_MIN_LENGTH_FOR_BONUS: 10,   // 最小长度奖励阈值 10 字符
  TEXT_LENGTH_BONUS_1: 3,         // 长度奖励 1（+3 分）
  TEXT_LENGTH_BONUS_2: 2,         // 长度奖励 2（+2 分）
  TEXT_MIN_LENGTH_FOR_BONUS_2: 50, // 长度奖励 2 阈值 50 字符
  
  SCORE_MAX: 1000,                // 最大分数 1000
  SCORE_MIN: 0,                   // 最小分数 0
  
  LOCAL_GRADING: {
    BASE_SCORE: 5,                // 本地评分基础分 5
    HAS_QUESTION_BONUS: 3,        // 包含题目关键词奖励 3 分
    LENGTH_BONUS: 5,              // 长度奖励 5 分
    KEYWORD_MATCH_BONUS: 2,        // 关键词匹配奖励 2 分/个
    MAX_KEYWORDS: 5,               // 最大关键词数量 5 个
  },
} as const

// ============ 浏览器配置 ============
export const BROWSER = {
  // Playwright 配置
  HEADLESS: false,                 // 是否无头模式
  SLOW_MO: 100,                   // 慢动作延迟 100ms
  
  // 智学网选择器
  ZHIXUE: {
    SCORE_INPUT: '#score',                          // 分数输入框
    SCORE_INPUT_NEW: '#inputScore',                 // 新版分数输入框
    SCORE_INPUT_ALL_NEW: '#allScore',              // 新版全部题目分数输入框
    SCORE_INPUT_PLACEHOLDER: 'input[placeholder*="分数"]', // 占位符分数输入框
    SUBMIT_BUTTON: 'button[type="submit"]',        // 提交按钮
    SUBMIT_BUTTON_NEW: 'button:has-text("提交")',  // 新版提交按钮
    SUBMIT_BUTTON_TEXT: '提交分数',                // 提交按钮文本
    NEXT_BUTTON: 'button:has-text("下一题")',      // 下一题按钮
    QUESTION_CONTAINER: '.question-container',      // 题目容器
    ANSWER_AREA: '.answer-area',                  // 作答区域
  },
} as const

// ============ OCR 配置 ============
export const OCR = {
  // PaddleOCR 配置
  DEFAULT_MODEL: 'PP-OCRv5',       // 默认模型
  DEFAULT_TIMEOUT: 300,             // 默认超时 300s
  DEFAULT_SOURCE: 'aistudio',       // 默认来源
  
  // 百度 AI Studio Token 配置
  AISTUDIO: {
    TOKEN_HEADER: 'X-Access-Token', // Token header 名称
    DEFAULT_SERVER_URL: 'https://aistudio.baidu.com/aistudio/api/ocr', // 默认服务地址
  },
  
  // 百度千帆配置
  QIANFAN: {
    TOKEN_HEADER: 'Authorization',
    TOKEN_PREFIX: 'Bearer ',
    DEFAULT_SERVER_URL: 'https://qianfan.baidubce.com/v2/paddleocr',
  },
} as const

// ============ AI 服务配置 ============
export const AI = {
  // 默认配置
  DEFAULT_TEMPERATURE: 0.3,       // 默认温度（用于 API 测试等非评分场景）
  DEFAULT_MAX_TOKENS: 4000,        // 默认最大 token 数（思考模式会先消耗输出额度用于思维链，过小会导致正文为空）

  // 评分专用：锁温度，保证同卷同分、可复现、可审计（改进方案第一层）
  GRADING_TEMPERATURE: 0,
  // 提示词模板
  // 输入固定五项：题目、满分、参考答案、评分细则、学生作答（图片/文本）
  // 输出固定两项：最终分数、简短评分依据
  // {{SUBJECT_ROLE}} 为角色占位符：由 AIService.buildSystemPrompt() 按评分标准选择的学科替换；
  // 未选择学科时替换为默认的「你是一名专业的批改老师」。
  SYSTEM_PROMPT: `{{SUBJECT_ROLE}}，负责根据评分细则批改学生的作答。
你必须且只返回一个 JSON 对象，不要返回任何额外文字或 Markdown 代码块。
JSON 结构如下：
{
  "score": <整数分数，0 到满分之间>,
  "reasoning": "<简短评分依据，50~100 字：说明按评分细则的哪几条给了几分、扣了几分>"
}
评分规则：
- score 必须是整数，且 0 ≤ score ≤ 满分。
- 无论得分多少（包括 0 分与满分），reasoning 都必须填写，要具体到"哪几条细则给了分 / 扣了分 / 依据是什么"，便于教师复核。
- 评分细则中未覆盖的内容，按常识与学科规范合理判断，并在 reasoning 中说明。
- 是否给步骤分（过程分）以评分细则中的规定为准；细则未规定时按整体判分，不额外给步骤分。`,
} as const

// ============ 文件路径配置 ============
export const PATHS = {
  // 允许访问的路径名称（Electron app.getPath() 参数）
  ALLOWED_PATH_NAMES: ['home', 'appData', 'userData', 'temp', 'downloads', 'desktop'],
  
  // 配置文件名
  SELECTORS_CONFIG: 'selectors-config.json',
  BOT_SETTINGS: 'bot-settings.json',
} as const

// ============ IPC 通道白名单 ============
export const IPC_CHANNELS = {
  // 窗口控制
  SEND: ['window-minimize', 'window-maximize', 'window-close'],
  
  // 对话框
  INVOKE: [
    'dialog:openFile', 'dialog:saveFile',
    'bot:launch', 'bot:connect', 'bot:navigate', 'bot:getCurrentUrl', 'bot:analyze',
    'bot:capture', 'bot:capture-auto', 'bot:capture-coordinate', 'bot:capture-fullpage', 
    'bot:click-at', 'bot:type-at', 'bot:recognize',
    'bot:grade', 'bot:submit', 'bot:next', 'bot:close',
    'bot:analyzeCorrection',
  ],
  
  // 文件操作
  FILE: ['file:read', 'file:write', 'file:readImage'],
  
  // 外部链接
  SHELL: ['shell:openExternal'],
  
  // 应用路径
  APP: ['app:getPath'],
  
  // Bot 相关
  BOT: ['bot:updateBotSettings', 'bot:get-settings', 'bot:configurePaddleOCR', 'bot:setStandard', 'bot:test-api', 'bot:grade-image'],
  
  // 安全存储
  SECURE: ['secure:get', 'secure:set', 'secure:delete', 'secure:has', 'secure:is-available'],
  
  // 自动更新
  UPDATE: ['update:check', 'update:download', 'update:install', 'update:status', 'update:set-skip'],
  
  // 可监听的事件
  ON: ['update:state-changed', 'update:available', 'update:downloaded', 'window:maximize-change'],
} as const

// ============ 日志级别 ============
export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3,
}

// ============ 存储键名 ============
export const STORAGE_KEYS = {
  API_KEY_PREFIX: 'apikey_',        // API Key 存储键前缀
  API_KEY_DEFAULT: 'apikey_default', // 默认 API Key 键名
} as const

// ============ 敏感信息过滤规则 ============
export const SENSITIVE_PATTERNS = [
  /token/i,
  /apikey/i,
  /api_key/i,
  /password/i,
  /secret/i,
  /credential/i,
] as const

// ============ 默认配置 ============
export const DEFAULTS = {
  // 浏览器配置
  BROWSER_LAUNCH_OPTIONS: {
    headless: BROWSER.HEADLESS,
    slowMo: BROWSER.SLOW_MO,
    args: ['--disable-dev-shm-usage'],
  },
  
  // OCR 配置
  PADDLE_OCR_CONFIG: {
    enabled: false,
    serverUrl: '',
    model: OCR.DEFAULT_MODEL,
    source: OCR.DEFAULT_SOURCE,
    aistudioToken: '',
    qianfanApiKey: '',
    timeout: OCR.DEFAULT_TIMEOUT,
  },
  
  // AI 配置
  BOT_SETTINGS: {
    providers: [],
    activeProviderId: '',
    temperature: AI.DEFAULT_TEMPERATURE,
    maxTokens: AI.DEFAULT_MAX_TOKENS,
  },
} as const
