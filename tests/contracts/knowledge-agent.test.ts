import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ExperienceDraft, KnowledgeAgentAssessment, KnowledgeCitation, ProjectInput } from '../../apps/host/generated/contracts'
import { config } from '../../apps/host/config'
import { Store, type RunRecord } from '../../apps/host/store'
import { ExperienceService } from '../../packages/experience/service'
import { hash } from '../../packages/intelligence/domain'
import { digest, executeRun } from '../../runtime/workflows/run'
import { resolveRunKnowledge, type KnowledgeResolution } from '../../runtime/workflows/knowledge'

const ports = vi.hoisted(() => ({ open: vi.fn() }))
vi.mock('../../runtime/dsh/live-session', () => ({ LiveSession: { open: ports.open } }))
import { executeKnowledgeAgent, validateKnowledgeAssessment } from '../../runtime/workflows/knowledge-agent'

const initialConfig = { modelConfigured: config.modelConfigured, dataDir: config.dataDir, ALLOW_INTERNAL_MODEL: config.ALLOW_INTERNAL_MODEL }
const cleanups: { store: Store; directory: string }[] = []
const raw = '举措：排水管网改造\n关键条件：居民需求已确认\n实际决策：先更新排水管网\n实际实施：管网更新完成\n执行结果：雨季倒灌减少'
beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(config, { modelConfigured: true, ALLOW_INTERNAL_MODEL: 'false' })
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('UNEXPECTED_NETWORK_CALL'))
})
afterEach(async () => {
  vi.restoreAllMocks(); Object.assign(config, initialConfig)
  for (const item of cleanups.splice(0)) { await item.store.db.close(); await rm(item.directory, { recursive: true, force: true }) }
})

