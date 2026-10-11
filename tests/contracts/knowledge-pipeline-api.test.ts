import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import express from 'express'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Server } from 'node:http'
import baseFixture from '../../fixtures/inputs/01_auto.json'
import type { DistilledSkill, ExperienceCard, ExperienceDraft, ExperienceEvidence, FactorDefinition, FactorPolicy, KnowledgeCondition, ModelCall, ProjectInput, Source } from '../../apps/host/generated/contracts'
import { Store, type ProjectRecord } from '../../apps/host/store'
import { registerExperience } from '../../apps/host/experience'
import { LiveSession } from '../../runtime/dsh/live-session'
import { ExperienceError, type ParsedDocument } from '../../packages/experience/domain'
import { buildActionChunks, draftsFromActionChunks } from '../../packages/experience/chunking'
import { hash } from '../../packages/intelligence/domain'

// Never load dotenv or local credentials. The only model test replaces LiveSession.open.
const testConfig = vi.hoisted(() => ({ ownerId: 'pipeline-test-owner', modelConfigured: false, ALLOW_INTERNAL_MODEL: 'false', dataDir: '', DEEPSEEK_MODEL: 'fixture-only' }))
vi.mock('../../apps/host/config', () => ({ config: testConfig }))

// Explicitly synthetic engineering fixtures; these values do not calibrate business thresholds.
const raw = (building = '1号楼', amount = 40, measure = '排水管网更新') => `# 合成工程测试材料\n2026年9月1日，${building}已完成${measure}，合同金额${amount}万元，惠及20户。\n适用条件：排水接口确认 true。`
const draftOf = (card: ExperienceCard): ExperienceDraft => ({ title: card.title, project_type: card.project_type, development_mode: card.development_mode,
  stage: card.stage, fields: structuredClone(card.fields), knowledge: structuredClone(card.knowledge) })
const modelReview = (draft: ExperienceDraft) => {
  const knowledge = draft.knowledge!, chunks = knowledge.chunks!
  return { measures: [{ measure_key: knowledge.measure_key, measure_name: knowledge.measure_name, kind: knowledge.kind, origin: knowledge.origin,
    action_chunk_ids: chunks.filter(chunk => chunk.kind === 'action').map(chunk => chunk.id),
    context_chunk_ids: chunks.filter(chunk => chunk.kind === 'context').map(chunk => chunk.id),
    fields: draft.fields.filter(field => field.value !== null).map(field => ({ key: field.key, value: field.value,
      chunk_ids: chunks.filter(chunk => chunk.spans.some(span => span.quote.includes(field.value!))).map(chunk => chunk.id) })),
    conditions: knowledge.conditions, exclusions: knowledge.exclusions, transfer_notes: knowledge.transfer_notes }], warnings: [] }
}
const citation = (doc: ParsedDocument, line: number): ExperienceEvidence => ({ document_id: doc.id, version: doc.sha256,
  locator: 'line:' + line, quote: (doc.parser_result.text as string).split('\n')[line - 1] })
const prerequisite = (doc: ParsedDocument, line = 3): KnowledgeCondition => ({ fact_kind: 'engineering.confirmed', label: '排水接口确认',
  operator: 'eq', value: true, unit: null, source_value: '排水接口确认', evidence: [citation(doc, line)] })
const definition = (doc: ParsedDocument, patch: Partial<FactorDefinition> = {}): FactorDefinition => ({ key: 'amount_contract', label: '合同金额', value_type: 'number',
  role: 'key', weight: 1, unit: '万元', scale: 100, measure_keys: ['pipe_network'], evidence: [citation(doc, 2)], ...patch })
const policyInput = (definitions: FactorDefinition[], patch: Partial<Pick<FactorPolicy, 'min_coverage' | 'max_distance' | 'note'>> = {}) => ({
  definitions, min_coverage: 1, max_distance: 0.2, note: '合成参数工程预览，未经业务校准', ...patch,
})

