import type { CapabilityResult, DecisionPacket, ExperienceRule, ProjectInput, Scenario, Review, Impact } from '../../apps/host/generated/contracts'

const definitions = {
  retain_and_reuse: { title: '保留利用 · 适配更新', actions: ['保留现有建筑', '核实适配条件后分栋更新'], demolition_scope: 'none' },
  selective_rebuild: { title: '局部拆改 · 分期实施', actions: ['明确保留与拆改对象', '局部拆除与新建衔接'], demolition_scope: 'partial' },
  whole_site_rebuild: { title: '整体拆除 · 重建论证', actions: ['全场地拆除', '重新组织建设'], demolition_scope: 'whole_site' },
  defer_and_investigate: { title: '暂缓建设 · 优先调查', actions: ['维持现状管理', '补齐最可能改变路径的资料'], demolition_scope: 'none' },
} as const

export function activeRules(project: ProjectInput): ExperienceRule[] {
  return project.mode === 'enterprise' ? project.context_rules.filter(r => r.active !== false && r.scope === 'project' && (!r.project_id || r.project_id === project.project_id)) : []
}

export function evaluateScenarios(project: ProjectInput): Scenario[] {
  const rules = activeRules(project)
  const noDemolition = rules.filter(r => r.kind === 'organizational_constraint' && r.predicate === 'no_whole_site_demolition' && r.value === true && r.authority_status === 'project_confirmed')
  const phasing = rules.filter(r => r.kind === 'preference' && r.predicate === 'prefer_phasing' && r.value === true)
  const displayOrder = Object.keys(definitions)
  return [...project.candidate_ids].sort((a, b) => displayOrder.indexOf(a) - displayOrder.indexOf(b)).map(id => {
    const definition = definitions[id]
    const defer = id === 'defer_and_investigate'
    const blocked = definition.demolition_scope === 'whole_site' && noDemolition.length > 0
    const scenario: Scenario = { id, title: definition.title, status: blocked ? 'blocked' : defer ? 'investigate' : 'conditional',
      actions: [...definition.actions], demolition_scope: definition.demolition_scope,
      prerequisites: defer ? ['调查活动需取得相应现场和资料访问授权'] : ['核实地块和建筑权属、现有租约及实施权限', '取得结构检测、消防和用途适配意见', '补齐真实功能需求与运营依据'],
      blockers: blocked ? ['本项目已生效的组织约束禁止整体拆除'] : [],
      evidence_refs: project.facts.filter(f => ['building_inventory', 'structural_assessment', 'rights_status'].includes(f.kind)).map(f => f.source_id).filter((id, i, all) => all.indexOf(id) === i),
      rule_refs: [], counterevidence: defer ? ['暂缓可能延后利用机会；需用调查结果检验是否继续等待'] : ['空置不等于可立即投入改造', '缺失结构资料不能证明安全可改', '当前材料不足以证明运营需求成立'],
      enterprise_fit: '待核：未取得可核验的能力与资源材料', resource_status: '未知：不据缺失数据填算成本或工期', preference_notes: [] }
    if (!defer && noDemolition.length) {
      scenario.rule_refs.push(...noDemolition.map(r => r.id))
      scenario.prerequisites.push('遵守本项目不整体拆除的组织边界；局部拆改仍需单独核实')
    }
    if (!defer && phasing.length) {
      scenario.rule_refs.push(...phasing.map(r => r.id))
      scenario.preference_notes.push('优先论证分期实施与在租建筑衔接；偏好不作为已获批准的证据')
    }
    if (rules.some(r => r.kind === 'capability_lead')) scenario.enterprise_fit = '存在经验线索；需核实对应团队、项目证据与当前可用资源'
    if (rules.some(r => r.predicate === 'active_lease')) scenario.prerequisites.push('补充在租建筑编号、租期和协商腾退条件')
    return scenario
  })
}

