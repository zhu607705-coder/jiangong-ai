import {expect,it,vi} from 'vitest'
import type {MapScreenAnalysis,MapScreenContext} from '../../apps/host/generated/contracts'
import {evaluateDecision} from '../../services/capabilities/decision-model'
import {mapDecisionInput} from '../../packages/decision/structured-route'
import {initialMapDashboard,withAnalysisCompletion} from '../../packages/maps/analysis-completion'
import {decisionResearchPlan} from '../../packages/decision/fast-analysis'

const settings={apiKey:'fixture-key',endpoint:'https://maas.qianwenaiapi.com/compatible-mode/v1',model:'decision-model-preview'}
const context:MapScreenContext={id:'MAPCTX-TEST',created_at:new Date().toISOString(),expires_at:'2099-01-01T00:00:00Z',provider:'amap',coordinate_encoding:'GCJ-02',status:'partial',gaps:[],metric_note:'隔离测试',address:'杭州 · 隔离测试位置',city:'杭州',project_revision:'fixture-v1',target:{kind:'point',longitude:120.1,latitude:30.2,radius_m:800,bounds:null,label:'隔离测试小区',label_origin:'public'},groups:[],local_projects:[]}
const scores:Record<string,number>={demand:.6,supply:1.8,adaptation:2.2,implementation:1.3,operations:2.9,resources:.4}
function response(body:any,invalidKey?:string){
  const answers=Object.fromEntries(Object.entries(body.questions).map(([key,value])=>{
    const question=value as any
    if(question.type==='score'){
      const dimension=key.replace(/^(estimate_)?fit_/,''),score=scores[dimension]??2
      return [key,{type:'score',score:key===invalidKey?'invalid':score,confidence:.35,probabilities:Object.fromEntries([0,1,2,3,4].map(n=>[String(n),n===Math.floor(score)?1-score%1:n===Math.ceil(score)?score%1:0]))}]
    }
    if(question.type==='noul')return [key,{type:'noul',noul:.99}]
    const options=Object.keys(question.criteria)
    const choice=key==='next_action'?'compare':key==='priority_dimension'?'demand':key.startsWith('research_effort_')?(key.endsWith('building_delivery')?'deep':key.endsWith('cost_value')?'standard':'brief'):options[0]
    return [key,{type:'choice',choice,confidence:.95,probabilities:Object.fromEntries(options.map(option=>[option,option===choice?1:0]))}]
  }))
  return {model:'decision-model-preview',request_id:'FAST-REQUEST',answers,usage:{input_tokens:1234}}
}
function input(){const value=mapDecisionInput(context,'老旧小区改造','neighborhood');return {...value,dashboard:{purpose:'老旧小区改造',profile:'neighborhood' as const,evidence:[]},estimation:{purpose:'老旧小区改造',profile:'neighborhood' as const,context:{city:'杭州',target:context.target}},researchPlanning:true}}

it('returns varied provisional scores without evidence and completes routing in the same Decision request',async()=>{
  const transport=vi.fn(async(_url:unknown,init:any)=>new Response(JSON.stringify(response(JSON.parse(init.body)))))
  const result=await evaluateDecision(input(),new AbortController().signal,settings,transport as typeof fetch)
  expect(transport).toHaveBeenCalledTimes(1)
  const body=JSON.parse(transport.mock.calls[0][1].body)
  expect(body.questions).toHaveProperty('estimate_fit_demand')
  expect(body.questions).toHaveProperty('priority_dimension')
  expect(body.questions).toHaveProperty('research_effort_building_delivery')
  expect(body.state.conditional_estimation.kind).toBe('hypotheses_not_facts')
  expect(result.status).toBe('completed')
  expect(result.provisional_dashboard?.dimensions.map(row=>row.value)).toEqual([1.6,2.8,3.2,2.3,3.9,1.4])
  expect(result.provisional_dashboard?.dimensions.every(row=>row.basis.includes('情景假设')&&row.basis.includes('补查重点')&&!row.evidence_refs.length)).toBe(true)
  expect(result.action).toBe('investigate')
  expect(result.research_routing?.tasks.map(row=>row.effort)).toEqual(['deep','standard','brief'])
  const analysis:MapScreenAnalysis={context_id:context.id,profile:'neighborhood',status:'completed',assessment:null,model_calls:[],reason:null,created_at:context.created_at,decision_support:result}
  expect(withAnalysisCompletion(analysis,context).completion?.evidence).toBe('missing')
  expect(initialMapDashboard(analysis)?.provisionalKeys).toHaveLength(6)
})

it('retains other provisional dimensions when one score is malformed instead of inventing its value',async()=>{
  const result=await evaluateDecision(input(),new AbortController().signal,settings,async(_url,init)=>new Response(JSON.stringify(response(JSON.parse(String(init?.body)),'estimate_fit_demand'))))
  expect(result.status).toBe('completed')
  expect(result.provisional_dashboard?.dimensions.find(row=>row.key==='demand')?.value).toBeNull()
  expect(result.provisional_dashboard?.dimensions.filter(row=>row.value!==null)).toHaveLength(5)
})

it('constructs task references only from the frozen source list selected for the current run',async()=>{
  const result=await evaluateDecision(input(),new AbortController().signal,settings,async(_url,init)=>new Response(JSON.stringify(response(JSON.parse(String(init?.body))))))
  const source={id:'CURRENT',title:'本次原文',text:'本对象设施维护与资金安排。',role:'current' as const,locator:'line:1',url:null,published_at:null}
  const plan=decisionResearchPlan(result.research_routing!,[source],'测试小区')
  expect(plan?.tasks.every(task=>task.source_ids.length===1&&task.source_ids[0]==='CURRENT')).toBe(true)
  expect(plan?.tasks.map(task=>task.role)).toEqual(['building_delivery','cost_value','residents_operations'])
})
