import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fixture from '../../fixtures/inputs/01_auto.json'
import { Store, type ProjectRecord } from '../../apps/host/store'
import type { ProjectInput, RenewalStrategy } from '../../apps/host/generated/contracts'
import type { StrategyPacket } from '../../packages/retrofit/strategy'
import { projectDecisionInput } from '../../packages/decision/structured-route'
import { decisionCacheDescriptor } from '../../services/capabilities/decision-model'
import { readPublishedStrategy, listPublishedStrategies } from '../../apps/host/strategy-publication'

let directory: string, store: Store
const owner = 'publication-owner'
function strategy(): RenewalStrategy {
  return { headline: '依据对象资料比较综合整治与拆建条件', summary: '先研究综合整治路径，拆建条件逐项核实。', preferred_mode: 'comprehensive',
    rationale: [{ point: '原文保留对象条件', source_id: 'SOURCE', quote: '对象原文需要核对结构与资金条件。' }],
    paths: (['comprehensive', 'rebuild'] as const).map(mode => ({ mode, title: mode === 'comprehensive' ? '综合整治研究路径' : '原拆原建比较路径', description: '按本对象资料逐项核实条件。', actions: [{ title: '核查对象原文', detail: '取得对象结构与资金的原文材料。', evidence_refs: ['SOURCE'] }], requirements: ['取得对象级核实材料。'] })),
    dimensions: (['demand', 'supply', 'adaptation', 'implementation', 'operations', 'resources'] as const).map(key => ({ key, current: '对象材料尚待专项核查。', current_level: 'unknown', comprehensive: '结合原文研究保留建筑的改善路径。', comprehensive_level: 'unknown', rebuild: '核实必要性及实施前提后比较拆建。', rebuild_level: 'unknown', evidence_refs: ['SOURCE'] })),
    next_checks: [{ title: '取得结构与资金依据', detail: '保持对象、时点与价格阶段一致。', evidence_refs: ['SOURCE'] }],
  }
}
async function project(id = `P-${randomUUID()}`, projectOwner = owner, version = 14, synthetic = false) {
  const input = { ...structuredClone(fixture), project_id: id, synthetic, business_profile: 'neighborhood', sources: [], facts: [], context_rules: [] } as ProjectInput
  await store.db.query('INSERT INTO projects(id,owner_id,name,input,context_version) VALUES($1,$2,$3,$4,$5)', [id, projectOwner, '同名求是村', JSON.stringify(input), version])
  return (await store.project(id, projectOwner))!
}
function packet(project: ProjectRecord, hash = 'saved-hash', overrides: Partial<StrategyPacket> = {}): StrategyPacket {
  return { project_id: project.id, context_version: project.context_version, input_hash: hash, created_at: '2026-10-15T03:30:51.777Z', synthetic: false, status: 'completed', strategy: strategy(),
    sources: [{ id: 'SOURCE', title: '对象原文', text: '对象原文需要核对结构与资金条件。', url: null, published_at: null, role: 'current', locator: 'line:1' }], decision: null, model_calls: [], research: null, error: null, ...overrides }
}
async function save(project: ProjectRecord, value: StrategyPacket, projectOwner = project.owner_id, savedAt = value.created_at) {
  await store.db.query('INSERT INTO renewal_strategy_assessments(owner_id,project_id,input_hash,payload,created_at) VALUES($1,$2,$3,$4,$5)', [projectOwner, project.id, value.input_hash, JSON.stringify(value), savedAt])
}
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'strategy-publication-')); store = await Store.open(directory)
  await store.db.exec('CREATE TABLE renewal_strategy_assessments(owner_id TEXT NOT NULL,project_id TEXT NOT NULL REFERENCES projects(id),input_hash TEXT NOT NULL,payload JSONB NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),PRIMARY KEY(owner_id,project_id,input_hash))')
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('UNEXPECTED_NETWORK_CALL'))
})
afterEach(async () => { vi.useRealTimers(); vi.restoreAllMocks(); await store.db.close(); await rm(directory, { recursive: true, force: true }) })

