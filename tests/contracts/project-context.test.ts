import {readFileSync} from 'node:fs'
import {PGlite} from '@electric-sql/pglite'
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {Store,type Database,type ProjectRecord} from '../../apps/host/store'
import {beginProjectAnalysis,commitProjectAnalysis,projectContextRef} from '../../apps/host/project-context'
import {readPublishedStrategy,resolveCurrentContext} from '../../apps/host/strategy-publication'
import {bindObjectPassage} from '../../packages/retrofit/object-binding'
import {projectRenewalModeInput} from '../../packages/retrofit/renewal-mode'
import {requestDecisionQuestions} from '../../services/capabilities/decision-model'
import {guidePacket,guideProject} from './project-decision-fixture'
import type {StrategyPacket} from '../../packages/retrofit/strategy'

let store:Store,project:ProjectRecord
function packet(hash='first'):StrategyPacket {
  const value=guidePacket();value.project_id=project.id;value.context_version=project.context_version;value.input_hash=hash
  value.strategy!.dimensions=(['demand','supply','adaptation','implementation','operations','resources'] as const).map(key=>({key,current:'待核现况',current_level:'unknown',comprehensive:'维修改善',comprehensive_level:'medium',rebuild:'拆建情景',rebuild_level:'medium',evidence_refs:[]}))
  return value
}
beforeEach(async()=>{
  const db=new PGlite();await db.exec(readFileSync('packages/contracts/migrations/001_initial.sql','utf8'));store=new Store(db as unknown as Database,'test')
  await store.initializeAnalysisContext()
  await db.exec(`CREATE TABLE renewal_strategy_assessments(owner_id TEXT,project_id TEXT,input_hash TEXT,payload JSONB,created_at TIMESTAMPTZ DEFAULT now(),PRIMARY KEY(owner_id,project_id,input_hash));
    CREATE TABLE renewal_research_rounds(owner_id TEXT,project_id TEXT,round_number INTEGER,payload JSONB,input_snapshot JSONB);`)
  project=structuredClone(guideProject);project.input.scope={...project.input.scope,name:'建工新村',city:'天津市',map_anchor:undefined};project.input.as_of='2026-10-17'
  await db.query('INSERT INTO projects(id,owner_id,name,input,context_version) VALUES($1,$2,$3,$4,$5)',[project.id,project.owner_id,project.name,JSON.stringify(project.input),project.context_version])
})
afterEach(async()=>{await store.db.close();vi.restoreAllMocks()})

