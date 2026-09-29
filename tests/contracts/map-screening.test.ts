import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readFileSync } from 'node:fs'
import { MapScreeningService, normalizeEvidence, normalizedTarget, type ContextAnalyst } from '../../services/map-screening/service'
import { EVIDENCE_GROUPS, classifyCells, assertScreenBounds } from '../../packages/maps/screening-policy'
import { dataCatalog, evidenceAt, mergeProjectSources, targetContains, type ProjectEvidenceSnapshot } from '../../services/map-screening/project-evidence'
import { handoffPublicSources, publicMapContext } from '../../packages/maps/public-context'
import { groundMapAssessment, researchSubject } from '../../services/map-screening/analyst'
import { validate } from '../../packages/contracts/validate'
import { DECISION_THRESHOLDS, mapDecisionInput } from '../../packages/decision/structured-route'
import { FACTOR_FIELDS, decisionFactors } from '../../packages/maps/decision-factors'
import type { ProjectRecord, RunRecord } from '../../apps/host/store'
import type { MapScreenAnalysis, MapScreenContext, MapScreenTarget, MapScreenCell, Source, MapPreliminaryAssessment } from '../../apps/host/generated/contracts'

const directories: string[] = []
afterEach(async () => { vi.useRealTimers();for (const path of directories.splice(0)) await rm(path, {recursive:true,force:true}) })
const point: MapScreenTarget = {kind:'point', longitude:120.16, latitude:30.28, radius_m:800,bounds:null}
const bounds = {west:120.15,east:120.17,south:30.27,north:30.29}
function regions(): MapScreenCell[] {
  // Three surveyed polygons are fixtures, not a production tiling algorithm.
  return [0,1,2].map(i => {
    const x=120.151+i*.006, y=30.272
    const ring=[[x,y],[x+.004,y],[x+.005,y+.01],[x+.001,y+.014],[x,y]]
    return {id:`R-fixture-${i}`,label:`建筑群 ${i}`,bounds:{west:x,east:x+.005,south:y,north:y+.014},
      geometry:{type:'Polygon',coordinates:[ring]},anchor:[x+.002,y+.006],boundary_source:'fixture:survey',
      context:null,metric_value:null,tier:'pending',rank:null}
  })
}
const publicSource: Source = {id:'PUB-REAL',title:'公开政策测试样本',data_class:'public',visibility:'public',synthetic:false,content_status:'full_text',untrusted_text:'市级政策用于背景，地块适用需单独核验。',published_at:'2026-09-28T00:00:00Z',retrieved_at:'2026-09-28T00:00:00Z'}
const privateSource: Source = {id:'INTERNAL-REAL',title:'项目内部材料',data_class:'internal',visibility:'internal',synthetic:false,content_status:'uploaded',untrusted_text:'PRIVATE_CANARY'}
function project(id = 'REAL-P', located = false): ProjectRecord {
  const input = JSON.parse(readFileSync('fixtures/inputs/01_auto.json','utf8'))
  Object.assign(input,{project_id:id, synthetic:false, facts:[],sources:[publicSource,privateSource],context_rules:[]})
  input.scope = {name:'杭州市城市更新',city:'杭州',geometry:null,coordinate_encoding:'WGS84',legal_parcel_confirmed:false}
  if (located) input.scope.map_anchor = {longitude:point.longitude,latitude:point.latitude,coordinate_encoding:'GCJ-02',name:'定位',provider:'amap',selected_at:'2026-09-28T00:00:00Z'}
  return {id,name:'PRIVATE_PROJECT_NAME',owner_id:'local-operator',input,context_version:0,created_at:'2026-09-28T00:00:00Z',updated_at:'2026-09-28T00:00:00Z'}
}
function snapshot(p = project()): ProjectEvidenceSnapshot {return {revision:'v1',projects:[{project:p,sources:p.input.sources,documentCount:1}],syntheticCount:4}}
const response = (count='12') => ({count,pois:Number(count) ? [{id:'POI-1',name:'测试站点',location:'120.16,30.28',type:'地铁出入口'}] : []})
async function service(evidence = snapshot(), failGroup = false) {
  const directory = await mkdtemp(join(tmpdir(),'hzz-screen-test-')); directories.push(directory)
  const query = vi.fn(async (path: string, params: Record<string,string>, signal: AbortSignal) => {
    signal.throwIfAborted()
    if (path.includes('regeo')) return {regeocode:{formatted_address:'浙江省杭州市拱墅区',addressComponent:{city:'杭州市'}}}
    if (failGroup && params.types === EVIDENCE_GROUPS[0].types) throw new Error('FIXTURE_SOURCE_TIMEOUT')
    return response()
  })
  const analyst = vi.fn<ContextAnalyst>(async (ctx,profile) => ({context_id:ctx.id,profile,status:'unavailable',assessment:null,model_calls:[],reason:'fixture no model',created_at:new Date().toISOString()}))
  const loader = vi.fn(async () => evidence)
  const regionResolver=vi.fn(async()=>({cells:regions(),notes:['Fixture polygons']}))
  return {engine:new MapScreeningService({query,revision:()=> 'provider-v1'},directory,analyst,loader,regionResolver,async()=>{}),query,analyst,directory,loader,regionResolver}
}

