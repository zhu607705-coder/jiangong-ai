import { describe, expect, it } from 'vitest'
import type { ExperienceCard, ExperienceEvidence, FactorDefinition, FactorPolicy, MeasureFactor } from '../../apps/host/generated/contracts'
import { validate } from '../../packages/contracts/validate'
import { factorDistance, groupKnowledge } from '../../packages/experience/clustering'

// These records exercise the engineering contract; they are not enterprise cases or calibrated thresholds.
const evidence = (version = 'fixture-v1'): ExperienceEvidence => ({ document_id: 'D-FIXTURE', version, locator: 'line:1', quote: '合成测试资料：已确认的测量值' })
const factor = (key: string, value: MeasureFactor['value'], patch: Partial<MeasureFactor> = {}): MeasureFactor => ({
  key, label: key, value, unit: null, object_ref: 'building:B1', stage: 'implementation', observed_at: '2026-09-01',
  association: 'direct', amount_kind: 'not_applicable', epistemic_status: 'fact', evidence: [evidence()], ...patch,
})
const definition = (key: string, patch: Partial<FactorDefinition> = {}): FactorDefinition => ({
  key, label: key, value_type: 'number', role: 'key', weight: 1, unit: null, scale: 100, measure_keys: [], evidence: [evidence()], ...patch,
})
const policy = (definitions = [definition('age')], patch: Partial<FactorPolicy> = {}): FactorPolicy => ({
  id: 'FP-FIXTURE', project_id: 'P-FIXTURE', revision: 1, status: 'draft', definitions, min_coverage: 1, max_distance: 0.2,
  note: '仅用于工程测试，未经业务校准', reviewed_by: null, reviewed_at: null, created_at: '2026-09-01', updated_at: '2026-09-01', ...patch,
})
const card = (id: string, factors = [factor('age', 20)], patch: Partial<ExperienceCard> = {}): ExperienceCard => ({
  id, project_id: 'P-' + id, title: '合成改造记录', project_type: 'old_neighborhood', development_mode: 'renovation', stage: 'implementation',
  fields: [], status: 'approved', revision: 1, review_note: '测试审核', created_at: '2026-09-01', updated_at: '2026-09-01',
  knowledge: { kind: 'case', origin: 'project_case', measure_key: 'drainage.update', measure_name: '排水更新',
    conditions: [], exclusions: [], transfer_notes: [], evidence_level: 'implementation_record', factors }, ...patch,
})
const memberships = (cards: ExperienceCard[], p: FactorPolicy | null, maxCandidates?: number) => groupKnowledge(cards, p, maxCandidates).groups
  .map(group => group.card_refs.map(ref => ref.card_id))

