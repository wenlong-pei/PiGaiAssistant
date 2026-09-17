/**
 * 更新源配置解析
 *
 * 设计意图：更新源的唯一事实来源是 electron-builder 打包时写入的
 * `app-update.yml`（由 package.json 的 build.publish 生成）。
 * 这里在运行时解析它，而不是在源码里再硬编码一份 owner/repo，
 * 避免"改了 package.json 但忘了改代码"这类漂移。
 */

import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'

/** 兜底值：仅在开发态（读不到 app-update.yml）下使用，必须与 package.json 的 build.publish 保持一致 */
const FALLBACK_OWNER = 'wenlong-pei'
const FALLBACK_REPO = 'PiGaiAssistant'

export interface UpdateFeedInfo {
  owner: string
  repo: string
  /** 面向人类的最新 Release 页面（绿色版用户手动下载用） */
  releasesUrl: string
  /** 是否真的从打包产物里的 app-update.yml 读到了配置 */
  fromPackagedConfig: boolean
}

let cachedFeed: UpdateFeedInfo | null = null

/**
 * app-update.yml 是扁平结构（provider/owner/repo/updaterCacheDirName），
 * 不值得为此引入 YAML 依赖，用正则解析即可。
 */
function readYamlScalar(text: string, key: string): string | null {
  const match = new RegExp(`^${key}:\\s*(.+)$`, 'm').exec(text)
  if (!match) return null
  const value = match[1].trim().replace(/^['"]|['"]$/g, '')
  return value || null
}

export function getUpdateFeedInfo(): UpdateFeedInfo {
  if (cachedFeed) return cachedFeed

  let owner = FALLBACK_OWNER
  let repo = FALLBACK_REPO
  let fromPackagedConfig = false

  try {
    if (app.isPackaged) {
      const ymlPath = path.join(process.resourcesPath, 'app-update.yml')
      const text = fs.readFileSync(ymlPath, 'utf8')
      const parsedOwner = readYamlScalar(text, 'owner')
      const parsedRepo = readYamlScalar(text, 'repo')
      if (parsedOwner && parsedRepo) {
        owner = parsedOwner
        repo = parsedRepo
        fromPackagedConfig = true
      }
    }
  } catch {
    // 读不到就退回兜底值，不影响主流程
  }

  cachedFeed = {
    owner,
    repo,
    releasesUrl: `https://github.com/${owner}/${repo}/releases/latest`,
    fromPackagedConfig,
  }
  return cachedFeed
}

/**
 * 是否为绿色版（portable）运行。
 *
 * electron-builder 的 portable target 会在启动被解包后的应用时注入
 * `PORTABLE_EXECUTABLE_DIR` / `PORTABLE_EXECUTABLE_FILE` 环境变量，
 * 这是区分"安装版"与"绿色版"最可靠的运行时依据。
 *
 * 为什么必须区分：绿色版没有安装目录，electron-updater 下载到的是 NSIS 安装包，
 * 执行后会在系统里装出一份**新的**副本，而不是替换当前正在运行的绿色版，
 * 用户会困惑于"更新完还是旧版本/突然多了一个安装版"。所以绿色版必须降级为手动更新。
 */
export function isPortableBuild(): boolean {
  return !!(process.env.PORTABLE_EXECUTABLE_DIR || process.env.PORTABLE_EXECUTABLE_FILE)
}
