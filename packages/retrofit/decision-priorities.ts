import type { RenewalStrategy, ResearchDimension } from '../../apps/host/generated/contracts'
import { dashboardDimensions, NEIGHBORHOOD_DASHBOARD_POLICY } from '../decision/dashboard'

export const PRIORITY_POLICY = 'renewal-goal-sensitivity-v1'
export const PRIORITY_DIMENSIONS = dashboardDimensions(NEIGHBORHOOD_DASHBOARD_POLICY)
export type PriorityWeights = Record<ResearchDimension, number>
export const PRIORITY_PRESETS: { id: string; label: string; weights: PriorityWeights }[] = [
  { id: 'balanced', label: '综合平衡', weights: { demand: 4, supply: 3, adaptation: 4, implementation: 3, operations: 3, resources: 3 } },
  { id: 'residents', label: '居民改善优先', weights: { demand: 5, supply: 5, adaptation: 3, implementation: 2, operations: 3, resources: 2 } },
  { id: 'funding', label: '财政承受优先', weights: { demand: 3, supply: 2, adaptation: 3, implementation: 3, operations: 4, resources: 5 } },
]
const grade = { low: 20, medium: 60, high: 100 }
export type PriorityAssessment = {
  lower: number; upper: number; score: number | null; assessed_share: number;
  missing: ResearchDimension[];
  contributions: { key: ResearchDimension; share: number; score: number | null; contribution: number | null; evidence_refs: string[] }[]
}

/** A local sensitivity calculation on the existing common fit scale; admission uses the separate mode gate. */
export function compareGoalPriorities(dimensions: RenewalStrategy['dimensions'], weights: PriorityWeights, sourceIds: ReadonlySet<string>) {
  if (PRIORITY_DIMENSIONS.some(({ key }) => !Number.isFinite(weights[key]) || weights[key] < 0 || weights[key] > 5)) throw new Error('PRIORITY_WEIGHT_RANGE')
  const total = PRIORITY_DIMENSIONS.reduce((sum, { key }) => sum + weights[key], 0)
  if (!total) throw new Error('PRIORITY_WEIGHT_REQUIRED')
  const assess = (mode: 'comprehensive' | 'rebuild'): PriorityAssessment => {
    let lower = 0, upper = 0, assessed_share = 0
    const missing: ResearchDimension[] = []
    const contributions = PRIORITY_DIMENSIONS.map(({ key }) => {
      const rows = dimensions.filter(row => row.key === key), row = rows.length === 1 ? rows[0] : undefined
      const share = weights[key] / total, evidence_refs = row?.evidence_refs.filter(id => sourceIds.has(id)) || []
      const level = row?.[`${mode}_level`], score = level && level !== 'unknown' && evidence_refs.length ? grade[level] : null
      if (score === null) { lower += share * 20; upper += share * 100; if (share > 0) missing.push(key) }
      else { lower += share * score; upper += share * score; assessed_share += share }
      return { key, share, score, contribution: score === null ? null : share * score, evidence_refs }
    })
    return { lower, upper, score: missing.length ? null : lower, assessed_share, missing, contributions }
  }
  const comprehensive = assess('comprehensive'), rebuild = assess('rebuild')
  const preference = comprehensive.lower > rebuild.upper + 1e-8 ? 'comprehensive'
    : rebuild.lower > comprehensive.upper + 1e-8 ? 'rebuild'
    : comprehensive.score !== null && rebuild.score !== null && Math.abs(comprehensive.score - rebuild.score) < 1e-8 ? 'tie' : 'unresolved'
  return { policy_version: PRIORITY_POLICY, comprehensive, rebuild, preference } as const
}
