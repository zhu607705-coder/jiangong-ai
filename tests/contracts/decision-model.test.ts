import { describe,it,expect,vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { evaluateDecision,parseDecisionResponse,decisionEndpoint } from '../../services/capabilities/decision-model'
import { applyDecisionGuards,mapDecisionInput,projectDecisionInput,DECISION_THRESHOLDS,DECISION_POLICY,prioritizeDecisionFollowups } from '../../packages/decision/structured-route'
import type { DecisionSupport,MapDecisionFactor,MapScreenContext } from '../../apps/host/generated/contracts'

const settings={apiKey:'test-not-a-real-key',endpoint:'https://maas.qianwenaiapi.com/compatible-mode/v1',model:'decision-model-preview'}
const keys=['implementation','adaptation','demand','operations','resources','access'] as const
const factors=(state:MapDecisionFactor['state']='unknown'):MapDecisionFactor[]=>keys.map(key=>({key,state,summary:'测试条件',evidence_refs:[],quote:''}))
function response(action='compare',confidence=.94) {
 const actions=['investigate','resolve_blocker','compare','review']
 return {model:'decision-model-preview',request_id:'TEST-REQUEST',answers:{
  next_action:{type:'choice',choice:action,confidence,probabilities:Object.fromEntries(actions.map(k=>[k,k===action?.97:.01]))},
  priority_dimension:{type:'choice',choice:'demand',confidence:.95,probabilities:Object.fromEntries(keys.map(k=>[k,k==='demand'?.95:.01]))},
  evidence_sufficient:{type:'noul',noul:.93}},usage:{input_tokens:250},latency_ms:12}
}
const input=()=>({state:{synthetic:true,description:'controlled adapter test'},factors:factors(),sourceIds:['TEST-SOURCE']})
function result():DecisionSupport {return {status:'completed',provider:'qwen_systemone',model:settings.model,policy_version:DECISION_POLICY,input_hash:'fixture',created_at:new Date().toISOString(),duration_ms:12,...parseDecisionResponse(response()),action:'compare',priority:'demand',next_step:'',guard_reasons:[],input_source_ids:['TEST'],thresholds:DECISION_THRESHOLDS,error_code:null}}

describe('Qwen System One protocol',()=>{
 it('normalizes the authorized gateway and regional workspace addresses; rejects alternate destinations',()=>{
  expect(decisionEndpoint(settings.endpoint)).toBe(settings.endpoint+'/systemone')
  expect(decisionEndpoint('https://workspace-test.cn-beijing.maas.aliyuncs.com')).toMatch(/\/compatible-mode\/v1\/systemone$/)
  for(const url of ['http://maas.qianwenaiapi.com','https://maas.qianwenaiapi.com.evil.test','https://key@maas.qianwenaiapi.com','https://maas.qianwenaiapi.com?key=secret','https://maas.qianwenaiapi.com/other','https://example.org']) expect(()=>decisionEndpoint(url)).toThrow('DECISION_ENDPOINT_INVALID')
 })
 it('retains separate confidence, probabilities and yes/no output from the actual protocol',()=>{
  const r=parseDecisionResponse(response())
  expect(r.answers?.next_action.confidence).toBe(.94)
  expect(r.answers?.next_action.probabilities.compare).toBe(.97)
  expect(r.answers?.evidence_sufficient).toBe(.93)
 })
 it('accounts for two-decimal probability rounding without accepting an impossible mass',()=>{
  const r=response();r.answers.priority_dimension.probabilities={implementation:.1,adaptation:.1,demand:.52,operations:.1,resources:.1,access:.1}
  expect(()=>parseDecisionResponse(r)).not.toThrow()
  r.answers.priority_dimension.probabilities.demand=.7
  expect(()=>parseDecisionResponse(r)).toThrow('DECISION_INVALID_RESPONSE')
 })
 it('rejects unrequested models, out-of-range confidence, incomplete distributions and arbitrary choices',()=>{
  const invalid:any[]=[]
  let r=response();r.model='text-model';invalid.push(r)
  r=response();r.answers.next_action.confidence=2;invalid.push(r)
  r=response();r.answers.next_action.probabilities.compare=.2;invalid.push(r)
  r=response();r.answers.next_action.choice='approve_investment';invalid.push(r)
  r=response();r.answers.evidence_sufficient.noul=NaN;invalid.push(r)
  r=response();delete (r.answers.priority_dimension.probabilities as any).demand;invalid.push(r)
  for(const value of invalid) expect(()=>parseDecisionResponse(value)).toThrow('DECISION_INVALID_RESPONSE')
 })
 it('sends only typed decisions with credentials in a header and redirects disabled',async()=>{
  const transport=vi.fn(async()=>new Response(JSON.stringify(response()),{status:200}))
  const out=await evaluateDecision(input(),new AbortController().signal,settings,transport as typeof fetch)
  const [url,options]=transport.mock.calls[0] as unknown as [string,RequestInit]
  expect(url).toBe(settings.endpoint+'/systemone');expect(options.redirect).toBe('error')
  const body=JSON.parse(options.body as string)
  expect(body.questions.next_action.type).toBe('choice');expect(body.questions.evidence_sufficient.type).toBe('noul')
  expect(body).not.toHaveProperty('messages');expect(JSON.stringify(body)).not.toContain(settings.apiKey)
  expect(out.status).toBe('completed');expect(out.action).toBe('investigate');expect(out.answers?.next_action.choice).toBe('compare')
 })
 it('an empty HTTP 404 is a provider failure, never a completed or substituted decision',async()=>{
  const out=await evaluateDecision(input(),new AbortController().signal,settings,async()=>new Response(null,{status:404}))
  expect(out.status).toBe('failed');expect(out.error_code).toBe('DECISION_HTTP_404');expect(out.answers).toBeNull();expect(out.action).toBeNull()
 })
 it('reports missing configuration without networking or leaking transport error text',async()=>{
  const transport=vi.fn(async()=>{throw new Error('Failure: '+settings.apiKey)})
  expect((await evaluateDecision(input(),new AbortController().signal,{...settings,endpoint:''},transport as typeof fetch)).error_code).toBe('DECISION_ENDPOINT_MISSING')
  expect(transport).not.toHaveBeenCalled()
  const result=await evaluateDecision(input(),new AbortController().signal,settings,transport as typeof fetch)
  expect(result.error_code).toBe('DECISION_REQUEST_FAILED');expect(JSON.stringify(result)).not.toContain(settings.apiKey)
 })
 it('stops a cancelled decision and rejects over-budget input before contacting the provider',async()=>{
  const c=new AbortController();c.abort();const transport=vi.fn(async()=>new Response(JSON.stringify(response())))
  await expect(evaluateDecision(input(),c.signal,settings,transport as typeof fetch)).rejects.toThrow()
  expect(transport).not.toHaveBeenCalled()
  const oversized={...input(),state:'x'.repeat(170000)}
  expect((await evaluateDecision(oversized,new AbortController().signal,settings,transport as typeof fetch)).error_code).toBe('DECISION_INPUT_LIMIT')
  expect(transport).not.toHaveBeenCalled()
 })
 it('caps response size and does not persist malformed successful HTTP bodies as decisions',async()=>{
  expect((await evaluateDecision(input(),new AbortController().signal,settings,async()=>new Response('x'.repeat(110000)))).error_code).toBe('DECISION_RESPONSE_LIMIT')
  expect((await evaluateDecision(input(),new AbortController().signal,settings,async()=>new Response(JSON.stringify({model:'wrong'})))).error_code).toBe('DECISION_INVALID_RESPONSE')
 })
})

describe('bounded research operations',()=>{
 it('turns a guarded decision into one actionable investigation item without duplicate tasks',()=>{
  const route=applyDecisionGuards(result(),factors())
  const first=prioritizeDecisionFollowups([],route,['defer_and_investigate'])
  expect(first).toHaveLength(1);expect(first[0].status).toBe('suggested');expect(first[0].title).toBe(route.next_step)
  expect(prioritizeDecisionFollowups(first,route,['defer_and_investigate'])).toHaveLength(1)
  expect(prioritizeDecisionFollowups([],{...route,status:'failed'},[])).toEqual([])
 })
 it('cannot override a local explicit blocker even with high model confidence',()=>{
  const f=factors('supported');f[4].state='blocked'
  const guarded=applyDecisionGuards(result(),f)
  expect(guarded.action).toBe('resolve_blocker');expect(guarded.priority).toBe('resources')
  expect(guarded.answers?.next_action.choice).toBe('compare')
 })
 it('never fills unknown conditions from a proposed comparison',()=>{
  const f=factors(), before=structuredClone(f)
  expect(applyDecisionGuards(result(),f).action).toBe('investigate');expect(f).toEqual(before)
 })
 it('allows a supported comparison, while low confidence or sufficiency goes to review',()=>{
  expect(applyDecisionGuards(result(),factors('supported')).action).toBe('compare')
  let r=result();r.answers!.next_action.confidence=.3
  expect(applyDecisionGuards(r,factors('supported')).action).toBe('review')
  r=result();r.answers!.evidence_sufficient=.1
  expect(applyDecisionGuards(r,factors('supported')).action).toBe('review')
 })
 it('an unsupported model blocker stays an investigation lead',()=>{
  const r={...result(),...parseDecisionResponse(response('resolve_blocker'))}
  expect(applyDecisionGuards(r,factors()).action).toBe('investigate')
 })
 it('preserves review on a low-confidence conflict instead of treating it as a plain missing field',()=>{
  const r={...result(),...parseDecisionResponse(response('review',.41))}, f=factors('supported')
  f[4].state='conditional'
  expect(applyDecisionGuards(r,f).action).toBe('review')
 })
 it('does not send project internal data to a newly configured provider',()=>{
  const p=JSON.parse(readFileSync('fixtures/inputs/01_auto.json','utf8'));p.synthetic=false
  p.sources=[{id:'PUBLIC',title:'公开资料',visibility:'public',data_class:'public',synthetic:false,untrusted_text:'公共信息'}, {id:'PRIVATE',title:'内部',visibility:'internal',data_class:'internal',synthetic:false,untrusted_text:'PRIVATE_CANARY'}]
  p.facts=[{id:'F1',kind:'note',value:'PRIVATE_CANARY',unit:null,source_id:'PRIVATE'}]
  p.context_rules=[{original_text:'PRIVATE_RULE_CANARY',source_id:'PRIVATE'}]
  const prepared=projectDecisionInput(p)
  expect(JSON.stringify(prepared)).not.toContain('CANARY');expect(prepared.sourceIds).toEqual(['PUBLIC'])
 })
 it('map inputs preserve city background precision and strip internal facts and project names',()=>{
  const ctx={id:'TEST',created_at:new Date().toISOString(),city:'杭州',address:'杭州',target:{kind:'point',longitude:120,latitude:30,radius_m:800,bounds:null},groups:[],local_projects:[{project_id:'P',name:'PRIVATE_NAME_CANARY',scope_label:'PRIVATE_SCOPE_CANARY',relation:'city_background',sources:[{id:'S',title:'公开政策',visibility:'public',data_class:'public',synthetic:false,content_status:'excerpt',untrusted_text:'政策正文'},{id:'I',title:'内部',visibility:'internal',data_class:'internal',synthetic:false,untrusted_text:'PRIVATE_CANARY'}],facts:[{id:'I',kind:'note',value:'PRIVATE_CANARY',unit:null,source_id:'I'}],rules:[]}]} as unknown as MapScreenContext
  const prepared=mapDecisionInput(ctx,'片区更新')
  expect(JSON.stringify(prepared)).not.toContain('CANARY')
  expect(JSON.stringify(prepared)).toContain('city_background')
  expect(prepared.factors.every(f=>f.state==='unknown')).toBe(true)
 })
})


describe('decision scoring integration',()=>{
 it('passes and validates all six score questions on the same decision endpoint',async()=>{
  const dimensions=['demand','supply','adaptation','implementation','operations','resources'] as const
  const dashboard={purpose:'校园机电服务',evidence:dimensions.map(key=>({key,source_id:'TEST-SOURCE',quote:'合成测试资料包含本栋楼的工程与运营需求。',basis:'合成测试'}))}
  const raw=response() as any
  for(const key of dimensions)raw.answers['fit_'+key]={type:'score',score:3,confidence:.9,probabilities:{0:0,1:0,2:0,3:1,4:0}}
  const transport=vi.fn(async()=>new Response(JSON.stringify(raw),{status:200}))
  const r=await evaluateDecision({...input(),dashboard},new AbortController().signal,settings,transport as typeof fetch)
  const sent=JSON.parse((transport.mock.calls[0] as unknown as [string,RequestInit])[1].body as string)
  expect(Object.keys(sent.questions)).toHaveLength(9);expect(r.dashboard?.dimensions).toHaveLength(6)
  expect(r.dashboard?.dimensions.every(d=>d.value===4)).toBe(true)
 })
 it('does not replace a concrete next action with a generic decision checklist',()=>{
  const action={id:'A',title:'提交单栋机电工程量及停电切换方案。',why:'与既有教学时间协调。',priority:1,status:'suggested',impacted_paths:['defer_and_investigate']} as any
  const r=prioritizeDecisionFollowups([action],applyDecisionGuards(result(),factors()),['defer_and_investigate'])
  expect(r[0]).toEqual(action);expect(r).toHaveLength(1)
 })
})
