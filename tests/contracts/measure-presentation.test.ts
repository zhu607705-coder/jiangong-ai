import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ExperienceCard, ExperienceDraft, ProjectInput } from '../../apps/host/generated/contracts'
import { Store, type ProjectRecord } from '../../apps/host/store'
import fixture from '../../fixtures/inputs/01_auto.json'
import { ExperienceService } from '../../packages/experience/service'
import { hash } from '../../packages/intelligence/domain'
import { cardPresentationDetails, changeSkillSourceSelection, groupMeasureCards, skillSourceEligible } from '../../packages/experience/presentation'

const card = (id: string, overrides: Partial<ExperienceCard> = {}): ExperienceCard => ({
  id, project_id: 'SYNTHETIC-P', title: '二次供水', project_type: '合成工程测试', development_mode: '整治提升', stage: '实施',
  revision: 2, status: 'approved', review_note: '合成测试复核', created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
  fields: [{ key: 'implementation', value: '二次供水改造', evidence: [{ document_id: 'DOC-A', version: 'v1', locator: 'line:1', quote: '二次供水改造' }] }],
  knowledge: { kind: 'case', origin: 'project_case', measure_key: 'pipe_network', measure_name: '二次供水', conditions: [], exclusions: [], transfer_notes: [], evidence_level: 'implementation_record', factors: [{ key: 'cost', label: '合同金额', value: 50, unit: '万元', object_ref: '1号楼', stage: '实施', observed_at: null, amount_kind: 'contract', association: 'direct', epistemic_status: 'fact', evidence: [{ document_id: 'DOC-A', version: 'v1', locator: 'line:2', quote: '1号楼合同50万元' }] }] },
  ...overrides,
})

