import { config } from '../../apps/host/config'
import type { ProgressSink } from '../../packages/research/events'
import { BRIEF_SKILL_VERSION } from '../../runtime/skills/investment-brief'
import { RESEARCH_POLICY } from '../../packages/research/public-sources'
import { booleanValid } from '@turf/boolean-valid'
import { decisionFactors } from '../../packages/maps/decision-factors'
import { applyDecisionGuards } from '../../packages/decision/structured-route'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { validate } from '../../packages/contracts/validate'
import { EVIDENCE_GROUPS, INVESTIGATION_GAPS, SCREEN_METHOD, assertScreenBounds, classifyCells, contextComparable, usableMapEvidence } from '../../packages/maps/screening-policy'
import type { MapScreenAnalysis, MapScreenBounds, MapScreenContext, MapScreenEvidence, MapScreenPoi, MapScreenProfile, MapScreenResult, MapScreenTarget, MapScreenTheme } from '../../apps/host/generated/contracts'
import { fingerprint, type MapProvider } from './provider'
import { targetContains, evidenceAt, type ProjectEvidenceSnapshot } from './project-evidence'

import type { RegionResolver } from './regions'

export type ContextAnalyst = (context: MapScreenContext, profile: MapScreenProfile, signal: AbortSignal, emit?: ProgressSink) => Promise<MapScreenAnalysis>
const round = (value: number) => Math.round(value * 1e6) / 1e6
const stamp = () => new Date().toISOString()

export function normalizeEvidence(key: typeof EVIDENCE_GROUPS[number], raw: any, sourceId: string): MapScreenEvidence {
  const count = typeof raw?.count === 'number' ? raw.count : /^\d+$/.test(String(raw?.count)) ? Number(raw.count) : null
  if (!Number.isSafeInteger(count) || count! < 0 || !Array.isArray(raw?.pois)) throw new Error('INVALID_AMAP_COUNTS')
  const sample: MapScreenPoi[] = []
  const seen = new Set<string>()
  for (const p of raw.pois.slice(0, 25)) {
    const parts = typeof p.location === 'string' ? p.location.split(',') : []
    const [longitude, latitude] = parts.map(Number)
    if (typeof p.id !== 'string' || typeof p.name !== 'string' || parts.length !== 2 || parts.some((v: string) => !v.trim()) || !Number.isFinite(longitude) || !Number.isFinite(latitude) || Math.abs(longitude) > 180 || Math.abs(latitude) > 90 || seen.has(p.id)) continue
    seen.add(p.id)
    sample.push({ id: p.id.slice(0, 100), name: p.name.slice(0, 200), category: typeof p.type === 'string' ? p.type.slice(0, 300) : '', longitude, latitude })
  }
  if (count! > 0 && !sample.length) throw new Error('INVALID_AMAP_SAMPLE')
  if (count === 0 && raw.pois.length) throw new Error('INVALID_AMAP_COUNTS')
  return { key: key.key, source_id: sourceId, label: key.label, types_query: key.types, status: count! >= 600 ? 'capped' : 'available', reported_count: count,
    sample, retrieved_at: stamp(), issue: count! >= 600 ? '样本较多，可缩小范围查看。' : null }
}

