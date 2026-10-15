import { AsyncLocalStorage } from 'node:async_hooks'
import { Context } from '@deepseek-ai/cordis'
import { DeepSeekAdapter, resolveAdapterOptions } from '@deepseek-ai/dsh-llm-deepseek'
import { ReasoningEffortId, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import type { AnonymousUserId } from '@deepseek-ai/dsh-anonymous-user-id'
import { afterEach, expect, it, vi } from 'vitest'
import { installRenewalStructuredToolChoice, LiveSession } from '../../runtime/dsh/live-session'
import { ContractError } from '../../packages/contracts/validate'
import { loadRenewalAgentProfile } from '../../runtime/agents/renewal/profiles'

// Do not load local credentials or start the application's network/persistence setup.
vi.mock('../../apps/host/config', () => ({ config: { DEEPSEEK_MODEL: 'deepseek-flash' } }))
vi.mock('../../runtime/dsh/public-web', () => ({ ensureHarnessNetwork: vi.fn() }))

type CallScope = { stage: string; outputType: string;allowedTools?:readonly string[] }
const contexts: Context[] = []
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  vi.restoreAllMocks()
})

const tool = (name = 'structured_output') => ({ name, description: 'Isolated request fixture', parameters: { type: 'object', properties: {} } })
function response() {
  const events = [
    { type: 'message_start', message: { id: 'fixture-message', type: 'message', role: 'assistant', model: 'deepseek-flash', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'fixture' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } },
    { type: 'message_stop' },
  ]
  return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'Content-Type': 'text/event-stream' } })
}

async function fixture() {
  const ctx = new Context(); contexts.push(ctx)
  const scope = new AsyncLocalStorage<CallScope>()
  await installRenewalStructuredToolChoice(ctx, scope)
  const bodies: Record<string, unknown>[] = []
  const transport = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)))
    return response()
  })
  const auth = vi.fn(async () => ({ headers: { 'x-api-key': 'isolated-fixture' } }))
  const adapter = new DeepSeekAdapter({
    options: () => resolveAdapterOptions({ baseURL: 'https://fixture.invalid/anthropic', maxTokens: 12000 }),
    resolveAuth: auth,
    resolveUserId: () => 'isolated-fixture-user' as AnonymousUserId,
    prepareExtensions: request => ctx.deepseekLlmApiExtensions.prepare(request),
  })
  const send = async (callScope: CallScope | undefined, extra: Partial<GenerateOptions> = {}) => {
    const chunks: StreamChunk[] = []
    const execute = async () => {
      for await (const chunk of adapter.stream({ provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: ReasoningEffortId('off'), maxTokens: 12000,
        messages: [{ role: 'user', content: [{ type: 'text', text: 'Isolated serialization fixture.' }] }], tools: [tool()], ...extra })) chunks.push(chunk)
    }
    if (callScope) await scope.run(callScope, execute)
    else await execute()
    expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'stop' } })
    return bodies.at(-1)!
  }
  return { send, bodies, transport, auth }
}

it('sends forced structured_output in the real adapter HTTP body for a non-thinking RenewalStrategy request', async () => {
  const { send, transport, auth } = await fixture()
  const body = await send({ stage: 'renewal_strategy', outputType: 'RenewalStrategy' })
  expect(body.tool_choice).toEqual({ type: 'tool', name: 'structured_output' })
  expect(body.thinking).toEqual({ type: 'disabled' })
  expect(body.max_tokens).toBe(12000)
  expect(body.tools).toEqual([{ name: 'structured_output', description: 'Isolated request fixture', input_schema: { type: 'object', properties: {} } }])
  expect(transport).toHaveBeenCalledTimes(1); expect(auth).toHaveBeenCalledTimes(1)
  expect(transport.mock.calls[0][0]).toBe('https://fixture.invalid/anthropic/v1/messages')
})

