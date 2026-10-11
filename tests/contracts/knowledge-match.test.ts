import { describe, expect, it } from 'vitest'
import type { ExperienceCard, ExperienceEvidence, Fact, KnowledgeCondition, KnowledgeQuery, ProjectInput, Source } from '../../apps/host/generated/contracts'
import { validate } from '../../packages/contracts/validate'
import { KNOWLEDGE_POLICY_VERSION, matchKnowledge } from '../../packages/experience/knowledge'

const evidence = (quote = '居民需求已确认'): ExperienceEvidence => ({ document_id: 'D-CASE', version: 'doc-v1', locator: 'line:1', quote })
const source = (patch: Partial<Source> = {}): Source => ({ id: 'S-FACT', title: '项目居民确认材料', data_class: 'public', visibility: 'public', synthetic: false,
  hash: 'source-v1', content_status: 'full_text', parse_status: 'extracted', published_at: '2026-09-01', object_refs: ['project:P1'], evidence_scope: 'object', ...patch })
const fact = (patch: Partial<Fact> = {}): Fact => ({ id: 'F-RESIDENT', kind: 'retrofit.resident_needs_confirmed', value: true, unit: null,
  source_id: 'S-FACT', object_ref: 'project:P1', observed_at: '2026-09-20', locator: 'line:1', scope_kind: 'project', epistemic_status: 'fact', ...patch })
const condition = (patch: Partial<KnowledgeCondition> = {}): KnowledgeCondition => ({ fact_kind: 'retrofit.resident_needs_confirmed', label: '居民需求已确认', operator: 'eq', value: true, unit: null, evidence: [evidence()], ...patch })
const project = (): ProjectInput => ({ schema_version: '2.0', project_id: 'P1', synthetic: false, purpose: '排水管网改造', mode: 'automatic', role: 'planner', as_of: '2026-09-30',
  scope: { name: '目标小区', geometry: null, coordinate_encoding: 'WGS84', legal_parcel_confirmed: false }, sources: [source()], facts: [fact()], context_rules: [], candidate_ids: ['retain_and_reuse'], events: [] })
const query: KnowledgeQuery = { measure_key: 'drainage.update', question: '排水管网改造' }
const field = (key: ExperienceCard['fields'][number]['key'], value: string) => ({ key, value, evidence: [evidence(value)] })
const card = (id = 'CASE-1', kind: 'case' | 'rule' = 'case'): ExperienceCard => ({ id, project_id: 'HISTORY-P1', title: '排水管网改造', project_type: '老旧小区', development_mode: '综合整治', stage: '前期策划',
  status: 'approved', revision: 2, review_note: '已对照原文', created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-02T00:00:00Z',
  fields: [field('decision_question', '排水管网改造'), field('actual_decision', '先更新排水管网'), field('implementation', '管网更新完成'), field('outcome', '雨季倒灌减少')],
  knowledge: { kind, origin: kind === 'case' ? 'project_case' : 'official_policy', measure_key: 'drainage.update', measure_name: '排水管网改造', conditions: [condition()], exclusions: [], transfer_notes: ['实施前核实管网接口'], evidence_level: kind === 'case' ? 'implementation_record' : 'official_policy' } })
const candidate = (p: ProjectInput, value = card()) => matchKnowledge(p, [value], query).candidates[0]

