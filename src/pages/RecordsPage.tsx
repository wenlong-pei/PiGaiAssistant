import { useState, useMemo, useEffect } from 'react'
import { motion } from 'framer-motion'
import {
  Search,
  Filter,
  Download,
  Trash2,
  Calendar,
  Hash,
  CheckCircle,
  XCircle,
  Clock,
  FileText,
  FolderOpen,
  FileSpreadsheet,
  FileText as FilePDF,
  FileJson,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  ChevronRight as ChevronRightEnd,
  Image as ImageIcon,
  CheckSquare,
  Square,
  X,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { useRecordsStore } from '@/store/recordsStore'
import { useStandardsStore } from '@/store/standardsStore'
import { useSound } from '@/hooks/useSound'
import { rulesToText } from './StandardsPage'
import ExcelJS from 'exceljs'
import dayjs from 'dayjs'
import { exportToPDF } from '@/utils/pdfExport'
import { exportToCSV } from '@/utils/csvExport'
import './RecordsPage.scss'

/** 记录超过该条数时自动分页 */
const PAGE_SIZE = 10

/** 记录分组 key：优先题号，无题号用标准名 */
const groupKeyOf = (r: { questionNumber?: string; standardName: string }) =>
  r.questionNumber || r.standardName || '未分类'

/** 解析答题图片 dataURL，转为 ExcelJS 需要的 base64 与扩展名 */
export function parseImageDataUrl(dataUrl: string): { base64: string; extension: 'png' | 'jpeg' } | null {
  const pngPrefix = 'data:image/png;base64,'
  const jpegPrefix = 'data:image/jpeg;base64,'
  if (dataUrl && dataUrl.startsWith(pngPrefix)) {
    return { base64: dataUrl.slice(pngPrefix.length), extension: 'png' }
  }
  if (dataUrl && dataUrl.startsWith(jpegPrefix)) {
    return { base64: dataUrl.slice(jpegPrefix.length), extension: 'jpeg' }
  }
  return null
}

export default function RecordsPage() {
  const { standards } = useStandardsStore()
  const {
    records,
    filters,
    setFilters,
    clearFilters,
    getFilteredRecords,
    getStatistics,
    deleteRecords
  } = useRecordsStore()
  const { playClick, playSuccess } = useSound()

  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [searchText, setSearchText] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  // 展开的题目分组（展开后逐行查看每个学生的答题内容与打分依据）
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  // 行级展开：打分依据默认一行省略，点击展开全部；答题内容默认 3 行
  const [expandedReasoning, setExpandedReasoning] = useState<Set<string>>(new Set())
  const [expandedAnswer, setExpandedAnswer] = useState<Set<string>>(new Set())
  // 图片原图查看（lightbox）
  const [lightboxImage, setLightboxImage] = useState<string | null>(null)
  // 分页（记录超过 PAGE_SIZE 条自动分页）
  const [currentPage, setCurrentPage] = useState(1)
  // 导出面板：按题目勾选导出范围（勾选题目 = 选中该题全部学生记录），默认全选
  const [showExportPanel, setShowExportPanel] = useState(false)
  const [selectedQuestions, setSelectedQuestions] = useState<Set<string>>(new Set())
  const [exporting, setExporting] = useState(false)

  const filteredRecords = useMemo(() => {
    let result = getFilteredRecords()
    if (searchText) {
      const search = searchText.toLowerCase()
      result = result.filter(r =>
        (r.studentName?.toLowerCase() ?? '').includes(search) ||
        (r.studentId?.toLowerCase() ?? '').includes(search) ||
        (r.standardName?.toLowerCase() ?? '').includes(search) ||
        (r.questionNumber?.toLowerCase() ?? '').includes(search)
      )
    }
    return result
  }, [records, filters, searchText, getFilteredRecords])

  // 筛选或数据变化时回到第一页
  useEffect(() => {
    setCurrentPage(1)
  }, [filters, searchText, records.length])

  // 分页：当前页的记录
  const totalPages = Math.max(1, Math.ceil(filteredRecords.length / PAGE_SIZE))
  const safePage = Math.min(currentPage, totalPages)
  const pagedRecords = useMemo(
    () => filteredRecords.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [filteredRecords, safePage]
  )

  // 当前筛选结果涉及的题目列表（导出面板用）
  const exportQuestionList = useMemo(() => {
    const map = new Map<string, { name: string; count: number }>()
    filteredRecords.forEach(r => {
      const key = groupKeyOf(r)
      const item = map.get(key) || { name: key, count: 0 }
      item.count++
      map.set(key, item)
    })
    return Array.from(map.entries()).map(([key, v]) => ({ key, ...v }))
  }, [filteredRecords])

  // 打开导出面板时默认全选所有题目
  const openExportPanel = () => {
    setSelectedQuestions(new Set(exportQuestionList.map(q => q.key)))
    setShowExportPanel(true)
  }

  const toggleExportQuestion = (key: string) => {
    setSelectedQuestions(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const isAllQuestionsSelected =
    exportQuestionList.length > 0 && exportQuestionList.every(q => selectedQuestions.has(q.key))

  const toggleAllQuestions = () => {
    if (isAllQuestionsSelected) setSelectedQuestions(new Set())
    else setSelectedQuestions(new Set(exportQuestionList.map(q => q.key)))
  }

  /** 按勾选的题目取导出记录 */
  const getExportRecords = () => {
    const selected = new Set(selectedQuestions)
    return filteredRecords.filter(r => selected.has(groupKeyOf(r)))
  }

  const statistics = getStatistics()

  // 获取唯一的题号列表
  const questionNumbers = useMemo(() => {
    const nums = new Set(records.map(r => r.questionNumber).filter(Boolean))
    return Array.from(nums) as string[]
  }, [records])

  // 按题目分组（仅当前页），每组带该题的平均分
  const groupedRecords = useMemo(() => {
    const groups: Record<string, typeof pagedRecords> = {}
    pagedRecords.forEach(record => {
      const key = groupKeyOf(record)
      if (!groups[key]) groups[key] = []
      groups[key].push(record)
    })
    return Object.entries(groups).map(([name, list]) => {
      const scores = list.filter(r => r.status === 'completed').map(r => r.score)
      const avgScore = scores.length > 0
        ? scores.reduce((sum, s) => sum + s, 0) / scores.length
        : 0
      return { name, records: list, count: list.length, avgScore }
    })
  }, [pagedRecords])

  // 选择记录
  const handleSelect = (id: string) => {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    )
  }

  // 全选/取消全选当前页（批量操作）
  const handleSelectPage = () => {
    const pageIds = pagedRecords.map(r => r.id)
    const allSelected = pageIds.length > 0 && pageIds.every(id => selectedIds.includes(id))
    if (allSelected) {
      setSelectedIds(prev => prev.filter(id => !pageIds.includes(id)))
    } else {
      setSelectedIds(prev => [...new Set([...prev, ...pageIds])])
    }
  }

  // 批量删除
  const handleBatchDelete = () => {
    if (selectedIds.length === 0) return
    playClick()
    if (confirm(`确定要删除选中的 ${selectedIds.length} 条记录吗？`)) {
      deleteRecords(selectedIds)
      setSelectedIds([])
      toast.success('已删除')
      playSuccess()
    }
  }

  // 展开收起题目分组
  const toggleGroup = (name: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  // 行级展开
  const toggleReasoning = (id: string) => {
    setExpandedReasoning(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAnswer = (id: string) => {
    setExpandedAnswer(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // 导出记录 - Excel（ExcelJS：逐行完整呈现，含题目原文、评分细则与嵌入的答题图片）
  const handleExportExcel = async () => {
    playClick()

    const recordsToExport = getExportRecords()
    if (recordsToExport.length === 0) {
      toast.error('请先勾选至少一个题目')
      return
    }

    setExporting(true)
    try {
      const standardById = new Map(standards.map(s => [s.id, s]))

      const wb = new ExcelJS.Workbook()
      const ws = wb.addWorksheet('批改记录', { views: [{ state: 'frozen', ySplit: 1 }] })
      ws.columns = [
        { header: '序号', key: 'index', width: 6 },
        { header: '题号', key: 'questionNumber', width: 12 },
        { header: '评分标准', key: 'standardName', width: 18 },
        { header: '题目原文', key: 'questionText', width: 42 },
        { header: '评分细则', key: 'scoringRules', width: 52 },
        { header: '学生', key: 'student', width: 14 },
        { header: '答题内容', key: 'answer', width: 50 },
        { header: '答题图片', key: 'image', width: 20 },
        { header: '得分', key: 'score', width: 8 },
        { header: '满分', key: 'maxScore', width: 8 },
        { header: '得分率', key: 'rate', width: 10 },
        { header: 'AI评分', key: 'aiScore', width: 9 },
        { header: '打分依据', key: 'reasoning', width: 60 },
        { header: 'AI点评', key: 'aiComment', width: 30 },
        { header: '批改模式', key: 'mode', width: 10 },
        { header: '状态', key: 'status', width: 8 },
        { header: '是否空白', key: 'blank', width: 9 },
        { header: '批改时间', key: 'time', width: 20 },
      ]
      ws.getRow(1).font = { bold: true }
      ws.getRow(1).height = 24

      for (let i = 0; i < recordsToExport.length; i++) {
        const record = recordsToExport[i]
        const standard = standardById.get(record.standardId)
        // 题目原文与评分细则：按 standardId 取当前标准；标准已删除则给出明确提示
        const questionText = standard?.question || '（评分标准已删除，未记录题目原文）'
        const rulesText = standard
          ? rulesToText(standard.scoringRules) || '（未填写评分细则）'
          : '（评分标准已删除，未记录评分细则）'

        const row = ws.addRow({
          index: i + 1,
          questionNumber: record.questionNumber || '',
          standardName: record.standardName || '',
          questionText,
          scoringRules: rulesText,
          student: record.studentName || record.studentId || '',
          answer: record.ocrText || '',
          image: record.answerImage ? '（见本行嵌入图片）' : '',
          score: record.score,
          maxScore: record.maxScore,
          rate: record.maxScore > 0 ? Math.round((record.score / record.maxScore) * 100) + '%' : '',
          aiScore: record.aiScore ?? '',
          reasoning: record.reasoning || '',
          aiComment: record.aiComment || '',
          mode: record.evaluationMode === 'ai' ? 'AI批改' : record.evaluationMode === 'manual' ? '手动评分' : '混合模式',
          status: record.status === 'completed' ? '已完成' : record.status === 'failed' ? '失败' : '待处理',
          blank: record.isBlank ? '是' : '否',
          time: record.completedAt
            ? dayjs(record.completedAt).format('YYYY-MM-DD HH:mm:ss')
            : dayjs(record.createdAt).format('YYYY-MM-DD HH:mm:ss'),
        })
        row.alignment = { vertical: 'top', wrapText: true }
        row.height = 90

        // 嵌入答题图片（第 8 列「答题图片」）
        const image = parseImageDataUrl(record.answerImage || '')
        if (image) {
          try {
            const imageId = wb.addImage({ base64: image.base64, extension: image.extension })
            ws.addImage(imageId, {
              tl: { col: 7, row: row.number - 1 },
              ext: { width: 120, height: 90 },
            })
          } catch {
            // 单张图片解析失败不阻断导出
          }
        }
      }

      const buffer = await wb.xlsx.writeBuffer()
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `批改记录_${dayjs().format('YYYYMMDD_HHmmss')}.xlsx`
      a.click()
      URL.revokeObjectURL(url)

      toast.success(`已导出 ${recordsToExport.length} 条记录（含题目原文、评分细则与答题图片）`)
      playSuccess()
    } catch (error) {
      console.error('Excel 导出失败:', error)
      toast.error('Excel 导出失败，请查看控制台')
    } finally {
      setExporting(false)
    }
  }

  // 导出记录 - PDF 格式
  const handleExportPDF = () => {
    playClick()

    const recordsToExport = getExportRecords()
    if (recordsToExport.length === 0) {
      toast.error('请先勾选至少一个题目')
      return
    }

    try {
      exportToPDF(recordsToExport, '批改记录报告')
      toast.success(`已导出 ${recordsToExport.length} 条记录为 PDF`)
      playSuccess()
    } catch (error) {
      console.error('PDF 导出失败:', error)
      toast.error('PDF 导出失败，请查看控制台')
    }
  }

  // 导出记录 - CSV 格式
  const handleExportCSV = () => {
    playClick()

    const recordsToExport = getExportRecords()
    if (recordsToExport.length === 0) {
      toast.error('请先勾选至少一个题目')
      return
    }

    try {
      exportToCSV(recordsToExport)
      toast.success(`已导出 ${recordsToExport.length} 条记录为 CSV`)
      playSuccess()
    } catch (error) {
      console.error('CSV 导出失败:', error)
      toast.error('CSV 导出失败，请查看控制台')
    }
  }

  // 处理导出格式选择
  const handleExport = (format: 'excel' | 'pdf' | 'csv') => {
    if (selectedQuestions.size === 0) {
      toast.error('请先勾选至少一个题目')
      return
    }
    setShowExportPanel(false)

    switch (format) {
      case 'excel':
        handleExportExcel()
        break
      case 'pdf':
        handleExportPDF()
        break
      case 'csv':
        handleExportCSV()
        break
    }
  }

  // 状态图标
  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle size={16} className="text-success" />
      case 'failed':
        return <XCircle size={16} className="text-error" />
      default:
        return <Clock size={16} className="text-warning" />
    }
  }

  // 评价模式标签
  const getModeLabel = (mode: string) => {
    switch (mode) {
      case 'ai':
        return <span className="mode-tag mode-tag--ai">AI批改</span>
      case 'manual':
        return <span className="mode-tag mode-tag--manual">手动评分</span>
      default:
        return <span className="mode-tag mode-tag--hybrid">混合模式</span>
    }
  }

  return (
    <div className="records-page">
      <div className="records-page__header">
        <div>
          <h1 className="records-page__title">批改记录</h1>
          <p className="records-page__subtitle">查看和管理所有批改记录</p>
        </div>
        <div className="records-page__actions">
          {/* 导出按钮：打开按题目勾选的导出面板 */}
          <button
            className="btn btn--secondary"
            onClick={openExportPanel}
            disabled={filteredRecords.length === 0}
          >
            <Download size={18} />
            导出
          </button>
        </div>
      </div>

      {/* 统计卡片（各题平均分展示在对应题目分组头部） */}
      <div className="records-page__stats">
        <div className="stat-card">
          <div className="stat-card__value">{statistics.total}</div>
          <div className="stat-card__label">总记录</div>
        </div>
        <div className="stat-card stat-card--success">
          <div className="stat-card__value">{statistics.completed}</div>
          <div className="stat-card__label">已完成</div>
        </div>
        <div className="stat-card stat-card--warning">
          <div className="stat-card__value">{statistics.pending}</div>
          <div className="stat-card__label">待处理</div>
        </div>
        <div className="stat-card stat-card--error">
          <div className="stat-card__value">{statistics.failed}</div>
          <div className="stat-card__label">失败</div>
        </div>
      </div>

      {/* 搜索和筛选 + 批量操作 */}
      <div className="records-page__toolbar">
        <div className="search-box">
          <Search size={18} />
          <input
            type="text"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="搜索学生姓名、学号或标准名称..."
          />
        </div>

        <button
          className={`btn btn--secondary ${showFilters ? 'btn--active' : ''}`}
          onClick={() => setShowFilters(!showFilters)}
        >
          <Filter size={18} />
          筛选
        </button>

        {/* 批量操作：全选/取消全选当前页 */}
        <button
          className="btn btn--secondary"
          onClick={handleSelectPage}
          disabled={pagedRecords.length === 0}
        >
          {pagedRecords.length > 0 && pagedRecords.every(r => selectedIds.includes(r.id)) ? (
            <><CheckSquare size={18} /> 取消全选本页</>
          ) : (
            <><Square size={18} /> 全选本页</>
          )}
        </button>

        {selectedIds.length > 0 && (
          <button className="btn btn--danger" onClick={handleBatchDelete}>
            <Trash2 size={18} />
            删除 ({selectedIds.length})
          </button>
        )}
      </div>

      {/* 筛选面板 */}
      {showFilters && (
        <motion.div
          className="records-page__filters"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
        >
          <div className="filter-group">
            <label><Hash size={14} /> 题号</label>
            <select
              value={filters.questionNumber || ''}
              onChange={(e) => setFilters({ questionNumber: e.target.value || undefined })}
            >
              <option value="">全部</option>
              {questionNumbers.map(num => (
                <option key={num} value={num}>{num}</option>
              ))}
            </select>
          </div>

          <div className="filter-group">
            <label>评价模式</label>
            <select
              value={filters.evaluationMode || ''}
              onChange={(e) => setFilters({ evaluationMode: e.target.value as any || undefined })}
            >
              <option value="">全部</option>
              <option value="ai">AI批改</option>
              <option value="manual">手动评分</option>
              <option value="hybrid">混合模式</option>
            </select>
          </div>

          <div className="filter-group">
            <label>状态</label>
            <select
              value={filters.status || ''}
              onChange={(e) => setFilters({ status: e.target.value as any || undefined })}
            >
              <option value="">全部</option>
              <option value="completed">已完成</option>
              <option value="pending">待处理</option>
              <option value="failed">失败</option>
            </select>
          </div>

          <button className="btn btn--link" onClick={() => { clearFilters(); setSearchText(''); }}>
            清除筛选
          </button>
        </motion.div>
      )}

      {/* 记录列表 - 按题目分组，展开后逐行查看每位学生的答题内容、图片、分数与打分依据 */}
      <div className="records-page__groups">
        {groupedRecords.length === 0 ? (
          <div className="empty-row">
            <FileText size={32} />
            <p>暂无批改记录</p>
          </div>
        ) : (
          groupedRecords.map((group) => {
            const expanded = expandedGroups.has(group.name)
            return (
              <motion.div
                key={group.name}
                className={`record-group ${expanded ? 'record-group--expanded' : ''}`}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
              >
                {/* 组头：点击展开/收起 */}
                <div
                  className="record-group__header record-group__header--clickable"
                  onClick={() => toggleGroup(group.name)}
                  title={expanded ? '点击收起该题目' : '点击展开查看每个学生的答题内容'}
                >
                  <div className="record-group__title">
                    {expanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                    <FolderOpen size={16} />
                    <h3>{group.name}</h3>
                  </div>
                  <div className="record-group__stats">
                    <span className="record-group__count">{group.count} 条记录</span>
                    <span className="record-group__avg">
                      平均分: <strong>{group.avgScore.toFixed(1)}</strong>
                    </span>
                  </div>
                </div>

                {/* 展开后：每位学生一行——答题内容 | 图片 | 分数 | 打分依据 */}
                {expanded && (
                  <div className="record-group__table-wrapper">
                    <table className="records-table">
                      <thead>
                        <tr>
                          <th className="col-checkbox">
                            <input
                              type="checkbox"
                              checked={group.records.length > 0 && group.records.every(r => selectedIds.includes(r.id))}
                              onChange={() => {
                                const allSelected = group.records.every(r => selectedIds.includes(r.id))
                                if (allSelected) {
                                  setSelectedIds(prev => prev.filter(id => !group.records.some(r => r.id === id)))
                                } else {
                                  setSelectedIds(prev => [...new Set([...prev, ...group.records.map(r => r.id)])])
                                }
                              }}
                            />
                          </th>
                          <th className="col-student">学生</th>
                          <th className="col-answer">答题内容</th>
                          <th className="col-image">图片</th>
                          <th className="col-score">分数</th>
                          <th className="col-reasoning">打分依据</th>
                          <th className="col-date">时间</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.records.map((record) => {
                          const reasonExpanded = expandedReasoning.has(record.id)
                          const answerExpanded = expandedAnswer.has(record.id)
                          return (
                            <tr
                              key={record.id}
                              className={selectedIds.includes(record.id) ? 'selected' : ''}
                            >
                              <td className="col-checkbox">
                                <input
                                  type="checkbox"
                                  checked={selectedIds.includes(record.id)}
                                  onChange={() => handleSelect(record.id)}
                                />
                              </td>
                              <td className="col-student">
                                <div className="student-name">{record.studentName || record.studentId || '-'}</div>
                                <div className="cell-sub">
                                  {getModeLabel(record.evaluationMode)}
                                  {getStatusIcon(record.status)}
                                </div>
                              </td>
                              <td className="col-answer">
                                <div
                                  className={`clamp-text clamp-3 ${answerExpanded ? 'expanded' : ''}`}
                                  onClick={() => toggleAnswer(record.id)}
                                  title={answerExpanded ? '点击收起' : '点击展开全部'}
                                >
                                  {record.ocrText?.trim() || (record.isBlank ? '（空白卷）' : '（未记录作答内容）')}
                                </div>
                              </td>
                              <td className="col-image">
                                {record.answerImage ? (
                                  <button
                                    className="image-badge"
                                    onClick={() => setLightboxImage(record.answerImage)}
                                    title="点击查看原图"
                                  >
                                    <ImageIcon size={13} />
                                    图片
                                  </button>
                                ) : (
                                  <span className="cell-sub">无</span>
                                )}
                              </td>
                              <td className="col-score">
                                <span className={`score ${record.isBlank ? 'score--blank' : ''}`}>
                                  {record.score}/{record.maxScore}
                                </span>
                              </td>
                              <td className="col-reasoning">
                                <div
                                  className={`clamp-text clamp-one ${reasonExpanded ? 'expanded' : ''}`}
                                  onClick={() => toggleReasoning(record.id)}
                                  title={reasonExpanded ? '点击收起' : '点击展开全部'}
                                >
                                  {record.reasoning?.trim() || '未保存评分依据（旧版本记录）'}
                                </div>
                              </td>
                              <td className="col-date">
                                <Calendar size={13} />
                                {dayjs(record.createdAt).format('MM-DD HH:mm')}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </motion.div>
            )
          })
        )}
      </div>

      {/* 分页控件：记录超过 10 条自动分页 */}
      {totalPages > 1 && (
        <div className="records-page__pagination">
          <button
            className="pagination-btn"
            disabled={safePage <= 1}
            onClick={() => setCurrentPage(safePage - 1)}
          >
            <ChevronLeft size={16} />
            上一页
          </button>
          <span className="pagination-info">
            第 <strong>{safePage}</strong> / {totalPages} 页 · 共 {filteredRecords.length} 条 · 每页 {PAGE_SIZE} 条
          </span>
          <button
            className="pagination-btn"
            disabled={safePage >= totalPages}
            onClick={() => setCurrentPage(safePage + 1)}
          >
            下一页
            <ChevronRightEnd size={16} />
          </button>
        </div>
      )}

      {/* 导出面板：按题目勾选导出范围 */}
      {showExportPanel && (
        <motion.div
          className="export-panel-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          onClick={() => setShowExportPanel(false)}
        >
          <motion.div
            className="export-panel"
            initial={{ scale: 0.95, y: 10 }}
            animate={{ scale: 1, y: 0 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="export-panel__head">
              <h3>选择要导出的题目</h3>
              <div className="export-panel__head-actions">
                <button className="btn btn--link" onClick={toggleAllQuestions}>
                  {isAllQuestionsSelected ? '取消全选' : '全选'}
                </button>
                <button className="btn-icon" onClick={() => setShowExportPanel(false)}>
                  <X size={16} />
                </button>
              </div>
            </div>

            <div className="export-panel__list">
              {exportQuestionList.length === 0 ? (
                <p className="export-panel__empty">当前筛选结果下没有可导出的题目</p>
              ) : (
                exportQuestionList.map((q) => (
                  <label key={q.key} className="export-panel__item">
                    <input
                      type="checkbox"
                      checked={selectedQuestions.has(q.key)}
                      onChange={() => toggleExportQuestion(q.key)}
                    />
                    <span className="export-panel__name">{q.name}</span>
                    <span className="export-panel__count">{q.count} 条记录</span>
                  </label>
                ))
              )}
            </div>

            <div className="export-panel__actions">
              <button
                className="btn btn--primary"
                disabled={exporting || selectedQuestions.size === 0}
                onClick={() => handleExport('excel')}
              >
                <FileSpreadsheet size={16} />
                导出 Excel（含答题图片）
              </button>
              <button
                className="btn btn--secondary"
                disabled={exporting || selectedQuestions.size === 0}
                onClick={() => handleExport('pdf')}
              >
                <FilePDF size={16} />
                导出 PDF
              </button>
              <button
                className="btn btn--secondary"
                disabled={exporting || selectedQuestions.size === 0}
                onClick={() => handleExport('csv')}
              >
                <FileJson size={16} />
                导出 CSV
              </button>
            </div>

            <p className="export-panel__hint">
              勾选题目 = 选中该题下所有学生的作答记录。Excel 将逐行完整包含：题目原文、评分细则、作答内容、答题图片、分数与打分依据。
            </p>
          </motion.div>
        </motion.div>
      )}

      {/* 图片原图查看 */}
      {lightboxImage && (
        <div className="image-lightbox" onClick={() => setLightboxImage(null)}>
          <img src={lightboxImage} alt="答题原图" />
        </div>
      )}
    </div>
  )
}
