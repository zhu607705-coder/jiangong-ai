import type {MapScreenAnalysis, MapScreenContext} from '../../apps/host/generated/contracts'
import {dashboardDimensions, dashboardPolicy} from '../decision/dashboard'
import type {DecisionDashboard,ResearchDimension} from '../../apps/host/generated/contracts'

export type MapAnalysisAction = 'supplement' | 'reevaluate'

/** Execution, evidence coverage and snapshot currency describe different things. */
export function withAnalysisCompletion(analysis:MapScreenAnalysis,context:MapScreenContext):MapScreenAnalysis {
  const dimensions=analysis.decision_support?.dashboard?.dimensions||[]
  const missing=dashboardDimensions(dashboardPolicy(analysis.profile)).filter(row=>!dimensions.some(d=>d.key===row.key&&d.value!==null)).map(row=>row.key)
  return {...analysis,completion:{
    execution:analysis.status==='completed'?'completed':analysis.status==='failed'?'failed':'incomplete',
    evidence:missing.length===6?'missing':missing.length?'partial':'complete',
    version:analysis.refresh_required?'stale':'current',evidence_revision:context.project_revision,
    missing_dimensions:missing,
  }}
}

export function initialMapDashboard(analysis:MapScreenAnalysis|null):{dashboard:DecisionDashboard;provisionalKeys:ResearchDimension[]}|null {
  if(!analysis||analysis.refresh_required)return null
  const actual=analysis.decision_support?.dashboard,provisional=analysis.decision_support?.provisional_dashboard||analysis.provisional_dashboard
  if(!actual&&!provisional)return null
  const provisionalKeys:ResearchDimension[]=[]
  const dimensions=dashboardDimensions(dashboardPolicy(analysis.profile)).map(row=>{
    const observed=actual?.dimensions.find(item=>item.key===row.key)
    if(observed?.value!==null&&observed?.value!==undefined)return observed
    const estimate=provisional?.dimensions.find(item=>item.key===row.key)
    if(estimate?.value!==null&&estimate?.value!==undefined){provisionalKeys.push(row.key);return estimate}
    return {key:row.key,value:null,confidence:null,basis:row.question,evidence_refs:[]}
  })
  return {dashboard:{policy_version:dashboardPolicy(analysis.profile),purpose:'六维初步画像',model:provisionalKeys.length?provisional?.model||actual!.model:actual!.model,request_id:provisional?.request_id||actual?.request_id||'',status:dimensions.every(row=>row.value!==null)?'completed':'partial',dimensions},provisionalKeys}
}
