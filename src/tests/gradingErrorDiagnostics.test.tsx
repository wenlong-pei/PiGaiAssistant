/**
 * 「批改中断」可诊断性回归测试（阻断-05）
 *
 * 背景：皮老板反馈试改模式确认提交后弹出
 *   「批改中断: 操作失败，请查看日志或重新尝试」
 * 而日志里**只有这句翻译后的兜底文案**，真实异常（QuotaExceededError）被丢弃，
 * 用户被引导"查看日志"却看不到任何可行动信息。
 *
 * 本文件守住两件事：
 *   1. 配额/存储类异常必须被翻译成人话（而不是落到兜底句）；
 *   2. 批改主循环的 catch 必须把**原始错误**写进日志。
 */
import { describe, it, expect, vi } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn(), loading: vi.fn(), dismiss: vi.fn() },
}))

vi.mock('@/hooks/useSound', () => ({
  useSound: () => ({ playSuccess: vi.fn(), playError: vi.fn(), playClick: vi.fn() }),
}))

vi.mock('@/services/playwrightProxy', () => ({
  gradingBotProxy: new Proxy({}, { get: () => vi.fn() }),
}))

// 与本次改动无关的展示组件（另一位成员正在并行修改布局），测试中隔离掉
vi.mock('@/components/grading/GradingLogs', () => ({ default: () => null }))
vi.mock('@/components/grading/AiAnalysisPanel', () => ({ default: () => null }))
vi.mock('@/pages/CoordinateGradingPage.scss', () => ({}))

import {
  translateError,
  describeGradingError,
  isStorageQuotaError,
  GRADING_ERROR_FALLBACK,
} from '@/pages/CoordinateGradingPage'

/** Chromium 实测（Playwright/真实 Chromium，写入 46 份带图记录时抛出） */
const CHROMIUM_QUOTA_MESSAGE =
  "Failed to execute 'setItem' on 'Storage': Setting the value of 'grading-records' exceeded the quota."

const ROOT = process.cwd()

