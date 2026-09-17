/**
 * 「测试连接」思考参数 + 共享实现 回归守卫测试
 *
 * 背景（bug）：设置页点「测试连接」报"模型只返回了思维链、正文为空：通常是 max_tokens
 * 被思考模式耗尽，请调大 max_tokens 或关闭思考模式"——但用户早已在界面上关掉了思考模式。
 * 根因是「测试连接」这条路径：
 *   1. 只给 max_tokens=10；
 *   2. 从不把 thinking 参数透传给服务端（而 DeepSeek 服务端**默认开启思考模式**）。
 * 本测试用源码级断言把这两点钉死，并保证思考参数构造只有一份实现（避免再次漂移）。
 *
 * 注意：断言前先剥离注释（沿用 src/tests/updateWiring.test.ts 的 stripComments 写法），
 * 否则"把代码注释掉"依然能骗过文本断言——那正是本测试要防的场景。
 */

import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { buildThinkingParams, explainEmptyContent } from '../../electron/utils/thinkingParams'

const ROOT = process.cwd()

/** 去掉注释后再断言：避免"注释掉实现"骗过文本断言。保留 `://`（URL 双斜杠）。 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function read(relativePath: string): string {
  return stripComments(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'))
}

/** 截取 [startMarker, endMarker) 区段，把断言限定在目标函数/处理程序内，避免误伤文件其他部分 */
function slice(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker)
  expect(start, `未找到起点：${startMarker}`).toBeGreaterThan(-1)
  const end = source.indexOf(endMarker, start + startMarker.length)
  expect(end, `未找到终点：${endMarker}`).toBeGreaterThan(start)
  return source.slice(start, end)
}

describe('共享思考参数构造器（唯一实现）', () => {
  it('未配置 thinkingEnabled 时只补 stream:false，不发送 DeepSeek 专有参数（避免其他厂商 400）', () => {
    expect(buildThinkingParams()).toEqual({ stream: false })
    expect(buildThinkingParams({})).toEqual({ stream: false })
  })

  it('关闭思考时发送 thinking:{type:disabled}', () => {
    expect(buildThinkingParams({ thinkingEnabled: false })).toEqual({
      stream: false,
      thinking: { type: 'disabled' },
    })
  })

  it('开启思考时发送 thinking:{type:enabled}', () => {
    expect(buildThinkingParams({ thinkingEnabled: true })).toEqual({
      stream: false,
      thinking: { type: 'enabled' },
    })
  })

  it('reasoningEffort 原样透传', () => {
    expect(buildThinkingParams({ thinkingEnabled: true, reasoningEffort: 'max' })).toEqual({
      stream: false,
      thinking: { type: 'enabled' },
      reasoning_effort: 'max',
    })
  })
})

describe('正文为空的报错文案必须指向真实原因', () => {
  it('用户已关闭思考却仍收到思维链时，不再叫他"关闭思考模式"', () => {
    const msg = explainEmptyContent('让我先分析……', false)
    expect(msg).toContain('已关闭思考模式')
    expect(msg).toContain('服务端仍返回了思维链')
    // 关键：不能再让用户去执行"关闭思考模式"这个他早已做过的动作
    expect(msg).not.toContain('或关闭思考模式')
  })

  it('未配置/开启思考且返回思维链时，提示可能是思考耗尽', () => {
    expect(explainEmptyContent('思维链', undefined)).toContain('关闭思考模式')
    expect(explainEmptyContent('思维链', true)).toContain('max_tokens')
  })

  it('正文与思维链都为空时，提示检查模型名 / 调用格式', () => {
    expect(explainEmptyContent('', false)).toContain('模型返回内容为空')
  })
})

describe('bot:test-api 必须透传思考参数并使用够用的 max_tokens', () => {
  it('处理程序复用共享构造器（否则界面上关掉思考对测试路径无效）', () => {
    const ipc = read('electron/ipc.ts')
    expect(ipc).toMatch(/from\s+['"][^'"]*thinkingParams['"]/)
    const region = slice(ipc, "ipcMain.handle('bot:test-api'", "ipcMain.handle('bot:grade-image'")
    expect(region).toContain('buildThinkingParams')
    expect(region).toContain('thinkingEnabled')
  })

  it('处理程序不得再把 max_tokens 兜底成两位数级过小值', () => {
    const ipc = read('electron/ipc.ts')
    const region = slice(ipc, "ipcMain.handle('bot:test-api'", "ipcMain.handle('bot:grade-image'")
    expect(region).not.toMatch(/max_tokens:\s*maxTokens\s*\|\|\s*\d{1,2}\b/)
    expect(region).toMatch(/max_tokens:\s*maxTokens\s*\|\|\s*AI\.DEFAULT_MAX_TOKENS/)
  })
})

describe('设置页 / API 测试页两条测试路径都不得漂移', () => {
  it('设置页测试连接：透传 thinkingEnabled 且不再用 maxTokens:10', () => {
    const page = read('src/pages/SettingsPage.tsx')
    const region = slice(page, 'const handleTestConnection', 'const getModelHints')
    expect(region).toContain('thinkingEnabled: provider.thinkingEnabled')
    expect(region).not.toMatch(/maxTokens:\s*10\b/)
    expect(region).toMatch(/maxTokens:\s*settings\.maxTokens/)
  })

  it('API 测试页测试连接：同样透传 thinkingEnabled', () => {
    const page = read('src/pages/ApiTestPage.tsx')
    const region = slice(page, 'api.testApi(', 'const elapsed')
    expect(region).toContain('thinkingEnabled: activeProvider.thinkingEnabled')
  })
})

describe('思考参数构造只有一份实现（杜绝再次漂移）', () => {
  it('AIService 与 ipc 均从共享工具导入，且不再各自手写 thinking 参数', () => {
    for (const file of ['electron/services/AIService.ts', 'electron/ipc.ts']) {
      const src = read(file)
      expect(src, `${file} 未复用共享思考参数构造器`).toMatch(/from\s+['"][^'"]*thinkingParams['"]/)
      // 不得在本文件内再手写 { type: 'enabled' / 'disabled' } 的重复实现
      expect(src, `${file} 仍存在本地重复实现`).not.toMatch(/type:\s*'(enabled|disabled)'/)
    }
    const shared = read('electron/utils/thinkingParams.ts')
    expect(shared).toContain('export function buildThinkingParams')
  })
})

describe('IPC 契约（preload / vite-env）必须同步 thinkingEnabled', () => {
  it('preload 与渲染端类型声明都带上 thinkingEnabled', () => {
    for (const file of ['electron/preload.ts', 'src/vite-env.d.ts']) {
      const src = read(file)
      expect(src, `${file} 的 testApi 契约缺少 thinkingEnabled`).toContain('thinkingEnabled')
    }
  })
})
