import {createHash} from 'node:crypto'
import type {Store,ProjectRecord} from '../../apps/host/store'
import type {Source} from '../../apps/host/generated/contracts'
import type {StrategyPacket} from '../retrofit/strategy'
import {bindStrategySource} from '../retrofit/object-binding'

/** Browse acquired originals from this project's frozen research, without rewriting project inputs. */
export async function withResearchOriginals(store:Store,project:ProjectRecord):Promise<ProjectRecord> {
  if(project.input.synthetic)return project
  const tables=(await store.db.query<{rounds:string|null;strategies:string|null;supplements?:string|null}>("SELECT to_regclass('renewal_research_rounds')::text AS rounds,to_regclass('renewal_strategy_assessments')::text AS strategies,to_regclass('project_rag_evidence')::text AS supplements")).rows[0]
  const packets:StrategyPacket[]=[]
  if(tables?.rounds)packets.push(...(await store.db.query<{packet:StrategyPacket}>(`SELECT payload->'result' AS packet FROM renewal_research_rounds
    WHERE owner_id=$1 AND project_id=$2 AND payload->>'context_version'=$3
      AND payload->'result'->>'project_id'=$2 AND payload->'result'->>'context_version'=$3
      AND payload->'result'->>'synthetic'='false' ORDER BY round_number DESC LIMIT 10`,[project.owner_id,project.id,String(project.context_version)])).rows.map(row=>row.packet))
  if(tables?.strategies)packets.push(...(await store.db.query<{packet:StrategyPacket}>(`SELECT payload AS packet FROM renewal_strategy_assessments
    WHERE owner_id=$1 AND project_id=$2 AND payload->>'project_id'=$2 AND payload->>'context_version'=$3
      AND payload->>'synthetic'='false' ORDER BY created_at DESC LIMIT 10`,[project.owner_id,project.id,String(project.context_version)])).rows.map(row=>row.packet))
  const sources=[...project.input.sources],ids=new Set(sources.map(source=>source.id))
  if(tables?.supplements)for(const {payload:source} of (await store.db.query<{payload:Source}>('SELECT payload FROM project_rag_evidence WHERE owner_id=$1 AND project_id=$2 AND context_version=$3 ORDER BY created_at DESC',[project.owner_id,project.id,project.context_version])).rows){if(source.visibility==='public'&&source.data_class==='public'&&!source.synthetic&&source.untrusted_text&&!ids.has(source.id)){sources.push(source);ids.add(source.id)}}
  for(const packet of packets)for(const source of packet?.sources||[]) {
    if(ids.has(source.id)||source.project_id&&source.project_id!==project.id||source.visibility==='internal'||source.data_class&&source.data_class!=='public'||!source.text?.trim()||source.document_id||source.locator.startsWith('synthetic:')||source.id.startsWith('SIM-'))continue
    const bound=bindStrategySource(source,project.input)
    const original:Source={id:source.id,title:source.title,visibility:'public',data_class:'public',synthetic:false,
      untrusted_text:source.text,content_status:'excerpt',hash:createHash('sha256').update(source.text).digest('hex'),
      locator:source.locator,...(source.url?{url:source.url}:{}),...(source.published_at?{published_at:source.published_at,date_status:'verified' as const}:{date_status:'undated' as const}),
      evidence_scope:bound.role==='current'?'object':'background',object_refs:bound.role==='current'?[`project:${project.id}`]:[]}
    sources.push(original);ids.add(original.id)
  }
  return sources.length===project.input.sources.length?project:{...project,input:{...project.input,sources}}
}
