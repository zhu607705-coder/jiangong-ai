import type { ActionChunk, ActionReviewBatch, ExperienceDraft, ExperienceEvidence, ExperienceField } from '../../apps/host/generated/contracts'
import { validate } from '../contracts/validate'
import { FIELD_KEYS, normalizeDraft, validateEvidence, type ParsedDocument } from './domain'
import { ExperienceError } from './errors'
import { deriveMeasureFactors, extractMeasureFactors } from './measure-factors'

/** The model classifies and groups immutable chunk IDs; it never repeats or edits source spans. */
export function draftsFromActionReview(document: ParsedDocument, index: ActionChunk[], value: unknown): ExperienceDraft[] {
  const batch = validate<ActionReviewBatch>('ActionReviewBatch', value)
  const byId = new Map(index.map(chunk => [chunk.id, chunk]))
  return batch.measures.map(measure => {
    const actionIds = new Set(measure.action_chunk_ids), contextIds = new Set(measure.context_chunk_ids)
    if (actionIds.size !== measure.action_chunk_ids.length || contextIds.size !== measure.context_chunk_ids.length
      || [...actionIds].some(id => contextIds.has(id))) throw new ExperienceError(422, 'MODEL_CHUNK_DUPLICATE', '动作与背景片段不能重复或交叉。')
    const selected = [...actionIds, ...contextIds].map(id => {
      const chunk = byId.get(id)
      if (!chunk || chunk.document_id !== document.id || chunk.document_version !== document.sha256) throw new ExperienceError(422, 'MODEL_CHUNK_SCOPE', '模型只能关联本轮原件与版本中的片段。')
      return structuredClone(chunk)
    })
    for (const condition of [...measure.conditions, ...measure.exclusions]) {
      if (condition.evidence.some(cite => !selected.some(chunk => chunk.spans.some(span => span.document_id === cite.document_id
        && span.version === cite.version && span.locator === cite.locator && span.quote.includes(cite.quote))))) {
        throw new ExperienceError(422, 'MODEL_CONDITION_SCOPE', '条件引文须归属于本措施所选片段。')
      }
    }
    const actions = selected.filter(chunk => actionIds.has(chunk.id)), contexts = selected.filter(chunk => contextIds.has(chunk.id))
    const knownMeasures = new Set(actions.map(chunk => chunk.measure_key).filter(key => key !== 'context'))
    if (knownMeasures.size && !knownMeasures.has(measure.measure_key)) throw new ExperienceError(422, 'MODEL_MEASURE_KEY', '已识别措施须沿用所选动作索引中的稳定举措编号。')
    if (new Set(actions.map(chunk => chunk.object_ref).filter(Boolean)).size > 1) throw new ExperienceError(422, 'MODEL_ACTION_OBJECT_CONFLICT', '不同楼栋或设施的措施需要分别整理。')
    if (!actions.some(chunk => chunk.text.includes(measure.measure_name))) throw new ExperienceError(422, 'MODEL_MEASURE_NOT_QUOTED', '措施名称须来自所关联动作原文。')
    for (const chunk of selected) {
      chunk.classification = 'model'; chunk.kind = actionIds.has(chunk.id) ? 'action' : 'context'
      chunk.measure_key = chunk.kind === 'action' ? measure.measure_key : 'context'
      chunk.context_chunk_ids = chunk.kind === 'action' ? [...contextIds] : []
    }
    const fields: ExperienceField[] = FIELD_KEYS.map(key => ({ key, value: null, evidence: [] }))
    const used = new Set<string>()
    for (const field of measure.fields) {
      if (used.has(field.key)) throw new ExperienceError(422, 'MODEL_FIELD_DUPLICATE', '同一字段不能覆盖多个候选值。')
      used.add(field.key)
      const evidence: ExperienceEvidence[] = []
      for (const id of new Set(field.chunk_ids)) {
        const chunk = selected.find(chunk => chunk.id === id)
        const spans = chunk?.spans.filter(span => span.quote.includes(field.value))
        if (!spans?.length) throw new ExperienceError(422, 'MODEL_FIELD_NOT_QUOTED', '字段值须逐字来自本措施所选片段，不能跨对象补写。')
        evidence.push(...spans)
      }
      fields.find(item => item.key === field.key)!.value = field.value
      fields.find(item => item.key === field.key)!.evidence = evidence
    }
    const stages = new Set(actions.map(chunk => chunk.stage).filter(Boolean))
    const draft = normalizeDraft({ title: measure.measure_name, project_type: '', development_mode: '', stage: stages.size === 1 ? [...stages][0] : '', fields,
      knowledge: { kind: measure.kind, origin: measure.origin, measure_key: measure.measure_key, measure_name: measure.measure_name,
        conditions: measure.conditions, exclusions: measure.exclusions, transfer_notes: measure.transfer_notes,
        evidence_level: measure.origin === 'official_policy' ? 'official_policy' : fields.find(field => field.key === 'implementation')?.value ? 'implementation_record'
          : fields.find(field => field.key === 'proposal')?.value ? 'proposal_only' : 'not_reported',
        chunks: selected, factors: deriveMeasureFactors(actions.flatMap(action => extractMeasureFactors(action, contexts))) } })
    validateEvidence(draft, [document], document.project_id)
    return draft
  })
}

/** One malformed measure cannot discard independent, fully source-validated measures.
 * Reject every invalid item; retain its explicit reason instead of repairing its facts in code.
 */
export function validateActionReviewBatch(document: ParsedDocument, index: ActionChunk[], value: unknown) {
  const batch = validate<ActionReviewBatch>('ActionReviewBatch', value), drafts: ExperienceDraft[] = [], warnings = [...batch.warnings]
  let firstError: ExperienceError | undefined
  for (const measure of batch.measures) {
    try { drafts.push(...draftsFromActionReview(document, index, { measures: [measure], warnings: [] })) }
    catch (error) {
      if (!(error instanceof ExperienceError)) throw error
      firstError ||= error
      warnings.push(`未入库措施“${measure.measure_name}”：${error.code}；${error.message}`)
    }
  }
  if (batch.measures.length && !drafts.length && firstError) throw firstError
  return { drafts, warnings }
}