/** 去掉注释后再断言：把接线代码注释掉不能骗过文本断言 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function read(relativePath: string): string {
  return stripComments(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'))
}

describe('错误翻译：存储配额类异常必须给人话（阻断-05）', () => {
  it('真实 Chromium 的 QuotaExceededError 文案不再落到兜底句', () => {
    const friendly = translateError(CHROMIUM_QUOTA_MESSAGE)
    expect(friendly).not.toBe(GRADING_ERROR_FALLBACK)
    expect(friendly).toContain('存储空间已满')
    // 必须给出可行动信息：去「记录」页清理
    expect(friendly).toContain('记录')
  })

  it('配额相关关键词（Chrome / Firefox / 不同写法）都能命中', () => {
    const samples = [
      'QuotaExceededError',
      'QuotaExceededError: Failed to execute setItem',
      'NS_ERROR_DOM_QUOTA_REACHED',
      "Failed to execute 'setItem' on 'Storage': exceeded the quota",
      'localStorage is not available',
    ]
    for (const sample of samples) {
      expect(translateError(sample), sample).not.toBe(GRADING_ERROR_FALLBACK)
      expect(isStorageQuotaError(sample), sample).toBe(true)
    }
  })

  it('isStorageQuotaError 不会把普通异常误判成配额问题', () => {
    expect(isStorageQuotaError('Target closed')).toBe(false)
    expect(isStorageQuotaError('请求超时，请检查网络或稍后重试')).toBe(false)
  })

  it('提交后可能出现的其它异常也要有人话（IPC / 页面关闭 / 超时 / 磁盘 / 内存）', () => {
    const cases: Array<[string, string]> = [
      ["Error invoking remote method 'bot:click-at': Error: x", '主进程'],
      ['Target page, context or browser has been closed', '浏览器'],
      ['Timeout 5000ms exceeded', '超时'],
      ['ENOSPC: no space left on device', '磁盘'],
      ['Array buffer allocation failed', '内存'],
      ['SecurityError: The operation is insecure.', '存储'],
    ]
    for (const [raw, expected] of cases) {
      const friendly = translateError(raw)
      expect(friendly, raw).not.toBe(GRADING_ERROR_FALLBACK)
      expect(friendly, raw).toContain(expected)
    }
  })

  it('未命中任何模式时：保留兜底句，但把原始错误附上（用户截一张图也能看到真因）', () => {
    const friendly = describeGradingError('SomeBrandNewWeirdFailure: 0xDEADBEEF')
    expect(friendly.startsWith(GRADING_ERROR_FALLBACK)).toBe(true)
    expect(friendly).toContain('SomeBrandNewWeirdFailure')
  })

  it('命中模式时不再画蛇添足地附原始错误', () => {
    expect(describeGradingError(CHROMIUM_QUOTA_MESSAGE)).toBe(
      translateError(CHROMIUM_QUOTA_MESSAGE)
    )
  })

  it('原始错误超过长度上限会被截断（避免超长异常把 toast 撑爆）', () => {
    const friendly = describeGradingError('X'.repeat(1000))
    expect(friendly.length).toBeLessThan(GRADING_ERROR_FALLBACK.length + 200)
  })
})

describe('批改主循环可诊断性接线契约（源码级）', () => {
  const source = read('src/pages/CoordinateGradingPage.tsx')

  it('catch 里必须把原始错误写进日志（否则"查看日志"等于没有日志）', () => {
    const start = source.indexOf('批改中断: ${friendly}')
    expect(start, '未找到批改中断的日志写入点').toBeGreaterThan(-1)
    const region = source.slice(Math.max(0, start - 400), start + 800)
    expect(region).toContain('原始错误: ${errMsg}')
    // 配额类错误还要给出可行动建议
    expect(region).toContain('isStorageQuotaError(errMsg)')
  })

  it('日志写入本身也要防抛错（配额满时 addLog 自己也会抛）', () => {
    const start = source.indexOf('批改中断: ${friendly}')
    const region = source.slice(Math.max(0, start - 400), start + 900)
    expect(region).toContain('catch (logError)')
  })

  it('非关键副作用必须走 runSideEffect 包装：保存记录 / 进度持久化 / 音效', () => {
    expect(source).toContain("runSideEffect('保存批改记录'")
    expect(source).toContain("runSideEffect('保存批改进度'")
    expect(source).toContain("runSideEffect('播放提示音'")
    // addRecord 必须在包装内部，不能再裸调用
    expect(source.includes('\n        addRecord({')).toBe(false)
  })

  it('persist 降级必须被上报（用户能看到"没写盘"而不是静默丢数据）', () => {
    expect(source).toContain('reportPersistDegradation')
    expect(source).toContain('getRecordsPersistError')
  })

  it('红线：平台确认、needsHumanReview、三态语义不得被这次改动放宽', () => {
    // 提交必须被平台显式确认才算成功
    expect(source).toContain('isSubmitAcknowledged(clickResult2)')
    expect(source).toContain('isSubmitAcknowledged(blankSubmitAck)')
    // 本地降级 / 解析失败才允许 needsHumanReview
    expect(source).toContain('gradeResult.needsHumanReview === true')
    // 自动提交白名单仍然只看 needsHumanReview
    expect(source).toContain('const requiresHumanReview =')
    // 记录仍以 AI 判分为准，不得用本地分数冒充
    expect(source).toContain("evaluationMode: 'ai'")
  })

  it('红线：nextPaper 三态里的 false 绝不能被映射成 "last"（切换出错 ≠ 没有更多试卷）', () => {
    const proxy = read('src/services/playwrightProxy.ts')
    const start = proxy.indexOf("nextPaper: async")
    expect(start).toBeGreaterThan(-1)
    const region = proxy.slice(start, start + 900)
    expect(region).toContain("return 'error'")
    expect(region.includes("if (result === false) return 'last'")).toBe(false)
    expect(region).toContain("'ok' | 'last' | 'error'")
  })

  it('红线：recordsStore 必须给持久化载荷做 partialize（否则大图仍然会撑爆配额）', () => {
    const store = read('src/store/recordsStore.ts')
    expect(store).toContain('partialize')
    expect(store).toContain('stripImagesBeyondBudget')
    // 容错存储必须接在 persist 选项上
    expect(store).toContain('storage: resilientStorage')
  })
})
