import type { DecisionDashboard, DimensionEvidence, MapScreenProfile, ResearchDimension } from '../../apps/host/generated/contracts'
import { validProbabilityMass, compatibleExpectedScore } from './probabilities'
import {NEIGHBORHOOD_DIMENSION_POLICY} from '../retrofit/policy'
import {MODEL_SIGNAL_THRESHOLDS} from './thresholds'

export const DASHBOARD_POLICY='opportunity-fit-v2'
export const NEIGHBORHOOD_DASHBOARD_POLICY='neighborhood-renovation-fit-v2'
const SAVED_NEIGHBORHOOD_POLICY='neighborhood-renovation-fit-v1'
/** One registry supplies business names, evidence kinds and required conditions. */
export const NEIGHBORHOOD_EVIDENCE_KINDS:Record<ResearchDimension,readonly string[]>=Object.fromEntries(NEIGHBORHOOD_DIMENSION_POLICY.map(d=>[d.key,d.evidenceKinds])) as Record<ResearchDimension,readonly string[]>
export const DASHBOARD_DIMENSIONS:{key:ResearchDimension;label:string;question:string;levels:string[]}[]=[
  {key:'demand',label:'需求客群',question:'谁会持续使用，需求出现在哪里？',levels:['需求与方案明显冲突','仅有明确需求线索','已有使用或采购需求','明确需求与方案匹配','有持续使用和需求验证']},
  {key:'supply',label:'供给竞争',question:'现有供给能否满足需求，差异化在哪里？',levels:['同类供给明显过剩','已有同类竞争且差异弱','有可说明的差异化空间','具体供给缺口有依据','供给缺口与替代方案均经验证']},
  {key:'adaptation',label:'空间工程',question:'哪些具体空间、系统或设备适合该方案？',levels:['明确不适配','改造冲突较大','存在可研究的适配路径','对应空间与工程范围明确','方案和工程条件均已验证']},
  {key:'implementation',label:'实施入口',question:'通过采购、委托运营还是可取得的资产进入？',levels:['存在明确禁止或无法进入','尚无可识别合作入口','已有项目或合作窗口','采购或合作路径明确','当前可参与路径与资格均已确认']},
  {key:'operations',label:'运营回款',question:'谁使用、谁付费、谁负责持续运营？',levels:['付费或运营机制存在明确冲突','运营或付款主体模糊','可识别使用与付款主体','运营责任与付费安排明确','持续运营与合同回款均有验证']},
  {key:'resources',label:'投入交付',question:'投入、工期、分期及企业交付能力是否匹配？',levels:['资源与计划明确不匹配','交付或资金缺口明显','预算或分期路径有依据','预算工期与交付范围匹配','资金和交付安排均已落实']},
]
const NEIGHBORHOOD_DIMENSIONS:typeof DASHBOARD_DIMENSIONS=NEIGHBORHOOD_DIMENSION_POLICY.map(({key,label,question,levels})=>({key,label,question,levels:[...levels]}))
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
    if(answer.confidence<MODEL_SIGNAL_THRESHOLDS.dashboard_display.min_confidence){missing=true;return base}
    return {...base,value:Math.round((answer.score+1)*10)/10,confidence:answer.confidence}
  })
  return {policy_version:policy,purpose:input.purpose,dimensions,model:raw.model,request_id:raw.request_id,status:missing?'partial':'completed'}
}
