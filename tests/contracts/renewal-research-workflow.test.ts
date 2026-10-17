import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { RenewalResearchNote, RenewalResearchPlan } from '../../apps/host/generated/contracts'
import type { ModelPresentationPolicy } from '../../packages/contracts/validate'
import type { RenewalAgentProfile } from '../../runtime/agents/renewal/profiles'
import type { LiveSession, LiveCallExecution } from '../../runtime/dsh/live-session'
import { runRenewalResearch, type RenewalResearchProgress } from '../../runtime/workflows/renewal-research'
import { strategyConstructionAllowed, type StrategySource } from '../../packages/retrofit/strategy'

type Call = { ctx: Context; stage: string; prompt: string; outputType: string; allowedTools: string[]; profile?: RenewalAgentProfile; execution?:LiveCallExecution }
const contexts: Context[] = []
afterEach(async () => { await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose())) })

async function session(reply: (call: Call) => Promise<unknown>) {
  const ctx = new Context(); contexts.push(ctx)
  await ctx.plugin(SystemPrompt, { personaPrefix: 'test', personaSuffix: '' }); await ctx.plugin(ToolRuntime)
  const calls: Call[] = []
  const live: Pick<LiveSession, 'ctx' | 'call'> = { ctx, async call<T>(stage: string, prompt: string, outputType: string, allowedTools: string[] = [],
    _candidateIds?: readonly string[], _presentationPolicy: ModelPresentationPolicy = {}, profile?: RenewalAgentProfile,execution?:LiveCallExecution) {
    const call = { ctx, stage, prompt, outputType, allowedTools, profile, execution }; calls.push(call)
    return { value: await reply(call) as T, sessionId: `fixture-${calls.length}` }
  } }
  return { live, calls }
}
function source(index: number, padding = 0): StrategySource {
  return { id: `ACTUAL-PROJECT-SOURCE-${index}`, title: `本小区第${index}项资料`, text: `第${index}项原文记载居民需求和更新措施。` + '保留原始材料内容。'.repeat(padding),
    url: null, published_at: '2026-10-01', role: 'current', locator: `document:project:${index}:line:1`,
    document_id: `DOC-${index}`, document_version: 'v1', visibility: 'internal', data_class: 'internal' }
}
function task(index: number, role: RenewalResearchPlan['tasks'][number]['role'] = 'building_delivery') {
  return { id: `task-${index}`, role, question: `核对第${index}项改造依据`, source_ids: [`s${index}`] }
}
function note(index: number, row = source(index)): RenewalResearchNote {
  return { task_id: `task-${index}`, summary: `第${index}项资料支持继续核对候选措施。`,
    observations: [{ source_id: `s${index}`, quote: `第${index}项原文记载居民需求和更新措施。`, locator: row.locator, inference: '这是专家条件化推断，当前实施状态仍待核。' }], missing_data: ['本轮实施状态'] }
}
async function read(call: Call, ids: string[], options: { query?: string; offset?: number; limit?: number } = {}, signal = new AbortController().signal) {
  return call.ctx.tools.execute({ name: call.allowedTools[0], arguments: { source_ids: ids, ...options }, signal, callId: `${call.stage}:read` as ToolCallId })
}
function scenario(): RenewalResearchNote {
  return { task_id: 'task-1', summary: '直接匹配不足，提供可调整的设施投入情景。', observations: [], missing_data: ['核实实际使用量与报价'],
    reasoned_proposals: [{ kind: 'scenario', premises: ['当前研究的是候选服务设施，暂无本项目的直接造价资料。'], assumptions: ['假设配置2处，每处10万元；数量与单价均为情景参数。'],
      conclusion: '该情景投入20万元，按给定数量与单价范围为8至36万元。', verification: '用本项目实测数量和同范围报价替换后重算。', evidence_refs: [], parameters: [
        { name: '拟配置数量', value: 2, unit: '处', low: 1, high: 3, basis: '明确的候选情景，尚无实测数量。' },
        { name: '单处情景投入', value: 10, unit: '万元/处', low: 8, high: 12, basis: '明确的价格敏感参数，尚无本对象报价。' },
      ] }] }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

describe('bounded native DSH renewal research workflow', () => {
  it('lets the planner select zero experts and actually replaces long bodies with original windows', async () => {
    const sources = [source(1, 3000)], before = structuredClone(sources), events: RenewalResearchProgress[] = []
    const { live, calls } = await session(async call => {
      expect(call.outputType).toBe('RenewalResearchPlan'); expect(call.allowedTools).toEqual([])
      expect(call.profile).toMatchObject({ role: 'planner', sha256: expect.stringMatching(/^[a-f0-9]{64}$/) })
      expect(call.prompt).not.toContain(sources[0].text)
      return { summary: '本轮资料集中，直接进行主研判。', tasks: [] }
    })
    const result = await runRenewalResearch(live, sources, { projectName: '本小区', signal: new AbortController().signal, onProgress: event => events.push(event) })
    expect(calls).toHaveLength(1); expect(result.notes).toEqual([]); expect(result.trace.planner_status).toBe('completed')
    expect(result.trace.compression).toBe('reduced'); expect(result.trace.output_characters).toBe(result.context.length)
    expect(result.trace.input_characters).toBe(JSON.stringify(sources).length)
    expect(result.contextValue.source_catalog[0]).not.toHaveProperty('text')
    expect(result.contextValue.source_catalog[0]).toMatchObject({ source_id: sources[0].id, document_version: 'v1', visibility: 'internal', role: 'current' })
    for (const window of result.source_windows) expect(window.text).toBe(sources[0].text.slice(window.start_char, window.end_char))
    expect(result.context).not.toContain(sources[0].text); expect(sources).toEqual(before)
    expect(live.ctx.tools.schemas()).toEqual([])
    expect(events.at(-1)?.workflow).toMatchObject({ phase: 'compression', context_before_chars: result.trace.input_characters, context_after_chars: result.trace.output_characters })
  })

  it('overlaps three DSH child calls with distinct stages and only task-scoped native source tools', async () => {
    const sources = [source(1, 200), source(2, 200), source(3, 200)], stages = new Set<string>(), barrier = deferred<void>(), events: RenewalResearchProgress[] = []
    let active = 0, peak = 0
    const { live } = await session(async call => {
      if (call.outputType === 'RenewalResearchPlan') return { summary: '按三类问题分工。', tasks: [task(1), task(2, 'cost_value'), task(3, 'residents_operations')] }
      const index = call.prompt.includes('"task-1"') ? 1 : call.prompt.includes('"task-2"') ? 2 : 3
      expect(call.profile?.role).toBe(['building_delivery', 'cost_value', 'residents_operations'][index - 1])
      stages.add(call.stage); expect(call.allowedTools).toHaveLength(2);expect(call.allowedTools[1]).toMatch(/^renewal_investigate_/)
      const result = await read(call, [`s${index}`]); expect(result.isError).toBe(false)
      const payload = JSON.parse(result.value as string)
      expect(payload.untrusted_sources).toHaveLength(1); expect(payload.untrusted_sources[0].id).toBe(`s${index}`)
      expect(payload.untrusted_sources[0].text).toBe(sources[index - 1].text)
      peak = Math.max(peak, ++active); if (active === 3) barrier.resolve()
      await barrier.promise; active--
      return note(index)
    })
    const result = await runRenewalResearch(live, sources, { projectName: '本小区', signal: new AbortController().signal, onProgress: event => events.push(event) })
    expect(peak).toBe(3); expect(stages.size).toBe(3)
    expect(result.trace.tasks.map(task => task.status)).toEqual(['completed', 'completed', 'completed'])
    expect(result.trace.planner_profile).toMatchObject({ role: 'planner', sha256: expect.stringMatching(/^[a-f0-9]{64}$/) })
    expect(result.trace.tasks.every(task => !!task.profile?.sha256 && task.profile.role === task.role)).toBe(true)
    expect(result.notes.map(item => item.observations[0].source_id)).toEqual(sources.map(source => source.id))
    expect(result.contextValue.source_catalog).toHaveLength(3); expect(result.contextValue.untrusted_expert_notes).toHaveLength(3)
    expect(result.contextValue.untrusted_expert_notes[0].observations[0].inference).toContain('专家条件化推断')
    for (const window of result.source_windows) {
      const original = sources.find(source => source.id === window.source_id)!
      expect(window.text).toBe(original.text.slice(window.start_char, window.end_char))
    }
    expect(events.some(event => event.workflow.tasks?.filter(task => task.status === 'running').length === 3)).toBe(true)
    expect(events.at(-1)?.workflow.tasks?.every(task => task.status === 'completed')).toBe(true)
    expect(live.ctx.tools.schemas()).toEqual([])
  })

  it('rejects cross-task citations and rewritten quotes while retaining the successful expert and raw evidence', async () => {
    const sources = [source(1), source(2), source(3)]
    const { live } = await session(async call => {
      if (call.outputType === 'RenewalResearchPlan') return { summary: '分组核对。', tasks: [task(1), task(2, 'cost_value'), task(3, 'residents_operations')] }
      const index = call.prompt.includes('"task-1"') ? 1 : call.prompt.includes('"task-2"') ? 2 : 3
      expect((await read(call, [`s${index}`])).isError).toBe(false)
      const value = note(index)
      if (index === 2) value.observations[0] = { ...note(1).observations[0] }
      if (index === 3) value.observations[0].quote = '这是模型补造且原始资料从未出现的事实。'
      return value
    })
    const result = await runRenewalResearch(live, sources, { projectName: '本小区', signal: new AbortController().signal })
    expect(result.notes).toHaveLength(1)
    expect(result.trace.tasks.map(task => [task.status, task.error_code])).toEqual([
      ['completed', undefined], ['failed', 'RENEWAL_RESEARCH_NOTE_SCOPE'], ['failed', 'RENEWAL_RESEARCH_QUOTE_MISMATCH'],
    ])
    expect(result.context).not.toContain('模型补造'); expect(result.contextValue.failed_tasks).toHaveLength(2)
    expect(result.contextValue.source_catalog.map(source => source.source_id)).toEqual(sources.map(source => source.id))
  })

  it('enforces source-ID scope while allowing continued reads after two pages and removing settled tools', async () => {
    const { live } = await session(async call => {
      if (call.outputType === 'RenewalResearchPlan') return { summary: '只核第一项资料。', tasks: [task(1)] }
      const denied = await read(call, ['s2']); expect(denied.isError).toBe(true)
      expect(JSON.stringify(denied)).not.toContain(source(2).text)
      expect((await read(call, ['s1'])).isError).toBe(false)
      expect((await read(call, ['s1'])).isError).toBe(false)
      expect((await read(call, ['s1'])).isError).toBe(false)
      return note(1)
    })
    const result = await runRenewalResearch(live, [source(1), source(2)], { projectName: '本小区', signal: new AbortController().signal })
    expect(result.notes).toHaveLength(1); expect(live.ctx.tools.schemas()).toEqual([])
    expect(result.trace.tasks[0].retrieval?.calls).toBe(3)
  })

  it('binds location from the verified read source without changing the borrowed model note', async () => {
    const row=source(1),returned=note(1)
    returned.observations[0].locator='model:incorrect-copy'
    Object.freeze(returned.observations[0])
    const {live}=await session(async call=>{
      if(call.outputType==='RenewalResearchPlan')return {summary:'核对投入来源。',tasks:[task(1,'cost_value')]}
      expect((await read(call,['s1'])).isError).toBe(false)
      return returned
    })
    const result=await runRenewalResearch(live,[row],{projectName:'本小区',signal:new AbortController().signal})
    expect(result.trace.tasks[0].status).toBe('completed')
    expect(result.notes[0].observations[0].locator).toBe(row.locator)
    expect(returned.observations[0].locator).toBe('model:incorrect-copy')
  })

  it('paginates a large source within the complete serialized output cap', async () => {
    const row = source(1, 3000), tail = '尾部原文明确记载服务设施改造与维护需求。'
    row.text = '"\\\n'.repeat(2000) + row.text + tail
    const { live } = await session(async call => {
      if (call.outputType === 'RenewalResearchPlan') return { summary: '核对第一项资料。', tasks: [task(1)] }
      const head = await read(call, ['s1'], { limit: 18000 })
      expect(head.isError).toBe(false); expect((head.value as string).length).toBeLessThanOrEqual(18000)
      expect(JSON.parse(head.value as string).untrusted_sources[0].text).toContain('"\\\n')
      const result = await read(call, ['s1'], { offset: row.text.length - tail.length, limit: 1000 })
      expect(result.isError).toBe(false)
      const page = JSON.parse(result.value as string).untrusted_sources[0]
      expect(page.text).toBe(tail); expect(page.source_characters).toBe(row.text.length)
      expect(page.text).toBe(row.text.slice(page.start_char, page.end_char))
      const value = note(1); value.observations[0].quote = tail
      return value
    })
    const result = await runRenewalResearch(live, [row], { projectName: '本小区', signal: new AbortController().signal })
    expect(result.notes[0].observations[0].quote).toBe(tail)
    expect(result.trace.tasks[0]).toMatchObject({ status: 'completed', reasoning: 'direct_evidence', retrieval: { calls: 2 } })
    expect(result.trace.tasks[0].retrieval?.read_windows.every(window => window.source_id === row.id)).toBe(true)
  })

  it('keeps distant quotes as separate original windows and includes expert-note overhead in compression counts', async () => {
    const row = source(1), last = '后段原文明确记载已安装设施的维护需求。'
    row.text += '居中的资料正文。'.repeat(1400) + last
    const { live } = await session(async call => {
      if (call.outputType === 'RenewalResearchPlan') return { summary: '核对同一来源前后两处依据。', tasks: [task(1)] }
      expect((await read(call, ['s1'], { limit: 1000 })).isError).toBe(false)
      expect((await read(call, ['s1'], { offset: row.text.length - last.length, limit: 1000 })).isError).toBe(false)
      const result = note(1)
      result.observations.push({ source_id: 's1', quote: last, locator: row.locator, inference: '维护需求与新建设施应分别分析。' })
      return result
    })
    const result = await runRenewalResearch(live, [row], { projectName: '本小区', signal: new AbortController().signal })
    expect(result.source_windows).toHaveLength(2)
    expect(result.source_windows[0].end_char).toBeLessThan(result.source_windows[1].start_char)
    for (const observation of result.notes[0].observations) expect(result.source_windows.some(window => window.text.includes(observation.quote))).toBe(true)
    for (const window of result.source_windows) expect(window.text).toBe(row.text.slice(window.start_char, window.end_char))
    expect(result.trace.output_characters).toBe(JSON.stringify(result.contextValue).length)
    expect(result.trace.output_characters).toBeGreaterThan(result.trace.retained_source_characters)
    expect(result.trace.compression).toBe('reduced')
    const tiny = await session(async () => ({ summary: '本轮直接研判。', tasks: [] }))
    const retained = await runRenewalResearch(tiny.live, [source(1)], { projectName: '本小区', signal: new AbortController().signal })
    expect(retained.trace.output_characters).toBeGreaterThan(retained.trace.input_characters)
    expect(retained.trace.compression).toBe('retained')
  })

  it('freezes a source snapshot before planning and rejects plans outside that manifest', async () => {
    const sources = [source(1)], original = structuredClone(sources[0])
    const { live } = await session(async call => {
      if (call.outputType === 'RenewalResearchPlan') { sources[0].text = '外部并发改动，不是本轮原文。'; return { summary: '核对冻结资料。', tasks: [task(1)] } }
      const result = await read(call, ['s1']); expect(JSON.parse(result.value as string).untrusted_sources[0].text).toBe(original.text)
      return note(1)
    })
    const result = await runRenewalResearch(live, sources, { projectName: '本小区', signal: new AbortController().signal })
    expect(result.notes[0].observations[0].quote).toBe(original.text)
    expect(result.context).not.toContain('外部并发改动')
    const foreign = await session(async () => ({ summary: '不合法跨项目分工。', tasks: [{ ...task(1), source_ids: ['FOREIGN-PROJECT'] }] }))
    await expect(runRenewalResearch(foreign.live, [original], { projectName: '本小区', signal: new AbortController().signal })).rejects.toThrow('RENEWAL_RESEARCH_PREFLIGHT_FAILED')
    expect(foreign.calls).toHaveLength(1)
  })

  it('drains every started child before cancellation removes shared tool registrations', async () => {
    const controller = new AbortController(), started = deferred<void>(), releaseSecond = deferred<void>()
    let active = 0, completed = 0
    const { live } = await session(async call => {
      if (call.outputType === 'RenewalResearchPlan') return { summary: '核对两项资料。', tasks: [task(1), task(2, 'cost_value')] }
      const index = ++active; if (active === 2) started.resolve()
      try {
        await new Promise<void>((_resolve, reject) => controller.signal.addEventListener('abort', () => {
          if (index === 1) reject(controller.signal.reason)
          else void releaseSecond.promise.then(() => reject(controller.signal.reason))
        }, { once: true }))
      } finally { completed++ }
      return note(index)
    })
    const pending = runRenewalResearch(live, [source(1), source(2)], { projectName: '本小区', signal: controller.signal })
    await started.promise; controller.abort(new Error('fixture cancellation'))
    await Promise.resolve(); expect(live.ctx.tools.schemas()).toHaveLength(4)
    releaseSecond.resolve(); await expect(pending).rejects.toThrow('fixture cancellation')
    expect(completed).toBe(2); expect(live.ctx.tools.schemas()).toEqual([])
  })

  it('keeps a zero-hit local query as a successful conditional scenario without invented observations or facts', async () => {
    const row = source(1), before = structuredClone(row)
    row.title = '星际火箭发射台：标题词不能冒充正文命中'
    const { live } = await session(async call => {
      if (call.outputType === 'RenewalResearchPlan') return { summary: '检索后提供条件化投入情景。', tasks: [task(1, 'cost_value')] }
      const result = await read(call, ['s1'], { query: '星际火箭发射台', limit: 4000 })
      expect(result.isError).toBe(false)
      expect(JSON.parse(result.value as string)).toMatchObject({ matched_chunks: 0, untrusted_sources: [] })
      return scenario()
    })
    const result = await runRenewalResearch(live, [row], { projectName: '本小区', signal: new AbortController().signal })
    expect(result.trace.tasks[0]).toMatchObject({ status: 'completed', reasoning: 'reasoned_fallback', retrieval: { calls: 1, query_matches: 0, read_windows: [] } })
    expect(result.notes[0].observations).toEqual([])
    expect(result.notes[0].reasoned_proposals?.[0].evidence_refs).toEqual([])
    expect(result.notes[0].reasoned_proposals?.[0].parameters?.[0]).toMatchObject({ name: '拟配置数量', value: 2, low: 1, high: 3, unit: '处' })
    expect(result.contextValue.source_catalog).toHaveLength(1)
    expect(result.contextValue.evidence_windows.every(window => row.text.includes(window.text))).toBe(true)
    expect(row.text).toBe(before.text)
    expect(strategyConstructionAllowed('rebuild', [], [row])).toBe(false)
    expect(strategyConstructionAllowed('comprehensive', [], [row])).toBe(false)
  })

  it('rejects a real tail quote when only the head was returned', async () => {
    const row = source(1, 2500), tail = '尾部记录是本轮尚未读取的真实原文。'; row.text += tail
    const { live } = await session(async call => {
      if (call.outputType === 'RenewalResearchPlan') return { summary: '核对第一项资料。', tasks: [task(1)] }
      expect((await read(call, ['s1'], { limit: 100 })).isError).toBe(false)
      const value = note(1); value.observations[0].quote = tail; return value
    })
    const result = await runRenewalResearch(live, [row], { projectName: '本小区', signal: new AbortController().signal })
    expect(result.notes).toEqual([]); expect(result.trace.tasks[0]).toMatchObject({ status: 'failed', error_code: 'RENEWAL_RESEARCH_READ_WINDOW_MISMATCH' })
  })

  it('allows explicit logical inference after zero hits without forcing a numerical scenario or quote', async () => {
    const { live } = await session(async call => {
      if (call.outputType === 'RenewalResearchPlan') return { summary: '核对可达性措施的逻辑。', tasks: [task(1)] }
      expect((await read(call, ['s1'], { query: '星际火箭发射台' })).isError).toBe(false)
      return { task_id: 'task-1', summary: '无直接匹配，按明确前提提出措施比较。', observations: [], missing_data: ['核对既有建筑的出入口与通行路径'],
        reasoned_proposals: [{ kind: 'logical_inference', premises: ['若保留现有建筑并改善可达性，设施布置需与通行路径共同核对。'], assumptions: [],
          conclusion: '先比较入口坡道与垂直交通设施的衔接方案，再用现场尺寸筛选候选位置。', verification: '用出入口、通道和高差实测检验候选位置是否连通。', evidence_refs: [] }] }
    })
    const result = await runRenewalResearch(live, [source(1)], { projectName: '本小区', signal: new AbortController().signal })
    expect(result.trace.tasks[0]).toMatchObject({ status: 'completed', reasoning: 'reasoned_fallback' })
    expect(result.notes[0].reasoned_proposals?.[0]).toMatchObject({ kind: 'logical_inference', assumptions: [], evidence_refs: [] })
    expect(result.notes[0].observations).toEqual([])
  })

  it('does not mark a no-hit note complete when it supplies neither observations nor reasoned proposals', async () => {
    const { live } = await session(async call => {
      if (call.outputType === 'RenewalResearchPlan') return { summary: '检索后主动分析。', tasks: [task(1)] }
      await read(call, ['s1'], { query: '星际火箭发射台' })
      return { task_id: 'task-1', summary: '暂缺匹配。', observations: [], missing_data: ['补充资料'] }
    })
    const result = await runRenewalResearch(live, [source(1)], { projectName: '本小区', signal: new AbortController().signal })
    expect(result.trace.tasks[0]).toMatchObject({ status: 'failed', error_code: 'RENEWAL_RESEARCH_REASONING_REQUIRED' })
    expect(result.notes).toEqual([])
  })

  it('uses existing lexical query expansion and keeps Unicode query windows in exact UTF-16 coordinates', async () => {
    const row = source(1), quote = '后段原文记载需要增设电梯及配套设施。'
    row.text = '😀'.repeat(200) + '本段只有一般情况。'.repeat(2400) + quote
    const { live } = await session(async call => {
      if (call.outputType === 'RenewalResearchPlan') return { summary: '检索电梯依据。', tasks: [task(1)] }
      const result = await read(call, ['s1'], { query: '加梯', limit: 6000 })
      expect(result.isError).toBe(false)
      const payload = JSON.parse(result.value as string)
      expect(payload.query_expansions.some((row: { added_term: string }) => row.added_term === '电梯')).toBe(true)
      expect(payload.matched_chunks).toBeGreaterThan(0)
      for (const window of payload.untrusted_sources) expect(window.text).toBe(row.text.slice(window.start_char, window.end_char))
      expect(payload.untrusted_sources.some((window: { text: string }) => window.text.includes(quote))).toBe(true)
      const value = note(1); value.observations[0].quote = quote; return value
    })
    const result = await runRenewalResearch(live, [row], { projectName: '本小区', signal: new AbortController().signal })
    expect(result.trace.tasks[0].status).toBe('completed')
    for (const window of result.source_windows) expect(window.text).toBe(row.text.slice(window.start_char, window.end_char))
  })

  it.each([
    { query: '电梯户数', text: '本小区共有252户居民。', matched: false },
    { query: '户数', text: '本小区共有252户居民。', matched: true },
    { query: '电梯户数', text: '本小区共有252户，已登记电梯2台。', matched: true },
  ])('keeps count units from substituting for an explicit facility topic: %j', async testCase => {
    const row = source(1); row.title = '本小区电梯与居民统计'; row.text = testCase.text
    const { live } = await session(async call => {
      if (call.outputType === 'RenewalResearchPlan') return { summary: '检索设施与计数资料。', tasks: [task(1)] }
      const result = await read(call, ['s1'], { query: testCase.query })
      expect(result.isError).toBe(false)
      const payload = JSON.parse(result.value as string)
      expect(payload.matched_chunks > 0).toBe(testCase.matched)
      if (!testCase.matched) { expect(payload.untrusted_sources).toEqual([]); return scenario() }
      const value = note(1); value.observations[0].quote = row.text; return value
    })
    const result = await runRenewalResearch(live, [row], { projectName: '本小区', signal: new AbortController().signal })
    expect(result.trace.tasks[0].status).toBe('completed')
    expect(result.trace.tasks[0].reasoning).toBe(testCase.matched ? 'direct_evidence' : 'reasoned_fallback')
  })

  it('does not count an unsuccessful UTF-16 page read as completed retrieval', async () => {
    const row = source(1); row.text = '😀' + row.text
    const { live } = await session(async call => {
      if (call.outputType === 'RenewalResearchPlan') return { summary: '检索后研究情景。', tasks: [task(1)] }
      const result = await read(call, ['s1'], { offset: 1 })
      expect(result.isError).toBe(true); expect(JSON.stringify(result)).toContain('RENEWAL_RESEARCH_OFFSET_BOUNDARY')
      return scenario()
    })
    const result = await runRenewalResearch(live, [row], { projectName: '本小区', signal: new AbortController().signal })
    expect(result.trace.tasks[0]).toMatchObject({ status: 'failed', error_code: 'RENEWAL_RESEARCH_RETRIEVAL_REQUIRED', retrieval: { calls: 0 } })
  })

  it.each(['foreign', 'unread'] as const)('rejects %s proposal evidence while allowing explicitly empty references', async kind => {
    const { live } = await session(async call => {
      if (call.outputType === 'RenewalResearchPlan') return { summary: '检索后研究情景。', tasks: [task(1)] }
      expect((await read(call, ['s1'], { query: '星际火箭发射台' })).isError).toBe(false)
      const value = scenario(); value.reasoned_proposals![0].evidence_refs = [kind === 'foreign' ? 's2' : 's1']; return value
    })
    const result = await runRenewalResearch(live, [source(1), source(2)], { projectName: '本小区', signal: new AbortController().signal })
    expect(result.notes).toEqual([]); expect(result.trace.tasks[0]).toMatchObject({ status: 'failed', error_code: 'RENEWAL_RESEARCH_PROPOSAL_SCOPE' })
  })

  it.each([
    { low: 3, value: 2, high: 4 }, { low: 1, value: 5, high: 4 }, { low: 4, value: 3, high: 2 },
    { low: 1, value: Number.POSITIVE_INFINITY, high: 4 }, { low: 1, value: Number.NaN, high: 4 },
  ])('rejects invalid scenario parameter ranges: %j', async range => {
    const { live } = await session(async call => {
      if (call.outputType === 'RenewalResearchPlan') return { summary: '检索后研究情景。', tasks: [task(1)] }
      expect((await read(call, ['s1'], { query: '星际火箭发射台' })).isError).toBe(false)
      const value = scenario(); Object.assign(value.reasoned_proposals![0].parameters![0], range); return value
    })
    const result = await runRenewalResearch(live, [source(1)], { projectName: '本小区', signal: new AbortController().signal })
    expect(result.trace.tasks[0].status).toBe('failed'); expect(result.notes).toEqual([])
    expect(['RENEWAL_RESEARCH_SCHEMA', 'RENEWAL_RESEARCH_PARAMETER_RANGE']).toContain(result.trace.tasks[0].error_code)
  })

  it('accepts an exact scenario range but requires assumptions and an actual retrieval attempt', async () => {
    const { live } = await session(async call => {
      if (call.outputType === 'RenewalResearchPlan') return { summary: '检索后研究情景。', tasks: [task(1)] }
      expect((await read(call, ['s1'], { query: '星际火箭发射台' })).isError).toBe(false)
      const value = scenario(); Object.assign(value.reasoned_proposals![0].parameters![0], { low: 2, value: 2, high: 2 }); return value
    })
    const result = await runRenewalResearch(live, [source(1)], { projectName: '本小区', signal: new AbortController().signal })
    expect(result.trace.tasks[0]).toMatchObject({ status: 'completed', reasoning: 'reasoned_fallback' })
    for (const mode of ['no_assumptions', 'no_retrieval'] as const) {
      const invalid = await session(async call => {
        if (call.outputType === 'RenewalResearchPlan') return { summary: '研究情景。', tasks: [task(1)] }
        if (mode !== 'no_retrieval') await read(call, ['s1'], { query: '星际火箭发射台' })
        const value = scenario(); if (mode === 'no_assumptions') value.reasoned_proposals![0].assumptions = []; return value
      })
      const rejected = await runRenewalResearch(invalid.live, [source(1)], { projectName: '本小区', signal: new AbortController().signal })
      expect(rejected.trace.tasks[0]).toMatchObject({ status: 'failed', error_code: mode === 'no_retrieval' ? 'RENEWAL_RESEARCH_RETRIEVAL_REQUIRED' : 'RENEWAL_RESEARCH_SCENARIO_ASSUMPTION_REQUIRED' })
    }
  })

  it.each([{ offset: -1 }, { offset: 1.5 }, { limit: 0 }, { limit: 18001 }, { query: '查'.repeat(281) }])('validates host page bounds: %j', async options => {
    const { live } = await session(async call => {
      if (call.outputType === 'RenewalResearchPlan') return { summary: '核对分页参数。', tasks: [task(1)] }
      expect((await read(call, ['s1'], options)).isError).toBe(true)
      expect((await read(call, ['s1'])).isError).toBe(false); return note(1)
    })
    const result = await runRenewalResearch(live, [source(1)], { projectName: '本小区', signal: new AbortController().signal })
    expect(result.trace.tasks[0]).toMatchObject({ status: 'completed', retrieval: { calls: 1 } })
  })
})

it('repairs a specialist citation in its own stage and retains each quote exactly once in compact context',async()=>{
  let attempts=0
  const {live,calls}=await session(async call=>{
    if(call.outputType==='RenewalResearchPlan')return {summary:'只核一项依据。',tasks:[task(1)]}
    await read(call,['s1'])
    const value=note(1);if(++attempts===1)value.observations[0].quote='模型误写且原文没有这一句。'
    return value
  })
  const result=await runRenewalResearch(live,[source(1,1000)],{projectName:'本小区',signal:new AbortController().signal})
  expect(attempts).toBe(2);expect(result.trace.tasks[0]).toMatchObject({status:'completed',attempts:2})
  expect(calls.at(-1)?.prompt).toContain('本专家结果刚被同一校验器拒绝')
  const observation=result.contextValue.untrusted_expert_notes[0].observations[0]
  expect(observation).not.toHaveProperty('quote')
  const window=result.contextValue.evidence_windows.find(window=>window.source_id===observation.source_id)!
  const ref=observation.quote_ref
  expect(window.text.slice(ref.start_char-window.start_char,ref.end_char-window.start_char)).toBe(result.notes[0].observations[0].quote)
  expect(result.trace.retained_quotes).toBe(result.trace.quoted_passages)
  expect(result.trace.compression_ratio).toBeLessThan(1)
})
it('a failed small planner readiness call prevents experts from starting',async()=>{
  const {live,calls}=await session(async()=>{throw new Error('LIVE_STAGE_FAILED:planner:error:TRANSPORT')})
  await expect(runRenewalResearch(live,[source(1)],{projectName:'本小区',signal:new AbortController().signal})).rejects.toThrow('RENEWAL_RESEARCH_PREFLIGHT_FAILED')
  expect(calls).toHaveLength(1);expect(calls[0].outputType).toBe('RenewalResearchPlan')
})

it('recovers a truncated specialist before synthesis with more output room under the same deadline',async()=>{
  let attempts=0
  const {live,calls}=await session(async call=>{
    if(call.outputType==='RenewalResearchPlan')return {summary:'核对一项依据',tasks:[task(1)]}
    if(++attempts===1)throw new Error('LIVE_STAGE_FAILED:expert:max-tokens:no structured result')
    await read(call,['s1']);return note(1)
  })
  const result=await runRenewalResearch(live,[source(1)],{projectName:'本小区',signal:new AbortController().signal})
  const experts=calls.filter(call=>call.outputType==='RenewalResearchNote')
  expect(experts).toHaveLength(2)
  expect(experts[1].execution!.maxOutputTokens).toBeGreaterThan(experts[0].execution!.maxOutputTokens!)
  expect(experts[1].execution!.signal).toBe(experts[0].execution!.signal)
  expect(result.trace.tasks[0]).toMatchObject({status:'completed',attempts:2})
})

it('uses the Decision routing result instead of a separate DSH planner and applies brief effort to the expert',async()=>{
 const row=source(1)
 const {live,calls}=await session(async call=>{
  expect(call.outputType).toBe('RenewalResearchNote')
  const result=await read(call,['s1']);expect(result.isError).toBe(false)
  return {...note(1,row),task_id:'fast-building_delivery'}
 })
 const decisionRoute={policy:'decision-research-routing-v1' as const,request_id:'FAST',input_hash:'snapshot',duration_ms:10,input_tokens:100,tasks:[{role:'building_delivery' as const,effort:'brief' as const,confidence:.9},{role:'cost_value' as const,effort:'skip' as const,confidence:.9},{role:'residents_operations' as const,effort:'skip' as const,confidence:.9}]}
 const result=await runRenewalResearch(live,[row],{projectName:'本小区',signal:new AbortController().signal,decisionRoute})
 expect(calls).toHaveLength(1)
 expect(calls[0].outputType).toBe('RenewalResearchNote')
 expect(calls[0].execution?.maxOutputTokens).toBe(3000)
 expect(calls[0].prompt).toContain('简短分析')
 expect(result.trace.planner_backend).toBe('decision')
 expect(result.trace.decision_routing?.request_id).toBe('FAST')
 expect(result.trace.plan?.tasks[0].source_ids).toEqual([row.id])
})