describe('measure presentation preserves evidence beneath one measure entry', () => {
  it('groups a repeated measure without dropping different objects, stages or amounts', () => {
    const a = card('A'), b = card('B', { stage: '规划' })
    b.knowledge!.factors![0] = { ...b.knowledge!.factors![0], object_ref: '2号楼', stage: '规划', value: 80, amount_kind: 'budget' }
    const groups = groupMeasureCards([a, b])
    expect(groups).toHaveLength(1)
    expect(groups[0].title).toBe('二次供水')
    expect(groups[0].cards).toEqual([a, b])
    expect(cardPresentationDetails(b).objects).toEqual(['2号楼'])
    expect(cardPresentationDetails(b).stages).toEqual(['规划'])
  })

  it('partitions the same measure by project and case/rule kind', () => {
    const a = card('A'), otherProject = card('B', { project_id: 'SYNTHETIC-Q' }), rule = card('C')
    rule.knowledge!.kind = 'rule'
    expect(groupMeasureCards([a, otherProject, rule])).toHaveLength(3)
  })

  it('only normalizes case and whitespace in keyless titles, retaining building numbers', () => {
    const cards = [card('A', { title: ' 供水  PLAN ', knowledge: undefined }), card('B', { title: '供水 plan', knowledge: undefined }), card('C', { title: '1号楼供水', knowledge: undefined }), card('D', { title: '2号楼供水', knowledge: undefined })]
    expect(groupMeasureCards(cards).map(group => group.cards.length).sort()).toEqual([1, 1, 2])
    expect(groupMeasureCards([card('A', { knowledge: undefined }), card('B')])).toHaveLength(2)
  })

  it('never matches keyless titles to explicit keys or merges different keys sharing a title', () => {
    const noKey = card('A'), first = card('B'), second = card('C')
    noKey.knowledge!.measure_key = ''
    second.knowledge!.measure_key = 'water_tank'
    expect(groupMeasureCards([noKey, first, second])).toHaveLength(3)
  })

  it('has deterministic group/card order and title under API ordering changes', () => {
    const a = card('A'), b = card('B'), c = card('C')
    b.knowledge!.measure_name = '二次供水设施'
    c.knowledge!.measure_key = 'elevator'
    expect(groupMeasureCards([c, b, a])).toEqual(groupMeasureCards([a, c, b]))
  })

  it('shows distinct source measure names when a broad key covers several actions', () => {
    const a = card('A'), b = card('B')
    b.knowledge!.measure_name = '雨污分流'
    expect(groupMeasureCards([a, b])[0].title).toBe('二次供水 / 雨污分流')
    const many = ['二次供水', '雨污分流', '污水管网', '燃气管网'].map((name, index) => { const item = card(String(index)); item.knowledge!.measure_name = name; return item })
    const group = groupMeasureCards(many)[0]
    expect(group.title).toBe('二次供水等4类记录')
    expect(group.cards.map(card => card.knowledge!.measure_name)).toEqual(many.map(card => card.knowledge!.measure_name))
  })

  it('counts source documents separately from evidence rows and source versions', () => {
    const a = card('A'), b = card('B'), c = card('C')
    b.fields[0].evidence[0].version = 'v2'
    c.fields[0].evidence[0].document_id = 'DOC-B'
    const group = groupMeasureCards([a, b, c])[0]
    expect(group.cards).toHaveLength(3)
    expect(group.sourceCount).toBe(2)
    expect(group.sourceVersionCount).toBe(3)
    expect(cardPresentationDetails(a).sourceIds).toEqual(['DOC-A'])
    expect(cardPresentationDetails(a).evidence).toHaveLength(2)
  })

  it('preserves separate record IDs even for identical historical duplicate cards', () => {
    const group = groupMeasureCards([card('OLD-A'), card('OLD-B')])[0]
    expect(group.cards.map(item => item.id)).toEqual(['OLD-A', 'OLD-B'])
    expect(group.sourceCount).toBe(1)
  })

  it('allows only approved identified sources and rejects cross-measure/project selection', () => {
    const a = card('A'), draft = card('D', { status: 'draft' }), rejected = card('R', { status: 'rejected' }), keyless = card('K', { knowledge: undefined }), other = card('B'), project = card('Q', { project_id: 'SYNTHETIC-Q' })
    other.knowledge!.measure_key = 'elevator'
    const cards = [a, draft, rejected, keyless, other, project]
    expect(cards.filter(skillSourceEligible).map(value => value.id)).toEqual(['A', 'B', 'Q'])
    for (const id of ['D', 'R', 'K', 'B', 'Q', 'missing']) expect(changeSkillSourceSelection(cards, ['A'], [id], true)).toMatchObject({ ids: ['A'], error: expect.any(String) })
  })

  it('can combine approved case/rule evidence for the same measure', () => {
    const a = card('A'), rule = card('R')
    rule.knowledge!.kind = 'rule'
    expect(changeSkillSourceSelection([a, rule], ['A'], ['R'], true)).toEqual({ ids: ['A', 'R'], error: null })
  })

  it('rejects a whole group exceeding 20 instead of silently truncating and allows exact limit', () => {
    const cards = Array.from({ length: 21 }, (_, index) => card(String(index)))
    expect(changeSkillSourceSelection(cards, [], cards.map(item => item.id), true)).toMatchObject({ ids: [], error: expect.stringContaining('21') })
    const selected = changeSkillSourceSelection(cards, [], cards.slice(0, 20).map(item => item.id), true)
    expect(selected.ids).toHaveLength(20); expect(selected.error).toBeNull()
    expect(changeSkillSourceSelection(cards, selected.ids, ['20'], true).ids).toEqual(selected.ids)
    expect(changeSkillSourceSelection(cards, selected.ids, ['0'], true).ids).toHaveLength(20)
    expect(changeSkillSourceSelection(cards, selected.ids, ['0', '1'], false).ids).toHaveLength(18)
  })
})

