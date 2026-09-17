/**
 * PlatformDetectionService 平台检测服务测试
 * 验证 URL 正则匹配和平台自动检测功能
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { LogService } from '../../../electron/services/LogService'
import { PlatformDetectionService } from '../../../electron/services/PlatformDetectionService'
import { PlatformDetectionRule } from '../../../electron/adapters/PlatformAdapter.interface'

describe('PlatformDetectionService 平台检测服务', () => {
  let service: PlatformDetectionService
  let mockLogger: any

  beforeEach(() => {
    mockLogger = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn()
    }

    service = new PlatformDetectionService(mockLogger as any)
  })

  describe('构造函数和默认规则', () => {
    it('应该初始化默认检测规则（智学网）', () => {
      const rules = service.getRules()

      expect(rules.length).toBeGreaterThan(0)

      const zhixueRule = rules.find(r => r.platform === 'zhixue')
      expect(zhixueRule).toBeDefined()
      expect(zhixueRule?.urlPatterns.length).toBeGreaterThan(0)
    })

    it('应该按优先级排序规则', () => {
      const rules = service.getRules()

      // 检查是否按优先级降序排列
      for (let i = 1; i < rules.length; i++) {
        expect(rules[i - 1].priority).toBeGreaterThanOrEqual(rules[i].priority)
      }
    })
  })

  describe('registerRule()', () => {
    it('应该成功注册检测规则', () => {
      const newRule: PlatformDetectionRule = {
        platform: 'new-platform',
        urlPatterns: [/new-platform\.com/i],
        priority: 50
      }

      service.registerRule(newRule)

      const rules = service.getRules()
      const registered = rules.find(r => r.platform === 'new-platform')

      expect(registered).toBeDefined()
      expect(registered?.urlPatterns[0]).toBeInstanceOf(RegExp)
    })

    it('应该更新已存在的规则', () => {
      const rule1: PlatformDetectionRule = {
        platform: 'test',
        urlPatterns: [/test1\.com/i],
        priority: 50
      }

      const rule2: PlatformDetectionRule = {
        platform: 'test',
        urlPatterns: [/test2\.com/i],
        priority: 100
      }

      service.registerRule(rule1)
      service.registerRule(rule2)

      const rules = service.getRules()
      const updated = rules.find(r => r.platform === 'test')

      // 应该更新为新的规则
      expect(updated?.priority).toBe(100)
    })

    it('应该按优先级重新排序', () => {
      service.registerRule({
        platform: 'low',
        urlPatterns: [/low\.com/i],
        priority: 10
      })

      service.registerRule({
        platform: 'high',
        urlPatterns: [/high\.com/i],
        priority: 200
      })

      const rules = service.getRules()
      const highIndex = rules.findIndex(r => r.platform === 'high')
      const lowIndex = rules.findIndex(r => r.platform === 'low')

      // high 优先级更高，应该在前面
      expect(highIndex).toBeLessThan(lowIndex)
    })
  })

  describe('unregisterRule()', () => {
    it('应该成功注销检测规则', () => {
      service.registerRule({
        platform: 'temp',
        urlPatterns: [/temp\.com/i],
        priority: 50
      })

      expect(service.isPlatformSupported('temp')).toBe(true)

      service.unregisterRule('temp')

      expect(service.isPlatformSupported('temp')).toBe(false)
    })

    it('应该优雅地处理注销不存在的规则', () => {
      expect(() => service.unregisterRule('non-existent')).not.toThrow()
    })
  })

  describe('detect()', () => {
    beforeEach(() => {
      // 注册测试规则
      service.registerRule({
        platform: 'zhixue',
        urlPatterns: [/zhixue\.com/i, /zhixueyun\.com/i],
        priority: 100
      })

      service.registerRule({
        platform: 'custom',
        urlPatterns: [/custom\.edu\.cn/i],
        priority: 80
      })
    })

    it('应该成功检测智学网 URL（zhixue.com）', () => {
      const url = 'https://www.zhixue.com/grading/12345'
      const result = service.detect(url)

      expect(result).toBe('zhixue')
    })

    it('应该成功检测智学网 URL（zhixueyun.com）', () => {
      const url = 'https://teacher.zhixueyun.com/paper/view'
      const result = service.detect(url)

      expect(result).toBe('zhixue')
    })

    it('应该成功检测自定义平台 URL', () => {
      const url = 'https://grading.custom.edu.cn/online'
      const result = service.detect(url)

      expect(result).toBe('custom')
    })

    it('应该匹配 URL 的 hostname 部分', () => {
      const url = 'https://zhixue.com/path?query=1'
      const result = service.detect(url)

      expect(result).toBe('zhixue')
    })

    it('应该匹配子域名的智学网 URL', () => {
      // 边界覆盖：带子域名时 hostname 为 teacher.zhixue.com，仍应命中
      const url = 'https://teacher.zhixue.com/paper/1'
      const result = service.detect(url)

      expect(result).toBe('zhixue')
    })

    it('域名匹配应大小写不敏感', () => {
      // 边界覆盖：hostname 会被 URL 规范化，大小写混写仍应命中
      const url = 'https://WWW.ZHIXUE.COM/Grading'
      const result = service.detect(url)

      expect(result).toBe('zhixue')
    })

    it('路径/查询串中的域名不得被判定为平台（仅匹配 hostname）', () => {
      // 修复后：detect() 只对 hostname 做 pattern 匹配。
      // 此前 `|| pattern.test(fullUrl)` 会把任何路径/查询串里含 "zhixue.com" 的
      // 第三方站点误判为智学网（跨平台误路由）。
      const url = 'https://www.example.com/path/zhixue.com/grading'
      // 这个 URL 的 hostname 是 example.com，不应该匹配
      const result = service.detect(url)

      expect(result).not.toBe('zhixue')
    })

    it('查询串中的域名同样不得被判定为平台', () => {
      const url = 'https://www.other-site.com/redirect?to=https://zhixue.com'
      const result = service.detect(url)

      expect(result).not.toBe('zhixue')
    })

    it('应该返回 null 当无法检测平台时', () => {
      const url = 'https://www.google.com'
      const result = service.detect(url)

      expect(result).toBeNull()
    })

    it('应该处理无效的 URL', () => {
      const result1 = service.detect('')
      expect(result1).toBeNull()

      const result2 = service.detect('not-a-url')
      expect(result2).toBeNull()

      const result3 = service.detect(null as any)
      expect(result3).toBeNull()
    })

    it('应该记录检测日志', () => {
      const url = 'https://www.zhixue.com'
      service.detect(url)

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('平台检测成功'),
        expect.any(Object)
      )
    })

    it('应该记录未找到匹配平台的警告', () => {
      const url = 'https://www.unknown.com'
      service.detect(url)

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('未找到匹配的平台'),
        expect.any(Object)
      )
    })
  })

  describe('getRules()', () => {
    it('应该返回规则副本（防止外部修改）', () => {
      const rules1 = service.getRules()
      const rules2 = service.getRules()

      // 应该是不同的数组
      expect(rules1).not.toBe(rules2)

      // 但内容相同
      expect(rules1.length).toBe(rules2.length)
    })
  })

  describe('getSupportedPlatforms()', () => {
    it('应该返回所有支持的平台列表', () => {
      service.registerRule({
        platform: 'platform1',
        urlPatterns: [/p1\.com/i],
        priority: 100
      })

      service.registerRule({
        platform: 'platform2',
        urlPatterns: [/p2\.com/i],
        priority: 90
      })

      const platforms = service.getSupportedPlatforms()

      expect(platforms).toContain('platform1')
      expect(platforms).toContain('platform2')
    })
  })

  describe('isPlatformSupported()', () => {
    it('应该正确判断平台是否支持', () => {
      service.registerRule({
        platform: 'supported',
        urlPatterns: [/supported\.com/i],
        priority: 100
      })

      expect(service.isPlatformSupported('supported')).toBe(true)
      expect(service.isPlatformSupported('unsupported')).toBe(false)
    })
  })

  describe('clearRules()', () => {
    it('应该清除所有规则', () => {
      service.registerRule({
        platform: 'test1',
        urlPatterns: [/test1\.com/i],
        priority: 100
      })

      expect(service.getRules().length).toBeGreaterThan(0)

      service.clearRules()

      expect(service.getRules().length).toBe(0)
    })
  })

  describe('resetToDefaults()', () => {
    it('应该重置为默认规则', () => {
      // 清除所有规则
      service.clearRules()
      expect(service.getRules().length).toBe(0)

      // 重置
      service.resetToDefaults()

      // 应该恢复默认规则
      expect(service.getRules().length).toBeGreaterThan(0)

      const zhixueRule = service.getRules().find(r => r.platform === 'zhixue')
      expect(zhixueRule).toBeDefined()
    })
  })
})