export function normalizedTarget(value: unknown): MapScreenTarget {
  const target = validate<MapScreenTarget>('MapScreenTarget', value)
  if (target.kind === 'point' && (target.bounds !== null || target.radius_m === null || !!target.geometry)) throw new Error('INVALID_TARGET')
  if (target.kind === 'cell') {
    if (!target.bounds || target.radius_m !== null) throw new Error('INVALID_TARGET')
    assertScreenBounds(target.bounds)
    if (!target.geometry && (Math.abs(target.longitude - (target.bounds.west + target.bounds.east) / 2) > 1e-5 || Math.abs(target.latitude - (target.bounds.south + target.bounds.north) / 2) > 1e-5)) throw new Error('INVALID_CELL_CENTER')
  }
  if (target.geometry) {
    if (!booleanValid(target.geometry as any) || !target.bounds || target.geometry.coordinates.some(ring => ring.some(([x,y]) => x < target.bounds!.west-1e-7 || x > target.bounds!.east+1e-7 || y < target.bounds!.south-1e-7 || y > target.bounds!.north+1e-7))) throw new Error('INVALID_REGION_GEOMETRY')
  }
  if (target.geometry && !targetContains(target, target.longitude, target.latitude)) throw new Error('INVALID_REGION_ANCHOR')
  return { ...target, longitude: round(target.longitude), latitude: round(target.latitude), bounds: target.bounds ? Object.fromEntries(Object.entries(target.bounds).map(([k, v]) => [k, round(v)])) as unknown as MapScreenBounds : null }
}

export class MapScreeningService {
  private contexts = new Map<string, MapScreenContext>()
  private analyses = new Map<string, MapScreenAnalysis>()
  private activeAnalyses = 0
  private analyzing = new Set<string>()
  constructor(private provider: MapProvider, private directory: string, private analyst: ContextAnalyst,
    private loadEvidence: () => Promise<ProjectEvidenceSnapshot> = async () => ({revision: 'empty', projects: [], syntheticCount: 0}),
    private regions: RegionResolver = async () => ({cells:[],notes:['此处暂未取得街区边界，可点选建筑研判。']})) {}

  async context(value: unknown, signal: AbortSignal, snapshot?: ProjectEvidenceSnapshot): Promise<MapScreenContext> {
    signal.throwIfAborted()
    snapshot ??= await this.loadEvidence()
    const target = normalizedTarget(value)
    const key = fingerprint([this.provider.revision(), target])
    const cached = this.contexts.get(key)
    if (cached && Date.parse(cached.expires_at) > Date.now()) {
      if (cached.project_revision === snapshot.revision) return structuredClone(cached)
      const rebound = {...cached, id: 'MAPCTX-' + randomUUID(), project_revision: snapshot.revision, local_projects: evidenceAt(snapshot, target, cached.city)}
      this.contexts.set(key, rebound); await this.save('contexts', rebound.id, rebound)
      return structuredClone(rebound)
    }
    const id = 'MAPCTX-' + randomUUID(), created = stamp()
    const params: Record<string, string> = { offset: '25', page: '1', extensions: 'base', children: '0' }
    if (target.kind === 'point') Object.assign(params, { location: `${target.longitude},${target.latitude}`, radius: String(target.radius_m), sortrule: 'distance' })
    else {
      const b = target.bounds!
      params.polygon = `${b.west.toFixed(6)},${b.north.toFixed(6)}|${b.east.toFixed(6)},${b.south.toFixed(6)}`
    }
    const groups = await Promise.all(EVIDENCE_GROUPS.map(async group => {
      const sourceId = `${id}:${group.key}`
      try {
        const data = await this.provider.query(target.kind === 'point' ? '/v3/place/around' : '/v3/place/polygon', { ...params, types: group.types }, signal)
        const normalized = normalizeEvidence(group, data, sourceId)
        if (target.geometry) { normalized.sample = normalized.sample.filter(p => targetContains(target,p.longitude,p.latitude)); normalized.reported_count = null }
        return normalized
      } catch {
        signal.throwIfAborted()
        return { key: group.key, source_id: sourceId, label: group.label, types_query: group.types, status: 'failed' as const, reported_count: null, sample: [], retrieved_at: stamp(), issue: '来源暂未返回。' }
      }
    }))
    let address: string | null = null, city: string | null = null
    {
      try {
        const data = await this.provider.query('/v3/geocode/regeo', { location: `${target.longitude},${target.latitude}`, extensions: 'base', radius: '100' }, signal)
        if (typeof data.regeocode?.formatted_address === 'string') address = data.regeocode.formatted_address.slice(0, 500)
        const component = data.regeocode?.addressComponent
        if (typeof component?.city === 'string' && component.city) city = component.city.slice(0, 100)
        else if (['北京市', '上海市', '天津市', '重庆市'].includes(component?.province)) city = component.province
      } catch { signal.throwIfAborted() }
    }
    signal.throwIfAborted()
    const result = validate<MapScreenContext>('MapScreenContext', { id, target, provider: 'amap', coordinate_encoding: 'GCJ-02', created_at: created,
      expires_at: new Date(Date.now() + (groups.every(g => g.status !== 'failed') ? 600_000 : 30_000)).toISOString(), address, city, groups,
      local_projects: evidenceAt(snapshot, target, city), project_revision: snapshot.revision,
      status: groups.every(g => g.status === 'available') ? 'complete' : 'partial', gaps: INVESTIGATION_GAPS,
      metric_note: '场所按高德分类检索；保留至多25个样本，并按所选多边形过滤。' })
    if (this.contexts.size >= 120) this.contexts.delete(this.contexts.keys().next().value!)
    this.contexts.set(key, result)
    await this.save('contexts', id, result)
    return structuredClone(result)
  }