describe('exact persisted card reuse on repeated extraction', () => {
  let directory: string, store: Store, service: ExperienceService
  const raw = '项目名称：显式合成防重测试\n对象范围：7幢1单元\n阶段：实际实施\n2026年10月1日，7幢1单元已加装2台电梯，合同金额100万元。'
  beforeAll(async () => { directory = await mkdtemp(join(tmpdir(), 'measure-exact-reuse-')); store = await Store.open(directory); service = new ExperienceService(store); await service.initialize() })
  afterAll(async () => { await store.db.close(); await rm(directory, { recursive: true, force: true }) })
  const project = async (id: string): Promise<ProjectRecord> => {
    const input = { ...structuredClone(fixture), project_id: id, synthetic: true } as ProjectInput
    await store.db.query('INSERT INTO projects(id,name,owner_id,input) VALUES($1,$2,$3,$4)', [id, '显式合成防重测试', 'reviewer', JSON.stringify(input)])
    return (await store.project(id, 'reviewer'))!
  }
  const draft = (): ExperienceDraft => { const value = card('unused'); return { title: value.title, project_type: value.project_type, development_mode: value.development_mode, stage: value.stage, fields: value.fields, knowledge: value.knowledge } }

  it('repeated extraction of the same document/version returns existing IDs and no extra history', async () => {
    const p = await project('REPEAT')
    await store.db.query('INSERT INTO documents(id,project_id,file_name,blob_name,sha256,parser_result) VALUES($1,$2,$3,$4,$5,$6)', ['DOC-REPEAT', p.id, '显式合成.txt', 'unused', hash(raw), JSON.stringify({ status: 'extracted', text: raw, source_hash: hash(raw) })])
    const first = await service.extract(p, ['DOC-REPEAT'], false, true), second = await service.extract(p, ['DOC-REPEAT'], false, true)
    expect(first.cards.length).toBeGreaterThan(0)
    expect(second.cards.map(card => card.id)).toEqual(first.cards.map(card => card.id))
    const history = await store.db.query<{ card_id: string }>('SELECT card_id FROM experience_history WHERE card_id=ANY($1::text[])', [first.cards.map(card => card.id)])
    expect(history.rows).toHaveLength(first.cards.length)
  })

  it('reuses both same-batch duplicates and concurrent creation', async () => {
    const p = await project('CONCURRENT'), value = draft()
    const [left, right] = await Promise.all([service.repository.create(p.id, [value, structuredClone(value)], p.owner_id), service.repository.create(p.id, [value], p.owner_id)])
    expect(left).toHaveLength(1); expect(right[0].id).toBe(left[0].id)
    expect(await service.repository.list(p.id)).toHaveLength(1)
  })

  it.each(['approved', 'rejected'] as const)('preserves current %s review state and revision', async status => {
    const p = await project('REVIEW-' + status), value = draft()
    const [original] = await service.repository.create(p.id, [value], p.owner_id)
    const changed = { ...original, status, revision: 2, review_note: '保留复核记录' }
    await store.db.transaction(db => service.repository.save(changed, 1, 'review_' + status, p.owner_id, db))
    const [reused] = await service.repository.create(p.id, [value], p.owner_id)
    expect(reused).toEqual(changed)
    expect((await store.db.query('SELECT revision FROM experience_history WHERE card_id=$1', [reused.id])).rows).toHaveLength(2)
  })

  it('preserves distinct source versions, objects, stages, amount bases and projects', async () => {
    const p = await project('DISTINCT'), q = await project('DISTINCT-Q'), original = draft()
    const version = draft(); version.fields[0].evidence[0].version = 'v2'
    const object = draft(); object.knowledge!.factors![0].object_ref = '2号楼'
    const stage = draft(); stage.stage = '前期'
    const amount = draft(); amount.knowledge!.factors![0].amount_kind = 'budget'
    const factorStage = draft(); factorStage.knowledge!.factors![0].stage = '招标'
    const created = await service.repository.create(p.id, [original, version, object, stage, amount, factorStage], p.owner_id)
    expect(new Set(created.map(card => card.id)).size).toBe(6)
    const [other] = await service.repository.create(q.id, [original], q.owner_id)
    expect(created.map(card => card.id)).not.toContain(other.id)
  })

  it('never revives an old approved history after current content was edited', async () => {
    const p = await project('HISTORY'), value = draft()
    const [original] = await service.repository.create(p.id, [value], p.owner_id)
    await store.db.transaction(db => service.repository.save({ ...original, revision: 2, title: '已修改内容', status: 'draft' }, 1, 'update', p.owner_id, db))
    const [created] = await service.repository.create(p.id, [value], p.owner_id)
    expect(created.id).not.toBe(original.id); expect(created.status).toBe('draft')
  })

  it('finds exact older records beyond the presentation list limit of 200', async () => {
    const p = await project('LARGE'), first = draft()
    const cards = await service.repository.create(p.id, [first, ...Array.from({ length: 201 }, (_, index) => ({ ...draft(), title: `合成记录${index}` }))], p.owner_id)
    const [reused] = await service.repository.create(p.id, [first], p.owner_id)
    expect(reused.id).toBe(cards[0].id)
    expect((await store.db.query('SELECT id FROM experience_cards WHERE project_id=$1', [p.id])).rows).toHaveLength(202)
  })
})
