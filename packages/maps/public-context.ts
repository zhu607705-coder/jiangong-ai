import type { MapScreenContext } from '../../apps/host/generated/contracts'

/** The same public-only boundary is used by the model and new-project handoff. */
export function publicMapContext(context: MapScreenContext): MapScreenContext {
  const result = structuredClone(context)
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
