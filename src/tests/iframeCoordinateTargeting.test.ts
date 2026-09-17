/**
 * 坐标点击/输入的 iframe 下钻 回归守卫测试
 *
 * 背景（bug）：线上报「写入分数失败: 分数未写入输入框：焦点不在输入框上
 * （当前焦点元素：iframe）」。
 *
 * 根因：智学网等批改平台的给分区**嵌在 iframe 里**。`page.mouse.click(x, y)` 只对
 * **主框架视口**派发事件，点在 iframe 区域时命中的是 `<iframe>` 外壳本身：
 *   1. 输入框拿不到焦点 → `keyboard.type()` 打给了空气；
 *   2. `readFocusedElement` 从主框架读 `document.activeElement` → 读回来是 `iframe`
 *      → 落值校验报"焦点不在输入框上"，掩盖了"根本没点到输入框"这个真实原因。
 *
 * 修复要点（本测试钉死）：
 *   a. 命中测试必须能逐层下钻 iframe（elementFromPoint → contentFrame）；
 *   b. 下钻后必须用**元素句柄**点击，而不是主框架鼠标坐标；
 *   c. 落值校验必须从**实际接收输入的那个框架**读回焦点元素。
 *
 * 断言前剥离注释，防止"把实现注释掉"骗过断言。
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

const source = read('electron/services/BrowserService.ts')

describe('坐标定位必须能下钻 iframe', () => {
  it('resolveElementAtDocumentPoint 用 elementFromPoint 命中测试并支持 contentFrame 下钻', () => {
    const body = slice(
      source,
      'private async resolveElementAtDocumentPoint',
      'private async clickResolvedHandle'
    )
    expect(body).toContain('document.elementFromPoint')
    expect(body).toContain('contentFrame()')
    expect(body).toContain('boundingBox()')
  })

  it('下钻层数有上限，防止嵌套 iframe 死循环', () => {
    expect(source).toContain('MAX_IFRAME_DEPTH')
    const body = slice(
      source,
      'private async resolveElementAtDocumentPoint',
      'private async clickResolvedHandle'
    )
    expect(body).toContain('depth < BrowserService.MAX_IFRAME_DEPTH')
  })
})

describe('点击与输入在 iframe 内必须走元素句柄', () => {
  it('clickAt 命中 iframe 时不再用主框架鼠标坐标，改走元素句柄点击', () => {
    const body = slice(source, 'async clickAt(', 'async typeAt(')
    expect(body).toContain('target.iframeDepth')
    expect(body).toContain('clickResolvedHandle(target.handle)')
  })

  it('typeAt 命中 iframe 时改走元素句柄点击', () => {
    const body = slice(source, 'async typeAt(', 'async submitScore(')
    expect(body).toContain('target.iframeDepth')
    expect(body).toContain('clickResolvedHandle(target.handle)')
  })

  it('落值校验从实际接收输入的框架读回焦点元素（这是"焦点元素=iframe"误报的根因）', () => {
    const body = slice(source, 'async typeAt(', 'async submitScore(')
    expect(body).toContain('readFocusedElement(page, target.frame)')
  })

  it('readFocusedElement 接受可选的 frame 参数', () => {
    const body = slice(source, 'private async readFocusedElement', 'async clickAt(')
    expect(body).toContain('frame?: any')
    expect(body).toContain('(frame || page).evaluate')
  })
})
