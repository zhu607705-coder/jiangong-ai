import type {DecisionDashboard,DecisionResearchRouting,MapScreenProfile,RenewalResearchPlan,ResearchDimension,RenewalReasonedDimension} from '../../apps/host/generated/contracts'
import {dashboardDimensions,dashboardPolicy} from './dashboard'
import {completeProbabilityMap,compatibleExpectedScore} from './probabilities'
import {queryScore} from '../intelligence/domain'
import type {StrategySource} from '../retrofit/strategy'
import {DEFAULT_RESEARCH_QUESTIONS} from '../retrofit/research-coverage'

export type EstimationInput={purpose:string;profile?:MapScreenProfile;context?:unknown}
const assumptions:Record<ResearchDimension,string>={
  demand:'以既有居民日常使用与适老需求作为比较情景，用问卷和实际使用量回填。',
  supply:'以现有公共服务可持续使用并逐步补足缺口作为情景，用容量和覆盖台账回填。',
  adaptation:'暂比较设施与空间的改善潜力，结构、消防等专业条件另按鉴定与设计核对。',
  implementation:'以依法协商并明确责任主体的筹备情景比较，用权属、决议与实施安排回填。',
  operations:'以形成持续服务与运维责任为情景，用合同、服务量和实际收支回填。',
  resources:'以分期筹资和控制投入为比较情景，用同口径预算、资金安排和到账资料回填。',
}
export function estimationScenarios(input:EstimationInput){return dashboardDimensions(dashboardPolicy(input.profile)).map(row=>({key:row.key,question:row.question,assumption:input.profile==='neighborhood'?assumptions[row.key]:`以当前参与方案依法实施、持续使用和正常交付为比较情景。${row.question}`}))}
export function provisionalQuestions(input:EstimationInput,evidenceKeys:readonly ResearchDimension[]=[]){
  return Object.fromEntries(dashboardDimensions(dashboardPolicy(input.profile)).filter(row=>!evidenceKeys.includes(row.key)).map(row=>['estimate_fit_'+row.key,{type:'score',
    instructions:`这是初步推理暂估，不是本对象已核验现况。依据conditional_estimation中的对象、线索和显式情景，按同一标准给出可供初筛比较的暂估等级。${row.question} 缺原文不等于拒绝暂估；资料少时保留等级分布的不确定性。不得默认中间分，不编造人口、楼龄、鉴定、资金或表决事实；分数不授权施工或拆建。`,criteria:row.levels}]))
}
export function parseProvisionalDashboard(raw:any,input:EstimationInput,evidenceKeys:readonly ResearchDimension[]=[],scored?:DecisionDashboard):DecisionDashboard {
  const scenarios=estimationScenarios(input),rows=dashboardDimensions(dashboardPolicy(input.profile))
  const dimensions=rows.map(row=>{
    const base={key:row.key,value:null as number|null,confidence:null as number|null,evidence_refs:[] as string[],basis:''}
    if(scored?.dimensions.some(value=>value.key===row.key&&value.value!==null))return base
    const answer=raw.answers?.[(evidenceKeys.includes(row.key)?'fit_':'estimate_fit_')+row.key]
    const distribution=completeProbabilityMap(answer?.probabilities,['0','1','2','3','4'])
    if(answer?.type!=='score'||!Number.isFinite(answer.score)||answer.score<0||answer.score>4||!Number.isFinite(answer.confidence)||answer.confidence<0||answer.confidence>1||!distribution||!compatibleExpectedScore(answer.score,Object.values(distribution)))return base
    const premise=evidenceKeys.includes(row.key)?'本项已有对应原文，但本轮等级确定性偏低，先保留为参考估分。':`情景假设：${scenarios.find(scenario=>scenario.key===row.key)!.assumption}`
    return {...base,value:Math.round((answer.score+1)*10)/10,confidence:answer.confidence,
      basis:`推理暂估\n比较目标：${input.purpose}\n${premise}\n对应标准：${row.levels[Math.round(answer.score)]}\n补查重点：${row.question}`}
  })
  return {policy_version:dashboardPolicy(input.profile),purpose:'六维初步推理暂估',model:raw.model,request_id:raw.request_id,status:dimensions.every(row=>row.value!==null)?'completed':'partial',dimensions}
}

export function reasonedProvisionalDashboard(rows:readonly RenewalReasonedDimension[],profile:MapScreenProfile,purpose:string,model:string,requestId:string):DecisionDashboard {
  const values={low:1,medium:3,high:5},seen=new Set<string>()
  const dimensions=rows.filter(row=>!seen.has(row.key)&&!!seen.add(row.key)&&(row.basis!=='scenario_assumption'||row.assumptions.length>0)).map(row=>({key:row.key,value:values[row.level],confidence:null,evidence_refs:row.evidence_refs,
    basis:`推理暂估\n比较目标：${purpose}\n已知前提：${row.premises.join('；')}\n情景假设：${row.assumptions.join('；')}\n评分理由：${row.reason}\n补查重点：${row.verification}`}))
  return {policy_version:dashboardPolicy(profile),purpose:'六维初步推理暂估',model,request_id:requestId,status:dimensions.length===6?'completed':'partial',dimensions}
}

export const RESEARCH_ROLES=['building_delivery','cost_value','residents_operations'] as const
export const ROUTING_CRITERIA={skip:'本轮不需要该专题独立研究；其结论不影响当前决策。',brief:'做简短条件分析即可；缺少资料但仍须提出可验证思路。',standard:'需要核对对象原文并给出具体措施。',deep:'存在关键冲突或复杂约束，需要深入研究并保留更多输出空间。'}
const roleQuestions={building_delivery:'具体整治对象、工程措施与实施顺序',cost_value:'分阶段投入、资金安排与财务及社会效果',residents_operations:'居民需求、公共服务容量及后续运营'}
export const researchRoutingQuestions=()=>Object.fromEntries(RESEARCH_ROLES.map(role=>['research_effort_'+role,{type:'choice',instructions:`决定本轮“${roleQuestions[role]}”需要多少研究力度，仅作任务分流。资料缺少但该问题影响取舍时仍应选brief/standard/deep做条件分析，不因零命中直接跳过。不得把情景假设当成实施条件已满足。`,criteria:ROUTING_CRITERIA}]))

/** Decision chooses work depth; the host attaches only this frozen run's permitted sources. */
export function decisionResearchPlan(route:DecisionResearchRouting,sources:readonly StrategySource[],projectName:string):RenewalResearchPlan|null {
  if(route.policy!=='decision-research-routing-v1'||route.tasks.length!==3||new Set(route.tasks.map(task=>task.role)).size!==3||RESEARCH_ROLES.some(role=>!route.tasks.some(task=>task.role===role)))return null
  return {summary:'按快速判断结果安排本轮专题研究。',tasks:route.tasks.filter(task=>task.effort!=='skip').map(task=>({id:'fast-'+task.role,role:task.role,
    question:`${projectName}：${DEFAULT_RESEARCH_QUESTIONS.filter(question=>question.role===task.role).map(question=>question.question).join('；')}。给出具体措施、假设和待补字段。`,question_ids:DEFAULT_RESEARCH_QUESTIONS.filter(question=>question.role===task.role).map(question=>question.id),
    source_ids:[...sources].sort((a,b)=>queryScore({title:b.title,text:b.text},roleQuestions[task.role])-queryScore({title:a.title,text:a.text},roleQuestions[task.role])).slice(0,10).map(source=>source.id)}))}
}
