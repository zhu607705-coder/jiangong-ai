import type { ExperienceCard, ExperienceEvidence } from '../../apps/host/generated/contracts'

export const MAX_SKILL_SOURCE_CARDS = 20
export type MeasurePresentationGroup = {
  id: string
  projectId: string
  kind: 'case' | 'rule' | 'unclassified'
  measureKey: string | null
  title: string
  cards: ExperienceCard[]
  sourceCount: number
  sourceVersionCount: number
}

const order = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
const unique = (values: string[]) => [...new Set(values.filter(value => value.trim()))].sort(order)
// Only case and whitespace differ in the fallback. Numbers, punctuation and object names stay intact.
const normalizedTitle = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase()

export function cardPresentationDetails(card: ExperienceCard) {
  const knowledge = card.knowledge
  const allEvidence = [
    ...card.fields.flatMap(field => field.evidence),
    ...[...(knowledge?.conditions || []), ...(knowledge?.exclusions || [])].flatMap(condition => condition.evidence),
    ...(knowledge?.chunks || []).flatMap(chunk => chunk.spans),
    ...(knowledge?.factors || []).flatMap(factor => factor.evidence),
  ]
  const evidence: ExperienceEvidence[] = [...new Map(allEvidence.map(item => [JSON.stringify([item.document_id, item.version, item.locator, item.quote]), item])).values()]
  return {
    evidence,
    objects: unique([...(knowledge?.chunks || []).map(chunk => chunk.object_ref || ''), ...(knowledge?.factors || []).map(factor => factor.object_ref || '')]),
    stages: unique([card.stage, ...(knowledge?.chunks || []).map(chunk => chunk.stage), ...(knowledge?.factors || []).map(factor => factor.stage)]),
    sourceIds: unique(evidence.map(item => item.document_id)),
  }
}

/** A display index only: records and their scope, values, source versions and review state remain intact. */
export function groupMeasureCards(cards: ExperienceCard[]): MeasurePresentationGroup[] {
  const groups = new Map<string, MeasurePresentationGroup>()
  for (const card of [...cards].sort((a, b) => order(a.id, b.id))) {
    const kind = card.knowledge?.kind || 'unclassified'
    const measureKey = card.knowledge?.measure_key.trim() || null
    const fallback = normalizedTitle(card.title)
    const id = JSON.stringify([card.project_id, kind, measureKey ? ['key', measureKey] : fallback ? ['title', fallback] : ['card', card.id]])
    const group = groups.get(id) || { id, projectId: card.project_id, kind, measureKey, title: '', cards: [], sourceCount: 0, sourceVersionCount: 0 }
    group.cards.push(card)
    groups.set(id, group)
  }
  return [...groups.values()].sort((a, b) => order(a.id, b.id)).map(group => {
    const names = unique(group.cards.map(card => card.knowledge?.measure_name.trim() || ''))
    const evidence = group.cards.flatMap(card => cardPresentationDetails(card).evidence)
    const title = names.length > 3 ? `${names[0]}等${names.length}类记录` : names.join(' / ')
    return { ...group, title: title || group.cards[0].title.trim() || '未命名措施',
      sourceCount: new Set(evidence.map(item => item.document_id)).size,
      sourceVersionCount: new Set(evidence.map(item => JSON.stringify([item.document_id, item.version]))).size }
  })
}

export function skillSourceEligible(card: ExperienceCard): boolean {
  return card.status === 'approved' && !!card.knowledge?.measure_key.trim()
}

/** Validate the whole selection before applying it; a group is never silently truncated at 20 records. */
export function changeSkillSourceSelection(cards: ExperienceCard[], selectedIds: string[], requestedIds: string[], checked: boolean): { ids: string[]; error: string | null } {
  const requested = new Set(requestedIds)
  if (!checked) return { ids: selectedIds.filter(id => !requested.has(id)), error: null }
  const ids = [...new Set([...selectedIds, ...requestedIds])]
  const selected = ids.map(id => cards.find(card => card.id === id))
  if (!requestedIds.length || selected.some(card => !card || !skillSourceEligible(card))) return { ids: selectedIds, error: '只能选择已审核且有举措标识的证据记录。' }
  const first = selected[0]!
  if (selected.some(card => card!.project_id !== first.project_id || card!.knowledge!.measure_key !== first.knowledge!.measure_key)) return { ids: selectedIds, error: '同一技能只能选择本项目同一举措的证据记录。' }
  if (ids.length > MAX_SKILL_SOURCE_CARDS) return { ids: selectedIds, error: `本次选择将达到 ${ids.length} 条，超过 ${MAX_SKILL_SOURCE_CARDS} 条上限；请展开后逐条选择。` }
  return { ids, error: null }
}
