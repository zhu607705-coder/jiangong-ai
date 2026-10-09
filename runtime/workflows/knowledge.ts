import { randomUUID } from 'node:crypto'
import type { CapabilityResult, DecisionPacket, KnowledgeQuery, KnowledgeTrace, ProjectInput, Source } from '../../apps/host/generated/contracts'
import { config } from '../../apps/host/config'
import type { RunRecord, Store } from '../../apps/host/store'
import { visibleSnapshot } from '../../packages/context/compiler'
import { decisionPacket, projectInput, validate } from '../../packages/contracts/validate'
import { assembleDecision } from '../../packages/decision/evaluate'
import { ExperienceService } from '../../packages/experience/service'
import { KNOWLEDGE_POLICY_VERSION } from '../../packages/experience/knowledge'
import { ExperienceError } from '../../packages/experience/domain'
import { digest } from './run'

export type KnowledgeResolution = { trace: KnowledgeTrace; sources: Source[] }

export function researchSnapshot(input: ProjectInput, mode: ProjectInput['mode'], query?: KnowledgeQuery): ProjectInput {
  const snapshot = visibleSnapshot(input, mode === 'automatic' ? 'public' : 'internal')
  snapshot.mode = mode
  if (query) snapshot.knowledge_query = validate<KnowledgeQuery>('KnowledgeQuery', query)
  return projectInput(snapshot)
}

/** Freeze a library resolution for this run only; new runs recheck the library. */
export async function resolveRunKnowledge(store: Store, run: RunRecord, signal: AbortSignal): Promise<KnowledgeResolution & { artifact_id: string }> {
  signal.throwIfAborted()
  const dependency = `${KNOWLEDGE_POLICY_VERSION}:${run.id}`
  const project = await store.project(run.project_id, config.ownerId)
  if (!project) throw new Error('RUN_PROJECT_NOT_FOUND')
  const service = new ExperienceService(store)
  await service.initialize()
  const fresh = await service.resolveKnowledge({ ...project, input: run.snapshot, context_version: run.context_version })
  signal.throwIfAborted()
  const cached = (await store.db.query<{ id: string; payload: KnowledgeResolution }>('SELECT id,payload FROM artifacts WHERE project_id=$1 AND kind=$2 AND dependency_hash=$3', [run.project_id, 'knowledge_resolution', dependency])).rows[0]
  if (cached) {
    validate('KnowledgeTrace', cached.payload.trace)
    for (const source of cached.payload.sources) validate('Source', source)
    const identity = (value: KnowledgeResolution) => digest({ trace: value.trace, sources: value.sources.map(source => ({ id: source.id, hash: source.hash, visibility: source.visibility, synthetic: source.synthetic })) })
    if (identity(cached.payload) !== identity(fresh)) throw new ExperienceError(409, 'KNOWLEDGE_RESOLUTION_STALE', '案例、规则或引用材料已更新，请从当前资料新建研判，不能替换原冻结版本。')
    await store.addEvent(run.id, 'knowledge', 'reused', '复用本次运行冻结的案例与规则版本', cached.id)
    return { ...cached.payload, artifact_id: cached.id }
  }
  const resolution = fresh
  validate('KnowledgeTrace', resolution.trace)
  const id = `ART-${randomUUID()}`
  await store.db.query('INSERT INTO artifacts(id,project_id,run_id,kind,dependency_hash,payload) VALUES($1,$2,$3,$4,$5,$6)', [id, run.project_id, run.id, 'knowledge_resolution', dependency, JSON.stringify(resolution)])
  await store.addEvent(run.id, 'knowledge', 'completed', `案例命中 ${resolution.trace.case_hits.length} 项，规则命中 ${resolution.trace.rule_hits.length} 项`, id)
  return { ...resolution, artifact_id: id }
}

/** Only the checked recommendations are assembled; no historical condition becomes a current fact. */
export function assembleKnowledgeDecision(run: RunRecord, resolution: KnowledgeResolution, artifactId: string): DecisionPacket {
  const project = structuredClone(run.snapshot)
  project.sources = [...new Map([...project.sources, ...resolution.sources].map(source => [source.id, source])).values()]
  const hits = [...resolution.trace.rule_hits, ...resolution.trace.case_hits]
  const result: CapabilityResult = {
    status: 'partial', metrics: [], missing_fields: [], artifact_refs: [], version: '2.0',
    warnings: resolution.trace.reasons,
    findings: hits.map((hit, index) => ({ id: `KB-${index + 1}`, dimension: 'implementation',
      claim: `${hit.kind === 'rule' ? '规则方法' : '历史举措'}「${hit.measure_name}」：${hit.recommendation}`,
      status: 'conditional', evidence_refs: hit.evidence_refs, opposition_refs: [], unknowns: hit.unknowns,
    })),
  }
  const packet = assembleDecision({ project, runId: run.id, revision: run.revision, contextVersion: run.context_version,
    snapshotHash: run.snapshot_hash, executionMode: run.execution_mode, results: [result], artifactRefs: [artifactId],
    impact: { changed_rule_ids: [], reused: ['knowledge'], invalidated: [], changed_paths: [] }, model: null })
  packet.knowledge = { ...resolution.trace, fallback_status: 'not_needed' }
  packet.analysis_method = 'deterministic_checks'
  packet.model_calls = []
  packet.unresolved_disagreements = resolution.trace.reasons.filter(reason => reason.includes('不同推荐原文'))
  for (const scenario of packet.scenarios) {
    if (scenario.status !== 'blocked' && scenario.id !== 'defer_and_investigate') {
      scenario.actions = [...new Set([...hits.map(hit => `比较「${hit.measure_name}」：${hit.recommendation}`), ...scenario.actions])]
      scenario.evidence_refs = [...new Set([...scenario.evidence_refs, ...hits.flatMap(hit => hit.evidence_refs)])]
    }
  }
  packet.followups.push(...hits.filter(hit => hit.reuse_premises.length || hit.important_differences.length).map((hit, index) => ({
    id: `KB-TRANSFER-${hit.card_id}`, priority: index < 2 ? 1 as const : 2 as const,
    title: `复核「${hit.measure_name}」的迁移边界`, why: [...hit.reuse_premises, ...hit.important_differences].join('；'),
    impacted_paths: packet.scenarios.map(scenario => scenario.id), status: 'suggested' as const,
  })))
  const origin = resolution.trace.route === 'combined_hit' ? '案例与规则命中' : resolution.trace.route === 'rule_hit' ? '规则命中' : '案例命中'
  packet.summary = `${origin}：${[...new Set(hits.map(hit => hit.measure_name))].join('、')}。${packet.neighborhood_action?.label || '按条件比较具体举措'}。`
  return decisionPacket(packet)
}
