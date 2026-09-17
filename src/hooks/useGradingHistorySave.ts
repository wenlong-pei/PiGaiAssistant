/**
 * 批改历史记录保存 Hook
 * 提供保存批改历史记录的工具函数
 */

import { useCallback } from 'react'
import { useGradingHistoryStore } from '@/store/gradingHistoryStore'
import type { GradingHistory, GradingStandard } from '@/types'

/**
 * 保存批改历史记录的 Hook
 * 在批改完成后调用，自动保存历史记录
 */
export function useGradingHistorySave() {
  const saveHistory = useGradingHistoryStore((state) => state.saveHistory)

  /**
   * 保存批改历史记录
   * @param params 保存参数
   * @returns 保存的记录ID
   */
  const saveGradingHistory = useCallback(async (params: {
    examId: string                // 考试ID
    studentId: string             // 学生ID
    studentName?: string          // 学生姓名
    standardId: string           // 评分标准ID
    standardName: string          // 评分标准名称
    finalScore: number            // 最终分数
    maxScore: number              // 满分
    criteriaSnapshot: GradingStandard  // 评分标准快照
    aiScoreDetail?: any           // AI评分详情
    correctionRecords?: any[]     // 纠错记录
    gradingTime: number           // 批改耗时（毫秒）
    evaluationMode: 'ai' | 'manual' | 'hybrid'  // 批改模式
    status: 'completed' | 'failed'  // 状态
  }) => {
    try {
      const historyId = await saveHistory({
        examId: params.examId,
        studentId: params.studentId,
        studentName: params.studentName,
        standardId: params.standardId,
        standardName: params.standardName,
        finalScore: params.finalScore,
        maxScore: params.maxScore,
        criteriaSnapshot: JSON.stringify(params.criteriaSnapshot),
        aiScoreDetail: params.aiScoreDetail ? JSON.stringify(params.aiScoreDetail) : '',
        correctionRecords: params.correctionRecords ? JSON.stringify(params.correctionRecords) : '',
        gradingTime: params.gradingTime,
        evaluationMode: params.evaluationMode,
        status: params.status,
      })

      console.log(`[useGradingHistorySave] 历史记录保存成功: ${historyId}`)
      return historyId
    } catch (error: any) {
      console.error('[useGradingHistorySave] 保存历史记录失败:', error)
      throw error
    }
  }, [saveHistory])

  return {
    saveGradingHistory,
  }
}

/**
 * 从批改结果中提取历史记录数据
 * 工具函数，用于将现有的批改结果转换为历史记录格式
 */
export function extractHistoryFromGradingResult(result: {
  studentId: string
  studentName?: string
  examId: string
  standard: GradingStandard
  finalScore: number
  aiScore?: number
  aiComment?: string
  correctionRecords?: any[]
  gradingTime: number
  evaluationMode: 'ai' | 'manual' | 'hybrid'
  status: 'completed' | 'failed'
}): Omit<GradingHistory, 'id' | 'createdAt'> {
  return {
    examId: result.examId,
    studentId: result.studentId,
    studentName: result.studentName,
    standardId: result.standard.id,
    standardName: result.standard.name,
    finalScore: result.finalScore,
    maxScore: result.standard.totalScore,
    criteriaSnapshot: JSON.stringify(result.standard),
    aiScoreDetail: result.aiScore !== undefined ? JSON.stringify({
      aiScore: result.aiScore,
      aiComment: result.aiComment,
    }) : '',
    correctionRecords: result.correctionRecords ? JSON.stringify(result.correctionRecords) : '',
    gradingTime: result.gradingTime,
    evaluationMode: result.evaluationMode,
    status: result.status,
  }
}
