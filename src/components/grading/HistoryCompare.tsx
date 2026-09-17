/**
 * 历史对比组件
 * 并排显示两次批改的对比结果，高亮显示分数差异
 */

import { useState, useEffect } from 'react'
import {
  Box,
  Typography,
  Paper,
  Grid,
  Card,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  Divider,
  Alert,
  CircularProgress,
} from '@mui/material'
import {
  CompareArrows as CompareIcon,
  Score as ScoreIcon,
  Timer as TimerIcon,
  TrendingUp as ImproveIcon,
  TrendingDown as DeclineIcon,
} from '@mui/icons-material'
import { useGradingHistoryStore } from '@/store/gradingHistoryStore'
import type { GradingHistory, HistoryCompareResult } from '@/types'
import './HistoryCompare.scss'

export default function HistoryCompare() {
  // Store
  const {
    compareHistoryIds,
    getCompareResult,
  } = useGradingHistoryStore()

  // 本地状态
  const [history1, setHistory1] = useState<GradingHistory | null>(null)
  const [history2, setHistory2] = useState<GradingHistory | null>(null)
  const [compareResult, setCompareResult] = useState<HistoryCompareResult | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadCompareData()
  }, [compareHistoryIds])

  /**
   * 加载对比数据
   */
  const loadCompareData = async () => {
    if (compareHistoryIds.length !== 2) {
      setError('请选择两条历史记录进行对比')
      setIsLoading(false)
      return
    }

    try {
      setIsLoading(true)
      setError(null)

      // 获取两条历史记录
      const h1 = await useGradingHistoryStore.getState().getHistoryById(compareHistoryIds[0])
      const h2 = await useGradingHistoryStore.getState().getHistoryById(compareHistoryIds[1])

      if (!h1 || !h2) {
        setError('无法加载历史记录')
        setIsLoading(false)
        return
      }

      setHistory1(h1)
      setHistory2(h2)

      // 获取对比结果
      const result = await getCompareResult()
      setCompareResult(result)
    } catch (err: any) {
      setError(err.message || '加载对比数据失败')
    } finally {
      setIsLoading(false)
    }
  }

  /**
   * 格式化日期
   */
  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleString('zh-CN', {
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
   * 获取分数差异的颜色
   */
  const getScoreDiffColor = (diff: number) => {
    if (diff > 0) return 'success.main'
    if (diff < 0) return 'error.main'
    return 'text.primary'
  }

  /**
   * 获取分数差异的图标
   */
  const getScoreDiffIcon = (diff: number) => {
    if (diff > 0) return <ImproveIcon fontSize="small" />
    if (diff < 0) return <DeclineIcon fontSize="small" />
    return null
  }

  if (isLoading) {
    return (
      <Box className="compare-loading">
        <CircularProgress />
        <Typography>加载对比数据...</Typography>
      </Box>
    )
  }

  if (error) {
    return (
      <Alert severity="error" className="compare-error">
        {error}
      </Alert>
    )
  }

  if (!history1 || !history2) {
    return (
      <Alert severity="warning" className="compare-warning">
        请选择两条历史记录进行对比
      </Alert>
    )
  }

  return (
    <Box className="history-compare">
      {/* 对比标题 */}
      <Box className="compare-header">
        <CompareIcon className="compare-icon" />
        <Typography variant="h6">
          历史对比
        </Typography>
      </Box>

      {/* 对比结果概览 */}
      {compareResult && (
        <Paper className="compare-summary" elevation={1}>
          <Grid container spacing={2}>
            <Grid item xs={12} md={4}>
              <Box className="summary-item">
                <Typography variant="subtitle2" color="textSecondary">
                  分数差异
                </Typography>
                <Typography 
                  variant="h4" 
                  color={getScoreDiffColor(compareResult.scoreDiff)}
                  className="diff-value"
                >
                  {getScoreDiffIcon(compareResult.scoreDiff)}
                  {compareResult.scoreDiff > 0 ? '+' : ''}{compareResult.scoreDiff.toFixed(1)}
                </Typography>
              </Box>
            </Grid>
            <Grid item xs={12} md={4}>
              <Box className="summary-item">
                <Typography variant="subtitle2" color="textSecondary">
                  时间差异
                </Typography>
                <Typography variant="h6">
                  {formatTime(Math.abs(compareResult.timeDiff))}
                  {compareResult.timeDiff > 0 ? ' (更慢)' : ' (更快)'}
                </Typography>
              </Box>
            </Grid>
            <Grid item xs={12} md={4}>
              <Box className="summary-item">
                <Typography variant="subtitle2" color="textSecondary">
                  评分标准变化
                </Typography>
                <Typography variant="body2">
                  {compareResult.details.criteriaChanges.length > 0 
                    ? compareResult.details.criteriaChanges.join('; ') 
                    : '无变化'}
                </Typography>
              </Box>
            </Grid>
          </Grid>
        </Paper>
      )}

      {/* 并排对比 */}
      <Grid container spacing={2} className="compare-content">
        {/* 第一次批改 */}
        <Grid item xs={12} md={6}>
          <Card className="history-card" elevation={2}>
            <CardContent>
              <Typography variant="h6" gutterBottom className="history-title">
                <ScoreIcon sx={{ mr: 1 }} />
                第一次批改
              </Typography>
              <Typography variant="caption" color="textSecondary" sx={{ display: 'block' }} gutterBottom>
                {formatDate(history1.createdAt)}
              </Typography>

              <Divider sx={{ my: 2 }} />

              {/* 学生信息 */}
              <Box className="info-row">
                <Typography variant="subtitle2" color="textSecondary">
                  学生
                </Typography>
                <Typography variant="body1">
                  {history1.studentName || '未知'} ({history1.studentId})
                </Typography>
              </Box>

              {/* 分数 */}
              <Box className="info-row">
                <Typography variant="subtitle2" color="textSecondary">
                  分数
                </Typography>
                <Typography
                  variant="h4"
                  color="primary"
                  sx={{ fontWeight: 'bold' }}
                >
                  {history1.finalScore} / {history1.maxScore}
                </Typography>
                <Chip 
                  label={`${((history1.finalScore / history1.maxScore) * 100).toFixed(1)}%`}
                  color={history1.finalScore >= history1.maxScore * 0.6 ? 'success' : 'error'}
                  size="small"
                  sx={{ ml: 1 }}
                />
              </Box>

              {/* 批改模式 */}
              <Box className="info-row">
                <Typography variant="subtitle2" color="textSecondary">
                  批改模式
                </Typography>
                <Chip 
                  label={
                    history1.evaluationMode === 'ai' ? 'AI批改' :
                    history1.evaluationMode === 'manual' ? '人工批改' : '混合批改'
                  }
                  size="small"
                />
              </Box>

              {/* 耗时 */}
              <Box className="info-row">
                <Typography variant="subtitle2" color="textSecondary">
                  批改耗时
                </Typography>
                <Typography variant="body1">
                  <TimerIcon fontSize="small" sx={{ mr: 0.5, verticalAlign: 'middle' }} />
                  {formatTime(history1.gradingTime)}
                </Typography>
              </Box>

              {/* 状态 */}
              <Box className="info-row">
                <Typography variant="subtitle2" color="textSecondary">
                  状态
                </Typography>
                <Chip 
                  label={history1.status === 'completed' ? '已完成' : '失败'}
                  color={history1.status === 'completed' ? 'success' : 'error'}
                  size="small"
                />
              </Box>
            </CardContent>
          </Card>
        </Grid>

        {/* 第二次批改 */}
        <Grid item xs={12} md={6}>
          <Card className="history-card" elevation={2}>
            <CardContent>
              <Typography variant="h6" gutterBottom className="history-title">
                <ScoreIcon sx={{ mr: 1 }} />
                第二次批改
              </Typography>
              <Typography variant="caption" color="textSecondary" sx={{ display: 'block' }} gutterBottom>
                {formatDate(history2.createdAt)}
              </Typography>

              <Divider sx={{ my: 2 }} />

              {/* 学生信息 */}
              <Box className="info-row">
                <Typography variant="subtitle2" color="textSecondary">
                  学生
                </Typography>
                <Typography variant="body1">
                  {history2.studentName || '未知'} ({history2.studentId})
                </Typography>
              </Box>

              {/* 分数 */}
              <Box className="info-row">
                <Typography variant="subtitle2" color="textSecondary">
                  分数
                </Typography>
                <Typography
                  variant="h4"
                  color="primary"
                  sx={{ fontWeight: 'bold' }}
                >
                  {history2.finalScore} / {history2.maxScore}
                </Typography>
                <Chip 
                  label={`${((history2.finalScore / history2.maxScore) * 100).toFixed(1)}%`}
                  color={history2.finalScore >= history2.maxScore * 0.6 ? 'success' : 'error'}
                  size="small"
                  sx={{ ml: 1 }}
                />
              </Box>

              {/* 批改模式 */}
              <Box className="info-row">
                <Typography variant="subtitle2" color="textSecondary">
                  批改模式
                </Typography>
                <Chip 
                  label={
                    history2.evaluationMode === 'ai' ? 'AI批改' :
                    history2.evaluationMode === 'manual' ? '人工批改' : '混合批改'
                  }
                  size="small"
                />
              </Box>

              {/* 耗时 */}
              <Box className="info-row">
                <Typography variant="subtitle2" color="textSecondary">
                  批改耗时
                </Typography>
                <Typography variant="body1">
                  <TimerIcon fontSize="small" sx={{ mr: 0.5, verticalAlign: 'middle' }} />
                  {formatTime(history2.gradingTime)}
                </Typography>
              </Box>

              {/* 状态 */}
              <Box className="info-row">
                <Typography variant="subtitle2" color="textSecondary">
                  状态
                </Typography>
                <Chip 
                  label={history2.status === 'completed' ? '已完成' : '失败'}
                  color={history2.status === 'completed' ? 'success' : 'error'}
                  size="small"
                />
              </Box>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* 详细对比表格 */}
      <Paper className="compare-table-paper" elevation={1}>
        <Typography variant="h6" gutterBottom>
          详细对比
        </Typography>
        <TableContainer>
          <Table className="compare-table">
            <TableHead>
              <TableRow>
                <TableCell>对比项</TableCell>
                <TableCell align="center">第一次批改</TableCell>
                <TableCell align="center">第二次批改</TableCell>
                <TableCell align="center">差异</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              <TableRow>
                <TableCell>最终分数</TableCell>
                <TableCell align="center">{history1.finalScore}</TableCell>
                <TableCell align="center">{history2.finalScore}</TableCell>
                <TableCell 
                  align="center"
                  className={compareResult ? getScoreDiffColor(compareResult.scoreDiff).replace('.main', '') : ''}
                >
                  <strong>
                    {compareResult && (compareResult.scoreDiff > 0 ? '+' : '')}{compareResult?.scoreDiff.toFixed(1) || 'N/A'}
                  </strong>
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell>得分率</TableCell>
                <TableCell align="center">
                  {((history1.finalScore / history1.maxScore) * 100).toFixed(1)}%
                </TableCell>
                <TableCell align="center">
                  {((history2.finalScore / history2.maxScore) * 100).toFixed(1)}%
                </TableCell>
                <TableCell align="center">
                  {(((history2.finalScore / history2.maxScore) - (history1.finalScore / history1.maxScore)) * 100).toFixed(1)}%
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell>批改耗时</TableCell>
                <TableCell align="center">{formatTime(history1.gradingTime)}</TableCell>
                <TableCell align="center">{formatTime(history2.gradingTime)}</TableCell>
                <TableCell align="center">
                  {formatTime(Math.abs(history2.gradingTime - history1.gradingTime))}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell>批改模式</TableCell>
                <TableCell align="center">
                  <Chip 
                    label={
                      history1.evaluationMode === 'ai' ? 'AI' :
                      history1.evaluationMode === 'manual' ? '人工' : '混合'
                    }
                    size="small"
                  />
                </TableCell>
                <TableCell align="center">
                  <Chip 
                    label={
                      history2.evaluationMode === 'ai' ? 'AI' :
                      history2.evaluationMode === 'manual' ? '人工' : '混合'
                    }
                    size="small"
                  />
                </TableCell>
                <TableCell align="center">
                  {history1.evaluationMode === history2.evaluationMode ? '相同' : '不同'}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      {/* 对比说明 */}
      {compareResult && compareResult.details.scoreChanges.length > 0 && (
        <Alert severity="info" className="compare-notes">
          <Typography variant="subtitle2" gutterBottom>
            对比说明
          </Typography>
          {compareResult.details.scoreChanges.map((change, index) => (
            <Typography key={index} variant="body2">
              • {change}
            </Typography>
          ))}
        </Alert>
      )}
    </Box>
  )
}
