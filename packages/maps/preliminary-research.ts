import type { Fact, MapScreenContext, PublicRecord, Source } from '../../apps/host/generated/contracts'
import { factAppliesToTarget } from './object-identity'
import { currentWindow, recordFamily, retainRecordWindows } from '../research/record-window'

export type PreliminaryObservation = {
  label: string; value: string; scope: string; observedAt: string | null; publishedAt: string | null;
  sourceRefs: string[]; locator: string; factId?: string; recordId?: string;
}
export type PreliminaryResearch = {
  lines: { text: string; sourceRefs: string[] }[];
  observations: PreliminaryObservation[];
  sourceRefs: string[];
  missing: string[];
}
const STAGES: Record<string, string> = {
  historical: '历史案例', historical_renovation_and_subsequent_improvements: '历史改造案例',
  annual_plan: '年度计划', planned: '计划阶段', procurement_open: '采购阶段',
  awarded: '已成交', under_construction: '施工阶段', completed: '已验收历史记录',
}
const QUANTITIES: Record<string, string> = {
  households: '户数', residential_buildings: '住宅楼', buildings: '房屋总数',
  public_buildings: '公建', completed_elevator_units: '加梯完成单元', construction_year: '建成年份', renovation_scope: '工程范围',
}
const uniq = (rows: string[]) => [...new Set(rows)]
const scalar = (value: Fact['value']) => typeof value === 'number' && Number.isFinite(value) || typeof value === 'string' && !!value.trim()
const date = (value?: string) => value && Number.isFinite(Date.parse(value)) ? value : null
const kind = (value: string) => value.replace(/^(retrofit|research)\./, '')

/** Read explicit object-linked records only. This preview never asks a model,
 * interprets prose, infers a building identity, or changes an action gate. */
