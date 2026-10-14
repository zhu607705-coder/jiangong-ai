import type { DashboardInput } from './dashboard'
import type { DecisionSupport, MapDecisionFactor, MapScreenContext, ProjectInput, Followup, CandidateId } from '../../apps/host/generated/contracts'
import { decisionFactors, FACTOR_LABELS, factorLabels, projectBoundToTarget } from '../maps/decision-factors'
import { publicMapContext } from '../maps/public-context'
import { factAppliesToTarget } from '../maps/object-identity'
import { projectDashboardInput } from './project-dashboard'
import { retrofitAdvice, type RetrofitAdvice } from '../retrofit/planning'
import {NEIGHBORHOOD_DIMENSION_POLICY} from '../retrofit/policy'
import {MODEL_SIGNAL_THRESHOLDS} from './thresholds'
import { mapRenewalModeInput, projectRenewalModeInput, type RenewalModeInput } from '../retrofit/renewal-mode'
import type { MapScreenProfile } from '../../apps/host/generated/contracts'

export const DECISION_POLICY = 'structured-research-route-v1'
export const NEIGHBORHOOD_DECISION_POLICY='structured-neighborhood-route-v3-mode-first'
export const decisionPolicy=(profile?:MapScreenProfile)=>profile==='neighborhood'?NEIGHBORHOOD_DECISION_POLICY:DECISION_POLICY
export const DECISION_THRESHOLDS = MODEL_SIGNAL_THRESHOLDS.research_route
export { DECISION_ACTIONS } from './route-labels'
export const INVESTIGATION_STEPS = {
  implementation:'核查用途、权利取得与腾退条件。', adaptation:'取得结构、消防与设备条件资料。',
  demand:'调查实际使用者、到岗情况与同类空置。', operations:'核查运营主体、付费者与收入路径。',
  resources:'核查改造投入、分期资金和企业能力。', access:'实测站点到建筑入口的步行衔接。',
} as const
export const NEIGHBORHOOD_INVESTIGATION_STEPS=Object.fromEntries(NEIGHBORHOOD_DIMENSION_POLICY.map(d=>[d.key,d.investigation])) as Record<ResearchDimension,string>
export type ResearchDimension = keyof typeof FACTOR_LABELS | 'supply'
export type DecisionInput = {state: unknown; factors: MapDecisionFactor[]; sourceIds: string[]; dashboard?: DashboardInput;profile?:MapScreenProfile;neighborhoodAction?:RetrofitAdvice;renewalMode?:RenewalModeInput}
const essentials: ResearchDimension[] = ['implementation','adaptation','demand','operations','resources']

export function mapDecisionInput(context: MapScreenContext, purpose: string,profile?:MapScreenProfile): DecisionInput {
  const publicContext = publicMapContext(context)
  const factors = decisionFactors(publicContext,context.created_at,profile)
  const exactProjects=profile==='neighborhood'?publicContext.local_projects.filter(p=>p.business_profile==='neighborhood'&&projectBoundToTarget(p,publicContext.target)):[]
  const selected=exactProjects.length===1?exactProjects[0]:undefined
  const neighborhoodAction=selected&&selected.as_of?retrofitAdvice({project_id:selected.project_id,as_of:selected.as_of,synthetic:false,sources:selected.sources,facts:selected.facts}):undefined
  const projects = publicContext.local_projects.map(p => ({scope:p.relation, scope_label:p.scope_label,as_of:p.as_of,business_profile:p.business_profile,
    sources:p.sources.filter(s=>s.content_status!=='metadata_only' && !!s.untrusted_text).map(s=>({id:`${p.project_id}:${s.id}`,title:s.title,text:s.untrusted_text?.slice(0,2400),published_at:s.published_at||null})),
    facts:p.facts.filter(f=>factAppliesToTarget(f,p,publicContext.target))}))
  const places = context.groups.map(g => ({source_id:g.source_id,category:g.label,status:g.status,
    examples:g.sample.slice(0,5).map(p=>({name:p.name,category:p.category}))}))
  return {profile,...(profile==='neighborhood'?{renewalMode:mapRenewalModeInput(context)}:{}),...(neighborhoodAction?{neighborhoodAction}:{}),state:{...(neighborhoodAction?{neighborhood_action:neighborhoodAction}:{}),business_profile:profile==='neighborhood'?'neighborhood':'general',purpose,as_of:profile==='neighborhood'&&selected?.as_of?selected.as_of:context.created_at,address:context.address,scope:publicContext.target,verified_conditions:factors,
    projects,place_clues:places,missing_categories:context.groups.filter(g=>g.status==='failed').map(g=>g.label)}, factors,
    sourceIds:[...context.groups.filter(g=>g.status!=='failed').map(g=>g.source_id),...projects.flatMap(p=>p.sources.map(s=>s.id))]}
}

