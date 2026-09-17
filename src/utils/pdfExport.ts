import jsPDF from 'jspdf'
import 'jspdf-autotable'
import dayjs from 'dayjs'
import type { GradingRecord } from '@/types'

/**
 * 导出批改记录为 PDF 格式
 * @param records 批改记录数组
 * @param title 可选标题（默认为"批改记录报告"）
 */
export function exportToPDF(
  records: GradingRecord[],
  title: string = '批改记录报告'
): void {
  if (records.length === 0) {
    console.warn('没有可导出的记录')
    return
  }

  // 创建 PDF 文档（A4 横向）
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4',
  })

  // 设置中文字体（如果需要支持中文）
  // 注意：jsPDF 默认不支持中文，需要引入中文字体文件
  // 这里使用内置字体，中文可能会显示为乱码
  // 生产环境建议使用 jsPDF-CustomFonts-support 或类似库

  // 添加标题
  doc.setFontSize(18)
  doc.text(title, 14, 22)

  // 添加导出时间
  doc.setFontSize(10)
  doc.text(
    `导出时间: ${dayjs().format('YYYY-MM-DD HH:mm:ss')}`,
    14,
    30
  )

  // 添加统计信息
  const completedCount = records.filter(r => r.status === 'completed').length
  const failedCount = records.filter(r => r.status === 'failed').length
  const pendingCount = records.filter(r => r.status === 'pending').length
  const avgScore = completedCount > 0
    ? records
        .filter(r => r.status === 'completed')
        .reduce((sum, r) => sum + r.score, 0) / completedCount
    : 0

  doc.text(
    `总记录: ${records.length} | 已完成: ${completedCount} | 失败: ${failedCount} | 待处理: ${pendingCount} | 平均分: ${avgScore.toFixed(1)}`,
    14,
    36
  )

  // 准备表格数据
  const tableData = records.map((record, index) => [
    index + 1,
    record.questionNumber || '-',
    record.standardName || '-',
    record.studentName || record.studentId || '-',
    record.ocrText ? record.ocrText.substring(0, 50) + (record.ocrText.length > 50 ? '...' : '') : '-',
    record.aiScore ?? '-',
    record.score,
    record.maxScore,
    record.maxScore > 0 ? `${Math.round((record.score / record.maxScore) * 100)}%` : '-',
    record.aiComment ? record.aiComment.substring(0, 30) + (record.aiComment.length > 30 ? '...' : '') : '-',
    record.evaluationMode === 'ai' ? 'AI批改' : record.evaluationMode === 'manual' ? '手动评分' : '混合模式',
    record.status === 'completed' ? '已完成' : record.status === 'failed' ? '失败' : '待处理',
    record.isBlank ? '是' : '否',
    record.completedAt
      ? dayjs(record.completedAt).format('YYYY-MM-DD HH:mm')
      : dayjs(record.createdAt).format('YYYY-MM-DD HH:mm'),
  ])

  // 添加表格
  ;(doc as any).autoTable({
    head: [
      [
        '序号',
        '题号',
        '评分标准',
        '学生',
        '作答内容',
        'AI评分',
        '最终分数',
        '满分',
        '得分率',
        'AI点评',
        '批改模式',
        '状态',
        '空白',
        '批改时间',
      ],
    ],
    body: tableData,
    startY: 42,
    styles: {
      fontSize: 8,
      cellPadding: 2,
    },
    headStyles: {
      fillColor: [66, 139, 202],
      textColor: 255,
      fontSize: 9,
      fontStyle: 'bold',
    },
    columnStyles: {
      0: { cellWidth: 10 },  // 序号
      1: { cellWidth: 15 },  // 题号
      2: { cellWidth: 20 },  // 评分标准
      3: { cellWidth: 20 },  // 学生
      4: { cellWidth: 40 },  // 作答内容
      5: { cellWidth: 15 },  // AI评分
      6: { cellWidth: 15 },  // 最终分数
      7: { cellWidth: 15 },  // 满分
      8: { cellWidth: 15 },  // 得分率
      9: { cellWidth: 30 },  // AI点评
      10: { cellWidth: 20 }, // 批改模式
      11: { cellWidth: 15 }, // 状态
      12: { cellWidth: 10 }, // 空白
      13: { cellWidth: 25 }, // 批改时间
    },
    margin: { top: 42, right: 14, bottom: 20, left: 14 },
    theme: 'striped',
    didDrawPage: (data: any) => {
      // 添加页脚
      const pageCount = (doc as any).internal.getNumberOfPages()
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i)
        doc.setFontSize(8)
        doc.text(
          `第 ${i} 页 / 共 ${pageCount} 页`,
          doc.internal.pageSize.width / 2,
          doc.internal.pageSize.height - 10,
          { align: 'center' }
        )
      }
    },
  })

  // 生成文件名并保存
  const filename = `批改记录_${dayjs().format('YYYYMMDD_HHmmss')}.pdf`
  doc.save(filename)
}

/**
 * 导出单条批改记录详情为 PDF（用于打印或分享）
 * @param record 单条批改记录
 */
export function exportRecordDetailToPDF(record: GradingRecord): void {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  })

  // 标题
  doc.setFontSize(20)
  doc.text('批改记录详情', 14, 22)

  // 基本信息
  doc.setFontSize(12)
  const info = [
    ['题号', record.questionNumber || '-'],
    ['评分标准', record.standardName || '-'],
    ['学生姓名', record.studentName || '-'],
    ['学生学号', record.studentId || '-'],
    ['AI评分', record.aiScore?.toString() || '-'],
    ['最终分数', `${record.score} / ${record.maxScore}`],
    ['得分率', record.maxScore > 0 ? `${Math.round((record.score / record.maxScore) * 100)}%` : '-'],
    ['批改模式', record.evaluationMode === 'ai' ? 'AI批改' : record.evaluationMode === 'manual' ? '手动评分' : '混合模式'],
    ['状态', record.status === 'completed' ? '已完成' : record.status === 'failed' ? '失败' : '待处理'],
    ['是否空白卷', record.isBlank ? '是' : '否'],
    ['批改时间', record.completedAt
      ? dayjs(record.completedAt).format('YYYY-MM-DD HH:mm:ss')
      : dayjs(record.createdAt).format('YYYY-MM-DD HH:mm:ss')
    ],
  ]

  ;(doc as any).autoTable({
    body: info,
    startY: 30,
    styles: { fontSize: 11 },
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 40 },
      1: { cellWidth: 100 },
    },
    theme: 'plain',
  })

  // 作答内容
  const finalY = (doc as any).lastAutoTable.finalY || 100
  doc.setFontSize(14)
  doc.text('作答内容:', 14, finalY + 15)
  doc.setFontSize(10)
  const splitText = doc.splitTextToSize(record.ocrText || '(无)', 180)
  doc.text(splitText, 14, finalY + 25)

  // AI 点评
  if (record.aiComment) {
    const textY = finalY + 25 + splitText.length * 5 + 10
    doc.setFontSize(14)
    doc.text('AI 点评:', 14, textY)
    doc.setFontSize(10)
    const splitComment = doc.splitTextToSize(record.aiComment, 180)
    doc.text(splitComment, 14, textY + 10)
  }

  // 保存
  const filename = `批改记录_${record.studentName || record.studentId || record.id}_${dayjs().format('YYYYMMDD_HHmmss')}.pdf`
  doc.save(filename)
}