  async analyze(id: string, profile: MapScreenProfile, signal: AbortSignal, emit: ProgressSink = () => {}): Promise<MapScreenAnalysis> {
    if (!/^MAPCTX-[a-f\d-]{36}$/i.test(id)) throw new Error('CONTEXT_NOT_FOUND')
    let context: MapScreenContext
    try { context = validate<MapScreenContext>('MapScreenContext', JSON.parse(await readFile(join(this.directory, 'contexts', id + '.json'), 'utf8'))) }
    catch { throw new Error('CONTEXT_NOT_FOUND') }
    if (Date.parse(context.expires_at) < Date.now()) throw new Error('CONTEXT_EXPIRED')
    const key = [id, profile, RESEARCH_POLICY, BRIEF_SKILL_VERSION].join(':'), cached = this.analyses.get(key)
    if (cached?.status === 'completed') { emit({type:'progress',stage:'sources',status:'completed',message:'复用本次研判'}); return structuredClone(cached) }
    if (!context.target.label && !context.address && context.groups.filter(usableMapEvidence).length < 2 && !context.local_projects.some(p => p.sources.some(s => s.visibility === 'public' && s.content_status !== 'metadata_only' && s.untrusted_text))) return { context_id: id, profile, status: 'insufficient_data', assessment: null, model_calls: [], reason: '可用资料较少，请补充项目材料。', created_at: stamp() }
    if (this.activeAnalyses >= 2 || this.analyzing.has(key)) return { context_id: id, profile, status: 'unavailable', assessment: null, model_calls: [], reason: '已有初筛解读正在运行，请稍后重试。', created_at: stamp() }
    this.activeAnalyses++; this.analyzing.add(key)
    try {
      const analysis = validate<MapScreenAnalysis>('MapScreenAnalysis', await this.analyst(context, profile, signal, emit))
      signal.throwIfAborted()
      if (analysis.assessment) {
        const extracted = analysis.assessment.factors || []
        analysis.assessment.factors = decisionFactors(context).map(f => f.state === 'unknown' ? extracted.find(e => e.key === f.key) || f : f)
      }
      if(analysis.decision_support) {
        analysis.decision_support=applyDecisionGuards(analysis.decision_support,decisionFactors(context))
      }
      if (this.analyses.size >= 120) this.analyses.delete(this.analyses.keys().next().value!)
      if (analysis.status === 'completed') this.analyses.set(key, analysis)
      await this.save('analyses', id + '-' + profile, analysis)
      if(analysis.status==='completed')await this.save('scope-analyses',this.scopeKey(context,profile),{saved_at:stamp(),analysis})
      return analysis
    } finally { this.activeAnalyses--; this.analyzing.delete(key) }
  }

