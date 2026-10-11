import { describe, expect, it } from 'vitest'
import type { Fact, Source } from '../../apps/host/generated/contracts'
import { evaluateRetrofitConditions, retrofitAdvice, retrofitFactUsable, type RetrofitEvidence } from '../../packages/retrofit/planning'
import { NEIGHBORHOOD_DIMENSION_POLICY, RETROFIT_CHECKS, RETROFIT_RULE_VERSION } from '../../packages/retrofit/policy'

const source = (patch: Partial<Source> = {}): Source => ({ id: 'S1', title: '项目确认材料', visibility: 'public', data_class: 'public', synthetic: false,
  hash: 'source-v1', content_status: 'full_text', published_at: '2026-09-01', evidence_scope: 'object', object_refs: ['project:P1'], ...patch })
const fact = (key: string, value = true, patch: Partial<Fact> = {}): Fact => ({ id: key, kind: 'retrofit.' + key, value, unit: null,
  source_id: 'S1', object_ref: 'project:P1', scope_kind: 'project', epistemic_status: 'fact', locator: 'line:1', observed_at: '2026-09-20', ...patch })
const project = (confirmed = false): RetrofitEvidence => ({ project_id: 'P1', as_of: '2026-09-30', synthetic: false,
  sources: [source()], facts: confirmed ? RETROFIT_CHECKS.map(check => fact(check.key)) : [] })

