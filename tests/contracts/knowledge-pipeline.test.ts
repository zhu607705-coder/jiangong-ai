import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import express from 'express'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Server } from 'node:http'
import fixture from '../../fixtures/inputs/01_auto.json'
import type { ExperienceCard, FactorPolicy, ProjectInput } from '../../apps/host/generated/contracts'
import { config } from '../../apps/host/config'
import { Store } from '../../apps/host/store'
import { registerExperience } from '../../apps/host/experience'
import { ExperienceError, normalizeDraft } from '../../packages/experience/domain'
import { hash } from '../../packages/intelligence/domain'
import { LiveSession } from '../../runtime/dsh/live-session'
import { evaluateFactorPolicy } from '../../packages/experience/policy-evaluation'
import { assembleDecision } from '../../packages/decision/evaluate'
import { applyKnowledgePolicyGuard } from '../../runtime/workflows/knowledge'

const raw = '项目名称：显式合成工程测试\n对象范围：7幢1单元\n阶段：实际实施\n2026年10月1日，7幢1单元已加装2台电梯，合同金额100万元。\n检验通过=true'
describe('integrated knowledge pipeline engineering contracts', () => {
  let directory: string, store: Store, server: Server, base: string
  const model = vi.spyOn(LiveSession, 'open').mockRejectedValue(new Error('unexpected model request'))
  const input = (id: string): ProjectInput => ({ ...structuredClone(fixture) as ProjectInput, project_id: id, synthetic: true, as_of: '2030-12-31', business_profile: 'neighborhood',
    scope: { name: '合成测试对象', geometry: null, coordinate_encoding: 'WGS84', legal_parcel_confirmed: false }, facts: [], sources: [], context_rules: [], mode: 'enterprise', candidate_ids: ['retain_and_reuse', 'defer_and_investigate'] })
  const api = async (path: string, body?: unknown) => {
    const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    return { status: response.status, value: await response.json() }
  }
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'knowledge-pipeline-'))
    store = await Store.open(directory)
    for (const id of ['PIPE-A', 'PIPE-B']) {
      const p = input(id)
      if (id === 'PIPE-A') p.sources.push({ id: 'PIPE-DOC', title: '显式合成原件', data_class: 'synthetic', visibility: 'internal', synthetic: true, hash: hash(raw), untrusted_text: raw, content_status: 'uploaded' })
      await store.db.query('INSERT INTO projects(id,name,owner_id,input) VALUES($1,$2,$3,$4)', [id, '合成接口测试', config.ownerId, JSON.stringify(p)])
    }
    await store.db.query('INSERT INTO documents(id,project_id,file_name,blob_name,sha256,parser_result) VALUES($1,$2,$3,$4,$5,$6)', ['PIPE-DOC', 'PIPE-A', '合成举措.txt', 'unused', hash(raw), JSON.stringify({ status: 'extracted', source_hash: hash(raw), text: raw })])
    const app = express(); app.use(express.json())
    await registerExperience(app, store, async id => {
      const project = await store.project(id, config.ownerId)
      if (!project) throw new ExperienceError(404, 'PROJECT_NOT_FOUND', '项目不存在')
      return project
    })
    server = app.listen(0)
    await new Promise<void>(resolve => server.once('listening', resolve))
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  })
  afterAll(async () => { model.mockRestore(); await new Promise<void>(resolve => server.close(() => resolve())); await store.db.close(); await rm(directory, { recursive: true, force: true }) })
  let card: ExperienceCard, policy: FactorPolicy, skillId: string
  it('previews exact action spans then persists source-bound factors without a model', async () => {
    const chunks = await api('/api/projects/PIPE-A/knowledge/chunks', { document_id: 'PIPE-DOC' })
    expect(chunks.status).toBe(200); expect(chunks.value.chunks.some((chunk: { kind: string }) => chunk.kind === 'action')).toBe(true)
    const extracted = await api('/api/projects/PIPE-A/knowledge/extract', { document_ids: ['PIPE-DOC'], use_model: false })
    expect(extracted.status).toBe(201); expect(extracted.value.model_calls).toBe(0)
    card = extracted.value.cards.find((card: ExperienceCard) => card.knowledge?.measure_key === 'elevator')
    expect(card.status).toBe('draft'); expect(card.knowledge!.factors!.some(factor => factor.value === 100 && factor.amount_kind === 'contract')).toBe(true)
    expect(card.knowledge!.chunks!.flatMap(chunk => chunk.spans).every(span => raw.includes(span.quote))).toBe(true)
    expect(model).not.toHaveBeenCalled()
  })
  it('rejects another project document before creating any card', async () => {
    const result = await api('/api/projects/PIPE-B/knowledge/extract', { document_ids: ['PIPE-DOC'], use_model: false })
    expect(result.status).toBe(422); expect(result.value.code).toBe('DOCUMENT_SCOPE')
  })
  it('requires original citation for edited factor values', () => {
    const changed = { title: card.title, project_type: card.project_type, development_mode: card.development_mode, stage: card.stage, fields: card.fields, knowledge: structuredClone(card.knowledge) }
    changed.knowledge!.factors!.find(factor => typeof factor.value === 'number')!.value = 78912345
    expect(() => normalizeDraft(changed)).toThrow('因素数值')
  })
  it('retains draft policies, rejects cross-project citations and requires scales for review', async () => {
    const create = await api('/api/projects/PIPE-A/knowledge/policies', { policy: { definitions: [{ key: 'contract_amount', label: '合同金额', value_type: 'number', role: 'key', weight: 1, unit: '万元', scale: null, measure_keys: ['elevator'], evidence: [] }], min_coverage: 0.7, max_distance: 0.35, note: '显式未校准工程预览' } })
    expect(create.status).toBe(201); policy = create.value
    const review = await api(`/api/projects/PIPE-A/knowledge/policies/${policy.id}/review`, { expected_revision: policy.revision, status: 'approved', note: '工程复核测试' })
    expect(review.status).toBe(422); expect(review.value.code).toBe('FACTOR_SCALE_REQUIRED')
    const bad = await api('/api/projects/PIPE-B/knowledge/policies', { policy: { definitions: [{ ...policy.definitions[0], evidence: [{ document_id: 'PIPE-DOC', version: hash(raw), locator: 'line:4', quote: raw.split('\n')[3] }] }], min_coverage: 0.7, max_distance: 0.35, note: '' } })
    expect(bad.status).toBe(422); expect(bad.value.code).toBe('DOCUMENT_SCOPE')
  })
  it('changes policy revisions, rejects stale writes and resets approval after editing', async () => {
    const updated = await api('/api/projects/PIPE-A/knowledge/policies', { id: policy.id, expected_revision: policy.revision, policy: { definitions: [{ ...policy.definitions[0], scale: 100 }], min_coverage: 0.7, max_distance: 0.35, note: '仅合成参数行为验证' } })
    expect(updated.status).toBe(201); policy = updated.value
    const reviewed = await api(`/api/projects/PIPE-A/knowledge/policies/${policy.id}/review`, { expected_revision: policy.revision, status: 'approved', note: '合成参数复核，不代表专业校准' })
    expect(reviewed.status).toBe(200); policy = reviewed.value
    const stale = await api(`/api/projects/PIPE-A/knowledge/policies/${policy.id}/review`, { expected_revision: policy.revision - 1, status: 'rejected', note: '旧版本' })
    expect(stale.status).toBe(409)
    const edited = await api('/api/projects/PIPE-A/knowledge/policies', { id: policy.id, expected_revision: policy.revision, policy: { definitions: policy.definitions, min_coverage: 0.8, max_distance: 0.35, note: '更改覆盖' } })
    expect(edited.value.status).toBe('draft'); policy = edited.value
    const history = await api(`/api/projects/PIPE-A/knowledge/policies/${policy.id}/history`)
    expect(history.value.map((row: { revision: number }) => row.revision)).toEqual([4, 3, 2, 1])
  })
  it('does not group or distill unreviewed cards', async () => {
    const grouped = await api('/api/projects/PIPE-A/knowledge/groups', { policy_id: policy.id, policy_revision: policy.revision })
    expect(grouped.status).toBe(200); expect(grouped.value.grouping.policy_status).toBe('draft'); expect(grouped.value.grouping.groups).toEqual([])
    const result = await api('/api/projects/PIPE-A/knowledge/skills/distill', { card_ids: [card.id] })
    expect(result.status).toBe(422); expect(result.value.code).toBe('SKILL_REVIEWED_CARDS_REQUIRED')
  })
  it('compiles reviewed source cards into a draft, then reviews and exports a bounded Skill', async () => {
    const review = await api(`/api/projects/PIPE-A/experiences/${card.id}/review`, { expected_revision: card.revision, status: 'approved', note: '逐字合成资料核验，仅工程测试' })
    expect(review.status).toBe(200); card = review.value
    const result = await api('/api/projects/PIPE-A/knowledge/skills/distill', { card_ids: [card.id] })
    expect(result.status).toBe(201); skillId = result.value.id; expect(result.value.status).toBe('draft'); expect(result.value.allowed_tools).toEqual(['knowledge_evidence'])
    const draftExport = await api(`/api/projects/PIPE-A/knowledge/skills/${skillId}/export`)
    expect(draftExport.status).toBe(422)
    const approved = await api(`/api/projects/PIPE-A/knowledge/skills/${skillId}/review`, { expected_revision: 1, status: 'approved', note: '合成Skill来源与范围核验' })
    expect(approved.status).toBe(200)
    const exported = await api(`/api/projects/PIPE-A/knowledge/skills/${skillId}/export`)
    expect(exported.status).toBe(200); expect(exported.value.markdown).toContain(card.id); expect(exported.value.markdown).toContain('knowledge_evidence')
    expect(model).not.toHaveBeenCalled()
  })
  it('invalidates a reviewed skill after a source card revision changes', async () => {
    const draft = { title: card.title, project_type: card.project_type, development_mode: card.development_mode, stage: card.stage, fields: card.fields, knowledge: card.knowledge }
    const changed = await api(`/api/projects/PIPE-A/experiences/${card.id}/update`, { draft, expected_revision: card.revision })
    expect(changed.status).toBe(200)
    const exported = await api(`/api/projects/PIPE-A/knowledge/skills/${skillId}/export`)
    expect(exported.status).toBe(409); expect(exported.value.code).toBe('SKILL_SOURCE_STALE')
  })
  it('evaluates only current verified mandatory facts and keeps the final guard idempotent', () => {
    const p = input('PIPE-A'); const source = { id: 'CURRENT', title: '合成原文', hash: hash('true'), synthetic: true, data_class: 'synthetic' as const, visibility: 'internal' as const, untrusted_text: 'true' };p.sources.push(source)
    p.facts.push({ id: 'F', kind: 'inspection_confirmed', value: false, unit: null, source_id: source.id, locator: 'body', object_ref: 'project:PIPE-A', observed_at: '2026-10-01', epistemic_status: 'fact' })
    const rule = { ...policy, status: 'approved' as const, definitions: [{ key: 'inspection_confirmed', label: '本方案检验条件', value_type: 'boolean' as const, role: 'mandatory' as const, weight: 1, unit: null, scale: null, measure_keys: [], evidence: [], on_unmet: 'defer' as const, condition: { fact_kind: 'inspection_confirmed', label: '本方案检验', operator: 'eq' as const, value: true, unit: null, evidence: [] } }] }
    const evaluated = evaluateFactorPolicy(p, rule, 'POLICY-SOURCE');expect(evaluated.guard).toBe('defer')
    const packet = assembleDecision({ project: p, runId: 'RUN-pipeline-test', revision: 1, contextVersion: 0, snapshotHash: 'a'.repeat(64), executionMode: 'offline', results: [], artifactRefs: [], impact: { changed_rule_ids: [], invalidated: [], reused: [], changed_paths: [] }, model: null })
    packet.knowledge = { evaluated_as_of: p.as_of, policy_version: 'knowledge-routing-v2', query: { measure_key: '', question: '' }, route: 'agent_fallback', case_hits: [], rule_hits: [], candidates: [], reasons: [], fallback_status: 'offline_only', factor_policy: evaluated }
    applyKnowledgePolicyGuard(packet);const count = packet.followups.length;applyKnowledgePolicyGuard(packet);expect(packet.followups).toHaveLength(count);expect(packet.neighborhood_action?.decision).toBe('defer');expect(packet.scenarios.filter(s => s.id !== 'defer_and_investigate').every(s => s.status === 'blocked')).toBe(true)
    p.facts[0].object_ref = 'project:OTHER';expect(evaluateFactorPolicy(p, rule, 'POLICY-SOURCE').guard).toBe('supplement')
  })
})