export function review(project: ProjectInput, scenarios: Scenario[], results: CapabilityResult[]): Review[] {
  const reviews: Review[] = [
    { id: 'REV-SAFETY', severity: 'high', issue: '结构适配仍未知，不能把更新路径写成确定可实施。', target_refs: scenarios.filter(s => s.status === 'conditional').map(s => s.id), evidence_refs: project.facts.filter(f => f.kind === 'structural_assessment').map(f => f.source_id), recommendation: '由有资质的专业人员补充结构检测及消防适配意见。' },
    { id: 'REV-SCOPE', severity: 'high', issue: '研究范围与开发权利不能等同。', target_refs: ['scope'], evidence_refs: [], recommendation: '核实法定地块边界、权属及实施授权。' },
  ]
  if (results.some(r => r.metrics.some(m => m.status === 'conflict'))) reviews.push({ id: 'REV-CONFLICT', severity: 'high', issue: '建筑清单存在同口径冲突；有关指标保留未知。', target_refs: ['gfa_m2', 'vacancy_ratio'], evidence_refs: project.facts.filter(f => f.kind === 'building_inventory').map(f => f.source_id), recommendation: '核对清单时点、对象范围与原始测绘依据，不能取平均消除冲突。' })
  if (project.sources.some(s => /忽略.*规则|发送.*外部/.test(s.untrusted_text || ''))) reviews.push({ id: 'REV-INSTRUCTION', severity: 'medium', issue: '材料包含改变权限或外发资料的文本，已作为不可信内容处理。', target_refs: ['sources'], evidence_refs: [], recommendation: '保留材料来源；仅执行应用预先注册且授权的能力。' })
  return reviews
}

export function assembleDecision(args: { project: ProjectInput; runId: string; revision: number; contextVersion: number; snapshotHash: string; executionMode: 'offline' | 'live'; results: CapabilityResult[]; artifactRefs: string[]; impact: Impact; model: string | null }): DecisionPacket {
  const { project, results } = args
  const scenarios = evaluateScenarios(project)
  return { schema_version: '2.0', project_id: project.project_id, run_id: args.runId, revision: args.revision, context_version: args.contextVersion, snapshot_hash: args.snapshotHash,
    mode: project.mode, execution_mode: args.executionMode, synthetic: project.synthetic, status: project.facts.length ? 'partial' : 'empty', as_of: project.as_of, created_at: new Date().toISOString(), scope: project.scope,
    summary: project.facts.length ? '已按当前证据列出有条件的实施路径。实施前提仍需补齐，暂不形成建设可行或投资批准结论。' : '当前资料不足以判断是否进入专项尽调。仅列出待核路径和缺项，暂不确定建设方式。',
    findings: results.flatMap(r => r.findings), metrics: results.flatMap(r => r.metrics), scenarios,
    reviews: review(project, scenarios, results),
    followups: [
      { id: 'FOLLOW-RIGHTS', priority: 1, title: '核实权属、租约与实施权限', why: '可能阻断全部建设路径，优先于功能定位与收益测算。', impacted_paths: scenarios.filter(s => s.id !== 'defer_and_investigate').map(s => s.id), status: 'suggested' },
      { id: 'FOLLOW-STRUCTURE', priority: 1, title: '补充结构检测与消防适配意见', why: '决定保留更新与拆改路径的技术边界。', impacted_paths: ['retain_and_reuse', 'selective_rebuild'].filter(id => project.candidate_ids.includes(id as Scenario['id'])) as Scenario['id'][], status: 'suggested' },
      { id: 'FOLLOW-DEMAND', priority: 2, title: '开展使用需求与运营访谈', why: '检验功能假设，避免将区位或空置比例直接等同于需求。', impacted_paths: scenarios.map(s => s.id), status: 'suggested' },
    ], sources: structuredClone(project.sources), context_rules: structuredClone(project.context_rules), impact: args.impact,
    warnings: [...new Set([...(project.synthetic ? ['显式合成项目；仅用于工程流程验证，不代表真实片区结论。'] : []), ...(args.executionMode === 'offline' ? ['离线规则检查；未调用真实模型与联网搜索。'] : []), ...results.flatMap(r => r.warnings)])],
    missing_fields: [...new Set(results.flatMap(r => r.missing_fields))], artifact_refs: args.artifactRefs, runtime: 'DeepSeek Harness 0.2.0-rc.1', model: args.model }
}

export function revisionDiff(before: DecisionPacket | null, after: DecisionPacket | null) {
  if (!before || !after) return { available: false, changes: [], from_revision: before?.revision ?? null, to_revision: after?.revision ?? null }
  const fields = ['status', 'prerequisites', 'blockers', 'enterprise_fit', 'preference_notes', 'actions'] as const
  const changes = after.scenarios.flatMap(current => {
    const previous = before.scenarios.find(s => s.id === current.id)
    return fields.filter(field => JSON.stringify(previous?.[field]) !== JSON.stringify(current[field])).map(field => ({ path_id: current.id, title: current.title, field, before: previous?.[field] ?? null, after: current[field], rule_refs: current.rule_refs }))
  })
  return { available: true, from_revision: before.revision, to_revision: after.revision, changes, reused: after.impact.reused, invalidated: after.impact.invalidated }
}
