import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { MapScreenContext } from '../../apps/host/generated/contracts'

const ports=vi.hoisted(()=>({open:vi.fn(),collect:vi.fn(),decision:vi.fn()}))
vi.mock('../../runtime/dsh/live-session',()=>({LiveSession:{open:ports.open}}))
vi.mock('../../services/capabilities/research',()=>({collectSelectedEvidence:ports.collect}))
vi.mock('../../services/capabilities/decision-model',()=>({evaluateDecision:ports.decision}))
import { analyzeMapContext, groundMapAssessment } from '../../services/map-screening/analyst'
import { MapScreeningService } from '../../services/map-screening/service'
import { projectInput } from '../../packages/contracts/validate'
import { config } from '../../apps/host/config'
import { RESEARCH_POLICY } from '../../packages/research/public-sources'

const original={dataDir:config.dataDir,modelConfigured:config.modelConfigured,searchConfigured:config.searchConfigured,decisionEnabled:config.decisionEnabled}
const directories:string[]=[]
afterEach(async()=>{vi.useRealTimers();Object.assign(config,original);vi.resetAllMocks();for(const dir of directories.splice(0))await rm(dir,{recursive:true,force:true})})

describe('map analyst external-data boundary',()=>{
  it('marks expired local-source partials for refresh and recovers through the real service after restart',async()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date('2026-09-28T08:00:00Z'))
    const dir=await mkdtemp(join(tmpdir(),'map-refresh-service-'));directories.push(dir)
    Object.assign(config,{dataDir:dir,modelConfigured:true,searchConfigured:true,decisionEnabled:false})
    const old:any={id:'OLD',title:'甲办公楼预算记录',url:'https://www.ccgp.gov.cn/old',data_class:'public',visibility:'public',synthetic:false,content_status:'full_text',published_at:'2026-09-20T00:00:00Z',date_status:'verified',expires_at:'2026-09-28T08:01:00Z',untrusted_text:'甲办公楼预算为120万元。'}
    const input=JSON.parse(readFileSync('fixtures/inputs/01_auto.json','utf8'))
    Object.assign(input,{project_id:'P-REFRESH',synthetic:false,as_of:'2026-09-28',sources:[old],facts:[],context_rules:[]})
    input.scope={name:'公开测试项目',city:'杭州市',geometry:null,coordinate_encoding:'WGS84',legal_parcel_confirmed:false,map_anchor:{longitude:120.16,latitude:30.28,coordinate_encoding:'GCJ-02',name:'甲办公楼',provider:'amap'}}
    projectInput(input)
    const snapshot=async()=>({revision:'unchanged',syntheticCount:0,projects:[{project:{id:input.project_id,name:'公开测试项目',owner_id:'local-operator',input,context_version:0,created_at:'2026-09-28T00:00:00Z',updated_at:'2026-09-28T00:00:00Z'},sources:[old],documentCount:0}]})
    const provider={revision:()=> 'test',query:async(path:string)=>path.includes('regeo')?{regeocode:{formatted_address:'浙江省杭州市西湖区甲办公楼',addressComponent:{city:'杭州市'}}}:{count:'0',pois:[]}}
    let initial=true
    const analyst:typeof analyzeMapContext=async(ctx,profile,signal,emit=()=>{},previous)=>{
      if(!initial)return analyzeMapContext(ctx,profile,signal,emit,previous)
      initial=false
      const result:any={context_id:ctx.id,profile,status:'partial',assessment:groundMapAssessment({summary:old.untrusted_text,opportunities:[],cautions:[],unknowns:[],next_steps:[]},ctx),model_calls:[],reason:'评分尚未完成。',created_at:new Date().toISOString(),research_sources:[],research_records:[]}
      await emit({type:'brief',result});return result
    }
    const service=new MapScreeningService(provider,dir,analyst,snapshot),signal=new AbortController().signal
    const target:any={kind:'point',longitude:120.16,latitude:30.28,radius_m:800,bounds:null,label:'甲办公楼',label_origin:'public',object_ref:'amap:A'}
    const ctx=await service.context(target,signal);await service.analyze(ctx.id,'balanced',signal)
    vi.setSystemTime(new Date('2026-09-28T08:00:59Z'))
    expect((await service.savedAnalysis(ctx.id,'balanced',signal))?.refresh_required).not.toBe(true)
    for(const now of ['2026-09-28T08:01:00Z','2026-09-28T08:01:01Z','2026-09-28T08:02:00Z']){
      vi.setSystemTime(new Date(now));const saved=await service.savedAnalysis(ctx.id,'balanced',signal)
      expect(saved?.refresh_required).toBe(true);expect(saved?.assessment?.summary).toBe(old.untrusted_text);expect(saved?.reason).toContain('重新取证')
    }
    vi.setSystemTime(new Date('2026-09-28T08:11:00Z'))
    const restarted=new MapScreeningService(provider,dir,analyst,snapshot),freshContext=await restarted.context(target,signal)
    expect(freshContext.id).not.toBe(ctx.id)
    expect((await restarted.savedAnalysis(freshContext.id,'balanced',signal))?.refresh_required).toBe(true)
    const current={...old,id:'NEW',url:'https://www.ccgp.gov.cn/new',expires_at:undefined,published_at:'2026-09-28T08:01:00Z',untrusted_text:'甲办公楼预算为180万元。'}
    const trace={status:'success',queries:[],source_ids:['NEW'],warnings:[],reused:false}
    ports.collect.mockResolvedValue({sources:[current],records:[],receipts:[],trace})
    ports.open.mockResolvedValue({calls:[],close:async()=>{},call:async(stage:string)=>({value:stage==='research_plan'?trace:{summary:current.untrusted_text,opportunities:[],cautions:[],unknowns:[],next_steps:[]}}),runReadCapability:async(_name:string,fn:(s:AbortSignal)=>Promise<unknown>)=>fn(signal)})
    const result=await restarted.analyze(freshContext.id,'balanced',signal)
    expect(result.status).toBe('completed');expect(result.assessment?.summary).toBe(current.untrusted_text);expect(result.refresh_required).not.toBe(true)
    expect(ports.collect).toHaveBeenCalledTimes(1)
    expect((await restarted.savedAnalysis(freshContext.id,'balanced',signal))?.assessment?.summary).toBe(current.untrusted_text)
  })
  it('refreshes evidence when an expired partial money claim can no longer be reused',async()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date('2026-09-28T08:02:00Z'))
    const dir=await mkdtemp(join(tmpdir(),'map-analyst-'));directories.push(dir)
    Object.assign(config,{dataDir:dir,modelConfigured:true,searchConfigured:true,decisionEnabled:true})
    const ctx={id:'TEST',created_at:'2026-09-28T08:00:00Z',target:{label_origin:'public',label:'科技大楼'},groups:[],local_projects:[]} as unknown as MapScreenContext
    const old={id:'OLD',title:'科技大楼采购公告',url:'https://example.gov.cn/old',published_at:'2026-09-28T00:00:00Z',expires_at:'2026-09-28T08:01:00Z',data_class:'public',visibility:'public',synthetic:false,content_status:'full_text',untrusted_text:'科技大楼空调更新预算为120万元。'}
    const previous:any={context_id:'TEST',profile:'balanced',status:'partial',created_at:ctx.created_at,model_calls:[],assessment:{summary:old.untrusted_text,opportunities:[],cautions:[],unknowns:[],next_steps:[]},research_sources:[old]}
    const fresh={...old,id:'NEW',url:'https://example.gov.cn/new',expires_at:undefined,untrusted_text:'科技大楼空调更新预算为180万元。'}
    const trace={status:'success',queries:[],source_ids:['NEW'],warnings:[],reused:false}
    const cacheKey=createHash('sha256').update(JSON.stringify({policy:RESEARCH_POLICY,name:'科技大楼',target:ctx.target,profile:'balanced',day:ctx.created_at.slice(0,10)})).digest('hex')
    const cacheDir=join(dir,'map-screening','public-research');await mkdir(cacheDir,{recursive:true})
    await writeFile(join(cacheDir,cacheKey+'.json'),JSON.stringify({saved_at:new Date().toISOString(),result:{sources:[old],records:[],receipts:[],trace}}))
    ports.collect.mockResolvedValue({sources:[fresh],records:[],receipts:[],trace})
    ports.decision.mockResolvedValue({status:'completed',dashboard:{status:'partial',dimensions:[]}})
    const call=vi.fn(async(stage:string)=>({value:stage==='research_plan'?trace:{summary:fresh.untrusted_text,opportunities:[],cautions:[],unknowns:[],next_steps:[]}}))
    ports.open.mockResolvedValue({calls:[],close:async()=>{},call,runReadCapability:async(_name:string,fn:(s:AbortSignal)=>Promise<unknown>)=>fn(new AbortController().signal)})
    const result=await analyzeMapContext(ctx,'balanced',new AbortController().signal,()=>{},previous)
    expect(result.status).toBe('completed')
    expect(result.assessment?.summary).toBe(fresh.untrusted_text)
    expect(ports.collect).toHaveBeenCalledTimes(1)
    expect(ports.collect.mock.calls[0][0].asOf).toBe('2026-09-28T08:02:00.000Z')
    expect(ports.decision).toHaveBeenCalledTimes(1)
    expect(previous.assessment.summary).toBe(old.untrusted_text)
  })
  it('retains a partial historical brief but does not re-score its expired source at the old snapshot time',async()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date('2026-09-28T08:02:00Z'))
    const dir=await mkdtemp(join(tmpdir(),'map-analyst-'));directories.push(dir)
    Object.assign(config,{dataDir:dir,modelConfigured:true,searchConfigured:true,decisionEnabled:true})
    ports.decision.mockResolvedValue({status:'completed',dashboard:{status:'partial',dimensions:[]}})
    const call=vi.fn();ports.open.mockResolvedValue({calls:[],close:async()=>{},call,runReadCapability:async(_name:string,fn:(s:AbortSignal)=>Promise<unknown>)=>fn(new AbortController().signal)})
    const ctx={id:'TEST',created_at:'2026-09-28T08:00:00Z',target:{label_origin:'public',label:'科技大楼'},groups:[],local_projects:[]} as unknown as MapScreenContext
    const quote='科技大楼本期采购设备维护服务。'
    const previous:any={context_id:'TEST',profile:'balanced',status:'partial',created_at:ctx.created_at,model_calls:[],assessment:{summary:'调查科技大楼维护服务。',opportunities:[],cautions:[],unknowns:[],next_steps:[],dimension_evidence:[{key:'demand',source_id:'DOC',quote,basis:'维护采购。'}]},research_sources:[{id:'DOC',title:'科技大楼采购公告',url:'https://example.gov.cn/notice',published_at:'2026-09-28T00:00:00Z',expires_at:'2026-09-28T08:01:00Z',data_class:'public',visibility:'public',synthetic:false,content_status:'full_text',untrusted_text:quote}]}
    const result=await analyzeMapContext(ctx,'balanced',new AbortController().signal,()=>{},previous)
    expect(result.assessment?.summary).toBe(previous.assessment.summary)
    expect(result.assessment?.dimension_evidence).toEqual([])
    expect(ports.decision.mock.calls[0][0].dashboard.evidence).toEqual([])
    expect(call).not.toHaveBeenCalled();expect(ports.collect).not.toHaveBeenCalled()
  })
  it.each(['brief generation','before scoring'])('rechecks the clock when a procurement deadline passes during %s',async(stage)=>{
    vi.useFakeTimers();vi.setSystemTime(new Date('2026-09-28T08:00:00Z'))
    const dir=await mkdtemp(join(tmpdir(),'map-analyst-'));directories.push(dir)
    Object.assign(config,{dataDir:dir,modelConfigured:true,searchConfigured:true,decisionEnabled:true})
    const quote='科技大楼本期采购设备维护服务。'
    const trace={status:'success',queries:[],source_ids:['DOC'],warnings:[],reused:false}
    ports.collect.mockResolvedValue({sources:[{id:'DOC',title:'科技大楼采购公告',url:'https://example.gov.cn/notice',published_at:'2026-09-28T00:00:00Z',data_class:'public',visibility:'public',synthetic:false,content_status:'full_text',untrusted_text:quote}],
      records:[{id:'R',source_id:'DOC',adapter:'procurement',subject:'科技大楼',scope:'object',period:'2026-09-28',fields:[{key:'deadline',label:'响应截止',value:'2026年9月28日16点01分',unit:'',raw:'2026年9月28日16点01分',locator:'test'}]}],receipts:[],trace})
    ports.decision.mockResolvedValue({status:'completed',dashboard:{status:'partial',dimensions:[]}})
    ports.open.mockResolvedValue({calls:[],close:async()=>{},call:async(name:string)=>{
      if(name==='research_plan')return {value:trace}
      if(stage==='brief generation')vi.setSystemTime(new Date('2026-09-28T08:02:00Z'))
      return {value:{summary:'调查科技大楼维护服务。',opportunities:[],cautions:[],unknowns:[],next_steps:[],dimension_evidence:[{key:'implementation',source_id:'DOC',quote,basis:'采购参与窗口。'}]}}
    },runReadCapability:async(_name:string,fn:(signal:AbortSignal)=>Promise<unknown>)=>fn(new AbortController().signal)})
    const ctx={id:'TEST',created_at:'2026-09-28T08:00:00Z',target:{label_origin:'public',label:'科技大楼'},city:'杭州市',address:'杭州市西湖区',groups:[],local_projects:[]} as unknown as MapScreenContext
    const result=await analyzeMapContext(ctx,'balanced',new AbortController().signal,event=>{
      if(stage==='before scoring'&&event.type==='progress'&&event.stage==='decision')vi.setSystemTime(new Date('2026-09-28T08:02:00Z'))
    })
    expect(result.assessment?.dimension_evidence).toEqual([])
    expect(ports.decision.mock.calls[0][0].dashboard.evidence).toEqual([])
    expect(ports.decision.mock.calls[0][0].state.as_of).toBe('2026-09-28T08:02:00.000Z')
    expect(ctx.created_at).toBe('2026-09-28T08:00:00Z')
  })
  it('redacts private boundary names and facts at every public service call',async()=>{
    const dir=await mkdtemp(join(tmpdir(),'map-analyst-'));directories.push(dir)
    Object.assign(config,{dataDir:dir,modelConfigured:true,searchConfigured:true,decisionEnabled:true})
    const trace={status:'partial',queries:[],source_ids:[],warnings:[],reused:false}
    ports.collect.mockResolvedValue({sources:[],records:[],receipts:[],trace})
    ports.decision.mockResolvedValue({status:'completed'})
    const prompts:string[]=[],tools:string[]=[]
    ports.open.mockResolvedValue({calls:[],close:async()=>{},
      call:async(stage:string,prompt:string)=>{
        prompts.push(prompt)
        return {value:stage==='research_plan'?trace:{summary:'调查既有空间维护服务。',opportunities:[],cautions:[],unknowns:[],next_steps:['查当前设备维护采购。']}}
      },
      runReadCapability:async(name:string,fn:(signal:AbortSignal)=>Promise<unknown>)=>{tools.push(name);return fn(new AbortController().signal)},
    })
    const context={id:'TEST',created_at:'2026-09-28T08:00:00Z',target:{kind:'point',label_origin:'project',label:'PRIVATE_NAME_CANARY',longitude:120,latitude:30,radius_m:800,bounds:null},
      city:'杭州',address:'杭州市公开测试地址',groups:[],local_projects:[{project_id:'P',name:'PRIVATE_NAME_CANARY',scope_label:'PRIVATE_SCOPE_CANARY',relation:'within_scope',
        sources:[{id:'PUBLIC',title:'公开资料',visibility:'public',data_class:'public',synthetic:false,content_status:'excerpt',untrusted_text:'公开工程信息'},
          {id:'PRIVATE',title:'内部资料',visibility:'internal',data_class:'internal',synthetic:false,untrusted_text:'PRIVATE_TEXT_CANARY'}],
        facts:[{id:'F',kind:'note',value:'PRIVATE_FACT_CANARY',source_id:'PRIVATE'}],rules:[]}]} as unknown as MapScreenContext
    const result=await analyzeMapContext(context,'balanced',new AbortController().signal)
    expect(result.status).toBe('completed')
    expect(tools).toEqual(['selected_public_research','qwen_research_route'])
    expect(ports.collect.mock.calls[0][0].name).toBe(context.address)
    expect(ports.decision).toHaveBeenCalledTimes(1)
    expect(JSON.stringify({prompts,search:ports.collect.mock.calls[0][0],decision:ports.decision.mock.calls[0][0]})).not.toContain('PRIVATE_')
    expect(prompts.some(p=>p.includes('公开工程信息'))).toBe(true)
  })
  it('repairs rejected quote evidence once before scoring without inventing a replacement quote',async()=>{
    const dir=await mkdtemp(join(tmpdir(),'map-analyst-'));directories.push(dir)
    Object.assign(config,{dataDir:dir,modelConfigured:true,searchConfigured:true,decisionEnabled:true})
    const quote='测试园区计划采购设备维护服务，覆盖既有公共设施。'
    const trace={status:'success',queries:[],source_ids:['DOC'],warnings:[],reused:false}
    ports.collect.mockResolvedValue({sources:[{id:'DOC',title:'测试园区设备维护采购',url:'https://www.ccgp.gov.cn/test',data_class:'public',visibility:'public',synthetic:false,content_status:'full_text',published_at:'2026-09-20',untrusted_text:quote}],records:[],receipts:[],trace})
    ports.decision.mockResolvedValue({status:'completed',dashboard:{status:'partial',dimensions:[]}})
    const stages:string[]=[]
    ports.open.mockResolvedValue({calls:[],close:async()=>{},call:async(stage:string)=>{
      stages.push(stage)
      return {value:stage==='research_plan'?trace:{summary:'调查测试园区设备维护服务。',opportunities:[],cautions:[],unknowns:[],next_steps:[],
        dimension_evidence:[{key:'demand',source_id:'DOC',quote:stage.endsWith('_repair')?quote:'测试园区计划采购……覆盖既有公共设施。',basis:'设备维护采购构成需求线索。'}]}}
    },runReadCapability:async(_name:string,fn:(signal:AbortSignal)=>Promise<unknown>)=>fn(new AbortController().signal)})
    const ctx={id:'TEST',created_at:'2026-09-28T08:00:00Z',target:{label_origin:'public',label:'测试园区'},city:'杭州',address:'测试地址',groups:[],local_projects:[]} as unknown as MapScreenContext
    const result=await analyzeMapContext(ctx,'balanced',new AbortController().signal)
    expect(stages.filter(s=>s.startsWith('map_'))).toEqual(['map_initial_screen','map_initial_screen_repair'])
    expect(result.assessment?.dimension_evidence?.[0].quote).toBe(quote)
    expect(ports.decision.mock.calls[0][0].dashboard.evidence).toEqual(result.assessment?.dimension_evidence)
  })
  it.each(['throws','failed','unavailable'])('retains an already validated brief when scoring %s',async(mode)=>{
    const dir=await mkdtemp(join(tmpdir(),'map-analyst-'));directories.push(dir)
    Object.assign(config,{dataDir:dir,modelConfigured:true,searchConfigured:false,decisionEnabled:true})
    if(mode==='throws')ports.decision.mockRejectedValue(new Error('FIXTURE_SCORER_UNAVAILABLE'))
    else ports.decision.mockResolvedValue({status:mode})
    ports.open.mockResolvedValue({calls:[],close:async()=>{},call:async()=>({value:{summary:'调查所选空间维护服务。',opportunities:[],cautions:[],unknowns:[],next_steps:[]}}),
      runReadCapability:async(_name:string,fn:(signal:AbortSignal)=>Promise<unknown>)=>fn(new AbortController().signal)})
    const ctx={id:'TEST',created_at:'2026-09-28T08:00:00Z',target:{label_origin:'public',label:'测试园区'},groups:[],local_projects:[]} as unknown as MapScreenContext
    const result=await analyzeMapContext(ctx,'balanced',new AbortController().signal)
    expect(result.status).toBe('failed')
    expect(result.assessment?.summary).toBe('调查所选空间维护服务。')
    expect(result.reason).toContain('简报')
  })
  it('retries only the decision stage and emits the saved structured brief before scoring',async()=>{
    const dir=await mkdtemp(join(tmpdir(),'map-analyst-'));directories.push(dir)
    Object.assign(config,{dataDir:dir,modelConfigured:true,searchConfigured:true,decisionEnabled:true})
    ports.collect.mockResolvedValue({sources:[],records:[],receipts:[],trace:{status:'partial',queries:[],source_ids:[],warnings:[],reused:false}})
    ports.decision.mockResolvedValueOnce({status:'failed',error_code:'DECISION_REQUEST_FAILED'}).mockResolvedValue({status:'completed'})
    const call=vi.fn(async(stage:string)=>({value:stage==='research_plan'?{queries:[]}:{summary:'调查设备维护服务。',opportunities:[],cautions:[],unknowns:[],next_steps:[]}}))
    ports.open.mockResolvedValue({calls:[],close:async()=>{},call,runReadCapability:async(_name:string,fn:(signal:AbortSignal)=>Promise<unknown>)=>fn(new AbortController().signal)})
    const ctx={id:'TEST',created_at:'2026-09-28T08:00:00Z',target:{label_origin:'public',label:'测试园区'},groups:[],local_projects:[]} as unknown as MapScreenContext
    const stages:string[]=[]
    const first=await analyzeMapContext(ctx,'balanced',new AbortController().signal,e=>{stages.push(e.type==='brief'?'structured-brief':e.stage+':'+e.status)})
    expect(first.status).toBe('failed')
    expect(stages.indexOf('structured-brief')).toBeLessThan(stages.indexOf('decision:running'))
    const callsBefore=call.mock.calls.length,searchBefore=ports.collect.mock.calls.length
    const next=await analyzeMapContext(ctx,'balanced',new AbortController().signal,()=>{},first)
    expect(next.status).toBe('completed');expect(next.assessment?.summary).toBe(first.assessment?.summary)
    expect(call).toHaveBeenCalledTimes(callsBefore);expect(ports.collect).toHaveBeenCalledTimes(searchBefore);expect(ports.decision).toHaveBeenCalledTimes(2)
  })
})
