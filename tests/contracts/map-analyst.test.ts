import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { MapScreenContext } from '../../apps/host/generated/contracts'

const ports=vi.hoisted(()=>({open:vi.fn(),collect:vi.fn(),decision:vi.fn()}))
vi.mock('../../runtime/dsh/live-session',()=>({LiveSession:{open:ports.open}}))
vi.mock('../../services/capabilities/research',()=>({collectSelectedEvidence:ports.collect}))
vi.mock('../../services/capabilities/decision-model',()=>({evaluateDecision:ports.decision}))
import { analyzeMapContext } from '../../services/map-screening/analyst'
import { config } from '../../apps/host/config'

const original={dataDir:config.dataDir,modelConfigured:config.modelConfigured,searchConfigured:config.searchConfigured,decisionEnabled:config.decisionEnabled}
const directories:string[]=[]
afterEach(async()=>{Object.assign(config,original);vi.resetAllMocks();for(const dir of directories.splice(0))await rm(dir,{recursive:true,force:true})})

describe('map analyst external-data boundary',()=>{
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
