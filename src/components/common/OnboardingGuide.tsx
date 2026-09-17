import { useEffect, useRef } from 'react'
import { driver } from 'driver.js'
import 'driver.js/dist/driver.css'

// ============================================
// 新手引导步骤配置（5步，纯设置页内引导）
// 不再跨页面跳转，其他页面操作直接用文字说明
// ============================================

const STORAGE_KEY_COMPLETED = 'pilaoban_onboarding_completed'
const STORAGE_KEY_DISMISSED = 'pilaoban_onboarding_dismissed'

interface OnboardingStep {
  /** CSS 选择器，指向要高亮的元素；省略则显示居中文字页 */
  element?: string
  popover: {
    title: string
    description: string
    /** 提示框位置（相对于高亮元素） */
    position: 'top' | 'bottom' | 'left' | 'right'
  }
}

const onboardingSteps: OnboardingStep[] = [
  // ===== 第1步：欢迎 =====
  {
    popover: {
      title: '🎉 欢迎使用皮老板智能阅卷工具',
      description:
        '本工具可以帮你自动批改各平台作业。\n\n' +
        '引导将带你完成初始设置（约3分钟），也可以随时点击左下角"新手引导"重新查看。',
      position: 'bottom',
    },
  },
  // ===== 第2步：侧边栏"系统设置" =====
  {
    element: '.sidebar__item[href="#/settings"]',
    popover: {
      title: '第一步：进入系统设置',
      description: '先点击左侧「系统设置」进入设置页（你现在应该已经在这里了）。',
      position: 'right',
    },
  },
  // ===== 第3步：AI 配置区域 =====
  {
    element: '.settings-ai-section',
    popover: {
      title: '配置 AI 服务商',
      description:
        '在这里填入 API Key 和模型名称，保存后即可使用 AI 自动评分。\n' +
        '支持 DeepSeek、火山引擎、硅基流动等，点"连接测试"可验证配置是否正确。',
      position: 'left',
    },
  },
  // ===== 第4步：OCR 配置区域 =====
  {
    element: '.settings-ocr-section',
    popover: {
      title: '配置 OCR 识别服务',
      description:
        '往下滚动，配置 PaddleOCR 服务，用于识别学生作答内容。\n' +
        '需要输入 Token 和服务地址，同样可以点"测试连接"验证。',
      position: 'left',
    },
  },
  // ===== 第5步：后续步骤文字说明（无高亮元素，居中显示） =====
  {
    popover: {
      title: '✅ 设置完成！后续步骤',
      description:
        '设置保存后，请按以下顺序操作：\n\n' +
        '① 点击左侧「评分标准」→ 点击"添加标准"按钮 → 填写题目信息、满分值、参考答案和关键词 → 保存\n\n' +
        '② 点击左侧「坐标批改」→ 输入作业链接 → 选择评分标准 → 点击"开始自动批改"\n\n' +
        '引导到此结束，祝批改顺利！如有疑问可随时点击左下角"新手引导"查看。',
      position: 'bottom',
    },
  },
]

// driver.js 配置：无遮罩，提示框锚定到目标元素旁
const driverBaseConfig = {
  overlayOpacity: 0,
  allowClose: true,
  allowScroll: true,
  showProgress: true,
  stagePadding: 10,
  stageRadius: 8,
  nextBtnText: '下一步',
  prevBtnText: '上一步',
  doneBtnText: '完成了！',
}

// ============================================
// 工具函数
// ============================================

function toDriverSteps(steps: OnboardingStep[]): any[] {
  return steps.map((s) => ({
    ...(s.element ? { element: s.element } : {}),
    popover: s.popover,
  }))
}

// ============================================
// 导出 API
// ============================================

/** 侧边栏"新手引导"按钮调用 */
export function startOnboardingGuide() {
  localStorage.removeItem(STORAGE_KEY_COMPLETED)
  localStorage.removeItem(STORAGE_KEY_DISMISSED)
  launchGuide(0)
}

/** 设置页"新手引导"链接调用（与 startOnboardingGuide 行为一致） */
export function resetOnboarding() {
  localStorage.removeItem(STORAGE_KEY_COMPLETED)
  localStorage.removeItem(STORAGE_KEY_DISMISSED)
  launchGuide(0)
}

/**
 * 启动引导核心函数
 * 不再跨页面导航，所有步骤均在当前页面内完成
 */
function launchGuide(fromStep: number = 0) {
  const d = driver({
    ...driverBaseConfig,
    onDestroyed: () => {
      localStorage.setItem(STORAGE_KEY_COMPLETED, 'true')
    },
  })

  d.setSteps(toDriverSteps(onboardingSteps))
  d.drive(fromStep)
}

// ============================================
// React 组件：挂载在 App.tsx 中
// 职责：首次访问设置页时自动弹出引导
// ============================================
let hasShownAutoGuide = false

export default function OnboardingGuide() {
  const hasMounted = useRef(false)

  useEffect(() => {
    // 首次自动引导（仅执行一次）
    if (hasMounted.current) return
    hasMounted.current = true
    if (hasShownAutoGuide) return

    const completed = localStorage.getItem(STORAGE_KEY_COMPLETED)
    const dismissed = localStorage.getItem(STORAGE_KEY_DISMISSED)
    if (completed || dismissed) return

    hasShownAutoGuide = true
    const timer = setTimeout(() => launchGuide(0), 800)
    return () => clearTimeout(timer)

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return null
}
