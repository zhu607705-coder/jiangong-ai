import { readFile } from 'node:fs/promises'
import { isDeepStrictEqual } from 'node:util'
import { join } from 'node:path'
import type { Request, Response, NextFunction } from 'express'
import type { ProjectInput, RenewalStrategy } from './generated/contracts'
import type { Store } from './store'
import { projectInput, validate } from '../../packages/contracts/validate'
import { validateStrategy, type StrategyPacket } from '../../packages/retrofit/strategy'
import { projectRenewalModeInput } from '../../packages/retrofit/renewal-mode'
import { QIUSHI_DEMO_PROJECT_ID, QIUSHI_DEMO_NAME, QIUSHI_SOURCE_PROJECT_ID } from '../../packages/retrofit/qiushi-demo'

export type QiushiDemoBundle = { schema_version: 'qiushi-validated-replay/1'; name: string; project_input: ProjectInput; packet: StrategyPacket }

export function validateQiushiDemoBundle(value: QiushiDemoBundle): QiushiDemoBundle {
  const owned = structuredClone(value), input = projectInput(owned.project_input), packet = owned.packet
  if (owned.schema_version !== 'qiushi-validated-replay/1' || owned.name !== QIUSHI_DEMO_NAME
    || input.project_id !== QIUSHI_DEMO_PROJECT_ID || input.business_profile !== 'neighborhood' || input.synthetic
    || packet.project_id !== input.project_id || packet.context_version !== 0 || packet.synthetic || packet.status !== 'completed' || packet.error !== null
    || !packet.strategy || !/^[a-f0-9]{64}$/.test(packet.input_hash)) throw new Error('QIUSHI_REPLAY_SCOPE_INVALID')
  const provenance = packet.demo_replay
  if (provenance?.kind !== 'validated_model_replay' || provenance.source_project_id !== QIUSHI_SOURCE_PROJECT_ID
    || provenance.transformation !== 'clear_nonexistent_parent_comparison'
    || !provenance.source_round_id || !/^[a-f0-9]{64}$/.test(provenance.source_packet_sha256)
    || !/^[a-f0-9]{64}$/.test(provenance.source_structured_sha256)
    || !Number.isFinite(Date.parse(provenance.model_generated_at)) || !Number.isFinite(Date.parse(provenance.validated_at))) throw new Error('QIUSHI_REPLAY_PROVENANCE_INVALID')
  if (input.sources.some(source => source.visibility !== 'public' || source.data_class !== 'public' || source.synthetic)
    || packet.sources.some(source => source.visibility && source.visibility !== 'public' || source.data_class && source.data_class !== 'public' || source.document_id
      || source.project_id && source.project_id !== input.project_id)) throw new Error('QIUSHI_REPLAY_PUBLIC_SOURCES_REQUIRED')
  const sources = new Map(input.sources.map(source => [source.id, source]))
  if (packet.sources.some(source => sources.get(source.id)?.untrusted_text !== source.text)) throw new Error('QIUSHI_REPLAY_SOURCE_BODY_MISMATCH')
  if (!packet.model_calls.some(call => call.stage.startsWith('renewal_strategy') && call.returned_model && call.input_tokens > 0 && call.output_tokens > 0)) throw new Error('QIUSHI_REPLAY_MODEL_RECORD_REQUIRED')
  validate<RenewalStrategy>('RenewalStrategy', packet.strategy)
  validateStrategy(packet.strategy, packet.sources, projectRenewalModeInput(input).conditions, true, true, true, true)
  if (packet.strategy.round_review?.changes.length) throw new Error('QIUSHI_REPLAY_HAS_NO_PARENT')
  return owned
}

/** Add an independent immutable public replay, without changing real projects or failed rounds. */
export async function installQiushiDemoReplay(store: Store, ownerId: string, bundle?: QiushiDemoBundle) {
  const replay = validateQiushiDemoBundle(bundle ?? JSON.parse(await readFile(join('data', 'demos', 'qiushi-validated-replay.json'), 'utf8')))
  return store.db.transaction(async db => {
    const existing = (await db.query<{ owner_id: string; input: ProjectInput; context_version: number }>('SELECT owner_id,input,context_version FROM projects WHERE id=$1', [QIUSHI_DEMO_PROJECT_ID])).rows[0]
    if (existing && (existing.owner_id !== ownerId || existing.context_version !== 0 || !isDeepStrictEqual(existing.input, replay.project_input))) throw new Error('QIUSHI_REPLAY_EXISTING_PROJECT_CHANGED')
    await db.query('INSERT INTO projects(id,owner_id,name,input) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING', [QIUSHI_DEMO_PROJECT_ID, ownerId, replay.name, JSON.stringify(replay.project_input)])
    const current = (await db.query<{ payload: StrategyPacket }>('SELECT payload FROM renewal_strategy_assessments WHERE owner_id=$1 AND project_id=$2 AND input_hash=$3', [ownerId, QIUSHI_DEMO_PROJECT_ID, replay.packet.input_hash])).rows[0]
    if (current && !isDeepStrictEqual(current.payload, replay.packet)) throw new Error('QIUSHI_REPLAY_EXISTING_PACKET_CHANGED')
    await db.query('INSERT INTO renewal_strategy_assessments(owner_id,project_id,input_hash,payload,created_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(owner_id,project_id,input_hash) DO NOTHING', [ownerId, QIUSHI_DEMO_PROJECT_ID, replay.packet.input_hash, JSON.stringify(replay.packet), replay.packet.demo_replay!.validated_at])
    return { project_id: QIUSHI_DEMO_PROJECT_ID, inserted: !current, source_count: replay.packet.sources.length }
  })
}

/** Calculations and evidence lookup remain available; fixed replay inputs are read-only. */
export function qiushiDemoReadOnly(req: Request, res: Response, next: NextFunction) {
  const path = req.path
  const prefix = `/api/projects/${QIUSHI_DEMO_PROJECT_ID}`
  if (!(path === prefix || path.startsWith(prefix + '/')) || req.method === 'GET' || req.method === 'HEAD') return next()
  if (req.method === 'POST' && [prefix + '/knowledge/retrieve', prefix + '/knowledge/chunks', prefix + '/community-operations/preview'].includes(path)) return next()
  return res.status(409).json({ code: 'DEMO_REPLAY_READ_ONLY', detail: '这是固定资料的求是村演示回放。可查看依据和调整推演参数；补充资料与实时研判请进入原项目。' })
}