describe('real project provenance and spatial scale', () => {
  it('reads completed research sources but prefers current input and excludes synthetic sources', () => {
    const p = project()
    const run = {project_id:p.id,status:'completed',snapshot:p.input,decision:{sources:[{...publicSource,title:'old'}, {...publicSource,id:'OLD-RESEARCH'}, {...publicSource,id:'FAKE',synthetic:true}]}} as RunRecord
    expect(mergeProjectSources(p,[run]).map(s=>s.id)).toEqual(['PUB-REAL','OLD-RESEARCH','INTERNAL-REAL'])
    expect(mergeProjectSources(p,[run])[0].title).toBe(publicSource.title)
    expect(mergeProjectSources(p,[{...run,project_id:'OTHER'}])).toHaveLength(2)
  })
  it('city documents are background only; they supply neither parcel facts nor private evidence', () => {
    const p=project();p.input.facts=[{id:'F',kind:'area',value:123,unit:'m2',source_id:'PUB-REAL'}]
    const related=evidenceAt(snapshot(p),point,'杭州市')
    expect(related[0].relation).toBe('city_background')
    expect(related[0].facts).toEqual([])
    expect(related[0].sources).toHaveLength(1)
    expect(evidenceAt(snapshot(p),point,'苏州市')).toEqual([])
    expect(evidenceAt(snapshot(p),point,null)).toEqual([])
  })
  it('joins actual facts only to in-scope located projects and never promotes an outside project to city scope', () => {
    const p=project('REAL-L',true);p.input.facts=[{id:'F',kind:'area',value:123,unit:'m2',source_id:'PUB-REAL'},{id:'I',kind:'note',value:'PRIVATE_CANARY',unit:null,source_id:'INTERNAL-REAL'}]
    const related=evidenceAt(snapshot(p),point,'杭州市')
    expect(related[0].fact_count).toBe(2)
    expect(related[0].relation).toBe('within_scope')
    expect(related[0].sources.find(s=>s.visibility==='internal')?.untrusted_text).toBeUndefined()
    p.input.scope.map_anchor!.longitude=120.3
    expect(evidenceAt(snapshot(p),point,'杭州市')).toEqual([])
  })
  it('keeps project totals distinct from located counts and test fixtures', () => {
    const catalog=dataCatalog(snapshot())
    expect(catalog.real_project_count).toBe(1)
    expect(catalog.unlocated_project_count).toBe(1)
    expect(catalog.synthetic_project_count).toBe(4)
    expect(catalog.projects[0].public_source_count).toBe(1)
  })
  it('uses the actual polygon and excludes holes and exterior points', () => {
    const cell=regions()[0], target:MapScreenTarget={kind:'cell',longitude:cell.anchor![0],latitude:cell.anchor![1],radius_m:null,bounds:cell.bounds,geometry:cell.geometry}
    expect(targetContains(target,cell.anchor![0],cell.anchor![1])).toBe(true)
    expect(targetContains(target,cell.bounds.east,cell.bounds.south)).toBe(false)
    target.geometry!.coordinates.push([[120.152,30.275],[120.153,30.275],[120.153,30.276],[120.152,30.276],[120.152,30.275]])
    expect(targetContains(target,120.1525,30.2755)).toBe(false)
  })
})

