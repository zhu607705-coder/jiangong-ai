import { describe, expect, it } from 'vitest'
import type { RenewalStrategy } from '../../apps/host/generated/contracts'
import { compareGoalPriorities, PRIORITY_DIMENSIONS, PRIORITY_PRESETS } from '../../packages/retrofit/decision-priorities'
import { evaluateRenewalModeGate } from '../../packages/retrofit/renewal-mode'

const sources = new Set(['SOURCE'])
function dimensions(): RenewalStrategy['dimensions'] {
  return PRIORITY_DIMENSIONS.map(({ key }) => ({ key, current: '原文现况', current_level: 'medium', comprehensive: '分项更新目标', comprehensive_level: 'medium', rebuild: '重建目标', rebuild_level: 'medium', evidence_refs: ['SOURCE'] }))
}

describe('goal preference sensitivity stays separate from mode admission', () => {
  it('changes option preference when the value of documented improvements changes', () => {
    const rows = dimensions()
    for (const row of rows) {
      if (row.key === 'demand' || row.key === 'supply') { row.comprehensive_level = 'high'; row.rebuild_level = 'low' }
      if (row.key === 'resources' || row.key === 'operations') { row.comprehensive_level = 'low'; row.rebuild_level = 'high' }
    }
    expect(compareGoalPriorities(rows, PRIORITY_PRESETS[1].weights, sources).preference).toBe('comprehensive')
    expect(compareGoalPriorities(rows, PRIORITY_PRESETS[2].weights, sources).preference).toBe('rebuild')
    expect(evaluateRenewalModeGate({ conditions: [] }).rebuild_allowed).toBe(false)
  })
  it('retains the full effect range for unknowns instead of imputing zero or normalizing them away', () => {
    const rows = dimensions()
    for (const row of rows) row.rebuild_level = 'unknown'
    const result = compareGoalPriorities(rows, PRIORITY_PRESETS[0].weights, sources)
    expect(result.comprehensive.score).toBeCloseTo(60)
    expect(result.rebuild.score).toBeNull()
    expect(result.rebuild.lower).toBeCloseTo(20)
    expect(result.rebuild.upper).toBeCloseTo(100)
    expect(result.rebuild.assessed_share).toBe(0)
    expect(result.preference).toBe('unresolved')
  })
  it('requires a registered evidence reference for a grade to contribute', () => {
    const rows = dimensions(); rows[0].evidence_refs = ['UNREGISTERED']
    const result = compareGoalPriorities(rows, PRIORITY_PRESETS[0].weights, sources)
    expect(result.comprehensive.missing).toEqual(['demand'])
    expect(result.comprehensive.score).toBeNull()
    expect(result.comprehensive.assessed_share).toBeCloseTo(.8)
    expect(result.comprehensive.lower).toBeCloseTo(52)
    expect(result.comprehensive.upper).toBeCloseTo(68)
  })
  it('rejects invalid and all-zero weights, while an excluded unknown goal has no effect', () => {
    const rows = dimensions(), zero = Object.fromEntries(PRIORITY_DIMENSIONS.map(row => [row.key, 0])) as typeof PRIORITY_PRESETS[number]['weights']
    expect(() => compareGoalPriorities(rows, zero, sources)).toThrow('PRIORITY_WEIGHT_REQUIRED')
    expect(() => compareGoalPriorities(rows, { ...zero, demand: NaN }, sources)).toThrow('PRIORITY_WEIGHT_RANGE')
    rows[0].comprehensive_level = 'unknown'
    const result = compareGoalPriorities(rows, { ...PRIORITY_PRESETS[0].weights, demand: 0 }, sources)
    expect(result.comprehensive.score).toBeCloseTo(60)
    expect(result.comprehensive.missing).toEqual([])
  })
  it('treats duplicate dimension records as unresolved and leaves the saved grades unchanged', () => {
    const rows = dimensions(), before = JSON.stringify(rows)
    const result = compareGoalPriorities([...rows, { ...rows[0] }], PRIORITY_PRESETS[0].weights, sources)
    expect(result.comprehensive.missing).toContain('demand')
    expect(JSON.stringify(rows)).toBe(before)
  })
})