async function fixture(kinds: ('case' | 'rule')[] = ['case'], veto = false) {
  const directory = await mkdtemp(join(tmpdir(), 'knowledge-agent-')), store = await Store.open(directory)
  cleanups.push({ store, directory }); config.dataDir = directory
  const service = new ExperienceService(store); await service.initialize()
  const targetId = 'TARGET-' + randomUUID(), input: ProjectInput = {
    schema_version: '2.0', project_id: targetId, synthetic: true, purpose: '排水举措Agent工程夹具', mode: 'automatic', role: 'planner', as_of: '2099-01-01', business_profile: 'neighborhood',
    scope: { name: '明确合成小区', geometry: null, coordinate_encoding: 'WGS84', legal_parcel_confirmed: false },
    sources: [{ id: 'S-TARGET', title: '合成条件原文', visibility: 'public', data_class: 'synthetic', synthetic: true, hash: 'target-v1', locator: 'line:1', untrusted_text: '居民需求已确认\n工程安全否决已确认', content_status: 'full_text', parse_status: 'extracted', published_at: '2026-09-01', object_refs: ['project:' + targetId], evidence_scope: 'object' }],
    facts: [{ id: 'F-RESIDENT', kind: 'retrofit.resident_needs_confirmed', value: true, unit: null, source_id: 'S-TARGET', object_ref: 'project:' + targetId, scope_kind: 'project', epistemic_status: 'fact', locator: 'line:1', observed_at: '2026-09-20' }],
    context_rules: [], candidate_ids: ['retain_and_reuse', 'whole_site_rebuild', 'defer_and_investigate'], events: [], knowledge_query: { measure_key: 'drainage.update', question: '排水管网改造' },
  }
  if (veto) input.facts.push({ ...input.facts[0], id: 'F-VETO', kind: 'retrofit.safety_veto', locator: 'line:2' })
  const putProject = async (value: ProjectInput) => {
    await store.db.query('INSERT INTO projects(id,owner_id,name,input) VALUES($1,$2,$3,$4)', [value.project_id, config.ownerId, value.scope.name, JSON.stringify(value)])
    return (await store.project(value.project_id, config.ownerId))!
  }
  await putProject(input)
  const cards = []
  for (const kind of kinds) {
    const projectId = 'HISTORY-' + randomUUID(), documentId = 'DOC-' + randomUUID(), version = hash(raw)
    const historical = structuredClone(input); historical.project_id = projectId
    historical.sources = [{ id: documentId, title: '合成历史原文', visibility: 'public', data_class: 'synthetic', synthetic: true, hash: version, locator: 'document:' + documentId, content_status: 'uploaded', parse_status: 'extracted' }]
    historical.facts = []
    const project = await putProject(historical)
    await store.db.query('INSERT INTO documents(id,project_id,file_name,blob_name,sha256,parser_result) VALUES($1,$2,$3,$4,$5,$6)', [documentId, projectId, 'synthetic.txt', 'test-only', version, JSON.stringify({ status: 'extracted', text: raw, source_hash: version })])
    const citation = (line: number, quote: string) => ({ document_id: documentId, version, locator: 'line:' + line, quote })
    const draft: ExperienceDraft = { title: '排水管网改造', project_type: '', development_mode: '', stage: '', fields: [
      { key: 'actual_decision', value: '先更新排水管网', evidence: [citation(3, '实际决策：先更新排水管网')] },
      { key: 'implementation', value: '管网更新完成', evidence: [citation(4, '实际实施：管网更新完成')] },
      { key: 'outcome', value: '雨季倒灌减少', evidence: [citation(5, '执行结果：雨季倒灌减少')] },
    ], knowledge: { kind, origin: kind === 'case' ? 'project_case' : 'practice', measure_key: 'drainage.update', measure_name: '排水管网改造', conditions: [{ fact_kind: 'retrofit.resident_needs_confirmed', label: '居民需求已确认', operator: 'eq', value: true, source_value: '居民需求已确认', unit: null, evidence: [citation(2, '关键条件：居民需求已确认')] }], exclusions: [], transfer_notes: [], evidence_level: kind === 'case' ? 'implementation_record' : 'expert_practice' } }
    const created = await service.create(project, draft)
    cards.push(await service.review(project, created.id, created.revision, 'approved', '合成测试原文核对'))
  }
  const makeRun = async () => {
    const revision = Number((await store.db.query<{ revision: number }>('SELECT COALESCE(MAX(revision),0)+1 AS revision FROM runs WHERE project_id=$1', [targetId])).rows[0].revision)
    return (await store.db.query<RunRecord>('INSERT INTO runs(id,project_id,revision,context_version,status,execution_mode,snapshot,snapshot_hash,idempotency_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *', ['RUN-' + randomUUID(), targetId, revision, 0, 'running', 'live', JSON.stringify(input), digest(input), 'agent-' + randomUUID()])).rows[0]
  }
  const run = await makeRun(), resolution = await resolveRunKnowledge(store, run, new AbortController().signal)
  return { store, input, run, resolution, cards, makeRun }
}