describe('evidence acquisition and cache lifecycle', () => {
  it('uses provider total instead of sample length; invalid, capped and missing are separate from zero', () => {
    expect(normalizeEvidence(EVIDENCE_GROUPS[0],response('52'),'s').reported_count).toBe(52)
    expect(normalizeEvidence(EVIDENCE_GROUPS[0],response('0'),'s').status).toBe('available')
    expect(normalizeEvidence(EVIDENCE_GROUPS[0],response('600'),'s').status).toBe('capped')
    for (const raw of [{count:8,pois:[]},{count:-1,pois:[]},{count:0,pois:response().pois},{count:'no',pois:[]}]) expect(()=>normalizeEvidence(EVIDENCE_GROUPS[0],raw,'s')).toThrow()
  })
  it('rejects overlarge ranges and inconsistent point/cell targets', () => {
    expect(()=>assertScreenBounds({...bounds,east:121})).toThrow()
    expect(()=>normalizedTarget({...point,bounds})).toThrow()
    expect(()=>normalizedTarget({...point,kind:'cell',radius_m:null,bounds,longitude:130})).toThrow()
  })
  it('preserves valid precision across normalization and JSON round trips, including narrow polygons',()=>{
    for(const width of [.0049988,.0000004]){
      const west=120.1500006,south=30.2700006,east=west+width,north=south+width
      const ring=[[west,south],[east,south],[east,north],[west,north],[west,south]]
      const target={kind:'cell',longitude:(west+east)/2,latitude:(south+north)/2,radius_m:null,bounds:{west,east,south,north},geometry:{type:'Polygon',coordinates:[ring]}}
      const first=normalizedTarget(target)
      expect(normalizedTarget(JSON.parse(JSON.stringify(first)))).toEqual(first)
      expect(first.geometry?.coordinates).toEqual([ring])
    }
  })
  it('maps complete provider facts and project evidence without calling the model', async () => {
    const {engine,query,analyst}=await service()
    const ctx=await engine.context(point,new AbortController().signal)
    expect(ctx.groups).toHaveLength(4);expect(ctx.local_projects[0].relation).toBe('city_background')
    expect(query).toHaveBeenCalledTimes(5);expect(analyst).not.toHaveBeenCalled()
    expect(validate('MapScreenContext',ctx)).toEqual(ctx)
    const cached=await engine.context(point,new AbortController().signal)
    expect(cached.id).toBe(ctx.id);expect(query).toHaveBeenCalledTimes(5)
  })
  it('project data updates reuse map facts but produce a new evidence snapshot', async () => {
    const {engine,loader,query}=await service()
    const ctx=await engine.context(point,new AbortController().signal)
    loader.mockResolvedValue({...snapshot(project('NEW',true)),revision:'v2'})
    const next=await engine.context(point,new AbortController().signal)
    expect(next.id).not.toBe(ctx.id);expect(next.project_revision).toBe('v2')
    expect(next.local_projects[0].relation).toBe('within_scope');expect(query).toHaveBeenCalledTimes(5)
  })
  it('rejects a saved context before model use when public source permission changes',async()=>{
    const {engine,loader,analyst}=await service();const signal=new AbortController().signal
    const ctx=await engine.context(point,signal)
    loader.mockResolvedValue({...snapshot(),revision:'revoked-public-source'})
    await expect(engine.analyze(ctx.id,'balanced',signal)).rejects.toThrow('CONTEXT_EXPIRED')
    expect(analyst).not.toHaveBeenCalled()
  })
  it('does not publish or persist a result whose source revision changed during analysis',async()=>{
    const {engine,loader,analyst,directory}=await service();const signal=new AbortController().signal
    const ctx=await engine.context(point,signal)
    analyst.mockImplementation(async(c,profile)=>{
      loader.mockResolvedValue({...snapshot(),revision:'changed-during-analysis'})
      return {context_id:c.id,profile,status:'completed' as any,assessment:{summary:'测试结果',opportunities:[],cautions:[],unknowns:[],next_steps:[]},model_calls:[],reason:null,created_at:new Date().toISOString()} as any
    })
    await expect(engine.analyze(ctx.id,'balanced',signal)).rejects.toThrow('CONTEXT_EXPIRED')
    await expect(readFile(join(directory,'analyses',ctx.id+'-balanced.json'))).rejects.toThrow()
  })
  it('partial failure preserves other facts and never colors unavailable counts as zero', async () => {
    const {engine}=await service(snapshot(),true)
    const ctx=await engine.context(point,new AbortController().signal)
    expect(ctx.status).toBe('partial');expect(ctx.groups[0].reported_count).toBeNull()
    const cells=regions();cells[0].context=ctx
    expect(classifyCells(cells,'overall')[0].tier).toBe('incomplete')
    expect(classifyCells(cells,'demand')[0].metric_value).toBeNull()
  })
  it('raw counts and city background cannot turn objects into investment recommendations', async () => {
    const {engine}=await service();const ctx=await engine.context(point,new AbortController().signal)
    const cells=regions();cells[0].context=ctx
    const first=classifyCells(cells,'overall')[0]
    cells[1].context=structuredClone(ctx);cells[1].context.groups[0].reported_count=900
    expect(classifyCells(cells,'overall')[0].tier).toBe(first.tier)
    expect(first.metric_value).toBeNull()
    expect(classifyCells(cells,'implementation')[0].metric_value).toBeNull()
    expect(classifyCells(cells,'implementation')[0].tier).toBe('incomplete')
  })
  it('cancellation prevents subsequent cells and never emits a completed result', async () => {
    const {engine,analyst}=await service();const controller=new AbortController(),events:any[]=[]
    await expect(engine.screen(bounds,'balanced','overall',controller.signal,e=>{events.push(e);if ((e as any).type==='cell') controller.abort()})).rejects.toThrow()
    expect(events.map(e=>e.type)).toEqual(['progress','start','cell']);expect(analyst).not.toHaveBeenCalled()
  })
  it('completed screens freeze one project snapshot, retain source references and persist results', async () => {
    const {engine,loader,directory,query,analyst}=await service();const events:any[]=[]
    const result=await engine.screen(bounds,'balanced','overall',new AbortController().signal,e=>events.push(e))
    expect(result.cells).toHaveLength(3);expect(query).toHaveBeenCalledTimes(5);expect(analyst).not.toHaveBeenCalled();expect(loader).toHaveBeenCalledTimes(1)
    expect(events.filter(e=>e.type==='cell')).toHaveLength(3)
    expect(result.comparison_count).toBe(0)
    expect(JSON.parse(await readFile(join(directory,'scans',result.id+'.json'),'utf8')).id).toBe(result.id)
  })
  it('resolves an unnamed selected cell at its own anchor without copying the viewport address',async()=>{
    const {engine,query}=await service();const signal=new AbortController().signal
    query.mockImplementation(async(path,params)=>path.includes('regeo')?{regeocode:{formatted_address:Number(params.location.split(',')[0])<120.156?'杭州市甲街区':'杭州市乙街区',addressComponent:{city:'杭州市'}}}:response())
    const result=await engine.screen(bounds,'balanced','overall',signal,()=>{})
    expect(result.cells.every(c=>c.context?.address===null)).toBe(true)
    expect(query).toHaveBeenCalledTimes(5)
    const one=await engine.context(result.cells[0].context!.target,signal),two=await engine.context(result.cells[1].context!.target,signal)
    expect(one.address).toBe('杭州市甲街区');expect(two.address).toBe('杭州市乙街区')
    expect(researchSubject(one)).toBe(one.address);expect(researchSubject(two)).toBe(two.address)
    expect(one.target.object_ref).not.toBe(two.target.object_ref)
    expect(query).toHaveBeenCalledTimes(7)
  })
  it('model analysis is explicit and rejects unissued snapshot paths', async () => {
    const {engine,analyst}=await service();const signal=new AbortController().signal
    await expect(engine.analyze('../secrets','balanced',signal)).rejects.toThrow('CONTEXT_NOT_FOUND')
    const ctx=await engine.context(point,signal);await engine.analyze(ctx.id,'balanced',signal)
    expect(analyst).toHaveBeenCalledTimes(1)
  })
})

