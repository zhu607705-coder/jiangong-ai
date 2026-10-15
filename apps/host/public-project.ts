import type { ProjectInput } from './generated/contracts'
import { visibleSnapshot } from '../../packages/context/compiler'

/** Legacy public browsing only; campus collaboration keeps the full shared project input. */
export function publicProjectInput(input: ProjectInput): ProjectInput {
  const projected = visibleSnapshot(input, 'public')
  // A contradictory visibility flag must not publish explicitly internal material.
  projected.sources = projected.sources.filter(source => source.data_class !== 'internal')
  const sourceIds = new Set(projected.sources.map(source => source.id))
  projected.facts = projected.facts.filter(fact => sourceIds.has(fact.source_id))
  delete projected.knowledge_query
  return projected
}
