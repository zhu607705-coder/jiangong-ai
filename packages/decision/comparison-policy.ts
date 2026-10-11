import type { ComparisonCriterion, ProjectInput } from '../../apps/host/generated/contracts'
import { dashboardDimensions, dashboardPolicy } from './dashboard'

export const NEIGHBORHOOD_COMPARISON_POLICY='neighborhood-comparison-v1'
export const LEGACY_COMPARISON_POLICY='comparison-legacy-v1'
export const LEGACY_COMPARISON_DIMENSIONS:readonly {key:ComparisonCriterion['criterion'];label:string}[]=[
  {key:'implementation',label:'实施前提'},{key:'building',label:'建筑改造'},
  {key:'demand',label:'功能需求'},{key:'organization',label:'组织节奏'},
  {key:'enterprise',label:'企业适配'},{key:'resources',label:'资源风险'},
]
type Profile=ProjectInput['business_profile']|Pick<ProjectInput,'business_profile'>
export function comparisonPolicy(profile?:Profile):string {
  return (typeof profile==='string'?profile:profile?.business_profile)==='neighborhood'
    ?NEIGHBORHOOD_COMPARISON_POLICY:LEGACY_COMPARISON_POLICY
}
/** New neighborhood comparisons share the dashboard's registered business dimensions.
 * Historical results without a policy continue to use the legacy interpretation. */
export function comparisonDimensions(project:Pick<ProjectInput,'business_profile'>) {
  return project.business_profile==='neighborhood'
    ?dashboardDimensions(dashboardPolicy('neighborhood')).map(({key,label,question})=>({key,label,question}))
    :LEGACY_COMPARISON_DIMENSIONS
}
