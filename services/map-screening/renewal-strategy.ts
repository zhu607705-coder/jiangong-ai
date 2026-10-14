import { randomUUID } from 'node:crypto'
import type { DecisionInput } from '../../packages/decision/structured-route'
import type { ProjectInput, RenewalStrategy, DecisionSupport } from '../../apps/host/generated/contracts'
import { LiveSession } from '../../runtime/dsh/live-session'
import { collectSelectedEvidence } from '../capabilities/research'
import { config } from '../../apps/host/config'
import { buildCompleteCommunityDemo, buildStrategyDemo, renderCompleteDemoReport } from '../../packages/retrofit/complete-demo'
import { STRATEGY_POLICY, validateStrategy, type StrategyPacket, type StrategySource } from '../../packages/retrofit/strategy'
import { projectRenewalModeInput } from '../../packages/retrofit/renewal-mode'
import { evaluateDecision } from '../capabilities/decision-model'

/** Uses DSH public research and the configured DeepSeek Flash Agent; no alternate model client. */
export async function researchRenewalStrategy(project: ProjectInput, version: number, input: DecisionInput, hash: string, synthetic: boolean, signal: AbortSignal, priorDecision: DecisionSupport | null): Promise<StrategyPacket> {
  const screening = input.renewalMode!, base: StrategyPacket = { project_id: project.project_id, context_version: version, input_hash: hash,
    created_at: new Date().toISOString(), synthetic, status: 'unavailable', strategy: null, sources: [], decision: priorDecision, model_calls: [], research: null, error: null }
  if (!config.modelConfigured) return { ...base, error: '请先配置 DeepSeek 模型接口。' }
  const budget = AbortSignal.any([signal, AbortSignal.timeout(135000)]), live = await LiveSession.open('MAP-AI-STRATEGY-' + randomUUID(), budget)
  try {
    let sources: StrategySource[] = screening.evidence.map(source => ({ id: source.source_id, title: source.title, text: source.quote,
      url: source.url, published_at: source.published_at, role: 'current', locator: source.locator }))
    if (!synthetic && config.searchConfigured) {
      const name = project.scope.map_anchor?.name || project.scope.name
      const queries = [
        `${name} 综合整治 原拆原建 房屋安全鉴定 site:gov.cn`, `${name} 加装电梯 二次供水 邻里中心`,
        `${name} 更新 权属 规划 居民协商 资金 安置`,
        '杭州 浙工新村 自主更新 居民筹资 工程 总投资 site:gov.cn',
        '上海 旧住房 成套改造 综合修缮 拆除重建 2026 site:shanghai.gov.cn',
        '上海 凤南一村 彭一小区 拆除重建 回搬 site:shanghai.gov.cn',
      ]
      const research = await live.runReadCapability('renewal_public_research', toolSignal => collectSelectedEvidence({ name, city: project.scope.city || '杭州', purpose: '老旧小区改造模式、综合整治与原拆原建比选', asOf: base.created_at, intelligence:false }, toolSignal, () => {}, undefined, queries))
      base.research = research.trace
      const merged = projectRenewalModeInput({ ...project, sources: [...project.sources, ...research.sources] })
      const objectIds = new Set(merged.evidence.map(source => source.source_id))
      for (const source of research.sources.filter(source => source.visibility === 'public' && source.data_class === 'public' && !source.synthetic && source.untrusted_text && source.content_status !== 'metadata_only')) {
        if (sources.some(row => row.id === source.id || row.url && row.url === source.url)) continue
        const current = objectIds.has(source.id)
        sources.push({ id: source.id, title: source.title, text: source.untrusted_text!.slice(0, 3500), url: source.url || null, published_at: source.published_at || null, role: current ? 'current' : 'reference', locator: 'public:excerpt' })
      }
    }
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
    if (!base.decision && config.decisionEnabled) base.decision = await live.runReadCapability('renewal_research_route', toolSignal => evaluateDecision(input, toolSignal))
    const prompt = `为${synthetic ? '杭州样本社区的完整模拟演示' : project.scope.name}生成展开大屏首屏的方案总览。先给整体研究方向和概括，再写综合整治、原拆原建两条具体路径，最后给六维现况、改后目标及下一步调查。必须两条paths、六条dimensions且key不得重复。preferred_mode是初步优先研究模式，可为compare；不是施工或拆迁批准。Qwen分流可参考，但其低置信度不能机械替代你的独立研究。headline必须说明具体的更新策略与空间或工程重点；headline、summary不写source ID，引用统一放在rationale和evidence_refs；不要用“先补资料”“待判断”代替方案标题。可以提出有条件、可调整的研究方案，将工程批准所需缺项放在requirements和next_checks，不必等资料全部补齐才给出方案。
当前对象原文与对标来源分开。只有role=current可支持本对象现况；reference仅用于提出方法与调查条件。不同文章、同名片区的数字不可拼成一个小区总量。历史供水方案的252户只属于29、30、31、48幢且是2023时点，不证明当前完成；47、54台电梯分别保留报道时点。老年人口比例可能为社区口径，不自动等于小区。原拆原建需逐栋鉴定、权属规划、居民决议、资金安置前提；没有对应专业材料就写调查动作，不能声称已具备。C级或房龄不能独立推出整片拆除。杭州和上海费用分别列，整体总投资与EPC合同额分别列，居民资产增值不算政府或运营方现金。
${synthetic ? '所有现况数字仅来自SIM-STRATEGY-BASE，明确完整模拟。可推演两条路径的差异，模拟整治工程1584万元不是拆建预算；拆建金额须另做全口径估算，不能造出已知投资额。' : '不编造人口、工程费用、改后真实成效。current_level是当前材料适配等级，缺少依据写unknown；comprehensive_level/rebuild_level是有前提的方案目标等级。low/medium/high对应研究展示1/3/5级，unknown留空，不是政府评分或满足法规概率。'}
rationale写3到5个具体判断，每条source_id和quote必须为提供文本的连续原句或归档字段；引用不能混合文件。每条举措与六维描述使用evidence_refs。引用不等于支持：必要的限定写进正文。actions给对象、实际动作、先后或实施前提，不复制通用清单。summary不超过400字，各维字段不超过160字。只输出structured_output。
<untrusted_sources>${JSON.stringify(sources)}</untrusted_sources>
${synthetic?"rationale.quote须从下列候选原句逐字复制，不得改写："+JSON.stringify(sources[0].text.split("\n").filter(line=>line.length>=16&&line.length<=360).map(quote=>({source_id:sources[0].id,quote})).slice(0,24)):""}
<screening>${JSON.stringify({ policy: STRATEGY_POLICY, as_of: project.as_of, conditions: input.renewalMode!.conditions, standards: screening.standards, history: screening.history, qwen: base.decision?.renewal_mode })}</screening>`
    let response = await live.call<RenewalStrategy>('renewal_strategy', prompt, 'RenewalStrategy', [], undefined, { evidenceIds: sources.map(source => source.id) })
    try { validateStrategy(response.value, sources,input.renewalMode!.conditions) }
    catch (error) {
      response = await live.call<RenewalStrategy>('renewal_strategy_quote_repair', prompt + '\n上一轮引文或完整性校验失败：' + (error instanceof Error ? error.message : '') + '。只修复引文或缺项，quote逐字复制一个连续片段，不添加新事实。', 'RenewalStrategy', [], undefined, { evidenceIds: sources.map(source => source.id) })
      validateStrategy(response.value, sources,input.renewalMode!.conditions)
    }
    return { ...base, status: 'completed', strategy: response.value, model_calls: [...live.calls] }
  } catch (error) {
    signal.throwIfAborted()
    return { ...base, status: 'failed', model_calls: [...live.calls], error: error instanceof Error && /^(STRATEGY_|LIVE_STAGE_FAILED)/.test(error.message) ? error.message.split(':').slice(0, 3).join(':') : '本轮 Agent 研究未完成，已取得的原文和检索记录保留。' }
  } finally { await live.close() }
}
