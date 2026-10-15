import { randomUUID } from 'node:crypto'
import type { DecisionInput } from '../../packages/decision/structured-route'
import type { ProjectInput, RenewalStrategy, DecisionSupport } from '../../apps/host/generated/contracts'
import { LiveSession } from '../../runtime/dsh/live-session'
import { collectSelectedEvidence } from '../capabilities/research'
import { config } from '../../apps/host/config'
import { buildCompleteCommunityDemo, buildStrategyDemo, renderCompleteDemoReport } from '../../packages/retrofit/complete-demo'
import { STRATEGY_POLICY, validateStrategy, strategyFailure, strategyPromptSources, type StrategyPacket, type StrategyProgress, type StrategySource } from '../../packages/retrofit/strategy'
import { projectRenewalModeInput, evaluateRenewalModeGate } from '../../packages/retrofit/renewal-mode'
import { renewalResearchRounds } from '../../packages/retrofit/renewal-research-plan'
import { evaluateDecision } from '../capabilities/decision-model'

/** Uses DSH public research and the configured DeepSeek Flash Agent; no alternate model client. */
export async function researchRenewalStrategy(project: ProjectInput, version: number, input: DecisionInput, hash: string, synthetic: boolean, signal: AbortSignal, priorDecision: DecisionSupport | null,
  options: { onProgress?: (event: StrategyProgress) => void } = {}): Promise<StrategyPacket> {
  const screening = input.renewalMode!, base: StrategyPacket = { project_id: project.project_id, context_version: version, input_hash: hash,
    created_at: new Date().toISOString(), synthetic, status: 'unavailable', strategy: null, sources: [], decision: priorDecision, model_calls: [], research: null, error: null }
  let stage: StrategyProgress['stage'] = 'sources'
  const progress = (value: Omit<StrategyProgress, 'type'>) => { stage = value.stage; options.onProgress?.({ type: 'progress', ...value }) }
  progress({ stage, status: 'running', message: '读取本项目原文与已保存的改造条件。' })
  if (!config.modelConfigured) {
    const failure = strategyFailure(new Error('MODEL_NOT_CONFIGURED'), [])
    progress({ stage: 'result', status: 'failed', message: failure.error })
    return { ...base, ...failure }
  }
  const started = Date.now(), budget = AbortSignal.any([signal, AbortSignal.timeout(135000)])
  let live: LiveSession | undefined
  try {
    let sources: StrategySource[] = screening.evidence.map(source => ({ id: source.source_id, title: source.title, text: source.quote,
      url: source.url, published_at: source.published_at, role: 'current', locator: source.locator }))
    base.sources = sources
    progress({ stage: 'sources', status: 'completed', message: `已读取 ${sources.length} 份对象依据，准备核对公开案例。`, source_count: sources.length })
    live = await LiveSession.open('MAP-AI-STRATEGY-' + randomUUID(), budget)
    if (!synthetic && config.searchConfigured) {
      const name = project.scope.map_anchor?.name || project.scope.name
      const rounds = renewalResearchRounds(name, screening.conditions)
      base.research = { status: 'success', queries: [], source_ids: [], warnings: [], reused: true }
      for (const [index, round] of rounds.entries()) {
        if (index > 0 && Date.now() - started >= 80000) {
          base.research.status = 'partial'; base.research.warnings.push('为保留方案与引用核验时间，本轮未执行杭州、上海及本对象费用补查。')
          progress({ stage: 'research', status: 'running', message: '首轮检索已结束；剩余时间留给方案与引用核验，补查主题已记录。', query_count: base.research.queries.length, source_count: sources.length, round: index, round_count: rounds.length })
          break
        }
        const fetched = new Set<string>()
        progress({ stage: 'research', status: 'running', message: `第 ${index + 1}/${rounds.length} 轮：${round.label}。`, query_count: base.research.queries.length, source_count: sources.length, round: index + 1, round_count: rounds.length })
        const research = await live.runReadCapability(`renewal_public_research_${round.key}`, toolSignal => collectSelectedEvidence({ name, city: project.scope.city || '杭州', purpose: '老旧小区改造模式、综合整治与原拆原建比选', asOf: base.created_at, intelligence:false }, toolSignal, event => {
          if (event.stage === 'fetch' && event.status === 'completed' && event.source_id) fetched.add(event.source_id)
          progress({ stage: 'research', status: 'running', message: event.stage === 'fetch' ? `第 ${index + 1}/${rounds.length} 轮已取得 ${fetched.size} 份公开来源，继续核对正文。` : `第 ${index + 1}/${rounds.length} 轮正在检索并整理公开来源。`, source_count: sources.length + fetched.size, query_count: base.research!.queries.length, round: index + 1, round_count: rounds.length })
        }, undefined, round.queries))
        base.research = { status: base.research.status === 'success' && research.trace.status === 'success' ? 'success' : 'partial',
          queries: [...new Set([...base.research.queries, ...research.trace.queries])], source_ids: [...new Set([...base.research.source_ids, ...research.trace.source_ids])],
          warnings: [...new Set([...base.research.warnings, ...research.trace.warnings])], reused: base.research.reused && research.trace.reused }
        const merged = projectRenewalModeInput({ ...project, sources: [...project.sources, ...research.sources] })
        const objectIds = new Set(merged.evidence.map(source => source.source_id))
        for (const source of research.sources.filter(source => source.visibility === 'public' && source.data_class === 'public' && !source.synthetic && source.untrusted_text && source.content_status !== 'metadata_only')) {
          if (sources.some(row => row.id === source.id || row.url && row.url === source.url)) continue
          sources.push({ id: source.id, title: source.title, text: source.untrusted_text!, url: source.url || null, published_at: source.published_at || null, role: objectIds.has(source.id) ? 'current' : 'reference', locator: 'public:excerpt' })
        }
        if (!research.sources.some(source => source.untrusted_text && source.content_status !== 'metadata_only')) {
          base.research.status = 'partial'; base.research.warnings.push(`${round.label}未取得可用正文；已保留本轮检索主题，相关条件仍待核。`)
        }
        progress({ stage: 'research', status: 'running', message: `第 ${index + 1}/${rounds.length} 轮已完成，累计保留 ${sources.length} 份可用资料。`, source_count: sources.length, query_count: base.research.queries.length, round: index + 1, round_count: rounds.length })
      }
    }
    else progress({ stage: 'research', status: 'skipped', message: synthetic ? '使用完整模拟底表与归档案例，不进行外部检索。' : '本轮使用已保存原文与归档案例。' })
    for (const example of screening.cases) sources.push({ id: example.id, title: `${example.city} · ${example.name} · 归档对标字段`,
      text: JSON.stringify(example), url: example.url, published_at: example.published_at, role: 'reference', locator: `case:${example.id}` })
    const demo = synthetic ? buildCompleteCommunityDemo() : null
    if (demo) {
      const rebuild=buildStrategyDemo('rebuild')
      const text=`模拟社区规模：${demo.households}户、${demo.population}人、${demo.buildingArea}平方米。\n综合整治含预备费预算：${demo.capital.total}万元；拟出资合计1600万元。\n原拆原建演示估算：${rebuild.budget_wan}万元；对应已安排1600万元，资金缺口23645万元。\n${renderCompleteDemoReport(demo)}\n\n## 原拆原建演示假设\n${rebuild.assumptions}\n${rebuild.dimensions.map(row=>`${row.label}：${row.after}`).join('\n')}`
      sources = [{ id: 'SIM-STRATEGY-BASE', title: '杭州样本社区 · 完整模拟方案底表', text, url: null, published_at: '2026-10-13', role: 'current', locator: 'synthetic:complete-demo-v1' }, ...sources.filter(source=>screening.cases.some(example=>example.id===source.id)).map(source => ({ ...source, role: 'reference' as const }))]
      base.decision = null
      input = { ...input, sourceIds:sources.map(source=>source.id), neighborhoodAction:undefined,
        factors:input.factors.map(factor=>({...factor,state:'unknown',conflict:false,evidence_refs:[],quote:''})),
        state: { purpose:'完整模拟社区的两种更新模式对照', synthetic:true }, renewalMode: { ...screening, target: '杭州样本社区 · 完整模拟', object_ref:'synthetic:complete-demo-v1', synthetic:true, as_of:'2026-10-13',
          conditions:screening.conditions.map(condition=>({...condition,value:null,state:'unknown',source_ids:[],locators:[]})),
          evidence:[{source_id:'SIM-STRATEGY-BASE',title:sources[0].title,published_at:'2026-10-13',locator:sources[0].locator,quote:sources[0].text,url:null}] } }
    }
    base.sources = sources
    if (!synthetic && config.searchConfigured) progress({ stage: 'research', status: 'completed', message: `已整理 ${sources.length} 份对象依据与对标资料。`, source_count: sources.length, query_count: base.research?.queries.length || 0 })
    progress({ stage: 'model', status: 'running', message: '正在根据原文研究综合整治与原拆原建两条路径。', source_count: sources.length })
    if (!base.decision && config.decisionEnabled) base.decision = await live.runReadCapability('renewal_research_route', toolSignal => evaluateDecision(input, toolSignal))
    const promptSources = strategyPromptSources(sources), gate = evaluateRenewalModeGate({ conditions: input.renewalMode!.conditions })
    const prompt = `为${synthetic ? '杭州样本社区的完整模拟演示' : project.scope.name}生成展开大屏首屏的方案总览。先给整体研究方向和概括，再写综合整治、原拆原建两条具体路径，最后给六维现况、改后目标及下一步调查。必须两条paths、六条dimensions且key不得重复。preferred_mode是初步优先研究模式，可为compare；不是施工或拆迁批准。Qwen分流可参考，但其低置信度不能机械替代你的独立研究。headline必须说明具体的更新策略与空间或工程重点；headline、summary不写source ID，引用统一放在rationale和evidence_refs；不要用“先补资料”“待判断”代替方案标题。可以提出有条件、可调整的研究方案，将工程批准所需缺项放在requirements和next_checks，不必等资料全部补齐才给出方案。
当前拆建门控：${gate.summary}。仅当rebuild_allowed=true时preferred_mode才可为rebuild；必要性或可行性未通过时，以综合整治为研究基线；结构明确不可修但拆建条件未齐时为compare。不得以模型观点覆盖这项门控。${JSON.stringify({rebuild_allowed:gate.rebuild_allowed,direction:gate.direction})}
当前对象原文与对标来源分开。只有role=current可支持本对象现况；reference仅用于提出方法与调查条件。不同文章、同名片区的数字不可拼成一个小区总量。历史供水方案的252户只属于29、30、31、48幢且是2023时点，不证明当前完成；47、54台电梯分别保留报道时点。老年人口比例可能为社区口径，不自动等于小区。原拆原建需逐栋鉴定、权属规划、居民决议、资金安置前提；没有对应专业材料就写调查动作，不能声称已具备。C级或房龄不能独立推出整片拆除。杭州和上海费用分别列，整体总投资与EPC合同额分别列，居民资产增值不算政府或运营方现金。
${synthetic ? '所有现况数字仅来自SIM-STRATEGY-BASE，明确完整模拟。可推演两条路径的差异，模拟整治工程1584万元不是拆建预算；拆建金额须另做全口径估算，不能造出已知投资额。' : '不编造人口、工程费用、改后真实成效。current_level是当前材料适配等级，缺少依据写unknown；comprehensive_level/rebuild_level是有前提的方案目标等级。low/medium/high对应研究展示1/3/5级，unknown留空，不是政府评分或满足法规概率。'}
rationale写3到5个具体判断，每条source_id和quote必须为提供文本的连续原句或归档字段；引用不能混合文件。每条举措与六维描述使用evidence_refs。引用不等于支持：必要的限定写进正文。actions给对象、实际动作、先后或实施前提，不复制通用清单。summary不超过400字，各维字段不超过160字。只输出structured_output。
<untrusted_sources>${JSON.stringify(promptSources)}</untrusted_sources>
${synthetic?"rationale.quote须从下列候选原句逐字复制，不得改写："+JSON.stringify(sources[0].text.split("\n").filter(line=>line.length>=16&&line.length<=360).map(quote=>({source_id:sources[0].id,quote})).slice(0,24)):""}
<screening>${JSON.stringify({ policy: STRATEGY_POLICY, as_of: project.as_of, conditions: input.renewalMode!.conditions, standards: screening.standards, history: screening.history, qwen: base.decision?.renewal_mode })}</screening>`
    let response = await live.call<RenewalStrategy>('renewal_strategy', prompt, 'RenewalStrategy', [], undefined, { evidenceIds: promptSources.map(source => source.id) })
    progress({ stage: 'model', status: 'completed', message: '已取得模型方案，开始核对原文引用与适用条件。' })
    progress({ stage: 'validation', status: 'running', message: '核对两条路径、六个维度、引文原句与限制条件。' })
    try { validateStrategy(response.value, promptSources,input.renewalMode!.conditions) }
    catch (error) {
      progress({ stage: 'validation', status: 'running', message: '首次引用核验未通过，正在按同一来源修复引用。' })
      response = await live.call<RenewalStrategy>('renewal_strategy_quote_repair', prompt + '\n上一轮引文或完整性校验失败：' + (error instanceof Error ? error.message : '') + '。只修复引文或缺项，quote逐字复制一个连续片段，不添加新事实。', 'RenewalStrategy', [], undefined, { evidenceIds: promptSources.map(source => source.id) })
      validateStrategy(response.value, promptSources,input.renewalMode!.conditions)
    }
    progress({ stage: 'validation', status: 'completed', message: '方案完整性、引用与已登记条件核验通过。' })
    progress({ stage: 'result', status: 'completed', message: '整体更新方案已生成，正在保存本次结果。', source_count: sources.length })
    return { ...base, status: 'completed', strategy: response.value, model_calls: [...live.calls] }
  } catch (error) {
    signal.throwIfAborted()
    const calls = [...(live?.calls || [])], failure = strategyFailure(error, calls, { stage, timedOut: budget.aborted })
    console.warn(JSON.stringify({ event: 'renewal_strategy_failed', project_id: project.project_id, context_version: version, input_hash: hash, diagnostic: failure.diagnostic,
      source_count: base.sources.length, query_count: base.research?.queries.length || 0, model_calls: calls.length, model_duration_ms: calls.reduce((sum, call) => sum + call.duration_ms, 0) }))
    progress({ stage: live ? stage : 'result', status: 'failed', message: failure.error, source_count: base.sources.length })
    return { ...base, status: 'failed', model_calls: calls, ...failure }
  } finally { await live?.close() }
}