describe('owner and version bound published strategies', () => {
  it('recovers a same-version completed snapshot when only the current hash has changed', async () => {
    const target = await project(), saved = packet(target); await save(target, saved)
    const result = await readPublishedStrategy(store, target, 'new-reference-hash', false)
    expect(result).toMatchObject({ project_id: target.id, input_hash: 'saved-hash', context_version: 14, status: 'completed', publication: { kind: 'saved_snapshot', is_current: false, current_input_hash: 'new-reference-hash' } })
    expect(result?.publication?.saved_at).toContain('2026-10-15')
    expect(fetch).not.toHaveBeenCalled()
  })
  it('prefers exact current completed results and labels them current', async () => {
    const target = await project(), exact = packet(target, 'current-hash'); await save(target, exact)
    await save(target, packet(target, 'other-hash'), owner, '2026-10-16T00:00:00Z')
    const result = await readPublishedStrategy(store, target, 'current-hash', false)
    expect(result?.input_hash).toBe('current-hash'); expect(result?.publication?.kind).toBe('current')
    const items = await listPublishedStrategies(store,owner,async ()=>'current-hash')
    expect(items[0].input_hash).toBe('current-hash'); expect(items[0].is_current).toBe(true)
    expect(items[0].created_at).toBe(result?.publication?.saved_at)
  })
  it('never borrows another same-name project, owner, context version or simulation', async () => {
    const target = await project(), sameName = await project(), otherOwner = await project(undefined, 'other-owner')
    await save(sameName, packet(sameName)); await save(otherOwner, packet(otherOwner))
    await save(target, packet(target, 'old-version', { context_version: 13 }))
    await save(target, packet(target, 'demo', { synthetic: true }))
    await save(target, packet(target, 'failed', { status: 'failed', strategy: null }))
    expect(await readPublishedStrategy(store, target, 'current-hash', false)).toBeNull()
    expect(await readPublishedStrategy(store, sameName, 'saved-hash', true)).toBeNull()
  })
  it('does not publish corrupt or incomplete completed packets', async () => {
    const target = await project()
    await save(target, packet(target, 'wrong-project', { project_id: 'P-ANOTHER' }))
    await save(target, packet(target, 'missing-strategy', { strategy: null }))
    await save(target, packet(target, 'invalid-strategy', { strategy: {} as RenewalStrategy }))
    expect(await readPublishedStrategy(store, target, 'current-hash', false)).toBeNull()
  })
  it('indexes only real completed current-version workbench projects without copying conclusions', async () => {
    const target = await project(), sibling = await project(), otherOwner = await project(undefined, 'other-owner'), synthetic = await project(undefined, owner, 0, true)
    await save(target, packet(target, 'current-hash'))
    await save(sibling, packet(sibling, 'old-hash', { context_version: 13 }))
    await save(sibling, packet(sibling, 'demo-hash', { synthetic: true }))
    await save(otherOwner, packet(otherOwner)); await save(synthetic, packet(synthetic))
    const items = await listPublishedStrategies(store, owner, async () => 'current-hash')
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ project_id: target.id, project_name: '同名求是村', context_version: 14, strategy_context_version: 14, status: 'completed', synthetic: false, is_current: true })
    expect(items[0]).not.toHaveProperty('sources'); expect(items[0]).not.toHaveProperty('strategy')
    expect(fetch).not.toHaveBeenCalled()
  })
  it('proves that reference_as_of alone changes the current exact cache descriptor at UTC midnight', () => {
    vi.useFakeTimers()
    const input = { ...structuredClone(fixture), business_profile: 'neighborhood' } as ProjectInput
    const hash = () => createHash('sha256').update(JSON.stringify(decisionCacheDescriptor(projectDecisionInput(input), { model: 'decision-model-preview', endpoint: 'https://configured.example' }))).digest('hex')
    vi.setSystemTime(new Date('2026-10-15T23:59:59Z')); const before = hash()
    vi.setSystemTime(new Date('2026-10-16T00:00:01Z')); expect(hash()).not.toBe(before)
  })
})
