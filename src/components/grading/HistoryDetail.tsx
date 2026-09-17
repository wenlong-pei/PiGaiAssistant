/**
 * 历史详情组件
 * 显示完整的批改信息，使用 MUI Stepper 展示批改流程
 */

import { useState, useEffect } from 'react'
import {
  Box,
  Typography,
  Paper,
  Grid,
  Chip,
  Divider,
  Stepper,
  Step,
  StepLabel,
  StepContent,
  Card,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Alert,
} from '@mui/material'
import {
  CheckCircle as SuccessIcon,
  Error as ErrorIcon,
  Timer as TimerIcon,
  Description as CriteriaIcon,
  SmartToy as AIIcon,
  Edit as CorrectionIcon,
} from '@mui/icons-material'
import type { GradingHistory, GradingStandard, ScoringRule } from '@/types'
import './HistoryDetail.scss'

interface HistoryDetailProps {
  history: GradingHistory
}

export default function HistoryDetail({ history }: HistoryDetailProps) {
  // 解析 JSON 数据
  const [criteria, setCriteria] = useState<GradingStandard | null>(null)
  const [aiDetail, setAiDetail] = useState<any>(null)
  const [corrections, setCorrections] = useState<any[]>([])

  useEffect(() => {
    try {
      // 解析评分标准快照
      if (history.criteriaSnapshot) {
        setCriteria(JSON.parse(history.criteriaSnapshot))
      }

      // 解析 AI 评分详情
      if (history.aiScoreDetail) {
        setAiDetail(JSON.parse(history.aiScoreDetail))
      }

      // 解析纠错记录
      if (history.correctionRecords) {
        setCorrections(JSON.parse(history.correctionRecords))
      }
    } catch (error) {
      console.error('[HistoryDetail] 解析数据失败:', error)
    }
  }, [history])

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
      second: '2-digit',
    })
  }

  /**
   * 格式化耗时
   */
  const formatTime = (ms: number) => {
    if (ms < 1000) return `${ms}毫秒`
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}秒`
    const minutes = Math.floor(ms / 60000)
    const seconds = ((ms % 60000) / 1000).toFixed(0)
    return `${minutes}分${seconds}秒`
  }

  /**
   * 计算得分率
   */
  const getScoreRate = () => {
    return ((history.finalScore / history.maxScore) * 100).toFixed(1)
  }

  /**
   * 获取评分步骤
   */
  const getSteps = () => {
    const steps = [
      {
        label: '开始批改',
        description: `批改时间: ${formatDate(history.createdAt)}`,
        icon: <TimerIcon />,
      },
    ]

    if (history.evaluationMode === 'ai' || history.evaluationMode === 'hybrid') {
      steps.push({
        label: 'AI 评分',
        description: aiDetail 
          ? `AI评分: ${aiDetail.aiScore || 'N/A'}分\n${aiDetail.aiComment || ''}`
          : 'AI评分已完成',
        icon: <AIIcon />,
      })
    }

    if (criteria) {
      steps.push({
        label: '应用评分标准',
        description: `评分标准: ${criteria.name}\n满分: ${criteria.totalScore}分`,
        icon: <CriteriaIcon />,
      })
    }

    if (corrections.length > 0) {
      steps.push({
        label: '人工纠错',
        description: `共 ${corrections.length} 处纠错`,
        icon: <CorrectionIcon />,
      })
    }

    steps.push({
      label: '完成批改',
      description: `最终分数: ${history.finalScore}分 (${getScoreRate()}%)\n耗时: ${formatTime(history.gradingTime)}`,
      icon: history.status === 'completed' ? <SuccessIcon /> : <ErrorIcon />,
    })

    return steps
  }

  return (
    <Box className="history-detail">
      {/* 基本信息卡片 */}
      <Paper className="info-card" elevation={1}>
        <Grid container spacing={2}>
          <Grid item xs={12} md={6}>
            <Typography variant="subtitle2" color="textSecondary">
              学生信息
            </Typography>
            <Typography variant="body1">
              {history.studentName || '未知学生'}
            </Typography>
            <Typography variant="caption" color="textSecondary">
              学生ID: {history.studentId}
            </Typography>
          </Grid>
          <Grid item xs={12} md={6}>
            <Typography variant="subtitle2" color="textSecondary">
              考试信息
            </Typography>
            <Typography variant="body1">
              考试ID: {history.examId}
            </Typography>
          </Grid>
          <Grid item xs={12} md={6}>
            <Typography variant="subtitle2" color="textSecondary">
              评分标准
            </Typography>
            <Typography variant="body1">
              {history.standardName}
            </Typography>
          </Grid>
          <Grid item xs={12} md={6}>
            <Typography variant="subtitle2" color="textSecondary">
              批改模式
            </Typography>
            <Chip 
              label={
                history.evaluationMode === 'ai' ? 'AI批改' :
                history.evaluationMode === 'manual' ? '人工批改' : '混合批改'
              }
              color={
                history.evaluationMode === 'ai' ? 'primary' :
                history.evaluationMode === 'manual' ? 'secondary' : 'default'
              }
              size="small"
            />
          </Grid>
        </Grid>
      </Paper>

      {/* 分数展示 */}
      <Paper className="score-card" elevation={1}>
        <Grid container spacing={3} alignItems="center">
          <Grid item xs={12} md={4}>
            <Box className="score-display">
              <Typography variant="h2" color="primary" sx={{ fontWeight: 'bold' }}>
                {history.finalScore}
              </Typography>
              <Typography variant="subtitle1" color="textSecondary">
                / {history.maxScore} 分
              </Typography>
            </Box>
          </Grid>
          <Grid item xs={12} md={8}>
            <Box className="score-details">
              <Typography variant="body1">
                得分率: <strong>{getScoreRate()}%</strong>
              </Typography>
              <Typography variant="body1">
                批改耗时: <strong>{formatTime(history.gradingTime)}</strong>
              </Typography>
              <Typography variant="body1">
                状态: 
                <Chip 
                  label={history.status === 'completed' ? '已完成' : '失败'}
                  color={history.status === 'completed' ? 'success' : 'error'}
                  size="small"
                  sx={{ ml: 1 }}
                />
              </Typography>
            </Box>
          </Grid>
        </Grid>
      </Paper>

      {/* 批改流程 Stepper */}
      <Paper className="stepper-card" elevation={1}>
        <Typography variant="h6" gutterBottom>
          批改流程
        </Typography>
        <Stepper orientation="vertical">
          {getSteps().map((step, index) => (
            <Step key={index} active={true} completed={index < getSteps().length - 1}>
              <StepLabel icon={step.icon}>
                {step.label}
              </StepLabel>
              <StepContent>
                <Typography 
                  variant="body2" 
                  color="textSecondary"
                  style={{ whiteSpace: 'pre-wrap' }}
                >
                  {step.description}
                </Typography>
              </StepContent>
            </Step>
          ))}
        </Stepper>
      </Paper>

      {/* 评分标准详情 */}
      {criteria && (
        <Paper className="criteria-card" elevation={1}>
          <Typography variant="h6" gutterBottom>
            评分标准详情
          </Typography>
          <Divider sx={{ mb: 2 }} />
          
          <Typography variant="subtitle2" color="textSecondary" gutterBottom>
            题目信息
          </Typography>
          <Typography variant="body2" component="p">
            {criteria.question || '无'}
          </Typography>

          <Typography variant="subtitle2" color="textSecondary" gutterBottom>
            参考答案
          </Typography>
          <Typography variant="body2" component="p">
            {criteria.referenceAnswer || '无'}
          </Typography>

          <Typography variant="subtitle2" color="textSecondary" gutterBottom>
            评分规则
          </Typography>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>规则描述</TableCell>
                  <TableCell align="right">分值</TableCell>
                  <TableCell>类型</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {/* 评分细则兼容两种形态：新的自由文本 / 历史的分点数组 */}
                {Array.isArray(criteria.scoringRules) ? (
                  criteria.scoringRules.map((rule: ScoringRule) => (
                    <TableRow key={rule.id}>
                      <TableCell>{rule.description}</TableCell>
                      <TableCell align="right">
                        {rule.type === 'negative' ? '-' : '+'}{Math.abs(rule.score)}
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={rule.type === 'positive' ? '加分' : '扣分'}
                          size="small"
                          color={rule.type === 'positive' ? 'success' : 'warning'}
                        />
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={3}>
                      <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                        {criteria.scoringRules || '（无）'}
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>

        </Paper>
      )}

      {/* AI 评分详情 */}
      {aiDetail && (
        <Paper className="ai-detail-card" elevation={1}>
          <Typography variant="h6" gutterBottom>
            AI 评分详情
          </Typography>
          <Divider sx={{ mb: 2 }} />
          
          <Grid container spacing={2}>
            <Grid item xs={12} md={6}>
              <Typography variant="subtitle2" color="textSecondary">
                AI 评分
              </Typography>
              <Typography variant="h4" color="primary">
                {aiDetail.aiScore || 'N/A'}
              </Typography>
            </Grid>
            <Grid item xs={12}>
              <Typography variant="subtitle2" color="textSecondary">
                AI 评语
              </Typography>
              <Alert severity="info" sx={{ mt: 1 }}>
                {aiDetail.aiComment || '无'}
              </Alert>
            </Grid>
            {aiDetail.reasoning && (
              <Grid item xs={12}>
                <Typography variant="subtitle2" color="textSecondary">
                  AI 推理过程
                </Typography>
                <Typography variant="body2" style={{ whiteSpace: 'pre-wrap' }}>
                  {aiDetail.reasoning}
                </Typography>
              </Grid>
            )}
          </Grid>
        </Paper>
      )}

      {/* 纠错记录 */}
      {corrections.length > 0 && (
        <Paper className="corrections-card" elevation={1}>
          <Typography variant="h6" gutterBottom>
            纠错记录
          </Typography>
          <Divider sx={{ mb: 2 }} />
          
          {corrections.map((correction, index) => (
            <Card key={index} className="correction-item" variant="outlined">
              <CardContent>
                <Grid container spacing={2}>
                  <Grid item xs={12} md={4}>
                    <Typography variant="subtitle2" color="textSecondary">
                      纠错类型
                    </Typography>
                    <Chip 
                      label={correction.type || '未知'} 
                      size="small"
                      color={
                        correction.type === 'score_adjust' ? 'primary' :
                        correction.type === 'comment_edit' ? 'secondary' : 'default'
                      }
                    />
                  </Grid>
                  <Grid item xs={12} md={4}>
                    <Typography variant="subtitle2" color="textSecondary">
                      原始值
                    </Typography>
                    <Typography variant="body2">
                      {correction.originalValue || 'N/A'}
                    </Typography>
                  </Grid>
                  <Grid item xs={12} md={4}>
                    <Typography variant="subtitle2" color="textSecondary">
                      修正值
                    </Typography>
                    <Typography variant="body2" color="primary">
                      {correction.correctedValue || 'N/A'}
                    </Typography>
                  </Grid>
                  {correction.reason && (
                    <Grid item xs={12}>
                      <Typography variant="subtitle2" color="textSecondary">
                        纠错原因
                      </Typography>
                      <Typography variant="body2">
                        {correction.reason}
                      </Typography>
                    </Grid>
                  )}
                </Grid>
              </CardContent>
            </Card>
          ))}
        </Paper>
      )}

      {/* 时间信息 */}
      <Paper className="time-card" elevation={1}>
        <Grid container spacing={2}>
          <Grid item xs={12} md={6}>
            <Typography variant="subtitle2" color="textSecondary">
              创建时间
            </Typography>
            <Typography variant="body2">
              {formatDate(history.createdAt)}
            </Typography>
          </Grid>
          {history.updatedAt && (
            <Grid item xs={12} md={6}>
              <Typography variant="subtitle2" color="textSecondary">
                更新时间
              </Typography>
              <Typography variant="body2">
                {formatDate(history.updatedAt)}
              </Typography>
            </Grid>
          )}
        </Grid>
      </Paper>
    </Box>
  )
}
