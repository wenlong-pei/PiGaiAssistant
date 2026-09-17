// 诊断：真实调用链上的选择器获取与提交
import { describe, it, beforeAll, vi } from 'vitest'
import * as path from 'path'
import * as fs from 'fs'
import { ConfigService } from '../../electron/services/ConfigService'
import { ZhixueAdapter } from '../../electron/adapters/ZhixueAdapter'
import { chromium, Browser, Page } from 'playwright'

let browser: Browser
let page: Page

beforeAll(async () => {
  const userData = path.join(process.env.TEMP || '.', 'qa-exec-userdata')
  fs.mkdirSync(userData, { recursive: true })
  fs.copyFileSync(path.resolve(__dirname, '../../config/selectors.json'), path.join(userData, 'selectors.json'))
  try {
    browser = await chromium.launch({ headless: true })
  } catch {
    browser = await chromium.launch({ headless: true, executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe' })
  }
  page = await browser.newPage()
  await page.goto('file://' + path.resolve(__dirname, 'mock-zhixue.html'))
  await page.waitForFunction(() => (window as any).__g)
})

describe('diag2', () => {
  it('print real selector values and submit path errors', async () => {
    const logger: any = { info: (...a: any[]) => console.log('[logger.info]', ...a), error: (...a: any[]) => console.log('[logger.error]', ...a), warn: (...a: any[]) => console.log('[logger.warn]', ...a), debug: vi.fn() }
    const cs = new ConfigService(logger)
    console.log('ANSWER_IMG:', JSON.stringify(cs.getAnswerImageSelectors()))
    console.log('SCORE_INPUT:', JSON.stringify(cs.getZhixueScoreInputSelectors()))
    try {
      console.log('SUBMIT:', JSON.stringify(cs.getZhixueSubmitButtonSelectors()))
    } catch (e: any) {
      console.log('SUBMIT THROWS:', e.constructor.name, e.message)
    }
    try {
      console.log('NEXT:', JSON.stringify(cs.getZhixueNextButtonSelectors()))
    } catch (e: any) {
      console.log('NEXT THROWS:', e.constructor.name, e.message)
    }
    const adapter = new ZhixueAdapter(logger, cs)
    const img = await adapter.captureAnswerImage(page)
    console.log('CAPTURE RESULT:', img ? img.slice(0, 40) : 'null')
    const ok = await adapter.submitScore(page, 8)
    console.log('SUBMIT RESULT:', ok)
    const s = await page.evaluate(() => (window as any).__g)
    console.log('PAGE STATE:', JSON.stringify(s))
    await browser.close()
  })
})
