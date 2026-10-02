import type { DashboardInput } from './dashboard'
import type { DecisionSupport, MapDecisionFactor, MapScreenContext, ProjectInput, Followup, CandidateId } from '../../apps/host/generated/contracts'
import { decisionFactors, FACTOR_LABELS } from '../maps/decision-factors'
import { publicMapContext } from '../maps/public-context'
import { factAppliesToTarget } from '../maps/object-identity'

export const DECISION_POLICY = 'structured-research-route-v1'
export const DECISION_THRESHOLDS = {min_confidence: 0.8, min_choice_probability: 0.65, min_sufficiency: 0.75}
export const DECISION_ACTIONS = {investigate:'先补证据', resolve_blocker:'先核查阻点', compare:'进入路径比较', review:'复核判断'} as const
export const INVESTIGATION_STEPS = {
  implementation:'核查用途、权利取得与腾退条件。', adaptation:'取得结构、消防与设备条件资料。',
  demand:'调查实际使用者、到岗情况与同类空置。', operations:'核查运营主体、付费者与收入路径。',
  resources:'核查改造投入、分期资金和企业能力。', access:'实测站点到建筑入口的步行衔接。',
} as const
export type ResearchDimension = keyof typeof FACTOR_LABELS
export type DecisionInput = {state: unknown; factors: MapDecisionFactor[]; sourceIds: string[]; dashboard?: DashboardInput}
const essentials: ResearchDimension[] = ['implementation','adaptation','demand','operations','resources']

export function mapDecisionInput(context: MapScreenContext, purpose: string): DecisionInput {
  const publicContext = publicMapContext(context)
  const factors = decisionFactors(publicContext)
  const projects = publicContext.local_projects.map(p => ({scope:p.relation, scope_label:p.scope_label,
    sources:p.sources.filter(s=>s.content_status!=='metadata_only' && !!s.untrusted_text).map(s=>({id:`${p.project_id}:${s.id}`,title:s.title,text:s.untrusted_text?.slice(0,2400),published_at:s.published_at||null})),
    facts:p.facts.filter(f=>factAppliesToTarget(f,p,publicContext.target))}))
  const places = context.groups.map(g => ({source_id:g.source_id,category:g.label,status:g.status,
    examples:g.sample.slice(0,5).map(p=>({name:p.name,category:p.category}))}))
  return {state:{purpose,as_of:context.created_at,address:context.address,scope:publicContext.target,verified_conditions:factors,
    projects,place_clues:places,missing_categories:context.groups.filter(g=>g.status==='failed').map(g=>g.label)}, factors,
    sourceIds:[...context.groups.filter(g=>g.status!=='failed').map(g=>g.source_id),...projects.flatMap(p=>p.sources.map(s=>s.id))]}
}

export function projectDecisionInput(input: ProjectInput): DecisionInput {
  // Permission for an existing text model does not implicitly expose internal
  // documents to a newly configured provider. This route accepts public facts only.
  const sources=input.sources.filter(s=>s.visibility==='public' && (s.data_class==='public' && !s.synthetic || input.synthetic && s.synthetic))
  const ids=new Set(sources.map(s=>s.id)), facts=input.facts.filter(f=>ids.has(f.source_id))
  const asOf=/^\d{4}-\d{2}-\d{2}$/.test(input.as_of) ? input.as_of+'T23:59:59.999Z' : input.as_of
  const context={created_at:asOf,local_projects:[{project_id:input.project_id,relation:'within_scope',sources,facts}]} as MapScreenContext
  const factors=decisionFactors(context)
  return {state:{scope:input.scope,as_of:input.as_of,synthetic:input.synthetic,business_profile:input.business_profile||'general',purpose:input.business_profile==='neighborhood'?'老旧小区改造前期研判：居民需求、公共服务、居住工程、实施协同、长效维护、资金交付':'片区投资前期研判',verified_conditions:factors,facts,
    sources:sources.filter(s=>s.content_status!=='metadata_only').map(s=>({id:s.id,title:s.title,text:s.untrusted_text?.slice(0,2400),published_at:s.published_at||null}))},
    factors,sourceIds:sources.filter(s=>s.content_status!=='metadata_only').map(s=>s.id)}
}

/** Model probabilities inform the route; they never manufacture source facts. */
export function applyDecisionGuards(result: DecisionSupport, factors: MapDecisionFactor[]): DecisionSupport {
  if (result.status!=='completed' || !result.answers) return structuredClone(result)
  const next=structuredClone(result), reasons:string[]=[]
  const answers=next.answers!, thresholds=next.thresholds
  let action=answers.next_action.choice as NonNullable<DecisionSupport['action']>
  let priority=answers.priority_dimension.choice as ResearchDimension
  const blocked=factors.find(f=>f.state==='blocked'), conflict=factors.find(f=>f.conflict), gaps=essentials.filter(k=>!factors.some(f=>f.key===k && f.state==='supported'))
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
  if(gaps.length && factors.some(f=>f.key===priority && f.state==='supported')) priority=gaps[0]
  next.action=action;next.priority=priority;next.guard_reasons=reasons
  next.next_step=action==='compare'?'在同一证据口径下比较保留、改造与暂缓路径。':action==='review'?'复核判断依据，确认关键条件后更新研究路径。':INVESTIGATION_STEPS[priority]
  return next
}

export function prioritizeDecisionFollowups(existing:Followup[], route:DecisionSupport, paths:CandidateId[]):Followup[] {
  if(existing.length)return existing // Keep specific, source-grounded actions ahead of the generic fallback.
  if(route.status!=='completed' || !route.action || route.action==='compare' || !route.next_step) return existing
  const item:Followup={id:'decision-'+route.input_hash.slice(0,16),priority:1,title:route.next_step,
    why:route.guard_reasons[0] || `本轮判断优先核查${FACTOR_LABELS[route.priority!] }，补充依据后再更新路径。`,
    impacted_paths:paths,status:'suggested'}
  return [item,...existing.filter(old=>old.title!==item.title)].slice(0,2)
}