describe('provenance-aware mixed factor distance', () => {
  it('returns weighted Gower distance for numeric, category, boolean and explicit ordinal ranks', () => {
    const p = policy([definition('number', { weight: 2, unit: 'm', scale: 10 }), definition('category', { value_type: 'category', scale: null }),
      definition('boolean', { value_type: 'boolean', scale: null }), definition('ordinal', { value_type: 'ordinal', scale: 4 })])
    const left = [factor('number', 2, { unit: 'm' }), factor('category', 'steel'), factor('boolean', false), factor('ordinal', 1)]
    const right = [factor('number', 7, { unit: 'm' }), factor('category', 'steel'), factor('boolean', true), factor('ordinal', 3)]
    expect(factorDistance(left, right, p)).toMatchObject({ distance: 0.5, coverage: 1, comparable: true })
    expect(factorDistance(right, left, p)).toEqual(factorDistance(left, right, p))
  })

  it('clips numeric differences to one and preserves real zero, false and equal categories', () => {
    expect(factorDistance([factor('age', -100)], [factor('age', 1000)], policy())).toMatchObject({ distance: 1, coverage: 1, comparable: true })
    const p = policy([definition('age'), definition('resident', { value_type: 'boolean', scale: null }), definition('kind', { value_type: 'category', scale: null })])
    const values = [factor('age', 0), factor('resident', false), factor('kind', 'brick')]
    expect(factorDistance(values, values, p)).toMatchObject({ distance: 0, coverage: 1, comparable: true })
  })

  it('keeps missing values out of the distance and reports common weighted coverage', () => {
    const p = policy([definition('age', { weight: 3 }), definition('height')], { min_coverage: 0.7 })
    const left = [factor('age', 20), factor('height', null, { epistemic_status: 'missing' })]
    const right = [factor('age', 30), factor('height', 80)]
    expect(factorDistance(left, right, p)).toMatchObject({ distance: 0.1, coverage: 0.75, comparable: true })
    p.min_coverage = 0.8
    expect(factorDistance(left, right, p)).toMatchObject({ distance: null, coverage: 0.75, comparable: false })
  })

  it('cannot manufacture similarity from no common values, even when min_coverage is zero', () => {
    const p = policy([definition('age'), definition('height')], { min_coverage: 0 })
    const result = factorDistance([factor('age', 1)], [factor('height', 1)], p)
    expect(result).toMatchObject({ distance: null, coverage: 0, comparable: false })
    expect(result.reasons.length).toBeGreaterThan(0)
  })

  it('includes only positive key/mandatory weights and the requested measure scope', () => {
    const p = policy([definition('age', { role: 'mandatory' }), definition('background', { role: 'background', weight: 100 }),
      definition('discarded', { role: 'discarded' }), definition('pending', { role: 'pending' }), definition('zero', { weight: 0 }),
      definition('elevator', { measure_keys: ['elevator.install'], weight: 100 })])
    expect(factorDistance([factor('age', 20)], [factor('age', 20)], p, 'drainage.update')).toMatchObject({ distance: 0, coverage: 1, comparable: true })
    expect(factorDistance([], [], policy([definition('background', { role: 'background' })]))).toMatchObject({ distance: null, coverage: 0, comparable: false })
  })

  it.each([
    ['numeric string', factor('age', '20'), definition('age')],
    ['nonfinite number', factor('age', Number.NaN), definition('age')],
    ['infinite number', factor('age', Number.POSITIVE_INFINITY), definition('age')],
    ['wrong unit', factor('age', 20, { unit: 'years' }), definition('age')],
    ['missing scale', factor('age', 20), definition('age', { scale: null })],
    ['zero scale', factor('age', 20), definition('age', { scale: 0 })],
    ['category number', factor('age', 20), definition('age', { value_type: 'category' })],
    ['boolean string', factor('age', 'true'), definition('age', { value_type: 'boolean' })],
    ['ordinal label', factor('age', 'high'), definition('age', { value_type: 'ordinal' })],
    ['unscaled ordinal', factor('age', 20), definition('age', { value_type: 'ordinal', scale: null })],
  ] as const)('treats %s as unavailable instead of coercing it', (_label, value, def) => {
    const result = factorDistance([value], [factor('age', 20)], policy([def]))
    expect(result).toMatchObject({ distance: null, coverage: 0, comparable: false })
    expect(result.reasons.length).toBeGreaterThan(0)
  })

  it.each([
    { evidence: [] }, { evidence: [evidence('')] }, { epistemic_status: 'estimate' as const },
    { epistemic_status: 'scenario_assumption' as const }, { epistemic_status: 'missing' as const }, { association: 'unresolved' as const },
  ])('does not use unconfirmed or unbound factors: %j', patch => {
    expect(factorDistance([factor('age', 20, patch)], [factor('age', 20)], policy())).toMatchObject({ distance: null, coverage: 0, comparable: false })
  })

  it.each(['value', 'unit', 'stage', 'amount_kind', 'object_ref'] as const)('does not select a convenient duplicate when %s conflicts', key => {
    const conflict = factor('age', 20)
    const patches: Record<typeof key, Partial<MeasureFactor>> = { value: { value: 21 }, unit: { unit: 'm' }, stage: { stage: 'proposal' },
      amount_kind: { amount_kind: 'contract' }, object_ref: { object_ref: 'building:B2' } }
    Object.assign(conflict, patches[key])
    const result = factorDistance([factor('age', 20), conflict], [factor('age', 20)], policy())
    expect(result).toMatchObject({ distance: null, coverage: 0, comparable: false })
    expect(factorDistance([conflict, factor('age', 20)], [factor('age', 20)], policy())).toEqual(result)
  })

  it('allows repeated identical measurements without counting their weight twice', () => {
    const p = policy(), a = factor('age', 20), b = factor('age', 30)
    expect(factorDistance([a, structuredClone(a)], [b], p)).toEqual(factorDistance([a], [b], p))
  })

  it.each([
    { amount_kind: 'paid' as const }, { amount_kind: 'unknown' as const }, { association: 'shared' as const },
    { association: 'unresolved' as const }, { stage: 'proposal' },
  ])('keeps equal amounts with incompatible funding meaning/stage unavailable: %j', patch => {
    const a = factor('cost', 40, { unit: '万元', amount_kind: 'contract' }), b = { ...a, ...patch }
    expect(factorDistance([a], [b], policy([definition('cost', { unit: '万元' })]))).toMatchObject({ distance: null, coverage: 0, comparable: false })
  })

  it('compares a directly cited amount only with the same monetary kind and units', () => {
    const a = factor('cost', 40, { unit: '万元', amount_kind: 'contract' })
    expect(factorDistance([a], [{ ...a, value: 50 }], policy([definition('cost', { unit: '万元' })]))).toMatchObject({ distance: 0.1, coverage: 1, comparable: true })
  })

  it('keeps funding confirmation and funding-source categories distinct from monetary measurements', () => {
    const p = policy([definition('funding.confirmed', { value_type: 'boolean', scale: null }), definition('funding.source', { value_type: 'category', scale: null })])
    const factors = [factor('funding.confirmed', true), factor('funding.source', 'residents')]
    expect(factorDistance(factors, factors, p)).toMatchObject({ distance: 0, coverage: 1, comparable: true })
  })

  it('does not silently accept ambiguous policy definitions or invalid coverage thresholds', () => {
    expect(factorDistance([factor('age', 20)], [factor('age', 20)], policy([definition('age'), definition('age', { scale: 1 })]))).toMatchObject({ distance: null, comparable: false })
    expect(factorDistance([factor('age', 20)], [factor('age', 20)], policy(undefined, { min_coverage: Number.NaN }))).toMatchObject({ distance: null, comparable: false })
  })
})

