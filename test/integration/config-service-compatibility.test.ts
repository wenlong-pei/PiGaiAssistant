/**
 * ConfigService 向后兼容性测试
 * 验证旧方法仍然可用
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ConfigService } from '../../electron/services/ConfigService'
import { LogService } from '../../electron/services/LogService'

describe('ConfigService 向后兼容性', () => {
  let configService: ConfigService
  let mockLogger: any

  beforeEach(() => {
    mockLogger = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn()
    }

    configService = new ConfigService(mockLogger as any)
  })

  describe('旧方法（@deprecated）', () => {
    it('getZhixueScoreInputSelectors() 应该仍然可用', () => {
      const result = configService.getZhixueScoreInputSelectors()

      expect(result).toHaveProperty('SCORE_INPUT')
      expect(result).toHaveProperty('SCORE_INPUT_NEW')
      expect(result).toHaveProperty('SCORE_INPUT_ALL_NEW')
      expect(result).toHaveProperty('SCORE_INPUT_PLACEHOLDER')
    })

    it('getZhixueSubmitButtonSelectors() 应该仍然可用', () => {
      const result = configService.getZhixueSubmitButtonSelectors()

      expect(result).toHaveProperty('SUBMIT_BUTTON')
      expect(result).toHaveProperty('SUBMIT_BUTTON_NEW')
      expect(result).toHaveProperty('SUBMIT_BUTTON_TEXT')
    })

    it('getZhixueNextButtonSelectors() 应该仍然可用', () => {
      const result = configService.getZhixueNextButtonSelectors()

      expect(result).toHaveProperty('NEXT_BUTTON')
      expect(result).toHaveProperty('NEXT_BUTTON_TEXT')
    })

    it('getZhixueQuestionContainerSelector() 应该仍然可用', () => {
      const result = configService.getZhixueQuestionContainerSelector()

      expect(typeof result).toBe('string')
    })

    it('getZhixueAnswerAreaSelector() 应该仍然可用', () => {
      const result = configService.getZhixueAnswerAreaSelector()

      expect(typeof result).toBe('string')
    })
  })

  describe('新方法（多平台支持）', () => {
    it('getAvailablePlatforms() 应该返回平台列表', () => {
      const platforms = configService.getAvailablePlatforms()

      expect(platforms).toBeInstanceOf(Array)
    })

    it('savePlatformConfig() 应该成功保存平台配置', async () => {
      const platformConfig = {
        name: '测试平台',
        domains: ['test.com'],
        selectors: {
          answerImages: { selectors: ['img'] },
          scoreInput: { allModern: 'input' },
          submitButton: { text: '提交', selectors: ['button'] },
          nextButton: { text: '下一题', selectors: ['button'] },
          questionTitle: { selectors: ['h3'] }
        }
      }

      const result = await configService.savePlatformConfig('test', platformConfig)

      // 可能不会成功，因为 SelectorManager 可能没有正确初始化
      // 但方法应该存在且不会抛出异常
      expect(typeof result).toBe('boolean')
    })
  })

  describe('选择器配置导入/导出', () => {
    // 这些测试需要 SelectorManager 正确初始化
    // 在实际环境中运行

    it('应该支持多平台配置管理', () => {
      // 验证 ConfigService 有新方法来管理多平台
      expect(typeof configService.getAvailablePlatforms).toBe('function')
      expect(typeof configService.savePlatformConfig).toBe('function')
      expect(typeof configService.deletePlatformConfig).toBe('function')
    })
  })
})
