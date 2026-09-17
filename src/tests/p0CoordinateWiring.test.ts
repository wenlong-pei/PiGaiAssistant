/**
 * P0「分数没填进智学网输入框」修复的接线契约（源码级）
 * ===========================================================================
 * 纯函数单测（viewportPoint.test.ts）只能证明「换算逻辑正确」，
 * 不能证明「它真的被接上了」。本文件用源码级断言防止以下回归：
 *
 *   1. 主进程真的把「文档坐标 → 视口坐标」接在 clickAt/typeAt 上；
 *   2. 主进程真的在输入前清空、输入后回读校验；
 *   3. 渲染层真的把 clickResult1 / typeResult 纳入**显式白名单**（`=== true`），
 *      失败即暂停 —— 绝不带着"分数没写进去"的状态去提交并记 completed；
 *   4. 空白卷分支的 clickAt / typeAt 返回值同样被检查；
 *   5. 红线（平台确认 / needsHumanReview / evaluationMode='ai'）没被放宽。
 *
 * 说明：真实「在智学网页面上点中分数框」需要在 GUI + 真实站点下人工验证，
 * 本环境无法实测，属于**读代码确认**；这里把它们固化成可自动回归的源码契约。
 */
import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

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

const page = read('src/pages/CoordinateGradingPage.tsx')
const browser = read('electron/services/BrowserService.ts')
const pure = read('electron/utils/viewportPoint.ts')

describe('主进程：clickAt / typeAt 必须做「滚动 + 换算 + 清空 + 回读校验」', () => {
  it('坐标换算纯函数真的被 BrowserService 引用（不是写了没接）', () => {
    expect(browser).toContain('resolveViewportPoint')
    expect(browser).toContain('computeScrollTarget')
    expect(browser).toContain('documentToViewport')
    expect(browser).toContain('isPointInsideViewport')
    expect(browser).toContain('verifyTypedValue')
  })

  it('换算实现里必须真的滚动（scrollIntoView 覆盖 window 与内层可滚动祖先）', () => {
    expect(browser).toContain('scrollIntoView')
    // 探针不可用时退化为显式滚动 window
    expect(browser).toContain('window.scrollTo')
  })

  it('越界必须判失败并给出可诊断原因，而不是照点不误', () => {
    // 接线点
    expect(browser).toContain('formatOutOfViewportReason')
    // 文案本体（在纯函数模块里，已由 viewportPoint.test.ts 单测覆盖）
    expect(pure).toContain('目标坐标不在可视区域内')
    expect(pure).toContain('已放弃操作以免误点')
  })

  it('输入前先清空（否则与残留值拼成 "08"）', () => {
    expect(browser).toContain("page.keyboard.press('Control+A')")
    expect(browser).toContain("page.keyboard.press('Backspace')")
  })

  it('输入后必须回读焦点元素校验，失败返回 { error } 而不是 true', () => {
    expect(browser).toContain('readFocusedElement')
    expect(browser).toContain('verifyTypedValue(snapshot, text)')
    expect(browser).toContain('分数未写入输入框')
  })

  it('失败契约是 { error }（调用方必须显式处理），不再是静默的 false', () => {
    expect(browser).toContain('CoordinateActionResult')
    expect(browser).toContain('export type CoordinateActionResult = true | { error: string }')
  })

  it('纯函数模块导出了被引用的那几个（防止改名后悄悄失效）', () => {
    for (const name of [
      'export function documentToViewport',
      'export function isPointInsideViewport',
      'export function computeScrollTarget',
      'export function formatOutOfViewportReason',
      'export function verifyTypedValue',
    ]) {
      expect(pure, name).toContain(name)
    }
  })
})

describe('渲染层：点击/输入结果必须是显式白名单（=== true 才算成功）', () => {
  it('分数框点击失败（含返回 false）必须判失败 —— 这是 P0 的根因点', () => {
    const start = page.indexOf('const clickResult1 = await gradingBotProxy.clickAt(')
    expect(start, '未找到 clickResult1 调用点').toBeGreaterThan(-1)
    const region = page.slice(start, start + 1400)

    expect(region).toContain('clickResult1 !== true')
    expect(region).toContain('noteLoopFailure(reason)')
    expect(region).toContain('setIsPaused(true)')
    expect(region).toContain('describeCoordinateActionFailure(clickResult1)')
    // 旧的黑名单写法（只查 { error }）必须消失
    expect(region.includes("typeof clickResult1 === 'object'")).toBe(false)
  })

  it('分数输入失败（含返回 false / 回读不一致）必须判失败并暂停，绝不进入提交', () => {
    const start = page.indexOf('const typeResult = await gradingBotProxy.typeAt(')
    expect(start, '未找到 typeResult 调用点').toBeGreaterThan(-1)
    const region = page.slice(start, start + 1500)

    expect(region).toContain('typeResult !== true')
    expect(region).toContain('noteLoopFailure(reason)')
    expect(region).toContain('setIsPaused(true)')
    expect(region).toContain('describeCoordinateActionFailure(typeResult)')
    expect(region.includes("typeof typeResult === 'object'")).toBe(false)

    // 提交按钮的点击必须在输入校验**之后**（失败已 continue，不会走到提交）
    const submitAt = page.indexOf('const clickResult2 = await gradingBotProxy.clickAt(')
    expect(submitAt).toBeGreaterThan(start)
  })

  it('空白卷分支的 clickAt / typeAt 返回值也必须被检查', () => {
    const start = page.indexOf('const blankClickAck = await gradingBotProxy.clickAt(')
    expect(start, '空白卷分数框点击未被检查').toBeGreaterThan(-1)
    const region = page.slice(start, start + 2800)

    expect(region).toContain('blankClickAck !== true')
    expect(region).toContain('const blankTypeAck = await gradingBotProxy.typeAt(')
    expect(region).toContain('blankTypeAck !== true')
    // 空白卷同样要能停下来等人工
    expect(region).toContain('setIsPaused(true)')
  })

  it('失败文案统一走 describeCoordinateActionFailure（false / {error} / undefined 都被覆盖）', () => {
    expect(page).toContain('const describeCoordinateActionFailure = (res: unknown): string =>')
    expect(page).toContain("res === false")
  })
})

describe('红线：这次改动不得放宽既有语义', () => {
  it('平台确认 / needsHumanReview / AI 判分语义保持不变', () => {
    expect(page).toContain('isSubmitAcknowledged(clickResult2)')
    expect(page).toContain('isSubmitAcknowledged(blankSubmitAck)')
    expect(page).toContain('gradeResult.needsHumanReview === true')
    expect(page).toContain('const requiresHumanReview =')
    expect(page).toContain("evaluationMode: 'ai'")
  })

  it('非关键副作用仍走 runSideEffect（失败不得打断批改循环）', () => {
    expect(page).toContain("runSideEffect('保存批改记录'")
    expect(page).toContain("runSideEffect('保存批改进度'")
    expect(page).toContain("runSideEffect('播放提示音'")
  })

  it('坐标截图链路未被改动（captureFullPage 仍用 fullPage:true）', () => {
    expect(browser).toContain('fullPage: true')
    expect(browser).toContain('async captureFullPage(')
    expect(browser).toContain('async captureCoordinate(')
  })
})
