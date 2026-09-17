// 评分标准类型定义
export interface GradingStandard {
  id: string
  name: string
  /** 学科（选填）：选择后系统提示词角色变为「专业的XX批改老师」 */
  subject?: string
  questionNumber?: string // 题号（选填）
  question?: string // 题目内容（选填）
  totalScore: number
  // 评分细则：正式流程与测试流程统一为「自由文本」录入。
  // 兼容历史数据中的分点数组形态（旧标准仍可正常批改）。
  scoringRules: ScoringRule[] | string
  referenceAnswer: string
  examples: ExampleAnswer[]
  otherRequirements?: string // 其他要求（选填）
  processMatters?: boolean // 重视过程分：最终答案错误但步骤正确时按维度给步骤分（选填，默认关）
  createdAt: string
  updatedAt: string
}

export interface ScoringRule {
  id: string
  description: string
  score: number
  type: 'positive' | 'negative' // 加分项或扣分项
}

export interface ExampleAnswer {
  id: string
  content: string
  score: number
  comment: string
  image?: string
}

// 批改记录类型
export interface GradingRecord {
  id: string
  studentId?: string
  studentName?: string
  questionNumber?: string
  standardId: string
  standardName: string
  answerImage: string
  ocrText?: string
  score: number
  maxScore: number
  aiScore?: number
  aiComment?: string
  /** 打分依据：说明按哪条细则给了几分、扣了几分（旧版本记录可能没有该字段） */
  reasoning?: string
  evaluationMode: 'ai' | 'manual' | 'hybrid'
  status: 'pending' | 'processing' | 'completed' | 'failed'
  isBlank?: boolean // 是否为空白答题卡
  correctionReason?: string // 分数纠错原因
  createdAt: string
  completedAt?: string
}

// 预设套类型
export interface PresetSet {
  id: string
  name: string
  description: string
  standards: GradingStandard[]
  isDefault: boolean
}

// AI 服务商配置
export interface AiProvider {
  id: string
  name: string
  endpoint: string
  apiKey: string
  model: string
  // 视觉模型（选填）：图像直评优先用它；留空则回退使用 model。
  // 用于文本模型与多模态模型不同的情况，例如文本 deepseek-chat、视觉 deepseek-flash。
  visionModel?: string
  // 思考模式（DeepSeek）：true=开启 / false=关闭 / undefined=不传该参数（跟随服务端默认）
  thinkingEnabled?: boolean
  // 推理强度（DeepSeek）：low / high / max
  reasoningEffort?: 'low' | 'high' | 'max'
  isActive: boolean
}

// 主题配置
export interface ThemeCustomConfig {
  mode: 'light' | 'dark' | 'system' | 'highContrast'  // 主题模式（添加 system 支持）
  primaryColor: string                       // 主题色（十六进制）
  fontSize: 1 | 2 | 3 | 4 | 5             // 字体大小档位（1-5）
  highContrast: boolean                     // 高对比度模式
  presetTheme: string                       // 当前预设主题ID
}

// 应用设置
export interface AppSettings {
  // 音效设置
  soundEnabled: boolean
  soundVolume: number // 0-100
  
  // 二次确认设置
  confirmBeforeScore: boolean
  confirmBeforeSubmit: boolean
  
  // 空白答题卡检测
  blankDetectionEnabled: boolean
  blankDetectionThreshold: number // 相似度阈值 0-100
  blankSampleImage?: string // 示例空白卡图片
  
  // AI 设置 - 多服务商支持
  providers: AiProvider[]
  activeProviderId: string
  temperature: number  // 0-2
  maxTokens: number    // 最大 token 数
  
  // PaddleOCR设置
  paddleOcrEnabled: boolean
  paddleOcrToken: string
  paddleOcrUrl: string
  paddleOcrModel: string
  paddleOcrTimeout: number
  
