import { config } from '../../apps/host/config'
import type { ResearchSink } from '../../packages/research/events'
import { BRIEF_SKILL_VERSION } from '../../runtime/skills/investment-brief'
import { RESEARCH_POLICY } from '../../packages/research/public-sources'
import { dimensionCurrentAt } from '../../packages/research/evidence'
import { researchSubject } from '../../packages/maps/public-context'
import { groundMapAssessment } from './analyst'
import { booleanValid } from '@turf/boolean-valid'
import { decisionFactors } from '../../packages/maps/decision-factors'
import { applyDecisionGuards } from '../../packages/decision/structured-route'
import { DECISION_POLICY, DECISION_THRESHOLDS } from '../../packages/decision/structured-route'
import { DASHBOARD_POLICY } from '../../packages/decision/dashboard'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { validate } from '../../packages/contracts/validate'
import { EVIDENCE_GROUPS, INVESTIGATION_GAPS, SCREEN_METHOD, assertScreenBounds, classifyCells, contextComparable, usableMapEvidence } from '../../packages/maps/screening-policy'
import type { MapScreenAnalysis, MapScreenBounds, MapScreenContext, MapScreenEvidence, MapScreenPoi, MapScreenProfile, MapScreenResult, MapScreenTarget, MapScreenTheme } from '../../apps/host/generated/contracts'
import { fingerprint, type MapProvider } from './provider'
import { targetContains, evidenceAt, type ProjectEvidenceSnapshot } from './project-evidence'

import { validateRegionTopology, type RegionResolver, type TopologyValidator } from './regions'

export type ContextAnalyst = (context: MapScreenContext, profile: MapScreenProfile, signal: AbortSignal, emit?: ResearchSink, previous?:MapScreenAnalysis) => Promise<MapScreenAnalysis>
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
  // Preserve the validated geometry, bbox and interior anchor at the same
  // precision. Rounding only the bbox can move an edge inside its own polygon.
  return structuredClone(target)
}

export class MapScreeningService {
  private contexts = new Map<string, MapScreenContext>()
  private activeAnalyses = 0
  private analyzing = new Set<string>()
  private validGeometries=new Set<string>()
  constructor(private provider: MapProvider, private directory: string, private analyst: ContextAnalyst,
    private loadEvidence: () => Promise<ProjectEvidenceSnapshot> = async () => ({revision: 'empty', projects: [], syntheticCount: 0}),
    private regions: RegionResolver = async () => ({cells:[],notes:['此处暂未取得街区边界，可点选建筑研判。']}),
    private topology:TopologyValidator=validateRegionTopology) {}