describe('case and rule direct routing', () => {
  it.each([
    ['case_hit', [card()]], ['rule_hit', [card('RULE-1', 'rule')]],
    ['combined_hit', [card(), card('RULE-1', 'rule')]], ['agent_fallback', []],
  ] as const)('routes %s solely from usable direct knowledge', (route, cards) => {
    const p = project(), before = structuredClone({ p, cards, query }), result = matchKnowledge(p, [...cards], query)
    expect(result.route).toBe(route)
    expect(result.fallback_status).toBe(route === 'agent_fallback' ? 'pending' : 'not_needed')
    expect(result.policy_version).toBe(KNOWLEDGE_POLICY_VERSION)
    expect(result.evaluated_as_of).toBe(p.as_of)
    expect(validate('KnowledgeTrace', result)).toEqual(result)
    expect({ p, cards, query }).toEqual(before)
  })

  it('excludes draft, rejected and legacy cards even if their text resembles the target', () => {
    const draft = card('DRAFT'), rejected = card('REJECTED'), legacy = card('LEGACY')
    draft.status = 'draft'; rejected.status = 'rejected'; delete legacy.knowledge
    expect(matchKnowledge(project(), [draft, rejected, legacy], query)).toMatchObject({ route: 'agent_fallback', case_hits: [], rule_hits: [], candidates: [] })
  })

  it('keeps a highly similar different measure non-transferable', () => {
    const value = card(); value.knowledge!.measure_key = 'elevator.install'
    const result = candidate(project(), value)
    expect(result.similarity).toBe(1)
    expect(result.related).toBe(false)
    expect(result.transferability).toBe('not_transferable')
    expect(result.important_differences.join('')).toContain('举措')
  })

  it('uses lexical question relevance when no measure key is supplied', () => {
    const matched = matchKnowledge(project(), [card()], { measure_key: '', question: '排水管网改造' })
    expect(matched.route).toBe('case_hit')
    expect(matched.reasons.join('')).toContain('词法')
    const unrelated = matchKnowledge(project(), [card()], { measure_key: '', question: '太阳风预测' })
    expect(unrelated.route).toBe('agent_fallback')
    expect(unrelated.candidates[0].related).toBe(false)
  })

  it('cannot hit from an empty condition array even with an exact textual match', () => {
    const value = card(); value.knowledge!.conditions = []
    const result = candidate(project(), value)
    expect(result.similarity).toBe(1); expect(result.transferability).toBe('conditional')
    expect(result.unknowns.join('')).toContain('结构化')
  })

  it.each(['actual_decision', 'implementation', 'proposal', 'decision_basis'] as const)('accepts a cited %s recommendation without inventing a different historical phase', key => {
    const value = card(); value.fields = [field(key, '原文建议先做试验段')]
    const result = matchKnowledge(project(), [value], query)
    expect(result.route).toBe('case_hit')
    expect(result.case_hits[0].recommendation).toBe('原文建议先做试验段')
    expect(result.case_hits[0].important_differences.join('')).toContain('未提供可引用')
  })

  it.each(['missing', 'no_citation', 'forged_quote'] as const)('requires a recommendation supported by its own quote: %s', mode => {
    const value = card(); value.fields = mode === 'missing' ? [] : [field('actual_decision', '先更换路面')]
    if (mode === 'no_citation') value.fields[0].evidence = []
    if (mode === 'forged_quote') value.fields[0].evidence[0].quote = '原文仅写居民需求已确认'
    expect(candidate(project(), value)).toMatchObject({ transferability: 'conditional', recommendation: null })
  })

  it('preserves all distinct same-measure rule advice and flags a reviewable disagreement', () => {
    const first = card('RULE-A', 'rule'), second = card('RULE-B', 'rule')
    second.fields = [field('decision_basis', '先检查地下管线接口')]
    const result = matchKnowledge(project(), [first, second], query)
    expect(result.route).toBe('rule_hit'); expect(result.rule_hits).toHaveLength(2)
    expect(result.rule_hits.map(row => row.recommendation)).toEqual(['先更新排水管网', '先检查地下管线接口'])
    expect(result.reasons.join('')).toContain('不同推荐原文')
    expect(result.reasons.join('')).toContain('不能自动判')
  })

  it('qualifies proposal-only cases and observational papers without asserting a measured effect', () => {
    const proposal = card(); proposal.knowledge!.evidence_level = 'proposal_only'; proposal.fields = [field('proposal', '建议先做试验段')]
    const observed = card('RULE-OBS', 'rule'); observed.knowledge!.origin = 'research_paper'; observed.knowledge!.evidence_level = 'observational_study'
    const result = matchKnowledge(project(), [proposal, observed], query)
    expect(result.case_hits[0].important_differences.join('')).toContain('不能宣称实施效果')
    expect(result.rule_hits[0].important_differences.join('')).toContain('不能据此确认因果效益')
  })
})

