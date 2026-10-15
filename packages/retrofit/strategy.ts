import type { ModelCall, RenewalStrategy, DecisionSupport, ResearchTrace } from '../../apps/host/generated/contracts'
import { evaluateRenewalModeGate, type ModeCondition } from './renewal-mode'

export const STRATEGY_POLICY = 'renewal-strategy-overview-v3'
export type StrategySource = { id: string; title: string; text: string; url: string | null; published_at: string | null; role: 'current' | 'reference'; locator: string }
export type StrategyPublication = { kind: 'current' | 'saved_snapshot'; is_current: boolean; current_input_hash: string; saved_at: string }
export type PublicStrategyIndexItem = { project_id: string; project_name: string; context_version: number; strategy_context_version: number; created_at: string; headline: string; status: 'completed'; synthetic: false; is_current: boolean; input_hash: string }
export type PublicStrategyIndexResponse = { items: PublicStrategyIndexItem[] }
export type StrategyPacket = { project_id: string; context_version: number; input_hash: string; created_at: string; synthetic: boolean; status: 'completed' | 'failed' | 'unavailable';
  strategy: RenewalStrategy | null; sources: StrategySource[]; decision: DecisionSupport | null; model_calls: ModelCall[]; research: ResearchTrace | null; error: string | null; diagnostic?: StrategyDiagnostic; publication?: StrategyPublication }

export type StrategyDiagnostic = { code: 'MODEL_NOT_CONFIGURED' | 'MODEL_PROVIDER_FAILED' | 'MODEL_OUTPUT_INVALID' | 'MODEL_RATE_LIMITED' | 'MODEL_AUTH_FAILED' | 'MODEL_TIMEOUT' | 'RESEARCH_FAILED' | 'STRATEGY_EVIDENCE_INVALID' | 'STRATEGY_FAILED';
  stage?: string; stop_reason?: string; provider_code?: string }
export type StrategyProgress = { type: 'progress'; stage: 'sources' | 'research' | 'model' | 'validation' | 'result';
  status: 'running' | 'completed' | 'skipped' | 'failed'; message: string; source_count?: number; query_count?: number; round?: number; round_count?: number }
export type StrategyStreamEvent = StrategyProgress | { type: 'complete'; result: StrategyPacket } | { type: 'error'; message: string }

const providerCodes = new Set(['TRANSPORT', 'SERVER', 'TIMEOUT', 'AUTH', 'INVALID_CREDENTIAL', 'RATE_LIMIT', 'MALFORMED_RESPONSE', 'EMPTY_RESPONSE', 'BAD_REQUEST', 'NO_ADAPTER', 'MODEL_ERROR'])
const diagnosticMessages: Record<StrategyDiagnostic['code'], string> = {
  MODEL_NOT_CONFIGURED: '尚未配置模型服务，暂不能生成整体更新方案。',
  MODEL_PROVIDER_FAILED: '模型服务未完成本轮请求，整体更新方案生成失败。',
  MODEL_OUTPUT_INVALID: '模型返回内容未通过方案格式校验，本轮未发布方案。',
  MODEL_RATE_LIMITED: '模型服务限制了请求频率，本轮方案生成未完成。',
  MODEL_AUTH_FAILED: '模型服务未通过身份验证，本轮方案生成未完成。',
  MODEL_TIMEOUT: '本轮方案研究超时，尚未生成完整方案。',
  RESEARCH_FAILED: '公开资料检索未完成，本轮整体更新方案尚未生成。',
  STRATEGY_EVIDENCE_INVALID: '方案引用或适用条件未通过核验，本轮未发布方案。',
  STRATEGY_FAILED: '本轮方案生成未完成，暂未形成可展示的整体更新方案。',
}
const providerMessages: Record<string, string> = {
  TRANSPORT: '服务器暂时无法连接模型服务，本轮未生成整体更新方案。可继续查阅已取得资料，稍后重试。',
  BAD_REQUEST: '模型服务未接受本轮请求，整体更新方案生成失败。',
  NO_ADAPTER: '当前模型服务配置不可用，整体更新方案尚未生成。',
}
/** Only fixed codes cross the runtime boundary; provider messages and URLs never enter the product error. */
export function strategyFailure(error: unknown, calls: readonly ModelCall[], options: { stage?: StrategyProgress['stage']; timedOut?: boolean } = {}): { error: string; diagnostic: StrategyDiagnostic } {
  const message = error instanceof Error ? error.message : ''
  const parsed = /^LIVE_STAGE_FAILED:(renewal_strategy(?:_(?:quote_repair|format_retry|contract_retry))*):(completed|error|aborted|max-tokens|failed)(?::([A-Z_]+))?/.exec(message)
  const call = parsed ? calls.filter(call => call.stage === parsed[1]).at(-1) : undefined
  const rawCode = call?.error_code || parsed?.[3]
  const provider = rawCode && providerCodes.has(rawCode) ? rawCode : undefined
  let code: StrategyDiagnostic['code'] = 'STRATEGY_FAILED'
  if (message === 'MODEL_NOT_CONFIGURED') code = 'MODEL_NOT_CONFIGURED'
  else if (options.timedOut || provider === 'TIMEOUT') code = 'MODEL_TIMEOUT'
  else if (provider === 'AUTH' || provider === 'INVALID_CREDENTIAL') code = 'MODEL_AUTH_FAILED'
  else if (provider === 'RATE_LIMIT') code = 'MODEL_RATE_LIMITED'
  else if (provider === 'MALFORMED_RESPONSE' || provider === 'EMPTY_RESPONSE' || parsed?.[2] === 'max-tokens' || error instanceof Error && error.name === 'ContractError' || message === 'STRATEGY_INCOMPLETE') code = 'MODEL_OUTPUT_INVALID'
  else if (/^STRATEGY_(QUOTE_MISMATCH|SOURCE_MISMATCH|OBJECT_EVIDENCE_MISSING|MODE_RESTRICTED|REBUILD_GATE_UNMET)$/.test(message)) code = 'STRATEGY_EVIDENCE_INVALID'
  else if (provider) code = 'MODEL_PROVIDER_FAILED'
  else if (options.stage === 'research') code = 'RESEARCH_FAILED'
  const diagnostic: StrategyDiagnostic = { code, ...(parsed ? { stage: parsed[1], stop_reason: parsed[2] } : {}), ...(provider ? { provider_code: provider } : {}) }
  const text = code === 'MODEL_PROVIDER_FAILED' && provider && Object.hasOwn(providerMessages, provider) ? providerMessages[provider] : diagnosticMessages[code]
  return { error: text, diagnostic }
}

