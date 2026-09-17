/**
 * 坐标换算与「输入落值校验」的**纯逻辑**（不依赖 Electron / Playwright，便于单测）。
 *
 * ===========================================================================
 * 为什么需要这个模块（2026-09-17 修复「分数没填进智学网输入框」）
 * ===========================================================================
 * 选区截图走的是 `page.screenshot({ fullPage: true })`，它截的是**整个可滚动文档**，
 * 因此用户在选区里框出来的 `scoreInput` / `submitButton` 坐标是**文档坐标**
 * （`CoordinateGradingPage.tsx` 用 `imageNaturalSize.width / rect.width` 从截图原图像素换算）。
 *
 * 而 Playwright 的 `page.mouse.click(x, y)` / `keyboard` 系操作接受的是
 * **相对浏览器视口**的 CSS 像素坐标。
 *
 * 两者不换算时，只要目标的文档 y 超过「当前滚动位置 + 视口高度」，点击就会被派发到
 * 视口之外：**Chromium 既不执行点击、也不抛错**。于是 `clickAt` 看上去成功，
 * 紧接着 `keyboard.type()` 把分数打进了当时仍有焦点的元素（或什么都没打到）——
 * 表现为「分数没填进输入框，但程序一路认为成功」的静默失败。
 *
 * 分工：
 *   - `BrowserService.resolveViewportPoint()` 负责在页面内完成「滚动 + 读回视口坐标」
 *     （需要真实 DOM，无法在无 GUI 环境单测）；
 *   - 本模块负责其中可纯函数化的部分：换算、越界判定、失败文案、落值校验。
 */

/** 判定「是否在视口内」时允许的像素容差（含小数坐标与亚像素渲染误差） */
export const VIEWPORT_TOLERANCE_PX = 1

/** 滚动时给目标留的边缘余量：把目标滚到视口内时，尽量别贴着视口边缘 */
export const VIEWPORT_EDGE_MARGIN = 32

