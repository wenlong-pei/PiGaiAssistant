// Playwright 自动化服务代理
// 渲染进程通过 IPC 调用主进程，开发模式使用模拟数据

import { performanceCollector, startMeasure, endMeasure } from '@/utils/performanceCollector'

interface OCRResult {
  text: string
  isBlank: boolean
  error?: string
}

interface PageElements {
  found: boolean
  answerArea?: string
  scoreInput?: string
  submitButton?: string
  nextButton?: string
  isOldUI?: boolean
  isNewUI?: boolean
  error?: string
  platformName?: string
  platformDisplayName?: string
}

interface BrowserLaunchResult {
  success: boolean
  method?: string
  error?: string
  details?: string[]
}

interface GradeResult {
  score: number
  comment: string
  // 评分依据：说明按哪条规则给/扣了多少分、为什么是这个分数
  reasoning?: string
  // 可选字段（向后兼容）：错因标签 / 建议人工复核
  errorTags?: string[]
  needsHumanReview?: boolean
  rubricBreakdown?: Array<{ id: string; awarded: number }>
}

// 图像直评结果：ok=false 时需回退到 OCR + 文本评分，reason 为切换原因
interface VisionGradeOutcome {
  ok: boolean
  result?: GradeResult
  reason?: string
}

interface RegionResult {
  answerArea: { x: number; y: number; width: number; height: number }
  scoreInput: { x: number; y: number }
  submitButton: { x: number; y: number }
  nextButton?: { x: number; y: number }
}

/**
 * 坐标型动作（点击 / 输入）的返回契约，与主进程 `BrowserService.CoordinateActionResult` 对齐。
 *
 * `true` —— 已成功派发（输入场景下还通过了「落值校验」）；
 * `{ error }` —— 失败，带可直接展示的原因。
 *
 * 注意：**不再用 `false` 表示失败**。旧契约下失败返回 `false`，而调用方只检查
 * `{ error }` 对象 → `false` 被静默忽略 → 分数没点中/没输进去仍继续提交并记 completed。
 * 类型定义在此本地声明，避免渲染层直接依赖 `electron/` 的类型。
 */
export type CoordinateActionResult = true | { error: string }

interface BotProxy {
  // 浏览器控制
  launchBrowser: (headless: boolean) => Promise<BrowserLaunchResult>
  navigateToUrl: (url: string) => Promise<void>
  getCurrentUrl: () => Promise<{ url: string; error?: string }>
  analyzePage: () => Promise<PageElements & { questionContent?: string; pageTitle?: string }>
  
  // 批改流程
  captureAnswer: () => Promise<string | null>
  captureAnswerAuto: () => Promise<string | null> // 自动获取图片
  captureByCoordinate: (x: number, y: number, width: number, height: number) => Promise<string | null> // 坐标截图
  captureFullPage: () => Promise<string | null> // 全页面截图（用于选区）
  clickAt: (x: number, y: number) => Promise<CoordinateActionResult> // 坐标点击（文档坐标 → 主进程换算为视口坐标）
  typeAt: (x: number, y: number, text: string) => Promise<CoordinateActionResult> // 坐标输入（含清空 + 落值校验）
  recognizeText: (imageBase64: string) => Promise<OCRResult>
  gradeWithAI: (text: string, correctionHistory?: any[]) => Promise<GradeResult>
  // 图像直评（首选路径）：直接把截图交给视觉模型识别并评分
  gradeWithImage: (imageDataUrl: string, correctionHistory?: any[]) => Promise<VisionGradeOutcome>
  // 图像直评（测试用）：使用传入的评分标准，而不是当前批改标准
  gradeImageWithStandard: (imageDataUrl: string, standard: any, correctionHistory?: any[]) => Promise<VisionGradeOutcome>
  // 文本评分（测试用）：使用传入的评分标准
  gradeWithStandard: (text: string, standard: any, correctionHistory?: any[]) => Promise<GradeResult>
  // 自动获取坐标：将整页截图送大模型识别批改区/成绩区/提交区坐标
  recognizeRegion: (imageDataUrl: string) => Promise<RegionResult | { error: string }>
  /** 提交分数：返回是否确认提交成功（修复 BUG-EXE-005 的静默失败） */
  submitScore: (score: number) => Promise<boolean>
  /** 切换下一题：'ok' 已切换 | 'last' 没有更多试卷 | 'error' 切换出错（不可当作结束） */
  nextPaper: () => Promise<'ok' | 'last' | 'error'>
  