function kbCitation(resolution: KnowledgeResolution, cardId: string): KnowledgeCitation {
  const source = resolution.sources.find(source => source.id.startsWith(`S-KB-${cardId}-R`))!
  const payload = JSON.parse(source.untrusted_text!)
  const evidence = payload.citations.find((citation: { quote: string }) => citation.quote === '实际决策：先更新排水管网')
  return { source_id: source.id, locator: evidence.locator, quote: evidence.quote }
}
function assessment(resolution: KnowledgeResolution): KnowledgeAgentAssessment {
  const hits = [...resolution.trace.case_hits, ...resolution.trace.rule_hits], current: KnowledgeCitation = { source_id: 'S-TARGET', locator: 'line:1', quote: '居民需求已确认' }
  return {
    summary: '依据历史举措和当前居民条件，优先补齐工程接口后研判。',
    decision: { action: 'supplement', reasoning: '已核实居民需求，工程专项前提仍待补充。', citations: [kbCitation(resolution, hits[0].card_id), current] },
    recommendations: hits.map(hit => ({ measure_key: hit.measure_key, advice: '先核实管网接口，再安排试验段', reasoning: '历史举措具备居民需求条件，当前工程接口需现场核实。', matched_card_ids: [hit.card_id], matched_condition_keys: hit.conditions.map(row => row.condition.fact_kind), citations: [kbCitation(resolution, hit.card_id), current], unknowns: ['当前管网接口尚未核实'], next_steps: ['取得管线图并核查接口'] })), disagreements: [],
  }
}
function provider(value: KnowledgeAgentAssessment, options: { read?: boolean; fail?: boolean; abort?: AbortController } = {}) {
  const reads = new Map<string, () => Promise<unknown>>(), register = vi.fn((name: string, _description: string, read: () => Promise<unknown>) => { reads.set(name, read) })
  const observed: unknown[] = []
  const call = vi.fn(async (_stage: string, _prompt: string, _type: string, _allowed: string[]) => {
    if (options.read !== false) observed.push(await reads.get('knowledge_evidence')!())
    if (options.abort) { options.abort.abort(new Error('RUN_CANCELLED')); options.abort.signal.throwIfAborted() }
    if (options.fail) throw new Error('LIVE_STAGE_FAILED:knowledge_agent:failed:test-provider')
    return { value: structuredClone(value), sessionId: 'MOCK-KNOWLEDGE-AGENT' }
  })
  const close = vi.fn(async () => {})
  ports.open.mockResolvedValue({ registerReadTool: register, call, close, calls: [{ stage: 'knowledge_agent', requested_model: 'test-provider', returned_model: 'test-provider', finish_reason: 'stop', input_tokens: 1, output_tokens: 1, duration_ms: 1, session_id: 'MOCK-KNOWLEDGE-AGENT' }] })
  return { register, call, close, reads, observed }
}

