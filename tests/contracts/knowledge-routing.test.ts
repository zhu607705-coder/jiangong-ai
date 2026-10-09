import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CapabilityResult, ExperienceDraft, KnowledgeCondition, ProjectInput } from '../../apps/host/generated/contracts'
import { config } from '../../apps/host/config'
import { Store, type RunRecord } from '../../apps/host/store'
import { ExperienceService } from '../../packages/experience/service'
import { hash } from '../../packages/intelligence/domain'
import { roles } from '../../runtime/roles'

const ports = vi.hoisted(() => ({ live: vi.fn(), agent: vi.fn(), specialists: vi.fn(), open: vi.fn() }))
vi.mock('../../runtime/workflows/live', () => ({ executeLiveRun: ports.live }))
vi.mock('../../runtime/workflows/knowledge-agent', () => ({ executeKnowledgeAgent: ports.agent }))
vi.mock('../../runtime/dsh/bridge', () => ({ runSpecialists: ports.specialists }))
vi.mock('../../runtime/dsh/live-session', () => ({ LiveSession: { open: ports.open } }))
import { digest, executeRun } from '../../runtime/workflows/run'
import { researchSnapshot, resolveRunKnowledge } from '../../runtime/workflows/knowledge'

const originalConfig = { modelConfigured: config.modelConfigured, dataDir: config.dataDir }
const cleanup: { store: Store; directory: string }[] = []
const raw = '举措：排水管网改造\n关键条件：居民需求已确认\n实际决策：先更新排水管网\n实际实施：管网更新完成\n执行结果：雨季倒灌减少\n迁移条件：维护计划已确认'
const query = { measure_key: 'drainage.update', question: '排水管网改造' }
beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(config, { modelConfigured: true })
  ports.live.mockResolvedValue(undefined)
  ports.agent.mockResolvedValue(undefined)
  ports.open.mockRejectedValue(new Error('UNEXPECTED_LIVE_SESSION'))
  ports.specialists.mockImplementation(async () => new Map(roles.map(role => [role.id, {
    status: 'partial', findings: [], metrics: [], warnings: [], missing_fields: [], artifact_refs: [], version: '2.0',
  } satisfies CapabilityResult])))
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('UNEXPECTED_NETWORK_CALL'))
})
afterEach(async () => {
  vi.restoreAllMocks()
  Object.assign(config, originalConfig)
  for (const fixture of cleanup.splice(0)) {
    await fixture.store.db.close()
    await rm(fixture.directory, { recursive: true, force: true })
  }
})

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'knowledge-route-')), store = await Store.open(directory)
  cleanup.push({ store, directory }); config.dataDir = directory
  const service = new ExperienceService(store); await service.initialize()
  const makeInput = (id: string): ProjectInput => ({
    schema_version: '2.0', project_id: id, synthetic: true, purpose: '排水管网改造工程路由夹具', mode: 'automatic', role: 'planner', as_of: '2099-01-01', business_profile: 'neighborhood',
    scope: { name: '明确合成的小区夹具', geometry: null, coordinate_encoding: 'WGS84', legal_parcel_confirmed: false },
    sources: [{ id: 'S-TARGET', title: '合成项目条件材料', visibility: 'public', data_class: 'synthetic', synthetic: true, hash: 'target-v1', content_status: 'full_text', parse_status: 'extracted', published_at: '2026-09-01', object_refs: ['project:' + id], evidence_scope: 'object' }],
    facts: [{ id: 'F-RESIDENT', kind: 'retrofit.resident_needs_confirmed', value: true, unit: null, source_id: 'S-TARGET', object_ref: 'project:' + id, scope_kind: 'project', epistemic_status: 'fact', locator: 'line:1', observed_at: '2026-09-20' }],
    context_rules: [], candidate_ids: ['retain_and_reuse', 'whole_site_rebuild', 'defer_and_investigate'], events: [], knowledge_query: query,
  })
  const putProject = async (input: ProjectInput) => {
    await store.db.query('INSERT INTO projects(id,owner_id,name,input) VALUES($1,$2,$3,$4)', [input.project_id, config.ownerId, input.scope.name, JSON.stringify(input)])
    return (await store.project(input.project_id, config.ownerId))!
  }
  const target = await putProject(makeInput('TARGET-' + randomUUID()))
  const addCard = async (kind: 'case' | 'rule', missing = false) => {
    const historical = await putProject(makeInput('HISTORY-' + randomUUID())), documentId = 'DOC-' + randomUUID(), version = hash(raw)
    const historicalInput = structuredClone(historical.input)
    historicalInput.sources = [{ id: documentId, title: '合成历史原文', visibility: 'public', data_class: 'synthetic', synthetic: true, hash: version, locator: 'document:' + documentId, content_status: 'uploaded', parse_status: 'extracted' }]
    await store.db.query('UPDATE projects SET input=$1 WHERE id=$2', [JSON.stringify(historicalInput), historical.id])
    await store.db.query('INSERT INTO documents(id,project_id,file_name,blob_name,sha256,parser_result) VALUES($1,$2,$3,$4,$5,$6)', [documentId, historical.id, 'synthetic-retrospective.txt', 'test-only', version, JSON.stringify({ status: 'extracted', text: raw, source_hash: version })])
    const quote = (line: number, value: string) => ({ document_id: documentId, version, locator: 'line:' + line, quote: value })
    const conditions: KnowledgeCondition[] = [{ fact_kind: 'retrofit.resident_needs_confirmed', label: '居民需求已确认', operator: 'eq', value: true, source_value: '居民需求已确认', unit: null, evidence: [quote(2, '关键条件：居民需求已确认')] }]
    if (missing) conditions.push({ fact_kind: 'retrofit.maintenance_plan_confirmed', label: '维护计划已确认', operator: 'eq', value: true, source_value: '维护计划已确认', unit: null, evidence: [quote(6, '迁移条件：维护计划已确认')] })
    const draft: ExperienceDraft = { title: '排水管网改造', project_type: '', development_mode: '', stage: '', fields: [
      { key: 'actual_decision', value: '先更新排水管网', evidence: [quote(3, '实际决策：先更新排水管网')] },
      { key: 'implementation', value: '管网更新完成', evidence: [quote(4, '实际实施：管网更新完成')] },
      { key: 'outcome', value: '雨季倒灌减少', evidence: [quote(5, '执行结果：雨季倒灌减少')] },
    ], knowledge: { kind, origin: kind === 'case' ? 'project_case' : 'practice', measure_key: query.measure_key, measure_name: '排水管网改造', conditions, exclusions: [], transfer_notes: [], evidence_level: kind === 'case' ? 'implementation_record' : 'expert_practice' } }
    const project = (await store.project(historical.id, config.ownerId))!, created = await service.create(project, draft)
    const card = await service.review(project, created.id, created.revision, 'approved', '明确合成工程测试，仅核对字段与原文')
    return { card, project, documentId, version }
  }
  const makeRun = async (patch: Partial<ProjectInput> = {}, executionMode: 'offline' | 'live' = 'live') => {
    const snapshot = researchSnapshot({ ...structuredClone(target.input), ...patch }, 'automatic')
    const id = 'RUN-' + randomUUID()
    const run = (await store.db.query<RunRecord>('INSERT INTO runs(id,project_id,revision,context_version,status,execution_mode,snapshot,snapshot_hash,idempotency_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *', [id, target.id, 1, target.context_version, 'running', executionMode, JSON.stringify(snapshot), digest(snapshot), 'route-' + randomUUID()])).rows[0]
    return run
  }
  return { store, service, target, addCard, makeRun }
}

