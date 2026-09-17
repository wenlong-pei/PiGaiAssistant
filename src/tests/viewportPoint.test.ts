/**
 * 坐标系静默失效（P0）纯函数回归测试
 * ===========================================================================
 * 现象（用户报告）：自动在智学网批改时，**分数没有填进输入框**，但程序一路认为成功。
 *
 * 根因：选区截图走 `page.screenshot({ fullPage: true })`（整个可滚动文档），
 * 所以配置里的 `scoreInput` / `submitButton` 是**文档坐标**；而 Playwright 的
 * `page.mouse.click(x, y)` 接受的是**相对浏览器视口**的 CSS 像素。
 * 两者不换算时，只要文档 y 超过「滚动位置 + 视口高度」，点击就被派发到视口之外：
 * Chromium 既不执行也不抛错 → 旧实现返回 `true` → 后续 `keyboard.type()` 打到了
 * 别处或什么都没打到 → 分数没进输入框却"报成功"。
 *
 * 本文件把坐标换算与落值校验的**纯逻辑**钉死（无 GUI 也能跑）：
 *   1. 首屏内 → 视口坐标 == 文档坐标（回归保护）；
 *   2. 首屏下方 → 先滚动再得到正确视口坐标；
 *   3. 超出可滚动范围 → **明确失败**而非瞎点；
 *   4. 输入回读不一致 / 焦点不在输入框 → 返回失败。
 *
 * 说明：`与真实 DOM 交互`的部分（探针 scrollIntoView、真实 mouse.click）无法在
 * 本环境实测（需要 GUI + 智学网真实页面），属于**读代码确认**；
 * 本文件覆盖的是其中可纯函数化的部分。
 */
import { describe, it, expect } from 'vitest'
import {
  documentToViewport,
  isPointInsideViewport,
  computeScrollTarget,
  formatOutOfViewportReason,
  verifyTypedValue,
  VIEWPORT_TOLERANCE_PX,
  type FocusedElementSnapshot,
} from '../../electron/utils/viewportPoint'

const VIEWPORT_W = 1200
const VIEWPORT_H = 800

function snapshot(partial: Partial<FocusedElementSnapshot>): FocusedElementSnapshot {
  return {
    tagName: 'input',
    value: '',
    isContentEditable: false,
    readOnly: false,
    isDisabled: false,
    ...partial,
  }
}

describe('documentToViewport：文档坐标 → 视口坐标', () => {
  it('页面未滚动时：视口坐标 == 文档坐标（回归保护：首屏内的框选必须原样命中）', () => {
    expect(documentToViewport(120, 340, 0, 0)).toEqual({ x: 120, y: 340 })
  })

  it('页面已滚动时：减去滚动偏移', () => {
    expect(documentToViewport(120, 1000, 0, 600)).toEqual({ x: 120, y: 400 })
  })
})

describe('isPointInsideViewport：越界必须判失败（最后一道拦截）', () => {
  it('视口内 → true', () => {
    expect(isPointInsideViewport({ x: 100, y: 200 }, VIEWPORT_W, VIEWPORT_H)).toBe(true)
  })

  it('刚好贴在边界上（含容差）→ true', () => {
    expect(
      isPointInsideViewport({ x: VIEWPORT_W + VIEWPORT_TOLERANCE_PX, y: VIEWPORT_H }, VIEWPORT_W, VIEWPORT_H)
    ).toBe(true)
  })

  it('文档 y 超出视口高度 → false（这正是"点到视口外、Chromium 不报错"的场景）', () => {
    expect(isPointInsideViewport({ x: 100, y: 3000 }, VIEWPORT_W, VIEWPORT_H)).toBe(false)
  })

  it('负数 / NaN / 视口尺寸非法 → false（绝不放过任何可疑点）', () => {
    expect(isPointInsideViewport({ x: -50, y: 100 }, VIEWPORT_W, VIEWPORT_H)).toBe(false)
    expect(isPointInsideViewport({ x: NaN, y: 100 }, VIEWPORT_W, VIEWPORT_H)).toBe(false)
    expect(isPointInsideViewport({ x: 100, y: 100 }, 0, 0)).toBe(false)
    expect(isPointInsideViewport(null, VIEWPORT_W, VIEWPORT_H)).toBe(false)
  })
})