it.each(['RenewalResearchPlan','RenewalResearchNote'])('forces a sole structured_output for %s without enabling thinking',async outputType=>{
  const {send}=await fixture()
  const body=await send({stage:'renewal_research_fixture',outputType})
  expect(body.tool_choice).toEqual({type:'tool',name:'structured_output'})
  expect(body.thinking).toEqual({type:'disabled'})
})
it('allows only the declared source-reader and structured tools for specialist notes',async()=>{
  const {send}=await fixture(),scope={stage:'renewal_expert_1',outputType:'RenewalResearchNote',allowedTools:['read_renewal_sources']}
  const tools=[tool('read_renewal_sources'),tool()]
  expect((await send(scope,{tools})).tool_choice).toEqual({type:'any'})
  expect(await send(scope,{tools:[...tools,tool('unexpected_tool')]})).not.toHaveProperty('tool_choice')
  expect(await send(scope,{tools:[tool('unexpected_tool'),tool()]})).not.toHaveProperty('tool_choice')
  expect(await send(scope,{tools,reasoningEffort:ReasoningEffortId('high')})).not.toHaveProperty('tool_choice')
  expect(await send({stage:'unrelated',outputType:'SpecialistAssessment'},{tools})).not.toHaveProperty('tool_choice')
  const scopedReader='renewal_sources_12_3',dynamic={stage:'renewal_expert_dynamic',outputType:'RenewalResearchNote',allowedTools:[scopedReader]}
  expect((await send(dynamic,{tools:[tool(),tool(scopedReader)]})).tool_choice).toEqual({type:'any'})
  expect(await send({...dynamic,allowedTools:[]},{tools:[tool(),tool(scopedReader)]})).not.toHaveProperty('tool_choice')
  expect(await send(dynamic,{tools:[tool(),tool('renewal_sources_arbitrary')]})).not.toHaveProperty('tool_choice')
})

it.each([
  ['another output', { stage: 'renewal_strategy', outputType: 'ScenarioProposal' }, {}],
  ['no call scope', undefined, {}],
  ['another sole tool', { stage: 'renewal_strategy', outputType: 'RenewalStrategy' }, { tools: [tool('evidence_read')] }],
  ['additional tools', { stage: 'renewal_strategy', outputType: 'RenewalStrategy' }, { tools: [tool(), tool('evidence_read')] }],
  ['no tools', { stage: 'renewal_strategy', outputType: 'RenewalStrategy' }, { tools: [] }],
  ['thinking enabled', { stage: 'renewal_strategy', outputType: 'RenewalStrategy' }, { reasoningEffort: ReasoningEffortId('high') }],
] as const)('preserves the real adapter body for %s', async (_name, scope, extra) => {
  const { send } = await fixture()
  expect(await send(scope, extra as Partial<GenerateOptions>)).not.toHaveProperty('tool_choice')
})

it('keeps simultaneous renewal and other-output request scopes separate through serialization', async () => {
  const { send, bodies } = await fixture()
  await Promise.all([
    send({ stage: 'renewal_strategy_quote_repair', outputType: 'RenewalStrategy' }, { model: 'renewal-fixture' }),
    send({ stage: 'specialist', outputType: 'SpecialistAssessment' }, { model: 'other-fixture' }),
  ])
  expect(bodies.find(body => body.model === 'renewal-fixture')?.tool_choice).toEqual({ type: 'tool', name: 'structured_output' })
  expect(bodies.find(body => body.model === 'other-fixture')).not.toHaveProperty('tool_choice')
})

function callFixture(outcomes: { stopReason: string; structured?: unknown; diagnostic?: string; text?: string }[]) {
  const scope = new AsyncLocalStorage<CallScope>(), observed: (CallScope | undefined)[] = []
  const dispose = vi.fn(async () => {})
  const start = vi.fn(async (_provider: string, _request: Record<string, unknown>) => {
    observed.push(scope.getStore())
    return { id: `fixture-child-${observed.length}`, result: Promise.resolve(outcomes.shift()!), dispose }
  })
  // Exercise the production call lifecycle with only its subagent port replaced.
  const live = Object.create(LiveSession.prototype) as LiveSession
  Object.assign(live, {
    stageScope: scope, ctx: { subagents: { start } }, parent: { agent: {} }, calls: [], signal: new AbortController().signal,
  })
  return { live, start, observed, dispose }
}