  // 配置
  setGradingStandard: (standard: any) => void
  start: () => void
  stop: () => void
}

// 模拟 OCR 识别
function mockRecognize(_imageBase64: string): OCRResult {
  // 模拟：随机生成文本或空白
  const isBlank = Math.random() < 0.1
  if (isBlank) {
    return { text: '', isBlank: true }
  }
  
  const sampleTexts = [
    '这篇文章运用了比喻的修辞手法，将春天的景色描绘得生动形象。',
    '作者通过细腻的描写，表达了对故乡的深深思念之情。',
    '文中主人公勇敢坚强，面对困难从不退缩，值得我们学习。',
    '这段文字语言优美，意境深远，给人以美的享受。',
  ]
  return {
    text: sampleTexts[Math.floor(Math.random() * sampleTexts.length)],
    isBlank: false
  }
}

// 模拟 AI 评分
function mockGrade(text: string, standard: any): GradeResult {
  if (!standard) {
    const s = Math.floor(Math.random() * 10)
    return { score: s, comment: '模拟评语：答案基本正确' }
  }
  // 根据文本长度和关键词简单评分
  const baseScore = Math.min(standard.totalScore, Math.floor(text.length / 5))
  const s = Math.max(0, Math.min(standard.totalScore, baseScore + Math.floor(Math.random() * 3)))
  const ratio = s / (standard.totalScore || 10)
  let comment = '模拟评语：'
  if (ratio >= 0.9) comment += '回答非常优秀'
  else if (ratio >= 0.7) comment += '回答基本正确'
  else if (ratio >= 0.5) comment += '回答有一定内容'
  else comment += '回答不够完整'
  return { score: s, comment }
}

