import { randomUUID } from 'node:crypto'
import type { DecisionInput } from '../../packages/decision/structured-route'
import type { ProjectInput, RenewalStrategy, DecisionSupport } from '../../apps/host/generated/contracts'
import { LiveSession } from '../../runtime/dsh/live-session'
import { collectSelectedEvidence } from '../capabilities/research'
import { config } from '../../apps/host/config'
import { buildCompleteCommunityDemo, buildStrategyDemo, renderCompleteDemoReport } from '../../packages/retrofit/complete-demo'
import { STRATEGY_POLICY, validateStrategy, strategyFailure, strategyPromptSources, strategyConstructionAllowed, type StrategyPacket, type StrategyProgress, type StrategySource } from '../../packages/retrofit/strategy'
import { projectRenewalModeInput, evaluateRenewalModeGate, renewalCommunitySources } from '../../packages/retrofit/renewal-mode'
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
  const started = Date.now(), budget = AbortSignal.any([signal, AbortSignal.timeout(230000)])
  let live: LiveSession | undefined
  try {
    let sources: StrategySource[] = screening.evidence.map(source => ({ id: source.source_id, title: source.title, text: source.quote,
      url: source.url, published_at: source.published_at, role: 'current', locator: source.locator }))
    for (const source of renewalCommunitySources(project, screening.evidence)) {
      const community = source.object_refs!.filter(ref => ref.startsWith('community:')).map(ref => ref.slice('community:'.length)).join('、')
      sources.push({ id: source.id, title: `${source.title}（社区范围背景：${community}；本小区覆盖与运营效果待核）`, text: source.untrusted_text!,
        url: source.url || null, published_at: source.published_at || null, role: 'reference', locator: source.locator || `text:chars:1-${source.untrusted_text!.length}` })
    }
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
    progress({ stage: 'model', status: 'running', message: '正在综合原文，提出更新取舍、投入阶段与财务及社会效果建议。', source_count: sources.length })
    if (!base.decision && config.decisionEnabled) base.decision = await live.runReadCapability('renewal_research_route', toolSignal => evaluateDecision(input, toolSignal))
    const promptSources = strategyPromptSources(sources), gate = evaluateRenewalModeGate({ conditions: input.renewalMode!.conditions })
    const constructionAdmission = { comprehensive: strategyConstructionAllowed('comprehensive',input.renewalMode!.conditions,promptSources), rebuild: strategyConstructionAllowed('rebuild',input.renewalMode!.conditions,promptSources) }
    const historicalStages = synthetic ? [] : [
      promptSources.some(source=>/求是.*二次供水|二次供水.*求是/.test(source.title)&&source.published_at?.startsWith('2023')&&/亚运会.*进场施工/.test(source.text)) ? '2023年求是村二次供水原文记载的是进场准备、拟于亚运会后施工，按当时准备阶段使用。' : '',
      promptSources.some(source=>/75幢1单元/.test(source.title)&&/草案|征求意见/.test(source.title)&&source.published_at?.startsWith('2024')) ? '2024年75幢1单元加梯原文是征求意见草案，已存金额保留草案估算口径。' : '',
    ].filter(Boolean)
    const prompt = `你负责为“${synthetic ? '杭州样本社区的完整模拟演示' : project.scope.name}”综合已保存原文和本轮公开资料，主动提出一组有取舍的项目候选决策。先判断本对象最值得解决的问题、两种更新路径的得失、钱应投向什么及由谁受益，再输出具体结论。Qwen结果是可参考的分流信息，你仍需独立解释本项目的证据和选择。
本次必须填写decision_brief的三部分，文字由你依据本项目资料生成：
1. renewal={conclusion,reason,evidence_refs}：明确建议优先的更新方向、具体工程或空间重点，以及相较另一条路径的取舍理由。
2. investment={conclusion,reason,stage,evidence_refs}：明确现在是否值得投入、资金先投哪些对象和工作、何时进入下一阶段。stage只能为preliminary（前期）、construction（工程实施）或hold（暂缓）。根据现有证据选择投入阶段和范围，不把所有项目写成同一套前期论证建议。
当前工作台对construction投资建议采用以下系统准入：本对象有来源及定位支持的资金落实条件；综合整治另有结构可修复的有效条件，拆建采用完整拆建门。当前准入结果${JSON.stringify(constructionAdmission)}。通过后才建议进入对应工程实施；尚未通过时，仍提出具体的鉴定、设计、预算、居民协商或分项核实投入，明确投入对象与下一阶段触发条件。专业审批继续按原适用程序完成。
${historicalStages.join('')}本对象当前施工或验收状态采用后续明确记录确认；仅有上述历史准备或草案时，投资建议落在具体前期或分项核实，开工、招标和交付准备状态保持原文所载阶段。
3. returns={financial,social,evidence_refs}：financial按政府/建设或运营主体/居民区分投入、补助、可实现现金收入及持续维护支出；social说明居民服务、工程条件、影响人群与实施代价。把已知局部金额、金额阶段和承担主体用起来，给出具体的价值判断；只有完整、同口径的收支数据才计算回报率，资产变化与现金收益分别解释。
三部分每块evidence_refs至少一个，均引用本轮提供的source id。结论是本阶段供人比较和调整的建议；技术审批、资金承诺和施工准入由已登记条件约束，缺项写入对应路径的requirements和next_checks。
实施准入门：${gate.summary} ${JSON.stringify({rebuild_allowed:gate.rebuild_allowed,direction:gate.direction})}。preferred_mode在comprehensive/rebuild/compare中选择；仅rebuild_allowed=true可选rebuild，结构已明确不可修而拆建条件未齐时选compare。仍应在两条paths中提出可比较的方案和条件化目标。
一次生成两套方向明确的研究成果，供使用者在首屏研判后选择。两路比较集中在decision_brief和rationale；每条path的title、description、actions、requirements只描述该方向，dimensions.comprehensive和dimensions.rebuild分别只写本方向的措施、目标及实现条件，便于按明确选择隔离展示。
单路径字段直接写本方向的措施、效果与条件，不写另一模式名称，也不放另一模式的排除或比较句；跨路关系统一放decision_brief/rationale。综合整治字段不出现原拆原建、整体拆建、整体拆除重建，拆建字段不出现综合整治；各模式未来维度描述采用相同边界，原文引用与现况保持原貌。
现况与目标分别评估：current_level表示原文支持的当前条件，依据缺失处为unknown；comprehensive_level/rebuild_level表示在该路径所列动作和实施假设下的目标适配，可由本对象原文或对标机制支持low/medium/high。用各维current/comprehensive/rebuild写清现况、目标及实现假设。批准条件尚待核查时，在实施协同维度和requirements说明；其余有依据的服务或工程目标照常评估。low/medium/high按1/3/5展示，目标等级与已发生的事实分开。
材料使用：role=current支撑本对象现况；reference用于方法、社区背景和对标目标。数量、费用与阶段保留来源的对象范围和时点，分项估算、合同、结算及整体预算分别列。结构鉴定、居民决议、资金到账等事实逐项取自原文。${synthetic ? '本次所有现况数值取自SIM-STRATEGY-BASE，明确完整模拟；整治和拆建分别采用各自的演示预算。' : '社会效果可提出带前提的预期，实际成效和人口金额取自所列来源。'}
输出组织：decision_brief在前，接headline、summary、preferred_mode、rationale、两条paths、六条dimensions和next_checks。headline直接点明本项目建议；summary控制在220字内。每块brief的conclusion尽量100字内、reason180字内，financial/social各160字内。rationale写3至4个核心判断，每条quote逐字复制同一来源中一段连续原句或归档字段，保留必要限定。两路径各写2至3项具体actions、2至3项requirements；next_checks写3项最影响决策的核查。六维key不重复，每个描述尽量90字内，保留对象、动作与实现条件，避免重复套话。各举措和维度均引用evidence_refs。只调用structured_output。
<untrusted_sources>${JSON.stringify(promptSources)}</untrusted_sources>
${synthetic?"rationale.quote须从下列候选原句逐字复制，不得改写："+JSON.stringify(sources[0].text.split("\n").filter(line=>line.length>=16&&line.length<=360).map(quote=>({source_id:sources[0].id,quote})).slice(0,24)):""}
<screening>${JSON.stringify({ policy: STRATEGY_POLICY, as_of: project.as_of, conditions: input.renewalMode!.conditions, standards: screening.standards, history: screening.history, qwen: base.decision?.renewal_mode })}</screening>`
    let response = await live.call<RenewalStrategy>('renewal_strategy', prompt, 'RenewalStrategy', [], undefined, { evidenceIds: promptSources.map(source => source.id) })
    progress({ stage: 'model', status: 'completed', message: '已取得模型方案，开始核对原文引用与适用条件。' })
    progress({ stage: 'validation', status: 'running', message: '核对三部分决策、两条路径、六个维度及原文引用。' })
    try { validateStrategy(response.value, promptSources,input.renewalMode!.conditions,true) }
    catch (error) {
      if(error instanceof Error&&/^(STRATEGY_CONSTRUCTION_GATE_UNMET|STRATEGY_PATH_DIRECTION_MIXED)$/.test(error.message)) console.warn(JSON.stringify({event:'renewal_strategy_quality_retry',project_id:project.project_id,code:error.message,stage:'validation'}))
      progress({ stage: 'validation', status: 'running', message: '首次引用核验未通过，正在按同一来源修复引用。' })
      response = await live.call<RenewalStrategy>('renewal_strategy_quote_repair', prompt + '\n上一轮决策简报、引文或完整性校验失败：' + (error instanceof Error ? error.message : '') + '。补齐decision_brief三部分并核对各自evidence_refs，保留已有项目分析；quote逐字复制连续原句，按当前实施准入门修复相关选择。', 'RenewalStrategy', [], undefined, { evidenceIds: promptSources.map(source => source.id) })
      validateStrategy(response.value, promptSources,input.renewalMode!.conditions,true)
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
