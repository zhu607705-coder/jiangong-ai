import { applyNeighborhoodGate, RETROFIT_RULE_VERSION } from '../../packages/retrofit/planning'
import {intelligenceScopeRevision} from '../../packages/intelligence/research-bridge'
import { BRIEF_SKILL_VERSION, selectReferenceCases, assertBriefProse } from '../skills/investment-brief'
import { randomUUID } from 'node:crypto'
import { Store, type RunRecord } from '../../apps/host/store'
import { config } from '../../apps/host/config'
import type { CapabilityResult, ComparisonPacket, DecisionPacket, Impact, ProjectInput, ResearchTrace, ReviewPacket, ScenarioProposal, Source, DecisionSupport, KnowledgeTrace } from '../../apps/host/generated/contracts'
import { validate, decisionPacket } from '../../packages/contracts/validate'
import { visibleSnapshot } from '../../packages/context/compiler'
import { assembleDecision, revisionDiff } from '../../packages/decision/evaluate'
import { validateFindings, enforceScenarioPolicy, validateReview, validateComparison, ModelOutputError } from '../../packages/decision/model-policy'
import { collectPublicEvidence } from '../../services/capabilities/research'
import { LiveSession } from '../dsh/live-session'
import { roles, type RoleId } from '../roles'
import { digest, roleDependency } from './run'
import { evaluateDecision, decisionCacheDescriptor } from '../../services/capabilities/decision-model'
import { decisionErrorMessage } from '../../packages/decision/route-labels'
import { projectDecisionInput, DECISION_ACTIONS, prioritizeDecisionFollowups } from '../../packages/decision/structured-route'
import { comparisonPolicy, comparisonDimensions } from '../../packages/decision/comparison-policy'
import { applyKnowledgePolicyGuard } from './knowledge'

/** Truncate text, never source identity/scope; the untruncated local artifact remains stored. */
function modelView(project: ProjectInput) {
  const { mode: _displayMode, events: _events, ...analysis } = project
  return { ...analysis, sources: project.sources.map(s => ({ ...s, untrusted_text: s.untrusted_text?.slice(0, 10000) })) }
}

export function specialistSnapshot(project: ProjectInput, role: RoleId): ProjectInput {
  const snapshot = structuredClone(project)
  const neighborhood=project.business_profile==='neighborhood'
  if (role === 'building_feasibility') {
    snapshot.facts = snapshot.facts.filter(f => (neighborhood?/building|rights|structural|lease|fire|utility|table_row|housing|pipe|engineering/:/building|rights|structural|lease|fire|utility|table_row/).test(f.kind))
    snapshot.context_rules = snapshot.context_rules.filter(r => ['active_lease', 'structural_safety'].includes(r.predicate))
  } else if (role === 'demand_operations') {
    snapshot.facts = snapshot.facts.filter(f => (neighborhood?/demand|population|supply|operation|service|table_row|resident|family|mobility|access/:/demand|population|supply|operation|service|table_row/).test(f.kind))
    snapshot.context_rules = []
  }
  const references = new Set([...snapshot.facts, ...snapshot.context_rules].map(item => item.source_id))
  snapshot.sources = snapshot.sources.filter(source => source.visibility === 'public' || references.has(source.id))
  return snapshot
}

