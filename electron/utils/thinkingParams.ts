/**
 * 思考模式参数构造（DeepSeek 专用扩展参数）——**单一实现**。
 *
 * 为什么单独抽成一个模块：
 *   历史 bug（2026-09）：设置页「测试连接」与 AIService 各写了一套请求体，
 *   测试连接那条路径**漏传 thinking 参数**且只给 max_tokens=10。DeepSeek 服务端
 *   **默认开启思考模式**，10 个 token 会被思维链（reasoning_content）吃光，
 *   导致 content 为空，报错却让用户去"关闭思考模式"——而用户早已在界面上关掉了，
 *   因为关闭状态从未被发往服务端。两处各写一遍必然再次漂移，
 *   因此把思考参数构造收敛到此文件，`electron/ipc.ts`（测试连接）与
 *   `electron/services/AIService.ts`（批改/直评/纠错分析）共用同一份。
 *
 * 参考官方文档 https://api-docs.deepseek.com/guides/thinking_mode ：
 *   - `thinking` 为顶层对象参数：`{ "type": "enabled" | "disabled" }`；
 *   - **思考模式默认打开，且 effort 默认 high**；
 *   - `reasoning_effort` 为顶层字符串参数，取值 low / high / max；
 *   - 思考模式不支持 temperature / top_p / presence_penalty / frequency_penalty
 *     （设置不报错但不生效）。
 *
 * 防呆（务必保留）：未配置 `thinkingEnabled` 时只补 `stream:false`，
 * 不发送任何 DeepSeek 专有参数，避免把 `thinking` 发给火山引擎/硅基流动等
 * 其他 OpenAI 兼容厂商导致 400。
 */

export interface ThinkingOptions {
  /** true=开启 / false=关闭 / undefined=不传该参数（跟随服务端默认） */
  thinkingEnabled?: boolean
  /** 推理强度：low / high / max，未配置则不传 */
  reasoningEffort?: 'low' | 'high' | 'max'
}

/**
 * 构造思考模式相关参数，供所有 AI 请求复用。
 * 返回值可直接展开进请求体：`{ ...buildThinkingParams(provider) }`。
 */
export function buildThinkingParams(provider?: ThinkingOptions): Record<string, unknown> {
  const params: Record<string, unknown> = { stream: false }

  if (provider?.thinkingEnabled === true) {
    params.thinking = { type: 'enabled' }
  } else if (provider?.thinkingEnabled === false) {
    params.thinking = { type: 'disabled' }
  }

  if (provider?.reasoningEffort) {
    params.reasoning_effort = provider.reasoningEffort
  }

  return params
}

/**
 * 当模型「正文为空」时，给出指向**真实原因**的提示。
 *
 * 关键区别：若用户已显式关闭思考模式（thinkingEnabled === false），
 * 却仍收到 reasoning_content，则不能再叫用户去"关闭思考模式"——那是个他已经做过的动作。
 * 此时应说明：服务端仍返回了思维链（可能默认开启思考、或忽略/不支持 disabled 参数）。
 */
export function explainEmptyContent(reasoningContent: string, thinkingEnabled?: boolean): string {
  if (!reasoningContent) {
    return '模型返回内容为空：请检查模型名称是否正确、该服务商是否支持当前调用格式'
  }

  if (thinkingEnabled === false) {
    return '模型只返回了思维链、正文为空：你已关闭思考模式，但服务端仍返回了思维链（该服务端可能默认开启思考、或忽略/不支持 thinking=disabled 参数）。请调大 max_tokens，或改用非思考模型'
  }

  return '模型只返回了思维链、正文为空：通常是 max_tokens 被思考模式耗尽，请调大 max_tokens 或关闭思考模式'
}
