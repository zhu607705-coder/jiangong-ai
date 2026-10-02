import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dashboardDimensions, dashboardPolicy, dashboardQuestions, parseDashboard, DASHBOARD_POLICY, NEIGHBORHOOD_DASHBOARD_POLICY } from '../../packages/decision/dashboard'
import { screenThemes, SCREEN_PROFILES } from '../../packages/maps/screening-policy'
import { publicSearchPlan } from '../../packages/research/public-sources'
import { projectDecisionInput } from '../../packages/decision/structured-route'
import type { MapScreenContext, Source } from '../../apps/host/generated/contracts'

const ports=vi.hoisted(()=>({open:vi.fn(),collect:vi.fn(),decision:vi.fn()}))
vi.mock('../../runtime/dsh/live-session',()=>({LiveSession:{open:ports.open}}))
vi.mock('../../services/capabilities/research',()=>({collectSelectedEvidence:ports.collect}))
vi.mock('../../services/capabilities/decision-model',()=>({evaluateDecision:ports.decision}))
import { analyzeMapContext, groundMapAssessment } from '../../services/map-screening/analyst'
import { MapScreeningService } from '../../services/map-screening/service'
import { config } from '../../apps/host/config'

const original={dataDir:config.dataDir,modelConfigured:config.modelConfigured,searchConfigured:config.searchConfigured,decisionEnabled:config.decisionEnabled}
const directories:string[]=[]
afterEach(async()=>{Object.assign(config,original);vi.useRealTimers();vi.resetAllMocks();for(const dir of directories.splice(0))await rm(dir,{recursive:true,force:true})})
const evidence={key:'demand' as const,source_id:'S',quote:'甲小区居民需要改善地下雨污管网和公共活动空间。',basis:'居民日常居住改善有明确需求。'}
const answer=()=>({model:'decision-model-preview',request_id:'TEST',answers:{fit_demand:{type:'score',score:2,confidence:.9,probabilities:{0:0,1:0,2:1,3:0,4:0}}}})

describe('old-neighborhood policy separation',()=>{
  it('keeps saved old dashboards under their original labels and versions',()=>{
    expect(dashboardPolicy()).toBe(DASHBOARD_POLICY)
    expect(dashboardDimensions(DASHBOARD_POLICY).map(d=>d.label)).toEqual(['需求客群','供给竞争','空间工程','实施入口','运营回款','投入交付'])
    expect(dashboardDimensions(NEIGHBORHOOD_DASHBOARD_POLICY).map(d=>d.label)).toEqual(['居民需求','公共服务','居住工程','实施协同','长效维护','资金交付'])
    expect(dashboardDimensions(NEIGHBORHOOD_DASHBOARD_POLICY).map(d=>d.key)).toEqual(dashboardDimensions(DASHBOARD_POLICY).map(d=>d.key))
    expect(screenThemes('balanced').implementation.label).toBe('实施入口')
    expect(screenThemes('neighborhood').implementation.label).toBe('实施协同')
    expect(SCREEN_PROFILES.neighborhood.label).toBe('老旧小区改造')
  })
  it('scores and parses the same business profile without filling missing axes',()=>{
    const input={profile:'neighborhood' as const,purpose:'甲小区居民活动空间与雨污管网改造',evidence:[evidence]}
    const questions=dashboardQuestions(input) as any
    expect(questions.fit_demand.instructions).toContain('居民需求')
    expect(questions.fit_demand.instructions).toContain('三类行动建议')
    expect(questions.fit_demand.criteria[4]).toContain('居民需求')
    const result=parseDashboard(answer(),input)
    expect(result.policy_version).toBe(NEIGHBORHOOD_DASHBOARD_POLICY)
    expect(result.dimensions[0].value).toBe(3)
    expect(result.dimensions.slice(1).every(d=>d.value===null)).toBe(true)
    expect(parseDashboard(answer(),{purpose:input.purpose,evidence:[evidence]}).policy_version).toBe(DASHBOARD_POLICY)
  })
  it('keeps ordinary searches while focusing neighborhood searches on residents, engineering and maintenance',()=>{
    const queries=publicSearchPlan('甲小区','老旧小区改造')
    expect(queries).toHaveLength(4)
    expect(queries.every(q=>q.includes('甲小区'))).toBe(true)
    expect(queries.filter(q=>q.includes('site:'))).toHaveLength(3)
    expect(queries.join(' ')).toMatch(/居民.*公共服务/)
    expect(queries.join(' ')).toMatch(/消防.*鉴定/)
    expect(queries.join(' ')).toContain('长效维护')
    expect(queries.every(q=>!q.includes('供地'))).toBe(true)
    expect(publicSearchPlan('甲园区','产业办公').join(' ')).toContain('site:landchina.com')
  })
  it('passes project business context to Qwen without disclosing internal materials',()=>{
    const project=JSON.parse(readFileSync('fixtures/inputs/01_auto.json','utf8'))
    project.business_profile='neighborhood'
    project.sources.push({id:'SECRET',visibility:'internal',data_class:'internal',synthetic:false,content_status:'full_text',untrusted_text:'私有居民资料'})
    project.facts.push({source_id:'SECRET',kind:'resident_household',value:'私有居民资料'})
    const input=projectDecisionInput(project),state=input.state as any
    expect(state.business_profile).toBe('neighborhood')
    expect(state.purpose).toContain('居民需求')
    expect(JSON.stringify(state)).not.toContain('私有居民资料')
    expect(input.sourceIds).not.toContain('SECRET')
  })
})

