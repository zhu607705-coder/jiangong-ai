import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readFileSync } from 'node:fs'
import { MapScreeningService, normalizeEvidence, normalizedTarget } from '../../services/map-screening/service'
import { EVIDENCE_GROUPS, classifyCells, assertScreenBounds } from '../../packages/maps/screening-policy'
import { dataCatalog, evidenceAt, mergeProjectSources, targetContains, type ProjectEvidenceSnapshot } from '../../services/map-screening/project-evidence'
import { publicMapContext } from '../../packages/maps/public-context'
import { groundMapAssessment } from '../../services/map-screening/analyst'
import { validate } from '../../packages/contracts/validate'
import type { ProjectRecord, RunRecord } from '../../apps/host/store'
import type { MapScreenContext, MapScreenTarget, MapScreenCell, Source, MapPreliminaryAssessment } from '../../apps/host/generated/contracts'

const directories: string[] = []
afterEach(async () => { for (const path of directories.splice(0)) await rm(path, {recursive:true,force:true}) })
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
const publicSource: Source = {id:'PUB-REAL',title:'公开政策测试样本',data_class:'public',visibility:'public',synthetic:false,content_status:'full_text',untrusted_text:'市级政策用于背景，地块适用需单独核验。',retrieved_at:'2026-09-28T00:00:00Z'}
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
  const analyst = vi.fn(async (ctx: MapScreenContext, profile: 'balanced'|'commercial'|'enterprise') => ({context_id:ctx.id,profile,status:'unavailable' as const,assessment:null,model_calls:[],reason:'fixture no model',created_at:new Date().toISOString()}))
  const loader = vi.fn(async () => evidence)
  return {engine:new MapScreeningService({query,revision:()=> 'provider-v1'},directory,analyst,loader,async()=>({cells:regions(),notes:['Fixture polygons']})),query,analyst,directory,loader}
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
    expect(events.map(e=>e.type)).toEqual(['start','cell']);expect(analyst).not.toHaveBeenCalled()
  })
  it('completed screens freeze one project snapshot, retain source references and persist results', async () => {
    const {engine,loader,directory,query,analyst}=await service();const events:any[]=[]
    const result=await engine.screen(bounds,'balanced','overall',new AbortController().signal,e=>events.push(e))
    expect(result.cells).toHaveLength(3);expect(query).toHaveBeenCalledTimes(5);expect(analyst).not.toHaveBeenCalled();expect(loader).toHaveBeenCalledTimes(1)
    expect(events.filter(e=>e.type==='cell')).toHaveLength(3)
    expect(result.comparison_count).toBe(0)
    expect(JSON.parse(await readFile(join(directory,'scans',result.id+'.json'),'utf8')).id).toBe(result.id)
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
