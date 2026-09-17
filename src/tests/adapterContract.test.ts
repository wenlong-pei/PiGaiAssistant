import { describe, it, expect, vi } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: any) => b.toString(),
  },
  app: { getPath: () => '/tmp', isPackaged: false, whenReady: async () => {} },
}))

import { BaseAdapter } from '../../electron/adapters/BaseAdapter'
import { ZhixueAdapter } from '../../electron/adapters/ZhixueAdapter'

const fakeLogger: any = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
}

/** 用于验证 fillInput 的最小适配器实现 */
class ProbeAdapter extends BaseAdapter {
  readonly platformName = 'probe'
  async analyzePage() {
    return { found: false } as any
  }
  async captureAnswerImage() {
    return null
  }
  async submitScore() {
    return true
  }
  async goToNext() {
    return true
  }
  async validatePage() {
    return true
  }
  // 暴露 protected 方法供测试调用
  async callFillInput(page: any, selectors: string[], text: string) {
    return this.fillInput(page, selectors, text)
  }
}

function makePage() {
  const calls: any[][] = []
  const page: any = {
    evaluate: vi.fn(async (...args: any[]) => {
      calls.push(args)
      return true
    }),
    waitForTimeout: vi.fn(async () => {}),
    keyboard: { press: vi.fn(async () => {}) },
    mouse: { click: vi.fn(async () => {}) },
  }
  return { page, calls }
}

describe('Electron 适配器契约回归（BUG-EXE-001/002）', () => {
  it('BaseAdapter.fillInput 只向 page.evaluate 传一个业务参数', async () => {
    const adapter = new ProbeAdapter(fakeLogger, {} as any)
    const { page, calls } = makePage()

    await adapter.callFillInput(page, ['#a', '#b'], '8')

    expect(calls.length).toBe(1)
    // evaluate(pageFunction, arg) 的实参固定为 2 个：函数 + 唯一业务参数
    // 原 BUG 为 evaluate(fn, a, b) → 3 个实参，Playwright 抛 Too many arguments
    expect(calls[0].length).toBe(2)
    expect(calls[0][1]).toEqual({ selectorList: ['#a', '#b'], value: '8' })
  })

  it('ZhixueAdapter.submitScore 只向 page.evaluate 传一个业务参数', async () => {
    const configService: any = {
      getPlatformDisplayName: () => '智学网',
      getZhixueScoreInputSelectors: () => ({
        SCORE_INPUT: 'input[type="number"]',
        SCORE_INPUT_NEW: 'input.topictxt_input',
        SCORE_INPUT_ALL_NEW: '#txt_marking_all',
        SCORE_INPUT_PLACEHOLDER: 'input[placeholder*="分"]',
      }),
      getZhixueSubmitButtonSelectors: () => ({
        SUBMIT_BUTTON: '#bnt_save',
        SUBMIT_BUTTON_NEW: '#bnt_save',
        SUBMIT_BUTTON_TEXT: '提交分数',
      }),
    }
    const adapter = new ZhixueAdapter(fakeLogger, configService)
    const { page, calls } = makePage()

    await adapter.submitScore(page, 8)

    expect(calls.length).toBeGreaterThanOrEqual(1)
    for (const call of calls) {
      // 函数 + 唯一业务参数 = 2 个实参
      expect(call.length).toBe(2)
    }
    expect(calls[0][1]).toEqual({
      scoreValue: 8,
      s: expect.objectContaining({ SCORE_INPUT_ALL_NEW: '#txt_marking_all' }),
    })
  })

  // 源码级守卫：防止将来再写出多参数 evaluate（Playwright 会直接抛错）
  it('electron 源码中不存在多参数的 .evaluate( 调用', () => {
    const root = path.resolve(__dirname, '../../electron')
    const files: string[] = []
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (entry.name.endsWith('.ts')) files.push(full)
      }
    }
    walk(root)

    const offenders: string[] = []
    for (const file of files) {
      const src = fs.readFileSync(file, 'utf-8')
      const re = /\.evaluate\(/g
      let m: RegExpExecArray | null
      while ((m = re.exec(src))) {
        let i = m.index + m[0].length
        let depth = 1
        while (i < src.length && depth > 0) {
          const ch = src[i]
          if (ch === '(') depth++
          else if (ch === ')') depth--
          i++
        }
        const call = src.slice(m.index, i)
        let inner = 0
        let d = 0
        for (const ch of call.slice(call.indexOf('(') + 1)) {
          if ('([{'.includes(ch)) d++
          else if (')]}'.includes(ch)) d--
          else if (ch === ',' && d === 0) inner++
        }
        if (inner > 1) {
          const line = src.slice(0, m.index).split('\n').length
          offenders.push(`${path.relative(root, file)}:${line}`)
        }
      }
    }

    expect(offenders).toEqual([])
  })
})