describe('deterministic neighborhood condition policy', () => {
  it('keeps all dimensions missing without pretending absent vetoes are safety clearances', () => {
    const result = evaluateRetrofitConditions(project())
    expect(result.evaluated_as_of).toBe('2026-09-30')
    expect(result.rule_version).toBe('neighborhood-action-v2')
    expect(result.checks).toHaveLength(7)
    expect(result.dimensions.map(row => [row.key, row.state])).toEqual([
      ['demand', 'missing'], ['supply', 'missing'], ['adaptation', 'missing'], ['implementation', 'missing'], ['operations', 'missing'], ['resources', 'missing'],
    ])
    expect(result.rule_confirmation.state).toBe('missing')
    expect(result.vetoes.every(row => row.state === 'missing')).toBe(true)
    expect(retrofitAdvice(project()).decision).toBe('supplement')
  })
  it('requires the independent professional rule even after all six dimensions are confirmed', () => {
    const p = project(true)
    expect(evaluateRetrofitConditions(p).dimensions.every(row => row.state === 'confirmed')).toBe(true)
    expect(retrofitAdvice(p).decision).toBe('proceed')
    p.facts = p.facts.filter(row => row.kind !== 'retrofit.rule_set_confirmed')
    const result = evaluateRetrofitConditions(p)
    expect(result.dimensions.every(row => row.state === 'confirmed')).toBe(true)
    expect(result.rule_confirmation.state).toBe('missing')
    expect(retrofitAdvice(p).decision).toBe('supplement')
  })
  it.each(NEIGHBORHOOD_DIMENSION_POLICY.map(row => [row.key, row.confirmationKeys[0]] as const))(
    'distinguishes unmet, missing and conflicting %s conditions without inventing a veto', (dimension, key) => {
      const p = project(true), row = p.facts.find(item => item.kind === 'retrofit.' + key)!
      row.value = false
      expect(evaluateRetrofitConditions(p).dimensions.find(item => item.key === dimension)?.state).toBe('unmet')
      expect(retrofitAdvice(p).decision).toBe('supplement')
      p.facts.push(fact(key, true, { id: key + '-positive' }))
      const conflict = evaluateRetrofitConditions(p)
      expect(conflict.dimensions.find(item => item.key === dimension)?.state).toBe('conflict')
      expect(conflict.checks.find(item => item.key === key)?.fact_refs).toEqual([key, key + '-positive'])
      p.facts = p.facts.filter(item => item.kind !== 'retrofit.' + key)
      expect(evaluateRetrofitConditions(p).dimensions.find(item => item.key === dimension)?.state).toBe('missing')
    },
  )
  it('keeps an independent veto effective while retaining another veto conflict', () => {
    const p = project(true)
    p.facts.push(fact('safety_veto'), fact('safety_veto', false, { id: 'safety-negative' }), fact('rights_veto'))
    const result = evaluateRetrofitConditions(p)
    expect(result.vetoes.find(row => row.key === 'safety_veto')?.state).toBe('conflict')
    expect(result.dimensions.find(row => row.key === 'adaptation')?.state).toBe('conflict')
    expect(result.dimensions.find(row => row.key === 'implementation')?.state).toBe('veto')
    expect(retrofitAdvice(p)).toMatchObject({ decision: 'defer', rule_version: RETROFIT_RULE_VERSION })
    expect(retrofitAdvice(p).reasons[0].text).toContain('权属')
    p.facts = p.facts.filter(row => row.kind !== 'retrofit.rights_veto')
    expect(retrofitAdvice(p).decision).toBe('supplement')
  })
  it('treats a verified negative veto as clear without making its missing prerequisite confirmed', () => {
    const p = project(); p.facts = [fact('safety_veto', false)]
    const result = evaluateRetrofitConditions(p)
    expect(result.vetoes.find(row => row.key === 'safety_veto')?.state).toBe('clear')
    expect(result.dimensions.find(row => row.key === 'adaptation')?.state).toBe('missing')
  })
  it.each([
    { published_at: '2099-01-01' }, { expires_at: '2026-09-01' }, { expires_at: 'invalid' }, { content_status: 'metadata_only' as const },
    { hash: undefined }, { date_status: 'conflict' as const }, { parse_status: 'ocr_required' as const },
    { evidence_scope: 'area' as const }, { evidence_scope: 'background' as const }, { object_refs: ['building:B2'] }, { object_refs: [] },
  ])('records rejected source evidence as missing with a traceable admission reason: %j', patch => {
    const p = project(); p.sources = [source(patch)]; p.facts = [fact('resident_needs_confirmed')]
    const result = evaluateRetrofitConditions(p)
    expect(result.dimensions[0].state).toBe('missing')
    expect(result.dimensions[0].evidence_refs).toEqual([])
    expect(result.unusable_fact_refs).toEqual(['resident_needs_confirmed'])
    expect(result.admission_notes[0]).toMatchObject({ fact_id: 'resident_needs_confirmed', source_id: 'S1', locator: 'line:1' })
    expect(result.admission_notes[0].reason).toBeTruthy()
  })
  it.each([
    { observed_at: '2099-01-01' }, { observed_at: undefined }, { locator: undefined }, { object_ref: 'building:B2' },
    { source_id: 'MISSING' }, { epistemic_status: 'assumption' as const }, { value: 'true' },
    { scope_kind: 'shared' as const, applies_to: ['building:B2'] },
  ])('does not turn an unusable fact into either satisfaction or a veto: %j', patch => {
    const p = project(true)
    p.facts.push(fact('safety_veto', true, patch))
    expect(evaluateRetrofitConditions(p).vetoes[0].state).toBe('missing')
    expect(retrofitAdvice(p).decision).toBe('proceed')
  })
  it('preserves exact legacy binding and explicitly permitted shared scope without expanding a building fact', () => {
    const p = project(true)
    p.facts = p.facts.map(row => ({ ...row, scope_kind: undefined }))
    expect(retrofitAdvice(p).decision).toBe('proceed')
    p.facts = p.facts.map(row => ({ ...row, scope_kind: 'shared', applies_to: ['project:P1'] }))
    expect(retrofitAdvice(p).decision).toBe('proceed')
    p.facts[0].object_ref = 'building:B1'
    expect(evaluateRetrofitConditions(p).dimensions[0].state).toBe('missing')
    expect(retrofitFactUsable(p, p.facts[0])).toBe(false)
  })
  it('uses the declared project time, admits still-valid old facts and rejects invalid calendar cutoffs', () => {
    const p = project(true)
    p.facts.forEach(row => { row.observed_at = '2020-01-01' })
    expect(retrofitAdvice(p).decision).toBe('proceed')
    p.sources[0].expires_at = '2026-10-01'
    expect(retrofitAdvice(p).decision).toBe('proceed')
    p.as_of = '2026-10-02'
    expect(retrofitAdvice(p).decision).toBe('supplement')
    for (const asOf of ['invalid', '2026-02-30', '2026-09-30T12:00:00Z']) {
      p.as_of = asOf
      const result = evaluateRetrofitConditions(p)
      expect(result.checks.every(row => row.state === 'missing')).toBe(true)
      expect(result.admission_notes.every(row => row.reason === '项目研究截止时点无效')).toBe(true)
    }
  })
  it('preserves input/reference order and first source ownership while ignoring unregistered kinds', () => {
    const p = project(true)
    p.sources.push(source({ id: 'S2' }), source({ id: 'S1', hash: undefined }))
    p.facts.unshift(fact('resident_needs_confirmed', true, { id: 'first-demand', source_id: 'S2' }))
    p.facts.push(fact('safety_veto', false, { id: 'last-safety', source_id: 'S2' }), fact('unregistered_boolean'), fact('households', true, { value: 100 }))
    const before = JSON.stringify(p), result = evaluateRetrofitConditions(p)
    expect(result.checks[0].fact_refs).toEqual(['first-demand', 'resident_needs_confirmed'])
    expect(result.checks[0].evidence_refs).toEqual(['S2', 'S1'])
    expect(result.dimensions[0].evidence_refs).toEqual(['S2', 'S1'])
    expect(result.evidence_refs).toEqual(['S2', 'S1'])
    expect(result.admission_notes).toEqual([])
    expect(retrofitAdvice(p).reasons[0].evidence_refs).toEqual(['S2', 'S1'])
    expect(JSON.stringify(p)).toBe(before)
    delete p.sources[0].hash
    expect(retrofitAdvice(p).decision).toBe('supplement')
    p.sources[0].raw_hash = 'original-source-v1'
    expect(retrofitAdvice(p).decision).toBe('proceed')
  })
})
