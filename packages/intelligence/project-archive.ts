import type {Store,ProjectRecord} from '../../apps/host/store'
import type {Source} from '../../apps/host/generated/contracts'
import type {StrategyPacket} from '../retrofit/strategy'
import {mergeProjectSources} from '../../services/map-screening/project-evidence'
import {publicResearchOriginal} from '../experience/retrieval-sources'

export type ArchiveOriginal={source:Source;context_version:number;origin:string;origin_id:string}
/** Read historical originals, never generated plans or internal survey text. */
export async function projectArchiveOriginals(store:Store,project:ProjectRecord):Promise<ArchiveOriginal[]>{
 if(project.input.synthetic)return []
 const sources=mergeProjectSources(project,await store.runs(project.id)).map(source=>({source,context_version:project.context_version,origin:'project_input',origin_id:project.id}))
 const tables=(await store.db.query<{rounds:string|null;strategies:string|null;rag:string|null}>("SELECT to_regclass('renewal_research_rounds')::text AS rounds,to_regclass('renewal_strategy_assessments')::text AS strategies,to_regclass('project_rag_evidence')::text AS rag")).rows[0]
 const packets:{packet:StrategyPacket;origin_id:string;origin:string}[]=[]
 if(tables?.rounds)packets.push(...(await store.db.query<{packet:StrategyPacket;origin_id:string}>("SELECT payload->'result' AS packet,payload->>'id' AS origin_id FROM renewal_research_rounds WHERE owner_id=$1 AND project_id=$2 AND payload->'result'->>'synthetic'='false' ORDER BY round_number DESC LIMIT 100",[project.owner_id,project.id])).rows.map(row=>({...row,origin:'research_round'})))
 if(tables?.strategies)packets.push(...(await store.db.query<{packet:StrategyPacket;origin_id:string}>("SELECT payload AS packet,payload->>'input_hash' AS origin_id FROM renewal_strategy_assessments WHERE owner_id=$1 AND project_id=$2 AND payload->>'synthetic'='false' ORDER BY created_at DESC LIMIT 100",[project.owner_id,project.id])).rows.map(row=>({...row,origin:'strategy_snapshot'})))
 for(const row of packets){
  if(row.packet?.project_id!==project.id||row.packet.synthetic||!Number.isInteger(row.packet.context_version))continue
  for(const source of row.packet.sources||[]){const original=publicResearchOriginal(source,project);if(original)sources.push({source:original,context_version:row.packet.context_version,origin:row.origin,origin_id:row.origin_id||row.packet.input_hash})}
 }
 if(tables?.rag)for(const row of (await store.db.query<{payload:Source;context_version:number}>('SELECT payload,context_version FROM project_rag_evidence WHERE owner_id=$1 AND project_id=$2 ORDER BY created_at DESC LIMIT 1000',[project.owner_id,project.id])).rows)sources.push({source:row.payload,context_version:row.context_version,origin:'rag_supplement',origin_id:row.payload.id})
 return sources.filter(({source})=>source.visibility==='public'&&source.data_class==='public'&&!source.synthetic)
}
