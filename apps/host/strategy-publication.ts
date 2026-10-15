import type { RenewalStrategy } from './generated/contracts'
import type { Store, ProjectRecord } from './store'
import { validate } from '../../packages/contracts/validate'
import type { StrategyPacket, PublicStrategyIndexItem } from '../../packages/retrofit/strategy'

type SavedRow = { payload: StrategyPacket; saved_at: string | Date }
function completedFor(packet: StrategyPacket, project: ProjectRecord, synthetic: boolean): boolean {
  if (!packet || packet.status !== 'completed' || packet.project_id !== project.id || packet.context_version !== project.context_version || packet.synthetic !== synthetic || !packet.strategy) return false
  try { validate<RenewalStrategy>('RenewalStrategy', packet.strategy); return true } catch { return false }
}
function savedAt(row: SavedRow): string {
  const date = new Date(row.saved_at || row.payload.created_at)
  return Number.isFinite(date.getTime()) ? date.toISOString() : row.payload.created_at
}

/** A publication is an immutable same-project/version result, separate from the exact recomputation key. */
export async function readPublishedStrategy(store: Store, project: ProjectRecord, currentHash: string, synthetic: boolean): Promise<StrategyPacket | null> {
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

/** Only current-version real workbench projects enter the public navigation index. No model or write occurs. */
export async function listPublishedStrategies(store: Store, owner: string, currentHash: (project: ProjectRecord) => Promise<string>): Promise<PublicStrategyIndexItem[]> {
  const rows = (await store.db.query<ProjectRecord & { published_payload: StrategyPacket; saved_at: string | Date }>(`
    SELECT p.*,a.payload AS published_payload,a.created_at AS saved_at FROM projects p
    JOIN LATERAL (
      SELECT payload,input_hash,created_at FROM renewal_strategy_assessments a
      WHERE a.owner_id=p.owner_id AND a.project_id=p.id AND a.payload->>'project_id'=p.id
        AND a.payload->>'context_version'=p.context_version::text AND a.payload->>'synthetic'='false'
        AND a.payload->>'status'='completed' AND a.payload->>'input_hash'=a.input_hash
        AND jsonb_typeof(a.payload->'strategy')='object'
      ORDER BY a.created_at DESC,a.input_hash LIMIT 1
    ) a ON true
    WHERE p.owner_id=$1 AND p.input->>'synthetic'='false' AND p.input->>'business_profile'='neighborhood'
    ORDER BY a.created_at DESC,p.id LIMIT 100`, [owner])).rows
  const items: PublicStrategyIndexItem[] = []
  for (const row of rows) {
    const hash = await currentHash(row)
    // Match the detail route's exact-first selection instead of advertising a different same-project result.
    const packet = await readPublishedStrategy(store,row,hash,false)
    if (!packet?.strategy || !packet.publication) continue
    items.push({ project_id: row.id, project_name: row.name, context_version: row.context_version, strategy_context_version: packet.context_version,
      created_at: packet.publication.saved_at, headline: packet.strategy.headline, status: 'completed', synthetic: false,
      is_current: packet.input_hash === hash, input_hash: packet.input_hash })
  }
  return items.sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at)||a.project_id.localeCompare(b.project_id))
}
