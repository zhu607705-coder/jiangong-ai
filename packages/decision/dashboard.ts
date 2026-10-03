import type { DecisionDashboard, DimensionEvidence, MapScreenProfile, ResearchDimension } from '../../apps/host/generated/contracts'
import { validProbabilityMass, compatibleExpectedScore } from './probabilities'

export const DASHBOARD_POLICY='opportunity-fit-v2'
export const NEIGHBORHOOD_DASHBOARD_POLICY='neighborhood-renovation-fit-v2'
const SAVED_NEIGHBORHOOD_POLICY='neighborhood-renovation-fit-v1'
/** Explicit registered fact semantics shared by scoring and research coverage. */
export const NEIGHBORHOOD_EVIDENCE_KINDS:Record<ResearchDimension,readonly string[]>={
  demand:['resident_needs','resident_household','resident_survey'],supply:['service_gap','public_service','public_service_capacity'],
  adaptation:['engineering_review','engineering_condition','building_inventory'],implementation:['resident_consent','implementation_scope','implementation_arrangement'],
  operations:['maintenance_arrangement','maintenance_cost'],resources:['funding_arrangement','project_budget','engineering_cost'],
}
export const DASHBOARD_DIMENSIONS:{key:ResearchDimension;label:string;question:string;levels:string[]}[]=[
  {key:'demand',label:'需求客群',question:'谁会持续使用，需求出现在哪里？',levels:['需求与方案明显冲突','仅有明确需求线索','已有使用或采购需求','明确需求与方案匹配','有持续使用和需求验证']},
  {key:'supply',label:'供给竞争',question:'现有供给能否满足需求，差异化在哪里？',levels:['同类供给明显过剩','已有同类竞争且差异弱','有可说明的差异化空间','具体供给缺口有依据','供给缺口与替代方案均经验证']},
  {key:'adaptation',label:'空间工程',question:'哪些具体空间、系统或设备适合该方案？',levels:['明确不适配','改造冲突较大','存在可研究的适配路径','对应空间与工程范围明确','方案和工程条件均已验证']},
  {key:'implementation',label:'实施入口',question:'通过采购、委托运营还是可取得的资产进入？',levels:['存在明确禁止或无法进入','尚无可识别合作入口','已有项目或合作窗口','采购或合作路径明确','当前可参与路径与资格均已确认']},
  {key:'operations',label:'运营回款',question:'谁使用、谁付费、谁负责持续运营？',levels:['付费或运营机制存在明确冲突','运营或付款主体模糊','可识别使用与付款主体','运营责任与付费安排明确','持续运营与合同回款均有验证']},
  {key:'resources',label:'投入交付',question:'投入、工期、分期及企业交付能力是否匹配？',levels:['资源与计划明确不匹配','交付或资金缺口明显','预算或分期路径有依据','预算工期与交付范围匹配','资金和交付安排均已落实']},
]
const NEIGHBORHOOD_DIMENSIONS:typeof DASHBOARD_DIMENSIONS=[
  {key:'demand',label:'居民需求',question:'哪些居民家庭的日常居住困难需要优先改善？',levels:['方案与已核实居民需求冲突','仅有居住改善线索','具体居民群体与需求已有依据','改造内容对应已确认需求','居民需求与改造使用效果均经验证']},
  {key:'supply',label:'公共服务',question:'现有养老、托育、医疗、停车及活动空间缺口如何补齐？',levels:['方案与公共服务条件冲突','服务缺口或配置依据薄弱','有可核查的服务改善方向','具体服务缺口与设施配置对应','服务供需和可达性均经验证']},
  {key:'adaptation',label:'居住工程',question:'基础、完善、提升改造与鉴定、消防、管网条件是否匹配？',levels:['已核实工程条件阻断方案','工程冲突与改造接口明显','存在可研究的工程适配路径','工程范围与鉴定等依据对应','工程条件及施工接口均已专业核验']},
  {key:'implementation',label:'实施协同',question:'居民协商、实施主体和施工期间安排是否支持推进？',levels:['已核实实施条件阻断方案','居民协商或实施责任存在明显冲突','居民协商与实施主体已有线索','实施责任、居民协商与施工安排明确','当前实施安排与所需程序均已核实']},
  {key:'operations',label:'长效维护',question:'改造后设施由谁维护，责任、费用和居民参与怎样持续？',levels:['维护机制存在明确冲突','维护责任或费用安排薄弱','已有物业或设施维护主体','维护责任、费用与居民参与明确','持续维护安排及实际履行均有验证']},
  {key:'resources',label:'资金交付',question:'资金来源、居民负担、工程成本、分期与企业交付是否匹配？',levels:['资金与交付条件明确阻断','资金或交付缺口明显','资金来源或分期路径有依据','资金、成本与交付范围匹配','资金来源和交付安排均已落实']},
]
/** Saved dashboards retain their original semantics; a profile only controls new scoring. */
export function dashboardPolicy(profile?:MapScreenProfile):string {
  return profile==='neighborhood'?NEIGHBORHOOD_DASHBOARD_POLICY:DASHBOARD_POLICY
}
export function isNeighborhoodDashboard(policy_version?:string):boolean {
  return [NEIGHBORHOOD_DASHBOARD_POLICY,SAVED_NEIGHBORHOOD_POLICY].includes(policy_version||'')
}
export function dashboardDimensions(policy_version?:string):typeof DASHBOARD_DIMENSIONS {
  return isNeighborhoodDashboard(policy_version)?NEIGHBORHOOD_DIMENSIONS:DASHBOARD_DIMENSIONS
}
export type DashboardInput={purpose:string;evidence:DimensionEvidence[];profile?:MapScreenProfile}
export function dashboardQuestions(input:DashboardInput):Record<string,unknown>{
  return Object.fromEntries(dashboardDimensions(dashboardPolicy(input.profile)).filter(d=>input.evidence.some(e=>e.key===d.key)).map(d=>['fit_'+d.key,{type:'score',instructions:`评价当前方案“${input.purpose}”的${d.label}，只用dashboard_evidence中该维度原文。${d.question} 已截止或已成交的采购只能支持历史需求和进入机制，不能视为当前可投。评分衡量方案适配，不给资料数量打分。六维等级仅用于比较同一方案，三类行动建议由证据与硬约束另行判定，不能由雷达总分推出。`,criteria:d.levels}]))
}
export function parseDashboard(raw:any,input:DashboardInput):DecisionDashboard{
  let missing=false
  const policy=dashboardPolicy(input.profile)
  const dimensions=dashboardDimensions(policy).map(d=>{
    const evidence=input.evidence.filter(e=>e.key===d.key),answer=raw.answers?.['fit_'+d.key]
    const base={key:d.key,value:null as number|null,confidence:null as number|null,evidence_refs:evidence.map(e=>e.source_id),basis:evidence[0]?.basis||''}
    if(!evidence.length){missing=true;return base}
    if(answer?.type!=='score'||!Number.isFinite(answer.score)||answer.score<0||answer.score>4||!Number.isFinite(answer.confidence)||answer.confidence<0||answer.confidence>1)throw new Error('DECISION_INVALID_RESPONSE')
    const probabilities=answer.probabilities,keys=Object.keys(probabilities||{}).sort()
    if(Array.isArray(probabilities)||keys.join()!=='0,1,2,3,4'||!validProbabilityMass(keys.map(k=>probabilities[k])))throw new Error('DECISION_INVALID_RESPONSE')
    // System One's score is the 0-based probability-weighted expected level.
    if(!compatibleExpectedScore(answer.score,keys.map(k=>probabilities[k])))throw new Error('DECISION_INVALID_RESPONSE')
    if(answer.confidence<.65){missing=true;return base}
    return {...base,value:Math.round((answer.score+1)*10)/10,confidence:answer.confidence}
  })
  return {policy_version:policy,purpose:input.purpose,dimensions,model:raw.model,request_id:raw.request_id,status:missing?'partial':'completed'}
}
