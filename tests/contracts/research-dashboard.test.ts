import { readFileSync } from 'node:fs'
import {describe,it,expect} from 'vitest'
import {DASHBOARD_DIMENSIONS,dashboardQuestions,parseDashboard} from '../../packages/decision/dashboard'
import {classifyCells} from '../../packages/maps/screening-policy'
import {groundMapAssessment} from '../../services/map-screening/analyst'
import type {DecisionDashboard,MapScreenCell,MapScreenContext,MapPreliminaryAssessment,Source} from '../../apps/host/generated/contracts'
import {consumeStream} from '../../apps/workspace/src/maps/screening-stream'
const evidence={key:'demand' as const,source_id:'S',quote:'测试校园发布了具体场馆修缮采购。',basis:'具体场馆修缮采购构成需求线索。'}
const input={purpose:'校园工程服务',evidence:[evidence]}
const answer=()=>({model:'decision-model-preview',request_id:'TEST',answers:{fit_demand:{type:'score',score:2.2,confidence:.9,probabilities:{0:0,1:.1,2:.6,3:.3,4:0}}}})
describe('six-dimension decision dashboard',()=>{
  it('separates demand from supply and merges access into the business questions',()=>{expect(DASHBOARD_DIMENSIONS.map(d=>d.key)).toEqual(['demand','supply','adaptation','implementation','operations','resources'])})
  it('requests real score protocol only for dimensions with original evidence',()=>{const q=dashboardQuestions(input) as any;expect(Object.keys(q)).toEqual(['fit_demand']);expect(q.fit_demand.type).toBe('score');expect(q.fit_demand.criteria).toHaveLength(5)})
  it('converts probability-weighted zero-based API score to a 1–5 fit level',()=>{const r=parseDashboard(answer(),input);expect(r.dimensions[0].value).toBe(3.2);expect(r.dimensions[1].value).toBeNull();expect(r.status).toBe('partial')})
  it('rejects an expected score inconsistent with its distribution',()=>{const r=answer();r.answers.fit_demand.score=4;expect(()=>parseDashboard(r,input)).toThrow('DECISION_INVALID_RESPONSE')})
  it('does not fill a low-confidence or absent dimension to make the radar look complete',()=>{const r=answer();r.answers.fit_demand.confidence=.3;expect(parseDashboard(r,input).dimensions.every(d=>d.value===null)).toBe(true)})
  it('invalid score/units cannot become a plausible-looking chart',()=>{for(const v of [-1,5,NaN]){const r=answer();r.answers.fit_demand.score=v;expect(()=>parseDashboard(r,input)).toThrow()}})
  it('keeps explicit source blockers above model fit and ignores POI counts',()=>{
    const dashboard={...parseDashboard(answer(),input),dimensions:DASHBOARD_DIMENSIONS.map(d=>({key:d.key,value:4,confidence:.9,basis:'测试',evidence_refs:['S']}))} as DecisionDashboard
    const cell={id:'C',context:{},dashboard,factors:[{key:'implementation',state:'blocked',summary:'测试真实阻点',evidence_refs:['S'],quote:''}]} as MapScreenCell
    expect(classifyCells([cell],'overall')[0].tier).toBe('sparse');expect(classifyCells([{...cell,factors:[]}],'overall')[0].tier).toBe('strong')
    expect(classifyCells([{...cell,factors:[],dashboard:parseDashboard(answer(),input)}],'supply')[0].tier).toBe('incomplete')
  })
  it('discards cross-campus quotes rather than filling another campus dimension',()=>{
    const ctx={created_at:'2026-09-28',target:{label:'浙江大学玉泉校区'},groups:[],local_projects:[]} as unknown as MapScreenContext
    const src={id:'S',title:'浙江大学西溪校区改造',untrusted_text:'浙江大学西溪校区采购食堂修缮工程。',published_at:'2026-08-31',content_status:'full_text'} as Source
    const value={summary:'调查校园工程服务。',opportunities:[],cautions:[],unknowns:[],next_steps:[],dimension_evidence:[{...evidence,quote:src.untrusted_text!}]} as MapPreliminaryAssessment
    expect(groundMapAssessment(value,ctx,[src]).dimension_evidence).toEqual([])
  })
})
describe('real streaming lifecycle',()=>{
  const stream=(parts:Uint8Array[])=>new Response(new ReadableStream({start(c){for(const p of parts)c.enqueue(p);c.close()}}))
  it('handles UTF-8 split inside a Chinese character and a terminal frame without trailing newline',async()=>{
    const b=new TextEncoder().encode('{"type":"progress","message":"研究中"}\n{"type":"complete"}'),events:any[]=[]
    await consumeStream(stream([b.slice(0,32),b.slice(32,35),b.slice(35)]),new AbortController().signal,e=>events.push(e))
    expect(events.map(e=>e.type)).toEqual(['progress','complete']);expect(events[0].message).toBe('研究中')
  })
  it('does not pretend a truncated connection has completed',async()=>{
    await expect(consumeStream(stream([new TextEncoder().encode('{"type":"progress"}\n')]),new AbortController().signal,()=>{})).rejects.toThrow('连接中断')
  })
  it('ignores frames after the one terminal result',async()=>{
    const events:any[]=[];await consumeStream(stream([new TextEncoder().encode('{"type":"complete"}\n{"type":"progress"}\n')]),new AbortController().signal,e=>events.push(e));expect(events).toHaveLength(1)
  })
  it('cancellation releases a pending reader and stops all further results',async()=>{
    const control=new AbortController(),r=new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('{"type":"progress"}\n'))}})),events:any[]=[]
    await expect(consumeStream(r,control.signal,e=>{events.push(e);control.abort()})).rejects.toThrow();expect(events).toHaveLength(1)
  })
})


describe('ZJU public case study integrity',()=>{
 const data=JSON.parse(readFileSync('data/public_cases/zju-campuses.json','utf8'))
 it('keeps seven campus identities, current source dates and six unscored dimensions',()=>{
  expect(new Set(data.cases.map((c:any)=>c.campus)).size).toBe(7)
  for(const c of data.cases){expect(c.dimensions.map((d:any)=>d.key)).toEqual(DASHBOARD_DIMENSIONS.map(d=>d.key));expect(c.dimensions.every((d:any)=>d.value===null)).toBe(true);expect(c.decision_model_run).toBe(false);expect(c.summary.length).toBeLessThanOrEqual(64)}
  expect(data.sources.every((s:any)=>Date.parse(s.published_at)<=Date.parse(data.as_of))).toBe(true)
 })
 it('keeps indexed notices separate from fetched originals and leaves unlocated leads unassigned',()=>{
  const ids=new Set(data.sources.map((s:any)=>s.id))
  expect(data.cases.every((c:any)=>c.source_ids.every((id:string)=>ids.has(id)))).toBe(true)
  expect(data.sources.find((s:any)=>s.id==='S3').content_status).toBe('search_excerpt')
  expect(data.unlocated_leads[0].campus).toBeNull()
 })
})
