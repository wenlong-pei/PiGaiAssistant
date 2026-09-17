/**
 * 自动更新「接线契约」守卫测试
 *
 * 背景（2026-09-17）：排查"GitHub 发新版但客户端收不到更新"时发现，
 * 代码每一块看起来都对，但**接线断了**：
 *   1. `main.ts` 从未调用 `setMainWindow()` / 从未启动检查 → 客户端永远不主动发现新版本；
 *   2. `UpdateChecker.tsx` 是个**孤儿组件**，没有任何页面引用 → 界面里根本没有更新入口；
 *   3. `update:check` 把失败吞成 null → 界面把"检查失败"显示成"已是最新版本"。
 * 这三类问题的共同点是：**单测/类型检查全绿，功能却是死的**。
 * 因此这里用源码级断言把接线钉死，防止再次回归。
 */

import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

const ROOT = process.cwd()

/**
 * 去掉注释后再断言。
 * 否则"把接线代码注释掉"依然能骗过文本断言——那正是本测试要防的场景。
 * 注意保留 `://`（URL 里的双斜杠）不被误当成行注释。
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function read(relativePath: string): string {
  return stripComments(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'))
}

/** 读原始内容（需要保留注释语义时使用，例如 package.json 无需处理） */
function readRaw(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8')
}

function listFiles(dir: string, exts: string[]): string[] {
  const out: string[] = []
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue
        walk(full)
      } else if (exts.some((ext) => entry.name.endsWith(ext))) {
        out.push(full)
      }
    }
  }
  walk(path.join(ROOT, dir))
  return out
}

describe('自动更新接线契约', () => {
  it('main.ts 必须绑定主窗口并启动自动检查（否则状态推送不可达、客户端永不主动检查）', () => {
    const source = read('electron/main.ts')
    expect(source).toContain('getAutoUpdateService')
    expect(source).toContain('setMainWindow(')
    expect(source).toContain('startAutoCheck()')
  })

  it('UpdateChecker 不能是孤儿组件：必须被至少一个页面/组件引用', () => {
    const files = listFiles('src', ['.tsx', '.ts']).filter(
      (file) => !file.endsWith(`UpdateChecker${path.sep}UpdateChecker.tsx`) && !file.endsWith('UpdateChecker.tsx')
    )
    const referencing = files.filter((file) => {
      // 必须去注释后再匹配：注释掉的 import 不算真正引用
      const content = stripComments(fs.readFileSync(file, 'utf8'))
      return /from\s+['"][^'"]*UpdateChecker['"]/.test(content)
    })
    expect(
      referencing.length,
      'UpdateChecker 没有任何引用方，用户界面上就没有更新入口，再好的更新链路也白搭'
    ).toBeGreaterThan(0)
  })

  it('检查更新必须能区分"已是最新"与"检查失败"（失败不得被吞成 null）', () => {
    const source = read('electron/autoUpdater.ts')
    // 结构化结果里必须有失败态
    expect(source).toContain("reason: 'failed'")
    expect(source).toContain("reason: 'up-to-date'")

    // 早期实现：update:check 的 catch 里 return null，
    // 渲染层便一律显示"当前已是最新版本"，更新链路坏掉用户也发现不了。
    const regionStart = source.indexOf("ipcMain.handle('update:check'")
    const regionEnd = source.indexOf("ipcMain.handle('update:download'")
    expect(regionStart, '未找到 update:check 处理程序').toBeGreaterThan(-1)
    expect(regionEnd, '未找到 update:download 处理程序（用于界定检查区域）').toBeGreaterThan(regionStart)

    const checkRegion = source.slice(regionStart, regionEnd)
    expect(checkRegion).toContain('checkNow')
    expect(checkRegion).not.toContain('return null')
  })

  it('安装版才自动下载；绿色版不得自动下载', () => {
    const source = read('electron/autoUpdater.ts')
    expect(source).toContain('autoDownload = !this.isPortable')
  })

  it('安全基线：禁止退出时静默安装、禁止降级', () => {
    const source = read('electron/autoUpdater.ts')
    expect(source).toContain('autoInstallOnAppQuit = false')
    expect(source).toContain('allowDowngrade = false')
  })

  it('绿色版必须被拒绝自动安装（更新包会装成新副本而非替换自身）', () => {
    const source = read('electron/autoUpdater.ts')
    const installBody = source.slice(source.indexOf('installUpdate(): void'))
    expect(installBody).toContain('this.isPortable')
    expect(installBody).toContain('throw new Error')
  })

  it('preload 必须放行并暴露手动下载入口（绿色版兜底）', () => {
    const source = read('electron/preload.ts')
    expect(source).toContain("'update:open-download'")
    expect(source).toContain('openDownloadPage')
  })

  it('渲染端类型声明必须与 preload 契约同步', () => {
    const source = read('src/vite-env.d.ts')
    expect(source).toContain('openDownloadPage')
    expect(source).toContain('isPortable')
    expect(source).toContain('manualDownloadUrl')
  })

  it('更新源配置必须由打包产物解析，且 autoUpdater 实际使用它', () => {
    expect(fs.existsSync(path.join(ROOT, 'electron/updateConfig.ts'))).toBe(true)
    const source = read('electron/autoUpdater.ts')
    expect(source).toContain("from './updateConfig'")
    expect(source).toContain('isPortableBuild')
    expect(source).toContain('getUpdateFeedInfo')
  })

  it('发布源仓库必须与客户端读取更新的仓库一致，且不得留空', () => {
    const pkg = JSON.parse(readRaw('package.json'))
    const publish = pkg.build?.publish
    expect(publish, 'package.json 缺少 build.publish，客户端将不知道去哪里检查更新').toBeTruthy()
    expect(publish.provider).toBe('github')
    expect(publish.owner).toBeTruthy()
    expect(publish.repo).toBeTruthy()
    // 客户端无法匿名读取私有仓库的 Release，故更新源必须指向公开仓库
    expect(publish.repo).toBe('PiGaiAssistant')
  })

  it('绿色版判定必须依赖 electron-builder 注入的环境变量', () => {
    const source = read('electron/updateConfig.ts')
    expect(source).toContain('PORTABLE_EXECUTABLE_DIR')
    expect(source).toContain('PORTABLE_EXECUTABLE_FILE')
  })

  it('检查更新必须有并发保护（启动首检 / 定时轮询 / 手动点击会撞车）', () => {
    const source = read('electron/autoUpdater.ts')
    expect(source).toContain('checkInFlight')
    expect(source).toContain("reason: 'in-progress'")
    // 渲染层遇到并发态必须静默，不能再弹一次"已是最新"或失败提示
    const ui = read('src/components/common/UpdateChecker.tsx')
    expect(ui).toContain("result?.reason === 'in-progress'")
  })

  it('发布脚本必须存在，避免"手动打包忘了发布"导致客户端收不到更新', () => {
    const pkg = JSON.parse(readRaw('package.json'))
    expect(pkg.scripts['release:win']).toContain('--publish always')
  })
})