describe('strict structured knowledge conditions', () => {
  it.each([
    ['eq', true, true], ['ne', true, false], ['gt', 2, 1], ['gte', 2, 2], ['lt', 2, 3], ['lte', 2, 2], ['contains', '居民已确认', '居民'],
  ] as const)('compares %s only on compatible scalar values', (operator, value, required) => {
    const p = project(), sample = card(); p.facts[0].value = value; sample.knowledge!.conditions[0] = condition({ operator, value: required })
    const result = matchKnowledge(p, [sample], query)
    expect(result.route).toBe('case_hit'); expect(result.case_hits[0].conditions[0].state).toBe('matched')
  })

  it.each([
    ['eq', '10', 10], ['ne', '10', 10], ['gt', '10', 2], ['gte', 'true', true], ['lt', true, false], ['lte', 10, '10'], ['contains', 10, 1],
  ] as const)('never coerces values for %s', (operator, value, required) => {
    const p = project(), sample = card(); p.facts[0].value = value; sample.knowledge!.conditions[0] = condition({ operator, value: required })
    expect(candidate(p, sample).conditions[0].state).toBe('unknown')
  })

  it('records a verified unmet prerequisite as a non-transferable difference', () => {
    const p = project(); p.facts[0].value = false
    const result = candidate(p)
    expect(result.transferability).toBe('not_transferable')
    expect(result.conditions[0].state).toBe('unmatched')
    expect(result.important_differences.join('')).toContain('不满足')
    expect(result.recommendation).toBe('先更新排水管网')
  })

  it.each([
    ['opposite booleans', true, false], ['two values both above threshold', 100, 200], ['different types', 100, '100'],
  ] as const)('preserves same-kind multi-value conflict: %s', (_name, first, second) => {
    const p = project(), sample = card(); p.facts = [fact({ value: first }), fact({ id: 'F-OTHER', value: second })]
    if (typeof first === 'number') sample.knowledge!.conditions[0] = condition({ operator: 'gte', value: 50 })
    const result = candidate(p, sample)
    expect(result.conditions[0].state).toBe('conflict')
    expect(result.conditions[0].fact_refs).toEqual(['F-RESIDENT', 'F-OTHER'])
    expect(result.transferability).toBe('conditional')
  })

  it('allows agreeing duplicate facts while retaining both source references', () => {
    const p = project(); p.sources.push(source({ id: 'S-FACT2' })); p.facts.push(fact({ id: 'F-DUPLICATE', source_id: 'S-FACT2' }))
    const result = matchKnowledge(p, [card()], query).case_hits[0]
    expect(result.conditions[0].fact_refs).toEqual(['F-RESIDENT', 'F-DUPLICATE'])
    expect(result.evidence_refs).toEqual(['S-KB-CASE-1-R2', 'S-FACT', 'S-FACT2'])
    expect(result.conditions[0].evidence_refs).toEqual(result.evidence_refs)
  })

  it.each([[null, 'm2'], ['m2', null], ['万元', '元']] as const)('does not convert a %s fact into a %s condition', (actual, required) => {
    const p = project(), sample = card(); p.facts[0].value = 100; p.facts[0].unit = actual
    sample.knowledge!.conditions[0] = condition({ operator: 'gte', value: 100, unit: required })
    expect(candidate(p, sample).conditions[0]).toMatchObject({ state: 'unknown', reason: expect.stringContaining('单位') })
  })

  it('does not select the convenient unit when same-kind records have different units', () => {
    const p = project(), sample = card(); p.facts = [fact({ value: 100, unit: 'm2' }), fact({ id: 'F-HA', value: 1, unit: 'ha' })]
    sample.knowledge!.conditions[0] = condition({ value: 100, unit: 'm2' })
    expect(candidate(p, sample).conditions[0].state).toBe('unknown')
  })

  it('requires intact source references on a structured condition itself', () => {
    const sample = card(); sample.knowledge!.conditions[0].evidence[0].locator = ''
    expect(candidate(project(), sample).conditions[0].state).toBe('unknown')
  })

  it('keeps a highly similar missing prerequisite as a candidate and explains what to verify', () => {
    const p = project(); p.facts = []
    const result = candidate(p)
    expect(result.similarity).toBe(1); expect(result.transferability).toBe('conditional')
    expect(result.unknowns.join('')).toContain('居民需求已确认')
    expect(result.reuse_premises.join('')).toContain('管网接口')
    expect(result.evidence_refs).toEqual(['S-KB-CASE-1-R2'])
  })
})