export function projectDecisionInput(input: ProjectInput): DecisionInput {
  // Permission for an existing text model does not implicitly expose internal
  // documents to a newly configured provider. This route accepts public facts only.
  const sources=input.sources.filter(s=>s.visibility==='public' && (s.data_class==='public' && !s.synthetic || input.synthetic && s.synthetic))
  const ids=new Set(sources.map(s=>s.id)), facts=input.facts.filter(f=>ids.has(f.source_id))
  const asOf=/^\d{4}-\d{2}-\d{2}$/.test(input.as_of) ? input.as_of+'T23:59:59.999Z' : input.as_of
  const profile=input.business_profile==='neighborhood'?'neighborhood':undefined
  const publicInput={...input,sources,facts}
  const context={created_at:asOf,target:{object_ref:`project:${input.project_id}`},local_projects:[{project_id:input.project_id,relation:'within_scope',business_profile:input.business_profile,as_of:input.as_of,sources,facts}]} as unknown as MapScreenContext
  const factors=decisionFactors(context,asOf,profile)
  const dashboard=projectDashboardInput(publicInput)
  return {profile,...(profile?{renewalMode:projectRenewalModeInput(publicInput),neighborhoodAction:retrofitAdvice(publicInput)}:{}),...(dashboard?{dashboard}:{}),state:{scope:input.scope,as_of:input.as_of,synthetic:input.synthetic,business_profile:input.business_profile||'general',purpose:input.business_profile==='neighborhood'?'老旧小区改造前期研判：居民需求、公共服务、居住工程、实施协同、长效维护、资金交付':'存量空间前期研判',verified_conditions:factors,facts,...(profile?{neighborhood_action:retrofitAdvice(publicInput)}:{}),
    sources:sources.filter(s=>s.content_status!=='metadata_only').map(s=>({id:s.id,title:s.title,...(!profile?{text:s.untrusted_text?.slice(0,2400)}:{}),published_at:s.published_at||null}))},
    factors,sourceIds:sources.filter(s=>s.content_status!=='metadata_only').map(s=>s.id)}
}

/** Model probabilities inform the route; they never manufacture source facts. */
export function applyDecisionGuards(result: DecisionSupport, factors: MapDecisionFactor[],profile?:MapScreenProfile,neighborhoodAction?:RetrofitAdvice): DecisionSupport {
  if (result.status!=='completed' || !result.answers) return structuredClone(result)
  const next=structuredClone(result), reasons:string[]=[]
  const answers=next.answers!, thresholds=next.thresholds
  let action=answers.next_action.choice as NonNullable<DecisionSupport['action']>
  let priority=answers.priority_dimension.choice as ResearchDimension
  const required=profile==='neighborhood'?Object.keys(NEIGHBORHOOD_INVESTIGATION_STEPS) as ResearchDimension[]:essentials
  const blocked=factors.find(f=>f.state==='blocked'), conflict=factors.find(f=>f.conflict), gaps=required.filter(k=>!factors.some(f=>f.key===k && f.state==='supported'))
  const uncertain=[answers.next_action,answers.priority_dimension].some(a=>a.confidence<thresholds.min_confidence || a.probabilities[a.choice]<thresholds.min_choice_probability)
  if(blocked) {action='resolve_blocker';priority=blocked.key;reasons.push('已有来源记录存在明确阻点，优先处理对应条件。')}
  else if(conflict) {action='review';priority=conflict.key;reasons.push('当前对象的来源记录存在未解决分歧，先复核对应条件。')}
  else if(gaps.length && action==='compare') {action='investigate';reasons.push('核心条件尚未形成完整依据，先补证据再比较。')}
  if(!blocked && action==='resolve_blocker') {action='investigate';reasons.push('输入没有明确阻点，模型建议按待核线索处理。')}
  if(!blocked && uncertain) {
    action=action==='review'?'review':gaps.length?'investigate':'review'
    priority=conflict?.key || gaps[0] || 'implementation'
    reasons.push('返回的置信度或选项概率未达到当前分流阈值。')
  }
  if(!blocked && action==='compare' && answers.evidence_sufficient<thresholds.min_sufficiency) {action='review';reasons.push('模型对证据充分性的判断尚不足以进入比较。')}
  if(profile==='neighborhood'&&neighborhoodAction?.decision==='supplement'&&action==='compare'){action='investigate';priority='implementation';reasons.push('本方案专业规则或前置核查仍需补齐，适配等级不能代替正式行动门。')}
  if(gaps.length && factors.some(f=>f.key===priority && f.state==='supported')) priority=gaps[0]
  next.action=action;next.priority=priority;next.guard_reasons=reasons
  next.next_step=action==='compare'?(profile==='neighborhood'?'在同一现状与资金口径下比较基础、完善、提升类改造方案。':'在同一证据口径下比较保留、改造与暂缓路径。'):action==='review'?'复核判断依据，确认关键条件后更新研究路径。':profile==='neighborhood'?NEIGHBORHOOD_INVESTIGATION_STEPS[priority as keyof typeof NEIGHBORHOOD_INVESTIGATION_STEPS]:INVESTIGATION_STEPS[priority as keyof typeof INVESTIGATION_STEPS]
  return next
}

export function prioritizeDecisionFollowups(existing:Followup[], route:DecisionSupport, paths:CandidateId[]):Followup[] {
  if(existing.length)return existing // Keep specific, source-grounded actions ahead of the generic fallback.
  if(route.status!=='completed' || !route.action || route.action==='compare' || !route.next_step) return existing
  const item:Followup={id:'decision-'+route.input_hash.slice(0,16),priority:1,title:route.next_step,
    why:route.guard_reasons[0] || `本轮判断优先核查${factorLabels(route.policy_version===NEIGHBORHOOD_DECISION_POLICY?'neighborhood':undefined)[route.priority!] }，补充依据后再更新路径。`,
    impacted_paths:paths,status:'suggested'}
  return [item,...existing.filter(old=>old.title!==item.title)].slice(0,2)
}