  async screen(bounds: MapScreenBounds, profile: MapScreenProfile, theme: MapScreenTheme, signal: AbortSignal, emit: (event: unknown) => void): Promise<MapScreenResult> {
    assertScreenBounds(bounds)
    const id='MAPSCAN-'+randomUUID(), snapshot=await this.loadEvidence()
    emit({type:'progress',message:'识别园区与道路围合边界'})
    const {cells,notes}=await this.regions(bounds,snapshot,signal)
    signal.throwIfAborted()
    emit({type:'start',id,bounds,profile,theme,cells})
    // One shared map snapshot, not 5 requests multiplied by every polygon.
    // POI samples are filtered into objects; counts never enter the decision.
    let shared:MapScreenContext|null=null
    if(cells.length) shared=await this.context({kind:'cell',bounds,radius_m:null,longitude:(bounds.west+bounds.east)/2,latitude:(bounds.south+bounds.north)/2},signal,snapshot)
    for(let i=0;i<cells.length;i++) {
      signal.throwIfAborted()
      const cell=cells[i],b=cell.bounds,anchor=cell.anchor||[(b.west+b.east)/2,(b.south+b.north)/2]
      const target=normalizedTarget({kind:'cell',bounds:b,geometry:cell.geometry, radius_m:null,longitude:anchor[0],latitude:anchor[1],label:cell.label})
      const context=validate<MapScreenContext>('MapScreenContext',{
        ...shared!,id:'MAPCTX-'+randomUUID(),target,
        groups:shared!.groups.map(g=>({...g,reported_count:null,sample:g.sample.filter(p=>targetContains(target,p.longitude,p.latitude))})),
        local_projects:evidenceAt(snapshot,target,shared!.city,cell.boundary_source?.startsWith('project:') ? cell.boundary_source.slice(8) : undefined),
      })
      await this.save('contexts',context.id,context)
      cell.context=context
      // Recoloring only reuses the identical object/profile/source revision. It never reruns AI.
      try{
        const saved=JSON.parse(await readFile(join(this.directory,'scope-analyses',this.scopeKey(context,profile)+'.json'),'utf8'))
        if(Date.now()-Date.parse(saved.saved_at)<86400000){
          const analysis=validate<MapScreenAnalysis>('MapScreenAnalysis',saved.analysis)
          if(analysis.status==='completed'){
            cell.dashboard=analysis.decision_support?.dashboard
            cell.factors=decisionFactors(context).map(f=>f.state==='unknown'?analysis.assessment?.factors?.find(p=>p.key===f.key)||f:f)
          }
        }
      }catch{ /* No verified cached judgment for this object. */ }
      const classified=classifyCells([cell],theme)[0]
      cells[i]=classified
      emit({type:'cell',cell:classified,completed:i+1,total:cells.length})
    }
    const result=validate<MapScreenResult>('MapScreenResult',{id,bounds,profile,theme,created_at:stamp(),cells,
      status:cells.length?'completed':'partial',method:SCREEN_METHOD,
      comparison_count:cells.filter(c=>c.tier!=='incomplete').length,notes})
    await this.save('scans',id,result);emit({type:'complete',result});return result
  }

  private scopeKey(context:MapScreenContext,profile:MapScreenProfile):string{
    const t=context.target
    return fingerprint([RESEARCH_POLICY,BRIEF_SKILL_VERSION,config.DEEPSEEK_MODEL,config.QWEN_DECISION_MODEL,config.QWEN_DECISION_ENDPOINT,config.decisionEnabled,profile,this.provider.revision(),context.project_revision,
      t.kind,t.geometry||null,t.bounds||null,t.longitude,t.latitude,t.radius_m,t.label||'',context.created_at.slice(0,10)])
  }

  private async save(folder: string, id: string, value: unknown) {
    await mkdir(join(this.directory, folder), { recursive: true })
    await writeFile(join(this.directory, folder, id + '.json'), JSON.stringify(value, null, 2) + '\n', { mode: 0o600 })
  }
}
