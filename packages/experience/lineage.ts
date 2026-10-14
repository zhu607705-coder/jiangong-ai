import type { ActionChunk, ExperienceCard, ExperienceEvidence } from '../../apps/host/generated/contracts'

export function recordEvidence(card: ExperienceCard): ExperienceEvidence[] {
  return [
    ...card.fields.flatMap(field => field.evidence),
    ...(card.knowledge?.factors || []).flatMap(factor => factor.evidence),
    ...[...(card.knowledge?.conditions || []), ...(card.knowledge?.exclusions || [])].flatMap(condition => condition.evidence),
  ]
}

/** A document match alone is not enough: bind the same version and literal quotation. */
export function evidenceMatchesChunk(evidence: ExperienceEvidence, chunk: ActionChunk) {
  return (
    evidence.document_id === chunk.document_id && evidence.version === chunk.document_version
    && chunk.spans.some(span => span.locator === evidence.locator
      && !!span.quote.trim() && !!evidence.quote.trim() && (span.quote.includes(evidence.quote) || evidence.quote.includes(span.quote))))
}
export function cardsForChunk(chunk: ActionChunk, cards: ExperienceCard[]) {
  return cards.filter(card => recordEvidence(card).some(evidence => evidenceMatchesChunk(evidence, chunk)))
}

/** Identical display values are shared while scope, phase and originating cards stay inspectable. */
export function entriesForChunk(chunk: ActionChunk, cards: ExperienceCard[]) {
  const entries = new Map<string,{key:string;label:string;value:string;unit:string;object:string;stage:string;cardIds:string[]}>()
  for (const card of cards) {
    const fields = card.fields.filter(field => field.value != null && field.evidence.some(evidence => evidenceMatchesChunk(evidence,chunk)))
      .map(field => ({key:field.key,label:field.key,value:String(field.value),unit:'',object:chunk.object_ref || '',stage:card.stage}))
    const factors = (card.knowledge?.factors || []).filter(factor => factor.evidence.some(evidence => evidenceMatchesChunk(evidence,chunk)))
      .map(factor => ({key:factor.key,label:factor.label,value:String(factor.value),unit:factor.unit || '',object:factor.object_ref || '',stage:factor.stage}))
    for (const entry of [...fields,...factors]) {
      const key = JSON.stringify([entry.key,entry.value,entry.unit,entry.object,entry.stage])
      const previous = entries.get(key)
      if (previous) {if (!previous.cardIds.includes(card.id)) previous.cardIds.push(card.id)}
      else entries.set(key,{...entry,cardIds:[card.id]})
    }
  }
  return [...entries.values()]
}