/** Old cached failures have no diagnostic field; recover only known categories from their call records. */
export function strategyFailureMessage(packet: { diagnostic?: StrategyDiagnostic; error?: string | null; model_calls?: readonly ModelCall[]; status?: string }): string {
  if (packet.diagnostic && Object.hasOwn(diagnosticMessages, packet.diagnostic.code)) {
    const provider = packet.diagnostic.provider_code
    return packet.diagnostic.code === 'MODEL_PROVIDER_FAILED' && provider && Object.hasOwn(providerMessages, provider) ? providerMessages[provider] : diagnosticMessages[packet.diagnostic.code]
  }
  if (packet.status === 'unavailable' || packet.error === '请先配置 DeepSeek 模型接口。') return diagnosticMessages.MODEL_NOT_CONFIGURED
  return strategyFailure(new Error(packet.error || ''), packet.model_calls || []).error
}

export function strategyStageLabel(stage: string): string {
  if (stage.startsWith('renewal_strategy')) return '方案生成'
  if (stage === 'renewal_public_research') return '资料检索'
  if (stage === 'renewal_research_route') return '模式判定'
  return '模型调用'
}
export function strategyCallStatus(reason: string): string {
  return ({ error: '失败', aborted: '已取消', stop: '完成', 'tool-calls': '工具调用', 'max-tokens': '达到输出长度上限' } as Record<string, string>)[reason] || '未记录结束状态'
}

export const STRATEGY_PROMPT_SOURCE_CHARS = 36000
/** Keep all acquired sources in the packet; only contiguous, relevant excerpts enter the model prompt. */
export function strategyPromptSources(sources: readonly StrategySource[]): StrategySource[] {
  const terms = /结构|鉴定|权属|规划|居民|安置|资金|投资|成本|造价|维护|维修|运营|拆|修缮|供水|电梯/
  const ordered = sources.map((source, index) => ({ source, index })).sort((a, b) => Number(b.source.role === 'current') - Number(a.source.role === 'current') || Number(terms.test(b.source.text)) - Number(terms.test(a.source.text)) || a.index - b.index)
  const selected: StrategySource[] = []; let remaining = STRATEGY_PROMPT_SOURCE_CHARS
  for (const { source } of ordered) {
    if (remaining < 300) break
    const match = source.text.search(terms), start = source.role === 'current' || match < 0 ? 0 : Math.max(0, match - 400)
    const text = source.text.slice(start, start + Math.min(remaining, source.role === 'current' ? 5000 : 3000))
    if (!text.trim()) continue
    selected.push({ ...source, text }); remaining -= text.length
  }
  return selected
}

const literal = (value: string) => value.normalize('NFKC').replace(/\s+/g, '')
export function validateStrategy(value: RenewalStrategy, sources: StrategySource[], conditions:ModeCondition[] = []) {
  if (value.paths.length !== 2 || new Set(value.paths.map(path => path.mode)).size !== 2 || value.dimensions.length !== 6 || new Set(value.dimensions.map(row => row.key)).size !== 6) throw new Error('STRATEGY_INCOMPLETE')
  const ids = new Set(sources.map(source => source.id))
  for (const row of value.rationale) {
    const source = sources.find(source => source.id === row.source_id)
    if (!source || row.quote.trim().length < 8 || !literal(source.text).includes(literal(row.quote))) throw new Error('STRATEGY_QUOTE_MISMATCH')
  }
  for (const row of [...value.paths.flatMap(path => path.actions), ...value.dimensions, ...value.next_checks]) if (row.evidence_refs.some(id => !ids.has(id))) throw new Error('STRATEGY_SOURCE_MISMATCH')
  if (!value.rationale.some(row => sources.find(source => source.id === row.source_id)?.role === 'current')) throw new Error('STRATEGY_OBJECT_EVIDENCE_MISSING')
  if (value.preferred_mode==='comprehensive'&&conditions.some(row=>row.kind==='structure_repairable'&&row.value===false)||value.preferred_mode==='rebuild'&&conditions.some(row=>row.kind==='demolition_permitted'&&row.value===false)) throw new Error('STRATEGY_MODE_RESTRICTED')
  if (value.preferred_mode==='rebuild'&&!evaluateRenewalModeGate({conditions}).rebuild_allowed) throw new Error('STRATEGY_REBUILD_GATE_UNMET')
  return value
}
