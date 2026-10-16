import type {MapScreenAnalysis, MapScreenContext} from '../../apps/host/generated/contracts'
import {dashboardDimensions, dashboardPolicy} from '../decision/dashboard'

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