function expectNoAgent() {
  expect(ports.live).not.toHaveBeenCalled()
  expect(ports.agent).not.toHaveBeenCalled()
  expect(ports.open).not.toHaveBeenCalled()
  expect(ports.specialists).not.toHaveBeenCalled()
  expect(fetch).not.toHaveBeenCalled()
}
const stored = (store: Store, run: RunRecord) => store.run(run.id, config.ownerId)

describe('knowledge routing through the existing executeRun runtime', () => {
  it.each([
    ['case_hit', ['case']], ['rule_hit', ['rule']], ['combined_hit', ['case', 'rule']],
  ] as const)('delegates %s to one bounded knowledge Agent before other runtime work', async (route, kinds) => {
    const fixture = await setup()
    for (const kind of kinds) await fixture.addCard(kind)
    await fixture.addCard('case', true)
    const run = await fixture.makeRun()
    await executeRun(fixture.store, run, new AbortController().signal)
    expect(ports.agent).toHaveBeenCalledTimes(1)
    const [store, delegatedRun, signal, resolution] = ports.agent.mock.calls[0]
    expect(store).toBe(fixture.store); expect(delegatedRun.id).toBe(run.id); expect(signal).toBeInstanceOf(AbortSignal)
    expect(resolution.trace).toMatchObject({ route, fallback_status: 'not_needed' })
    expect(resolution.trace.candidates).toHaveLength(1)
    const matches = [...resolution.trace.case_hits, ...resolution.trace.rule_hits, ...resolution.trace.candidates]
    for (const match of matches) for (const ref of match.evidence_refs.filter((id: string) => id.startsWith('S-KB-'))) expect(resolution.sources.some((source: { id: string }) => source.id === ref)).toBe(true)
    // The workflow must not publish a program-written decision while the mocked Agent has produced none.
    expect((await stored(fixture.store, run))?.decision).toBeNull()
    expect(ports.live).not.toHaveBeenCalled(); expect(ports.open).not.toHaveBeenCalled(); expect(ports.specialists).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled()
  }, 30000)

  it('delegates a double miss in live mode to the existing live workflow once', async () => {
    const fixture = await setup()
    await fixture.addCard('case', true); await fixture.addCard('rule', true)
    const run = await fixture.makeRun()
    await executeRun(fixture.store, run, new AbortController().signal)
    expect(ports.live).toHaveBeenCalledTimes(1)
    expect(ports.live.mock.calls[0][0]).toBe(fixture.store)
    expect(ports.live.mock.calls[0][1].id).toBe(run.id)
    expect(ports.live.mock.calls[0][3]).toMatchObject({ route: 'agent_fallback', fallback_status: 'pending' })
    expect(ports.live.mock.calls[0][3].candidates).toHaveLength(2)
    expect(ports.live.mock.calls[0][5]).toHaveLength(2)
    expect(ports.agent).not.toHaveBeenCalled(); expect(ports.specialists).not.toHaveBeenCalled(); expect(ports.open).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled()
  }, 30000)

  it('blocks a live-mode knowledge hit without model credentials instead of publishing program advice', async () => {
    config.modelConfigured = false
    const fixture = await setup(); await fixture.addCard('case')
    const run = await fixture.makeRun()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await executeRun(fixture.store, run, new AbortController().signal)
    expect(await stored(fixture.store, run)).toMatchObject({ status: 'failed', error_code: 'BLOCKED_EXTERNAL', decision: null })
    expectNoAgent()
  }, 30000)

  it('records blocked_external for a double miss without model credentials', async () => {
    config.modelConfigured = false
    const fixture = await setup()
    await fixture.addCard('case', true); await fixture.addCard('rule', true)
    const run = await fixture.makeRun()
    const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => {})
    await executeRun(fixture.store, run, new AbortController().signal)
    expect(await stored(fixture.store, run)).toMatchObject({ status: 'failed', error_code: 'BLOCKED_EXTERNAL', decision: null })
    expect(diagnostic).toHaveBeenCalled(); expectNoAgent()
  }, 30000)

  it('keeps offline hits explicitly offline with source readback and no Agent assessment', async () => {
    const fixture = await setup(); await fixture.addCard('case')
    const run = await fixture.makeRun({}, 'offline')
    await executeRun(fixture.store, run, new AbortController().signal)
    const packet = (await stored(fixture.store, run))!.decision!
    expect(packet.knowledge).toMatchObject({ route: 'case_hit', agent_status: 'offline_only' })
    expect(packet.knowledge_agent).toBeUndefined()
    expect(packet.analysis_method).toBe('deterministic_checks')
    expect(packet.model_calls).toEqual([])
    for (const match of packet.knowledge!.case_hits) for (const ref of match.evidence_refs) expect(packet.sources.some(source => source.id === ref)).toBe(true)
    expectNoAgent()
  }, 30000)

  it('reuses the identical frozen resolution for the same run after material revalidation', async () => {
    const fixture = await setup(); await fixture.addCard('case')
    const run = await fixture.makeRun(), signal = new AbortController().signal
    const first = await resolveRunKnowledge(fixture.store, run, signal), second = await resolveRunKnowledge(fixture.store, run, signal)
    expect(second).toEqual(first)
    expect((await fixture.store.events(run.id, 0)).filter(event => event.stage === 'knowledge').map(event => event.status)).toEqual(['completed', 'reused'])
    expect((await fixture.store.db.query('SELECT id FROM artifacts WHERE run_id=$1 AND kind=$2', [run.id, 'knowledge_resolution'])).rows).toHaveLength(1)
    expectNoAgent()
  }, 30000)

  it.each(['document_version', 'approval_withdrawn', 'visibility_changed'] as const)('rejects a frozen resolution after %s changes', async change => {
    const fixture = await setup(), historical = await fixture.addCard('case'), run = await fixture.makeRun(), signal = new AbortController().signal
    const first = await resolveRunKnowledge(fixture.store, run, signal)
    expect(first.trace.route).toBe('case_hit')
    if (change === 'document_version') {
      const next = raw + '\n新增材料版本', version = hash(next)
      await fixture.store.db.query('UPDATE documents SET sha256=$1,parser_result=$2 WHERE id=$3', [version, JSON.stringify({ status: 'extracted', text: next, source_hash: version }), historical.documentId])
    } else if (change === 'approval_withdrawn') {
      await fixture.service.review(historical.project, historical.card.id, historical.card.revision, 'rejected', '合成测试撤回批准')
    } else {
      const input = structuredClone(historical.project.input); input.sources[0].visibility = 'internal'
      await fixture.store.db.query('UPDATE projects SET input=$1 WHERE id=$2', [JSON.stringify(input), historical.project.id])
    }
    await expect(resolveRunKnowledge(fixture.store, run, signal)).rejects.toMatchObject({ code: 'KNOWLEDGE_RESOLUTION_STALE' })
    const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => {})
    await executeRun(fixture.store, run, signal)
    expect(await stored(fixture.store, run)).toMatchObject({ status: 'failed', error_code: 'KNOWLEDGE_RESOLUTION_STALE', decision: null })
    expect(diagnostic).toHaveBeenCalled(); expectNoAgent()
  }, 30000)

  it('preserves source readback for displayed candidates in an offline fallback packet', async () => {
    const fixture = await setup(), historical = await fixture.addCard('case', true), run = await fixture.makeRun({}, 'offline')
    await executeRun(fixture.store, run, new AbortController().signal)
    const result = (await stored(fixture.store, run))!
    expect(result.status).toBe('completed')
    expect(result.decision?.knowledge).toMatchObject({ route: 'agent_fallback', fallback_status: 'offline_only' })
    const candidate = result.decision!.knowledge!.candidates.find(match => match.card_id === historical.card.id)!
    expect(candidate.conditions.some(condition => condition.state === 'unknown')).toBe(true)
    const kbRef = `S-KB-${historical.card.id}-R${historical.card.revision}`
    expect(candidate.evidence_refs).toContain(kbRef)
    const source = result.decision!.sources.find(source => source.id === kbRef)!
    expect(source).toBeDefined()
    expect(source.untrusted_text).toContain(historical.documentId)
    expect(source.untrusted_text).toContain(historical.version)
    expect(source.untrusted_text).toContain('line:6')
    expect(ports.specialists).toHaveBeenCalledTimes(1)
    expect(ports.agent).not.toHaveBeenCalled(); expect(ports.live).not.toHaveBeenCalled(); expect(ports.open).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled()
  }, 30000)
})