it('marks completed plain text as NO_STRUCTURED_OUTPUT without parsing it or retrying', async () => {
  const { live, start, observed, dispose } = callFixture([{ stopReason: 'completed', text: '{"headline":"This is still ordinary text"}' }])
  await expect(live.call('renewal_strategy', 'fixture', 'RenewalStrategy')).rejects.toThrow('LIVE_STAGE_FAILED:renewal_strategy:completed:NO_STRUCTURED_OUTPUT')
  expect(start).toHaveBeenCalledTimes(1)
  expect(start.mock.calls[0][1]).toMatchObject({ agentOptions: { maxTokens: 12000 } })
  expect(observed).toEqual([{ stage: 'renewal_strategy', outputType: 'RenewalStrategy',allowedTools:[] }])
  expect(dispose).toHaveBeenCalledTimes(1)
})

it('preserves the existing max-tokens failure marker', async () => {
  const { live, start } = callFixture([{ stopReason: 'max-tokens', diagnostic: 'fixture-cap' }])
  await expect(live.call('renewal_strategy', 'fixture', 'RenewalStrategy')).rejects.toThrow('LIVE_STAGE_FAILED:renewal_strategy:max-tokens:fixture-cap')
  expect(start).toHaveBeenCalledTimes(1)
})

it('keeps one contract correction and exposes its final schema failure with the original cause', async () => {
  const { live, start, observed } = callFixture([{ stopReason: 'completed', structured: {} }, { stopReason: 'completed', structured: {} }])
  const error = await live.call('renewal_strategy', 'fixture', 'RenewalStrategy').catch((error: unknown) => error)
  expect(error).toMatchObject({ message: 'LIVE_SCHEMA_FAILED:renewal_strategy_contract_retry' })
  expect((error as Error).cause).toBeInstanceOf(ContractError)
  expect(start).toHaveBeenCalledTimes(2)
  expect(observed).toEqual([{ stage: 'renewal_strategy', outputType: 'RenewalStrategy',allowedTools:[] }, { stage: 'renewal_strategy_contract_retry', outputType: 'RenewalStrategy',allowedTools:[] }])
  for (const [, request] of start.mock.calls) expect(request).toMatchObject({ agentOptions: { maxTokens: 12000 } })
})
it('injects the allowlisted role Markdown through native persona and retains it through the existing contract correction',async()=>{
  const profile=await loadRenewalAgentProfile('planner')
  const {live,start}=callFixture([{stopReason:'completed',structured:{}},{stopReason:'completed',structured:{summary:'Isolated planner fixture',tasks:[]}}])
  await live.call('renewal_research_plan','fixture','RenewalResearchPlan',[],undefined,{},profile)
  expect(start).toHaveBeenCalledTimes(2)
  for(const [,request] of start.mock.calls) {
    expect(request.persona).toContain(profile.content)
    expect(request.persona).toContain(profile.sha256)
    expect(request.persona).toContain('受限专业角色')
    expect(request.toolFilter).toEqual({allow:[]})
  }
})

