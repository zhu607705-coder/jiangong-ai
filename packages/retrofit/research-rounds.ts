import type { StrategyPacket, StrategyProgress } from './strategy'

export const RESEARCH_MATERIAL_CATEGORIES = ['resident_needs', 'resident_satisfaction', 'structural_assessment', 'cost_funding', 'operations', 'other'] as const
export type ResearchMaterialCategory = typeof RESEARCH_MATERIAL_CATEGORIES[number]
export type ResearchMaterialMetadata = { material_category: ResearchMaterialCategory; source_date: string | null }
export type ResearchMaterial = ResearchMaterialMetadata & {
  document_id: string
  project_id: string
  file_name: string
  source_id: string
  /** Original document bytes, supplied by the server rather than the caller. */
  version: string
  data_class: 'internal' | 'public' | 'synthetic' | 'semi_synthetic'
  visibility: 'internal' | 'public'
  parse_status: string
  locator: string
  source_date_origin: 'user_declared' | 'unrecorded'
  added_in_round: boolean
}
export type ResearchMissingMaterial = { topic: string; request: string; reason: string; evidence_refs: string[] }
export type ResearchRound = {
  id: string
  project_id: string
  round_number: number
  context_version: number
  input_hash: string
  parent_round_id: string | null
  parent_input_hash: string | null
  parent_context_version: number | null
  first_round_id: string
  first_input_hash: string
  first_context_version: number
  origin: 'generated' | 'adopted_history'
  status: 'draft' | 'running' | 'completed' | 'failed' | 'obsolete'
  material_intake: 'none' | 'provided' | 'not_recorded'
  allow_internal_ai: boolean
  materials: ResearchMaterial[]
  missing_materials: ResearchMissingMaterial[]
  result: StrategyPacket | null
  error: string | null
  created_at: string
  updated_at: string
}
export type ResearchRoundsResponse = {
  rounds: ResearchRound[]
  materials: ResearchMaterial[]
  /** Historical candidate for an explicit adoption only; never a current-version result. */
  baseline_candidate: StrategyPacket | null
}
export type CreateResearchRoundRequest = {
  expected_context_version: number
  parent_round_id?: string
  material_intake: 'none' | 'provided'
  document_ids: string[]
  allow_internal_ai: boolean
}
export type AdoptResearchRoundRequest = { expected_context_version: number; input_hash: string }
export type ResearchRoundStreamEvent = StrategyProgress | { type: 'complete'; result: StrategyPacket; round: ResearchRound } | { type: 'error'; message: string; round?: ResearchRound }