describe('public model evidence boundary', () => {
  it('strips private facts, text, rules and names from model and new-project handoffs', async () => {
    const p=project('REAL-L',true);p.input.facts=[{id:'I',kind:'note',value:'PRIVATE_CANARY',unit:null,source_id:'INTERNAL-REAL'}]
    const {engine}=await service(snapshot(p));const ctx=await engine.context(point,new AbortController().signal)
    expect(JSON.stringify(ctx)).toContain('PRIVATE_CANARY')
    const payload=JSON.stringify(publicMapContext(ctx))
    expect(payload).not.toContain('PRIVATE_CANARY');expect(payload).not.toContain('PRIVATE_PROJECT_NAME')
    expect(payload).toContain('PUB-REAL')
  })
  it('does not send a project boundary display name through the target label',async()=>{
    const p=project('REAL-L',true)
    const {engine}=await service(snapshot(p));const ctx=await engine.context(point,new AbortController().signal)
    ctx.target.label=p.name
    expect(JSON.stringify(publicMapContext(ctx))).not.toContain('PRIVATE_PROJECT_NAME')
    expect(researchSubject(ctx)).toBe(ctx.address)
    expect(JSON.stringify(mapDecisionInput(ctx,'建筑服务'))).not.toContain('PRIVATE_PROJECT_NAME')
    p.name='PRIVATE_PROJECT_NAME_'+ '机密'.repeat(30)
    ctx.local_projects[0].name=p.name;ctx.target.label=p.name.slice(0,40)
    expect(publicMapContext(ctx).target.label).toBeUndefined()
    ctx.target.label_origin='project';ctx.local_projects=[]
    expect(JSON.stringify(publicMapContext(ctx))).not.toContain('PRIVATE_PROJECT_NAME')
    expect(researchSubject(ctx)).toBe(ctx.address)
  })
  it('rejects fabricated, internal and metadata-only citations while accepting scoped public sources', async () => {
    const {engine}=await service();const ctx=await engine.context(point,new AbortController().signal)
    const assessment: MapPreliminaryAssessment={summary:'可研究存量利用方向，适用性待核实。',opportunities:[{text:'结合城市背景核查更新实施条件。',evidence_refs:['REAL-P:PUB-REAL']}],cautions:[{text:'先核查同类配套的实际使用。',evidence_refs:['activity']}],unknowns:[],next_steps:['补查权属与工程条件']}
    expect(groundMapAssessment(assessment,ctx).cautions[0].evidence_refs[0]).toBe(ctx.groups[1].source_id)
    expect(groundMapAssessment({...assessment,opportunities:[{text:'以城市资料定位调查方向。',evidence_refs:['project_1']}]},ctx).opportunities[0].evidence_refs[0]).toBe('REAL-P:PUB-REAL')
    ctx.groups[1].status='capped'
    expect(groundMapAssessment(assessment,ctx).cautions[0].evidence_refs[0]).toBe(ctx.groups[1].source_id)
    ctx.groups[1].status='failed'
    expect(()=>groundMapAssessment(assessment,ctx)).toThrow('MAP_ASSESSMENT_UNGROUNDED_REFERENCE')
    ctx.groups[1].status='available'
    for (const ref of ['INVENTED','REAL-P:INTERNAL-REAL']) expect(()=>groundMapAssessment({...assessment,opportunities:[{text:'claim',evidence_refs:[ref]}]},ctx)).toThrow()
    ctx.local_projects[0].sources[0].content_status='metadata_only'
    expect(()=>groundMapAssessment(assessment,ctx)).toThrow()
  })
})