function budgetFixture(runId='MAP-AI-STRATEGY-isolated-budget',signal=new AbortController().signal) {
  const Constructor=LiveSession as unknown as new(runId:string,signal:AbortSignal)=>LiveSession
  const live=new Constructor(runId,signal);contexts.push(live.ctx)
  const internal=live as unknown as {stageScope:AsyncLocalStorage<CallScope>;reserveModelRequest:()=>void;modelRequests:number}
  const request=(stage:string)=>internal.stageScope.run({stage,outputType:'RenewalStrategy'},()=>internal.reserveModelRequest())
  return {live,internal,request}
}
it('replays the failed production request sequence while reserving native synthesis and repair calls',()=>{
  const {request,internal}=budgetFixture()
  request('renewal_research_plan_1')
  const building='renewal_research_expert_1_1_building_delivery',cost='renewal_research_expert_1_2_cost_value',residents='renewal_research_expert_1_3_residents_operations'
  // The real failed run used 1 planner + 3 + 3 + 3 native requests, then
  // 2 resident format-retry requests. A specialist now owns only four.
  for(const stage of [building,residents,cost,building,residents,cost,building,cost,residents])request(stage)
  request(residents+'_format_retry')
  expect(()=>request(residents+'_format_retry')).toThrow('RUN_MODEL_STAGE_BUDGET_EXCEEDED')
  expect(internal.modelRequests).toBe(11)
  for(const stage of ['renewal_strategy','renewal_strategy_contract_retry','renewal_strategy_quote_repair','renewal_strategy_quote_repair_contract_retry'])expect(()=>request(stage)).not.toThrow()
  expect(internal.modelRequests).toBe(15)
})
it('admits synthesis after twelve research requests and bounds every retry family without cross-task borrowing',()=>{
  const {request,internal}=budgetFixture()
  request('renewal_research_plan_7');request('renewal_research_plan_7_contract_retry')
  const experts=['renewal_research_expert_7_1_building_delivery','renewal_research_expert_7_2_cost_value','renewal_research_expert_7_3_residents_operations']
  for(const expert of experts.slice(0,2))for(let i=0;i<4;i++)request(expert)
  request(experts[2]);request(experts[2])
  expect(internal.modelRequests).toBe(12)
  request('renewal_strategy');request('renewal_strategy_contract_retry')
  request(experts[2]);request(experts[2]+'_format_retry')
  expect(()=>request(experts[0]+'_format_retry')).toThrow('RUN_MODEL_STAGE_BUDGET_EXCEEDED')
  expect(()=>request('renewal_research_expert_7_4_cost_value')).toThrow('RUN_MODEL_STAGE_BUDGET_EXCEEDED')
  request('renewal_strategy_quote_repair');request('renewal_strategy_quote_repair_contract_retry')
  expect(internal.modelRequests).toBe(18)
  expect(()=>request('renewal_strategy')).toThrow('RUN_MODEL_STAGE_BUDGET_EXCEEDED')
})
it.each([['MAP-AI-unrelated',6],['OTHER-unrelated',20]] as const)('preserves the existing %s request limit', (runId,limit)=>{
  const {request,internal}=budgetFixture(runId)
  for(let i=0;i<limit;i++)request('other_stage')
  expect(()=>request('other_stage')).toThrow('RUN_MODEL_BUDGET_EXCEEDED')
  expect(internal.modelRequests).toBe(limit)
})
it('retains cancellation as cancellation instead of labelling it budget exhaustion',()=>{
  const controller=new AbortController();controller.abort()
  const {request,internal}=budgetFixture(undefined,controller.signal)
  expect(()=>request('renewal_strategy')).toThrowError(expect.objectContaining({name:'AbortError'}))
  expect(internal.modelRequests).toBe(0)
})
it('preserves the local stage-budget code when native DSH wraps the rejected request as UNKNOWN',async()=>{
  const {live,start,dispose}=callFixture([])
  Object.assign(live,{runId:'MAP-AI-STRATEGY-budget-wrapper',modelRequests:4,modelRequestsByFamily:new Map([['synthesis',4]])})
  start.mockImplementation(async()=>{
    try {(live as unknown as {reserveModelRequest:()=>void}).reserveModelRequest()} catch { /* Native turn/end retains UNKNOWN, not our exception type. */ }
    return {id:'budget-rejected-child',result:Promise.resolve({stopReason:'error',diagnostic:'UNKNOWN'}),dispose}
  })
  await expect(live.call('renewal_strategy_quote_repair','fixture','RenewalStrategy')).rejects.toThrow('LIVE_STAGE_FAILED:renewal_strategy_quote_repair:error:RUN_MODEL_STAGE_BUDGET_EXCEEDED')
  expect(start).toHaveBeenCalledOnce()
})
