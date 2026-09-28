import type { CapabilityResult, ComparisonPacket, ProjectInput, ReviewPacket, ScenarioProposal } from '../../apps/host/generated/contracts'
import { evaluateScenarios } from './evaluate'
export class ModelOutputError extends Error {}

export function hasUnqualifiedAssurance(text: string): boolean {
  return text.split(/[，,。；;\n]/).some(clause => /已获.*批准|确定.*安全|保证.*收益|成功率|风险为零/.test(clause) && !/无法|不能|不得|尚未|未能|不应|不可|不代表|不构成|不计算|未经/.test(clause))
}

export function checkSourceRefs(project: ProjectInput, refs: string[]) {
  const ids = new Set(project.sources.map(s => s.id))
  const mapped = refs.map(ref => {
    if (ids.has(ref)) return ref
    // A citation to a known fact/rule is a valid lineage reference, not an
    // invented source. Resolve it only inside this already authorized snapshot.
    const item = project.facts.find(fact => fact.id === ref) || project.context_rules.find(rule => rule.id === ref)
    if (item && ids.has(item.source_id)) return item.source_id
    throw new ModelOutputError(`引用不在获准快照中：${ref}`)
  })
  return [...new Set(mapped)]
}

export function validateFindings(project: ProjectInput, proposed: CapabilityResult, computed: CapabilityResult): CapabilityResult {
  for (const finding of proposed.findings) {
    finding.evidence_refs = checkSourceRefs(project, finding.evidence_refs)
    finding.opposition_refs = checkSourceRefs(project, finding.opposition_refs)
    if (finding.status === 'supported' && !finding.evidence_refs.length) throw new ModelOutputError('supported 判断必须有来源引用')
    if (finding.status === 'supported' && finding.evidence_refs.every(id => project.sources.find(s => s.id === id)?.content_status === 'metadata_only')) throw new ModelOutputError('检索标题不足以支持确定事实；必须标记 unknown')
    if (hasUnqualifiedAssurance(finding.claim)) throw new ModelOutputError('禁止把初筛写成安全、审批或收益保证')
  }
  const missing = [...new Set([...computed.missing_fields, ...proposed.missing_fields])]
  return { ...proposed, status: missing.length ? 'partial' : proposed.status, metrics: computed.metrics, artifact_refs: [], version: '2.0', missing_fields: missing, warnings: [...computed.warnings, ...proposed.warnings] }
}

export function enforceScenarioPolicy(project: ProjectInput, proposal: ScenarioProposal): ScenarioProposal {
  const ids = proposal.scenarios.map(s => s.id)
  if (new Set(ids).size !== ids.length || !ids.includes('defer_and_investigate')) throw new ModelOutputError('候选 ID 不能重复，且必须保留暂缓调查基线')
  if (ids.some(id => !project.candidate_ids.includes(id))) throw new ModelOutputError('候选不在本次允许的动作族内')
  const baseline = evaluateScenarios(project)
  for (const scenario of proposal.scenarios) {
    const policy = baseline.find(s => s.id === scenario.id)!
    scenario.evidence_refs = checkSourceRefs(project, scenario.evidence_refs)
    if (!scenario.action_specs?.length) throw new ModelOutputError('每条路径必须给出结构化 action_specs')
    if (scenario.id === 'retain_and_reuse' && scenario.action_specs.some(a => ['whole_demolition', 'partial_demolition'].includes(a.kind))) throw new ModelOutputError('保留利用路径不能夹带建筑拆除动作')
    if (scenario.action_specs.some(a => a.kind === 'whole_demolition') && scenario.id !== 'whole_site_rebuild') throw new ModelOutputError('整体拆除动作不能伪装成保留或局部拆改')
    if (scenario.id === 'defer_and_investigate' && scenario.action_specs.some(a => !['investigate', 'retain'].includes(a.kind))) throw new ModelOutputError('暂缓调查基线不能包含建设或拆除动作')
    scenario.demolition_scope = policy.demolition_scope
    scenario.status = policy.status
    scenario.blockers = policy.blockers
    scenario.prerequisites = [...new Set([...policy.prerequisites, ...scenario.prerequisites])]
    scenario.rule_refs = policy.rule_refs
    scenario.enterprise_fit = policy.enterprise_fit
    scenario.resource_status = policy.resource_status
    scenario.preference_notes = [...new Set([...policy.preference_notes, ...scenario.preference_notes])]
  }
  return proposal
}

export function validateReview(project: ProjectInput, packet: ReviewPacket) {
  for (const review of packet.reviews) review.evidence_refs = checkSourceRefs(project, review.evidence_refs)
  return packet
}

export function validateComparison(project: ProjectInput, proposal: ScenarioProposal, packet: ComparisonPacket) {
  const allowed = new Set(proposal.scenarios.map(s => s.id))
  const blocked = new Set(proposal.scenarios.filter(s => s.status === 'blocked').map(s => s.id))
  for (const criterion of packet.criteria) {
    for (const judgment of criterion.judgments) {
      if (!allowed.has(judgment.scenario_id)) throw new ModelOutputError('比较结果引用了不存在的路径')
      judgment.evidence_refs = checkSourceRefs(project, judgment.evidence_refs)
    }
  }
  if (packet.tied_paths.some(id => !allowed.has(id) || blocked.has(id))) throw new ModelOutputError('被硬约束阻断的路径不能进入并列候选')
  if (hasUnqualifiedAssurance(packet.summary)) throw new ModelOutputError('比较摘要不能作工程或投资批准保证')
  for (const item of packet.followups) if (item.impacted_paths.some(id => !allowed.has(id))) throw new ModelOutputError('调查项引用了不存在的路径')
  return packet
}