describe('首屏下方：先滚动，再得到正确视口坐标', () => {
  it('目标在首屏下方 → 滚动到视口中点后，视口坐标落在视口内', () => {
    const docY = 2000
    const scrollHeight = 5000

    const target = computeScrollTarget(docY, VIEWPORT_H, scrollHeight)
    // 居中放置：2000 - 800/2 = 1600
    expect(target).toBe(1600)

    const point = documentToViewport(100, docY, 0, target)
    expect(point.y).toBe(400)
    expect(isPointInsideViewport(point, VIEWPORT_W, VIEWPORT_H)).toBe(true)
  })

  it('目标靠近文档底部 → 滚动量被夹在 maxScrollTop，仍然可见', () => {
    // maxScrollTop = 5000 - 800 = 4200；居中期望 4500 → 夹到 4200
    const target = computeScrollTarget(4900, VIEWPORT_H, 5000)
    expect(target).toBe(4200)

    const point = documentToViewport(100, 4900, 0, target)
    expect(point.y).toBe(700)
    expect(isPointInsideViewport(point, VIEWPORT_W, VIEWPORT_H)).toBe(true)
  })

  it('目标就在首屏内 → 不产生多余的向上滚动（滚动量为 0）', () => {
    expect(computeScrollTarget(300, VIEWPORT_H, 5000)).toBe(0)
  })

  it('页面不可滚动而目标在视口外 → 滚动量为 0，仍然判失败（明确失败而非瞎点）', () => {
    const docY = 2000
    const scrollHeight = VIEWPORT_H // 与视口等高：不可滚动

    const target = computeScrollTarget(docY, VIEWPORT_H, scrollHeight)
    expect(target).toBe(0)

    const point = documentToViewport(100, docY, 0, target)
    expect(isPointInsideViewport(point, VIEWPORT_W, VIEWPORT_H)).toBe(false)
  })
})

describe('formatOutOfViewportReason：越界失败必须可诊断', () => {
  it('带上文档坐标 / 滚动位置 / 视口尺寸 / 换算结果，并给出可行动建议', () => {
    const reason = formatOutOfViewportReason({
      docX: 900,
      docY: 3000,
      point: { x: 900, y: 2200 },
      scrollX: 0,
      scrollY: 800,
      viewportWidth: VIEWPORT_W,
      viewportHeight: VIEWPORT_H,
    })

    expect(reason).toContain('不在可视区域')
    expect(reason).toContain('文档坐标(900, 3000)')
    expect(reason).toContain(`视口(${VIEWPORT_W}×${VIEWPORT_H})`)
    expect(reason).toContain('视口坐标(900, 2200)')
    expect(reason).toContain('重新框选')
  })
})

describe('verifyTypedValue：输入落值校验（反"没输进去却报成功"）', () => {
  it('回读值与期望完全一致 → 通过', () => {
    expect(verifyTypedValue(snapshot({ value: '7' }), '7')).toEqual({ ok: true })
  })

  it('仅空白差异 → 通过（部分分数框会自动去空格）', () => {
    expect(verifyTypedValue(snapshot({ value: ' 7 ' }), '7')).toEqual({ ok: true })
  })

  it('回读不一致（"08" vs "8"）→ 失败（旧实现会静默当成成功，把 8 分错发成 08）', () => {
    const result = verifyTypedValue(snapshot({ value: '08' }), '8')
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toContain('08')
  })

  it('焦点根本不在输入框上（点击没点中）→ 失败，并明确指出原因', () => {
    const result = verifyTypedValue(snapshot({ tagName: 'body', value: null }), '8')
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toContain('焦点不在输入框上')
  })

  it('焦点元素只读 / 禁用 → 失败（输入不会生效）', () => {
    expect(verifyTypedValue(snapshot({ value: '8', readOnly: true }), '8').ok).toBe(false)
    expect(verifyTypedValue(snapshot({ value: '8', isDisabled: true }), '8').ok).toBe(false)
  })

  it('读不到焦点元素（页面已关闭 / 已导航）→ 失败', () => {
    expect(verifyTypedValue(null, '8').ok).toBe(false)
  })

  it('期望内容为空 → 失败（跳过校验等同于没有校验）', () => {
    expect(verifyTypedValue(snapshot({ value: '' }), '   ').ok).toBe(false)
  })

  it('contenteditable 区域回读 textContent 一致 → 通过', () => {
    expect(
      verifyTypedValue(snapshot({ tagName: 'div', value: '8', isContentEditable: true }), '8')
    ).toEqual({ ok: true })
  })
})
