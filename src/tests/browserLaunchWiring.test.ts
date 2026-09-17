/**
 * 浏览器启动（Playwright 加载）回归守卫测试
 *
 * 背景（bug）：打包版点「启动浏览器」必失败，开发环境却一切正常。
 * 根因：`ensureChromium()` 用的是 `await import('playwright')`。打包后主进程代码
 * 位于 `app.asar` 内，而 Electron 的 asar 支持是**给 Node 的 CommonJS 加载器打补丁**
 * 实现的——ESM 加载器不认这套虚拟目录，于是 `import('playwright')` 解析不到
 * `app.asar.unpacked/node_modules/playwright`，抛 ERR_MODULE_NOT_FOUND。
 * 开发环境没有 asar，所以这个缺陷只在线上出现，极易漏测。
 *
 * 本测试用源码级断言钉死两点：
 *   1. 主路径必须是 CJS require（走 Electron 打过补丁的解析器）；
 *   2. 失败时必须把底层异常带出去（旧实现只抛一句无信息量的"请重新安装依赖"）。
 *
 * 断言前先剥离注释（沿用 updateWiring.test.ts 的写法），否则"把实现注释掉"仍能骗过断言。
 */

import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

const ROOT = process.cwd()

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function read(relativePath: string): string {
  return stripComments(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'))
}

function slice(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker)
  expect(start, `未找到起点：${startMarker}`).toBeGreaterThan(-1)
  const end = source.indexOf(endMarker, start + startMarker.length)
  expect(end, `未找到终点：${endMarker}`).toBeGreaterThan(start)
  return source.slice(start, end)
}

describe('Playwright 加载必须走 CJS require（asar 兼容）', () => {
  const source = read('electron/services/BrowserService.ts')

  it('loadChromiumSync 用 createRequire(__filename) 走 CJS 解析', () => {
    const body = slice(source, 'function loadChromiumSync()', 'async function ensureChromium')
    expect(body).toContain('createRequire(__filename)')
    expect(body).toContain("req('playwright')")
  })

  it('ensureChromium 的主路径是 CJS，ESM 动态导入只作兜底', () => {
    const body = slice(source, 'async function ensureChromium()', 'function describeLaunchError')
    const cjsPos = body.indexOf('loadChromiumSync()')
    const esmPos = body.indexOf("import('playwright')")
    expect(cjsPos, '主路径必须存在 CJS 加载').toBeGreaterThan(-1)
    // ESM 兜底允许存在，但必须排在 CJS 之后
    if (esmPos > -1) {
      expect(cjsPos).toBeLessThan(esmPos)
    }
  })

  it('加载失败时把 CJS/ESM 两侧的原始错误都带出去（不得只留一句万能提示）', () => {
    const body = slice(source, 'async function ensureChromium()', 'function describeLaunchError')
    expect(body).toContain('CJS:')
    expect(body).toContain('ESM:')
  })
})

describe('启动失败提示必须可诊断', () => {
  const source = read('electron/services/BrowserService.ts')

  it('launch 的失败出口使用 describeLaunchError，而不是裸异常拼接', () => {
    const body = slice(source, 'async launch(headless: boolean = false)', 'async connect()')
    expect(body).toContain('describeLaunchError(error)')
    expect(body).not.toContain('error: `启动浏览器失败')
  })

  it('describeLaunchError 对 Playwright 依赖缺失给出可操作的指引', () => {
    const body = slice(source, 'function describeLaunchError', 'export class BrowserService')
    expect(body).toContain('Playwright 模块加载失败')
    expect(body).toContain('npx playwright install chromium')
  })
})