describe('persisted object research', () => {
  const brief=(ctx:MapScreenContext,profile:MapScreenAnalysis['profile'],status:MapScreenAnalysis['status']='partial'):MapScreenAnalysis=>({context_id:ctx.id,profile,status,created_at:new Date().toISOString(),reason:null,model_calls:[],assessment:{summary:'调查单栋设备维护。',opportunities:[{text:'按原文调查维护范围。',evidence_refs:['S']}],cautions:[],unknowns:[],next_steps:['核对采购窗口。']},research_sources:[{...publicSource,id:'S'}],research_records:[]})
  it.each([true,false])('revalidates expired canonical facts even when every model score is null: positive=%s',async(positive)=>{
    vi.useFakeTimers();vi.setSystemTime(new Date('2026-09-28T08:00:00Z'))
    const p=project('FACT-CACHE',true)
    p.input.sources=[{...publicSource,expires_at:'2026-09-28T08:01:00Z'}]
    p.input.facts=Object.values(FACTOR_FIELDS).flat().map((key,i)=>({id:`F-${i}`,kind:`screening.${key}`,value:key==='user_need_verified'?positive:true,unit:null,source_id:publicSource.id,object_ref:'amap:FACT-TARGET',locator:`fixture[${i}]`,observed_at:'2026-09-28T07:00:00Z'}))
    const {engine,analyst,query,loader,directory}=await service(snapshot(p));const signal=new AbortController().signal
    const target={...point,label:'甲办公楼',label_origin:'public' as const,object_ref:'amap:FACT-TARGET'}
    const ctx=await engine.context(target,signal)
    analyst.mockImplementation(async(c,profile)=>({...brief(c,profile,'completed'),decision_support:{status:'completed',provider:'qwen_systemone',model:'decision-model-preview',policy_version:'test',input_hash:'test',created_at:new Date().toISOString(),request_id:'TEST',duration_ms:0,input_tokens:0,action:null,priority:null,next_step:'',guard_reasons:[],input_source_ids:[],thresholds:DECISION_THRESHOLDS,error_code:null,
      answers:{next_action:{choice:'compare',confidence:1,probabilities:{investigate:0,resolve_blocker:0,compare:1,review:0}},priority_dimension:{choice:'demand',confidence:1,probabilities:{implementation:0,adaptation:0,demand:1,operations:0,resources:0,access:0}},evidence_sufficient:1},
      dashboard:{policy_version:'test',purpose:'条件缓存检查',model:'decision-model-preview',request_id:'TEST',status:'partial',dimensions:['demand','supply','adaptation','implementation','operations','resources'].map(key=>({key,value:null,confidence:null,basis:'',evidence_refs:[]}))}}} as MapScreenAnalysis))
    const first=await engine.analyze(ctx.id,'balanced',signal)
    expect(first.assessment!.factors!.find(f=>f.key==='demand')!.state).toBe(positive?'supported':'blocked')
    vi.setSystemTime(new Date('2026-09-28T08:00:59Z'))
    expect((await engine.savedAnalysis(ctx.id,'balanced',signal))?.status).toBe('completed')
    const check=(result:MapScreenAnalysis|null,current=ctx)=>{
      expect(result?.assessment?.factors?.find(f=>f.key==='demand')?.state).toBe('unknown')
      expect(classifyCells([{id:'C',context:current,factors:result!.assessment!.factors,dashboard:result!.decision_support?.dashboard} as MapScreenCell],'demand')[0].tier).toBe('incomplete')
      expect(result?.decision_support?.action).not.toBe('compare')
    }
    for(const now of ['2026-09-28T08:01:00Z','2026-09-28T08:01:01Z','2026-09-28T08:02:00Z']){
      vi.setSystemTime(new Date(now));check(await engine.savedAnalysis(ctx.id,'balanced',signal))
    }
    expect(decisionFactors({...ctx,created_at:new Date().toISOString()}).find(f=>f.key==='demand')?.state).toBe('unknown')
    check(await engine.analyze(ctx.id,'balanced',signal))
    vi.setSystemTime(new Date('2026-09-28T08:11:00Z'))
    const fresh=await engine.context(target,signal)
    const recovered=new MapScreeningService({query,revision:()=> 'provider-v1'},directory,analyst,loader)
    check(await recovered.savedAnalysis(fresh.id,'balanced',signal),fresh)
  })
  it('checks canonical facts at publication time when the source expires during analysis',async()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date('2026-09-28T08:00:00Z'))
    const p=project('FACT-MIDRUN',true)
    p.input.sources=[{...publicSource,expires_at:'2026-09-28T08:01:00Z'}]
    p.input.facts=FACTOR_FIELDS.demand.map((key,i)=>({id:`F-${i}`,kind:`screening.${key}`,value:true,unit:null,source_id:publicSource.id,object_ref:'amap:MIDRUN',locator:`fixture[${i}]`,observed_at:'2026-09-28T07:00:00Z'}))
    const {engine,analyst}=await service(snapshot(p));const signal=new AbortController().signal
    const ctx=await engine.context({...point,object_ref:'amap:MIDRUN'},signal)
    analyst.mockImplementation(async(c,profile)=>{vi.setSystemTime(new Date('2026-09-28T08:02:00Z'));return brief(c,profile,'completed')})
    expect((await engine.analyze(ctx.id,'balanced',signal)).assessment?.factors?.find(f=>f.key==='demand')?.state).toBe('unknown')
  })
  it('revalidates conditions while rescanning instead of refilling them from the former study',async()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date('2026-09-28T08:00:00Z'))
    const p=project('FACT-SCAN',true)
    p.input.sources=[{...publicSource,expires_at:'2026-09-28T08:01:00Z'}]
    p.input.facts=FACTOR_FIELDS.demand.map((key,i)=>({id:`F-${i}`,kind:`screening.${key}`,value:true,unit:null,source_id:publicSource.id,object_ref:'osm:way:100',locator:`fixture[${i}]`,observed_at:'2026-09-28T07:00:00Z'}))
    const {engine,analyst,regionResolver}=await service(snapshot(p));const signal=new AbortController().signal
    regionResolver.mockImplementation(async()=>({cells:[{...regions()[1],label:'甲办公楼',boundary_source:'osm:way:100'}],notes:[]}))
    const before=await engine.screen(bounds,'balanced','demand',signal,()=>{})
    expect(before.cells[0].tier).toBe('strong')
    analyst.mockImplementation(async(c,profile)=>brief(c,profile,'completed'))
    await engine.analyze(before.cells[0].context!.id,'balanced',signal)
    vi.setSystemTime(new Date('2026-09-28T08:02:00Z'))
    const after=await engine.screen(bounds,'balanced','demand',signal,()=>{})
    expect(after.cells[0].factors?.find(f=>f.key==='demand')?.state).toBe('unknown')
    expect(after.cells[0].tier).toBe('incomplete')
    expect(analyst).toHaveBeenCalledTimes(1)
  })
  it('persists a validated brief through cancellation and passes it into the next scoring attempt',async()=>{
    const {engine,analyst,directory,query,loader}=await service();const stop=new AbortController()
    const ctx=await engine.context(point,stop.signal)
    analyst.mockImplementationOnce(async(c,p,signal,emit)=>{await emit?.({type:'brief',result:brief(c,p)});signal.throwIfAborted();throw Error('Scoring must not start after cancellation')})
    await expect(engine.analyze(ctx.id,'balanced',stop.signal,e=>{if(e.type==='brief')stop.abort()})).rejects.toThrow()
    const nextAnalyst=vi.fn<ContextAnalyst>(async(c,p,_signal,_emit,previous)=>{expect(previous?.assessment?.summary).toBe('调查单栋设备维护。');return brief(c,p,'completed')})
    const recovered=new MapScreeningService({query,revision:()=> 'provider-v1'},directory,nextAnalyst,loader)
    const saved=await recovered.savedAnalysis(ctx.id,'balanced',new AbortController().signal)
    expect(saved?.status).toBe('partial');expect(saved?.research_sources?.[0].id).toBe('S')
    await recovered.analyze(ctx.id,'balanced',new AbortController().signal)
    await recovered.analyze(ctx.id,'balanced',new AbortController().signal)
    expect(nextAnalyst).toHaveBeenCalledTimes(1)
  })
  it('restores the complete persisted study after a restart and rescan without another analysis call',async()=>{
    const {engine,analyst,directory,query,loader}=await service();const signal=new AbortController().signal
    analyst.mockImplementation(async(c,p)=>brief(c,p,'completed'))
    const first=await engine.screen(bounds,'balanced','overall',signal,()=>{})
    await engine.analyze(first.cells[0].context!.id,'balanced',signal)
    const resumedAnalyst=vi.fn<ContextAnalyst>(async()=>{throw Error('A valid saved study must not invoke the model')})
    const recovered=new MapScreeningService({query,revision:()=> 'provider-v1'},directory,resumedAnalyst,loader,async()=>({cells:regions(),notes:[]}),async()=>{})
    const next=await recovered.screen(bounds,'balanced','overall',signal,()=>{})
    expect(next.cells[0].analysis_available).toBe(true)
    const study=await recovered.savedAnalysis(next.cells[0].context!.id,'balanced',signal)
    expect(study?.assessment?.summary).toBe('调查单栋设备维护。')
    expect(study?.research_sources?.[0].id).toBe('S')
    expect(study?.context_id).toBe(next.cells[0].context!.id)
    expect(study?.reused_from_context_id).toBe(first.cells[0].context!.id)
    await recovered.analyze(next.cells[0].context!.id,'balanced',signal)
    expect(resumedAnalyst).not.toHaveBeenCalled()
  })
  it('uses the same expiry gate for saved reads and repeated analyze calls',async()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date('2026-09-28T08:00:00Z'))
    const {engine,analyst}=await service();const signal=new AbortController().signal
    analyst.mockImplementationOnce(async(c,p)=>({...brief(c,p,'completed'),research_sources:[{...publicSource,id:'S',expires_at:'2026-09-28T08:01:00Z'}],decision_support:{status:'completed',provider:'qwen_systemone',model:'decision-model-preview',answers:null,policy_version:'test',input_hash:'test',created_at:new Date().toISOString(),request_id:'TEST',duration_ms:0,input_tokens:0,action:null,priority:null,next_step:'',guard_reasons:[],input_source_ids:['S'],thresholds:DECISION_THRESHOLDS,error_code:null,dashboard:{policy_version:'test',purpose:'测试',model:'decision-model-preview',request_id:'TEST',status:'partial',dimensions:[{key:'demand',value:4.5,confidence:.9,evidence_refs:['S'],basis:'测试'}]}}}))
    const context=await engine.context(point,signal)
    await engine.analyze(context.id,'balanced',signal)
    expect((await engine.savedAnalysis(context.id,'balanced',signal))?.status).toBe('completed')
    vi.setSystemTime(new Date('2026-09-28T08:02:00Z'))
    expect(await engine.savedAnalysis(context.id,'balanced',signal)).toMatchObject({status:'partial',refresh_required:true})
    analyst.mockImplementation(async(c,p)=>brief(c,p,'partial'))
    const updated=await engine.analyze(context.id,'balanced',signal)
    expect(updated.decision_support?.dashboard).toBeUndefined()
    expect(analyst).toHaveBeenCalledTimes(2)
  })
  it('expires a procurement score at its record deadline on read, rescan and repeated analysis',async()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date('2026-09-28T08:00:00Z'))
    const {engine,analyst,regionResolver,directory,query,loader}=await service();const signal=new AbortController().signal
    regionResolver.mockImplementation(async()=>({cells:regions().map((cell,i)=>({...cell,label:`科技楼${i}`})),notes:[]}))
    const first=await engine.screen(bounds,'balanced','implementation',signal,()=>{})
    const context=first.cells[0].context!
    analyst.mockImplementationOnce(async(c,p)=>{
      const quote=`${c.target.label}本期采购设备维护服务。`
      return {...brief(c,p,'completed'),assessment:{...brief(c,p).assessment!,dimension_evidence:[{key:'implementation',source_id:'S',quote,basis:'当前采购窗口。'}]},
        research_sources:[{...publicSource,id:'S',title:`${c.target.label}采购公告`,url:'https://example.gov.cn/notice',published_at:'2026-09-28T00:00:00Z',untrusted_text:quote}],
        research_records:[{id:'R',source_id:'S',adapter:'procurement',subject:c.target.label!,scope:'object',period:'2026-09-28',fields:[{key:'deadline',label:'响应截止',value:'2026年9月28日16点01分00秒',unit:'',raw:'2026年9月28日16点01分00秒',locator:'test'}]}],
        decision_support:{status:'completed',provider:'qwen_systemone',model:'decision-model-preview',answers:null,policy_version:'test',input_hash:'test',created_at:new Date().toISOString(),request_id:'TEST',duration_ms:0,input_tokens:0,action:null,priority:null,next_step:'',guard_reasons:[],input_source_ids:['S'],thresholds:DECISION_THRESHOLDS,error_code:null,
          dashboard:{policy_version:'test',purpose:'测试',model:'decision-model-preview',request_id:'TEST',status:'partial',dimensions:[{key:'implementation',value:4.5,confidence:.9,evidence_refs:['S'],basis:'当前采购窗口。'}]}}}
    })
    await engine.analyze(context.id,'balanced',signal)
    expect((await engine.savedAnalysis(context.id,'balanced',signal))?.decision_support?.dashboard?.dimensions[0].value).toBe(4.5)
    vi.setSystemTime(new Date('2026-09-28T08:00:59Z'))
    expect((await engine.savedAnalysis(context.id,'balanced',signal))?.status).toBe('completed')
    for(const now of ['2026-09-28T08:01:00Z','2026-09-28T08:01:01Z']){
      vi.setSystemTime(new Date(now));expect(await engine.savedAnalysis(context.id,'balanced',signal)).toMatchObject({status:'partial',refresh_required:true})
    }
    vi.setSystemTime(new Date('2026-09-28T08:02:00Z'))
    expect(await engine.savedAnalysis(context.id,'balanced',signal)).toMatchObject({status:'partial',refresh_required:true})
    const rescanned=await engine.screen(bounds,'balanced','implementation',signal,()=>{})
    expect(rescanned.cells[0].dashboard).toBeUndefined()
    expect(rescanned.cells[0].tier).not.toBe('strong')
    vi.setSystemTime(new Date('2026-09-28T08:11:00Z'))
    const fresh=await engine.context(context.target,signal)
    expect(fresh.id).not.toBe(context.id)
    const recovered=new MapScreeningService({query,revision:()=> 'provider-v1'},directory,analyst,loader,regionResolver,async()=>{})
    expect(await recovered.savedAnalysis(fresh.id,'balanced',signal)).toMatchObject({status:'partial',refresh_required:true})
    analyst.mockImplementation(async(c,p)=>brief(c,p,'partial'))
    expect((await recovered.analyze(fresh.id,'balanced',signal)).decision_support?.dashboard).toBeUndefined()
    expect(analyst).toHaveBeenCalledTimes(2)
  })
  it('does not publish a fresh score whose source expires while the scorer is running',async()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date('2026-09-28T08:00:00Z'))
    const {engine,analyst}=await service();const signal=new AbortController().signal
    const context=await engine.context(point,signal)
    analyst.mockImplementationOnce(async(c,p)=>{
      vi.setSystemTime(new Date('2026-09-28T08:02:00Z'))
      return {...brief(c,p,'completed'),research_sources:[{...publicSource,id:'S',expires_at:'2026-09-28T08:01:00Z'}],decision_support:{status:'completed',provider:'qwen_systemone',model:'decision-model-preview',answers:null,policy_version:'test',input_hash:'test',created_at:new Date().toISOString(),request_id:'TEST',duration_ms:0,input_tokens:0,action:null,priority:null,next_step:'',guard_reasons:[],input_source_ids:['S'],thresholds:DECISION_THRESHOLDS,error_code:null,dashboard:{policy_version:'test',purpose:'测试',model:'decision-model-preview',request_id:'TEST',status:'partial',dimensions:[{key:'demand',value:4.5,confidence:.9,evidence_refs:['S'],basis:'测试'}]}}}
    })
    const result=await engine.analyze(context.id,'balanced',signal)
    expect(result.status).toBe('partial')
    expect(result.decision_support).toBeUndefined()
    expect(result.reason).toContain('已失效')
    expect(result.refresh_required).toBe(true)
    expect((await engine.savedAnalysis(context.id,'balanced',signal))?.refresh_required).toBe(true)
  })
  it('restores color only for the same scope/profile/revision without another model call', async () => {
    const {engine,analyst,loader}=await service();const signal=new AbortController().signal
    const scanned=await engine.screen(bounds,'balanced','demand',signal,()=>{})
    const ctx=scanned.cells[0].context!
    analyst.mockImplementation(async(c,profile)=>({context_id:c.id,profile,status:'completed' as any,assessment:{summary:'研究单栋修缮服务。',opportunities:[],cautions:[],unknowns:[],next_steps:['核对采购窗口。']},model_calls:[],reason:null,created_at:new Date().toISOString(),research_sources:[{...publicSource,id:'S'}],decision_support:{status:'completed',provider:'qwen_systemone',model:'decision-model-preview',answers:null,policy_version:'test',input_hash:'test',created_at:new Date().toISOString(),request_id:null,duration_ms:0,input_tokens:null,action:null,priority:null,next_step:'',guard_reasons:[],input_source_ids:[],thresholds:DECISION_THRESHOLDS,error_code:null,dashboard:{policy_version:'opportunity-fit-v2',purpose:'测试工程',model:'decision-model-preview',request_id:'FIXTURE',status:'partial',dimensions:[{key:'demand',value:4,confidence:.9,evidence_refs:['S'],basis:'测试证据'}]}}} as any))
    await engine.analyze(ctx.id,'balanced',signal)
    const same=await engine.screen(bounds,'balanced','demand',signal,()=>{})
    expect(same.cells[0].tier).toBe('strong');expect(same.cells[1].dashboard).toBeUndefined()
    const changed=await engine.screen(bounds,'commercial','demand',signal,()=>{})
    expect(changed.cells[0].dashboard).toBeUndefined()
    loader.mockResolvedValue({...snapshot(),revision:'changed-public-input'})
    const revision=await engine.screen(bounds,'balanced','demand',signal,()=>{})
    expect(revision.cells[0].dashboard).toBeUndefined();expect(analyst).toHaveBeenCalledTimes(1)
  })
  it('hands off actual public originals while removing internal and synthetic additions',async()=>{
    const {engine}=await service();const ctx=await engine.context(point,new AbortController().signal)
    ctx.research_sources=[{...publicSource,id:'LIVE',url:'https://example.gov.cn/original'},privateSource,{...publicSource,id:'SYN',synthetic:true}]
    ctx.research_records=[{id:'R1',adapter:'procurement',subject:'PRIVATE_RECORD',scope:'object',period:'',source_id:'INTERNAL-REAL',fields:[]}]
    const clean=publicMapContext(ctx);expect(clean.research_records).toEqual([])
    const out=handoffPublicSources(ctx)
    expect(out.find(s=>s.id==='LIVE')?.url).toBe('https://example.gov.cn/original')
    expect(JSON.stringify(out)).not.toMatch(/PRIVATE_CANARY|PRIVATE_RECORD|INTERNAL-REAL|"SYN"/)
  })
})


