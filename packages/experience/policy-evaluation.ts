import type { FactorPolicy, KnowledgePolicyEvaluation, ProjectInput } from '../../apps/host/generated/contracts'
import { projectFactUsable } from '../retrofit/planning'

/** Reviewed policy conditions can tighten a study; they never create project facts. */
export function evaluateFactorPolicy(project: ProjectInput, policy: FactorPolicy, policySource: string): KnowledgePolicyEvaluation {
  if (policy.status !== 'approved') throw new Error('FACTOR_POLICY_REVIEW_REQUIRED')
  const measure = project.knowledge_query?.measure_key || ''
  const checks: KnowledgePolicyEvaluation['checks'] = policy.definitions.filter(definition => definition.role === 'mandatory'
    && (!definition.measure_keys.length || definition.measure_keys.includes(measure))).map(definition => {
    const facts = project.facts.filter(fact => fact.kind === definition.key && projectFactUsable(project, fact))
    const refs = [...new Set([policySource, ...facts.map(fact => fact.source_id)])]
    const row = (state: KnowledgePolicyEvaluation['checks'][number]['state'], reason: string) => ({ key: definition.key, label: definition.label, state, reason, evidence_refs: refs })
    if (!facts.length) return row('unknown', '本对象缺少通过来源、时点和事实状态检查的确认资料。')
    if (new Set(facts.map(fact => JSON.stringify([fact.value, fact.unit]))).size > 1) return row('conflict', '本对象的同项确认值存在冲突。')
    const fact = facts[0], condition = definition.condition
    if (!condition) return row('matched', '本项资料要求已有确认值；未设置新的数值否决门槛。')
    if (fact.unit !== condition.unit || typeof fact.value !== typeof condition.value) return row('unknown', '事实与条件单位或类型不兼容。')
    const a = fact.value, b = condition.value
    let matched: boolean | null = null
    if (condition.operator === 'eq') matched = a === b
    if (condition.operator === 'ne') matched = a !== b
    if (condition.operator === 'contains' && typeof a === 'string' && typeof b === 'string') matched = a.includes(b)
    if (typeof a === 'number' && typeof b === 'number' && Number.isFinite(a) && Number.isFinite(b)) {
      if (condition.operator === 'gt') matched = a > b
      if (condition.operator === 'gte') matched = a >= b
      if (condition.operator === 'lt') matched = a < b
      if (condition.operator === 'lte') matched = a <= b
    }
    const comparison = `已确认值${JSON.stringify(a)}${fact.unit || ''}；条件${condition.operator} ${JSON.stringify(b)}${condition.unit || ''}`
    return matched === null ? row('unknown', '当前取值不能按该比较方式确认。') : row(matched ? 'matched' : 'unmatched', comparison)
  })
  const veto = checks.some(check => check.state === 'unmatched' && policy.definitions.find(definition => definition.key === check.key)?.on_unmet === 'defer')
  return { policy_id: policy.id, revision: policy.revision, checks, guard: veto ? 'defer' : checks.some(check => check.state !== 'matched') ? 'supplement' : 'none',
    evidence_refs: [...new Set(checks.flatMap(check => check.evidence_refs))] }
}
