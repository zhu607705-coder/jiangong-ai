import type {RenewalInternalDataRequest} from '../../apps/host/generated/contracts'
import type {StrategyPacket} from './strategy'
import type {ResearchMissingMaterial} from './research-rounds'
import {currentDirectionText,type StrategyDirection} from './direction-text'

export type ProjectTaskProgress = 'not_started' | 'in_progress' | 'material_received'
export type ProjectInvestigationTask = {
  id: string; title: string; request: string; reason: string; evidence_refs: string[];
  kinds: ('next_check' | 'missing_material' | 'internal_data')[]; progress_keys: string[];
  internal_data?: RenewalInternalDataRequest & { related_objects: string[]; scope: 'project' | 'scheme' | 'unresolved' };
}
const normalize = (text: string) => text.normalize('NFKC').replace(/[\s\p{P}\p{S}]/gu, '')

export function taskObjectApplicability(packet:StrategyPacket,task:ProjectInvestigationTask){
  const packageIds=new Set(task.internal_data?.related_package_ids||[])
  const related=packet.strategy?.paths.flatMap(path=>(path.work_packages||[]).filter(work=>packageIds.has(work.id)))||[]
  const refs=new Set([...task.evidence_refs,...related.flatMap(work=>[...(work.evidence_refs||[]),...(work.source_id?[work.source_id]:[])])])
  const foreign=packet.sources.filter(source=>refs.has(source.id)&&source.object_binding?.relation==='different_object')
  const review=!!packet.current_context?.object_review_required||!!packet.content_review?.issues.some(issue=>issue.code==='OBJECT_LOCATION_CONFLICT')
  if(foreign.length)return {state:'foreign_reference' as const,label:'旧报告要求 · 异地参考',reason:foreign.map(source=>source.object_binding!.reason).join('；')}
  if(review&&task.id.includes(':followup:')&&/地址|边界|对象登记|同名|研究范围|项目位置/.test(task.request))return {state:'object_check' as const,label:'当前对象优先核查',reason:'先确认当前项目的位置、范围和对应原文，再采用旧报告中的具体调查口径。'}
  if(review)return {state:'needs_review' as const,label:'旧报告要求 · 对象待核',reason:'该报告存在对象范围冲突，本项楼栋、数量和采集口径需先核对是否适用于当前项目。'}
  return {state:'unflagged' as const,label:'',reason:''}
}

/** The API owns the requests. Display filtering and exact duplicate merging do not modify its saved text. */
export function buildProjectTasks(packet: StrategyPacket | null, direction?: StrategyDirection | null, extraMissing: ResearchMissingMaterial[] = []): ProjectInvestigationTask[] {
  if (!packet?.strategy || packet.status !== 'completed') return []
  const tasks: ProjectInvestigationTask[] = []
  const visible = (text: string) => direction ? currentDirectionText(text, direction) : text.trim()
  const insert = (task: ProjectInvestigationTask) => {
    const duplicate = tasks.find(existing => normalize(existing.title) === normalize(task.title) && normalize(existing.request) === normalize(task.request)
      || normalize(task.request).length >= 12 && normalize(existing.request) === normalize(task.request))
    if (!duplicate) { tasks.push(task); return }
    duplicate.evidence_refs = [...new Set([...duplicate.evidence_refs, ...task.evidence_refs])]
    duplicate.kinds = [...new Set([...duplicate.kinds, ...task.kinds])]
    duplicate.progress_keys = [...new Set([...duplicate.progress_keys, ...task.progress_keys])]
    if (task.reason && !duplicate.reason.includes(task.reason)) duplicate.reason = [duplicate.reason, task.reason].filter(Boolean).join('\n')
  }
  packet.strategy.next_checks.forEach((check, index) => {
    const title = visible(check.title), request = visible(check.detail)
    if (!title || !request) return
    const id = `${packet.input_hash}:${index}`
    insert({ id, title, request, reason: '', evidence_refs: [...check.evidence_refs], kinds: ['next_check'], progress_keys: [id] })
  })
  for (const item of [...(packet.strategy.round_review?.missing_materials || []), ...extraMissing]) {
    const title = visible(item.topic), request = visible(item.request)
    if (!title || !request) continue
    const id = `${packet.input_hash}:missing:${encodeURIComponent(`${normalize(item.topic)}:${normalize(item.request)}`)}`
    insert({ id, title, request, reason: visible(item.reason), evidence_refs: [...item.evidence_refs], kinds: ['missing_material'], progress_keys: [id] })
  }
  const followUp=packet.content_review?.follow_up
  const pending=[
    ...(followUp?.search_queries||[]).map(request=>({title:'继续公开检索',request,reason:'补充本轮待核结论的现实来源。'})),
    ...(followUp?.reading_focus||[]).map(request=>({title:'补读关键原文',request,reason:'核实引用、条件和压缩时未保留的关键片段。'})),
    ...(followUp?.internal_data||[]).map(request=>({title:'补充内部资料',request,reason:'取得网络难以获得的项目台账或调查。'})),
    ...(packet.investigation_requests||[]).map(item=>({title:item.visibility==='internal'?'补充内部调查':'补查专题缺项',request:item.suggested_queries.join('；')||item.missing_fields.join('；'),reason:item.affected_decisions.join('；')})),
    ...(packet.coverage?.requests||[]).map(item=>({title:'补齐费用口径',request:item.suggested_queries.join('；'),reason:item.affected_decisions.join('；')})),
  ]
  for(const item of pending){
    const request=visible(item.request);if(!request)continue
    const id=`${packet.input_hash}:followup:${encodeURIComponent(normalize(request))}`
    insert({id,title:item.title,request,reason:visible(item.reason),evidence_refs:[],kinds:['missing_material'],progress_keys:[id]})
  }
  const packages = packet.strategy.paths.flatMap(path => (path.work_packages || []).map(item => ({ mode: path.mode, item })))
  for (const item of packet.strategy.internal_data_requests || []) {
    const related = packages.filter(row => item.related_package_ids.includes(row.item.id))
    const own = direction ? related.filter(row => row.mode === direction) : related
    if (direction && item.related_package_ids.length && !own.length) continue
    const title = visible(item.metric), request = visible(item.collection_method), id = `${packet.input_hash}:internal:${item.id}`
    if (!title || !request || tasks.some(task => task.id === id)) continue
    // Structured collection plans retain their own key, even when a general missing-file task has the same wording.
    tasks.push({ id, title, request, reason: visible(item.purpose), evidence_refs: [...item.evidence_refs], kinds: ['internal_data'], progress_keys: [id],
      internal_data: { ...item, related_package_ids: [...item.related_package_ids], evidence_refs: [...item.evidence_refs], related_objects: [...new Set(own.map(row => row.item.target))], scope: !item.related_package_ids.length ? 'project' : own.length ? 'scheme' : 'unresolved' } })
  }
  return tasks
}
