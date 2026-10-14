import { describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import fixture from '../../fixtures/inputs/01_auto.json'
import type { ProjectInput, Source, Fact, MapScreenContext, MapScreenTarget, MapScreenCell } from '../../apps/host/generated/contracts'
import { RETROFIT_CHECKS, retrofitAdvice } from '../../packages/retrofit/planning'
import { factorLabels, decisionFactors, neighborhoodMapAdvice } from '../../packages/maps/decision-factors'
import { classifyCells } from '../../packages/maps/screening-policy'
import { publicMapContext } from '../../packages/maps/public-context'
import { mapDecisionInput, projectDecisionInput, DECISION_POLICY, NEIGHBORHOOD_DECISION_POLICY } from '../../packages/decision/structured-route'
import { dashboardDimensions, DASHBOARD_POLICY, NEIGHBORHOOD_DASHBOARD_POLICY } from '../../packages/decision/dashboard'
import { evaluateDecision, decisionQuestions } from '../../services/capabilities/decision-model'
import { evidenceAt, loadProjectEvidence } from '../../services/map-screening/project-evidence'

const asOf='2026-09-30'
const fact=(key:string,source_id=key):Fact=>({id:key,kind:'retrofit.'+key,value:true,unit:null,source_id,object_ref:'project:P1',scope_kind:'project',epistemic_status:'fact',observed_at:asOf,locator:'line:1'})
function project():ProjectInput {
  const sources:Source[]=RETROFIT_CHECKS.map(check=>{
    const text=`甲小区${check.label}已完成本方案核查并保留适用范围原文。`
    return {id:check.key,title:`甲小区${check.label}核查`,url:'https://example.gov.cn/notice',visibility:'public',data_class:'public',synthetic:false,content_status:'full_text',hash:createHash('sha256').update(text).digest('hex'),untrusted_text:text,published_at:'2026-09-20',date_status:'verified',object_refs:['project:P1'],evidence_scope:'object'}
  })
  return {...structuredClone(fixture),project_id:'P1',synthetic:false,business_profile:'neighborhood',as_of:asOf,sources,facts:RETROFIT_CHECKS.map(check=>fact(check.key)),context_rules:[],scope:{...fixture.scope,name:'甲小区',city:'杭州市',map_anchor:{longitude:120.1,latitude:30.2,coordinate_encoding:'GCJ-02',provider:'amap',name:'甲小区'}}} as ProjectInput
}
const target=(object_ref='project:P1'):MapScreenTarget=>({kind:'point',longitude:120.1,latitude:30.2,radius_m:200,bounds:null,label:'甲小区',label_origin:'public',object_ref})
function snapshot(p:ProjectInput){return {revision:'TEST',syntheticCount:0,projects:[{project:{id:p.project_id,name:'甲小区',input:p,context_version:1,updated_at:'2026-09-30T12:00:00Z'},sources:p.sources,documentCount:0}]} as Parameters<typeof evidenceAt>[0]}
function context(p:ProjectInput,t=target()):MapScreenContext {
  return {id:'MAPCTX-test',created_at:asOf+'T23:59:59Z',target:t,address:'杭州市甲小区',city:'杭州市',groups:[],local_projects:evidenceAt(snapshot(p),t,'杭州市'),provider:'amap',coordinate_encoding:'GCJ-02',expires_at:'2026-10-01T00:10:00Z',project_revision:'TEST',status:'complete',gaps:[],metric_note:'test'}
}
const highDashboard={policy_version:NEIGHBORHOOD_DASHBOARD_POLICY,purpose:'测试方案',model:'decision-model-preview',request_id:'TEST',status:'completed',dimensions:['demand','supply','adaptation','implementation','operations','resources'].map(key=>({key,value:5,confidence:1,evidence_refs:[],basis:'synthetic protocol fixture'}))} as any
const cell=(ctx:MapScreenContext):MapScreenCell=>({id:'cell',context:ctx,dashboard:highDashboard} as MapScreenCell)
const choices=['demand','supply','adaptation','implementation','operations','resources']
function response(){return {model:'decision-model-preview',request_id:'TEST',usage:{input_tokens:80},answers:{next_action:{type:'choice',choice:'compare',confidence:.95,probabilities:{investigate:.01,resolve_blocker:.01,compare:.97,review:.01}},priority_dimension:{type:'choice',choice:'supply',confidence:.95,probabilities:Object.fromEntries(choices.map(k=>[k,k==='supply'?.95:.01]))},evidence_sufficient:{type:'noul',noul:.95},...Object.fromEntries(choices.map(k=>['fit_'+k,{type:'score',score:4,confidence:.95,probabilities:{0:0,1:0,2:0,3:0,4:1}}]))}}}
async function protocolResponse(_url:unknown,init?:RequestInit) {
  const body=JSON.parse(String(init?.body)),value:any=response()
  for(const [id,selected] of [['renewal_mode','comprehensive'],['renewal_priority','safety'],['renewal_evidence','object_source_1']]) {
    const question=body.questions[id]
    if(!question)continue
    const keys=Object.keys(question.criteria),choice=keys.includes(selected)?selected:'no_object_evidence'
    value.answers[id]={type:'choice',choice,confidence:.95,probabilities:Object.fromEntries(keys.map(key=>[key,key===choice?.9:.1/(keys.length-1)]))}
  }
  return new Response(JSON.stringify(value))
}
const settings={apiKey:'test-not-real',endpoint:'https://maas.qianwenaiapi.com/compatible-mode/v1',model:'decision-model-preview'}

describe('one neighborhood policy at map and project boundaries',()=>{
  it.each(['proceed','supplement','defer'] as const)('projects the same %s action; high fit cannot change its color',decision=>{
    const p=project()
    if(decision==='supplement')p.facts=p.facts.filter(f=>f.kind!=='retrofit.funding_confirmed')
    if(decision==='defer')p.facts.push(fact('safety_veto','engineering_review_passed'))
    const ctx=context(p),advice=retrofitAdvice(p)
    expect(neighborhoodMapAdvice(ctx)).toEqual(advice)
    expect(ctx.local_projects[0].as_of).toBe(p.as_of)
    expect(classifyCells([cell(ctx)],'overall',ctx.created_at,'neighborhood')[0].tier).toBe({proceed:'strong',supplement:'moderate',defer:'sparse'}[decision])
  })
  it.each(['amap:other-building','project:other',undefined])('does not spread a project gate to nearby %s',object_ref=>{
    const p=project();p.facts.push(fact('safety_veto','engineering_review_passed'))
    const t=target();if(object_ref)t.object_ref=object_ref;else delete t.object_ref
    const ctx=context(p,t)
    expect(ctx.local_projects).toHaveLength(1)
    expect(ctx.local_projects[0].neighborhood_action).toBeUndefined()
    expect(decisionFactors(ctx,ctx.created_at,'neighborhood').every(f=>f.state==='unknown')).toBe(true)
    expect(classifyCells([cell(ctx)],'overall',ctx.created_at,'neighborhood')[0].tier).toBe('incomplete')
  })
  it.each([{hash:undefined},{published_at:'2099-01-01'},{expires_at:'2026-09-01'},{date_status:'conflict'},{content_status:'metadata_only'}])('uses the same formal source validity for map and project %j',patch=>{
    const p=project();Object.assign(p.sources[0],patch)
    const ctx=context(p)
    expect(neighborhoodMapAdvice(ctx)?.decision).toBe(retrofitAdvice(p).decision)
    expect(decisionFactors(ctx,ctx.created_at,'neighborhood').find(f=>f.key==='demand')?.state).toBe('unknown')
  })
  it('rejects contradictory explicit project/boundary identities',()=>{
    const p=project(),t={...target(),boundary_source:'project:other'},ctx=context(p,t)
    expect(neighborhoodMapAdvice(ctx)).toBeUndefined()
    expect(decisionFactors(ctx,undefined,'neighborhood').every(f=>f.state==='unknown')).toBe(true)
  })
  it('keeps an old but still-valid confirmation under the explicit project time',()=>{
    const p=project();p.sources.forEach(s=>s.published_at='2024-01-01');p.facts.forEach(f=>f.observed_at='2024-01-01')
    expect(retrofitAdvice(p).decision).toBe('proceed')
    expect(decisionFactors(context(p),undefined,'neighborhood').every(f=>f.state==='supported')).toBe(true)
  })
  it('deletes private-derived advice before public model/handoff projections',()=>{
    const p=project(),funding=p.sources.find(s=>s.id==='funding_confirmed')!
    Object.assign(funding,{visibility:'internal',data_class:'internal',untrusted_text:'PRIVATE_ACTION_CANARY'})
    const ctx=context(p)
    expect(neighborhoodMapAdvice(ctx)?.decision).toBe('proceed')
    const clean=publicMapContext(ctx),input=mapDecisionInput(ctx,'甲小区改造','neighborhood')
    expect(clean.local_projects[0].neighborhood_action).toBeUndefined()
    expect(JSON.stringify(clean)).not.toContain('PRIVATE_ACTION_CANARY')
    expect(JSON.stringify(input)).not.toContain('PRIVATE_ACTION_CANARY')
    expect(input.neighborhoodAction?.decision).toBe('supplement')
    expect(input.neighborhoodAction?.reasons.flatMap(r=>r.evidence_refs)).not.toContain('funding_confirmed')
  })
  it('invalidates evidence revision when only business profile, time or source version changes',async()=>{
    const p=project(),record={id:p.project_id,input:p,context_version:1,updated_at:'2026-09-30'}
    const store={projects:async()=>[record],runs:async()=>[],db:{query:async()=>({rows:[{count:0}]})}} as any
    const first=(await loadProjectEvidence(store,'owner')).revision
    p.business_profile='general';expect((await loadProjectEvidence(store,'owner')).revision).not.toBe(first)
    p.business_profile='neighborhood';p.as_of='2026-09-29';expect((await loadProjectEvidence(store,'owner')).revision).not.toBe(first)
    p.as_of=asOf;p.sources[0].hash='new-version';expect((await loadProjectEvidence(store,'owner')).revision).not.toBe(first)
  })
})

describe('source-bound project scoring and research route',()=>{
  it('sends six fit questions and profile-specific priority choices through the existing transport',async()=>{
    const input=projectDecisionInput(project()),transport=vi.fn(protocolResponse)
    expect(input.dashboard?.evidence).toHaveLength(6)
    const result=await evaluateDecision(input,new AbortController().signal,settings,transport as typeof fetch)
    const body=JSON.parse((transport.mock.calls[0] as unknown as [string,RequestInit])[1].body as string)
    expect(Object.keys(body.questions)).toHaveLength(12)
    expect(body.questions).toHaveProperty('renewal_mode');expect(body.questions).toHaveProperty('renewal_priority');expect(body.questions).toHaveProperty('renewal_evidence')
    expect(Object.keys(body.questions.priority_dimension.criteria)).toEqual(choices)
    expect(JSON.stringify(body.questions.priority_dimension)).not.toMatch(/到岗|空置|收入路径/)
    expect(result.status).toBe('completed');expect(result.policy_version).toBe(NEIGHBORHOOD_DECISION_POLICY)
    expect(result.dashboard?.dimensions.every(d=>d.value===5)).toBe(true)
    expect(result.priority).toBe('supply')
  })
  it.each(['internal','missing-locator','wrong-object','future','wrong-quote','background','missing-hash','expired','missing-source','other-line'])('does not score invalid %s evidence or fill null with zero',variant=>{
    const p=project(),f=p.facts[0],s=p.sources[0]
    if(variant==='internal')Object.assign(s,{visibility:'internal',data_class:'internal'})
    if(variant==='missing-locator')delete f.locator
    if(variant==='wrong-object')f.object_ref='project:other'
    if(variant==='future')f.observed_at='2099-01-01'
    if(variant==='wrong-quote')s.untrusted_text='乙小区的居民需求调查，不是甲小区资料。'
    if(variant==='background')s.evidence_scope='background'
    if(variant==='missing-hash')delete s.hash
    if(variant==='expired')s.expires_at='2026-09-29'
    if(variant==='missing-source')f.source_id='NO-SUCH-SOURCE'
    if(variant==='other-line'){s.untrusted_text='乙小区记录。\n'+s.untrusted_text;f.locator='line:1'}
    const input=projectDecisionInput(p),question=decisionQuestions(input.profile)
    expect(input.dashboard?.evidence.some(e=>e.key==='demand')).toBe(false)
    expect(input.dashboard?.evidence).toHaveLength(5)
    expect(question.priority_dimension.criteria.supply).toContain('公共')
  })
  it('keeps the unrequested demand score null even if the provider includes extra answers',async()=>{
    const p=project();delete p.facts[0].locator
    const input=projectDecisionInput(p),transport=vi.fn(protocolResponse)
    const out=await evaluateDecision(input,new AbortController().signal,settings,transport as typeof fetch)
    const body=JSON.parse((transport.mock.calls[0] as unknown as [string,RequestInit])[1].body as string)
    expect(body.questions).not.toHaveProperty('fit_demand')
    expect(out.dashboard?.dimensions.find(d=>d.key==='demand')?.value).toBeNull()
    expect(out.dashboard?.status).toBe('partial')
  })
  it.each(['page:999','table:9/row:999','arbitrary-locator'])('rejects unsupported locator %s even when the string occurs in the source',locator=>{
    const p=project();Object.assign(p.facts[0],{kind:'resident_needs',value:p.sources[0].untrusted_text,locator})
    expect(projectDecisionInput(p).dashboard?.evidence.some(e=>e.key==='demand')).toBe(false)
    p.facts[0].locator='line:1'
    expect(projectDecisionInput(p).dashboard?.evidence.some(e=>e.key==='demand')).toBe(true)
  })
  it('does not treat a document title as scoring evidence',()=>{
    const p=project();p.sources[0].untrusted_text=p.sources[0].title
    expect(projectDecisionInput(p).dashboard?.evidence.some(e=>e.key==='demand')).toBe(false)
  })
  it('leaves all six unknown when no located facts are available',()=>{
    const p=project();p.facts=[]
    const input=projectDecisionInput(p)
    expect(input.dashboard?.evidence).toEqual([])
    expect(input.factors.every(f=>f.state==='unknown')).toBe(true)
  })
  it('keeps a safety veto despite six high model grades',async()=>{
    const p=project();p.facts.push(fact('safety_veto','engineering_review_passed'))
    const out=await evaluateDecision(projectDecisionInput(p),new AbortController().signal,settings,protocolResponse)
    expect(out.status).toBe('completed');expect(out.action).toBe('resolve_blocker');expect(out.priority).toBe('adaptation')
    expect(retrofitAdvice(p).decision).toBe('defer')
    expect(out.dashboard?.dimensions.every(d=>d.value===5)).toBe(true)
  })
  it('keeps conflicting vetoes conditional instead of inventing safety clearance',()=>{
    const p=project();p.facts.push(fact('safety_veto','engineering_review_passed'),{...fact('safety_veto','engineering_review_passed'),id:'conflict',value:false})
    expect(retrofitAdvice(p).decision).toBe('supplement')
    const engineer=decisionFactors(context(p),undefined,'neighborhood').find(f=>f.key==='adaptation')!
    expect(engineer.state).toBe('conditional');expect(engineer.conflict).toBe(true)
  })
  it('does not let an independent rights veto turn conflicting safety claims into a safety veto',async()=>{
    const p=project();p.facts.push(fact('safety_veto','engineering_review_passed'),{...fact('safety_veto','engineering_review_passed'),id:'conflict',value:false},fact('rights_veto','scope_and_consent_confirmed'))
    const advice=retrofitAdvice(p),factors=decisionFactors(context(p),undefined,'neighborhood')
    expect(advice.decision).toBe('defer');expect(advice.reasons[0].text).toContain('权属')
    expect(factors.find(f=>f.key==='adaptation')).toMatchObject({state:'conditional',conflict:true})
    expect(factors.find(f=>f.key==='implementation')).toMatchObject({state:'blocked'})
    const out=await evaluateDecision(projectDecisionInput(p),new AbortController().signal,settings,protocolResponse)
    expect(out.action).toBe('resolve_blocker');expect(out.priority).toBe('implementation')
  })
  it('cannot use fit to waive the independent professional rule confirmation',async()=>{
    const p=project();p.facts=p.facts.filter(f=>f.kind!=='retrofit.rule_set_confirmed')
    const out=await evaluateDecision(projectDecisionInput(p),new AbortController().signal,settings,protocolResponse)
    expect(out.status).toBe('completed');expect(out.action).toBe('investigate')
    expect(out.next_step).toContain('专业规则')
    expect(out.dashboard?.dimensions.every(d=>d.value===5)).toBe(true)
  })
  it('retains ordinary labels, factors, question choices and saved dashboard semantics',()=>{
    const p=project();p.business_profile='general'
    const input=projectDecisionInput(p)
    expect(input.dashboard).toBeUndefined();expect(input.profile).toBeUndefined();expect(input.factors).toHaveLength(6)
    expect(input.factors.every(f=>f.state==='unknown')).toBe(true)
    expect(decisionQuestions().priority_dimension.criteria).toHaveProperty('access')
    expect(decisionQuestions().priority_dimension.criteria).not.toHaveProperty('supply')
    expect(DECISION_POLICY).toBe('structured-research-route-v1')
    expect(factorLabels().operations).toBe('运营组织')
    expect(dashboardDimensions(DASHBOARD_POLICY)[0].label).toBe('需求客群')
    expect(dashboardDimensions('neighborhood-renovation-fit-v1')[0].label).toBe('居民需求')
  })
})
