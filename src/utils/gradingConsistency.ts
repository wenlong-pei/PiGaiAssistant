/**
 * 一致性评测工具（改进方案第一层）
 * - extractStructuredGrade：稳健解析模型返回的结构化打分 JSON（容错夹带文字/中文键名）
 * - clampScore：将分数约束到 [0, maxScore]
 * - evaluateConsistency：对比模型评分与人工标注，给出一致性报告
 *
 * 本模块为纯函数，无外部依赖，可在 vitest 中网络无关地运行，
 * 也可被 scripts/consistency-eval.mjs 复用其统计逻辑（通过复制或 import 构建产物）。
 */

export interface ParsedGrade {
  score?: number
  comment?: string
  errorTags?: string[]
  rubricBreakdown?: Array<{ id: string; awarded: number }>
}

export interface LabeledSample {
  id?: string
  expectedScore: number
  parsedScore: number
}

export interface ConsistencySample {
  id?: string
  expectedScore: number
  parsedScore: number
  diff: number
}

export interface ConsistencyReport {
  total: number
  exactMatch: number
  withinTolerance: number
  exactRate: number
  toleranceRate: number
  samples: ConsistencySample[]
}

/**
 * 从模型返回内容中提取结构化打分结果。
 * 兼容：干净 JSON、夹带说明文字的 JSON、中文键名（得分/总分/评语/错因标签）。
 */
export function extractStructuredGrade(content: string): ParsedGrade {
  const text = (content || '').trim()
  let parsed: Record<string, unknown> = {}

  try {
    parsed = JSON.parse(text) as Record<string, unknown>
  } catch {
    const match = text.match(/\{[\s\S]*\}/)
    if (match) {
      try {
        parsed = JSON.parse(match[0]) as Record<string, unknown>
      } catch {
        // 解析失败，返回空对象（调用方应降级到本地评分）
      }
    }
  }

  const result: ParsedGrade = {}

  const rawScore = parsed['score'] ?? parsed['得分'] ?? parsed['总分']
  if (rawScore !== undefined) {
    const num = Number(String(rawScore).match(/-?\d+(\.\d+)?/)?.[0])
    if (!Number.isNaN(num)) result.score = num
  }

  result.comment =
    (parsed['comment'] as string) ?? (parsed['评语'] as string) ?? undefined

  const rawTags = parsed['errorTags'] ?? parsed['错因标签']
  if (Array.isArray(rawTags)) {
    result.errorTags = rawTags.map((t) => String(t))
  }

  const rawBreakdown = parsed['rubricBreakdown'] ?? parsed['维度得分']
  if (Array.isArray(rawBreakdown)) {
    result.rubricBreakdown = rawBreakdown
      .map((b) => {
        const obj = b as Record<string, unknown>
        return {
          id: String(obj['id'] ?? obj['维度'] ?? ''),
          awarded: Number(obj['awarded'] ?? obj['实得'] ?? 0) || 0,
        }
      })
      .filter((b) => b.id)
  }

  return result
}

/**
 * 将分数约束到合法区间 [0, maxScore]，四舍五入。
 */
export function clampScore(raw: number, maxScore: number): number {
  if (Number.isNaN(raw)) return 0
  return Math.min(maxScore, Math.max(0, Math.round(raw)))
}

/**
 * 计算模型评分与人工标注的一致性报告。
 * @param samples 标注样本（期望分 + 模型解析分）
 * @param tolerance 容差（允许的分差），默认 0 表示必须完全一致
 */
export function evaluateConsistency(
  samples: LabeledSample[],
  tolerance = 0
): ConsistencyReport {
  const safeTolerance = Math.max(0, tolerance)

  const items: ConsistencySample[] = samples.map((s) => ({
    id: s.id,
    expectedScore: s.expectedScore,
    parsedScore: s.parsedScore,
    diff: Math.abs(s.parsedScore - s.expectedScore),
  }))

  const total = items.length
  const exactMatch = items.filter((i) => i.diff === 0).length
  const withinTolerance = items.filter((i) => i.diff <= safeTolerance).length

  return {
    total,
    exactMatch,
    withinTolerance,
    exactRate: total ? exactMatch / total : 0,
    toleranceRate: total ? withinTolerance / total : 0,
    samples: items,
  }
}
