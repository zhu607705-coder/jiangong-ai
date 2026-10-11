import { createHash, randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { Store, type RunRecord } from '../../apps/host/store'
import { config } from '../../apps/host/config'
import { validate, decisionPacket } from '../../packages/contracts/validate'
import { visibleSnapshot } from '../../packages/context/compiler'
import { assembleDecision, revisionDiff } from '../../packages/decision/evaluate'
import { runSpecialists } from '../dsh/bridge'
import { roles, type RoleId } from '../roles'
import type { CapabilityResult, Impact, ProjectInput } from '../../apps/host/generated/contracts'
import { assembleKnowledgeDecision, resolveRunKnowledge } from './knowledge'

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b, 'en')).map(([key, child]) => [key, canonicalJson(child)]))
  return value
}
// JSONB changes object-key order on disk. Dependency identities follow values,
// so a persisted snapshot must not spuriously invalidate completed research.
export const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(canonicalJson(value))).digest('hex')

export function roleDependency(project: ProjectInput, role: RoleId, mode: string): string {
  const base = { project: project.project_id, mode, business_profile:project.business_profile||'general', as_of: project.as_of, scope: project.scope, knowledge_query: project.knowledge_query || null }
  if (role === 'case_enterprise') return digest({ ...base, rules: project.context_rules, sources: project.sources, facts: project.facts })
  // Context-only sources must not invalidate unchanged public evidence.
  const relevantFacts = project.facts.filter(f => role === 'building_feasibility' ? ['building_inventory', 'rights_status', 'structural_assessment'].includes(f.kind) : !['building_inventory', 'rights_status', 'structural_assessment'].includes(f.kind))
  const ids = new Set(relevantFacts.map(f => f.source_id))
  return digest({ ...base, facts: relevantFacts, sources: project.sources.filter(s => ids.has(s.id)) })
}

