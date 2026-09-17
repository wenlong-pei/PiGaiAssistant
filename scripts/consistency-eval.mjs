#!/usr/bin/env node
/**
 * 一致性评测脚本（改进方案第一层）
 * ------------------------------------------------------------------
 * 用途：用一小批「人工标注样本」跑真实的 AI 评分，对比模型给分与人工给分，
 *      统计完全一致率 / 容差内一致率 / 低置信度占比，防止"模型悄悄飘了不知道"。
 *
 * 用法：
 *   1) 准备样本文件（JSON 数组），参考同目录 consistency-samples.json 模板：
 *      [
 *        {
 *          "id": "q1-样本1",
 *          "expectedScore": 8,                       // 教师人工给分
 *          "text": "学生的作答文本...",
 *          "standard": { "name": "题1", "totalScore": 10, "referenceAnswer": "...", "scoringRules": "..." }
 *        }
 *      ]
 *   2) 配置环境变量（或用默认值）：
 *        GRADING_API_ENDPOINT  OpenAI 兼容的 /chat/completions 地址（不含后缀也可，脚本会自动补全）
 *        GRADING_API_KEY       服务商 API Key
 *        GRADING_MODEL         模型名（默认 deepseek-chat）
 *        GRADING_TEMPERATURE   温度（默认 0，与 AIService 锁定一致）
 *        SAMPLES_PATH          样本文件路径（默认 ./consistency-samples.json）
 *        TOLERANCE             容差分差（默认 0，表示必须完全一致）
 *   3) 运行：
 *        node scripts/consistency-eval.mjs
 *
 * 说明：本脚本不依赖 Electron 主进程，独立运行。仅用于离线/定期评测，不影响产品构建。
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

const ENDPOINT = process.env.GRADING_API_ENDPOINT || ''
const API_KEY = process.env.GRADING_API_KEY || ''
const MODEL = process.env.GRADING_MODEL || 'deepseek-chat'
const TEMPERATURE = Number(process.env.GRADING_TEMPERATURE ?? '0')
const TOLERANCE = Number(process.env.TOLERANCE ?? '0')
const SAMPLES_PATH = resolve(__dirname, process.env.SAMPLES_PATH || 'consistency-samples.json')

function normalizeEndpoint(url) {
  const base = url.replace(/\/+$/, '')
  return base.endsWith('/chat/completions') ? base : `${base}/chat/completions`
}

function buildPrompt(sample) {
  const std = sample.standard || {}
  const rubric = std.scoringRules
    ? `\n【评分量规】\n${std.scoringRules}`
    : ''
  const ref = std.referenceAnswer ? `\n【参考答案】\n${std.referenceAnswer}` : ''
  return `【题目】${std.name || '(未命名)'}
【满分】${std.totalScore || 10}分
${rubric}${ref}

【学生作答】
${sample.text}

请严格按评分量规批改。必须且只返回如下 JSON：
{"score": <整数, 0~满分>, "comment": "<简短评语>", "confidence": <0~1>, "errorTags": ["<错因标签>"], "rubricBreakdown": [{"id":"<维度id>","awarded":<实得>}]}`
}

function extractStructuredGrade(content) {
  const text = (content || '').trim()
  let parsed = {}
  try {
    parsed = JSON.parse(text)
  } catch {
    const m = text.match(/\{[\s\S]*\}/)
    if (m) {
      try { parsed = JSON.parse(m[0]) } catch { /* ignore */ }
    }
  }
  const scoreRaw = parsed.score ?? parsed.得分 ?? parsed.总分
  const score = scoreRaw === undefined ? undefined : Number(String(scoreRaw).match(/-?\d+(\.\d+)?/)?.[0])
  const confRaw = parsed.confidence ?? parsed.置信度
  const confidence = confRaw === undefined ? undefined : Math.min(1, Math.max(0, Number(confRaw)))
  return { score: Number.isNaN(score) ? undefined : score, confidence: Number.isNaN(confidence) ? undefined : confidence }
}

