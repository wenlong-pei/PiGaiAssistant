// 诊断脚本：检查 mock 页面元素与 ConfigService 选择器（使用系统 Edge）
const { chromium } = require('playwright')
const fs = require('fs')
const path = require('path')

async function launch() {
  try {
    return await chromium.launch({ headless: true })
  } catch (e) {
    const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
    if (fs.existsSync(edgePath)) return await chromium.launch({ headless: true, executablePath: edgePath })
    const edgePath2 = 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
    if (fs.existsSync(edgePath2)) return await chromium.launch({ headless: true, executablePath: edgePath2 })
    throw e
  }
}

;(async () => {
  const browser = await launch()
  const page = await browser.newPage()
  // 修复：此前硬编码了作者本机的绝对路径（D:/workbuddyDate/...），
  // 换台机器/换目录就跑不了，也会把个人目录结构带进公开仓库。
  // 改为相对本脚本定位。
  const mockPath = path.join(__dirname, 'mock-zhixue.html')
  const url = `file://${mockPath.replace(/\\/g, '/')}`
  await page.goto(url)
  await page.waitForFunction(() => window.__g)
  const info = await page.evaluate(() => ({
    inputNum: !!document.querySelector('input[type="number"]'),
    inputNew: !!document.querySelector('#inputScore'),
    btnSave: !!document.querySelector('#bnt_save'),
    imgLegacy: !!document.querySelector('div[name="topicImg"] img'),
    title: document.title,
  }))
  console.log('PAGE:', JSON.stringify(info))
  await browser.close()
})().catch((e) => { console.error('ERR', e.message); process.exit(1) })
