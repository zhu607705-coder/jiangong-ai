import type { ModelCall, RenewalStrategy, DecisionSupport, ResearchTrace } from '../../apps/host/generated/contracts'
import type { ModeCondition } from './renewal-mode'

export const STRATEGY_POLICY = 'renewal-strategy-overview-v3'
export type StrategySource = { id: string; title: string; text: string; url: string | null; published_at: string | null; role: 'current' | 'reference'; locator: string }
export type StrategyPacket = { project_id: string; context_version: number; input_hash: string; created_at: string; synthetic: boolean; status: 'completed' | 'failed' | 'unavailable';
  strategy: RenewalStrategy | null; sources: StrategySource[]; decision: DecisionSupport | null; model_calls: ModelCall[]; research: ResearchTrace | null; error: string | null }

const literal = (value: string) => value.normalize('NFKC').replace(/\s+/g, '')
export function validateStrategy(value: RenewalStrategy, sources: StrategySource[], conditions:ModeCondition[] = []) {
  if (value.paths.length !== 2 || new Set(value.paths.map(path => path.mode)).size !== 2 || value.dimensions.length !== 6 || new Set(value.dimensions.map(row => row.key)).size !== 6) throw new Error('STRATEGY_INCOMPLETE')
  const ids = new Set(sources.map(source => source.id))
  for (const row of value.rationale) {
    const source = sources.find(source => source.id === row.source_id)
    if (!source || row.quote.trim().length < 8 || !literal(source.text).includes(literal(row.quote))) throw new Error('STRATEGY_QUOTE_MISMATCH')
  }
  for (const row of [...value.paths.flatMap(path => path.actions), ...value.dimensions, ...value.next_checks]) if (row.evidence_refs.some(id => !ids.has(id))) throw new Error('STRATEGY_SOURCE_MISMATCH')
  if (!value.rationale.some(row => sources.find(source => source.id === row.source_id)?.role === 'current')) throw new Error('STRATEGY_OBJECT_EVIDENCE_MISSING')
  if (value.preferred_mode==='comprehensive'&&conditions.some(row=>row.kind==='structure_repairable'&&row.value===false)||value.preferred_mode==='rebuild'&&conditions.some(row=>row.kind==='demolition_permitted'&&row.value===false)) throw new Error('STRATEGY_MODE_RESTRICTED')
  return value
}
