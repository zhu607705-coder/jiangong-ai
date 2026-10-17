import {createHash,randomUUID} from 'node:crypto'
import type {Database,ProjectRecord,Store} from './store'
import type {ProjectContextRef} from '../../packages/retrofit/project-context'
import type {StrategyPacket} from '../../packages/retrofit/strategy'
import {bindStrategySource} from '../../packages/retrofit/object-binding'
import {canonical} from '../../packages/intelligence/domain'

// Hash the JSON representation actually stored in PostgreSQL (undefined fields are omitted).
const hash=(value:unknown)=>createHash('sha256').update(canonical(JSON.parse(JSON.stringify(value)))).digest('hex')
export function projectContextRef(project:ProjectRecord):ProjectContextRef {
  return {policy:'project-context-v1',project_id:project.id,context_version:project.context_version,
    object_revision:hash(project.input.scope),conditions_revision:hash({facts:project.input.facts,rules:project.input.context_rules}),
    input_hash:hash({input:project.input,version:project.context_version})}
}
export function packetMatchesContext(packet:StrategyPacket,project:ProjectRecord,synthetic=project.input.synthetic):boolean {
  return packet.project_id===project.id&&packet.context_version===project.context_version&&packet.synthetic===synthetic&&
    (!packet.context_ref||packet.context_ref.input_hash===projectContextRef(project).input_hash)
}
/** A read projection preserves stored reports and exposes object issues alongside usable conditional advice. */
export function bindPacketContext(packet:StrategyPacket,project:ProjectRecord):StrategyPacket {
  if(project.input.synthetic)return packet
  const sources=packet.sources.map(source=>bindStrategySource(source,project.input))
  const issues=sources.filter(source=>source.object_binding?.relation==='different_object').map(source=>({code:'OBJECT_LOCATION_CONFLICT',path:`sources.${source.id}`,message:`《${source.title}》：${source.object_binding!.reason}`}))
  if(!issues.length)return {...packet,sources}
  const review=packet.content_review
  return {...packet,sources,content_review:{policy:'advisory-v1',status:'needs_review',checked_at:review?.checked_at||packet.created_at,
    issues:[...(review?.issues||[]),...issues.filter(issue=>!review?.issues.some(row=>row.path===issue.path&&row.code===issue.code))],
    follow_up:{search_queries:[...new Set([...(review?.follow_up.search_queries||[]),`${project.input.scope.name} 项目地址 工程范围`])],
      reading_focus:[...new Set([...(review?.follow_up.reading_focus||[]),'核对同名资料中的项目地址和研究范围。'])],
      internal_data:[...new Set([...(review?.follow_up.internal_data||[]),'项目位置、边界及对应资料的对象登记。'])]}}}
}
export type AnalysisTicket={id:string;generation:number;context:ProjectContextRef;round_id:string|null}
/** Short claims and fenced commits share the existing Store owner; network work stays outside transactions. */
export async function beginProjectAnalysis(store:Store,project:ProjectRecord,roundId:string|null=null):Promise<AnalysisTicket> {
  return store.db.transaction(async db=>{
    const current=(await db.query<ProjectRecord>('SELECT * FROM projects WHERE id=$1 AND owner_id=$2 FOR UPDATE',[project.id,project.owner_id])).rows[0]
    const context=projectContextRef(project)
    if(!current||projectContextRef(current).input_hash!==context.input_hash)throw new Error('ANALYSIS_CONTEXT_CHANGED')
    const head=(await db.query<{generation:number}>(`INSERT INTO project_analysis_heads(owner_id,project_id,generation,requested_context_hash)
      VALUES($1,$2,1,$3) ON CONFLICT(owner_id,project_id) DO UPDATE SET generation=project_analysis_heads.generation+1,requested_context_hash=EXCLUDED.requested_context_hash RETURNING generation`,[project.owner_id,project.id,context.input_hash])).rows[0]
    const ticket={id:`ANALYSIS-${randomUUID()}`,generation:Number(head.generation),context,round_id:roundId}
    await db.query('INSERT INTO project_analysis_attempts(id,owner_id,project_id,generation,context_ref,round_id) VALUES($1,$2,$3,$4,$5,$6)',[ticket.id,project.owner_id,project.id,ticket.generation,JSON.stringify(context),roundId])
    return ticket
  })
}
export async function commitProjectAnalysis(store:Store,project:ProjectRecord,ticket:AnalysisTicket,packet:StrategyPacket,
  persist?:(db:Database,current:boolean,result:StrategyPacket)=>Promise<void>):Promise<{current:boolean;packet:StrategyPacket}> {
  if(packet.project_id!==project.id||packet.context_version!==ticket.context.context_version||packet.synthetic!==project.input.synthetic)throw new Error('ANALYSIS_PACKET_SCOPE')
  return store.db.transaction(async db=>{
    const locked=(await db.query<ProjectRecord>('SELECT * FROM projects WHERE id=$1 AND owner_id=$2 FOR UPDATE',[project.id,project.owner_id])).rows[0]
    const head=(await db.query<{generation:number;requested_context_hash:string}>('SELECT generation,requested_context_hash FROM project_analysis_heads WHERE owner_id=$1 AND project_id=$2 FOR UPDATE',[project.owner_id,project.id])).rows[0]
    const matching=!!locked&&projectContextRef(locked).input_hash===ticket.context.input_hash&&!!head&&head.generation===ticket.generation&&head.requested_context_hash===ticket.context.input_hash
    const projected=bindPacketContext({...packet,context_ref:ticket.context},project)
    const result:StrategyPacket={...projected,current_context:{policy:'project-context-v1',generation:ticket.generation,attempt_id:ticket.id,round_id:ticket.round_id,
      freshness:matching?'current':'historical',object_review_required:projected.sources.some(source=>source.object_binding?.relation==='different_object')}}
    // An attempt's terminal output is immutable; repeat delivery cannot replace it.
    const saved=(await db.query(`UPDATE project_analysis_attempts SET payload=$1,status=$2 WHERE id=$3 AND owner_id=$4 AND project_id=$5 AND generation=$6 AND status='running' RETURNING id`,[JSON.stringify(result),result.status,ticket.id,project.owner_id,project.id,ticket.generation])).rows.length>0
    if(!saved)throw new Error('ANALYSIS_ALREADY_COMMITTED')
    await persist?.(db,matching,result)
    if(matching&&result.status==='completed'&&result.strategy)await db.query('UPDATE project_analysis_heads SET active_attempt_id=$1 WHERE owner_id=$2 AND project_id=$3 AND generation=$4 AND requested_context_hash=$5',[ticket.id,project.owner_id,project.id,ticket.generation,ticket.context.input_hash])
    return {current:matching,packet:result}
  })
}