describe('source-bound knowledge Agent validation and execution', () => {
  it.each([['case_hit', ['case']], ['rule_hit', ['rule']], ['combined_hit', ['case', 'rule']]] as const)('assesses %s through one bounded Agent with real evidence-tool access and per-item references', async (route, kinds) => {
    const setup = await fixture([...kinds]), value = assessment(setup.resolution), mock = provider(value)
    expect(validateKnowledgeAssessment(setup.input, setup.resolution, value)).toEqual(value)
    const bodyInput = structuredClone(setup.input), bodyValue = structuredClone(value)
    bodyInput.sources[0].locator = 'body'
    for (const citation of [...bodyValue.decision.citations, ...bodyValue.recommendations.flatMap(advice => advice.citations)]) {
      if (citation.source_id === 'S-TARGET') citation.locator = 'body'
    }
    expect(validateKnowledgeAssessment(bodyInput, setup.resolution, bodyValue)).toEqual(bodyValue)
    await executeKnowledgeAgent(setup.store, setup.run, new AbortController().signal, setup.resolution)
    const packet = (await setup.store.run(setup.run.id, config.ownerId))!.decision!
    expect(packet.knowledge?.route).toBe(route)
    expect(packet.knowledge?.agent_status).toBe('executed')
    expect(packet.knowledge_agent?.assessment).toEqual(value)
    expect(packet.analysis_method).toBe('model_assisted')
    expect(ports.open).toHaveBeenCalledTimes(1); expect(mock.call).toHaveBeenCalledTimes(1)
    expect(mock.register).toHaveBeenCalledWith('knowledge_evidence', expect.any(String), expect.any(Function))
    expect(mock.call.mock.calls[0][0]).toBe('knowledge_agent')
    expect(mock.call.mock.calls[0][2]).toBe('KnowledgeAgentAssessment')
    expect(mock.call.mock.calls[0][3]).toEqual(['knowledge_evidence'])
    expect(mock.observed).toHaveLength(1)
    expect(JSON.stringify(mock.observed[0])).toContain('实际决策：先更新排水管网')
    expect(packet.knowledge_agent!.final_citations).toEqual(expect.arrayContaining(value.decision.citations))
    for (const citation of value.decision.citations) expect(packet.knowledge_agent!.decision_evidence_refs).toContain(citation.source_id)
    for (const recommendation of value.recommendations) {
      const finding = packet.findings.find(finding => finding.claim === recommendation.advice
        && recommendation.citations.every(citation => finding.evidence_refs.includes(citation.source_id)))!
      expect(finding).toBeDefined()
      for (const citation of recommendation.citations) {
        expect(packet.sources.some(source => source.id === citation.source_id)).toBe(true)
        expect(finding.evidence_refs).toContain(citation.source_id)
      }
    }
    expect(mock.close).toHaveBeenCalledTimes(1); expect(fetch).not.toHaveBeenCalled()
  }, 30000)

  it.each(['unknown_source', 'wrong_locator', 'forged_quote', 'non_hit_card', 'wrong_condition', 'wrong_measure', 'missing_kb_citation', 'decision_without_kb', 'advice_kb_only', 'decision_kb_only', 'empty_conditions', 'outside_tool_source', 'wrong_page', 'wrong_table', 'wrong_line_quote', 'blank_quote'] as const)('rejects %s instead of borrowing a valid unrelated citation', async invalid => {
    const setup = await fixture(), value = assessment(setup.resolution)
    if (invalid === 'unknown_source') value.decision.citations[0].source_id = 'S-NOT-ALLOWED'
    if (invalid === 'wrong_locator') value.recommendations[0].citations[0].locator = 'line:999'
    if (invalid === 'forged_quote') value.recommendations[0].citations[0].quote = '原文没有该结论'
    if (invalid === 'non_hit_card') value.recommendations[0].matched_card_ids = ['EXP-NOT-MATCHED']
    if (invalid === 'wrong_condition') value.recommendations[0].matched_condition_keys = ['retrofit.nonexistent']
    if (invalid === 'wrong_measure') value.recommendations[0].measure_key = 'elevator.install'
    if (invalid === 'missing_kb_citation') value.recommendations[0].citations = [value.decision.citations[1]]
    if (invalid === 'decision_without_kb') value.decision.citations = [value.decision.citations[1]]
    if (invalid === 'advice_kb_only') value.recommendations[0].citations = [value.recommendations[0].citations[0]]
    if (invalid === 'decision_kb_only') value.decision.citations = [value.decision.citations[0]]
    if (invalid === 'empty_conditions') value.recommendations[0].matched_condition_keys = []
    if (invalid === 'outside_tool_source') {
      setup.input.sources.push({ id: 'S-OUTSIDE-TOOL', title: '项目内但不属于本轮命中依据', visibility: 'public', data_class: 'synthetic', synthetic: true, hash: 'other-v1', locator: 'body', content_status: 'full_text', untrusted_text: '真实但不属于工具提供集合的正文' })
      value.recommendations[0].citations.push({ source_id: 'S-OUTSIDE-TOOL', locator: 'body', quote: '真实但不属于工具提供集合的正文' })
    }
    if (invalid === 'wrong_page') value.recommendations[0].citations[1].locator = 'page:99'
    if (invalid === 'wrong_table') value.recommendations[0].citations[1].locator = 'sheet:不存在/row:99'
    if (invalid === 'wrong_line_quote') value.recommendations[0].citations[1].quote = '工程安全否决已确认'
    if (invalid === 'blank_quote') {
      setup.input.sources[0].untrusted_text = setup.input.sources[0].untrusted_text!.replace('居民需求已确认', '居民需求已确认   ')
      value.recommendations[0].citations[1].quote = '   '
    }
    expect(() => validateKnowledgeAssessment(setup.input, setup.resolution, value)).toThrow()
    expect(ports.open).not.toHaveBeenCalled()
  }, 30000)

  it('requires a multi-card recommendation to cite each declared matched card as well as current conditions', async () => {
    const setup = await fixture(['case', 'rule']), value = assessment(setup.resolution)
    const first = value.recommendations[0]
    first.matched_card_ids = value.recommendations.flatMap(advice => advice.matched_card_ids)
    first.citations = [...value.recommendations.map(advice => advice.citations[0]), first.citations[1]]
    value.recommendations = [first]
    expect(validateKnowledgeAssessment(setup.input, setup.resolution, value)).toEqual(value)
    const missingCardReference = structuredClone(value); missingCardReference.recommendations[0].citations.splice(1, 1)
    expect(() => validateKnowledgeAssessment(setup.input, setup.resolution, missingCardReference)).toThrow()
    const mock = provider(value)
    await executeKnowledgeAgent(setup.store, setup.run, new AbortController().signal, setup.resolution)
    const packet = (await setup.store.run(setup.run.id, config.ownerId))!.decision!
    expect(packet.knowledge_agent!.assessed_card_ids).toEqual(first.matched_card_ids)
    for (const citation of first.citations) expect(packet.findings[0].evidence_refs).toContain(citation.source_id)
    expect(mock.call).toHaveBeenCalledTimes(1)
  }, 30000)

  it('does not retain the original card action when the Agent advises against it for the current project', async () => {
    const setup = await fixture(), value = assessment(setup.resolution)
    value.recommendations[0].advice = '当前不安排管网更新，先核查接口'
    value.recommendations[0].reasoning = '原卡记录不能替代本项目的工程接口核查，当前先补充资料。'
    provider(value)
    await executeKnowledgeAgent(setup.store, setup.run, new AbortController().signal, setup.resolution)
    const packet = (await setup.store.run(setup.run.id, config.ownerId))!.decision!
    const mainPaths = packet.scenarios.filter(scenario => scenario.id !== 'defer_and_investigate')
    expect(mainPaths.every(scenario => scenario.actions.every(action => !action.includes('先更新排水管网')))).toBe(true)
    expect(mainPaths.some(scenario => scenario.actions.some(action => action.includes(value.recommendations[0].advice)))).toBe(true)
    expect(packet.findings.every(finding => !finding.claim.includes('先更新排水管网'))).toBe(true)
  }, 30000)

  it('keeps the professional hard veto effective when the Agent proposes proceed', async () => {
    const setup = await fixture(['case'], true), value = assessment(setup.resolution)
    value.decision.action = 'proceed'; provider(value)
    await executeKnowledgeAgent(setup.store, setup.run, new AbortController().signal, setup.resolution)
    const packet = (await setup.store.run(setup.run.id, config.ownerId))!.decision!
    expect(packet.knowledge_agent?.assessment.decision.action).toBe('proceed')
    expect(packet.knowledge_agent?.final_action).toBe('defer')
    expect(packet.neighborhood_action?.decision).toBe('defer')
    expect(packet.scenarios.filter(scenario => scenario.id !== 'defer_and_investigate').every(scenario => scenario.status === 'blocked')).toBe(true)
    expect(packet.knowledge_agent!.guard_reasons.join('')).toContain('安全')
  }, 30000)

  it.each(['unread_tool', 'provider_failure'] as const)('fails %s without publishing program-written success', async failure => {
    const setup = await fixture(), mock = provider(assessment(setup.resolution), { read: failure !== 'unread_tool', fail: failure === 'provider_failure' })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await executeRun(setup.store, setup.run, new AbortController().signal)
    const result = (await setup.store.run(setup.run.id, config.ownerId))!
    expect(result.status).toBe('failed'); expect(result.decision).toBeNull()
    expect(mock.close).toHaveBeenCalledTimes(1)
    expect((await setup.store.events(setup.run.id, 0)).some(event => event.stage === 'decision' && event.status === 'completed')).toBe(false)
  }, 30000)

  it('reuses a validated same-run assessment but starts a new Agent for a new run', async () => {
    const setup = await fixture(), mock = provider(assessment(setup.resolution)), signal = new AbortController().signal
    await executeKnowledgeAgent(setup.store, setup.run, signal, setup.resolution)
    await executeKnowledgeAgent(setup.store, setup.run, signal, await resolveRunKnowledge(setup.store, setup.run, signal))
    expect(ports.open).toHaveBeenCalledTimes(1); expect(mock.call).toHaveBeenCalledTimes(1)
    const next = await setup.makeRun(), nextResolution = await resolveRunKnowledge(setup.store, next, signal)
    await executeKnowledgeAgent(setup.store, next, signal, nextResolution)
    expect(ports.open).toHaveBeenCalledTimes(2); expect(mock.call).toHaveBeenCalledTimes(2)
  }, 30000)

  it('revalidates citations in the same-run assessment cache before publishing', async () => {
    const setup = await fixture(), mock = provider(assessment(setup.resolution)), signal = new AbortController().signal
    await executeKnowledgeAgent(setup.store, setup.run, signal, setup.resolution)
    const original = (await setup.store.run(setup.run.id, config.ownerId))!.decision!
    const artifact = (await setup.store.db.query<{ id: string; payload: { assessment: KnowledgeAgentAssessment } }>('SELECT id,payload FROM artifacts WHERE run_id=$1 AND kind=$2', [setup.run.id, 'knowledge_agent'])).rows[0]
    artifact.payload.assessment.decision.citations[0].quote = '伪造缓存引文'
    await setup.store.db.query('UPDATE artifacts SET payload=$1 WHERE id=$2', [JSON.stringify(artifact.payload), artifact.id])
    await expect(executeKnowledgeAgent(setup.store, setup.run, signal, setup.resolution)).rejects.toThrow('KNOWLEDGE_AGENT_INVALID_CITATION')
    expect((await setup.store.run(setup.run.id, config.ownerId))!.decision).toEqual(original)
    expect(ports.open).toHaveBeenCalledTimes(1); expect(mock.call).toHaveBeenCalledTimes(1)
  }, 30000)

  it('blocks non-synthetic internal evidence before opening a provider when external model use is not allowed', async () => {
    const setup = await fixture(), resolution = structuredClone(setup.resolution), run = structuredClone(setup.run)
    run.snapshot.synthetic = false; run.snapshot.mode = 'enterprise'
    for (const source of run.snapshot.sources) { source.synthetic = false; source.visibility = 'internal'; source.data_class = 'internal' }
    for (const source of resolution.sources) { source.synthetic = false; source.visibility = 'internal'; source.data_class = 'internal' }
    provider(assessment(resolution))
    await expect(executeKnowledgeAgent(setup.store, run, new AbortController().signal, resolution)).rejects.toMatchObject({ code: 'KNOWLEDGE_AGENT_INTERNAL_NOT_PERMITTED' })
    expect(ports.open).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled()
    expect((await setup.store.run(run.id, config.ownerId))?.decision).toBeNull()
  }, 30000)

  it('honors cancellation before provider access and during a tool-backed Agent call', async () => {
    const setup = await fixture(), before = new AbortController(); before.abort(new Error('RUN_CANCELLED'))
    await expect(executeKnowledgeAgent(setup.store, setup.run, before.signal, setup.resolution)).rejects.toThrow('RUN_CANCELLED')
    expect(ports.open).not.toHaveBeenCalled()
    const during = new AbortController(), mock = provider(assessment(setup.resolution), { abort: during })
    await expect(executeKnowledgeAgent(setup.store, setup.run, during.signal, setup.resolution)).rejects.toThrow('RUN_CANCELLED')
    expect(mock.close).toHaveBeenCalledTimes(1)
    expect((await setup.store.run(setup.run.id, config.ownerId))?.decision).toBeNull()
  }, 30000)
})
