import {z} from 'zod'
import {validate} from '../contracts/validate'
import type {RenewalReasonedDimension} from '../../apps/host/generated/contracts'
import type {StrategyPacket,StrategySource} from './strategy'

const keys=['demand','supply','adaptation','implementation','operations','resources'] as const
const currentDimension=z.object({key:z.enum(keys),current:z.string(),current_level:z.enum(['low','medium','high','unknown']),evidence_refs:z.array(z.string())})
export type CurrentAssessment={input_hash:string;context_version:number;created_at:string;
  dimensions:z.infer<typeof currentDimension>[];reasoning_dimensions:RenewalReasonedDimension[];
  issues:{key:string;reason:string}[];status:'completed'|'partial'}

/** Independently retain readable dimensions before validating work packages. No new model call. */
export function captureCurrentAssessment(value:unknown,packet:Pick<StrategyPacket,'input_hash'|'context_version'|'created_at'>,sources:readonly StrategySource[]):CurrentAssessment|null {
  if(!value||typeof value!=='object')return null
  const raw=value as Record<string,unknown>,currentIds=new Set(sources.filter(source=>source.role==='current').map(source=>source.id))
  const dimensions:CurrentAssessment['dimensions']=[],reasoning_dimensions:RenewalReasonedDimension[]=[],issues:CurrentAssessment['issues']=[]
  const rows=Array.isArray(raw.dimensions)?raw.dimensions:[]
  for(const key of keys){
    const matches=rows.filter(row=>row&&typeof row==='object'&&row.key===key)
    if(matches.length!==1){issues.push({key,reason:matches.length?'本维度重复，待整理':'本维度尚未返回，建议补查对应材料'});continue}
    const parsed=currentDimension.safeParse(matches[0])
    if(!parsed.success){issues.push({key,reason:'本维度字段未完整返回，其他维度保留'});continue}
    dimensions.push(parsed.data)
    if(parsed.data.current_level!=='unknown'&&!parsed.data.evidence_refs.some(id=>currentIds.has(id)))issues.push({key,reason:'现况等级缺少本对象依据，保留分析文字并列入资料补充'})
  }
  for(const row of Array.isArray(raw.reasoning_dimensions)?raw.reasoning_dimensions:[]){
    try {const parsed=validate<RenewalReasonedDimension>('RenewalReasonedDimension',structuredClone(row));if(!reasoning_dimensions.some(item=>item.key===parsed.key))reasoning_dimensions.push(parsed)}catch{/* Other independent dimensions remain available. */}
  }
  if(!dimensions.length&&!reasoning_dimensions.length)return null
  return {...packet,dimensions,reasoning_dimensions,issues,status:dimensions.length===6&&!issues.length?'completed':'partial'}
}

export function currentAssessment(packet:StrategyPacket|null|undefined):CurrentAssessment|null {
  if(!packet)return null
  const saved=packet.current_assessment
  if(saved&&saved.input_hash===packet.input_hash&&saved.context_version===packet.context_version)return saved
  return packet.strategy?captureCurrentAssessment(packet.strategy,packet,packet.sources):null
}

export function assessmentSupplementRequests(packet:StrategyPacket):import('./research-rounds').ResearchMissingMaterial[] {
  const artifact=currentAssessment(packet)
  if(!artifact)return []
  const requests={demand:['居民需求','补充匿名满意度、幸福感问卷，注明楼栋、调查日期和有效样本分母。'],supply:['公共服务','补充社区食堂各餐次去重用餐人数、服务容量和实际开餐天数。'],adaptation:['居住工程','补充分幢电梯使用频次、设施巡检与结构鉴定记录，注明对象和时点。'],implementation:['实施协同','补充业主协商、表决及组织责任记录，区分意向与已确认事项。'],operations:['长效维护','补充维护合同、服务台账及实际运维收支，注明责任人与统计月份。'],resources:['资金交付','分别补充估算、预算、合同和结算依据，以及已落实资金和付款安排。']} as const
  return artifact.issues.map(issue=>{
    const key=issue.key as keyof typeof requests,row=requests[key]
    return {topic:row?.[0]||issue.key,request:row?.[1]||'补充本维度对应的项目资料与来源定位。',reason:issue.reason,evidence_refs:[]}
  })
}
