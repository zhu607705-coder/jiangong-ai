import type { RenewalStrategy } from './generated/contracts'
import type { Store, ProjectRecord } from './store'
import { validate } from '../../packages/contracts/validate'
import { validateStrategy, type StrategyPacket, type PublicStrategyIndexItem } from '../../packages/retrofit/strategy'
import { projectRenewalModeInput } from '../../packages/retrofit/renewal-mode'
import {bindPacketContext,packetMatchesContext,projectContextRef} from './project-context'
import type {ResearchRound} from '../../packages/retrofit/research-rounds'

type SavedRow = { payload: StrategyPacket; saved_at: string | Date }
function completedFor(packet: StrategyPacket, project: ProjectRecord, synthetic: boolean): boolean {
  if (!packet || packet.status !== 'completed' || !packetMatchesContext(packet,project,synthetic) || !packet.strategy) return false
  try {
    validate<RenewalStrategy>('RenewalStrategy', packet.strategy)
    if(packet.content_review?.policy!=='advisory-v1') validateStrategy(packet.strategy, packet.sources, projectRenewalModeInput(project.input).conditions, !!packet.strategy.decision_brief)
    return true
  } catch { return false }
}
function savedAt(row: SavedRow): string {
  const date = new Date(row.saved_at || row.payload.created_at)
  return Number.isFinite(date.getTime()) ? date.toISOString() : row.payload.created_at
}

/** A publication is an immutable same-project/version result, separate from the exact recomputation key. */
async function readStandalonePublished(store: Store, project: ProjectRecord, currentHash: string, synthetic: boolean): Promise<StrategyPacket | null> {
  const rows = (await store.db.query<SavedRow>(`
    SELECT a.payload,a.created_at AS saved_at FROM renewal_strategy_assessments a
    JOIN projects p ON p.id=a.project_id AND p.owner_id=a.owner_id
    WHERE a.owner_id=$1 AND a.project_id=$2 AND p.context_version=$3
      AND a.payload->>'project_id'=p.id AND a.payload->>'context_version'=$3::text
      AND a.payload->>'synthetic'=$4 AND a.payload->>'status'='completed'
      AND a.payload->>'input_hash'=a.input_hash AND jsonb_typeof(a.payload->'strategy')='object'
    ORDER BY CASE WHEN a.input_hash=$5 THEN 0 ELSE 1 END,a.created_at DESC,a.input_hash
    LIMIT 10`, [project.owner_id, project.id, project.context_version, String(synthetic), currentHash])).rows
  const row = rows.find(row => completedFor(row.payload, project, synthetic))
  if (!row) return null
  const isCurrent = row.payload.input_hash === currentHash
  return { ...row.payload, publication: { kind: isCurrent ? 'current' : 'saved_snapshot', is_current: isCurrent, current_input_hash: currentHash, saved_at: savedAt(row) } }
}

