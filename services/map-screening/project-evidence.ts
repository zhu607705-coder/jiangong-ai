import type { Store, ProjectRecord, RunRecord } from '../../apps/host/store'
import type { MapDataCatalog, MapProjectEvidence, MapScreenTarget, Source } from '../../apps/host/generated/contracts'
import { fingerprint } from './provider'
import booleanPointInPolygon from '@turf/boolean-point-in-polygon'
import { createHash } from 'node:crypto'
import { projectBoundToTarget } from '../../packages/maps/decision-factors'
import { retrofitAdvice } from '../../packages/retrofit/planning'

export type EvidenceProject = { project: ProjectRecord; sources: Source[]; documentCount: number }
export type ProjectEvidenceSnapshot = { revision: string; projects: EvidenceProject[]; syntheticCount: number }
const actualSource = (source: Source) => !source.synthetic && ['public', 'internal'].includes(source.data_class)
export function mergeProjectSources(project: ProjectRecord, runs: RunRecord[]): Source[] {
  // Latest input wins. Prior completed research contributes its retrieved sources,
  // never its model-written findings or the contents of another project.
  const latest = runs.find(r => r.status === 'completed' && r.decision && r.project_id === project.id && !r.snapshot.synthetic)
  const sources = new Map<string, Source>()
  for (const source of [...(latest?.decision?.sources || []), ...project.input.sources]) if (actualSource(source)) sources.set(source.id, source)
  return [...sources.values()]
}
export async function loadProjectEvidence(store: Store, owner: string): Promise<ProjectEvidenceSnapshot> {
  const all = await store.projects(owner)
  const projects = await Promise.all(all.filter(p => !p.input.synthetic).map(async project => {
    const [runs, documents] = await Promise.all([store.runs(project.id), store.db.query<{count: number}>('SELECT COUNT(*)::int AS count FROM documents WHERE project_id=$1', [project.id])])
    return { project, sources: mergeProjectSources(project, runs), documentCount: Number(documents.rows[0].count) }
  }))
  return { projects, syntheticCount: all.filter(p => p.input.synthetic).length,
    revision: fingerprint(projects.map(p => [p.project.id, p.project.context_version, p.project.updated_at, p.project.input.scope, p.project.input.business_profile, p.project.input.as_of, p.project.input.facts, p.sources, p.documentCount])) }
}
const cityKey = (city: string | null | undefined) => city?.trim().replace(/市$/, '') || ''
export function targetContains(target: MapScreenTarget, longitude: number, latitude: number): boolean {
  if (target.geometry) return booleanPointInPolygon([longitude,latitude],target.geometry as any,{ignoreBoundary:true})
  if (target.bounds) {
    const b = target.bounds
    // Half-open viewport edges avoid duplicate point association.
    return longitude >= b.west && longitude < b.east && latitude >= b.south && latitude < b.north
  }
  const rad = Math.PI / 180, dlat = (latitude - target.latitude) * rad, dlon = (longitude - target.longitude) * rad
  const a = Math.sin(dlat / 2) ** 2 + Math.cos(latitude * rad) * Math.cos(target.latitude * rad) * Math.sin(dlon / 2) ** 2
  return 6371008.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a))) <= (target.radius_m || 0)
}
function sourcePreview(source: Source): Source {
  // Internal text stays in the existing project evidence viewer. Even the map
  // snapshot does not duplicate it into public-source handoffs or model prompts.
  const { untrusted_text, hash, public_records, ...metadata } = source
  const excerpt = source.visibility === 'public' && source.data_class === 'public' && source.content_status !== 'metadata_only' ? untrusted_text?.slice(0, 2400) : undefined
  return { ...metadata, ...(excerpt ? {untrusted_text: excerpt, ...((hash||source.raw_hash)?{hash:createHash('sha256').update(excerpt).digest('hex')}:{}), content_status: 'excerpt' as const, ...(public_records?{public_records}: {})} : hash?{hash}: {}) }
}
export function evidenceAt(snapshot: ProjectEvidenceSnapshot, target: MapScreenTarget, city: string | null, boundaryProjectId?: string): MapProjectEvidence[] {
  const result: MapProjectEvidence[] = []
  for (const { project, sources, documentCount } of snapshot.projects) {
    const scope = project.input.scope, anchor = scope.map_anchor
    const located = !!anchor && anchor.coordinate_encoding === 'GCJ-02'
    const inside = (boundaryProjectId === project.id && !!scope.geometry && !!target.geometry) || (located && targetContains(target, anchor.longitude, anchor.latitude))
    // City documents are only background for an explicitly matching city.
    // A located project outside the target is never promoted to city evidence.
    const cityBackground = !located && !scope.geometry && cityKey(city) && cityKey(city) === cityKey(scope.city)
    if (!inside && !cityBackground) continue
    const permitted = inside ? sources : sources.filter(s => s.visibility === 'public' && s.data_class === 'public')
    if (!inside && !permitted.length) continue
    const ids = new Set(permitted.map(s => s.id))
    const facts = inside ? project.input.facts.filter(f => ids.has(f.source_id)) : []
    const exactProject=inside&&projectBoundToTarget({project_id:project.id,relation:'within_scope'},target)
    const neighborhood=project.input.business_profile==='neighborhood'
    result.push({project_id: project.id, name: project.name, relation: inside ? 'within_scope' : 'city_background', scope_label: scope.name,
      business_profile:project.input.business_profile||'general',as_of:project.input.as_of,
      ...(neighborhood&&exactProject?{neighborhood_action:retrofitAdvice(project.input)}:{}),
      context_version: project.context_version, updated_at: new Date(project.updated_at).toISOString(), source_count: permitted.length,
      fact_count: facts.length, document_count: inside ? documentCount : 0, sources: permitted.map(sourcePreview), facts,
      rules: inside ? project.input.context_rules.filter(r => r.active !== false && r.scope === 'project' && (!r.project_id || r.project_id === project.id) && ids.has(r.source_id)) : []})
  }
  return result
}
export function dataCatalog(snapshot: ProjectEvidenceSnapshot): MapDataCatalog {
  const projects = snapshot.projects.map(({project, sources, documentCount}) => ({project_id: project.id, name: project.name,
    scope_label: project.input.scope.name, city: project.input.scope.city || '', located: !!project.input.scope.map_anchor || !!project.input.scope.geometry,
    source_count: sources.length, public_source_count: sources.filter(s => s.visibility === 'public').length,
    internal_source_count: sources.filter(s => s.visibility === 'internal').length, fact_count: project.input.facts.filter(f => sources.some(s => s.id === f.source_id)).length,
    document_count: documentCount, updated_at: new Date(project.updated_at).toISOString()}))
  return {created_at: new Date().toISOString(), projects, real_project_count: projects.length, synthetic_project_count: snapshot.syntheticCount,
    unlocated_project_count: projects.filter(p => !p.located).length,
    notes: ['项目资料来自本地项目库及已完成研究。', '地图场所用于选择调查方向；研判条件读取项目原文与已核事实。']}
}