  async context(value: unknown, signal: AbortSignal, snapshot?: ProjectEvidenceSnapshot): Promise<MapScreenContext> {
    signal.throwIfAborted()
    snapshot ??= await this.loadEvidence()
    const target = normalizedTarget(value)
    await this.checkTopology(target,signal)
    const key = fingerprint([this.provider.revision(), target])
    const cached = this.contexts.get(key)
    if (cached && Date.parse(cached.expires_at) > Date.now()) {
      const rebound = {...cached,...(cached.project_revision!==snapshot.revision?{id:'MAPCTX-'+randomUUID(),project_revision:snapshot.revision}:{})}
      if(!rebound.address)await this.locate(rebound,signal)
      rebound.local_projects=evidenceAt(snapshot,target,rebound.city,this.boundaryProject(target))
      this.contexts.set(key,rebound);await this.save('contexts',rebound.id,rebound)
      return structuredClone(rebound)
    }
    const id = 'MAPCTX-' + randomUUID(), created = stamp()
    const params: Record<string, string> = { offset: '25', page: '1', extensions: 'base', children: '0' }
    if (target.kind === 'point') Object.assign(params, { location: `${target.longitude.toFixed(6)},${target.latitude.toFixed(6)}`, radius: String(target.radius_m), sortrule: 'distance' })
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
        const data = await this.provider.query('/v3/geocode/regeo', { location: `${target.longitude.toFixed(6)},${target.latitude.toFixed(6)}`, extensions: 'base', radius: '100' }, signal)
        if (typeof data.regeocode?.formatted_address === 'string') address = data.regeocode.formatted_address.slice(0, 500)
        const component = data.regeocode?.addressComponent
        if (typeof component?.city === 'string' && component.city) city = component.city.slice(0, 100)
        else if (['北京市', '上海市', '天津市', '重庆市'].includes(component?.province)) city = component.province
      } catch { signal.throwIfAborted() }
    }
    signal.throwIfAborted()
    const result = validate<MapScreenContext>('MapScreenContext', { id, target, provider: 'amap', coordinate_encoding: 'GCJ-02', created_at: created,
      expires_at: new Date(Date.now() + (groups.every(g => g.status !== 'failed') ? 600_000 : 30_000)).toISOString(), address, city, groups,
      local_projects: evidenceAt(snapshot, target, city,this.boundaryProject(target)), project_revision: snapshot.revision,
      status: groups.every(g => g.status === 'available') ? 'complete' : 'partial', gaps: INVESTIGATION_GAPS,
      metric_note: '场所按高德分类检索；保留至多25个样本，并按所选多边形过滤。' })
    if (this.contexts.size >= 120) this.contexts.delete(this.contexts.keys().next().value!)
    this.contexts.set(key, result)
    await this.save('contexts', id, result)
    return structuredClone(result)
  }

  private async loadContext(id:string,signal:AbortSignal,locate=false):Promise<MapScreenContext>{
    if (!/^MAPCTX-[a-f\d-]{36}$/i.test(id)) throw new Error('CONTEXT_NOT_FOUND')
    let context: MapScreenContext
    try { context = validate<MapScreenContext>('MapScreenContext', JSON.parse(await readFile(join(this.directory, 'contexts', id + '.json'), 'utf8'))) }
    catch { throw new Error('CONTEXT_NOT_FOUND') }
    if (Date.parse(context.expires_at) < Date.now()) throw new Error('CONTEXT_EXPIRED')
    await this.checkTopology(context.target,signal)
    // A persisted snapshot must not outlive a public-source revocation or edit,
    // including when the completed result is already in the analysis cache.
    if ((await this.loadEvidence()).revision !== context.project_revision) throw new Error('CONTEXT_EXPIRED')
    signal.throwIfAborted()
    if(locate&&!context.address){
      await this.locate(context,signal)
      const current=await this.loadEvidence()
      if(current.revision!==context.project_revision)throw new Error('CONTEXT_EXPIRED')
      context.local_projects=evidenceAt(current,context.target,context.city,this.boundaryProject(context.target))
      await this.save('contexts',context.id,context)
    }
    return context
  }

  async savedAnalysis(id:string,profile:MapScreenProfile,signal:AbortSignal):Promise<MapScreenAnalysis|null>{
    const context=await this.loadContext(id,signal)
    return this.restore(context,profile)
  }

  async analyze(id: string, profile: MapScreenProfile, signal: AbortSignal, emit: ResearchSink = () => {}): Promise<MapScreenAnalysis> {
    const context=await this.loadContext(id,signal,true)
    const key = [id, profile, RESEARCH_POLICY, BRIEF_SKILL_VERSION].join(':'), cached = await this.restore(context,profile)
    if (cached?.status === 'completed') { emit({type:'progress',stage:'sources',status:'completed',message:'复用本次研判'}); return structuredClone(cached) }
    if (!context.target.label && !context.address && context.groups.filter(usableMapEvidence).length < 2 && !context.local_projects.some(p => p.sources.some(s => s.visibility === 'public' && s.content_status !== 'metadata_only' && s.untrusted_text))) return { context_id: id, profile, status: 'insufficient_data', assessment: null, model_calls: [], reason: '可用资料较少，请补充项目材料。', created_at: stamp() }
    if (this.activeAnalyses >= 2 || this.analyzing.has(key)) return cached?.assessment?{...structuredClone(cached),status:'partial',reason:'上一轮研究正在结束，请稍后重试评分。'}:{ context_id: id, profile, status: 'unavailable', assessment: null, model_calls: [], reason: '已有初筛解读正在运行，请稍后重试。', created_at: stamp() }
    this.activeAnalyses++; this.analyzing.add(key)
    try {
      const receive:ResearchSink=event=>{
        // Ordinary notifications are synchronous and callers may intentionally
        // ignore their return value. Cancellation must not create a rejected,
        // unobserved Promise that can terminate the Node host.
        if(signal.aborted)return
        if(event.type==='brief'||event.stage==='decision'&&event.status==='running')return (async()=>{
          signal.throwIfAborted()
          if((await this.loadEvidence()).revision!==context.project_revision)throw new Error('CONTEXT_EXPIRED')
          if(event.type==='brief'){
            const result=validate<MapScreenAnalysis>('MapScreenAnalysis',event.result)
            this.refreshConditions(context,result)
            await this.remember(context,profile,result)
          }
          signal.throwIfAborted();await emit(event)
        })()
        return emit(event)
      }
      const analysis = validate<MapScreenAnalysis>('MapScreenAnalysis', await this.analyst(context, profile, signal, receive,cached||undefined))
      signal.throwIfAborted()
      if ((await this.loadEvidence()).revision !== context.project_revision) throw new Error('CONTEXT_EXPIRED')
      signal.throwIfAborted()
      this.refreshConditions(context,analysis)
      if(analysis.status==='completed'&&analysis.decision_support&&analysis.decision_support.status!=='completed'){
        analysis.status='failed';analysis.reason='简报已保留，结构化判断暂未完成，可重试评分。'
      }
      if(!this.currentScores(context,analysis)){
        analysis.refresh_required=true;analysis.status='partial';delete analysis.decision_support
        analysis.reason='原简报已保留，部分依据或采购窗口已失效，请重新取证后研判。'
      }
      await this.remember(context,profile,analysis)
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
      const target=normalizedTarget({kind:'cell',bounds:b,geometry:cell.geometry, radius_m:null,longitude:anchor[0],latitude:anchor[1],label:cell.label,
        label_origin:cell.boundary_source?.startsWith('project:')?'project':'public',
        object_ref:/^(?:osm:(?:way|relation):\d+|project:.+)$/.test(cell.boundary_source||'')?cell.boundary_source:cell.id,boundary_source:cell.boundary_source})
      await this.checkTopology(target,signal)
      const context=validate<MapScreenContext>('MapScreenContext',{
        ...shared!,id:'MAPCTX-'+randomUUID(),target,address:null,
        groups:shared!.groups.map(g=>({...g,reported_count:null,sample:g.sample.filter(p=>targetContains(target,p.longitude,p.latitude))})),
        local_projects:evidenceAt(snapshot,target,shared!.city,cell.boundary_source?.startsWith('project:') ? cell.boundary_source.slice(8) : undefined),
      })
      await this.save('contexts',context.id,context)
      if(this.contexts.size>=120)this.contexts.delete(this.contexts.keys().next().value!)
      this.contexts.set(fingerprint([this.provider.revision(),target]),context)
      cell.context=context
      cell.factors=decisionFactors(context,stamp())
      // Full results stay behind a selected-object read, not duplicated into every
      // scan polygon. The same snapshot supplies both the color and detail view.
      const restored=await this.restore(context,profile)
      if(restored){
        cell.analysis_available=true
        cell.dashboard=restored.decision_support?.dashboard
        cell.factors=restored.assessment?.factors||cell.factors
      }
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
    const groups=context.groups.map(g=>[g.key,g.status,g.reported_count,[...g.sample].sort((a,b)=>a.id.localeCompare(b.id))])
    return fingerprint([RESEARCH_POLICY,BRIEF_SKILL_VERSION,config.DEEPSEEK_MODEL,profile,this.provider.revision(),context.project_revision,t,groups,context.created_at.slice(0,10)])
  }

  private decisionSignature():string{return fingerprint([DECISION_POLICY,DASHBOARD_POLICY,DECISION_THRESHOLDS,config.QWEN_DECISION_MODEL,config.QWEN_DECISION_ENDPOINT,config.decisionEnabled])}

  private async checkTopology(target:MapScreenTarget,signal:AbortSignal){
    if(!target.geometry)return
    const key=fingerprint(target.geometry)
    if(this.validGeometries.has(key))return
    await this.topology(target.geometry,signal)
    signal.throwIfAborted()
    if(this.validGeometries.size>=120)this.validGeometries.delete(this.validGeometries.values().next().value!)
    this.validGeometries.add(key)
  }

  private async remember(context:MapScreenContext,profile:MapScreenProfile,analysis:MapScreenAnalysis){
    await this.save('analyses',context.id+'-'+profile,analysis)
    if(analysis.assessment)await this.save('scope-analyses',this.scopeKey(context,profile),{
      saved_at:stamp(),analysis,decision_signature:this.decisionSignature(),
      groups:context.groups.map(g=>({key:g.key,source_id:g.source_id})),address:context.address,city:context.city,
    })
  }

  private currentScores(context:MapScreenContext,analysis:MapScreenAnalysis):boolean {
    const sources=new Map([...(analysis.research_sources||[]).map(s=>[s.id,s] as const),...context.local_projects.flatMap(p=>p.sources.map(s=>[`${p.project_id}:${s.id}`,{...s,id:`${p.project_id}:${s.id}`}] as const))])
    const name=researchSubject(context),records=analysis.research_records||[],asOf=stamp()
    return (analysis.decision_support?.dashboard?.dimensions||[]).every(dimension=>dimension.value===null||(dimension.evidence_refs.length>0&&dimension.evidence_refs.every(id=>{
      const source=sources.get(id),evidence=analysis.assessment?.dimension_evidence?.find(e=>e.key===dimension.key&&e.source_id===id)
      return !!source&&source.content_status!=='metadata_only'&&dimensionCurrentAt(source,name,{key:dimension.key,record_id:evidence?.record_id},records,asOf)
    })))
  }

  private refreshConditions(context:MapScreenContext,analysis:MapScreenAnalysis):void {
    const factors=decisionFactors(context,stamp()),previous=analysis.assessment?.factors||[]
    const invalidated=previous.some(old=>old.state!=='unknown'&&factors.some(current=>current.key===old.key&&(current.state!==old.state||old.evidence_refs.some(ref=>!current.evidence_refs.includes(ref)))))
    // Canonical conditions are derived again, never filled from a cached verdict.
    // The brief and provider answers remain historical artifacts; local guards
    // apply the current conditions to the route without another model request.
    if(analysis.assessment)analysis.assessment.factors=factors
    if(analysis.decision_support)analysis.decision_support=applyDecisionGuards(analysis.decision_support,factors)
    if(invalidated&&!analysis.reason)analysis.reason='原简报已保留，条件已按当前资料时效重新核对。'
  }

  private async restore(context:MapScreenContext,profile:MapScreenProfile):Promise<MapScreenAnalysis|null>{
    try{
      const saved=JSON.parse(await readFile(join(this.directory,'scope-analyses',this.scopeKey(context,profile)+'.json'),'utf8'))
      const age=Date.now()-Date.parse(saved.saved_at)
      if(!Number.isFinite(age)||age<0||age>=86400000)return null
      const analysis=structuredClone(validate<MapScreenAnalysis>('MapScreenAnalysis',saved.analysis))
      if(!analysis.assessment||analysis.profile!==profile)return null
      if(context.address&&saved.address&&context.address!==saved.address)return null
      if(!context.address&&typeof saved.address==='string'){
        if(saved.city&&context.city!==saved.city){
          const snapshot=await this.loadEvidence()
          if(snapshot.revision!==context.project_revision)return null
          context.local_projects=evidenceAt(snapshot,context.target,saved.city,this.boundaryProject(context.target))
        }
        context.address=saved.address;context.city=saved.city||context.city
      }
      let refreshRequired=!this.currentScores(context,analysis)
      this.refreshConditions(context,analysis)
      const aliases=new Map<string,string>((saved.groups||[]).flatMap((g:{key:string;source_id:string})=>{const now=context.groups.find(n=>n.key===g.key);return now?[[g.source_id,now.source_id]]:[]}))
      for(const claim of [...analysis.assessment.opportunities,...analysis.assessment.cautions,...(analysis.assessment.factors||[])])claim.evidence_refs=claim.evidence_refs.map(id=>aliases.get(id)||id)
      try{
        groundMapAssessment({...analysis.assessment,factors:undefined},context,analysis.research_sources||[],analysis.research_records||[],stamp())
      }catch{
        refreshRequired=true
      }
      if(refreshRequired){
        // A known expiry is not a cache miss. Propagate it through the public
        // research cache too, keeping the same refresh path for scored/partial.
        analysis.refresh_required=true;analysis.status='partial';delete analysis.decision_support
        analysis.reason='此前简报的依据已变化，需重新取证后研判。'
      }
      analysis.reused_from_context_id=analysis.reused_from_context_id||analysis.context_id
      analysis.context_id=context.id
      if(!analysis.refresh_required&&saved.decision_signature!==this.decisionSignature()){
        analysis.status='partial';delete analysis.decision_support;analysis.reason='简报已恢复，判断配置已更新，可重新评分。'
      }
      await this.save('contexts',context.id,context)
      return analysis
    }catch{return null}
  }

  private boundaryProject(target:MapScreenTarget):string|undefined {
    return target.boundary_source?.startsWith('project:')?target.boundary_source.slice(8):undefined
  }

  private async locate(context:MapScreenContext,signal:AbortSignal):Promise<void> {
    try{
      const data=await this.provider.query('/v3/geocode/regeo',{location:`${context.target.longitude.toFixed(6)},${context.target.latitude.toFixed(6)}`,extensions:'base',radius:'100'},signal)
      if(typeof data.regeocode?.formatted_address==='string')context.address=data.regeocode.formatted_address.slice(0,500)
      const component=data.regeocode?.addressComponent
      if(typeof component?.city==='string'&&component.city)context.city=component.city.slice(0,100)
      else if(['北京市','上海市','天津市','重庆市'].includes(component?.province))context.city=component.province
    }catch{signal.throwIfAborted()}
  }

  private async save(folder: string, id: string, value: unknown) {
    await mkdir(join(this.directory, folder), { recursive: true })
    await writeFile(join(this.directory, folder, id + '.json'), JSON.stringify(value, null, 2) + '\n', { mode: 0o600 })
  }
}
