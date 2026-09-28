import type { MapScreenContext, Source } from '../../apps/host/generated/contracts'

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
    const sources = project.sources.filter(s => s.visibility === 'public' && s.data_class === 'public' && !s.synthetic)
    if (!sources.length) return []
    const ids = new Set(sources.map(s => s.id))
    return [{...project, name: project.relation === 'city_background' ? '同城公开研究资料' : '范围内项目的公开资料',
      scope_label: project.relation === 'city_background' ? `${context.city || ''}城市背景` : '选中位置范围内项目',
      facts: project.facts.filter(f => ids.has(f.source_id)), sources, source_count: sources.length,
      fact_count: project.facts.filter(f => ids.has(f.source_id)).length, document_count: 0, rules: []}]
  })
  return result
}

/** Keep each original public document addressable when a map study becomes a project. */
export function handoffPublicSources(context:MapScreenContext):Source[]{
  const clean=publicMapContext(context)
  const all=[...(clean.research_sources||[]),...clean.local_projects.flatMap(p=>p.sources.map(s=>({...s,id:`${p.project_id}:${s.id}`,locator:`${p.relation}:${s.locator||s.url||s.id}`})))]
  return [...new Map(all.filter(s=>s.content_status!=='metadata_only').map(s=>[s.id,s])).values()]
}
