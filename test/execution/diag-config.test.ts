// 诊断：ConfigService 在 node 环境下的选择器加载
import { describe, it, vi } from 'vitest'
import { ConfigService } from '../../electron/services/ConfigService'

describe('diag config', () => {
  it('print selectors', () => {
    const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }
    const cs = new ConfigService(logger as any)
    console.log('SCORE_INPUT:', JSON.stringify(cs.getZhixueScoreInputSelectors()))
    console.log('SUBMIT:', JSON.stringify(cs.getZhixueSubmitButtonSelectors()))
    console.log('NEXT:', JSON.stringify(cs.getZhixueNextButtonSelectors()))
    console.log('ANSWER_IMG:', JSON.stringify(cs.getAnswerImageSelectors()))
  })
})
