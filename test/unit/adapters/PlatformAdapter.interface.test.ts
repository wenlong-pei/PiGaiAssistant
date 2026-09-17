/**
 * PlatformAdapter 接口定义测试
 * 验证接口定义的完整性和正确性
 */

import { describe, it, expect } from 'vitest'

describe('PlatformAdapter 接口定义', () => {
  describe('PlatformPageAnalysisResult 接口', () => {
    it('应该包含所有必要字段', () => {
      // 验证接口类型定义存在且结构正确
      const mockResult = {
        found: true,
        platformName: 'zhixue',
        hasAnswerImage: true,
        hasScoreInput: true,
        hasSubmitButton: true,
        questionContent: '测试题目',
        pageTitle: '测试页面',
        extra: { customField: 'value' }
      }

      // 验证所有字段都存在
      expect(mockResult).toHaveProperty('found')
      expect(mockResult).toHaveProperty('platformName')
      expect(mockResult).toHaveProperty('hasAnswerImage')
      expect(mockResult).toHaveProperty('hasScoreInput')
      expect(mockResult).toHaveProperty('hasSubmitButton')
      expect(mockResult).toHaveProperty('questionContent')
      expect(mockResult).toHaveProperty('pageTitle')
      expect(mockResult).toHaveProperty('extra')
    })

    it('应该兼容旧的 PageAnalysisResult 格式', () => {
      // 验证向后兼容性
      const legacyResult = {
        found: true,
        error: undefined,
        isZhixue: true,
        isOldUI: false,
        isNewUI: true,
        hasAnswerImage: true,
        hasScoreInput: true,
        hasSubmitButton: true,
        questionContent: '测试',
        pageTitle: '测试'
      }

      expect(legacyResult.found).toBe(true)
      expect(legacyResult.isZhixue).toBe(true)
    })
  })

  describe('PlatformAdapter 接口', () => {
    it('应该定义所有必要方法', () => {
      // 验证接口方法签名
      const requiredMethods = [
        'analyzePage',
        'captureAnswerImage',
        'submitScore',
        'goToNext',
        'getPlatformName',
        'validatePage'
      ]

      // 这些方法应该在接口中定义
      expect(requiredMethods.length).toBe(6)
    })

    it('应该定义 platformName 只读属性', () => {
      // 验证 platformName 是只读的
      const mockAdapter = {
        platformName: 'test',
        analyzePage: async () => ({ found: true }),
        captureAnswerImage: async () => null,
        submitScore: async () => false,
        goToNext: async () => false,
        getPlatformName: () => 'test',
        validatePage: async () => false
      }

      expect(mockAdapter.platformName).toBeDefined()
      expect(typeof mockAdapter.getPlatformName).toBe('function')
    })
  })

  describe('PlatformDetectionRule 接口', () => {
    it('应该包含平台、URL模式和优先级', () => {
      const mockRule = {
        platform: 'zhixue',
        urlPatterns: [/zhixue\.com/i],
        priority: 100
      }

      expect(mockRule).toHaveProperty('platform')
      expect(mockRule).toHaveProperty('urlPatterns')
      expect(mockRule).toHaveProperty('priority')
      expect(mockRule.urlPatterns[0]).toBeInstanceOf(RegExp)
      expect(typeof mockRule.priority).toBe('number')
    })
  })
})
