import {describe,expect,it} from 'vitest'
import {mkdtemp,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {Store} from '../../apps/host/store'
import {collectSelectedEvidence} from '../../services/capabilities/research'
import {evidenceAt,loadProjectEvidence,type ProjectEvidenceSnapshot} from '../../services/map-screening/project-evidence'
import {groundMapAssessment} from '../../services/map-screening/analyst'
import {handoffPublicSources} from '../../packages/maps/public-context'
import {dashboardQuestions} from '../../packages/decision/dashboard'
import {projectInput} from '../../packages/contracts/validate'
import type {MapScreenContext,MapPreliminaryAssessment,Source} from '../../apps/host/generated/contracts'

const stamp='2026-09-28T08:00:00Z'
const target={kind:'point',longitude:120.16,latitude:30.28,radius_m:800,bounds:null,label:'甲办公楼',label_origin:'public',object_ref:'amap:A'} as const
const context=(patch:Partial<MapScreenContext>={}):MapScreenContext=>({id:'MAPCTX-HANDOFF',provider:'amap',coordinate_encoding:'GCJ-02',created_at:stamp,expires_at:'2026-09-28T08:10:00Z',target,address:'浙江省杭州市西湖区',city:'杭州市',groups:[],local_projects:[],project_revision:'fixture',status:'complete',gaps:[],metric_note:'fixture',...patch})
const quote=(name:string)=>`${name}设备维护采购项目`
const brief=(name:string,source_id:string,record_id?:string,key:'implementation'|'demand'='implementation'):MapPreliminaryAssessment=>({summary:`研究${name}设备维护。`,opportunities:[],cautions:[],unknowns:[],next_steps:[],dimension_evidence:[{key,source_id,record_id,quote:quote(name),basis:'按原文核对采购线索。'}]})
async function research(){
  const table=(name:string,id:string,deadline:string)=>`<table><tr><td>项目编号</td><td>${id}</td></tr><tr><td>项目名称</td><td>${quote(name)}</td></tr><tr><td>响应文件提交截止时间</td><td>${deadline}</td></tr></table>`
  const html=`<html><head><meta name="PubDate" content="2026-09-20"></head><body><p>${quote('甲办公楼')}。${'采购前需核对现场情况。'.repeat(400)}</p>${table('甲办公楼','OLD','2026年9月28日15点59分')}${table('乙办公楼','OPEN','2026年9月28日17点00分')}</body></html>`
  return collectSelectedEvidence({name:'甲办公楼',purpose:'维护采购',asOf:stamp},new AbortController().signal,()=>{}, {
    search:async()=>({sources:[{url:'https://www.ccgp.gov.cn/handoff-fixture',title:'楼栋维护采购公告',publishedAt:'2026-09-20'}]}),
    fetch:async()=>({statusCode:200,truncated:false,body:{kind:'html',content:html}}),
  },['甲办公楼采购 site:ccgp.gov.cn'])
}
async function inputFor(ctx:MapScreenContext,id='P-HANDOFF'){
  const input=JSON.parse(await readFile('fixtures/inputs/01_auto.json','utf8'))
  Object.assign(input,{project_id:id,synthetic:false,as_of:'2026-09-28',facts:[],context_rules:[],sources:handoffPublicSources(ctx)})
  input.scope={name:'公开测试项目',city:'杭州市',geometry:null,coordinate_encoding:'WGS84',legal_parcel_confirmed:false,map_anchor:{longitude:120.16,latitude:30.28,coordinate_encoding:'GCJ-02',name:'甲办公楼',provider:'amap'}}
  return projectInput(input)
}
function snapshot(input:Awaited<ReturnType<typeof inputFor>>):ProjectEvidenceSnapshot{
  return {revision:'fixture',syntheticCount:0,projects:[{project:{id:input.project_id,owner_id:'test',name:'测试',input,context_version:0,created_at:stamp,updated_at:stamp},sources:input.sources,documentCount:0}]}
}

describe('public structured evidence survives project handoff',()=>{
  it('keeps closed/open windows and historical demand through real PostgreSQL save, reopen and projection',async()=>{
    const result=await research(),source=result.sources[0],ctx=context({research_sources:result.sources,research_records:result.records})
    expect(result.records).toHaveLength(2)
    const input=await inputFor(ctx),dir=await mkdtemp(join(tmpdir(),'handoff-db-'))
    let store:Store|undefined
    try{
      store=await Store.open(dir)
      await store.db.query('INSERT INTO projects(id,owner_id,name,input) VALUES($1,$2,$3,$4)',[input.project_id,'test','交接项目',JSON.stringify(input)])
      await store.db.close();store=undefined;store=await Store.open(dir)
      const loaded=await loadProjectEvidence(store,'test'),local_projects=evidenceAt(loaded,target,'杭州市')
      expect(local_projects[0].sources[0].untrusted_text!.length).toBeLessThanOrEqual(2400)
      expect(local_projects[0].sources[0].untrusted_text).not.toContain('15点59分')
      for(const [name,expected] of [['甲办公楼',0],['乙办公楼',1]] as const){
        const record=result.records.find(r=>r.subject===quote(name))!,selected=context({target:{...target,label:name},research_sources:result.sources,research_records:result.records})
        const before=groundMapAssessment(brief(name,source.id,record.id),selected,result.sources,result.records)
        expect(before.dimension_evidence).toHaveLength(expected)
        const next=context({target:{...target,label:name},local_projects})
        const after=groundMapAssessment(brief(name,`${input.project_id}:${source.id}`,record.id),next)
        expect(after.dimension_evidence).toHaveLength(expected)
        expect(Object.keys(dashboardQuestions({purpose:after.summary,evidence:after.dimension_evidence!}))).toEqual(expected?['fit_implementation']:[])
        expect(groundMapAssessment(brief(name,`${input.project_id}:${source.id}`,record.id,'demand'),next).dimension_evidence).toHaveLength(1)
      }
      expect(await store.project(input.project_id,'other-user')).toBeUndefined()
    }finally{if(store)await store.db.close();await rm(dir,{recursive:true,force:true})}
  })
  it('preserves the same records across a second source namespace handoff',async()=>{
    const result=await research(),first=await inputFor(context({research_sources:result.sources,research_records:result.records}))
    const second=await inputFor(context({local_projects:evidenceAt(snapshot(first),target,'杭州市')}),'P-SECOND')
    const ctx=context({target:{...target,label:'乙办公楼'},local_projects:evidenceAt(snapshot(second),target,'杭州市')})
    const id=`P-SECOND:P-HANDOFF:${result.sources[0].id}`,record=result.records.find(r=>r.subject===quote('乙办公楼'))!
    expect(groundMapAssessment(brief('乙办公楼',id,record.id),ctx).dimension_evidence).toHaveLength(1)
    const expired=result.records.find(r=>r.subject===quote('甲办公楼'))!
    expect(groundMapAssessment(brief('甲办公楼',id,expired.id),{...ctx,target}).dimension_evidence).toEqual([])
  })
  it('keeps legacy lost record context unknown without suppressing historical demand',async()=>{
    const result=await research(),legacy={...result.sources[0]} as Source & {public_records?:unknown}
    delete legacy.public_records
    expect(legacy.records_truncated).toBe(false)
    const input=await inputFor(context({research_sources:[legacy]}))
    const ctx=context({local_projects:evidenceAt(snapshot(input),target,'杭州市')})
    expect(groundMapAssessment(brief('甲办公楼',`P-HANDOFF:${legacy.id}`),ctx).dimension_evidence).toEqual([])
    expect(groundMapAssessment(brief('甲办公楼',`P-HANDOFF:${legacy.id}`,undefined,'demand'),ctx).dimension_evidence).toHaveLength(1)
  })
  it('does not expose internal structured text in map previews or public handoffs',async()=>{
    const result=await research(),input=await inputFor(context({research_sources:result.sources,research_records:result.records}))
    input.sources[0].visibility='internal';input.sources[0].data_class='internal';projectInput(input)
    const ctx=context({local_projects:evidenceAt(snapshot(input),target,'杭州市')})
    expect(ctx.local_projects[0].sources[0].untrusted_text).toBeUndefined()
    expect(ctx.local_projects[0].sources[0].public_records).toBeUndefined()
    expect(handoffPublicSources(ctx)).toEqual([])
  })
})
