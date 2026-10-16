import type { MapScreenContext, Source } from '../../apps/host/generated/contracts'
import { genericMapLabel } from './object-identity'
import { withSourceRecords } from '../research/source-records'

export function researchSubject(context:MapScreenContext):string {
  const label=context.target.label_origin==='public'?context.target.label?.trim()||'':''
  if(label&&!genericMapLabel(label))return label
  // Nearby POIs remain leads; they must not replace the selected object's identity.
  return (context.address||'').trim().slice(0,180)
}

/** The same public-only boundary is used by the model and new-project handoff. */
export function publicMapContext(context: MapScreenContext): MapScreenContext {
  const result = structuredClone(context)
  // The display name is not an external-query identity. Legacy/unresolved labels
  // are also private by default, even after a refresh loses a local project join.
  if (result.target?.label_origin !== 'public') delete result.target?.label
  result.research_sources=result.research_sources?.filter(s=>s.visibility==='public'&&s.data_class==='public'&&!s.synthetic)
  const publicIds=new Set(result.research_sources?.map(s=>s.id)||[])
  result.research_records=result.research_records?.filter(r=>publicIds.has(r.source_id))
  result.local_projects = result.local_projects.flatMap(project => {
    const {neighborhood_action: _privateDerivedAction, ...publicProject}=project
    const sources = project.sources.filter(s => s.visibility === 'public' && s.data_class === 'public' && !s.synthetic)
    if (!sources.length) return []
    const ids = new Set(sources.map(s => s.id))
    return [{...publicProject, name: project.relation === 'city_background' ? '同城公开研究资料' : '范围内项目的公开资料',
      scope_label: project.relation === 'city_background' ? `${context.city || ''}城市背景` : '选中位置范围内项目',
      facts: project.facts.filter(f => ids.has(f.source_id)), sources, source_count: sources.length,
      fact_count: project.facts.filter(f => ids.has(f.source_id)).length, document_count: 0, rules: []}]
  })
  return result
}

/** Keep each original public document addressable when a map study becomes a project. */
export function handoffPublicSources(context:MapScreenContext):Source[]{
  const clean=publicMapContext(context)
  const all=[...(clean.research_sources||[]).map(s=>withSourceRecords(s,clean.research_records||[])),...clean.local_projects.flatMap(p=>p.sources.map(s=>({...s,id:`${p.project_id}:${s.id}`,locator:`${p.relation}:${s.locator||s.url||s.id}`})))]
  const originals=new Map<string,Source>()
  for(const source of all.filter(s=>s.content_status!=='metadata_only')) {
    // Only project-namespace wrappers are ignored. Distinct pages, excerpts,
    // versions, evidence scopes and structured records remain independent.
    const locator=source.locator?.replace(/^(?:(?:within_scope|city_background):)+/,'')
    const key=JSON.stringify([source.url||source.hash||source.id,source.hash,source.untrusted_text,locator,source.evidence_scope,source.object_refs,
      source.raw_hash,source.public_records?.map(({source_id:_namespace,...record})=>record),source.published_at,source.date_status,source.expires_at,source.license,source.parse_status,source.body_truncated,source.records_truncated,source.content_status])
    const previous=originals.get(key)
    if(!previous||source.id.length<previous.id.length)originals.set(key,source)
  }
  return [...originals.values()]
}
