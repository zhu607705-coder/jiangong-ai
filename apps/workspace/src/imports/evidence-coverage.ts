import type { Fact, MapScreenProfile, ResearchDimension, Source } from '../../../host/generated/contracts'
import { dashboardDimensions, dashboardPolicy } from '../../../../packages/decision/dashboard'
import { FACTOR_FIELDS, NEIGHBORHOOD_FACTOR_FIELDS } from '../../../../packages/maps/decision-factors'
import type { ImportGraph, ParsedDocument } from './graph-model'

export type CoverageEvidence = {
  id: string; kind: 'fact' | 'record'; sourceId: string; locator: string | null;
  objectRefs: string[]; dimension: ResearchDimension | null; value: unknown; unit: string | null;
  observedAt: string | null; publishedAt: string | null; version: string | null;
  state: 'locatable' | 'clue' | 'unmatched'; reason: string; factId?: string; recordId?: string;
}
export type CoverageCell = { objectRef: string; dimension: ResearchDimension; state: 'locatable' | 'clue' | 'empty'; evidence: CoverageEvidence[] }
export type EvidenceCoverage = {
  dimensions: { key: ResearchDimension; label: string }[];
  objects: { ref: string; label: string; scope: 'project' | 'object' }[];
  cells: CoverageCell[]; unmatched: CoverageEvidence[];
  rawRows: { sourceId: string; count: number; locators: string[] }[];
  sources: Source[];
}
const QUANTITY_FIELDS = ['residential_buildings', 'public_buildings', 'buildings', 'completed_elevator_units', 'construction_year', 'renovation_scope']
const unique = (values: string[]) => [...new Set(values.filter(Boolean))]
const validDate = (value?: string) => !!value && Number.isFinite(Date.parse(value))

/** A coverage dimension is an explicit registered fact/field key, never a
 * keyword extracted from a filename, table value, object name or body. */
function factDimension(kind: string, profile?: MapScreenProfile): ResearchDimension | null {
  const prefix = profile === 'neighborhood' ? 'retrofit.' : 'screening.'
  if (!kind.startsWith(prefix)) return null
  const fields = profile === 'neighborhood' ? NEIGHBORHOOD_FACTOR_FIELDS : FACTOR_FIELDS
  const match = Object.entries(fields).find(([, keys]) => (keys as readonly string[]).includes(kind.slice(prefix.length)))?.[0]
  return match && match !== 'access' ? match as ResearchDimension : null
}
function recordDimension(adapter: string, key: string, profile?: MapScreenProfile): ResearchDimension | null {
  const explicit = factDimension((profile === 'neighborhood' ? 'retrofit.' : 'screening.') + key, profile)
  if (explicit) return explicit
  // Parser field semantics are registered once in the existing adapter.
  if (adapter === 'procurement' && ['budget', 'ceiling', 'award', 'duration'].includes(key)) return 'resources'
  if (adapter === 'procurement' && ['buyer', 'deadline', 'deadline_resolved', 'deadline_previous', 'deadline_corrected', 'opening_at'].includes(key)) return 'implementation'
  if (adapter === 'construction' && ['area', 'start_at', 'accepted_at', 'permit_id', ...QUANTITY_FIELDS].includes(key)) return 'adaptation'
  return null
}
function factObjects(fact: Fact, projectId: string): string[] {
  if (fact.scope_kind === 'project') return fact.object_ref === `project:${projectId}` ? [fact.object_ref] : []
  if (fact.scope_kind === 'shared') return unique(fact.applies_to || []).filter(ref => !ref.startsWith('project:') || ref === `project:${projectId}`)
  return fact.object_ref && (!fact.object_ref.startsWith('project:') || fact.object_ref === `project:${projectId}`) ? [fact.object_ref] : []
}
function quality(source: Source | undefined, doc: ParsedDocument | undefined, locator: string | undefined, observedAt: string | undefined, value: unknown, asOf?: string): string | null {
  if (!source) return '来源未关联当前项目'
  if (!locator) return '原文定位未提供'
  if (value === null || value === undefined || value === '') return '值尚未提供'
  if (!source.untrusted_text?.trim() && !doc?.segments.some(segment => segment.text.trim()) && !doc?.tables.some(table => table.previewRows.length)) return '尚未取得可读原文'
  if (!source.raw_hash && !source.hash && !doc?.hash) return '来源版本未提供'
  if (source.content_status === 'metadata_only' || source.parse_status === 'ocr_required' || doc?.status === 'ocr_required') return '尚未取得可读原文'
  if (source.body_truncated || source.records_truncated) return '来源或记录已截取'
  if (source.date_status === 'conflict') return '来源日期存在分歧'
  if (doc?.hash && (source.raw_hash || source.hash) && doc.hash !== (source.raw_hash || source.hash)) return '文档与来源版本不一致'
  if (!validDate(observedAt)) return '观察或统计时点未提供'
  if (asOf) {
    const cutoff = Date.parse(asOf.length === 10 ? asOf + 'T23:59:59+08:00' : asOf)
    if (!Number.isFinite(cutoff)) return '研究截止时点未提供'
    if (Date.parse(observedAt!) > cutoff || source.published_at && (!validDate(source.published_at) || Date.parse(source.published_at) > cutoff)) return '晚于研究截止时点'
    if (source.expires_at && (!validDate(source.expires_at) || Date.parse(source.expires_at) <= cutoff)) return '资料已超过有效期'
  }
  return null
}

