import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fixture from '../../fixtures/inputs/01_auto.json'
import { config } from '../../apps/host/config'
import type { ModelCall, ProjectInput } from '../../apps/host/generated/contracts'
import { projectDecisionInput } from '../../packages/decision/structured-route'
import { STRATEGY_PROMPT_SOURCE_CHARS, strategyFailure, strategyFailureMessage, strategyPromptSources, type StrategyProgress } from '../../packages/retrofit/strategy'

const ports = vi.hoisted(() => ({ open: vi.fn(), research: vi.fn() }))
vi.mock('../../runtime/dsh/live-session', () => ({ LiveSession: { open: ports.open } }))
vi.mock('../../services/capabilities/research', () => ({ collectSelectedEvidence: ports.research }))
import { researchRenewalStrategy } from '../../services/map-screening/renewal-strategy'

const initial = { modelConfigured: config.modelConfigured, searchConfigured: config.searchConfigured, decisionEnabled: config.decisionEnabled }
const call: ModelCall = { stage: 'renewal_strategy', requested_model: 'deepseek-flash', returned_model: null, finish_reason: 'error', error_code: 'TRANSPORT', input_tokens: 0, output_tokens: 0, duration_ms: 10500, session_id: null }
beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(config, { modelConfigured: true, searchConfigured: false, decisionEnabled: false })
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('UNEXPECTED_NETWORK_CALL'))
})
afterEach(() => { Object.assign(config, initial); vi.restoreAllMocks() })