function createBotProxy(): BotProxy {
  const isElectron = typeof window !== 'undefined' && !!(window as any).electronAPI
  
  // 当前状态
  let currentStandard: any = null
  let mockConsecutiveCount = 0

  if (isElectron) {
    const electronAPI = (window as any).electronAPI
    
    return {
      launchBrowser: async (headless: boolean): Promise<BrowserLaunchResult> => {
        return await electronAPI.invoke('bot:launch', headless)
      },
      navigateToUrl: async (url: string) => {
        await electronAPI.invoke('bot:navigate', url)
      },
      getCurrentUrl: async () => {
        return await electronAPI.invoke('bot:getCurrentUrl') as Promise<{ url: string; error?: string }>
      },
      analyzePage: async () => {
        return await electronAPI.invoke('bot:analyze')
      },
      captureAnswer: async () => {
        return await electronAPI.invoke('bot:capture')
      },
      captureAnswerAuto: async () => {
        return await electronAPI.invoke('bot:capture-auto')
      },
      captureByCoordinate: async (x: number, y: number, width: number, height: number) => {
        return await electronAPI.invoke('bot:capture-coordinate', x, y, width, height)
      },
      captureFullPage: async () => {
        return await electronAPI.invoke('bot:capture-fullpage')
      },
      clickAt: async (x: number, y: number) => {
        return await electronAPI.invoke('bot:click-at', x, y)
      },
      typeAt: async (x: number, y: number, text: string) => {
        return await electronAPI.invoke('bot:type-at', x, y, text)
      },
      recognizeText: async (imageBase64: string) => {
        const startTime = startMeasure()
        try {
          const result = await electronAPI.invoke('bot:recognize', imageBase64)
          performanceCollector.collectOCRTime(startTime, true)
          return result
        } catch (error) {
          performanceCollector.collectOCRTime(startTime, false, String(error))
          throw error
        }
      },
      gradeWithAI: async (text: string, correctionHistory?: any[]) => {
        const startTime = startMeasure()
        try {
          const result = await electronAPI.invoke('bot:grade', text, currentStandard, correctionHistory)
          performanceCollector.collectAIScoreTime(startTime, true)
          return result
        } catch (error) {
          performanceCollector.collectAIScoreTime(startTime, false, String(error))
          throw error
        }
      },
      gradeWithImage: async (imageDataUrl: string, correctionHistory?: any[]): Promise<VisionGradeOutcome> => {
        const startTime = startMeasure()
        try {
          const result = await electronAPI.invoke('bot:grade-image', imageDataUrl, currentStandard, correctionHistory) as VisionGradeOutcome
          performanceCollector.collectAIScoreTime(startTime, true)
          return result
        } catch (error) {
          performanceCollector.collectAIScoreTime(startTime, false, String(error))
          throw error
        }
      },
      // 测试页专用：使用传入的评分标准，不影响当前批改标准
      gradeImageWithStandard: async (imageDataUrl: string, standard: any, correctionHistory?: any[]): Promise<VisionGradeOutcome> => {
        const result = await electronAPI.invoke('bot:grade-image', imageDataUrl, standard, correctionHistory) as VisionGradeOutcome
        return result
      },
      gradeWithStandard: async (text: string, standard: any, correctionHistory?: any[]): Promise<GradeResult> => {
        const result = await electronAPI.invoke('bot:grade', text, standard, correctionHistory) as GradeResult
        return result
      },
      recognizeRegion: async (imageDataUrl: string) => {
        return await electronAPI.invoke('bot:recognize-region', imageDataUrl)
      },
      submitScore: async (score: number): Promise<boolean> => {
        const result = await electronAPI.invoke('bot:submit', score)
        // 主进程可能返回 boolean，也可能返回 { success, error } 结构
        if (result && typeof result === 'object') {
          return !!(result as any).success
        }
        return result === true
      },
      nextPaper: async (): Promise<'ok' | 'last' | 'error'> => {
        const result = await electronAPI.invoke('bot:next')
        // 新契约：主进程直接返回三态字符串（'ok' | 'last' | 'error'），原样透传。
        // 兼容防御：若仍收到旧版 boolean（新契约下不再产生），
        // true → 'ok'、false → 'error'。
        // 【关键】绝不能把 false 映射为 'last' —— 否则"切换出错"会被误判成
        // "没有更多试卷"，导致批改静默中断并报成功。
        if (result === true) return 'ok'
        if (result === false) return 'error'
        return (result as 'ok' | 'last' | 'error') ?? 'error'
      },
      setGradingStandard: (standard: any) => {
        currentStandard = standard
        electronAPI.send('bot:setStandard', standard)
      },
      start: () => {
        // 修复 BUG-NEW-012：主进程无 bot:start 能力且该通道不在 preload 白名单，
        // 此前 send 必抛导致批改无法启动；开始/停止为纯前端状态，无需 IPC。
      },
      stop: () => {
        // 同 start：纯前端状态，无需 IPC（原 send('bot:stop') 不在白名单必抛）
      },
    }
  }

  // 开发模式模拟
  return {
    launchBrowser: async (_headless: boolean): Promise<BrowserLaunchResult> => {
      console.log('[Mock] 启动浏览器')
      await new Promise(r => setTimeout(r, 1000))
      return { success: true, method: 'mock' }
    },
    navigateToUrl: async (url: string) => {
      console.log('[Mock] 导航到:', url)
      await new Promise(r => setTimeout(r, 800))
    },
    getCurrentUrl: async () => {
      console.log('[Mock] 获取当前 URL')
      await new Promise(r => setTimeout(r, 200))
      return { url: 'https://mock.zhixue.com/mock-page' }
    },
    analyzePage: async () => {
      console.log('[Mock] 分析页面元素')
      await new Promise(r => setTimeout(r, 600))
      return {
        found: true,
        answerArea: '.answer-content',
        scoreInput: 'input[type="number"]',
        submitButton: 'button.submit',
        nextButton: '.next-btn'
      }
    },
    captureAnswer: async () => {
      console.log('[Mock] 截图')
      await new Promise(r => setTimeout(r, 500))
      // 返回一个空白图片 data URL
      return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    },
    captureAnswerAuto: async () => {
      console.log('[Mock] 自动获取图片')
      await new Promise(r => setTimeout(r, 600))
      // 模拟自动获取图片
      return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    },
    captureByCoordinate: async (x: number, y: number, width: number, height: number) => {
      console.log('[Mock] 坐标截图', { x, y, width, height })
      await new Promise(r => setTimeout(r, 500))
      return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    },
    captureFullPage: async () => {
      console.log('[Mock] 全页面截图')
      await new Promise(r => setTimeout(r, 500))
      return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    },
    clickAt: async (x: number, y: number): Promise<CoordinateActionResult> => {
      console.log('[Mock] 坐标点击', { x, y })
      await new Promise(r => setTimeout(r, 200))
      return true
    },
    typeAt: async (x: number, y: number, text: string): Promise<CoordinateActionResult> => {
      console.log('[Mock] 坐标输入', { x, y, text })
      await new Promise(r => setTimeout(r, 300))
      return true
    },
    recognizeText: async (imageBase64: string) => {
      console.log('[Mock] OCR识别')
      const startTime = startMeasure()
      await new Promise(r => setTimeout(r, 800))
      const result = mockRecognize(imageBase64)
      endMeasure(startTime, 'ocr', true)
      return result
    },
    gradeWithAI: async (text: string, correctionHistory?: any[]) => {
      console.log('[Mock] AI评分:', text.substring(0, 20) + '...', correctionHistory?.length ? `(有${correctionHistory.length}条纠错历史)` : '')
      const startTime = startMeasure()
      await new Promise(r => setTimeout(r, 1000))
      const result = mockGrade(text, currentStandard)
      endMeasure(startTime, 'ai', true)
      return result
    },
    // 开发模式（浏览器预览）无主进程 AI 能力，直接返回不可用，让调用方走 OCR 兜底
    gradeWithImage: async (_imageDataUrl: string, _correctionHistory?: any[]) => {
      console.log('[Mock] 图像直评不可用（开发模式），转 OCR 兜底')
      return { ok: false, reason: '开发模式不支持图像直评' }
    },
    // 测试页专用：使用传入的评分标准，不影响当前批改标准
    gradeImageWithStandard: async (_imageDataUrl: string, _standard: any, _correctionHistory?: any[]): Promise<VisionGradeOutcome> => {
      // 修复 BUG-NEW-010：开发模式无主进程，此前引用未定义的 electronAPI 必抛 ReferenceError
      console.log('[Mock] 图像直评不可用（开发模式），转 OCR 兜底')
      return { ok: false, reason: '开发模式不支持图像直评' }
    },
    gradeWithStandard: async (text: string, standard: any, _correctionHistory?: any[]): Promise<GradeResult> => {
      // 修复 BUG-NEW-010：开发模式用模拟评分，不再引用未定义的 electronAPI
      return mockGrade(text, standard)
    },
    recognizeRegion: async (_imageDataUrl: string) => {
      console.log('[Mock] 自动识别区域坐标')
      await new Promise(r => setTimeout(r, 800))
      // 返回基于 1280x800 示意截图的模拟坐标
      return {
        answerArea: { x: 120, y: 220, width: 760, height: 520 },
        scoreInput: { x: 920, y: 320 },
        submitButton: { x: 920, y: 420 },
        nextButton: { x: 1040, y: 520 },
      }
    },
    submitScore: async (score: number): Promise<boolean> => {
      console.log('[Mock] 提交分数:', score)
      await new Promise(r => setTimeout(r, 500))
      return true
    },
    nextPaper: async (): Promise<'ok' | 'last' | 'error'> => {
      console.log('[Mock] 切换下一张')
      await new Promise(r => setTimeout(r, 600))
      mockConsecutiveCount++
      // 模拟20张后结束
      return mockConsecutiveCount < 20 ? 'ok' : 'last'
    },
    setGradingStandard: (standard: any) => {
      currentStandard = standard
      console.log('[Mock] 设置评分标准:', standard?.name)
    },
    start: () => {
      mockConsecutiveCount = 0
      console.log('[Mock] 开始')
    },
    stop: () => {
      console.log('[Mock] 停止') 
    },
  }
}

export const gradingBotProxy = createBotProxy()