  // 批改设置
  autoSaveInterval: number // 秒
  batchSize: number // 批量处理数量
  retryAttempts: number
  blankPaperHandling: 'skip' | 'zero' | 'manual'  // 空白卷处理方式：跳过/打0分/手动确认
  
  // 界面设置（保留旧字段以兼容）
  theme: 'light' | 'dark' | 'system'
  fontSize: 'small' | 'medium' | 'large'
  showScoreOnImage: boolean
  
  // 主题定制配置（新功能）
  themeCustom: ThemeCustomConfig
  
  // 键盘快捷键设置
  keyboardShortcutsEnabled: boolean  // 是否启用键盘快捷键
  showShortcutHints: boolean         // 是否显示快捷键提示
  
  // 开发者模式
  devMode: boolean                   // 是否启用开发者模式（显示性能监控面板）

  // 导出设置
  defaultExportFormat: 'pdf' | 'csv' | 'json'
  exportIncludeImages: boolean
  exportFileNameTemplate: string
}

// 批改进度
export interface GradingProgress {
  total: number
  completed: number
  failed: number
  current: number
  status: 'idle' | 'processing' | 'paused' | 'completed' | 'error'
  currentItem?: GradingRecord
}

// 筛选条件
export interface FilterCondition {
  questionNumber?: string
  evaluationMode?: 'ai' | 'manual' | 'hybrid'
  status?: 'pending' | 'processing' | 'completed' | 'failed'
  dateRange?: {
    start: string
    end: string
  }
  scoreRange?: {
    min: number
    max: number
  }
  searchText?: string
}

// 批改模式
export type GradingMode = 'normal' | 'trial' | 'unattended'

// ==================== 批改历史记录 ====================

/**
 * 批改历史记录接口
 * 用于记录每次批改的完整信息，支持历史回溯和对比
 */
export interface GradingHistory {
  id: string;                    // UUID
  examId: string;                // 考试ID
  studentId: string;             // 学生ID
  studentName?: string;           // 学生姓名（可选，便于显示）
  standardId: string;            // 评分标准ID
  standardName: string;          // 评分标准名称
  finalScore: number;            // 最终分数
  maxScore: number;              // 满分
  criteriaSnapshot: string;      // JSON 序列化的评分标准快照
  aiScoreDetail: string;         // JSON 序列化的 AI 评分详情
  correctionRecords: string;     // JSON 序列化的纠错记录
  gradingTime: number;           // 批改耗时（毫秒）
  evaluationMode: 'ai' | 'manual' | 'hybrid';  // 批改模式
  status: 'completed' | 'failed';  // 状态
  createdAt: string;             // ISO 8601 创建时间
  updatedAt?: string;            // ISO 8601 更新时间
}

/**
 * 批改历史筛选条件
 */
export interface GradingHistoryFilter {
  examId?: string;               // 按考试筛选
  studentId?: string;            // 按学生筛选
  studentName?: string;          // 按学生姓名搜索
  standardId?: string;           // 按评分标准筛选
  startDate?: string;            // 开始日期
  endDate?: string;              // 结束日期
  minScore?: number;             // 最低分数
  maxScore?: number;             // 最高分数
  evaluationMode?: 'ai' | 'manual' | 'hybrid';
  status?: 'completed' | 'failed';
  searchText?: string;           // 通用搜索文本
}

/**
 * 批改历史统计信息
 */
export interface GradingHistoryStatistics {
  total: number;                 // 总记录数
  completed: number;             // 完成数
  failed: number;                // 失败数
  averageScore: number;          // 平均分数
  averageTime: number;           // 平均批改时间（毫秒）
  passRate: number;              // 通过率（>=60% 满分）
}

/**
 * 历史对比结果
 */
export interface HistoryCompareResult {
  historyId1: string;
  historyId2: string;
  scoreDiff: number;             // 分数差异
  timeDiff: number;              // 时间差异（毫秒）
  details: {                     // 详细对比
    criteriaChanges: string[];   // 评分标准变化
    scoreChanges: string[];      // 分数变化说明
  };
}
