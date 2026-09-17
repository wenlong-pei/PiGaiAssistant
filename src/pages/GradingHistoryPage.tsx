/**
 * 批改历史记录页面
 * 显示历史记录列表，支持筛选、分页、查看详情和对比
 */

import { useEffect, useState } from 'react'
import {
  Box,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Button,
  IconButton,
  Tooltip,
  Chip,
  TextField,
  MenuItem,
  Select,
  FormControl,
  InputLabel,
  Grid,
  Pagination,
  Stack,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Checkbox,
  Alert,
  Snackbar,
  CircularProgress,
} from '@mui/material'
import {
  Delete as DeleteIcon,
  Visibility as ViewIcon,
  CompareArrows as CompareIcon,
  Refresh as RefreshIcon,
  FilterList as FilterIcon,
  Clear as ClearIcon,
} from '@mui/icons-material'
import { useGradingHistoryStore, useInitGradingHistory } from '@/store/gradingHistoryStore'
import type { GradingHistory, GradingHistoryFilter } from '@/types'
import HistoryDetail from '@/components/grading/HistoryDetail'
import HistoryCompare from '@/components/grading/HistoryCompare'
import './GradingHistoryPage.scss'

export default function GradingHistoryPage() {
  // 初始化数据库和数据
  const initialize = useInitGradingHistory()
  
  // Store 状态
  const {
    histories,
    totalCount,
    currentPage,
    pageSize,
    totalPages,
    filter,
    isLoading,
    error,
    statistics,
    compareHistoryIds,
    fetchHistories,
    setFilter,
    clearFilter,
    setPage,
    setPageSize,
    deleteHistory,
    deleteHistories,
    toggleCompare,
    fetchStatistics,
  } = useGradingHistoryStore()

  // 本地状态
  const [selectedHistory, setSelectedHistory] = useState<GradingHistory | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [compareOpen, setCompareOpen] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [showFilter, setShowFilter] = useState(false)
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({
    open: false,
    message: '',
    severity: 'success',
  })

  // 初始化
  useEffect(() => {
    // 失败原因已由 store.error 承载，并经下方「错误提示」Snackbar 展示给用户；
    // 这里仅补 catch，避免 initialize() 的拒绝成为未处理的 promise 拒绝。
    initialize().catch(() => { /* 见上：错误已通过 store.error → Snackbar 呈现 */ })
  }, [])

  // 获取统计信息
  useEffect(() => {
    fetchStatistics()
  }, [filter])

  /**
   * 处理查看详情
   */
  const handleViewDetail = async (history: GradingHistory) => {
    setSelectedHistory(history)
    setDetailOpen(true)
  }

  /**
   * 处理删除
   */
  const handleDelete = (id: string) => {
    setDeleteTargetId(id)
    setDeleteConfirmOpen(true)
  }

  /**
   * 确认删除
   */
  const confirmDelete = async () => {
    try {
      if (deleteTargetId) {
        await deleteHistory(deleteTargetId)
        showSnackbar('删除成功', 'success')
      } else if (selectedIds.length > 0) {
        await deleteHistories(selectedIds)
        setSelectedIds([])
        showSnackbar(`已删除 ${selectedIds.length} 条记录`, 'success')
      }
    } catch (error: any) {
      showSnackbar(error.message || '删除失败', 'error')
    } finally {
      setDeleteConfirmOpen(false)
      setDeleteTargetId(null)
    }
  }

  /**
   * 处理对比
   */
  const handleCompare = () => {
    if (compareHistoryIds.length === 2) {
      setCompareOpen(true)
    } else {
      showSnackbar('请选择两条记录进行对比', 'error')
    }
  }

  /**
   * 处理筛选
   */
  const handleFilterChange = (key: keyof GradingHistoryFilter, value: any) => {
    setFilter({ [key]: value })
  }

  /**
   * 显示提示消息
   */
  const showSnackbar = (message: string, severity: 'success' | 'error') => {
    setSnackbar({ open: true, message, severity })
  }

  /**
   * 格式化日期
   */
  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  /**
   * 格式化耗时
   */
  const formatTime = (ms: number) => {
    if (ms < 1000) return `${ms}ms`
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}秒`
    return `${(ms / 60000).toFixed(1)}分钟`
  }

  /**
   * 获取状态 Chip 颜色
   */
  const getStatusColor = (status: string) => {
    return status === 'completed' ? 'success' : 'error'
  }

  /**
   * 获取批改模式文本
   */
  const getModeText = (mode: string) => {
    const map: Record<string, string> = {
      ai: 'AI批改',
      manual: '人工批改',
      hybrid: '混合批改',
    }
    return map[mode] || mode
  }

  return (
    <Box className="grading-history-page">
      {/* 页面标题 */}
      <Box className="page-header">
        <Typography variant="h4" component="h1">
          批改历史记录
        </Typography>
        <Stack direction="row" spacing={1}>
          <Tooltip title="刷新">
            <IconButton onClick={() => fetchHistories()} disabled={isLoading}>
              <RefreshIcon />
            </IconButton>
          </Tooltip>
          <Tooltip title="筛选">
            <IconButton 
              onClick={() => setShowFilter(!showFilter)}
              color={showFilter ? 'primary' : 'default'}
            >
              <FilterIcon />
            </IconButton>
          </Tooltip>
        </Stack>
      </Box>

      {/* 统计信息 */}
      {statistics && (
        <Paper className="statistics-panel" elevation={1}>
          <Grid container spacing={2}>
            <Grid item xs={6} sm={3}>
              <Typography variant="subtitle2" color="textSecondary">
                总记录数
              </Typography>
              <Typography variant="h6">{statistics.total}</Typography>
            </Grid>
            <Grid item xs={6} sm={3}>
              <Typography variant="subtitle2" color="textSecondary">
                完成数
              </Typography>
              <Typography variant="h6" color="success.main">
                {statistics.completed}
              </Typography>
            </Grid>
            <Grid item xs={6} sm={3}>
              <Typography variant="subtitle2" color="textSecondary">
                平均分数
              </Typography>
              <Typography variant="h6">
                {statistics.averageScore.toFixed(1)}
              </Typography>
            </Grid>
            <Grid item xs={6} sm={3}>
              <Typography variant="subtitle2" color="textSecondary">
                通过率
              </Typography>
              <Typography variant="h6" color="primary">
                {statistics.passRate.toFixed(1)}%
              </Typography>
            </Grid>
          </Grid>
        </Paper>
      )}

      {/* 筛选面板 */}
      {showFilter && (
        <Paper className="filter-panel" elevation={1}>
          <Grid container spacing={2} alignItems="center">
            <Grid item xs={12} sm={6} md={3}>
              <TextField
                fullWidth
                label="搜索"
                value={filter.searchText || ''}
                onChange={(e) => handleFilterChange('searchText', e.target.value)}
                placeholder="学生姓名、考试ID..."
                size="small"
              />
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <FormControl fullWidth size="small">
                <InputLabel>批改模式</InputLabel>
                <Select
                  value={filter.evaluationMode || ''}
                  onChange={(e) => handleFilterChange('evaluationMode', e.target.value || undefined)}
                  label="批改模式"
                >
                  <MenuItem value="">全部</MenuItem>
                  <MenuItem value="ai">AI批改</MenuItem>
                  <MenuItem value="manual">人工批改</MenuItem>
                  <MenuItem value="hybrid">混合批改</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <FormControl fullWidth size="small">
                <InputLabel>状态</InputLabel>
                <Select
                  value={filter.status || ''}
                  onChange={(e) => handleFilterChange('status', e.target.value || undefined)}
                  label="状态"
                >
                  <MenuItem value="">全部</MenuItem>
                  <MenuItem value="completed">已完成</MenuItem>
                  <MenuItem value="failed">失败</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <Button
                fullWidth
                variant="outlined"
                startIcon={<ClearIcon />}
                onClick={() => {
                  clearFilter()
                  setShowFilter(false)
                }}
              >
                清除筛选
              </Button>
            </Grid>
          </Grid>
        </Paper>
      )}

      {/* 操作栏 */}
      <Box className="action-bar">
        <Stack direction="row" spacing={1}>
          {selectedIds.length > 0 && (
            <Button
              variant="contained"
              color="error"
              startIcon={<DeleteIcon />}
              onClick={() => setDeleteConfirmOpen(true)}
            >
              删除选中 ({selectedIds.length})
            </Button>
          )}
          {compareHistoryIds.length === 2 && (
            <Button
              variant="contained"
              color="primary"
              startIcon={<CompareIcon />}
              onClick={handleCompare}
            >
              对比记录
            </Button>
          )}
        </Stack>

        <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
          <FormControl size="small">
            <InputLabel>每页</InputLabel>
            <Select
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
              label="每页"
            >
              <MenuItem value={10}>10</MenuItem>
              <MenuItem value={20}>20</MenuItem>
              <MenuItem value={50}>50</MenuItem>
              <MenuItem value={100}>100</MenuItem>
            </Select>
          </FormControl>
          <Typography variant="body2" color="textSecondary">
            共 {totalCount} 条记录
          </Typography>
        </Stack>
      </Box>

      {/* 数据表格 */}
      {isLoading ? (
        <Box className="loading-container">
          <CircularProgress />
          <Typography>加载中...</Typography>
        </Box>
      ) : histories.length === 0 ? (
        <Paper className="empty-container" elevation={1}>
          <Typography variant="h6" color="textSecondary">
            暂无历史记录
          </Typography>
          <Typography variant="body2" color="textSecondary">
            完成批改后，记录将自动保存在此处
          </Typography>
        </Paper>
      ) : (
        <TableContainer component={Paper} elevation={1}>
          <Table className="history-table">
            <TableHead>
              <TableRow>
                <TableCell padding="checkbox">
                  <Checkbox
                    indeterminate={selectedIds.length > 0 && selectedIds.length < histories.length}
                    checked={selectedIds.length === histories.length}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedIds(histories.map((h) => h.id))
                      } else {
                        setSelectedIds([])
                      }
                    }}
                  />
                </TableCell>
                <TableCell>时间</TableCell>
                <TableCell>学生</TableCell>
                <TableCell>评分标准</TableCell>
                <TableCell align="right">分数</TableCell>
                <TableCell align="center">批改模式</TableCell>
                <TableCell align="center">状态</TableCell>
                <TableCell align="right">耗时</TableCell>
                <TableCell align="center">操作</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {histories.map((history) => (
                <TableRow 
                  key={history.id}
                  className={compareHistoryIds.includes(history.id) ? 'compare-selected' : ''}
                >
                  <TableCell padding="checkbox">
                    <Checkbox
                      checked={selectedIds.includes(history.id)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedIds([...selectedIds, history.id])
                        } else {
                          setSelectedIds(selectedIds.filter((id) => id !== history.id))
                        }
                      }}
                    />
                  </TableCell>
                  <TableCell>{formatDate(history.createdAt)}</TableCell>
                  <TableCell>
                    <Typography variant="body2">
                      {history.studentName || '未知'}
                    </Typography>
                    <Typography variant="caption" color="textSecondary">
                      ID: {history.studentId}
                    </Typography>
                  </TableCell>
                  <TableCell>{history.standardName}</TableCell>
                  <TableCell align="right">
                    <Typography
                      variant="body2"
                      sx={{ fontWeight: 'bold' }}
                      color={history.finalScore >= history.maxScore * 0.6 ? 'success.main' : 'error.main'}
                    >
                      {history.finalScore} / {history.maxScore}
                    </Typography>
                  </TableCell>
                  <TableCell align="center">
                    <Chip 
                      label={getModeText(history.evaluationMode)} 
                      size="small"
                      variant="outlined"
                    />
                  </TableCell>
                  <TableCell align="center">
                    <Chip 
                      label={history.status === 'completed' ? '已完成' : '失败'}
                      color={getStatusColor(history.status)}
                      size="small"
                    />
                  </TableCell>
                  <TableCell align="right">
                    {formatTime(history.gradingTime)}
                  </TableCell>
                  <TableCell align="center">
                    <Stack direction="row" spacing={0.5} sx={{ justifyContent: 'center' }}>
                      <Tooltip title="查看详情">
                        <IconButton 
                          size="small" 
                          onClick={() => handleViewDetail(history)}
                        >
                          <ViewIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="对比">
                        <IconButton 
                          size="small" 
                          onClick={() => toggleCompare(history.id)}
                          color={compareHistoryIds.includes(history.id) ? 'primary' : 'default'}
                        >
                          <CompareIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="删除">
                        <IconButton 
                          size="small" 
                          color="error"
                          onClick={() => handleDelete(history.id)}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Stack>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* 分页 */}
      {totalPages > 1 && (
        <Box className="pagination-container">
          <Pagination
            count={totalPages}
            page={currentPage}
            onChange={(_, page) => setPage(page)}
            color="primary"
            showFirstButton
            showLastButton
          />
        </Box>
      )}

      {/* 详情对话框 */}
      <Dialog 
        open={detailOpen} 
        onClose={() => setDetailOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>批改详情</DialogTitle>
        <DialogContent>
          {selectedHistory && <HistoryDetail history={selectedHistory} />}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDetailOpen(false)}>关闭</Button>
        </DialogActions>
      </Dialog>

      {/* 对比对话框 */}
      <Dialog 
        open={compareOpen} 
        onClose={() => setCompareOpen(false)}
        maxWidth="lg"
        fullWidth
      >
        <DialogTitle>历史对比</DialogTitle>
        <DialogContent>
          <HistoryCompare />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCompareOpen(false)}>关闭</Button>
        </DialogActions>
      </Dialog>

      {/* 删除确认对话框 */}
      <Dialog open={deleteConfirmOpen} onClose={() => setDeleteConfirmOpen(false)}>
        <DialogTitle>确认删除</DialogTitle>
        <DialogContent>
          <Typography>
            确定要删除选中的历史记录吗？此操作不可恢复。
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteConfirmOpen(false)}>取消</Button>
          <Button onClick={confirmDelete} color="error" variant="contained">
            删除
          </Button>
        </DialogActions>
      </Dialog>

      {/* 错误提示 */}
      <Snackbar
        open={!!error}
        autoHideDuration={6000}
        onClose={() => useGradingHistoryStore.getState().clearError()}
      >
        <Alert 
          severity="error" 
          onClose={() => useGradingHistoryStore.getState().clearError()}
        >
          {error}
        </Alert>
      </Snackbar>

      {/* 操作提示 */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={3000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
      >
        <Alert 
          severity={snackbar.severity}
          onClose={() => setSnackbar({ ...snackbar, open: false })}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  )
}