/** One owner/version/object-bound resolution for the workspace, Decision and public result routes. */
export async function resolveCurrentContext(store:Store,project:ProjectRecord,currentHash='',synthetic=project.input.synthetic) {
  const context=projectContextRef(project)
  const heads=(await store.db.query<{generation:number;requested_context_hash:string;active_attempt_id:string|null;payload:StrategyPacket|null;round_id:string|null}>(`SELECT h.generation,h.requested_context_hash,h.active_attempt_id,a.payload,a.round_id FROM project_analysis_heads h
    LEFT JOIN project_analysis_attempts a ON a.id=h.active_attempt_id AND a.owner_id=h.owner_id AND a.project_id=h.project_id
    WHERE h.owner_id=$1 AND h.project_id=$2`,[project.owner_id,project.id])).rows
  const head=synthetic===project.input.synthetic?heads[0]:undefined
  const published=await readStandalonePublished(store,project,currentHash,synthetic)
  let active=head?.payload&&completedFor(head.payload,project,synthetic)?head.payload:null,roundId=active?head!.round_id:null
  // Legacy history is read compatibly until a fenced result exists; never promote it by finish time.
  if(!head||!head.active_attempt_id&&head.requested_context_hash===context.input_hash){
    const table=(await store.db.query<{present:boolean}>("SELECT to_regclass('renewal_research_rounds') IS NOT NULL AS present")).rows[0]?.present
    if(table){
      const rows=(await store.db.query<{payload:ResearchRound;input_snapshot:ProjectRecord['input']|null}>('SELECT payload,input_snapshot FROM renewal_research_rounds WHERE owner_id=$1 AND project_id=$2 ORDER BY round_number DESC',[project.owner_id,project.id])).rows
      const round=rows.find(row=>row.payload.project_id===project.id&&row.payload.status==='completed'&&row.payload.context_version===project.context_version&&(!head||!row.payload.result?.context_ref)&&row.payload.result?.input_hash===row.payload.input_hash&&completedFor(row.payload.result,project,synthetic)&&(!row.input_snapshot||projectContextRef({...project,input:row.input_snapshot}).input_hash===context.input_hash))?.payload
      active=round?.result||null;roundId=round?.id||null
    }
    const legacyPublished=head&&published?.context_ref?null:published
    if(!active||legacyPublished&&(Date.parse(legacyPublished.created_at)||0)>(Date.parse(active.created_at)||0)){active=legacyPublished;roundId=null}
  }
  const selected=active?bindPacketContext(active,project):null
  const packet=selected?{...selected,current_context:{policy:'project-context-v1' as const,generation:head?.generation||0,attempt_id:head?.active_attempt_id||null,round_id:roundId,
    freshness:selected.context_ref?'current' as const:'legacy_snapshot' as const,object_review_required:selected.sources.some(source=>source.object_binding?.relation==='different_object')}}:null
  return {context,active_analysis:packet,published_report:published,freshness:packet?.current_context?.freshness||'unavailable' as const}
}
export async function readPublishedStrategy(store:Store,project:ProjectRecord,currentHash:string,synthetic:boolean):Promise<StrategyPacket|null> {
  const resolved=await resolveCurrentContext(store,project,currentHash,synthetic),packet=resolved.active_analysis
  if(!packet)return null
  if(packet.current_context?.attempt_id)return {...packet,publication:{kind:'current',is_current:true,current_input_hash:currentHash,saved_at:packet.created_at}}
  return {...packet,publication:packet.publication||{kind:packet.input_hash===currentHash?'current':'saved_snapshot',is_current:packet.input_hash===currentHash,current_input_hash:currentHash,saved_at:packet.created_at}}
}

/** Only current-version real workbench projects enter the public navigation index. No model or write occurs. */
export async function listPublishedStrategies(store: Store, owner: string, currentHash: (project: ProjectRecord) => Promise<string>): Promise<PublicStrategyIndexItem[]> {
  const rows = (await store.db.query<ProjectRecord>(`SELECT p.* FROM projects p
    WHERE p.owner_id=$1 AND p.input->>'synthetic'='false' AND p.input->>'business_profile'='neighborhood'
    ORDER BY p.updated_at DESC,p.id LIMIT 100`, [owner])).rows
  const items: PublicStrategyIndexItem[] = []
  for (const row of rows) {
    const hash = await currentHash(row)
    // Match the detail route's exact-first selection instead of advertising a different same-project result.
    const packet = await readPublishedStrategy(store,row,hash,false)
    if (!packet?.strategy || !packet.publication) continue
    items.push({ project_id: row.id, project_name: row.name, context_version: row.context_version, strategy_context_version: packet.context_version,
      created_at: packet.publication.saved_at, headline: packet.strategy.headline, status: 'completed', synthetic: false,
      is_current: packet.publication.is_current, input_hash: packet.input_hash })
  }
  return items.sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at)||a.project_id.localeCompare(b.project_id))
}
