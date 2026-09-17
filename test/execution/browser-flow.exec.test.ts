/**
 * 真实浏览器执行验证（EXE-*）
 * 目标：用 Playwright 加载本地 Mock 智学网批改页，驱动真实 ZhixueAdapter 提交链路，
 * 实证：正常流程、提交/切换异常、重复提交、捕获链路在当前源码下的真实行为。
 * 说明：断言以「实证缺陷」为准——当前源码存在确定性缺陷时，断言验证缺陷行为并记录。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { chromium, Browser, Page } from 'playwright'
import * as path from 'path'
import * as fs from 'fs'
import { ConfigService } from '../../electron/services/ConfigService'
import { ZhixueAdapter } from '../../electron/adapters/ZhixueAdapter'

const MOCK_PAGE = path.resolve(__dirname, 'mock-zhixue.html')

let browser: Browser
let page: Page
let adapter: ZhixueAdapter
let logger: any
let configService: ConfigService

async function openMockPage(query: string = ''): Promise<Page> {
  const p = await browser.newPage()
  await p.goto(`file://${MOCK_PAGE}${query}`)
  await p.waitForFunction(() => (window as any).__g)
  return p
}

async function state(p: Page): Promise<any> {
  return p.evaluate(() => (window as any).__g)
}

beforeAll(async () => {
  // 准备测试用 userData：复制 config/selectors.json 到 stub userData，模拟真实环境
  const userData = path.join(process.env.TEMP || '.', 'qa-exec-userdata')
  fs.mkdirSync(userData, { recursive: true })
  fs.copyFileSync(path.resolve(__dirname, '../../config/selectors.json'), path.join(userData, 'selectors.json'))

  try {
    browser = await chromium.launch({ headless: true })
  } catch {
    const edgeCandidates = [
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    ]
    const edgePath = edgeCandidates.find((p) => fs.existsSync(p))
    if (edgePath) {
      browser = await chromium.launch({ headless: true, executablePath: edgePath })
    } else {
      throw new Error('无可用浏览器二进制')
    }
  }
  logger = {
    info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn()
  }
})

afterAll(async () => {
  await browser?.close()
})

beforeEach(async () => {
  configService = new ConfigService(logger as any)
  await configService.init() // 真实 app 在 app.whenReady 后调用 init() 加载 selectors.json
  adapter = new ZhixueAdapter(logger as any, configService)
})

describe('EXE 真实浏览器批改链路（Mock 智学网页，实证缺陷）', () => {
  it('EXE-1 提交分数：BUG-EXE-001/005 修复后正常提交（true），不再误报失败', async () => {
    page = await openMockPage()
    const ok = await adapter.submitScore(page, 8)
    // 2026-09-17 随「阻断-03 提交结果核验」更新：
    // 排障手改用 clickSubmitTarget 精确探测 click 事件是否送达（clickFired），
    // 不再用"输入框仍有值/按钮仍可点"猜失败 → 真实提交返回 true。
    expect(ok).toBe(true)
    const s = await state(page)
    expect(s.submitted.length).toBe(1)
    expect(s.submitClicks).toBe(1)
    await page.close()
  })

  it('EXE-2 切换下一题：BUG-EXE-006 修复后正常切换（三态：ok）', async () => {
    page = await openMockPage()
    const hasNext = await adapter.goToNext(page)
    // 2026-09-17 随「阻断-01 切题三态」更新：goToNext 返回 'ok' | 'last' | 'error'，不再是布尔值
    expect(hasNext).toBe('ok')
    const s = await state(page)
    expect(s.current).toBe(2) // 题号已前进
    await page.close()
  })

  it('EXE-3 提交按钮被弹窗拦截：返回 false、页面未提交且不再静默放行（提交核验生效）', async () => {
    page = await openMockPage('?popup=1')
    const ok = await adapter.submitScore(page, 9)
    // 2026-09-17 随「阻断-03 提交结果核验」更新：点击被弹窗吞掉后，
    // verifySubmitOutcome 判定为 failure → 返回 false（旧实现会静默返回 true）。
    expect(ok).toBe(false)
    const s = await state(page)
    expect(s.submitted.length).toBe(0)
    await page.close()
  })

  it('EXE-4 输入框被禁用：不写入、不触发事件，提交返回 false', async () => {
    page = await openMockPage('?disabled-input=1')
    const ok = await adapter.submitScore(page, 7)
    // 2026-09-17 随「阻断-03 / EXE-4」更新：submitScore 写入前先判可见 + 非 disabled/aria-disabled，
    // 命中 disabled 直接返回，不写入、不触发 input 事件。
    expect(ok).toBe(false)
    const s = await state(page)
    expect(s.submitted.length).toBe(0)
    expect(s.lastScoreInputValue).toBe('')
    await page.close()
  })

  it('EXE-5 重复提交无幂等防护：两次调用均成功提交（累计 2 次）', async () => {
    page = await openMockPage()
    const r1 = await adapter.submitScore(page, 5)
    const r2 = await adapter.submitScore(page, 5)
    // 2026-09-17 随「阻断-03」更新：两次均真实提交成功（true）。
    // 同一分数重复提交无幂等防护 → 真实缺口（需产品决策去重策略），如实记录。
    expect(r1).toBe(true)
    expect(r2).toBe(true)
    const s = await state(page)
    expect(s.submitted.length).toBe(2)
    await page.close()
  })

  it('EXE-6 最后一题 goToNext：控件存在即返回 ok，无法识别"已是最后一题"（结束判定缺口）', async () => {
    page = await openMockPage()
    await adapter.goToNext(page)
    await adapter.goToNext(page)
    const hasNext = await adapter.goToNext(page)
    // 2026-09-17 随「阻断-01 切题三态」更新：goToNext 返回 'ok' | 'last' | 'error'。
    // mock 页在最后一题仍保留可点击的"下一题"按钮且无结束文案 → 第 3 次仍返回 'ok'，
    // 渲染层无法据此判断结束（潜在死循环）。切题结束判定缺口，如实记录。
    expect(hasNext).toBe('ok')
    const s = await state(page)
    expect(s.current).toBe(3) // 前两次已推进到第 3 题；第三次不再前进
    await page.close()
  })

  it('EXE-7 captureAnswerImage：配置加载后正常返回 base64（正常路径可用）', async () => {
    page = await openMockPage()
    const img = await adapter.captureAnswerImage(page)
    expect(img).toBeTruthy()
    expect(String(img).startsWith('data:')).toBe(true)
    await page.close()
  })

  it('EXE-8 页面缺少答案图时 capture 返回 null，切下一题仍可成功（三态：ok）', async () => {
    page = await openMockPage()
    await page.evaluate(() => { document.getElementById('answerImg')!.remove() })
    const img = await adapter.captureAnswerImage(page)
    expect(img).toBeNull()
    const hasNext = await adapter.goToNext(page)
    // 2026-09-17 随「阻断-01 切题三态」更新：切题已修复，返回 'ok'，
    // 不再误报"没有更多试卷"而被渲染层提前结束批改。
    expect(hasNext).toBe('ok')
    await page.close()
  })
})
