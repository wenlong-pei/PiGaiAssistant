import dayjs from 'dayjs'
import type { GradingRecord } from '@/types'

/**
 * 导出批改记录为 CSV 格式
 * @param records 批改记录数组
 * @param filename 可选文件名（不含扩展名）
 */
export function exportToCSV(
  records: GradingRecord[],
  filename?: string
): void {
  if (records.length === 0) {
    console.warn('没有可导出的记录')
    return
  }

  // 定义 CSV 表头
  const headers = [
    '序号',
    '题号',
    '评分标准',
    '学生姓名',
    '学生学号',
    '作答内容',
    'AI评分',
    '最终分数',
    '满分',
    '得分率',
    'AI点评',
    '批改模式',
    '状态',
    '是否空白卷',
    '纠错记录',
    '批改时间',
  ]

  // 构建 CSV 数据行
  const rows = records.map((record, index) => [
    index + 1,
    record.questionNumber || '',
    record.standardName || '',
    record.studentName || '',
    record.studentId || '',
    // CSV 中需要转义特殊字符（引号、换行等）
    escapeCSVField(record.ocrText || ''),
    record.aiScore ?? '',
    record.score,
    record.maxScore,
    record.maxScore > 0 ? `${Math.round((record.score / record.maxScore) * 100)}%` : '',
    escapeCSVField(record.aiComment || ''),
    record.evaluationMode === 'ai' ? 'AI批改' : record.evaluationMode === 'manual' ? '手动评分' : '混合模式',
    record.status === 'completed' ? '已完成' : record.status === 'failed' ? '失败' : '待处理',
    record.isBlank ? '是' : '否',
    escapeCSVField(record.correctionReason || ''),
    record.completedAt
      ? dayjs(record.completedAt).format('YYYY-MM-DD HH:mm:ss')
      : dayjs(record.createdAt).format('YYYY-MM-DD HH:mm:ss'),
  ])

  // 生成 CSV 内容
  const csvContent = [
    // 添加 BOM（Byte Order Mark）以支持中文
    '\uFEFF',
    // 表头行
    headers.map(h => escapeCSVField(h)).join(','),
    // 数据行
    ...rows.map(row => row.map(cell => escapeCSVField(String(cell))).join(',')),
  ].join('\n')

  // 创建 Blob 并触发下载
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  downloadBlob(blob, filename || `批改记录_${dayjs().format('YYYYMMDD_HHmmss')}.csv`)
}

/**
 * 转义 CSV 字段中的特殊字符
 * - 如果字段包含逗号、引号、换行符，需要用双引号包裹
 * - 字段内的双引号需要转义为两个双引号
 * @param field 原始字段值
 * @returns 转义后的字段值
 */
function escapeCSVField(field: string): string {
  // 如果字段包含逗号、双引号或换行符，需要用双引号包裹
  if (field.includes(',') || field.includes('"') || field.includes('\n') || field.includes('\r')) {
    // 转义双引号：将 " 替换为 ""
    return `"${field.replace(/"/g, '""')}"`
  }
  return field
}

/**
 * 导出单条批改记录详情为 CSV（简化格式）
 * @param record 单条批改记录
 */
export function exportRecordDetailToCSV(record: GradingRecord): void {
  const headers = ['字段', '值']
  const rows = [
    ['题号', record.questionNumber || '-'],
    ['评分标准', record.standardName || '-'],
    ['学生姓名', record.studentName || '-'],
    ['学生学号', record.studentId || '-'],
    ['作答内容', record.ocrText || ''],
    ['AI评分', record.aiScore?.toString() || '-'],
    ['最终分数', `${record.score}`],
    ['满分', `${record.maxScore}`],
    ['得分率', record.maxScore > 0 ? `${Math.round((record.score / record.maxScore) * 100)}%` : '-'],
    ['AI点评', record.aiComment || ''],
    ['批改模式', record.evaluationMode === 'ai' ? 'AI批改' : record.evaluationMode === 'manual' ? '手动评分' : '混合模式'],
    ['状态', record.status === 'completed' ? '已完成' : record.status === 'failed' ? '失败' : '待处理'],
    ['是否空白卷', record.isBlank ? '是' : '否'],
    ['纠错记录', record.correctionReason || ''],
    ['批改时间', record.completedAt
      ? dayjs(record.completedAt).format('YYYY-MM-DD HH:mm:ss')
      : dayjs(record.createdAt).format('YYYY-MM-DD HH:mm:ss')
    ],
  ]

  const csvContent = [
    '\uFEFF',
    headers.map(h => escapeCSVField(h)).join(','),
    ...rows.map(row => row.map(cell => escapeCSVField(cell)).join(',')),
  ].join('\n')

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  const filename = `批改记录_${record.studentName || record.studentId || record.id}_${dayjs().format('YYYYMMDD_HHmmss')}.csv`
  downloadBlob(blob, filename)
}

/**
 * 触发文件下载
 * @param blob Blob 对象
 * @param filename 文件名
 */
function downloadBlob(blob: Blob, filename: string): void {
  // 创建下载链接
  const link = document.createElement('a')
  const url = URL.createObjectURL(blob)
  
  link.setAttribute('href', url)
  link.setAttribute('download', filename)
  link.style.display = 'none'
  
  // 添加到文档并触发点击
  document.body.appendChild(link)
  link.click()
  
  // 清理
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

/**
 * 导出记录为 JSON 格式（用于数据备份和导入）
 * @param records 批改记录数组
 */
export function exportToJSON(
  records: GradingRecord[],
  filename?: string
): void {
  if (records.length === 0) {
    console.warn('没有可导出的记录')
    return
  }

  const jsonContent = JSON.stringify(records, null, 2)
  const blob = new Blob([jsonContent], { type: 'application/json;charset=utf-8;' })
  downloadBlob(blob, filename || `批改记录_${dayjs().format('YYYYMMDD_HHmmss')}.json`)
}
