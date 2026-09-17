import { describe, expect, it } from 'vitest'
import { normalizeSettings } from '@/store/settingsStore'

describe('normalizeSettings', () => {
  it('fills AI provider defaults for settings saved by older versions', () => {
    const settings = normalizeSettings({
      soundEnabled: false,
      soundVolume: 20,
      temperature: 0.8,
      maxTokens: 2048,
    })

    expect(settings.soundEnabled).toBe(false)
    expect(settings.providers.length).toBeGreaterThan(0)
    expect(settings.activeProviderId).toBe('deepseek')
    expect(settings.providers.some(provider => provider.isActive)).toBe(true)
    expect(settings.temperature).toBe(0.8)
    // 非旧默认值的显式设置必须原样保留
    expect(settings.maxTokens).toBe(2048)
  })

  // 迁移：旧默认 500 / 1000 会让思考模式耗尽输出额度，统一升到 4000
  it('migrates legacy maxTokens defaults to 4000', () => {
    expect(normalizeSettings({ maxTokens: 500 }).maxTokens).toBe(4000)
    expect(normalizeSettings({ maxTokens: 1000 }).maxTokens).toBe(4000)
    expect(normalizeSettings({ maxTokens: 8000 }).maxTokens).toBe(8000)
  })

  it('recovers from malformed provider data without throwing', () => {
    const settings = normalizeSettings({
      providers: null,
      activeProviderId: 'missing-provider',
    })

    expect(settings.providers[0].id).toBe('deepseek')
    expect(settings.providers[0].isActive).toBe(true)
    expect(settings.activeProviderId).toBe('deepseek')
  })

  // 回归：切换服务商必须真正改变 activeProviderId，
  // 而不是只改 provider.isActive（那会导致始终使用默认的 deepseek）
  it('keeps the selected provider active when a custom provider is chosen', () => {
    const settings = normalizeSettings({
      providers: [
        { id: 'deepseek', name: 'DeepSeek', endpoint: 'https://api.deepseek.com/v1', model: 'deepseek-chat', apiKey: '' },
        { id: 'zhipu_1', name: '智谱 GLM', endpoint: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash', apiKey: '' },
      ],
      activeProviderId: 'zhipu_1',
    })

    expect(settings.activeProviderId).toBe('zhipu_1')
    const active = settings.providers.find(p => p.isActive)
    expect(active?.id).toBe('zhipu_1')
    expect(settings.providers.filter(p => p.isActive).length).toBe(1)
  })

  // 迁移：DeepSeek 的旧默认模型 deepseek-chat → deepseek-flash（V4.1 Flash 图文全能）
  it('migrates legacy DeepSeek default model to deepseek-flash', () => {
    const settings = normalizeSettings({
      providers: [
        { id: 'deepseek', name: 'DeepSeek', endpoint: 'https://api.deepseek.com/v1', model: 'deepseek-chat', apiKey: '' },
      ],
      activeProviderId: 'deepseek',
    })

    expect(settings.providers[0].model).toBe('deepseek-flash')
    expect(settings.providers[0].visionModel).toBe('deepseek-flash')
  })

  // 迁移不能误伤用户自定义的模型名
  it('keeps custom model names untouched', () => {
    const settings = normalizeSettings({
      providers: [
        { id: 'deepseek', name: 'DeepSeek', endpoint: 'https://api.deepseek.com/v1', model: 'deepseek-reasoner', apiKey: '' },
        { id: 'zhipu_1', name: '智谱 GLM', endpoint: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash', apiKey: '' },
      ],
      activeProviderId: 'deepseek',
    })

    expect(settings.providers[0].model).toBe('deepseek-reasoner')
    expect(settings.providers[1].model).toBe('glm-4-flash')
  })
})