export async function executeRun(store: Store, run: RunRecord, signal: AbortSignal): Promise<void> {
  try {
    const knowledge = await resolveRunKnowledge(store, run, signal)
    if (run.execution_mode === 'live' && !config.modelConfigured) throw new Error('BLOCKED_EXTERNAL')
    if (knowledge.trace.route !== 'agent_fallback') {
      if (run.execution_mode === 'live') {
        const { executeKnowledgeAgent } = await import('./knowledge-agent')
        await executeKnowledgeAgent(store, run, signal, knowledge)
        return
      }
      const packet = assembleKnowledgeDecision(run, knowledge, knowledge.artifact_id)
      packet.knowledge = { ...knowledge.trace, agent_status: 'offline_only' }
      packet.summary = '离线条件检查（未调用Agent）：' + packet.summary
      signal.throwIfAborted()
      await store.db.transaction(async db => {
        await db.query('UPDATE runs SET status=$2,decision=$3 WHERE id=$1', [run.id, 'completed', JSON.stringify(packet)])
        await db.query('INSERT INTO run_events(run_id,stage,status,message) VALUES($1,$2,$3,$4)', [run.id, 'decision', 'completed', '已按命中案例与规则生成举措建议，业务硬约束仍由程序检查'])
      })
      return
    }
    if (run.execution_mode === 'live') {
      const { executeLiveRun } = await import('./live')
      await executeLiveRun(store, run, signal, knowledge.trace, knowledge.artifact_id, knowledge.sources)
      return
    }
    const snapshot = structuredClone(run.snapshot)
    snapshot.sources = [...new Map([...snapshot.sources, ...knowledge.sources].map(source => [source.id, source])).values()]
    const collected = new Map<RoleId, CapabilityResult>()
    const refs: string[] = []
    const previous = (await store.runs(run.project_id)).find(r => r.id !== run.id && r.decision)?.decision || null
    const ruleIds = new Set([...snapshot.context_rules, ...(previous?.context_rules || [])].map(r => r.id))
    const changedRuleIds = [...ruleIds].filter(id => JSON.stringify(snapshot.context_rules.find(r => r.id === id)) !== JSON.stringify(previous?.context_rules.find(r => r.id === id)))
    const impact: Impact = { changed_rule_ids: changedRuleIds, reused: [], invalidated: [], changed_paths: [] }
    const pending: RoleId[] = []
    await store.addEvent(run.id, 'snapshot', 'completed', '已固定项目、来源和 Context 版本', `snapshot:${run.snapshot_hash}`)
    for (const role of roles) {
      const key = roleDependency(snapshot, role.id, run.execution_mode)
      const cached = (await store.db.query<{ id: string; payload: CapabilityResult }>('SELECT id,payload FROM artifacts WHERE project_id=$1 AND kind=$2 AND dependency_hash=$3', [run.project_id, role.id, key])).rows[0]
      if (cached) {
        collected.set(role.id, validate<CapabilityResult>('CapabilityResult', cached.payload)); refs.push(cached.id); impact.reused.push(role.id)
        await store.addEvent(run.id, role.id, 'reused', '输入依赖未变化，复用已有证据工件', cached.id)
      } else { pending.push(role.id); impact.invalidated.push(role.id) }
    }
    if (pending.length) {
      const fresh = await runSpecialists({ runId: run.id, sessionRoot: join(config.dataDir, 'sessions'), executionMode: run.execution_mode, model: config.DEEPSEEK_MODEL, pendingRoles: pending, project: snapshot, signal,
        analyze: async (role, outerSignal) => {
          const response = await fetch(`${config.capabilityUrl}/capabilities/analyze`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Capability-Token': config.capabilityToken }, body: JSON.stringify({ project: snapshot, role }), signal: AbortSignal.any([outerSignal, AbortSignal.timeout(20_000)]) })
          if (!response.ok) throw new Error(`CAPABILITY_${response.status}`)
          return validate<CapabilityResult>('CapabilityResult', await response.json())
        },
        onStage: async (role, status, sessionId) => { await store.addEvent(run.id, role, status, status === 'running' ? 'DSH 专业任务已启动' : '专业能力结果通过契约校验', `dsh:${sessionId}`) },
      })
      for (const [role, result] of fresh) {
        const artifactId = `ART-${randomUUID()}`
        await store.db.query('INSERT INTO artifacts(id,project_id,run_id,kind,dependency_hash,payload) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(project_id,kind,dependency_hash) DO NOTHING', [artifactId, run.project_id, run.id, role, roleDependency(snapshot, role, run.execution_mode), JSON.stringify(result)])
        collected.set(role, result); refs.push(artifactId)
      }
    }
    if (signal.aborted) throw new Error('RUN_CANCELLED')
    impact.invalidated.push('scenarios', 'critic', 'comparator', 'report')
    await store.addEvent(run.id, 'scenarios', 'completed', '已检查动作范围、组织约束与未知前提')
    const packet = decisionPacket(assembleDecision({ project: snapshot, runId: run.id, revision: run.revision, contextVersion: run.context_version, snapshotHash: run.snapshot_hash, executionMode: run.execution_mode,
      results: roles.map(r => collected.get(r.id)!), artifactRefs: refs, impact, model: null }))
    packet.knowledge = { ...knowledge.trace, fallback_status: 'offline_only', agent_status: 'offline_only' }
    packet.artifact_refs.push(knowledge.artifact_id)
    const changes = revisionDiff(previous, packet).changes
    packet.impact.changed_paths = [...new Set(changes.map(c => c.path_id))]
    await store.addEvent(run.id, 'critic', 'completed', '已检查证据不足、反例、来源冲突与资料指令边界')
    await store.db.transaction(async db => {
      await db.query('UPDATE runs SET status=$2,decision=$3 WHERE id=$1', [run.id, 'completed', JSON.stringify(packet)])
      await db.query('INSERT INTO run_events(run_id,stage,status,message) VALUES($1,$2,$3,$4)', [run.id, 'decision', 'completed', '决策包已保存；可查看候选比较和下一步调查'])
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'RUN_FAILED'
    const reportedCode = (error as { code?: string })?.code
    const safeCode = message === 'BLOCKED_EXTERNAL' ? message : /^KNOWLEDGE_[A-Z0-9_]+$/.test(reportedCode || '') ? reportedCode! : message.startsWith('LIVE_STAGE_FAILED:') ? message.split(':').slice(0, 3).join(':') : message.startsWith('CAPABILITY_') || message.startsWith('SPECIALIST_FAILED:') || /^RUN_/.test(message) || /^DECISION_[A-Z0-9_]+$/.test(message) ? message : 'RUNTIME_FAILED'
    await store.db.query('UPDATE runs SET status=$2,error_code=$3 WHERE id=$1', [run.id, 'failed', safeCode])
    await store.addEvent(run.id, 'error', 'failed', `执行未完成（${safeCode}），已保留快照与已有工件。`)
    console.error(JSON.stringify({ event: 'run_failed', run_id: run.id, code: safeCode, diagnostic: message.slice(0, 300) }))
  }
}