describe('neighborhood analyst integration',()=>{
  it('uses neighborhood research and six-dimensional evidence with unchanged source gates',async()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-02T08:00:00Z'))
    const dir=await mkdtemp(join(tmpdir(),'neighborhood-policy-'));directories.push(dir)
    Object.assign(config,{dataDir:dir,modelConfigured:true,searchConfigured:true,decisionEnabled:true})
    const signal=new AbortController().signal
    const source={id:'S',title:'甲小区老旧小区改造公告',url:'https://example.gov.cn/notice',visibility:'public',data_class:'public',synthetic:false,published_at:'2026-09-20',date_status:'verified',content_status:'full_text',untrusted_text:evidence.quote} as Source
    const trace={status:'success',queries:[],source_ids:['S'],warnings:[],reused:false}
    ports.collect.mockResolvedValue({sources:[source],records:[],receipts:[],trace})
    const prompts:string[]=[]
    ports.open.mockResolvedValue({calls:[],close:async()=>{},runReadCapability:async(_name:string,fn:(s:AbortSignal)=>Promise<unknown>)=>fn(signal),call:async(stage:string,prompt:string)=>{
      prompts.push(prompt)
      return {value:stage==='research_plan'?trace:{summary:'研究甲小区雨污管网与居民活动空间改造。',opportunities:[],cautions:[],unknowns:[],next_steps:['取得居民需求调查和工程清单。'],dimension_evidence:[evidence]}}
    }})
    ports.decision.mockResolvedValue({status:'completed',dashboard:parseDashboard(answer(),{profile:'neighborhood',purpose:'甲小区改造',evidence:[evidence]})})
    const context={id:'MAPCTX-test',created_at:new Date().toISOString(),target:{label:'甲小区',label_origin:'public'},city:'杭州市',address:null,groups:[],local_projects:[]} as unknown as MapScreenContext
    const result=await analyzeMapContext(context,'neighborhood',signal)
    expect(result.status).toBe('completed')
    expect(ports.collect.mock.calls[0][0].purpose).toBe('老旧小区改造')
    expect(prompts.join(' ')).toContain('居民协商')
    expect(prompts.join(' ')).toContain('基础/完善/提升')
    expect(prompts.join(' ')).toContain('operations长效维护')
    expect(ports.decision.mock.calls[0][0].dashboard.profile).toBe('neighborhood')
    expect(result.decision_support?.dashboard?.policy_version).toBe(NEIGHBORHOOD_DASHBOARD_POLICY)
    const expired={...source,title:'甲小区老旧小区改造成交公告'}
    expect(groundMapAssessment({summary:'研究甲小区管网改造。',opportunities:[],cautions:[],unknowns:[],next_steps:[],dimension_evidence:[{...evidence,key:'implementation'}]},context,[expired]).dimension_evidence).toEqual([])
  })
  it('never reuses an ordinary-profile brief as a neighborhood analysis',async()=>{
    const dir=await mkdtemp(join(tmpdir(),'neighborhood-cache-'));directories.push(dir)
    const provider={revision:()=> 'test',query:async(path:string)=>path.includes('regeo')?{regeocode:{formatted_address:'杭州市甲小区',addressComponent:{city:'杭州市'}}}:{count:'0',pois:[]}}
    const analyst=vi.fn(async(context:any,profile:any)=>({context_id:context.id,profile,status:'completed',assessment:{summary:profile==='neighborhood'?'研究甲小区居民居住改善。':'研究甲小区现有服务。',opportunities:[],cautions:[],unknowns:[],next_steps:[]},model_calls:[],reason:null,created_at:new Date().toISOString()} as any))
    const service=new MapScreeningService(provider,dir,analyst),signal=new AbortController().signal
    const context=await service.context({kind:'point',longitude:120.16,latitude:30.28,radius_m:800,bounds:null,label:'甲小区',label_origin:'public'},signal)
    await service.analyze(context.id,'balanced',signal)
    expect(await service.savedAnalysis(context.id,'neighborhood',signal)).toBeNull()
    expect((await service.analyze(context.id,'neighborhood',signal)).assessment?.summary).toContain('居民居住改善')
    expect(analyst).toHaveBeenCalledTimes(2)
    await service.analyze(context.id,'neighborhood',signal)
    expect(analyst).toHaveBeenCalledTimes(2)
  })
})