/** Pure read-only projection over the existing graph snapshot. A located
 * evidence cell says nothing about approval, sufficiency or investment value. */
export function buildEvidenceCoverage(input: Pick<ImportGraph, 'sources' | 'documents' | 'facts'> & {
  projectId: string; projectName: string; profile?: MapScreenProfile; asOf?: string;
}): EvidenceCoverage {
  const dimensions = dashboardDimensions(dashboardPolicy(input.profile)).map(({ key, label }) => ({ key, label }))
  const sources = new Map(input.sources.map(source => [source.id, source])), documents = new Map(input.documents.map(doc => [doc.id, doc]))
  const evidence: CoverageEvidence[] = [], rawRows = new Map<string, { sourceId: string; count: number; locators: string[] }>()
  for (const fact of input.facts) {
    if (fact.kind === 'table_row') {
      const row = rawRows.get(fact.source_id) || { sourceId: fact.source_id, count: 0, locators: [] }
      row.count++; if (fact.locator) row.locators.push(fact.locator); rawRows.set(fact.source_id, row); continue
    }
    const source = sources.get(fact.source_id), objectRefs = factObjects(fact, input.projectId), dimension = factDimension(fact.kind, input.profile)
    const missing = quality(source, documents.get(fact.source_id), fact.locator, fact.observed_at, fact.value, input.asOf)
    const unmatched = !objectRefs.length || !dimension || !source
    const reason = unmatched ? !source ? '来源未关联当前项目' : !objectRefs.length ? '没有明确匹配对象' : '没有登记维度口径'
      : missing || (fact.epistemic_status !== 'fact' ? '待核线索或方案假设' : '有可定位依据')
    evidence.push({ id: `fact:${fact.id}`, kind: 'fact', sourceId: fact.source_id, locator: fact.locator || null,
      objectRefs, dimension, value: fact.value, unit: fact.unit, observedAt: fact.observed_at || null,
      publishedAt: source?.published_at || null, version: source?.raw_hash || source?.hash || documents.get(fact.source_id)?.hash || null,
      state: unmatched ? 'unmatched' : missing || fact.epistemic_status !== 'fact' ? 'clue' : 'locatable', reason, factId: fact.id })
  }
  for (const source of input.sources) for (const record of source.public_records || []) {
    const objectRef = record.fields.find(field => field.key === 'object_ref' && typeof field.value === 'string')?.value
    const projectRef = record.fields.find(field => field.key === 'project_id' && field.value === input.projectId)
    const objectRefs = record.scope === 'object' ? unique(typeof objectRef === 'string' ? [objectRef] : projectRef ? [`project:${input.projectId}`] : [])
      .filter(ref => !ref.startsWith('project:') || ref === `project:${input.projectId}`) : []
    for (const field of record.fields.filter(field => !['object_ref', 'project_id', 'project_name', 'lot_id', 'statistical_as_of'].includes(field.key))) {
      const dimension = recordDimension(record.adapter, field.key, input.profile)
      const mismatched = record.source_id !== source.id || !!record.source_hash && record.source_hash !== (source.raw_hash || source.hash)
      const statisticalAt = record.fields.find(item => item.key === 'statistical_as_of')?.value
      const observedAt = QUANTITY_FIELDS.includes(field.key) ? typeof statisticalAt === 'string' ? statisticalAt : undefined : record.period
      const missing = quality(source, documents.get(source.id), field.locator, observedAt, field.value, input.asOf)
      const unmatched = mismatched || !objectRefs.length || !dimension
      evidence.push({ id: `record:${source.id}:${record.id}:${field.key}`, kind: 'record', sourceId: source.id,
        locator: field.locator || null, objectRefs: mismatched ? [] : objectRefs, dimension, value: field.value, unit: field.unit || null,
        observedAt: observedAt || null, publishedAt: source.published_at || null, version: record.source_hash || source.raw_hash || source.hash || null,
        state: unmatched ? 'unmatched' : 'clue', reason: mismatched ? '记录与来源版本或标识不一致' : !objectRefs.length ? '记录对象尚未匹配' : !dimension ? '没有登记维度口径' : missing || '公开记录线索，尚未确认为本方案条件', recordId: record.id })
    }
  }
  const bound = evidence.filter(row => row.state !== 'unmatched')
  const refs = unique([`project:${input.projectId}`, ...evidence.filter(row => sources.has(row.sourceId)).flatMap(row => row.objectRefs)])
  const objects = refs.map(ref => ({ ref, label: ref === `project:${input.projectId}` ? `${input.projectName}（项目范围）` : ref, scope: ref === `project:${input.projectId}` ? 'project' as const : 'object' as const }))
  const cells = objects.flatMap(object => dimensions.map(dimension => {
    const rows = bound.filter(row => row.dimension === dimension.key && row.objectRefs.includes(object.ref))
    return { objectRef: object.ref, dimension: dimension.key,
      state: rows.some(row => row.state === 'locatable') ? 'locatable' as const : rows.length ? 'clue' as const : 'empty' as const, evidence: rows }
  }))
  return { dimensions, objects, cells, unmatched: evidence.filter(row => row.state === 'unmatched'), rawRows: [...rawRows.values()], sources: input.sources }
}