describe('object and active analysis context',()=>{
  it('retains Hangzhou originals as reference and material follow-ups without changing the Tianjin registration or stored report',async()=>{
    const input=project.input;input.sources[0]={...input.sources[0],title:'杭州市建工新村改造',untrusted_text:'杭州市建工新村需要改造供水。',evidence_scope:'object',object_refs:[`project:${project.id}`]}
    await store.db.query('UPDATE projects SET input=$1 WHERE id=$2',[JSON.stringify(input),project.id])
    expect(projectRenewalModeInput(input).evidence).toEqual([])
    const ticket=await beginProjectAnalysis(store,project),value=packet();value.sources[0]={...value.sources[0],title:input.sources[0].title,text:input.sources[0].untrusted_text!,project_id:project.id}
    const saved=await commitProjectAnalysis(store,project,ticket,value)
    expect(saved.current).toBe(true);expect(saved.packet.status).toBe('completed')
    expect(saved.packet.sources[0]).toMatchObject({role:'reference',object_binding:{relation:'different_object'}})
    expect(saved.packet.content_review?.issues.some(row=>row.code==='OBJECT_LOCATION_CONFLICT')).toBe(true)
    expect(value.sources[0].role).toBe('current');expect((await store.project(project.id,project.owner_id))!.input.scope.city).toBe('天津市')
    expect((await readPublishedStrategy(store,project,'',false))?.current_context?.object_review_required).toBe(true)
  })
  it('binds separate passages independently and ignores supplier contact addresses',()=>{
    expect(bindObjectPassage(project.input,'项目分项','天津市建工新村供水改造。').relation).toBe('unresolved')
    expect(bindObjectPassage(project.input,'项目分项','杭州市建工新村供水改造。').relation).toBe('different_object')
    expect(bindObjectPassage(project.input,'项目分项','天津市建工新村供水改造。供应商地址：杭州市西湖区。',project.id).relation).toBe('unresolved')
    expect(bindObjectPassage(project.input,'对标案例','杭州市其他小区的供水更新。',undefined,true).relation).toBe('comparable_case')
  })
  it('late old context cannot replace a newer result even if context_version was accidentally unchanged',async()=>{
    const oldProject=structuredClone(project),old=await beginProjectAnalysis(store,oldProject)
    project.input.scope.city='杭州市'
    await store.db.query('UPDATE projects SET input=$1 WHERE id=$2',[JSON.stringify(project.input),project.id])
    const current=await beginProjectAnalysis(store,project)
    await commitProjectAnalysis(store,project,current,packet('new'))
    const late=packet('old');late.project_id=oldProject.id
    expect((await commitProjectAnalysis(store,oldProject,old,late)).current).toBe(false)
    expect((await readPublishedStrategy(store,project,'',false))?.input_hash).toBe('new')
    expect((await store.db.query('SELECT id FROM project_analysis_attempts WHERE payload IS NOT NULL')).rows).toHaveLength(2)
  })
  it('orders simultaneous same-context requests by claim sequence, not completion or model timestamps',async()=>{
    const first=await beginProjectAnalysis(store,project),second=await beginProjectAnalysis(store,project)
    const latest=packet('newer-request');latest.created_at='2026-10-15T00:00:00Z'
    await commitProjectAnalysis(store,project,second,latest)
    expect((await commitProjectAnalysis(store,project,first,packet('late-response'))).current).toBe(false)
    expect((await resolveCurrentContext(store,project)).active_analysis?.input_hash).toBe('newer-request')
    expect((await resolveCurrentContext(store,project)).published_report).toBeNull()
  })
  it('retains previous applicable results while a retry runs or fails',async()=>{
    const first=await beginProjectAnalysis(store,project);await commitProjectAnalysis(store,project,first,packet('usable'))
    const retry=await beginProjectAnalysis(store,project)
    expect((await resolveCurrentContext(store,project)).active_analysis?.input_hash).toBe('usable')
    await commitProjectAnalysis(store,project,retry,{...packet('failure'),status:'failed',strategy:null,error:'供应商故障'})
    expect((await resolveCurrentContext(store,project)).active_analysis?.input_hash).toBe('usable')
  })
  it('does not resurrect a fenced late round through legacy fallback after the newer request fails',async()=>{
    const first=await beginProjectAnalysis(store,project),second=await beginProjectAnalysis(store,project)
    await commitProjectAnalysis(store,project,second,{...packet('new-failed'),status:'failed',strategy:null})
    const late=await commitProjectAnalysis(store,project,first,packet('late-round'))
    await store.db.query('INSERT INTO renewal_research_rounds(owner_id,project_id,round_number,payload,input_snapshot) VALUES($1,$2,1,$3,$4)',[project.owner_id,project.id,JSON.stringify({id:'late-round',project_id:project.id,status:'completed',context_version:project.context_version,input_hash:late.packet.input_hash,result:late.packet}),JSON.stringify(project.input)])
    expect((await resolveCurrentContext(store,project)).active_analysis).toBeNull()
  })
  it('keeps a zero-evidence conditional report and rejects duplicate terminal commits and cross-project output',async()=>{
    const first=await beginProjectAnalysis(store,project),value=packet('conditional');value.sources=[]
    expect((await commitProjectAnalysis(store,project,first,value)).packet.status).toBe('completed')
    await expect(commitProjectAnalysis(store,project,first,value)).rejects.toThrow('ANALYSIS_ALREADY_COMMITTED')
    const second=await beginProjectAnalysis(store,project)
    await expect(commitProjectAnalysis(store,project,second,{...value,project_id:'OTHER'})).rejects.toThrow('ANALYSIS_PACKET_SCOPE')
  })
  it('does not return a head across owners, simulation identities or changed conditions',async()=>{
    const first=await beginProjectAnalysis(store,project);await commitProjectAnalysis(store,project,first,packet())
    expect((await resolveCurrentContext(store,{...project,owner_id:'other-owner'})).active_analysis).toBeNull()
    expect((await resolveCurrentContext(store,{...project,input:{...project.input,synthetic:true}})).active_analysis).toBeNull()
    const changed=structuredClone(project);changed.input.as_of='2026-10-18'
    expect((await resolveCurrentContext(store,changed)).active_analysis).toBeNull()
    expect(projectContextRef(changed).input_hash).not.toBe(projectContextRef(project).input_hash)
  })
  it('rejects a 17-question Decision request before network access',async()=>{
    const transport=vi.fn();const questions=Object.fromEntries(Array.from({length:17},(_,i)=>['q'+i,{type:'choice',criteria:{a:'a',b:'b'}}]))
    await expect(requestDecisionQuestions({},questions,new AbortController().signal,{apiKey:'test',endpoint:'https://example.test',model:'decision-model-preview'},transport)).rejects.toThrow('DECISION_INPUT_LIMIT')
    expect(transport).not.toHaveBeenCalled()
  })
})