export function buildPreliminaryResearch(context: MapScreenContext, extras: { sources?: Source[]; records?: PublicRecord[] } = {}): PreliminaryResearch {
  const observations: PreliminaryObservation[] = [], stageRows: PreliminaryObservation[] = [], windowRows: PreliminaryObservation[] = []
  const cutoff = Date.parse(context.created_at)
  function readable(source: Source | undefined, at = cutoff): source is Source {
    return !!source && source.content_status !== 'metadata_only'
      && (!source.published_at || Number.isFinite(Date.parse(source.published_at)) && Date.parse(source.published_at) <= at)
  }
  function recordRows(source: Source, records: PublicRecord[], objectRef: string, projectId?: string, evaluatedAt = context.created_at) {
    const at = Date.parse(evaluatedAt)
    records = retainRecordWindows(records, records, !source.body_truncated && !source.records_truncated)
    for (const record of records.filter(row => row.source_id === source.id && row.scope === 'object' && (!date(row.period) || Date.parse(row.period) <= at) && (!row.source_hash || row.source_hash === (source.raw_hash || source.hash)))) {
      const explicit = record.fields.some(field => field.key === 'object_ref' && field.value === objectRef
        || !!projectId && field.key === 'project_id' && field.value === projectId && objectRef === `project:${projectId}`)
      if (!explicit) continue
      const scope = record.subject || objectRef
      const add = (label: string, value: string, locator: string, list = observations) => {
        if (!locator) return
        const statisticalAt = record.fields.find(field => field.key === 'statistical_as_of')?.value
        const row = { label, value, scope, observedAt: Object.values(QUANTITIES).includes(label) ? date(typeof statisticalAt === 'string' ? statisticalAt : undefined) : date(record.period), publishedAt: date(source.published_at), sourceRefs: [source.id], locator, recordId: record.id }
        list.push(row); if (list !== observations) observations.push(row)
      }
      for (const field of record.fields.filter(field => scalar(field.value))) {
        if (field.key === 'project_stage' && STAGES[String(field.value)]) add('阶段', STAGES[String(field.value)], field.locator, stageRows)
        if (field.key === 'accepted_at' && date(String(field.value)) && Date.parse(String(field.value)) <= at) add('阶段', '已验收历史记录', field.locator, stageRows)
        if (field.key === 'award') add('阶段', '已成交', field.locator, stageRows)
        if (QUANTITIES[field.key]) add(QUANTITIES[field.key], `${field.value}${field.unit ? ' ' + field.unit : ''}`, field.locator)
      }
      if (record.adapter !== 'procurement') continue
      const family = recordFamily(record, records)
      const awarded = family.some(row => row.fields.some(field => field.key === 'award' && field.value !== null))
      const deadline = record.fields.find(field => field.key === 'deadline_resolved' && field.value !== null) || record.fields.find(field => ['deadline', 'deadline_corrected'].includes(field.key) && field.value !== null)
      if (awarded) add('参与窗口', '已成交记录，不能作为当前响应窗口', record.fields.find(field => field.key === 'award')?.locator || source.locator || '', windowRows)
      else if (deadline) add('参与窗口', currentWindow(family, evaluatedAt) && source.date_status !== 'conflict' && (!source.expires_at || !!date(source.expires_at) && Date.parse(source.expires_at) > at) && !source.body_truncated && !source.records_truncated
        ? `响应截止 ${deadline.value}；资格条件仍需回读` : `响应截止 ${deadline.value}；当前窗口未成立`, deadline.locator, windowRows)
    }
  }
  for (const project of context.local_projects.filter(row => row.relation === 'within_scope')) {
    const evaluatedAt = project.as_of && date(project.as_of) ? project.as_of.length === 10 ? project.as_of + 'T23:59:59+08:00' : project.as_of : context.created_at
    const at = Date.parse(evaluatedAt)
    const own = new Map(project.sources.map(source => [source.id, source]))
    for (const fact of project.facts) {
      const source = own.get(fact.source_id), field = kind(fact.kind)
      if (!readable(source, at) || !fact.locator || fact.epistemic_status !== 'fact' || !scalar(fact.value)
        || !factAppliesToTarget(fact, project, context.target) || fact.scope_kind === 'project' && fact.object_ref !== `project:${project.project_id}`
        || fact.observed_at && (!date(fact.observed_at) || Date.parse(fact.observed_at) > at)) continue
      const label = field === 'project_stage' ? '阶段' : QUANTITIES[field]
      const value = field === 'project_stage' ? STAGES[String(fact.value)] : `${fact.value}${fact.unit ? ' ' + fact.unit : ''}`
      if (!label || !value) continue
      const row: PreliminaryObservation = { label, value, scope: fact.scope_kind === 'project' || fact.object_ref === `project:${project.project_id}` ? project.scope_label : fact.object_ref || '范围未标注',
        observedAt: date(fact.observed_at), publishedAt: date(source.published_at), sourceRefs: [`${project.project_id}:${source.id}`], locator: fact.locator, factId: fact.id }
      observations.push(row); if (field === 'project_stage') stageRows.push(row)
    }
    for (const source of project.sources.filter(source => readable(source, at))) {
      // Namespace retained record identifiers exactly as the map source viewer.
      recordRows({ ...source, id: `${project.project_id}:${source.id}` }, (source.public_records || []).map(record => ({ ...record, source_id: `${project.project_id}:${record.source_id}` })), context.target.object_ref || '', project.project_id, evaluatedAt)
    }
  }
  for (const source of (extras.sources || []).filter(source => readable(source))) recordRows(source, extras.records || source.public_records || [], context.target.object_ref || '')
  const quantities = observations.filter(row => Object.values(QUANTITIES).includes(row.label))
  const stages = uniq(stageRows.map(row => row.value)), quantityText = quantities.slice(0, 3).map(row => `${row.label} ${row.value}（${row.scope}；${row.observedAt?.slice(0, 10) || '统计时点未提供'}）`)
  const ranges = uniq(context.local_projects.filter(row => row.relation === 'within_scope' && context.target.object_ref === `project:${row.project_id}`).map(row => row.scope_label))
  const missing = [!stages.length ? '对象阶段' : '', !quantities.length ? '工程范围与数量口径' : '', !windowRows.length ? '当前参与窗口' : ''].filter(Boolean)
  return {
    lines: [
      { text: `${stages.length ? stages.join(' / ') : '阶段未提供'} · ${ranges.join(' / ') || context.target.label || '所选研究范围'}`, sourceRefs: uniq(stageRows.flatMap(row => row.sourceRefs)) },
      { text: quantityText.length ? quantityText.join('；') + (quantities.length > 3 ? '；更多口径见依据' : '') : '工程范围、楼栋及户数：未提供可定位的对象记录', sourceRefs: uniq(quantities.flatMap(row => row.sourceRefs)) },
      { text: `参与窗口：${uniq(windowRows.map(row => row.value)).join(' / ') || '未提供，不能据场所分布认定当前项目'}`, sourceRefs: uniq(windowRows.flatMap(row => row.sourceRefs)) },
    ], observations, sourceRefs: uniq(observations.flatMap(row => row.sourceRefs)), missing,
  }
}