describe('fact provenance and exclusion admission', () => {
  it.each([
    { value: null }, { value: '' }, { value: Number.NaN }, { epistemic_status: 'assumption' as const }, { epistemic_status: 'estimate' as const },
    { epistemic_status: 'missing' as const }, { epistemic_status: undefined }, { observed_at: '2099-01-01' }, { observed_at: undefined },
    { locator: undefined }, { object_ref: 'project:OTHER' }, { object_ref: 'building:B1' }, { source_id: 'MISSING' },
    { scope_kind: 'shared' as const, applies_to: ['project:OTHER'] },
  ])('does not admit an unusable fact: %j', patch => {
    const p = project(); p.facts = [fact(patch)]
    const result = candidate(p).conditions[0]
    expect(result.state).toBe('unknown'); expect(result.fact_refs).toEqual([])
    expect(result.evidence_refs).toEqual(['S-KB-CASE-1-R2'])
  })

  it.each([
    { published_at: '2099-01-01' }, { expires_at: '2026-09-01' }, { date_status: 'conflict' as const }, { hash: undefined },
    { content_status: 'metadata_only' as const }, { parse_status: 'empty' as const }, { parse_status: 'ocr_required' as const },
    { evidence_scope: 'area' as const }, { evidence_scope: 'background' as const }, { object_refs: ['project:OTHER'] }, { synthetic: true },
  ])('does not admit an unusable source: %j', patch => {
    const p = project(); p.sources = [source(patch)]
    expect(candidate(p).conditions[0]).toMatchObject({ state: 'unknown', fact_refs: [], evidence_refs: ['S-KB-CASE-1-R2'] })
  })

  it('cannot reuse knowledge against an invalid project cutoff', () => {
    const p = project(); p.as_of = '2026-02-30'
    expect(candidate(p).conditions[0].state).toBe('unknown')
  })

  it('accepts explicitly bound shared project facts without admitting a different object', () => {
    const p = project(); p.facts[0].scope_kind = 'shared'; p.facts[0].applies_to = ['project:P1']
    expect(matchKnowledge(p, [card()], query).route).toBe('case_hit')
    p.facts[0].object_ref = 'building:B1'
    expect(candidate(p).conditions[0].state).toBe('unknown')
  })

  it.each(['matched', 'unmatched', 'unknown', 'conflict'] as const)('requires exclusions to be explicitly unmatched: %s', state => {
    const p = project(), sample = card(); sample.knowledge!.exclusions = [condition({ fact_kind: 'retrofit.safety_veto', label: '工程安全否决' })]
    if (state !== 'unknown') p.facts.push(fact({ id: 'F-SAFETY', kind: 'retrofit.safety_veto', value: state !== 'unmatched' }))
    if (state === 'conflict') p.facts.push(fact({ id: 'F-SAFETY2', kind: 'retrofit.safety_veto', value: false }))
    const result = matchKnowledge(p, [sample], query), matched = state === 'unmatched' ? result.case_hits[0] : result.candidates[0]
    expect(matched.exclusions[0].state).toBe(state)
    expect(matched.transferability).toBe(state === 'matched' ? 'not_transferable' : state === 'unmatched' ? 'transferable' : 'conditional')
    expect(result.route).toBe(state === 'unmatched' ? 'case_hit' : 'agent_fallback')
  })
})

describe('stable source-bound candidate presentation', () => {
  it('orders equal lexical matches by stable card identity rather than input order', () => {
    const p = project(); p.facts = []
    const a = card('A'), b = card('B'), newer = card('A'); newer.revision = 3
    const first = matchKnowledge(p, [b, a, newer], query), second = matchKnowledge(p, [newer, b, a], query)
    expect(first).toEqual(second)
    expect(first.candidates.map(row => [row.card_id, row.card_revision])).toEqual([['A', 3], ['A', 2], ['B', 2]])
    expect(first.candidates[0].evidence_refs).toEqual(['S-KB-A-R3'])
  })

  it('uses lexical score to sort candidates while preserving their condition states', () => {
    const p = project(); p.facts = []
    const distant = card('A'); distant.title = '维护资金安排'; distant.knowledge!.measure_name = '维护资金安排'; distant.fields = [field('decision_question', '维护资金安排')]
    const result = matchKnowledge(p, [distant, card('Z')], query)
    expect(result.candidates.map(row => row.card_id)).toEqual(['Z', 'A'])
    expect(result.candidates.every(row => row.conditions[0].state === 'unknown')).toBe(true)
  })

  it('honors trace array limits without changing route selection', () => {
    const cards = Array.from({ length: 25 }, (_v, index) => card('CASE-' + index)), p = project()
    const hits = matchKnowledge(p, cards, query)
    expect(hits.route).toBe('case_hit'); expect(hits.case_hits).toHaveLength(20)
    expect(validate('KnowledgeTrace', hits)).toEqual(hits)
    p.facts = []
    const candidates = matchKnowledge(p, Array.from({ length: 105 }, (_v, index) => card('CASE-' + index)), query)
    expect(candidates.candidates).toHaveLength(100)
    expect(candidates.reasons.join('')).toContain('上限')
    expect(validate('KnowledgeTrace', candidates)).toEqual(candidates)
  })

  it('keeps complete condition values while bounding generated display text', () => {
    const p = project(), sample = card(), required = '要求'.repeat(2000)
    p.facts[0].value = '实际'.repeat(2000)
    sample.knowledge!.conditions[0].value = required
    const result = matchKnowledge(p, [sample], query)
    expect(result.candidates[0].conditions[0].condition.value).toBe(required)
    expect(result.candidates[0].conditions[0].reason.length).toBeLessThanOrEqual(1000)
    expect(validate('KnowledgeTrace', result)).toEqual(result)
  })
})