async function gradeOne(sample) {
  const endpoint = normalizeEndpoint(ENDPOINT)
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: '你是一个专业的批改老师，必须只返回 JSON 评分结果。' },
        { role: 'user', content: buildPrompt(sample) },
      ],
      temperature: TEMPERATURE,
      max_tokens: 500,
    }),
  })
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`)
  }
  const data = await response.json()
  const content = data?.choices?.[0]?.message?.content || '{}'
  return extractStructuredGrade(content)
}

function evaluate(samples, results) {
  const items = samples.map((s, i) => {
    const parsed = results[i]
    const parsedScore = parsed.score ?? -1
    const diff = Math.abs(parsedScore - s.expectedScore)
    return {
      id: s.id || `样本${i + 1}`,
      expected: s.expectedScore,
      parsed: parsedScore,
      diff,
      conf: parsed.confidence,
      lowConf: parsed.confidence !== undefined && parsed.confidence < 0.7,
    }
  })
  const total = items.length
  const exact = items.filter((x) => x.diff === 0).length
  const within = items.filter((x) => x.diff <= TOLERANCE).length
  const lowConf = items.filter((x) => x.lowConf).length
  return {
    total,
    exact,
    within,
    exactRate: total ? exact / total : 0,
    toleranceRate: total ? within / total : 0,
    lowConf,
    items,
  }
}

async function main() {
  if (!ENDPOINT || !API_KEY) {
    console.error('[一致性评测] 缺少环境变量 GRADING_API_ENDPOINT 或 GRADING_API_KEY，已退出。')
    console.error('示例：GRADING_API_ENDPOINT=https://api.deepseek.com/v1 GRADING_API_KEY=sk-xxx node scripts/consistency-eval.mjs')
    process.exit(1)
  }

  let samples
  try {
    samples = JSON.parse(readFileSync(SAMPLES_PATH, 'utf-8'))
  } catch (err) {
    console.error(`[一致性评测] 无法读取样本文件 ${SAMPLES_PATH}：${err.message}`)
    process.exit(1)
  }
  if (!Array.isArray(samples) || samples.length === 0) {
    console.error('[一致性评测] 样本为空，请先在 consistency-samples.json 中填入人工标注样本。')
    process.exit(1)
  }

  console.log(`[一致性评测] 开始评测 ${samples.length} 个样本（model=${MODEL}, temperature=${TEMPERATURE}, tolerance=${TOLERANCE}）`)

  const results = []
  for (let i = 0; i < samples.length; i++) {
    try {
      const r = await gradeOne(samples[i])
      results.push(r)
      console.log(`  - ${samples[i].id || `样本${i + 1}`}: 期望 ${samples[i].expectedScore} / 模型 ${r.score ?? '解析失败'} / 置信度 ${r.confidence ?? '未知'}`)
    } catch (err) {
      console.error(`  - ${samples[i].id || `样本${i + 1}`} 调用失败：${err.message}`)
      results.push({ score: undefined, confidence: undefined })
    }
  }

  const report = evaluate(samples, results)
  console.log('\n========== 一致性评测报告 ==========')
  console.log(`样本总数:        ${report.total}`)
  console.log(`完全一致:        ${report.exact} (${(report.exactRate * 100).toFixed(1)}%)`)
  console.log(`容差内一致:      ${report.within} (${(report.toleranceRate * 100).toFixed(1)}%, 容差=${TOLERANCE})`)
  console.log(`低置信度(<0.7):  ${report.lowConf}`)
  console.log('===================================')

  const csv = ['id,expected,parsed,diff,confidence,lowConfidence']
    .concat(report.items.map((x) => `${x.id},${x.expected},${x.parsed},${x.diff},${x.conf ?? ''},${x.lowConf}`))
    .join('\n')
  const outPath = resolve(__dirname, 'consistency-report.csv')
  writeFileSync(outPath, csv, 'utf-8')
  console.log(`明细已写入: ${outPath}`)
}

main().catch((err) => {
  console.error('[一致性评测] 运行异常：', err)
  process.exit(1)
})
