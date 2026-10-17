import type {InvestigationAdvice,ModelCall,ProjectInput} from '../../apps/host/generated/contracts'
import type {StrategyPacket,StrategySource} from './strategy'
import {buildProjectTasks,taskObjectApplicability} from './project-tasks'
import {bindStrategySource,projectObjectLocation} from './object-binding'
import {safePublicUrl} from '../research/public-sources'

export const INVESTIGATION_ADVICE_POLICY='investigation-advice-v1'
export type AdviceDirection='comprehensive'|'rebuild'|null
export type InvestigationAdviceResult={policy:typeof INVESTIGATION_ADVICE_POLICY;project_id:string;context_version:number;strategy_hash:string;strategy_created_at:string;input_hash:string;direction:AdviceDirection;created_at:string;duration_ms:number;reused:boolean;summary:string;steps:(InvestigationAdvice['steps'][number]&{title:string})[];source_count:number;private_context_omitted:boolean;model_label:string;model_calls:ModelCall[]}

/** Only public snippets and task aliases leave this boundary. No old report prose or private facts. */
export function investigationAdviceInput(project:ProjectInput,version:number,packet:StrategyPacket,direction:AdviceDirection){
 const own=packet.project_id===project.project_id&&packet.synthetic===project.synthetic
 if(!own)throw new Error('ADVICE_PROJECT_SCOPE')
 const denied=new Set(project.sources.filter(source=>source.visibility==='internal'||source.data_class==='internal').map(source=>source.id))
 const restricted=!!packet.lineage?.contains_internal||packet.sources.some(source=>source.visibility==='internal'||source.data_class==='internal'||denied.has(source.id))
 const tasks=buildProjectTasks(packet,direction)
 const objectChecks=tasks.filter(task=>taskObjectApplicability(packet,task).state==='object_check')
 const prioritized=(objectChecks.length?objectChecks:tasks).slice(0,12)
 const candidates=prioritized.map((task,index)=>({alias:'t'+(index+1),id:task.id,title:restricted?'当前对象资料核对':task.title,request:restricted?'核对当前登记对象的位置、范围和来源对应关系；不采用未核的旧对象数量。':task.request,reason:restricted?'根据当前登记与获准公开资料安排后续取证。':taskObjectApplicability(packet,task).reason||task.reason}))
 const sources=packet.sources.filter(source=>source.visibility!=='internal'&&source.data_class!=='internal'&&!denied.has(source.id)&&!source.document_id&&(!source.project_id||source.project_id===project.project_id)&&!!source.url&&!!safePublicUrl(source.url)&&(project.synthetic||!['synthetic','semi_synthetic'].includes(source.data_class||''))).map(source=>bindStrategySource(source,project)).sort((a,b)=>Number(b.object_binding?.relation==='different_object')-Number(a.object_binding?.relation==='different_object')).slice(0,6).map(source=>({...source,text:source.text.slice(0,900)})) as StrategySource[]
 return {policy:INVESTIGATION_ADVICE_POLICY,project_id:project.project_id,context_version:version,strategy_hash:packet.input_hash,strategy_created_at:packet.created_at,direction,synthetic:project.synthetic,target:{name:project.scope.name,...projectObjectLocation(project.scope)},candidates,sources,private_context_omitted:restricted,model_context:{target:{name:project.scope.name,...projectObjectLocation(project.scope)},direction,synthetic:project.synthetic,object_review_required:!!packet.current_context?.object_review_required||!!packet.content_review?.issues.some(issue=>issue.code==='OBJECT_LOCATION_CONFLICT'),candidates:candidates.map(({id,...candidate})=>candidate)}}
}
export type InvestigationAdviceInput=ReturnType<typeof investigationAdviceInput>