describe('knowledge pipeline API evidence, ownership and runtime handoff', () => {
  let directory: string, store: Store, server: Server, base: string, service: Awaited<ReturnType<typeof registerExperience>>
  let historical: ProjectRecord, target: ProjectRecord, peer: ProjectRecord, foreign: ProjectRecord, sequence = 0, documentSequence = 0
  let modelOpen: MockInstance<typeof LiveSession.open>

  const putProject = async (suffix: string, owner = testConfig.ownerId): Promise<ProjectRecord> => {
    const id = `PIPELINE-API-${sequence}-${suffix}`
    const input: ProjectInput = { ...structuredClone(baseFixture) as ProjectInput, project_id: id, synthetic: true, mode: 'enterprise',
      as_of: new Date().toISOString().slice(0, 10), sources: [], facts: [], context_rules: [], events: [], knowledge_query: { measure_key: 'pipe_network', question: '排水管网更新' } }
    await store.db.query('INSERT INTO projects(id,name,owner_id,input) VALUES($1,$2,$3,$4)', [id, '合成工程隔离项目', owner, JSON.stringify(input)])
    return (await store.project(id, owner))!
  }
  const api = async (path: string, body?: unknown, project = historical) => {
    const response = await fetch(`${base}/api/projects/${project.id}/${path}`, { method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    return { status: response.status, data: await response.json() as any }
  }
  const putDocument = async (text = raw(), project = historical): Promise<ParsedDocument> => {
    const id = `DOC-PIPELINE-API-${sequence}-${++documentSequence}`, version = hash(text)
    const doc: ParsedDocument = { id, project_id: project.id, file_name: 'synthetic-engineering.txt', sha256: version,
      created_at: '2026-09-01', parser_result: { status: 'extracted', source_hash: version, text } }
    await store.db.query('INSERT INTO documents(id,project_id,file_name,blob_name,sha256,parser_result) VALUES($1,$2,$3,$4,$5,$6)',
      [id, project.id, doc.file_name, 'test-only-no-blob', version, JSON.stringify(doc.parser_result)])
    const record = (await store.project(project.id, project.owner_id))!
    record.input.sources.push({ id, title: '合成工程原件', synthetic: true, data_class: 'synthetic', visibility: 'internal',
      hash: version, locator: `document:${id}`, untrusted_text: text, content_status: 'uploaded', parse_status: 'extracted' })
    await store.db.query('UPDATE projects SET input=$1 WHERE id=$2', [JSON.stringify(record.input), project.id])
    return doc
  }
  const extract = async (doc: ParsedDocument): Promise<ExperienceCard> => {
    const result = await api('knowledge/extract', { document_ids: [doc.id], use_model: false })
    expect(result.status).toBe(201); expect(result.data.model_calls).toBe(0); expect(result.data.cards).toHaveLength(1)
    return result.data.cards[0]
  }
  const reviewCard = async (card: ExperienceCard, status: 'approved' | 'rejected' = 'approved'): Promise<ExperienceCard> => {
    const result = await api(`experiences/${card.id}/review`, { expected_revision: card.revision, status, note: '仅合成工程原文和版本核验' })
    expect(result.status).toBe(200)
    return result.data
  }
  const reviewedCard = async (doc: ParsedDocument, withCondition = false) => {
    let card = await extract(doc)
    if (withCondition) {
      const draft = draftOf(card); draft.knowledge!.conditions = [prerequisite(doc)]
      const update = await api(`experiences/${card.id}/update`, { expected_revision: card.revision, draft })
      expect(update.status).toBe(200); card = update.data
    }
    return reviewCard(card)
  }
  const savePolicy = async (input: ReturnType<typeof policyInput>, project = historical): Promise<FactorPolicy> => {
    const result = await api('knowledge/policies', { policy: input }, project)
    expect(result.status).toBe(201)
    return result.data
  }
  const approvePolicy = async (policy: FactorPolicy, project = historical): Promise<FactorPolicy> => {
    const result = await api(`knowledge/policies/${policy.id}/review`, { expected_revision: policy.revision, status: 'approved', note: '合成规则范围核验，未声称专业校准' }, project)
    expect(result.status).toBe(200)
    return result.data
  }
  const approvedSkill = async (cards: ExperienceCard[]): Promise<DistilledSkill> => {
    const distilled = await api('knowledge/skills/distill', { card_ids: cards.map(card => card.id) })
    expect(distilled.status).toBe(201); expect(distilled.data.status).toBe('draft')
    const reviewed = await api(`knowledge/skills/${distilled.data.id}/review`, { expected_revision: distilled.data.revision, status: 'approved', note: '合成技能来源、条件及只读工具核验' })
    expect(reviewed.status).toBe(200)
    return reviewed.data
  }
  const runtimeFixture = async () => {
    const doc = await putDocument(), card = await reviewedCard(doc, true), skill = await approvedSkill([card])
    const policyDoc = await putDocument('因素复核：合同金额以万元比较，尺度100。\n适用条件：排水接口确认 true。', target)
    const policy = await approvePolicy(await savePolicy(policyInput([
      definition(policyDoc, { evidence: [citation(policyDoc, 1)] }),
      definition(policyDoc, { key: 'engineering.confirmed', label: '排水接口确认', value_type: 'boolean', role: 'mandatory', unit: null, scale: null,
        evidence: [citation(policyDoc, 2)], condition: prerequisite(policyDoc, 2), on_unmet: 'supplement' }),
    ], { min_coverage: 0.5 }), target), target)
    const current = (await store.project(target.id, target.owner_id))!
    current.input.sources.push({ id: 'CURRENT-' + sequence, title: '合成当前对象核查', synthetic: true, data_class: 'synthetic', visibility: 'internal',
      hash: hash('排水接口确认 true'), untrusted_text: '排水接口确认 true', content_status: 'full_text' })
    current.input.facts.push({ id: 'FACT-' + sequence, kind: 'engineering.confirmed', value: true, unit: null, source_id: 'CURRENT-' + sequence,
      locator: 'line:1', object_ref: 'project:' + target.id, scope_kind: 'project', observed_at: '2026-09-01', epistemic_status: 'fact' })
    await store.db.query('UPDATE projects SET input=$1 WHERE id=$2', [JSON.stringify(current.input), target.id])
    return { doc, card, skill, policy, current }
  }

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'knowledge-pipeline-api-')); testConfig.dataDir = directory; store = await Store.open(directory)
    const app = express(); app.use(express.json())
    service = await registerExperience(app, store, async id => {
      const record = await store.project(id, testConfig.ownerId)
      if (!record) throw new ExperienceError(404, 'PROJECT_NOT_FOUND', '项目不存在或无权访问')
      return record
    })
    server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve))
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  })
  beforeEach(async () => {
    sequence++; documentSequence = 0; testConfig.ownerId = 'pipeline-test-owner-' + sequence; testConfig.modelConfigured = false
    modelOpen = vi.spyOn(LiveSession, 'open').mockRejectedValue(new Error('unexpected external model request'))
    historical = await putProject('history'); target = await putProject('target'); peer = await putProject('peer'); foreign = await putProject('foreign', 'foreign-owner-' + sequence)
  })
  afterEach(() => { vi.restoreAllMocks(); testConfig.modelConfigured = false })
  afterAll(async () => {
    if (server) await new Promise<void>(resolve => server.close(() => resolve()))
    if (store) await store.db.close()
    if (directory) await rm(directory, { recursive: true, force: true })
  })

  it('keeps the implemented action as the implementation field when a stage heading is present', async () => {
    const doc = await putDocument('# 合成工程测试材料\n项目阶段：已完成\n2026年9月1日，1号楼已完成排水管网更新，合同金额40万元。')
    const card = await extract(doc), field = card.fields.find(field => field.key === 'implementation')!
    expect(field.value).toContain('排水管网更新')
    expect(field.evidence.some(evidence => evidence.quote.includes(field.value!))).toBe(true)
  })

  it('binds chunk preview to the owned project and never exposes another owner project', async () => {
    const doc = await putDocument()
    expect(await api('knowledge/chunks', { document_id: doc.id }, peer)).toMatchObject({ status: 404, data: { code: 'DOCUMENT_SCOPE' } })
    expect(await api('knowledge/pipeline', undefined, foreign)).toMatchObject({ status: 404, data: { code: 'PROJECT_NOT_FOUND' } })
    expect(modelOpen).not.toHaveBeenCalled()
  })

  it('rejects source-version drift at card review without changing the stored draft or history', async () => {
    const doc = await putDocument(), card = await extract(doc), before = await service.repository.get(historical.id, card.id)
    await store.db.query('UPDATE documents SET parser_result=$1 WHERE id=$2', [JSON.stringify({ ...doc.parser_result, source_hash: '0'.repeat(64) }), doc.id])
    const result = await api(`experiences/${card.id}/review`, { expected_revision: card.revision, status: 'approved', note: '工程核验' })
    expect(result).toMatchObject({ status: 409, data: { code: 'DOCUMENT_VERSION_CONFLICT' } })
    expect(await service.repository.get(historical.id, card.id)).toEqual(before)
    expect((await store.db.query('SELECT revision FROM experience_history WHERE card_id=$1', [card.id])).rows).toHaveLength(1)
  })

  it('rejects an HTTP money-value edit absent from the quote and keeps the approved revision intact', async () => {
    const doc = await putDocument(), card = await reviewedCard(doc), draft = draftOf(card)
    draft.knowledge!.factors!.find(factor => factor.key === 'amount_contract')!.value = 78912345
    expect(await api(`experiences/${card.id}/update`, { expected_revision: card.revision, draft })).toMatchObject({ status: 422, data: { code: 'FACTOR_VALUE_NOT_QUOTED' } })
    expect(await service.repository.get(historical.id, card.id)).toEqual(card)
  })

  it('rejects forged factor locators even when the numeric value and version are unchanged', async () => {
    const doc = await putDocument(), card = await extract(doc), draft = draftOf(card)
    // Isolate the original-factor citation check from arithmetic dependencies on that citation.
    draft.knowledge!.factors = draft.knowledge!.factors!.filter(factor => factor.association !== 'derived')
    draft.knowledge!.factors!.find(factor => factor.key === 'amount_contract')!.evidence[0].locator = 'line:999'
    expect(await api(`experiences/${card.id}/update`, { expected_revision: card.revision, draft })).toMatchObject({ status: 422, data: { code: 'LOCATOR_NOT_FOUND' } })
    expect((await service.repository.get(historical.id, card.id))!.revision).toBe(1)
  })

  it('allows a mandatory definition as draft but cannot approve it without an original basis', async () => {
    const doc = await putDocument(), policy = await savePolicy(policyInput([definition(doc, { role: 'mandatory', evidence: [] })]))
    const result = await api(`knowledge/policies/${policy.id}/review`, { expected_revision: 1, status: 'approved', note: '工程核验' })
    expect(result).toMatchObject({ status: 422, data: { code: 'MANDATORY_EVIDENCE_REQUIRED' } })
    const state = await api('knowledge/pipeline'), history = await api(`knowledge/policies/${policy.id}/history`)
    expect(state.data.policies).toMatchObject([{ status: 'draft', revision: 1 }]); expect(history.data).toHaveLength(1)
  })

  it('does not save a policy backed by a fabricated document version', async () => {
    const doc = await putDocument(), def = definition(doc); def.evidence[0].version = '0'.repeat(64)
    expect(await api('knowledge/policies', { policy: policyInput([def]) })).toMatchObject({ status: 409, data: { code: 'DOCUMENT_VERSION_CONFLICT' } })
    expect((await api('knowledge/pipeline')).data.policies).toEqual([])
  })

  it('isolates policy IDs and history even between two projects owned by the same person', async () => {
    const doc = await putDocument(), policy = await savePolicy(policyInput([definition(doc)]))
    expect(await api(`knowledge/policies/${policy.id}/review`, { expected_revision: 1, status: 'approved', note: '工程核验' }, peer)).toMatchObject({ status: 404, data: { code: 'POLICY_NOT_FOUND' } })
    expect(await api('knowledge/policies', { id: policy.id, expected_revision: 1, policy: policyInput([definition(doc)]) }, peer)).toMatchObject({ status: 404, data: { code: 'POLICY_NOT_FOUND' } })
    expect((await api(`knowledge/policies/${policy.id}/history`, undefined, peer)).data).toEqual([])
  })

  it('previews reviewed same-measure cards with draft parameters without creating project facts', async () => {
    const a = await putDocument(), b = await putDocument(raw('2号楼', 42)), cards = [await reviewedCard(a), await reviewedCard(b)]
    const policy = await savePolicy(policyInput([definition(a)])), before = await store.project(historical.id, historical.owner_id)
    const result = await api('knowledge/groups', { policy_id: policy.id, policy_revision: 1, query: { measure_key: 'pipe_network', question: '排水管网更新' } })
    expect(result.status).toBe(200); expect(result.data.grouping.policy_status).toBe('draft')
    expect(result.data.grouping.groups).toHaveLength(1)
    expect(new Set(result.data.grouping.groups[0].card_refs.map((ref: { card_id: string }) => ref.card_id))).toEqual(new Set(cards.map(card => card.id)))
    expect(await store.project(historical.id, historical.owner_id)).toEqual(before); expect(modelOpen).not.toHaveBeenCalled()
  })

  it('rejects stale policy revisions before a grouping preview', async () => {
    const doc = await putDocument(), policy = await savePolicy(policyInput([definition(doc)]))
    expect(await api('knowledge/groups', { policy_id: policy.id, policy_revision: 2 })).toMatchObject({ status: 409, data: { code: 'KNOWLEDGE_VERSION_CONFLICT' } })
  })

  it('removes cards with drifted originals from grouping candidates', async () => {
    const doc = await putDocument(); await reviewedCard(doc)
    const policy = await savePolicy(policyInput([definition(doc, { evidence: [] })]))
    await store.db.query('UPDATE documents SET parser_result=$1 WHERE id=$2', [JSON.stringify({ ...doc.parser_result, source_hash: '0'.repeat(64) }), doc.id])
    const result = await api('knowledge/groups', { policy_id: policy.id })
    expect(result.status).toBe(200); expect(result.data.cards).toEqual([]); expect(result.data.grouping.groups).toEqual([])
  })

  it('distills multiple reviewed cards of one measure with every source version retained', async () => {
    const a = await putDocument(), b = await putDocument(raw('2号楼', 42)), cards = [await reviewedCard(a), await reviewedCard(b)]
    const result = await api('knowledge/skills/distill', { card_ids: cards.map(card => card.id) })
    expect(result.status).toBe(201); expect(result.data.status).toBe('draft')
    expect(new Set(result.data.card_refs.map((ref: { card_id: string; revision: number }) => `${ref.card_id}:${ref.revision}`))).toEqual(new Set(cards.map(card => `${card.id}:${card.revision}`)))
    expect(result.data.procedure).toHaveLength(2); expect(result.data.procedure.every((step: string) => (a.parser_result.text as string).includes(step) || (b.parser_result.text as string).includes(step))).toBe(true)
    expect(result.data.reviewed_by).toBeNull(); expect(modelOpen).not.toHaveBeenCalled()
  })

  it('rejects mixed measures without saving a partly distilled skill', async () => {
    const a = await putDocument(), b = await putDocument(raw('2号楼', 42, '电梯安装')), cards = [await reviewedCard(a), await reviewedCard(b)]
    expect(await api('knowledge/skills/distill', { card_ids: cards.map(card => card.id) })).toMatchObject({ status: 422, data: { code: 'SKILL_MEASURE_SCOPE' } })
    expect((await api('knowledge/pipeline')).data.skills).toEqual([])
  })

  it('rejects distillation from another owned project instead of silently dropping its card', async () => {
    const doc = await putDocument(), card = await reviewedCard(doc)
    expect(await api('knowledge/skills/distill', { card_ids: [card.id] }, peer)).toMatchObject({ status: 422, data: { code: 'SKILL_CARD_SCOPE' } })
    expect((await api('knowledge/pipeline', undefined, peer)).data.skills).toEqual([])
  })

  it('invalidates both export and review after the source card approval is withdrawn', async () => {
    const doc = await putDocument(), card = await reviewedCard(doc), skill = await approvedSkill([card])
    await reviewCard(card, 'rejected')
    expect(await api(`knowledge/skills/${skill.id}/export`)).toMatchObject({ status: 409, data: { code: 'SKILL_SOURCE_STALE' } })
    expect(await api(`knowledge/skills/${skill.id}/review`, { expected_revision: skill.revision, status: 'approved', note: '尝试继续使用撤审原件' })).toMatchObject({ status: 409, data: { code: 'SKILL_SOURCE_STALE' } })
    expect((await api(`knowledge/skills/${skill.id}/history`)).data).toHaveLength(2)
  })

  it('isolates skill export, review and history from other projects', async () => {
    const doc = await putDocument(), skill = await approvedSkill([await reviewedCard(doc)])
    expect(await api(`knowledge/skills/${skill.id}/export`, undefined, peer)).toMatchObject({ status: 404, data: { code: 'SKILL_NOT_FOUND' } })
    expect(await api(`knowledge/skills/${skill.id}/review`, { expected_revision: skill.revision, status: 'approved', note: '跨项目复核' }, peer)).toMatchObject({ status: 404, data: { code: 'SKILL_NOT_FOUND' } })
    expect((await api(`knowledge/skills/${skill.id}/history`, undefined, peer)).data).toEqual([])
  })

  it('keeps skill history unchanged after a stale review request', async () => {
    const doc = await putDocument(), skill = await approvedSkill([await reviewedCard(doc)])
    expect(await api(`knowledge/skills/${skill.id}/review`, { expected_revision: 1, status: 'rejected', note: '旧版本撤审请求' })).toMatchObject({ status: 409, data: { code: 'KNOWLEDGE_VERSION_CONFLICT' } })
    const history = await api(`knowledge/skills/${skill.id}/history`)
    expect(history.data.map((row: { revision: number; payload: DistilledSkill }) => [row.revision, row.payload.status])).toEqual([[2, 'approved'], [1, 'draft']])
  })

  it('refuses approved policy use after its original evidence version drifts', async () => {
    const doc = await putDocument(), policy = await approvePolicy(await savePolicy(policyInput([definition(doc)])))
    await store.db.query('UPDATE documents SET parser_result=$1 WHERE id=$2', [JSON.stringify({ ...doc.parser_result, source_hash: '0'.repeat(64) }), doc.id])
    expect(await api('knowledge/groups', { policy_id: policy.id })).toMatchObject({ status: 409, data: { code: 'DOCUMENT_VERSION_CONFLICT' } })
  })

  it('hands approved skills, grouping, factor policy and original citations to the Agent input without a model call', async () => {
    const fixture = await runtimeFixture(), before = await store.project(target.id, target.owner_id)
    const result = await service.resolveKnowledge(fixture.current)
    expect(result.trace.route).toBe('case_hit'); expect(result.trace.case_hits.map(hit => hit.card_id)).toEqual([fixture.card.id])
    expect(result.skills).toHaveLength(1); expect(result.skills![0]).toMatchObject({ id: fixture.skill.id, revision: fixture.skill.revision, status: 'approved', allowed_tools: ['knowledge_evidence'] })
    expect(result.trace.skill_refs).toEqual([{ skill_id: fixture.skill.id, revision: fixture.skill.revision }])
    expect(result.trace.grouping).toMatchObject({ policy_id: fixture.policy.id, policy_status: 'approved', candidate_count: 1 })
    expect(result.trace.grouping!.groups[0].card_refs).toEqual([{ card_id: fixture.card.id, revision: fixture.card.revision }])
    expect(result.trace.factor_policy).toMatchObject({ policy_id: fixture.policy.id, guard: 'none' })
    expect(result.sources.every(source => source.synthetic && source.hash === hash(source.untrusted_text!))).toBe(true)
    expect(result.sources.some(source => source.id.startsWith('S-KB-FACTOR-'))).toBe(true)
    expect(result.sources.flatMap(source => JSON.parse(source.untrusted_text!).citations).some((cite: ExperienceEvidence) => cite.document_id === fixture.doc.id && cite.version === fixture.doc.sha256)).toBe(true)
    expect(await store.project(target.id, target.owner_id)).toEqual(before); expect(modelOpen).not.toHaveBeenCalled()
  })

  it('removes withdrawn source-card skills from runtime reuse', async () => {
    const fixture = await runtimeFixture(); await reviewCard(fixture.card, 'rejected')
    const result = await service.resolveKnowledge(fixture.current)
    expect(result.skills).toBeUndefined(); expect(result.trace.skill_refs).toBeUndefined()
    expect(result.trace.case_hits).toEqual([]); expect(result.trace.grouping!.groups).toEqual([])
  })

  it('keeps draft parameter policies out of runtime factor guards and policy sources', async () => {
    const fixture = await runtimeFixture()
    const edited = await api('knowledge/policies', { id: fixture.policy.id, expected_revision: fixture.policy.revision,
      policy: policyInput(fixture.policy.definitions, { min_coverage: 0.5, max_distance: 0.1 }) }, target)
    expect(edited.status).toBe(201); expect(edited.data.status).toBe('draft')
    const result = await service.resolveKnowledge(fixture.current)
    expect(result.trace.factor_policy).toBeUndefined(); expect(result.trace.grouping).toBeUndefined()
    expect(result.sources.some(source => source.id.startsWith('S-KB-FACTOR-'))).toBe(false)
  })

  it('supplies exact material/version/locator and action indexes to only a mocked LiveSession and keeps its reply draft', async () => {
    const doc = await putDocument(), chunks = buildActionChunks(doc).chunks, draft = draftsFromActionChunks(doc, chunks)[0]
    const calls: ModelCall[] = [], close = vi.fn(async () => undefined), call = vi.fn(async (_stage: string, _prompt: string) => {
      calls.push({ stage: 'experience_extract', requested_model: 'fixture-only', returned_model: 'fixture-only', finish_reason: 'stop', input_tokens: 0, output_tokens: 0, duration_ms: 0, session_id: 'MODEL-MOCK' })
      const review = modelReview(draft), aliases = new Map(chunks.map((chunk, i) => [chunk.id, `c${i + 1}`]))
      for (const measure of review.measures) {
        measure.action_chunk_ids = measure.action_chunk_ids.map(id => aliases.get(id)!); measure.context_chunk_ids = measure.context_chunk_ids.map(id => aliases.get(id)!)
        measure.fields.forEach(field => { field.chunk_ids = field.chunk_ids.map(id => aliases.get(id)!) })
      }
      return { value: review, sessionId: 'MODEL-MOCK' }
    })
    modelOpen.mockResolvedValue({ call, close, calls } as unknown as LiveSession); testConfig.modelConfigured = true
    const result = await api('knowledge/extract', { document_ids: [doc.id], use_model: true })
    expect(result.status).toBe(201); expect(result.data.model_calls).toBe(1); expect(result.data.cards[0]).toMatchObject({ status: 'draft', revision: 1, review_note: null })
    expect(result.data.cards[0].knowledge.chunks.every((chunk: { id: string; classification: string }) => chunk.id.startsWith('chunk:') && chunk.classification === 'model')).toBe(true)
    expect(call).toHaveBeenCalledTimes(1); expect(close).toHaveBeenCalledTimes(1)
    const prompt = call.mock.calls[0][1], material = JSON.parse(prompt.match(/<untrusted_material>([\s\S]*?)<\/untrusted_material>/)![1])
    expect(material.every((slice: { document_id: string; version: string; locator: string; text: string }) => slice.document_id === doc.id && slice.version === doc.sha256 && !!slice.locator && (doc.parser_result.text as string).includes(slice.text))).toBe(true)
    const index = JSON.parse(prompt.match(/<untrusted_action_index>([\s\S]*?)<\/untrusted_action_index>/)![1])
    expect(index.map((chunk: { id: string }) => chunk.id)).toEqual(chunks.map((_, i) => `c${i + 1}`))
    expect(index.map((chunk: { spans: unknown[] }) => chunk.spans)).toEqual(chunks.map(chunk => chunk.spans.map(({ locator, quote }) => ({ locator, quote }))))
    expect(prompt).not.toContain('chunk:' + doc.sha256)
    expect((await api('knowledge/pipeline')).data.skills).toEqual([])
  })

  it('rejects an unknown model action ID and closes the mocked session', async () => {
    const doc = await putDocument(), draft = draftsFromActionChunks(doc, buildActionChunks(doc).chunks)[0]
    const review = modelReview(draft); review.measures[0].action_chunk_ids = ['unknown-source-chunk']
    const close = vi.fn(async () => undefined), call = vi.fn(async () => ({ value: review, sessionId: 'MODEL-MOCK' }))
    modelOpen.mockResolvedValue({ call, close, calls: [] } as unknown as LiveSession); testConfig.modelConfigured = true
    expect(await api('knowledge/extract', { document_ids: [doc.id], use_model: true })).toMatchObject({ status: 422, data: { code: 'MODEL_CHUNK_SCOPE' } })
    expect((await api('knowledge/pipeline')).data.cards).toEqual([]); expect(close).toHaveBeenCalledTimes(1)
  })

  it('reports missing model configuration without opening a session or saving fallback approval', async () => {
    const doc = await putDocument()
    expect(await api('knowledge/extract', { document_ids: [doc.id], use_model: true })).toMatchObject({ status: 422, data: { code: 'BLOCKED_EXTERNAL_MODEL' } })
    expect(modelOpen).not.toHaveBeenCalled(); expect((await api('knowledge/pipeline')).data.cards).toEqual([])
  })

  it('permits one source correction only and saves only the revalidated compact result', async () => {
    const doc = await putDocument(), draft = draftsFromActionChunks(doc, buildActionChunks(doc).chunks)[0], invalid = modelReview(draft)
    invalid.measures[0].transfer_notes = ['原文没有记载的适用边界']
    const call = vi.fn().mockResolvedValueOnce({ value: invalid }).mockResolvedValueOnce({ value: modelReview(draft) }), close = vi.fn(async () => undefined)
    modelOpen.mockResolvedValue({ call, close, calls: [] } as unknown as LiveSession); testConfig.modelConfigured = true
    const result = await api('knowledge/extract', { document_ids: [doc.id], use_model: true })
    expect(result.status).toBe(201); expect(result.data.cards).toHaveLength(1); expect(result.data.cards[0].knowledge.transfer_notes).toEqual([])
    expect(call).toHaveBeenCalledTimes(2); expect(call.mock.calls[1][0]).toBe('experience_extract_source_retry')
    expect(result.data.warnings.some((warning: string) => warning.includes('首轮没有入库'))).toBe(true)
    expect(close).toHaveBeenCalledTimes(1)
  })

  // These simulate public/private classifications to test intake, never real-world decision quality.
  const putPublic = async (patch: Partial<Source> = {}) => {
    const source: Source = { id: `PUBLIC-ENGINEERING-${sequence}`, title: 'Engineering-only source classification simulation',
      synthetic: false, data_class: 'public', visibility: 'public', content_status: 'full_text',
      url: 'https://example.org/engineering-test-only', untrusted_text: raw(), ...patch }
    const project = (await store.project(historical.id, historical.owner_id))!
    project.input.synthetic = false; project.input.sources.push(source)
    await store.db.query('UPDATE projects SET input=$1 WHERE id=$2', [JSON.stringify(project.input), project.id])
    return source
  }

  it('imports saved public text with the real CRE text parser, exact bytes and a hash-bound source', async () => {
    const source = await putPublic(), before = (await store.project(historical.id, historical.owner_id))!
    const result = await api('knowledge/public-document', { source_id: source.id })
    expect(result.status).toBe(201); expect(result.data.reused).toBe(false)
    expect(result.data.parser_result).toMatchObject({ text: source.untrusted_text, source_hash: hash(source.untrusted_text!), status: 'extracted' })
    const after = (await store.project(historical.id, historical.owner_id))!
    expect(after.context_version).toBe(before.context_version + 1)
    expect(after.input.sources.find(item => item.id === result.data.source_id)).toMatchObject({
      visibility: 'public', data_class: 'public', synthetic: false, hash: hash(source.untrusted_text!), locator: `document:${result.data.id}` })
    expect(await readFile(join(directory, 'blobs', historical.id, result.data.id + '.txt'), 'utf8')).toBe(source.untrusted_text)
    expect((await api('knowledge/pipeline')).data.public_sources.map((item: Source) => item.id)).toEqual([source.id])
    const extracted = await api('knowledge/extract', { document_ids: [result.data.id], use_model: false })
    expect(extracted.status).toBe(201); expect(extracted.data.cards[0].status).toBe('draft')
    expect(extracted.data.cards[0].knowledge.chunks.every((chunk: { document_version: string }) => chunk.document_version === hash(source.untrusted_text!))).toBe(true)
    expect(modelOpen).not.toHaveBeenCalled()
  })

  it('reuses the same public document and source binding without advancing project versions', async () => {
    const source = await putPublic(), first = await api('knowledge/public-document', { source_id: source.id })
    const before = await store.project(historical.id, historical.owner_id)
    const repeated = await api('knowledge/public-document', { source_id: source.id })
    expect(repeated.status).toBe(201); expect(repeated.data).toMatchObject({ id: first.data.id, reused: true })
    expect(await store.project(historical.id, historical.owner_id)).toEqual(before)
    expect((await api('knowledge/pipeline')).data.documents).toHaveLength(1)
  })

  it.each([
    { visibility: 'internal' as const }, { data_class: 'internal' as const }, { synthetic: true },
    { content_status: 'metadata_only' as const }, { untrusted_text: ' ' },
  ])('rejects a non-public original classification %j before any blob or model call', async patch => {
    const source = await putPublic(patch)
    expect(await api('knowledge/public-document', { source_id: source.id })).toMatchObject({ status: 422, data: { code: 'PUBLIC_ORIGINAL_REQUIRED' } })
    expect((await api('knowledge/pipeline')).data.documents).toEqual([]); expect(modelOpen).not.toHaveBeenCalled()
  })

  it('rejects a foreign-project source and an arbitrary URL body', async () => {
    const source = await putPublic()
    expect(await api('knowledge/public-document', { source_id: source.id }, peer)).toMatchObject({ status: 422, data: { code: 'PUBLIC_ORIGINAL_REQUIRED' } })
    expect((await api('knowledge/public-document', { source_id: source.id, url: source.url })).status).toBe(422)
  })

  it('rolls back a stale-context intake and removes the new blob', async () => {
    const source = await putPublic(), stale = (await store.project(historical.id, historical.owner_id))!
    await store.db.query('UPDATE projects SET context_version=context_version+1 WHERE id=$1', [historical.id])
    const { KnowledgePipelineService } = await import('../../packages/experience/pipeline')
    const pipeline = new KnowledgePipelineService(store, service)
    await expect(pipeline.importPublicDocument(stale, source.id)).rejects.toMatchObject({ code: 'CONTEXT_VERSION_CONFLICT' })
    expect(await readdir(join(directory, 'blobs', historical.id))).toEqual([])
    expect((await api('knowledge/pipeline')).data.documents).toEqual([])
    expect((await store.project(historical.id, historical.owner_id))!.input.sources).toHaveLength(1)
  })

  it('permits only the imported public original for a mocked external extraction', async () => {
    const source = await putPublic(), imported = await api('knowledge/public-document', { source_id: source.id })
    const document = (await service.repository.documents(historical.id)).find(doc => doc.id === imported.data.id)!
    const draft = draftsFromActionChunks(document, buildActionChunks(document).chunks)[0]
    const call = vi.fn(async () => ({ value: modelReview(draft), sessionId: 'MODEL-MOCK' })), close = vi.fn(async () => undefined)
    modelOpen.mockResolvedValue({ call, close, calls: [] } as unknown as LiveSession); testConfig.modelConfigured = true
    expect((await api('knowledge/extract', { document_ids: [document.id], use_model: true })).status).toBe(201)
    expect(call).toHaveBeenCalledTimes(1); expect(close).toHaveBeenCalledTimes(1)
    const privateDoc = await putDocument(raw('2号楼'))
    expect(await api('knowledge/extract', { document_ids: [privateDoc.id], use_model: true })).toMatchObject({ status: 403, data: { code: 'INTERNAL_MODEL_NOT_PERMITTED' } })
    expect(call).toHaveBeenCalledTimes(1)
  })
})