describe('safe strategy failure diagnostics', () => {
  it('explains an existing truncated TRANSPORT failure without exposing raw messages', () => {
    const legacy = { error: 'LIVE_STAGE_FAILED:renewal_strategy:error', model_calls: [call] }
    expect(strategyFailureMessage(legacy)).toContain('无法连接模型服务')
    const result = strategyFailure(new Error('LIVE_STAGE_FAILED:renewal_strategy:error:TRANSPORT:https://provider.invalid?api_key=secret'), [call])
    expect(result.diagnostic).toEqual({ code: 'MODEL_PROVIDER_FAILED', stage: 'renewal_strategy', stop_reason: 'error', provider_code: 'TRANSPORT' })
    expect(JSON.stringify(result)).not.toMatch(/secret|provider\.invalid|LIVE_STAGE_FAILED/)
  })
  it.each([
    ['RATE_LIMIT', 'MODEL_RATE_LIMITED', '请求频率'], ['AUTH', 'MODEL_AUTH_FAILED', '身份验证'],
    ['TIMEOUT', 'MODEL_TIMEOUT', '超时'], ['MALFORMED_RESPONSE', 'MODEL_OUTPUT_INVALID', '格式校验'],
  ])('preserves the %s failure category', (provider, code, chinese) => {
    const result = strategyFailure(new Error(`LIVE_STAGE_FAILED:renewal_strategy:error:${provider}`), [])
    expect(result.diagnostic.code).toBe(code); expect(result.error).toContain(chinese)
  })
  it('never forwards an arbitrary exception or unrecognized provider code', () => {
    const result = strategyFailure(new Error('Bearer sk-private\nhttps://provider.invalid'), [{ ...call, error_code: 'SK_PRIVATE' }])
    expect(result.diagnostic.code).toBe('STRATEGY_FAILED')
    expect(JSON.stringify(result)).not.toMatch(/sk-private|SK_PRIVATE|provider\.invalid/)
  })
  it('distinguishes output exhaustion, missing structured delivery and a typed schema failure',()=>{
    const exhausted=strategyFailure(new Error('LIVE_STAGE_FAILED:renewal_strategy:max-tokens:no structured result'),[])
    expect(exhausted.diagnostic).toMatchObject({code:'MODEL_OUTPUT_TRUNCATED',stop_reason:'max-tokens'})
    expect(exhausted.error).toContain('长度上限')
    const absent=strategyFailure(new Error('LIVE_STAGE_FAILED:renewal_strategy:stop:NO_STRUCTURED_OUTPUT'),[])
    expect(absent.diagnostic.code).toBe('MODEL_STRUCTURED_OUTPUT_MISSING');expect(absent.error).toContain('未提交')
    const typed=strategyFailure(new Error('LIVE_SCHEMA_FAILED:renewal_strategy_contract_retry'),[])
    expect(typed.diagnostic.code).toBe('MODEL_SCHEMA_INVALID');expect(typed.error).toContain('字段')
    expect(strategyFailureMessage({diagnostic:exhausted.diagnostic})).toContain('长度上限')
    expect(strategyFailureMessage({diagnostic:{code:'MODEL_OUTPUT_INVALID',stop_reason:'max-tokens'}})).toContain('长度上限')
  })
  it('explains native request-budget exhaustion separately from model formatting or provider failures',()=>{
    for(const code of ['RUN_MODEL_BUDGET_EXCEEDED','RUN_MODEL_STAGE_BUDGET_EXCEEDED']) {
      const result=strategyFailure(new Error(`LIVE_STAGE_FAILED:renewal_strategy:error:${code}`),[{...call,error_code:'MALFORMED_RESPONSE'}])
      expect(result.diagnostic).toEqual({code:'MODEL_REQUEST_BUDGET_EXHAUSTED',stage:'renewal_strategy',stop_reason:'error'})
      expect(result.error).toContain('研究预算上限');expect(result.error).toContain('专家分析保留')
      expect(strategyFailureMessage({diagnostic:result.diagnostic})).toBe(result.error)
      expect(strategyFailure(new Error(code),[]).diagnostic.code).toBe('MODEL_REQUEST_BUDGET_EXHAUSTED')
    }
  })
  it('retains acquired sources, research records and usage when the model transport fails', async () => {
    const project = { ...structuredClone(fixture), business_profile: 'neighborhood' } as ProjectInput
    const input = projectDecisionInput(project)
    input.renewalMode!.evidence = [{ source_id: 'CURRENT', title: '对象原文', quote: '本小区需要核对供水与电梯改善条件。', published_at: '2026-10-15', url: null, locator: 'line:1' }]
    const trace = { status: 'partial', queries: ['对象名称 综合整治'], source_ids: [], warnings: [], reused: false }
    Object.assign(config, { searchConfigured: true })
    ports.research.mockResolvedValue({ trace, sources: [] })
    const close = vi.fn(async () => {})
    ports.open.mockResolvedValue({ calls: [call], close, runReadCapability: vi.fn(async (_name, execute) => execute(new AbortController().signal)), call: vi.fn(async () => { throw new Error('LIVE_STAGE_FAILED:renewal_strategy:error:TRANSPORT:raw private details') }) })
    const result = await researchRenewalStrategy(project, 0, input, 'input-hash', false, new AbortController().signal, null)
    expect(result).toMatchObject({ status: 'failed', strategy: null, model_calls: [call], diagnostic: { provider_code: 'TRANSPORT' } })
    expect(result.research?.queries).toContain('对象名称 综合整治')
    expect(result.sources.some(source => source.id === 'CURRENT')).toBe(true)
    expect(result.error).toContain('无法连接模型服务'); expect(JSON.stringify(result)).not.toContain('raw private details')
    expect(close).toHaveBeenCalledOnce(); expect(fetch).not.toHaveBeenCalled()
  })
  it('returns a safe failure packet when DSH initialization fails', async () => {
    const project = { ...structuredClone(fixture), business_profile: 'neighborhood' } as ProjectInput
    ports.open.mockRejectedValue(new Error('invalid header contains sk-private'))
    const result = await researchRenewalStrategy(project, 0, projectDecisionInput(project), 'input-hash', false, new AbortController().signal, null)
    expect(result.status).toBe('failed'); expect(result.diagnostic?.code).toBe('STRATEGY_FAILED')
    expect(JSON.stringify(result)).not.toContain('sk-private')
  })
  it('reports real two-round acquisition and a failed model stage without invented completion', async () => {
    const project = { ...structuredClone(fixture), business_profile: 'neighborhood' } as ProjectInput
    const events: StrategyProgress[] = [], sourceText = '本对象结构与资金需要核实。'.repeat(4000)
    Object.assign(config, { searchConfigured: true })
    ports.research.mockImplementation(async (_request, _signal, emit, _web, queries: string[]) => {
      const id = queries[0].includes('浙工新村') ? 'REFERENCE' : 'OBJECT'
      emit({ type: 'progress', stage: 'fetch', status: 'completed', source_id: id, message: '已取得来源' })
      return { sources: [{ id, title: '归档工程原文', url: `https://example.gov.cn/${id}`, visibility: 'public', data_class: 'public', synthetic: false, untrusted_text: sourceText, content_status: 'full_text' }],
        trace: { status: 'success', queries, source_ids: [id], warnings: [], reused: false } }
    })
    const model = vi.fn(async (_stage: string, _prompt: string) => { throw new Error('LIVE_STAGE_FAILED:renewal_strategy:error:TRANSPORT') })
    ports.open.mockResolvedValue({ calls: [call], close: vi.fn(async () => {}), runReadCapability: vi.fn(async (_name, execute) => execute(new AbortController().signal)), call: model })
    const result = await researchRenewalStrategy(project, 0, projectDecisionInput(project), 'input-hash', false, new AbortController().signal, null, { onProgress: event => events.push(event) })
    expect(ports.research).toHaveBeenCalledTimes(2)
    expect(result.research?.queries).toHaveLength(12)
    expect(result.research?.source_ids).toEqual(['OBJECT', 'REFERENCE'])
    expect(result.sources.find(source => source.id === 'OBJECT')?.text).toBe(sourceText)
    expect(events.filter(event => event.stage === 'research' && event.round === 2).length).toBeGreaterThan(0)
    expect(events.at(-1)).toMatchObject({ stage: 'model', status: 'failed' })
    expect(events.some(event => event.stage === 'validation' || event.stage === 'result' && event.status === 'completed')).toBe(false)
    expect(model).toHaveBeenCalledOnce()
    expect(String(model.mock.calls[0]?.[1]).length).toBeLessThan(100000)
    expect(fetch).not.toHaveBeenCalled()
  })
  it('keeps model source excerpts bounded and contiguous while leaving original material intact', () => {
    const sources = Array.from({ length: 20 }, (_, index) => ({ id: `SOURCE-${index}`, title: '工程资料', text: '前文。'.repeat(2000)+'结构与资金条件。'.repeat(3000), url: null, published_at: null, role: index === 0 ? 'current' as const : 'reference' as const, locator: 'source:text' }))
    const selected = strategyPromptSources(sources)
    expect(selected.reduce((total, source) => total + source.text.length, 0)).toBeLessThanOrEqual(STRATEGY_PROMPT_SOURCE_CHARS)
    expect(selected[0].id).toBe('SOURCE-0')
    for (const source of selected) expect(sources.find(original => original.id === source.id)?.text).toContain(source.text)
    expect(sources[0].text.length).toBeGreaterThan(20000)
  })
})