export async function executeLiveRun(store: Store, run: RunRecord, signal: AbortSignal, knowledge?: KnowledgeTrace, knowledgeArtifact?: string, knowledgeSources: Source[] = []): Promise<void> {
  const full = structuredClone(run.snapshot)
  full.sources = [...new Map([...full.sources, ...knowledgeSources].map(source => [source.id, source])).values()]
  const neighborhood=full.business_profile==='neighborhood'
  const purpose=[neighborhood?'老旧小区改造':'存量利用与实施路径', full.knowledge_query?.measure_key, full.knowledge_query?.question].filter(Boolean).join(' · ')
  const businessGuidance=neighborhood?'本项目是老旧小区改造前期研判，以居民生活改善和工程实施为目标。优先回答改什么、为什么、影响哪些居民、先查什么及如何维护；不以资产升值、租售收益或IRR作为主判断。分别研究基础、完善、提升类改造；居民家庭与公共服务需求；鉴定消防、管网和施工接口；居民协商与实施主体；资金来源、工程成本与居民负担；物业长效维护。现状、估算、方案假设与缺项分别保留。提议、实际决策、已实施与结果不能混写；未记载的历史理由不补写。下一步应说明缺失材料、影响哪项结论、向谁取得及补齐后重算什么。':''
  const permittedInternal = full.synthetic || config.ALLOW_INTERNAL_MODEL === 'true'
  const modelProject = permittedInternal ? structuredClone(full) : visibleSnapshot(full, 'public')
  const artifactRefs: string[] = knowledgeArtifact ? [knowledgeArtifact] : []
  const day = new Date().toISOString().slice(0, 10)
  const intelligenceRevision=await intelligenceScopeRevision({name:full.scope.name,city:full.scope.city,purpose,asOf:full.as_of})
  const researchKey = digest({ intelligenceRevision, business_profile:full.business_profile||'general',purpose,project: full.project_id, scope: full.scope, as_of: full.as_of, day, source_ids: full.sources.filter(s => s.visibility === 'public').map(s => s.id) })
  let research: { sources: Source[]; trace: ResearchTrace; scope?: ProjectInput['scope'] }
  const cachedResearch = (await store.db.query<{ id: string; payload: typeof research }>('SELECT id,payload FROM artifacts WHERE project_id=$1 AND kind=$2 AND dependency_hash=$3', [full.project_id, 'research_collect', researchKey])).rows[0]
  if (cachedResearch) { research = structuredClone(cachedResearch.payload); research.trace.reused = true; artifactRefs.push(cachedResearch.id); await store.addEvent(run.id, 'research', 'reused', '公开研究资料未变化，复用已有抓取工件', cachedResearch.id) }
  else {
    await store.addEvent(run.id, 'research', 'running', full.synthetic ? '合成项目只使用给定测试资料' : '使用原生搜索获取公开资料，并核取原文')
    research = await collectPublicEvidence(modelProject, signal)
    const id = `ART-${randomUUID()}`
    await store.db.query('INSERT INTO artifacts(id,project_id,run_id,kind,dependency_hash,payload) VALUES($1,$2,$3,$4,$5,$6)', [id, full.project_id, run.id, 'research_collect', researchKey, JSON.stringify(research)])
    artifactRefs.push(id); await store.addEvent(run.id, 'research', 'completed', `取得 ${research.sources.length} 个公开来源；原文缺失会显式保留`, id)
  }
  for (const source of research.sources) {
    if (!full.sources.some(s => s.id === source.id)) full.sources.push(source)
    if (!modelProject.sources.some(s => s.id === source.id)) modelProject.sources.push(source)
  }
  if (research.scope) { full.scope = research.scope; modelProject.scope = structuredClone(research.scope) }
  const snapshotHash = digest(full), snapshotId = `ART-${randomUUID()}`
  const existingSnapshot = (await store.db.query<{ id: string }>('SELECT id FROM artifacts WHERE project_id=$1 AND kind=$2 AND dependency_hash=$3', [full.project_id, 'research_snapshot', snapshotHash])).rows[0]
  if (existingSnapshot) artifactRefs.push(existingSnapshot.id)
  else {
    await store.db.query('INSERT INTO artifacts(id,project_id,run_id,kind,dependency_hash,payload) VALUES($1,$2,$3,$4,$5,$6)', [snapshotId, full.project_id, run.id, 'research_snapshot', snapshotHash, JSON.stringify(full)])
    artifactRefs.push(snapshotId)
  }
  const previous = (await store.runs(run.project_id)).find(r => r.id !== run.id && r.decision)?.decision || null
  const impact: Impact = { changed_rule_ids: full.context_rules.filter(r => JSON.stringify(r) !== JSON.stringify(previous?.context_rules.find(before => before.id === r.id))).map(r => r.id), reused: [], invalidated: [], changed_paths: [] }
  const live = await LiveSession.open(run.id, signal)
  let decisionSupport:DecisionSupport|undefined
  try {
    async function cachedStage<T>(kind: string, input: unknown, execute: () => Promise<{ value: T; sessionId: string }>): Promise<{ value: T; sessionId: string }> {
      const decisionStage=kind==='decision_route'
      const key = digest({ project: run.project_id, kind, model: decisionStage?config.QWEN_DECISION_MODEL:config.DEEPSEEK_MODEL, business_profile:full.business_profile||'general',policy:decisionStage?'qwen-route-cache-v2':'live-stage-v3-neighborhood',...(full.business_profile==='neighborhood'?{action_policy:RETROFIT_RULE_VERSION}:{}), ...(decisionStage?{}:{brief_skill:BRIEF_SKILL_VERSION}), input })
      const cached = (await store.db.query<{ id: string; payload: { value: T; sessionId: string } }>('SELECT id,payload FROM artifacts WHERE project_id=$1 AND kind=$2 AND dependency_hash=$3', [run.project_id, kind, key])).rows[0]
      if (cached) { artifactRefs.push(cached.id); impact.reused.push(kind); await store.addEvent(run.id, kind, 'reused', '复用已验证的模型阶段工件', cached.id); return cached.payload }
      const result = await execute(), id = `ART-${randomUUID()}`
      await store.db.query('INSERT INTO artifacts(id,project_id,run_id,kind,dependency_hash,payload) VALUES($1,$2,$3,$4,$5,$6)', [id, run.project_id, run.id, kind, key, JSON.stringify(result)])
      artifactRefs.push(id); return result
    }
    if(config.decisionEnabled) {
      const input=projectDecisionInput(full)
      await store.addEvent(run.id,'decision_route','running','Qwen 正在判断证据是否充分与优先调查方向')
      const result=await cachedStage<DecisionSupport>('decision_route',decisionCacheDescriptor(input,{model:config.QWEN_DECISION_MODEL,endpoint:config.QWEN_DECISION_ENDPOINT}),async()=>{
        const value=await live.runReadCapability('qwen_research_route',toolSignal=>evaluateDecision(input,toolSignal))
        if(value.status!=='completed') {
          await store.addEvent(run.id,'decision_route','failed',decisionErrorMessage(value.error_code))
          throw new Error(value.error_code || 'DECISION_REQUEST_FAILED')
        }
        return {value,sessionId:run.id}
      })
      decisionSupport=result.value
      await store.addEvent(run.id,'decision_route','completed',`${DECISION_ACTIONS[decisionSupport.action!]}：${decisionSupport.next_step}`)
    }
    const results = new Map<RoleId, CapabilityResult>()
    const tasks = roles.map(async role => {
      const roleProject = specialistSnapshot(modelProject, role.id)
      const { mode: _mode, events: _events, ...completeToolInput } = roleProject
      const key = digest({ policy: 'model-v4', brief_skill: BRIEF_SKILL_VERSION, model: config.DEEPSEEK_MODEL, day, role: role.id, actual_model_input: completeToolInput })
      const cached = (await store.db.query<{ id: string; payload: CapabilityResult }>('SELECT id,payload FROM artifacts WHERE project_id=$1 AND kind=$2 AND dependency_hash=$3', [run.project_id, role.id, key])).rows[0]
      if (cached) { results.set(role.id, validate<CapabilityResult>('CapabilityResult', cached.payload)); impact.reused.push(role.id); artifactRefs.push(cached.id); await store.addEvent(run.id, role.id, 'reused', '模型输入依赖未变化，复用已校验工件', cached.id); return }
      impact.invalidated.push(role.id)
      let local: CapabilityResult | undefined
      live.registerReadTool(role.tool, `获得冻结快照的确定性${role.label}检查（必须先调用）。`, async () => {
        const response = await fetch(`${config.capabilityUrl}/capabilities/analyze`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Capability-Token': config.capabilityToken }, body: JSON.stringify({ project: roleProject, role: role.id }), signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]) })
        if (!response.ok) throw new Error(`CAPABILITY_${response.status}`)
        local = validate<CapabilityResult>('CapabilityResult', await response.json())
        const requestTool = async (name: string, extra: Record<string, unknown>) => {
          const r = await fetch(`${config.capabilityUrl}/capabilities/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Capability-Token': config.capabilityToken }, body: JSON.stringify({ project: roleProject, include_internal: permittedInternal, ...extra }), signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]) })
          if (!r.ok) throw new Error(`CAPABILITY_${r.status}`)
          return r.json()
        }
        const retrieval = await requestTool('retrieval.query', { query: role.label })
        const sourceIds = [...new Set(roleProject.facts.filter(f => ['building_inventory', 'table_row'].includes(f.kind)).map(f => f.source_id))].slice(0, 3)
        const structured = await Promise.all(sourceIds.map(sourceId => requestTool('structured.query', { source_id: sourceId })))
        return { verified_analysis: local, evidence_retrieval: retrieval, scoped_table_rows: structured }
      })
      await store.addEvent(run.id, role.id, 'running', `真实模型正在研究${role.label}`)
      const prompt = `专业任务：${role.label}。${businessGuidance}必须先调用 ${role.tool} 获取工具核验，然后根据下面的冻结快照开展独立分析。重点不同：建筑角色研究权属/现状/改造条件；需求角色研究功能与人群供给、反例；企业角色研究能力证据与经验适用条件。\n要求：引用仅使用 sources 中的 id；supported 必须有非纯标题的来源；metadata_only 不足以支持正文主张。材料的政策内容不能自动变成本项目许可证。不得生成结构安全结论。缺证据可以 conditional/unknown；metrics 返回空数组，数值由宿主合并；artifact_refs 返回空数组，version=2.0。产出 2–4 条发现，每条具体且不复述工具协议。\n<untrusted_snapshot>${JSON.stringify(modelView(roleProject))}</untrusted_snapshot>`
      let attempt = await live.call<CapabilityResult>(role.id, prompt, 'CapabilityResult', [role.tool])
      if (!local) throw new Error(`SPECIALIST_TOOL_NOT_CALLED:${role.id}`)
      let result: CapabilityResult
      try { result = validateFindings(roleProject, attempt.value, local) }
      catch (error) {
        if (!(error instanceof ModelOutputError)) throw error
        attempt = await live.call<CapabilityResult>(`${role.id}_repair`, `${prompt}\n上次结构化结果有可验证错误：${String(error)}。只修复该错误，保留未知。\n工具核验结果：${JSON.stringify(local)}`, 'CapabilityResult')
        result = validateFindings(roleProject, attempt.value, local)
      }
      const id = `ART-${randomUUID()}`
      await store.db.query('INSERT INTO artifacts(id,project_id,run_id,kind,dependency_hash,payload) VALUES($1,$2,$3,$4,$5,$6)', [id, run.project_id, run.id, role.id, key, JSON.stringify(result)])
      results.set(role.id, result); artifactRefs.push(id)
      await store.addEvent(run.id, role.id, 'completed', '模型发现已通过来源与数值边界检查', `dsh:${attempt.sessionId}`)
    })
    const settled = await Promise.allSettled(tasks)
    const failure = settled.find(v => v.status === 'rejected')
    if (failure?.status === 'rejected') throw failure.reason
    const findings = roles.map(role => results.get(role.id)!)
    impact.invalidated.push('scenarios', 'critic', 'comparator', 'report')
    await store.addEvent(run.id, 'scenarios', 'running', '模型正在生成不同实施路径，并保留具体调查选项')
    const shared = JSON.stringify({ snapshot: modelView(modelProject), research: findings, ...(decisionSupport?{research_route:{action:decisionSupport.action,priority:decisionSupport.priority,next_step:decisionSupport.next_step,guard_reasons:decisionSupport.guard_reasons},renewal_mode:decisionSupport.renewal_mode}: {}) })
    // Source bodies contain many unrelated terms; match examples to the selected
    // research object so a campus does not inherit incidental community cases.
    const referenceCases = selectReferenceCases(neighborhood?`${full.scope.name} 老旧小区 社区更新 居民 公共服务`:full.scope.name)
    const scenarioPrompt = `${businessGuidance}在共同证据下生成 2–3 条不同实施路径，ID 必须来自 ${JSON.stringify(full.candidate_ids)}，必须包含 defer_and_investigate。不是换标题：actions、前置条件、适用情境和反证要体现差异；每条先写本路径独有的对象、文件和参与条件，不重复抄写通用缺项。每个文字字段尽量不超过 60 字，actions/前置条件/反证各 2–3 项，避免重复长篇说明。必须填写 action_specs，kind 从 schema 枚举选取；whole_demolition 只能用于 whole_site_rebuild；defer_and_investigate 只做 investigate/retain，其标题应说明本项目要查的具体对象，不写“暂缓基线”。所有路径保留未核实的权属/结构/功能需求，不能给出安全和审批保证。evidence_refs 只能引用 sources.id；rule_refs 可为空，最终组织边界由宿主校验。无成本材料不得填成本、IRR或工期数字。所有必需字段都需填写。\n<untrusted_evidence>${shared}</untrusted_evidence>\n以下案例只提供实施机制，不作为本项目事实：${JSON.stringify(referenceCases)}`
    const scenarioResponse = await cachedStage<ScenarioProposal>('scenarios', { shared, candidate_ids: full.candidate_ids }, async () => {
      let response = await live.call<ScenarioProposal>('scenarios', scenarioPrompt, 'ScenarioProposal', [], full.candidate_ids)
      try { response.value = enforceScenarioPolicy(modelProject, response.value) }
      catch (error) { if (!(error instanceof ModelOutputError)) throw error; response = await live.call<ScenarioProposal>('scenarios_repair', `${scenarioPrompt}\n必须修复：${String(error)}`, 'ScenarioProposal', [], full.candidate_ids); response.value = enforceScenarioPolicy(modelProject, response.value) }
      return response
    })
    const proposal = scenarioResponse.value
    await store.addEvent(run.id, 'scenarios', 'completed', '候选通过动作语义与项目硬约束校验', `dsh:${scenarioResponse.sessionId}`)
    await store.addEvent(run.id, 'critic', 'running', '独立反证角色正在挑战依据、假设和实施条件')
    const reviewed = await cachedStage<ReviewPacket>('critic', { shared, proposal }, async () => {
      const response = await live.call<ReviewPacket>('critic', `${businessGuidance}你是独立反证审查者，不替作者补事实。逐项检查候选是否错误拼接对象/时点、以标题代正文、把偏好当强制规则、过度推出结构安全、企业能力或需求。指出 3–5 项最可能改变路径的薄弱前提，每个问题及建议不超过 80 字；target_refs 指向发现或路径。只引用给定 sources.id，没证据可为空。不要因多个角色重复主张而提高可信度。\n<untrusted_evidence>${shared}</untrusted_evidence>\n<proposal>${JSON.stringify(proposal)}</proposal>`, 'ReviewPacket')
      validateReview(modelProject, response.value); return response
    })
    const reviews = validateReview(modelProject, reviewed.value)
    await store.addEvent(run.id, 'critic', 'completed', '独立反证结果已记录，分歧不会被投票消除', `dsh:${reviewed.sessionId}`)
    await store.addEvent(run.id, 'comparator', 'running', '按硬约束和共同证据比较路径；允许并列和暂缓')
    const comparisonVersion=comparisonPolicy(full),dimensions=comparisonDimensions(full)
    const comparisonRules=`本轮比较语义版本 ${comparisonVersion}；criterion 键及业务含义严格使用 ${JSON.stringify(dimensions)}。${neighborhood?`必须恰好包含这六维，不得漏维或重复；每维 judgments 必须恰好覆盖下列全部候选路径，不得漏项或重复。六维与改造适配雷达共用业务口径，七项专业前置确认及独立否决仍由宿主 ${RETROFIT_RULE_VERSION} 判定，只认当前快照的项目确认事实与规则，不能以等级相抵。`:'保留实施、建筑、需求、组织、企业与资源的既有比较口径，不使用旧改专属维度。'}policy_version 填写 ${comparisonVersion}。`
    const compared = await cachedStage<ComparisonPacket>('comparator', { shared, proposal, reviews,comparison_policy:comparisonVersion,comparison_dimensions:dimensions,...(neighborhood?{action_rule_version:RETROFIT_RULE_VERSION}:{}) }, async () => {
      const response = await live.call<ComparisonPacket>('comparator', `${businessGuidance}${comparisonRules}比较下面已通过工具硬约束检查的候选。实际候选只有 ${JSON.stringify(proposal.scenarios.map(s => s.id))}，不能添加池中未入选的路径。不得改变路径状态，不用多数票或自造成功概率。按六个维度给出所有实际候选的条件化判断，每个 conclusion 不超过 45 字，unknowns 最多两个短语；阻断路径不能进入 tied_paths。证据不足可并列，也可仅建议调查。summary 不超过 96 字，直接说明建议路径、关键条件与下一步，不复述免责声明。followups 只取 2 项最重要调查，每条 why 不超过 50 字；status=suggested，priority 1–3。分歧最多 3 条。所有 evidence_refs 只能来自 sources.id。保持合法且简短的 JSON 工具参数。\n<untrusted_evidence>${shared}</untrusted_evidence>\n<proposal>${JSON.stringify(proposal)}</proposal>\n<independent_review>${JSON.stringify(reviews)}</independent_review>`, 'ComparisonPacket', [], proposal.scenarios.map(s => s.id), { evidenceIds: modelProject.sources.map(source => source.id) })
      validateComparison(modelProject, proposal, response.value); assertBriefProse(response.value); return response
    })
    const comparison = validateComparison(modelProject, proposal, compared.value)
    impact.invalidated = impact.invalidated.filter(kind => !impact.reused.includes(kind))
    const packet: DecisionPacket = assembleDecision({ project: full, runId: run.id, revision: run.revision, contextVersion: run.context_version, snapshotHash, executionMode: 'live', results: findings, artifactRefs, impact, model: live.calls.find(c => c.returned_model)?.returned_model || null })
    packet.scenarios = enforceScenarioPolicy(full, structuredClone(proposal)).scenarios
    comparison.tied_paths = comparison.tied_paths.filter(id => packet.scenarios.find(s => s.id === id)?.status !== 'blocked')
    packet.summary = comparison.summary
    packet.reviews.push(...reviews.reviews)
    packet.followups = comparison.followups
    if(decisionSupport) {
      packet.followups=prioritizeDecisionFollowups(packet.followups,decisionSupport,packet.scenarios.map(s=>s.id))
      comparison.followups=packet.followups
    }
    packet.comparison = comparison
    packet.analysis_method = 'model_assisted'
    packet.status = full.facts.length || full.sources.some(s => s.untrusted_text?.trim()) ? 'partial' : 'empty'
    packet.model_calls = live.calls
    if (knowledge) packet.knowledge = { ...knowledge, fallback_status: 'executed', agent_status: 'executed' }
    packet.research = research.trace
    if(decisionSupport) packet.decision_support=decisionSupport
    packet.unresolved_disagreements = [...new Set([...proposal.unresolved, ...reviews.unresolved_disagreements, ...comparison.unresolved_disagreements])]
    packet.warnings.push(...research.trace.warnings, '模型输出经引用与硬约束检查，尚不构成企业决策效用验证。')
    if (!permittedInternal && full.sources.some(s => s.visibility === 'internal')) packet.warnings.push('内部正文未发送至外部模型；企业规则仅在本地执行，模型企业分析使用公开资料。')
    packet.impact.changed_paths = [...new Set(revisionDiff(previous, packet).changes.map(change => change.path_id))]
    applyNeighborhoodGate(full,packet)
    applyKnowledgePolicyGuard(packet)
    decisionPacket(packet)
    await store.db.transaction(async db => {
      await db.query('UPDATE runs SET status=$2,decision=$3 WHERE id=$1', [run.id, 'completed', JSON.stringify(packet)])
      await db.query('INSERT INTO run_events(run_id,stage,status,message) VALUES($1,$2,$3,$4)', [run.id, 'decision', 'completed', `模型研判已完成：${live.calls.length} 次真实调用，来源与未知项随报告保存`])
    })
  } finally {
    try {
      await store.db.query('INSERT INTO artifacts(id,project_id,run_id,kind,dependency_hash,payload) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(project_id,kind,dependency_hash) DO UPDATE SET payload=artifacts.payload || EXCLUDED.payload', [`ART-${randomUUID()}`, full.project_id, run.id, 'model_trace', run.id, JSON.stringify(live.calls)])
    } finally { await live.close() }
  }
}
