#!/usr/bin/env node
/**
 * 更新源自检脚本
 *
 * 解决的问题：自动更新的失败往往是**静默**的——包发出去了，但客户端永远收不到。
 * 常见隐形陷阱：
 *   1. electron-builder 默认把 Release 创建成 **draft**，而 draft 客户端读不到；
 *   2. `latest.yml` 没上传，或它登记的文件名在 Release 资产里不存在；
 *   3. 版本号没递增，客户端认为"已是最新"；
 *   4. 更新源仓库是私有的，客户端匿名读不到。
 * 本脚本把这几件事一次性查清，并给出明确结论。
 *
 * 用法：
 *   node scripts/check-update-feed.mjs            # 检查本地 package.json 的版本是否已可被客户端取到
 *   node scripts/check-update-feed.mjs 2.6.5      # 检查指定版本
 *   GH_TOKEN=xxx node scripts/check-update-feed.mjs   # 仓库为私有时需要令牌
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'))

const publish = pkg.build?.publish
if (!publish || publish.provider !== 'github') {
  console.error('❌ package.json 的 build.publish 未配置为 github，客户端不知道去哪里检查更新')
  process.exit(1)
}

const { owner, repo } = publish
const appName = pkg.name // electron-builder 上传时用 ASCII 规范名：${name}-setup-${version}.exe
const targetVersion = process.argv[2] || pkg.version

const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || ''
const headers = {
  Accept: 'application/vnd.github+json',
  'User-Agent': 'pilaoban-update-feed-check',
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
}

const ok = (m) => console.log(`  ✅ ${m}`)
const bad = (m) => console.log(`  ❌ ${m}`)
const warn = (m) => console.log(`  ⚠️  ${m}`)

async function main() {
  console.log('')
  console.log(`更新源自检 —— ${owner}/${repo}`)
  console.log(`本地版本：${pkg.version}　目标检查版本：${targetVersion}`)
  console.log('')

  let problems = 0

  // ---------- 1. 仓库可达性 ----------
  console.log('[1/5] 仓库可达性')
  const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers })
  if (repoRes.status === 404) {
    bad(`仓库不可访问（HTTP 404）。若仓库是私有的，客户端将无法匿名读取 Release —— 自动更新必然失效。`)
    console.log('')
    console.log('结论：🔴 不通过 —— 请先把更新源仓库设为公开，或改用公开的发布仓库')
    process.exit(1)
  }
  if (!repoRes.ok) {
    bad(`仓库查询失败：HTTP ${repoRes.status}`)
    process.exit(1)
  }
  const repoInfo = await repoRes.json()
  if (repoInfo.private) {
    bad(`仓库是私有的。客户端要匿名检查更新，更新源仓库必须公开（否则必须把凭据打进客户端 = 泄露钥匙）`)
    problems++
  } else {
    ok(`仓库公开可读`)
  }

  // ---------- 2. 找到目标 Release ----------
  console.log('')
  console.log('[2/5] 目标 Release（draft 客户端读不到）')
  const relRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/releases?per_page=30`,
    { headers }
  )
  if (!relRes.ok) {
    bad(`Release 列表查询失败：HTTP ${relRes.status}`)
    process.exit(1)
  }
  const releases = await relRes.json()
  if (!Array.isArray(releases) || releases.length === 0) {
    bad('仓库里没有任何 Release —— 客户端检查更新时会认为"已是最新"')
    console.log('')
    console.log('结论：🔴 不通过 —— 请先执行发布（npm run release:win）')
    process.exit(1)
  }

  const wanted = [targetVersion, `v${targetVersion}`]
  const match = releases.find((r) => wanted.includes(r.tag_name))

  if (!match) {
    bad(`找不到版本 ${targetVersion} 对应的 Release（现有 tag：${releases.map((r) => r.tag_name).join(', ')}）`)
    console.log('')
    console.log('结论：🔴 不通过 —— 该版本尚未发布')
    process.exit(1)
  }

  if (match.draft) {
    bad(`Release ${match.tag_name} 仍是 draft —— 客户端读不到它，更新永远到不了用户`)
    problems++
  } else if (match.prerelease) {
    warn(`Release ${match.tag_name} 是 prerelease，部分客户端可能不会取用`)
    problems++
  } else {
    ok(`Release ${match.tag_name} 已正式发布（非 draft）`)
  }

  // ---------- 3. latest.yml ----------
  console.log('')
  console.log('[3/5] latest.yml（客户端读取的版本清单）')
  const assets = match.assets || []
  const ymlAsset = assets.find((a) => a.name === 'latest.yml')
  let expectedSetupName = `${appName}-setup-${targetVersion}.exe`

  if (!ymlAsset) {
    bad('Release 里没有 latest.yml —— 客户端拿不到版本与校验信息，无法更新')
    problems++
  } else {
    ok(`latest.yml 已上传（${ymlAsset.size} B）`)
    try {
      const ymlText = await (await fetch(ymlAsset.browser_download_url, { headers })).text()
      const ymlVersion = /^version:\s*(.+)$/m.exec(ymlText)?.[1]?.trim()
      const ymlPath = /^path:\s*(.+)$/m.exec(ymlText)?.[1]?.trim()
      const ymlUrl = /^\s*-\s*url:\s*(.+)$/m.exec(ymlText)?.[1]?.trim()

      if (ymlVersion === targetVersion) {
        ok(`latest.yml 版本 = ${ymlVersion}（与目标一致）`)
      } else {
        bad(`latest.yml 版本 = ${ymlVersion}，与目标 ${targetVersion} 不一致`)
        problems++
      }

      const referenced = ymlPath || ymlUrl
      if (referenced) {
        expectedSetupName = referenced
        ok(`latest.yml 指向更新包：${referenced}`)
      }
    } catch (error) {
      warn(`latest.yml 读取失败，跳过内容校验：${error.message}`)
    }
  }

  // ---------- 4. 更新包资产 ----------
  console.log('')
  console.log('[4/5] 更新包资产')
  const setupAsset = assets.find((a) => a.name === expectedSetupName)
  if (setupAsset) {
    ok(`找到更新包：${setupAsset.name}（${(setupAsset.size / 1024 / 1024).toFixed(1)} MB）`)
  } else {
    bad(
      `Release 里找不到 latest.yml 登记的更新包「${expectedSetupName}」\n` +
        `      现有资产：${assets.map((a) => a.name).join(', ') || '（无）'}\n` +
        `      客户端会因找不到文件而更新失败 —— 注意 electron-builder 上传时用的是 ASCII 规范名，` +
        `与本地中文 artifactName 不同。`
    )
    problems++
  }

  const blockmap = assets.find((a) => a.name.endsWith('.blockmap'))
  if (blockmap) {
    ok(`差分更新块图已上传：${blockmap.name}`)
  } else {
    warn('未找到 .blockmap（不影响全量更新，但会失去差分下载的省流能力）')
  }

  // ---------- 5. 版本比较 ----------
  console.log('')
  console.log('[5/5] 客户端是否会看到这次更新')
  const cmp = compareVersions(targetVersion, pkg.version)
  if (cmp > 0) {
    ok(`已发布版本 ${targetVersion} 高于本地 ${pkg.version} —— 低于该版本的客户端会收到更新`)
  } else if (cmp === 0) {
    warn(
      `已发布版本与本地 package.json 版本相同（都是 ${pkg.version}）。\n` +
        `      客户端不会认为有更新 —— 每次发版必须递增版本号。`
    )
    problems++
  } else {
    warn(`已发布版本 ${targetVersion} 低于本地 ${pkg.version}，客户端不会降级（allowDowngrade=false）`)
  }

  console.log('')
  if (problems === 0) {
    console.log('结论：🟢 通过 —— 客户端可以正常发现并下载这个版本')
    process.exit(0)
  }
  console.log(`结论：🔴 不通过 —— 发现 ${problems} 个会让客户端收不到更新的问题（见上）`)
  process.exit(1)
}

/** 版本比较：仅处理 x.y.z 数字段（忽略 prerelease 标识） */
function compareVersions(a, b) {
  const pa = String(a).split('-')[0].split('.').map((n) => parseInt(n, 10) || 0)
  const pb = String(b).split('-')[0].split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d !== 0) return d > 0 ? 1 : -1
  }
  return 0
}

main().catch((error) => {
  console.error(`\n❌ 自检脚本异常：${error.message}`)
  process.exit(1)
})
