import { readFileSync } from 'node:fs'
import {describe,it,expect} from 'vitest'
import {DASHBOARD_DIMENSIONS,dashboardQuestions,parseDashboard} from '../../packages/decision/dashboard'
import {classifyCells} from '../../packages/maps/screening-policy'
import {groundMapAssessment,researchSubject} from '../../services/map-screening/analyst'
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
  it('accepts a real two-decimal provider distribution only within its rounding envelope',()=>{
    // Anonymized numeric fields from the live System One response on 2026-09-28.
    const r=answer();r.answers.fit_demand={type:'score',score:2.29,confidence:.81,probabilities:{0:.11,1:.02,2:.39,3:.47,4:.03}}
    expect(parseDashboard(r,input).dimensions[0].value).toBe(3.3)
    r.answers.fit_demand.score=2.4
    expect(()=>parseDashboard(r,input)).toThrow('DECISION_INVALID_RESPONSE')
  })
  it('does not fill a low-confidence or absent dimension to make the radar look complete',()=>{const r=answer();r.answers.fit_demand.confidence=.3;expect(parseDashboard(r,input).dimensions.every(d=>d.value===null)).toBe(true)})
  it('invalid score/units cannot become a plausible-looking chart',()=>{for(const v of [-1,5,NaN]){const r=answer();r.answers.fit_demand.score=v;expect(()=>parseDashboard(r,input)).toThrow()}})
  it('keeps explicit source blockers above model fit and ignores POI counts',()=>{
    const dashboard={...parseDashboard(answer(),input),dimensions:DASHBOARD_DIMENSIONS.map(d=>({key:d.key,value:4,confidence:.9,basis:'测试',evidence_refs:['S']}))} as DecisionDashboard
    const cell={id:'C',context:{},dashboard,factors:[{key:'implementation',state:'blocked',summary:'测试真实阻点',evidence_refs:['S'],quote:''}]} as MapScreenCell
    expect(classifyCells([cell],'overall')[0].tier).toBe('sparse');expect(classifyCells([{...cell,factors:[]}],'overall')[0].tier).toBe('strong')
    expect(classifyCells([{...cell,factors:[],dashboard:parseDashboard(answer(),input)}],'supply')[0].tier).toBe('incomplete')
  })
  it('discards cross-campus quotes rather than filling another campus dimension',()=>{
    const ctx={created_at:'2026-09-28',target:{label_origin:'public',label:'浙江大学玉泉校区'},groups:[],local_projects:[]} as unknown as MapScreenContext
    const src={id:'S',title:'浙江大学西溪校区改造',untrusted_text:'浙江大学西溪校区采购食堂修缮工程。',published_at:'2026-08-31',content_status:'full_text'} as Source
    const value={summary:'调查校园工程服务。',opportunities:[],cautions:[],unknowns:[],next_steps:[],dimension_evidence:[{...evidence,quote:src.untrusted_text!}]} as MapPreliminaryAssessment
    expect(groundMapAssessment(value,ctx,[src]).dimension_evidence).toEqual([])
  })
  it('requires ordinary buildings and parks to match the cited object too',()=>{
    const ctx={created_at:'2026-09-28',target:{label_origin:'public',label:'杭州市甲园区'},groups:[],local_projects:[]} as unknown as MapScreenContext
    const src={id:'S',title:'另一城市乙园区设备更新',url:'https://www.ccgp.gov.cn/test',untrusted_text:'本项目计划对既有设备系统进行更新，具体内容详见工程清单。',published_at:'2026-08-31',content_status:'full_text',data_class:'public',visibility:'public',synthetic:false} as Source
    const value={summary:'调查园区设备更新服务。',opportunities:[],cautions:[],unknowns:[],next_steps:[],dimension_evidence:[{...evidence,quote:src.untrusted_text!}]} as MapPreliminaryAssessment
    expect(groundMapAssessment(value,ctx,[src]).dimension_evidence).toEqual([])
    const matching={...src,title:'杭州市甲园区设备更新',untrusted_text:'杭州市甲园区计划对既有设备系统进行更新。'}
    expect(groundMapAssessment({...value,dimension_evidence:[{...evidence,quote:matching.untrusted_text}]},ctx,[matching]).dimension_evidence).toHaveLength(1)
  })
  it('does not promote city background to object scoring even when it mentions the name',()=>{
    const src={id:'S',title:'杭州市甲园区政策背景',untrusted_text:'杭州市甲园区位于城市产业发展规划范围内。',published_at:'2026-08-31',content_status:'full_text',data_class:'public',visibility:'public',synthetic:false} as Source
    const ctx={created_at:'2026-09-28',target:{label_origin:'public',label:'杭州市甲园区'},groups:[],local_projects:[{project_id:'P',name:'本地研究名称',scope_label:'杭州',relation:'city_background',sources:[src],facts:[],rules:[]}]} as unknown as MapScreenContext
    const value={summary:'调查园区设备更新服务。',opportunities:[],cautions:[],unknowns:[],next_steps:[],dimension_evidence:[{...evidence,source_id:'P:S',quote:src.untrusted_text!}]} as MapPreliminaryAssessment
    expect(groundMapAssessment(value,ctx).dimension_evidence).toEqual([])
  })
  it('rejects expired, undated and date-conflicting evidence without expiring all old archives',()=>{
    const ctx={created_at:'2026-09-28',target:{label_origin:'public',label:'杭州市甲园区'},groups:[],local_projects:[]} as unknown as MapScreenContext
    const src={id:'S',title:'杭州市甲园区设备档案',url:'https://example.gov.cn/archive',untrusted_text:'杭州市甲园区既有设备设置在建筑西侧。',published_at:'2018-08-31',content_status:'full_text',data_class:'public',visibility:'public',synthetic:false} as Source
    const value={summary:'调查园区设备维护服务。',opportunities:[],cautions:[],unknowns:[],next_steps:[],dimension_evidence:[{...evidence,key:'adaptation',quote:src.untrusted_text!}]} as MapPreliminaryAssessment
    expect(groundMapAssessment(value,ctx,[src]).dimension_evidence).toHaveLength(1)
    for(const patch of [{expires_at:'2019-01-01'},{published_at:undefined},{published_at:'2030-01-01'},{date_status:'conflict'},{date_status:'search_only'}])
      expect(groundMapAssessment(value,ctx,[{...src,...patch} as Source]).dimension_evidence).toEqual([])
  })
  it('normalizes punctuation in a provider place name without substituting a nearby campus',()=>{
    const ctx={created_at:'2026-09-28',target:{label_origin:'public',label:'浙江大学(紫金港校区)'},groups:[],local_projects:[]} as unknown as MapScreenContext
    const src={id:'S',title:'浙江大学紫金港校区设施维护',url:'https://example.zju.edu.cn/test',untrusted_text:'浙江大学紫金港校区计划维护既有设备系统，详见工程清单。',published_at:'2026-08-31',content_status:'full_text',data_class:'public',visibility:'public',synthetic:false} as Source
    const value={summary:'调查校园设备维护服务。',opportunities:[],cautions:[],unknowns:[],next_steps:[],dimension_evidence:[{...evidence,quote:src.untrusted_text!}]} as MapPreliminaryAssessment
    expect(groundMapAssessment(value,ctx,[src]).dimension_evidence).toHaveLength(1)
    ctx.target.label='选中的地图位置';ctx.address='杭州市测试路1号'
    ctx.groups=[{sample:[{name:'浙江大学(紫金港校区)'}]}] as any
    expect(researchSubject(ctx)).toBe(ctx.address)
    expect(groundMapAssessment(value,ctx,[src]).dimension_evidence).toEqual([])
  })
  it('keeps same-name districts, adjacent object IDs and multi-object paragraphs separate',()=>{
    const ctx={created_at:'2026-09-28',city:'杭州市',address:'杭州市西湖区测试路',target:{label_origin:'public',label:'甲园区A楼',object_ref:'amap:A'},groups:[],local_projects:[]} as unknown as MapScreenContext
    const base={id:'S',title:'甲园区A楼资料',url:'https://example.gov.cn/notice',published_at:'2026-09-01',content_status:'full_text',visibility:'public',data_class:'public',synthetic:false} as Source
    const ground=(s:Source,quote=s.untrusted_text!)=>groundMapAssessment({summary:'调查具体设备维护。',opportunities:[],cautions:[],unknowns:[],next_steps:[],dimension_evidence:[{...evidence,source_id:'S',quote}]},ctx,[s]).dimension_evidence
    expect(ground({...base,untrusted_text:'甲园区A楼位于杭州市余杭区，本期开展设备维护。'})).toEqual([])
    expect(ground({...base,object_refs:['amap:B'],untrusted_text:'甲园区A楼本期开展设备维护。'})).toEqual([])
    expect(ground({...base,untrusted_text:'甲园区A楼正常使用。乙园区B楼本期采购设备维护服务。'},'乙园区B楼本期采购设备维护服务。')).toEqual([])
    expect(ground({...base,untrusted_text:'甲园区A楼位于杭州市西湖区，本期采购设备维护服务。'})).toHaveLength(1)
  })
  it('allows grounded procurement amounts but rejects altered values, units, objects and returns',()=>{
    const ctx={created_at:'2026-09-28',target:{label_origin:'public',label:'甲园区A楼'},groups:[],local_projects:[]} as unknown as MapScreenContext
    const src={id:'S',title:'甲园区A楼设备采购',url:'https://www.ccgp.gov.cn/test',published_at:'2026-09-01',content_status:'full_text',visibility:'public',data_class:'public',synthetic:false,untrusted_text:'甲园区A楼空调更新预算为120万元。乙园区B楼空调更新预算为900万元。'} as Source
    const value=(text:string)=>({summary:text,opportunities:[{text,evidence_refs:['S']}],cautions:[],unknowns:[],next_steps:[]})
    expect(()=>groundMapAssessment(value('甲园区A楼空调更新预算为120万元。'),ctx,[src])).not.toThrow()
    for(const text of ['甲园区A楼空调更新预算为121万元。','甲园区A楼空调更新预算为120亿元。','甲园区A楼空调更新预算为900万元。','甲园区A楼可获得120万元收益。'])expect(()=>groundMapAssessment(value(text),ctx,[src])).toThrow()
  })
  it('does not score a closed participation window merely because the notice was published recently',()=>{
    const ctx={created_at:'2026-09-28T08:00:00Z',target:{label_origin:'public',label:'甲园区A楼'},groups:[],local_projects:[]} as unknown as MapScreenContext
    const src={id:'S',title:'甲园区A楼采购公告',url:'https://www.ccgp.gov.cn/test',published_at:'2026-09-01',content_status:'full_text',visibility:'public',data_class:'public',synthetic:false,untrusted_text:'甲园区A楼本期采购设备维护服务。'} as Source
    const value={summary:'调查设备维护采购。',opportunities:[],cautions:[],unknowns:[],next_steps:[],dimension_evidence:[{...evidence,key:'implementation',quote:src.untrusted_text!}]} as MapPreliminaryAssessment
    const record={id:'R',source_id:'S',adapter:'procurement',subject:'甲园区A楼设备维护',scope:'object',period:'2026-09-01',fields:[{key:'deadline',label:'响应截止',value:'2026年9月20日09点30分',unit:'',raw:'2026年9月20日09点30分',locator:'test'}]} as any
    expect(groundMapAssessment(value,ctx,[src],[record]).dimension_evidence).toEqual([])
    record.fields[0].value='2026年10月20日09点30分'
    expect(groundMapAssessment(value,ctx,[src],[record]).dimension_evidence).toHaveLength(1)
    expect(groundMapAssessment(value,ctx,[{...src,title:'甲园区A楼成交公告'}],[record]).dimension_evidence).toEqual([])
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