describe('partial scan fault isolation',()=>{
  it('one invalid optional cell does not erase validated neighbours',async()=>{
    const {query,analyst,directory,loader}=await service()
    let checked=0
    const engine=new MapScreeningService({query,revision:()=> 'fixture-v1'},directory,analyst,loader,async()=>({cells:regions(),notes:[]}),async()=>{if(++checked===2)throw Error('INVALID_REGION_TOPOLOGY')})
    const result=await engine.screen(bounds,'balanced','overall',new AbortController().signal,()=>{})
    expect(result.status).toBe('partial');expect(result.cells.filter(c=>c.context)).toHaveLength(2)
    expect(result.cells[1].tier).toBe('incomplete');expect(result.notes.join()).toContain('边界无效')
  })
  it('an explicit study rectangle reaches the region resolver without model invocation',async()=>{
    const {engine,regionResolver,analyst}=await service()
    const geometry={type:'Polygon' as const,coordinates:[[[bounds.west,bounds.south],[bounds.east,bounds.south],[bounds.east,bounds.north],[bounds.west,bounds.north],[bounds.west,bounds.south]]]}
    await engine.screen(bounds,'balanced','overall',new AbortController().signal,()=>{},geometry)
    expect((regionResolver.mock.calls[0] as unknown[])[3]).toEqual(geometry);expect(analyst).not.toHaveBeenCalled()
  })
})