describe('bounded complete-linkage knowledge grouping', () => {
  it('groups reviewed like-asset records with a draft preview and a reproducible Canonical result', () => {
    const cards = [card('A'), card('B', [factor('age', 25, { object_ref: 'building:B2' })])], p = policy()
    const before = structuredClone({ cards, p }), result = groupKnowledge(cards, p)
    expect(result).toMatchObject({ policy_id: p.id, policy_revision: p.revision, policy_status: 'draft', candidate_count: 2, truncated: false, unassigned: [] })
    expect(result.groups).toHaveLength(1)
    expect(result.groups[0]).toMatchObject({ measure_key: 'drainage.update', stage: 'implementation', kind: 'case', diameter: 0.05, min_coverage: 1,
      card_refs: [{ card_id: 'A', revision: 1 }, { card_id: 'B', revision: 1 }] })
    expect(validate('KnowledgeGrouping', result)).toEqual(result)
    expect({ cards, p }).toEqual(before)
  })

  it.each(['measure', 'stage', 'kind', 'asset', 'facility_type', 'evidence_phase'] as const)('cannot cross the hard %s pool even at zero factor distance', change => {
    const a = card('A'), b = card('B')
    if (change === 'measure') { a.knowledge!.measure_key = 'elevator.install'; b.knowledge!.measure_key = 'elevator.update' }
    if (change === 'stage') b.stage = 'proposal'
    if (change === 'kind') b.knowledge!.kind = 'rule'
    if (change === 'asset') b.knowledge!.factors![0].object_ref = 'unit:U1'
    if (change === 'facility_type') { a.knowledge!.factors![0].object_ref = 'facility:elevator:E1'; b.knowledge!.factors![0].object_ref = 'facility:drainage:D1' }
    if (change === 'evidence_phase') b.knowledge!.evidence_level = 'proposal_only'
    expect(memberships([a, b], policy())).toEqual([['A'], ['B']])
  })

  it('keeps equal funding values with different stages in separate groups', () => {
    const a = card('A', [factor('cost', 40, { unit: '万元', amount_kind: 'contract' })])
    const b = card('B', [factor('cost', 40, { unit: '万元', amount_kind: 'contract', stage: 'proposal' })], { stage: 'proposal' })
    expect(memberships([a, b], policy([definition('cost', { unit: '万元' })]))).toEqual([['A'], ['B']])
  })

  it('returns explicit unassigned reasons for missing or mixed asset object types', () => {
    const absent = card('ABSENT', [factor('age', 20, { object_ref: null })])
    const generic = card('GENERIC', [factor('age', 20, { object_ref: 'project:P' })])
    const mixed = card('MIXED', [factor('age', 20), factor('other', 1, { object_ref: 'unit:U1' })])
    const result = groupKnowledge([absent, generic, mixed], policy())
    expect(result.groups).toHaveLength(0)
    expect(result.unassigned.map(row => row.card_id)).toEqual(['ABSENT', 'GENERIC', 'MIXED'])
    expect(result.unassigned.every(row => row.reason.length > 0)).toBe(true)
  })

  it('never takes an unresolved shared money reference as the asset binding', () => {
    const result = groupKnowledge([card('A', [factor('cost', 40, { unit: '万元', amount_kind: 'contract', association: 'shared' })])], policy([definition('cost', { unit: '万元' })]))
    expect(result.groups).toHaveLength(0)
    expect(result.unassigned).toHaveLength(1)
  })

  it('recognizes cited local building/unit references and explicit facility subtypes', () => {
    const records = [card('A', [factor('age', 20, { object_ref: '1号楼' })]), card('B', [factor('age', 20, { object_ref: '2号楼' })]),
      card('C', [factor('age', 20, { object_ref: '3单元' })]), card('D', [factor('age', 20, { object_ref: '4单元' })]),
      card('E', [factor('age', 20, { object_ref: 'elevator:E1' })]), card('F', [factor('age', 20, { object_ref: 'elevator:E2' })])]
    expect(memberships(records, policy())).toEqual([['A', 'B'], ['C', 'D'], ['E', 'F']])
  })

  it('uses complete linkage so a close intermediary cannot chain distant records together', () => {
    const records = [card('A', [factor('age', 0)]), card('B', [factor('age', 15)]), card('C', [factor('age', 30)])]
    const result = groupKnowledge(records, policy())
    expect(result.groups.map(group => group.card_refs.map(ref => ref.card_id))).toEqual([['A', 'B'], ['C']])
    expect(result.groups.every(group => group.diameter! <= 0.2)).toBe(true)
  })

  it('requires every cross-group pair to meet common coverage', () => {
    const p = policy([definition('age'), definition('height')], { min_coverage: 0.5, max_distance: 1 })
    const records = [card('A', [factor('age', 1)]), card('B', [factor('age', 1), factor('height', 1)]), card('C', [factor('height', 1)])]
    expect(memberships(records, p)).toEqual([['A', 'B'], ['C']])
  })

  it('leaves unreviewed, legacy and insufficiently evidenced factor records unassigned', () => {
    const draft = card('DRAFT', undefined, { status: 'draft' }), rejected = card('REJECTED', undefined, { status: 'rejected' })
    const legacy = card('LEGACY'); delete legacy.knowledge
    const unknown = card('UNKNOWN', [factor('age', null, { epistemic_status: 'missing' })])
    const result = groupKnowledge([draft, rejected, legacy, unknown], policy())
    expect(result.groups).toHaveLength(0); expect(result.unassigned).toHaveLength(4)
    expect(result.candidate_count).toBe(4)
  })

  it('returns an explanatory no-policy result without invented calibration', () => {
    const result = groupKnowledge([card('A'), card('B')], null)
    expect(result).toMatchObject({ policy_id: null, policy_revision: null, policy_status: 'none', groups: [], candidate_count: 2, truncated: false })
    expect(result.unassigned.map(row => row.card_id)).toEqual(['A', 'B'])
    expect(result.unassigned.every(row => !!row.reason)).toBe(true)
    expect(validate('KnowledgeGrouping', result)).toEqual(result)
  })

  it('does not group with rejected policies or invalid distance thresholds', () => {
    for (const p of [policy(undefined, { status: 'rejected' }), policy(undefined, { max_distance: Number.NaN }), policy(undefined, { max_distance: 2 })]) {
      const result = groupKnowledge([card('A'), card('B')], p)
      expect(result.groups).toHaveLength(0); expect(result.unassigned).toHaveLength(2)
    }
  })

  it('keeps memberships, IDs and fingerprints independent of input, factor and definition order', () => {
    const p = policy([definition('age'), definition('kind', { value_type: 'category', scale: null })], { max_distance: 0.3 })
    const cards = [card('C', [factor('age', 60), factor('kind', 'brick')]), card('B', [factor('kind', 'brick'), factor('age', 15)]), card('A', [factor('age', 0), factor('kind', 'brick')])]
    const first = groupKnowledge(cards, p), second = groupKnowledge([...cards].reverse().map(value => ({ ...value, knowledge: { ...value.knowledge!, factors: [...value.knowledge!.factors!].reverse() } })), { ...p, definitions: [...p.definitions].reverse() })
    expect(second).toEqual(first)
  })

  it('invalidates the source fingerprint for card, factor-source and policy revisions', () => {
    const cards = [card('A'), card('B')], p = policy(), initial = groupKnowledge(cards, p)
    const changedCard = structuredClone(cards); changedCard[0].revision++
    const changedSource = structuredClone(cards); changedSource[0].knowledge!.factors![0].evidence[0].version = 'fixture-v2'
    const changedValue = structuredClone(cards); changedValue[0].knowledge!.factors![0].value = 21
    for (const changed of [groupKnowledge(changedCard, p), groupKnowledge(changedSource, p), groupKnowledge(changedValue, p), groupKnowledge(cards, { ...p, revision: 2 })]) {
      expect(changed.source_fingerprint).not.toBe(initial.source_fingerprint)
    }
  })

  it('does not fingerprint excluded background values as distance inputs', () => {
    const p = policy([definition('age'), definition('background', { role: 'background' })])
    const cards = [card('A', [factor('age', 20), factor('background', 1)])], changed = structuredClone(cards)
    changed[0].knowledge!.factors![1].value = 100
    expect(groupKnowledge(changed, p)).toEqual(groupKnowledge(cards, p))
  })

  it('does not infer condition admission from grouping or a draft policy', () => {
    const records = [card('A'), card('B')]
    records[0].knowledge!.conditions = [{ fact_kind: 'engineering.confirmed', label: '专业检测须确认', operator: 'eq', value: true, unit: null, evidence: [evidence()] }]
    const result = groupKnowledge(records, policy())
    expect(result.groups).toHaveLength(1); expect(result.policy_status).toBe('draft')
    expect(result).not.toHaveProperty('guard'); expect(result).not.toHaveProperty('decision'); expect(result).not.toHaveProperty('action')
  })

  it('makes the default 200-record cap and omitted assignment count explicit', () => {
    const records = Array.from({ length: 205 }, (_, i) => card('C-' + String(i).padStart(3, '0'))), result = groupKnowledge(records, policy())
    expect(result.candidate_count).toBe(205); expect(result.truncated).toBe(true)
    const assigned = result.groups.flatMap(group => group.card_refs)
    expect(assigned).toHaveLength(200); expect(result.candidate_count - assigned.length).toBe(5)
    expect(result.unassigned.map(row => row.card_id)).toEqual(records.slice(200).map(value => value.id))
    expect(validate('KnowledgeGrouping', result)).toEqual(result)
    expect(groupKnowledge([...records].reverse(), policy())).toEqual(result)
  })

  it('respects a smaller explicit cap and reports unprocessed rows without pretending completion', () => {
    const records = [card('C'), card('B'), card('A')], result = groupKnowledge(records, policy(), 2)
    expect(result).toMatchObject({ candidate_count: 3, truncated: true })
    expect(result.groups.flatMap(group => group.card_refs).map(ref => ref.card_id)).toEqual(['A', 'B'])
    expect(result.unassigned.map(row => row.card_id)).toEqual(['C'])
  })

  it('keeps no-policy unassigned detail within the Canonical maximum while preserving the total', () => {
    const records = Array.from({ length: 205 }, (_, i) => card('C-' + String(i).padStart(3, '0'))), result = groupKnowledge(records, null)
    expect(result).toMatchObject({ groups: [], candidate_count: 205, truncated: true })
    expect(result.unassigned).toHaveLength(200)
    expect(validate('KnowledgeGrouping', result)).toEqual(result)
  })
})
