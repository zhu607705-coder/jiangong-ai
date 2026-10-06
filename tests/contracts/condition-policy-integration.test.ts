import {test,expect} from 'vitest'
import fixture from '../../fixtures/inputs/01_auto.json'
import type {ProjectInput,MapScreenContext} from '../../apps/host/generated/contracts'
import {RETROFIT_CHECKS,retrofitAdvice,evaluateRetrofitConditions} from '../../packages/retrofit/planning'
import {decisionFactors} from '../../packages/maps/decision-factors'
import {dashboardDimensions,NEIGHBORHOOD_DASHBOARD_POLICY} from '../../packages/decision/dashboard'
import {NEIGHBORHOOD_COMPARISON_POLICY} from '../../packages/decision/comparison-policy'
import {buildDecisionBrief} from '../../packages/decision/brief-view'
import {assembleDecision} from '../../packages/decision/evaluate'
import {MODEL_SIGNAL_THRESHOLDS} from '../../packages/decision/thresholds'

const project=()=>({...structuredClone(fixture),business_profile:'neighborhood',synthetic:false,
  sources:[{id:'S',title:'合同行为测试原文',hash:'contract',synthetic:false,data_class:'public',visibility:'public',content_status:'full_text'}],facts:[]} as ProjectInput)
const populate=(p:ProjectInput)=>{p.facts=RETROFIT_CHECKS.map(c=>({id:c.key,kind:'retrofit.'+c.key,value:true,unit:null,source_id:'S',object_ref:'project:'+p.project_id,observed_at:p.as_of,locator:'line:1',epistemic_status:'fact'}))}
test('map, project and dashboard use the same six registered condition keys',()=>{
  const p=project();populate(p)
  const ctx={created_at:p.as_of+'T23:59:59Z',target:{object_ref:'project:'+p.project_id},local_projects:[{project_id:p.project_id,business_profile:'neighborhood',relation:'within_scope',as_of:p.as_of,sources:p.sources,facts:p.facts}]} as unknown as MapScreenContext
  expect(decisionFactors(ctx,undefined,'neighborhood').every(d=>d.state==='supported')).toBe(true)
  expect(decisionFactors(ctx,undefined,'neighborhood').map(d=>d.key)).toEqual(dashboardDimensions(NEIGHBORHOOD_DASHBOARD_POLICY).map(d=>d.key))
  p.facts=p.facts.map(f=>({...f,scope_kind:'shared',applies_to:['building:elsewhere']}))
  expect(retrofitAdvice(p).decision).toBe('supplement')
  expect(evaluateRetrofitConditions(p).unusable_fact_refs).toHaveLength(7)
  ctx.local_projects[0].facts=p.facts
  expect(decisionFactors(ctx,undefined,'neighborhood').every(d=>d.state==='unknown')).toBe(true)
})
test('new comparisons show public services and maintenance separately; historical versions keep legacy groups',()=>{
  const p=project();const packet=assembleDecision({project:p,runId:'contract',revision:1,contextVersion:0,snapshotHash:'a'.repeat(64),executionMode:'offline',results:[],artifactRefs:[],impact:{changed_rule_ids:[],invalidated:[],reused:[],changed_paths:[]},model:null})
  packet.comparison={policy_version:NEIGHBORHOOD_COMPARISON_POLICY,summary:'合同比较',criteria:dashboardDimensions(NEIGHBORHOOD_DASHBOARD_POLICY).map(d=>({criterion:d.key,judgments:packet.scenarios.map(s=>({scenario_id:s.id,conclusion:d.label+'原文判断',evidence_refs:[],unknowns:[]}))})),tied_paths:[],followups:[],unresolved_disagreements:[]}
  const themes=buildDecisionBrief(packet).paths[0].themes
  expect(themes.map(t=>t.label)).toEqual(['居民需求','公共服务','居住工程','实施协同','长效维护','资金交付'])
  delete packet.comparison.policy_version
  expect(buildDecisionBrief(packet).comparisonScope).toContain('原结果')
  expect(buildDecisionBrief(packet).paths[0].themes.some(t=>t.label==='公共服务')).toBe(false)
})
test('model signal settings retain their purposes and are not new professional business cutoffs',()=>{
  expect(MODEL_SIGNAL_THRESHOLDS.dashboard_display.min_confidence).toBe(.65)
  expect(MODEL_SIGNAL_THRESHOLDS.research_route).toEqual({min_confidence:.8,min_choice_probability:.65,min_sufficiency:.75})
})