export interface ViewportPoint {
  x: number
  y: number
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * 计算「把文档坐标 docY 滚动进视口」所需的目标滚动位置（纯函数）。
 *
 * 语义：尽量把目标放到视口垂直中点，并夹在 `[0, maxScrollTop]` 内。
 * `maxScrollTop = max(0, scrollHeight - viewportHeight)`。
 *
 * 若页面根本不可滚动（`scrollHeight <= viewportHeight`），返回 0 —— 此时
 * 目标仍在视口外，调用方的 `isPointInsideViewport` 会判为失败（**明确失败而非瞎点**）。
 *
 * 抽成纯函数是为了让「首屏下方 → 先滚动再得到正确视口坐标」这条关键行为
 * 可以在无 GUI 环境被单测覆盖。
 */
export function computeScrollTarget(
  docY: number,
  viewportHeight: number,
  scrollHeight: number,
  currentScrollY: number = 0
): number {
  const maxScrollTop =
    isFiniteNumber(scrollHeight) && isFiniteNumber(viewportHeight)
      ? Math.max(0, scrollHeight - viewportHeight)
      : 0

  if (!isFiniteNumber(docY) || !isFiniteNumber(viewportHeight) || viewportHeight <= 0) {
    // 度量不可信时保持当前位置，不做无依据的滚动
    const fallback = isFiniteNumber(currentScrollY) ? currentScrollY : 0
    return Math.min(Math.max(fallback, 0), maxScrollTop)
  }

  const centered = docY - viewportHeight / 2
  // 必须夹取到 [0, maxScrollTop]：
  //  - 不夹下界 → 目标在首屏内时会返回负数（把页面往上滚，浏览器虽会兜底但语义错误）；
  //  - 不夹上界 → 目标在文档底部时要求滚过文档末尾；
  //  - 页面不可滚动时 maxScrollTop=0，正好保持"不滚动"，交给
  //    isPointInsideViewport 明确判失败，而不是假装成功。
  return Math.min(Math.max(centered, 0), maxScrollTop)
}

/**
 * 文档坐标 → 视口坐标（纯换算，不做越界判定）。
 * 滚动位置为 0 时两者相等 —— 这正是「页面没有滚动」时的正确回归行为。
 */
export function documentToViewport(
  docX: number,
  docY: number,
  scrollX: number,
  scrollY: number
): ViewportPoint {
  return { x: docX - scrollX, y: docY - scrollY }
}

/**
 * 判定换算后的点是否真的落在视口内。
 *
 * 这是「静默点到视口外」的最后一道拦截：越界必须被判为失败，
 * 绝不能让调用方以为点击/输入成功了。
 */
export function isPointInsideViewport(
  point: ViewportPoint | null | undefined,
  viewportWidth: number,
  viewportHeight: number,
  tolerance: number = VIEWPORT_TOLERANCE_PX
): boolean {
  if (!point || !isFiniteNumber(point.x) || !isFiniteNumber(point.y)) return false
  if (!isFiniteNumber(viewportWidth) || !isFiniteNumber(viewportHeight)) return false
  if (viewportWidth <= 0 || viewportHeight <= 0) return false

  return (
    point.x >= -tolerance &&
    point.y >= -tolerance &&
    point.x <= viewportWidth + tolerance &&
    point.y <= viewportHeight + tolerance
  )
}

export interface OutOfViewportContext {
  docX: number
  docY: number
  point: ViewportPoint
  scrollX: number
  scrollY: number
  viewportWidth: number
  viewportHeight: number
}

/**
 * 生成越界失败的**可诊断**文案。
 * 带上文档坐标 / 滚动位置 / 视口尺寸 / 换算结果，让用户和开发者都能一眼看出问题。
 */
export function formatOutOfViewportReason(ctx: OutOfViewportContext): string {
  const { docX, docY, point, scrollX, scrollY, viewportWidth, viewportHeight } = ctx
  const roundedX = Math.round(point.x)
  const roundedY = Math.round(point.y)
  return (
    `目标坐标不在可视区域内，已放弃操作以免误点：` +
    `文档坐标(${docX}, ${docY})、滚动(${Math.round(scrollX)}, ${Math.round(scrollY)})、` +
    `视口(${Math.round(viewportWidth)}×${Math.round(viewportHeight)}) → 视口坐标(${roundedX}, ${roundedY})。` +
    `通常是页面布局变了或坐标配置过期，请在「坐标配置」里重新框选后重试`
  )
}

// ============================================================================
// 输入落值校验
// ============================================================================

/** 页面内读回的「当前焦点元素」快照 */
export interface FocusedElementSnapshot {
  tagName: string
  /** input / textarea 取 value；contenteditable 取 textContent；其它为 null */
  value: string | null
  isContentEditable: boolean
  readOnly: boolean
  isDisabled: boolean
}

export type VerifyTypedValueResult = { ok: true } | { ok: false; reason: string }

function squash(value: unknown): string {
  return String(value ?? '')
    .replace(/\s+/g, '')
    .trim()
}

/**
 * 校验「刚输入的文本」是否真的落进了目标输入框。
 *
 * 为什么必须有这一步：点击落在视口外、或点击命中了非输入元素时，
 * `keyboard.type()` 不会抛错，只是把字符打到了别处或什么都没打到。
 * 没有回读校验，应用就会**谎报成功**（本次线上问题的根因之一）。
 */
export function verifyTypedValue(
  snapshot: FocusedElementSnapshot | null | undefined,
  expected: string
): VerifyTypedValueResult {
  if (!snapshot) {
    return { ok: false, reason: '无法读取页面焦点元素（页面可能已关闭或已被导航）' }
  }
  if (snapshot.isDisabled) {
    return { ok: false, reason: '焦点元素处于禁用状态，输入不会生效' }
  }
  if (snapshot.readOnly) {
    return { ok: false, reason: '焦点元素是只读的，输入不会生效' }
  }

  const wantRaw = String(expected ?? '')
  if (!wantRaw.trim()) {
    return { ok: false, reason: '期望输入的内容为空，已跳过校验' }
  }

  const tag = String(snapshot.tagName || '').toLowerCase()
  const gotRaw = String(snapshot.value ?? '')

  // 允许两种匹配：完全一致，或忽略空白差异（部分分数框会自动去空格 / 加分隔符）
  const matches = gotRaw === wantRaw || squash(gotRaw) === squash(wantRaw)
  if (matches) return { ok: true }

  if (tag === 'input' || tag === 'textarea') {
    return {
      ok: false,
      reason:
        `输入框当前值是「${gotRaw}」，期望「${wantRaw}」` +
        `（可能没点中输入框、或页面拒绝/改写了该值）`,
    }
  }

  if (snapshot.isContentEditable) {
    return {
      ok: false,
      reason: `可编辑区域当前内容是「${gotRaw}」，期望「${wantRaw}」`,
    }
  }

  return {
    ok: false,
    reason:
      `焦点不在输入框上（当前焦点元素：${tag || '未知'}），` +
      `分数没有被打进任何输入框，请在「坐标配置」里重新框选分数输入框`,
  }
}
