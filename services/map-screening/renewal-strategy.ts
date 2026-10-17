import { randomUUID,createHash } from 'node:crypto'
import type { DecisionInput } from '../../packages/decision/structured-route'
import type { ProjectInput, RenewalStrategy, DecisionSupport } from '../../apps/host/generated/contracts'
import { LiveSession } from '../../runtime/dsh/live-session'
import { collectSelectedEvidence } from '../capabilities/research'
import { config } from '../../apps/host/config'
import { buildCompleteCommunityDemo, buildStrategyDemo, renderCompleteDemoReport } from '../../packages/retrofit/complete-demo'
import { STRATEGY_POLICY, reviewStrategyContent, strategyFailure, strategyPromptSources, strategyConstructionAllowed, strategyModelReferences, type StrategyPacket, type StrategyProgress, type StrategySource } from '../../packages/retrofit/strategy'
import { ContractError, validate as validateContract } from '../../packages/contracts/validate'
import { projectRenewalModeInput, evaluateRenewalModeGate, renewalCommunitySources } from '../../packages/retrofit/renewal-mode'
import { renewalResearchRounds } from '../../packages/retrofit/renewal-research-plan'
import { evaluateDecision,decisionRequestBody,withDecisionExecution } from '../capabilities/decision-model'
import type { ResearchRoundContext } from '../../apps/host/research-rounds'
import { runRenewalResearch } from '../../runtime/workflows/renewal-research'
import { loadRenewalAgentProfile } from '../../runtime/agents/renewal/profiles'
import {captureCurrentAssessment} from '../../packages/retrofit/strategy-assessment'
import {bindStrategySource,projectObjectLocation} from '../../packages/retrofit/object-binding'
import {resolveAnswerSlots,DEFAULT_RESEARCH_QUESTIONS,costReferenceGroups,projectFinancialQuestion} from '../../packages/retrofit/research-coverage'
import {conditionalReport} from '../../packages/retrofit/conditional-report'
import {packEvidenceContext} from '../../packages/retrofit/evidence-compression'
import {modelSchema} from '../../packages/contracts/validate'

/** Small contiguous quote choices, using the same line/excerpt approach as the demo prompt. */
export function sourceQuoteCandidates(sources:readonly StrategySource[],priorityIds:readonly string[]=[],windows?:readonly {source_id:string;start_char:number;end_char:number;text:string}[]) {
  const priorities=new Set(priorityIds),choices:{source_id:string;locator:string;quotes:string[];quote_refs?:{start_char:number;end_char:number}[]}[]=[]
  let remaining=3000
  const ordered=[...sources].sort((a,b)=>Number(priorities.has(b.id))-Number(priorities.has(a.id))||Number(b.role==='current')-Number(a.role==='current'))
  for(const source of ordered) {
    if(choices.length>=12||remaining<16)break
    const sourceWindows=windows?.filter(window=>window.source_id===source.id)
    const bodies=sourceWindows?sourceWindows.map(window=>window.text):[source.text]
    const parts=bodies.flatMap(text=>[...text.split('\n'),...(text.match(/[^。！？\n]+[。！？]?/gu)||[])]).map(text=>text.trim()).filter(text=>text.length>=16&&text.length<=360)
    const candidates=[parts.find(text=>/\d+(?:\.\d+)?\s*(?:户|台|幢|栋|万元|元|平方米|㎡|人次|人)/.test(text)),parts.find(text=>/改造|更换|更新|加装|新建|治理|配置|供水|服务/.test(text)),parts[0]]
    const quotes=[...new Set(candidates.filter((text):text is string=>!!text))].slice(0,2).filter(text=>{if(text.length>remaining)return false;remaining-=text.length;return true})
    if(quotes.length){
      const quote_refs=sourceWindows?quotes.map(quote=>{const window=sourceWindows.find(window=>window.text.includes(quote))!;const start_char=window.start_char+window.text.indexOf(quote);return {start_char,end_char:start_char+quote.length}}):undefined
      choices.push({source_id:source.id,locator:source.locator,quotes:quote_refs?[]:quotes,...(quote_refs?{quote_refs}:{})})
    }
  }
  return choices
}

function projectStrategyOutput(value:RenewalStrategy,round:ResearchRoundContext|undefined):RenewalStrategy {
  if(round) return !round.parent&&value.round_review?{...value,round_review:{...value.round_review,changes:[]}}:value
  const projected={...value};delete projected.round_review
  return projected
}

/** Uses DSH public research and the configured DeepSeek Flash Agent; no alternate model client. */
export async function researchRenewalStrategy(project: ProjectInput, version: number, input: DecisionInput, hash: string, synthetic: boolean, signal: AbortSignal, priorDecision: DecisionSupport | null,
  options: { onProgress?: (event: StrategyProgress) => void; roundContext?: ResearchRoundContext; referenceSources?: readonly StrategySource[]; savedResearch?: Pick<StrategyPacket,'sources'|'research'>; researchWorkflow?:boolean } = {}): Promise<StrategyPacket> {
  const screening = input.renewalMode!, base: StrategyPacket = { project_id: project.project_id, context_version: version, input_hash: hash,
    created_at: new Date().toISOString(), synthetic, status: 'unavailable', strategy: null, sources: [], decision: priorDecision, model_calls: [], research: null, error: null }
  let stage: StrategyProgress['stage'] = 'sources'
  const progress = (value: Omit<StrategyProgress, 'type'>) => { stage = value.stage; options.onProgress?.({ type: 'progress', ...value }) }
  progress({ stage, status: 'running', message: '读取本项目原文与已保存的改造条件。' })
  if (!config.modelConfigured) {
    const failure = strategyFailure(new Error('MODEL_NOT_CONFIGURED'), [])
    progress({ stage: 'result', status: 'failed', message: failure.error })
    const fallbackSources=options.roundContext?.sources||project.sources.filter(source=>source.visibility==='public'&&source.untrusted_text).map(source=>bindStrategySource({id:source.id,title:source.title,text:source.untrusted_text!,url:source.url||null,published_at:source.published_at||null,locator:source.locator||'project:registered',role:'current'},project))
    return conditionalReport(project,{...base,...failure,sources:fallbackSources},[],'当前模型未配置，先保留条件方案与资料补充路径')
  }
  const execution=options.roundContext?.execution,deadlineAt=execution?.deadlineAt??Date.now()+900000
  const started = Date.now(), budget = AbortSignal.any([signal, AbortSignal.timeout(Math.max(1,deadlineAt-Date.now()))])
  let live: LiveSession | undefined
  try {
    const round = options.roundContext
    if (round) {
      if (round.sources.some(source=>source.project_id!==project.project_id||!round.materials.some(material=>material.source_id===source.id&&material.version===source.document_version))) throw new Error('ROUND_DOCUMENT_SCOPE')
      if (round.sources.some(source=>source.visibility==='internal')&&(!round.allow_internal_ai||config.ALLOW_INTERNAL_MODEL!=='true')) throw new Error('ROUND_INTERNAL_MODEL_DISABLED')
      const priorInternal=round.parent?.result?.sources.filter(source=>source.visibility==='internal'||source.data_class==='internal')||[]
      if(priorInternal.length&&(!round.allow_internal_ai||config.ALLOW_INTERNAL_MODEL!=='true'||priorInternal.some(source=>!round.sources.some(selected=>selected.id===source.id&&selected.document_version===source.document_version)))) throw new Error('ROUND_PARENT_MATERIAL_CONSENT')
    }
    let sources: StrategySource[] = screening.evidence.map(source => ({ id: source.source_id, title: source.title, text: source.quote,
      url: source.url, published_at: source.published_at, role: 'current', locator: source.locator }))
    if (round) sources = [...round.sources, ...sources.filter(source=>!round.sources.some(selected=>selected.id===source.id))]
    for (const source of renewalCommunitySources(project, screening.evidence)) {
      const community = source.object_refs!.filter(ref => ref.startsWith('community:')).map(ref => ref.slice('community:'.length)).join('、')
      sources.push({ id: source.id, title: `${source.title}（社区范围背景：${community}；本小区覆盖与运营效果待核）`, text: source.untrusted_text!,
        url: source.url || null, published_at: source.published_at || null, role: 'reference', locator: source.locator || `text:chars:1-${source.untrusted_text!.length}` })
    }
    const workReferenceIds:string[]=[]
    for(const source of (options.referenceSources||[]).slice(0,6)) {
      if(!source.text.trim()||source.visibility==='internal'||source.data_class==='internal')continue
      if(!sources.some(row=>row.id===source.id))sources.push({...source,role:'reference'})
      if(sources.find(row=>row.id===source.id)?.role==='reference')workReferenceIds.push(source.id)
    }
    if(options.savedResearch) {
      // The host binds this opt-in retry to the same hash/version. Only its public research is reusable.
      const restrictedIds=new Set(project.sources.filter(source=>source.visibility==='internal'||source.data_class==='internal'||source.synthetic).map(source=>source.id))
      const deniedIds=new Set<string>()
      for(const source of options.savedResearch.sources) {
        if(source.visibility==='internal'||source.data_class==='internal'||source.data_class==='synthetic'||source.data_class==='semi_synthetic'||source.document_id||restrictedIds.has(source.id)||source.project_id&&source.project_id!==project.project_id||source.locator.startsWith('synthetic:')||source.id.startsWith('SIM-')) {deniedIds.add(source.id);continue}
        if(!source.text.trim()||sources.some(row=>row.id===source.id||!!row.url&&row.url===source.url&&row.text===source.text))continue
        sources.push({...source})
      }
      base.research=options.savedResearch.research?{...structuredClone(options.savedResearch.research),source_ids:options.savedResearch.research.source_ids.filter(id=>!deniedIds.has(id)),reused:true}:null
    }
    sources=sources.map(source=>bindStrategySource(source,project))
    base.sources = sources
    progress({ stage: 'sources', status: 'completed', message: `已读取 ${sources.length} 份对象依据，准备核对公开案例。`, source_count: sources.length })
    live = await LiveSession.open('MAP-AI-STRATEGY-' + randomUUID(), budget)
    if(execution)live.attachExecution?.(execution)
    if(options.savedResearch) progress({stage:'research',status:'completed',message:'复用同资料版本已取得的公开来源与检索记录，本轮只重新生成方案。',source_count:sources.length,query_count:base.research?.queries.length||0})
    else if (!synthetic && config.searchConfigured) {
      const location=projectObjectLocation(project.scope)
      const name = [location.city,project.scope.map_anchor?.name || project.scope.name].filter(Boolean).join(' ')
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
        const acquire =()=> live!.runReadCapability(`renewal_public_research_${round.key}`, toolSignal => collectSelectedEvidence({ name, city: location.city || '', purpose: '老旧小区改造模式、综合整治与原拆原建比选', asOf: base.created_at,forceDiscovery:true,provider:execution?.provider,onWebCall:execution?receipt=>execution.recordWebCall(receipt):undefined,intelligencePolicy:{readExisting:true,rememberNew:true,checkFreshness:true} }, toolSignal, event => {
          if (event.stage === 'fetch' && event.status === 'completed' && event.source_id) fetched.add(event.source_id)
          progress({ stage: 'research', status: 'running', message: event.stage === 'fetch' ? `第 ${index + 1}/${rounds.length} 轮已取得 ${fetched.size} 份公开来源，继续核对正文。` : `第 ${index + 1}/${rounds.length} 轮正在检索并整理公开来源。`, source_count: sources.length + fetched.size, query_count: base.research!.queries.length, round: index + 1, round_count: rounds.length })
        }, undefined, round.queries))
        const research=await (execution?execution.run('acquire_evidence:'+round.key,{name,queries:round.queries,asOf:project.as_of,provider:execution.provider},acquire):acquire()).catch(error=>{
          budget.throwIfAborted()
          return {sources:[],trace:{status:'partial' as const,queries:round.queries,source_ids:[],warnings:['本轮公开检索未完成，保留主题供继续搜索与阅读。'],reused:false}}
        })
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
    for (const example of screening.cases.slice(0,6)) if(!sources.some(source=>source.id===example.id||source.role==='reference'&&source.url===example.url))sources.push({ id: example.id, title: `${example.city} · ${example.name} · 归档对标字段`,
      text: JSON.stringify(example), url: example.url, published_at: example.published_at, role: 'reference', locator: `case:${example.id}` })
    const demo = synthetic && !round ? buildCompleteCommunityDemo() : null
    if (demo) {
      const rebuild=buildStrategyDemo('rebuild')
      const text=`模拟社区规模：${demo.households}户、${demo.population}人、${demo.buildingArea}平方米。\n综合整治含预备费预算：${demo.capital.total}万元；拟出资合计1600万元。\n原拆原建演示估算：${rebuild.budget_wan}万元；对应已安排1600万元，资金缺口23645万元。\n${renderCompleteDemoReport(demo)}\n\n## 原拆原建演示假设\n${rebuild.assumptions}\n${rebuild.dimensions.map(row=>`${row.label}：${row.after}`).join('\n')}`
      sources = [{ id: 'SIM-STRATEGY-BASE', title: '杭州样本社区 · 完整模拟方案底表', text, url: null, published_at: '2026-10-13', role: 'current', locator: 'synthetic:complete-demo-v1' }, ...sources.filter(source=>screening.cases.some(example=>example.id===source.id)||workReferenceIds.includes(source.id)).map(source => ({ ...source, role: 'reference' as const }))]
      base.decision = null
      input = { ...input, sourceIds:sources.map(source=>source.id), neighborhoodAction:undefined,
        factors:input.factors.map(factor=>({...factor,state:'unknown',conflict:false,evidence_refs:[],quote:''})),
        state: { purpose:'完整模拟社区的两种更新模式对照', synthetic:true }, renewalMode: { ...screening, target: '杭州样本社区 · 完整模拟', object_ref:'synthetic:complete-demo-v1', synthetic:true, as_of:'2026-10-13',
          conditions:screening.conditions.map(condition=>({...condition,value:null,state:'unknown',source_ids:[],locators:[]})),
          evidence:[{source_id:'SIM-STRATEGY-BASE',title:sources[0].title,published_at:'2026-10-13',locator:sources[0].locator,quote:sources[0].text,url:null}] } }
    }
    sources=sources.map(source=>bindStrategySource(source,project))
    base.sources = sources
    if(execution){sources=await execution.run('freeze_sources',{project:project.project_id,hash,provider:execution.provider},async()=>sources);base.sources=sources;base.manifests=[await execution.manifest(sources,DEFAULT_RESEARCH_QUESTIONS.map(question=>question.id))]}
    if (!synthetic && config.searchConfigured && !options.savedResearch) progress({ stage: 'research', status: 'completed', message: `已整理 ${sources.length} 份对象依据与对标资料。`, source_count: sources.length, query_count: base.research?.queries.length || 0 })
    progress({ stage: 'model', status: 'running', message: '正在综合原文，提出更新取舍、投入阶段与财务及社会效果建议。', source_count: sources.length })
    let promptSources = options.researchWorkflow?sources:strategyPromptSources(sources,workReferenceIds)
    const gate = evaluateRenewalModeGate({ conditions: input.renewalMode!.conditions })
    const routingInput:DecisionInput=options.researchWorkflow?{...input,researchPlanning:true,state:{evidence:input.state,public_research_catalog:promptSources.filter(source=>source.visibility!=='internal'&&source.data_class!=='internal').map(source=>({id:source.id,title:source.title,role:source.role,preview:source.text.slice(0,220)}))}}:input
    const routingHash=createHash('sha256').update(JSON.stringify(decisionRequestBody(routingInput))).digest('hex')
    if (config.decisionEnabled&&(!base.decision||options.researchWorkflow&&base.decision.research_routing?.input_hash!==routingHash)) {
      try {
        progress({stage:'model',status:'running',message:'正在快速判断研究重点与各专题所需力度。'})
        const route=()=>live!.runReadCapability('renewal_research_route',toolSignal=>evaluateDecision(routingInput,toolSignal))
        const fast=execution?await execution.run('route_research',{routingHash},()=>withDecisionExecution(execution,route)):await route()
        if(!base.decision||base.decision.status!=='completed')base.decision=fast
        else if(fast.research_routing)base.decision={...base.decision,research_routing:fast.research_routing}
      }
      catch {budget.throwIfAborted();progress({stage:'model',status:'running',message:'模式服务本次未完成，先依据已有资料形成候选方案；模式条件保留待核。'})}
    }
    let workflow:Awaited<ReturnType<typeof runRenewalResearch>>|null=null
    let researchDetailsUnavailable=false
    if(options.researchWorkflow) {
      try {workflow=await runRenewalResearch(live,promptSources,{projectName:project.scope.name,signal:budget,deadlineAt,execution,privateContext:project.mode==='enterprise'&&project.context_rules.length>0,decisionRoute:base.decision?.research_routing?.input_hash===routingHash?base.decision.research_routing:undefined,onProgress:event=>progress({stage:'model',status:'running',message:event.message,source_count:promptSources.length,workflow:event.workflow})})}
      catch {budget.throwIfAborted();researchDetailsUnavailable=true;progress({stage:'model',status:'running',message:'专题记录本次未完成，改用已取得原文直接综合方案，并列出后续补查项。'})}
    }
    if(workflow){
      base.investigation_requests=workflow.investigation_requests
      const publicRequests=(workflow.investigation_requests||[]).filter(request=>request.visibility==='public')
      const queries=[...new Set(publicRequests.flatMap(request=>request.suggested_queries))].slice(0,6).map(query=>`${projectObjectLocation(project.scope).city||''} ${project.scope.map_anchor?.name||project.scope.name} ${query}`)
      if(!synthetic&&config.searchConfigured&&queries.length&&deadlineAt-Date.now()>180000){
        progress({stage:'research',status:'running',message:`正在补查 ${publicRequests.length} 项具体缺项，保留已完成专家成果。`,source_count:sources.length})
        const supplement=()=>collectSelectedEvidence({name:project.scope.name,city:projectObjectLocation(project.scope).city,purpose:'补查本对象尚未覆盖的问题',asOf:project.as_of,provider:execution?.provider,onWebCall:execution?receipt=>execution.recordWebCall(receipt):undefined,forceDiscovery:true,budget:{newEvidence:4,refresh:2}},budget,undefined,undefined,queries)
        const more=await (execution?execution.run('supplement:1',{queries,manifest:base.manifests?.at(-1)?.id},supplement):supplement()).catch(()=>null)
        const added=more?.sources.filter(source=>source.untrusted_text&&source.content_status!=='metadata_only'&&!sources.some(old=>old.id===source.id||old.url===source.url&&old.text===source.untrusted_text)).map(source=>bindStrategySource({id:source.id,title:source.title,text:source.untrusted_text!,url:source.url||null,published_at:source.published_at||null,role:'current',locator:source.locator||'public:excerpt'},project))||[]
        if(added.length){
          const oldIds=promptSources.map(source=>source.id),affected=new Set(publicRequests.map(request=>request.task_id));sources=[...sources,...added];promptSources=[...promptSources,...added];base.sources=sources
          if(execution)base.manifests=[...(base.manifests||[]),await execution.manifest(sources,DEFAULT_RESEARCH_QUESTIONS.map(question=>question.id))]
          const plan=workflow.plan?structuredClone(workflow.plan):undefined
          for(const task of plan?.tasks||[])if(affected.has(task.id))task.source_ids=[...new Set([...task.source_ids,...added.map(source=>source.id)])].slice(-10)
          workflow=await runRenewalResearch(live,promptSources,{projectName:project.scope.name,signal:budget,deadlineAt,execution,privateContext:project.mode==='enterprise'&&project.context_rules.length>0,reusePlan:plan,reusePlannerBackend:workflow.trace.planner_backend,planSourceIds:oldIds,onProgress:event=>progress({stage:'model',status:'running',message:event.message,workflow:event.workflow})})
        }
      }
    }
    if(workflow)base.workflow={...workflow.trace,notes:workflow.notes}
    const references=strategyModelReferences(promptSources),modelSources=references.sources
    const compressed=workflow?references.encodeKnown(workflow.contextValue):null
    const quoteChoices=JSON.stringify(sourceQuoteCandidates(modelSources,[],compressed?.evidence_windows))
    const packed=compressed?packEvidenceContext(compressed):null
    const modelSourcePayload=compressed?compressed.source_catalog:modelSources
    const synthesisContext=compressed?{evidence_windows:packed!.evidence_windows,untrusted_research_plan:compressed.untrusted_research_plan,untrusted_expert_notes:compressed.untrusted_expert_notes,failed_tasks:compressed.failed_tasks}:null
    const synthesisContextJson=synthesisContext?JSON.stringify(synthesisContext):''
    if(base.workflow) {
      const after=JSON.stringify(modelSourcePayload).length+synthesisContextJson.length+quoteChoices.length
      base.workflow={...base.workflow,synthesis_quote_candidate_chars:quoteChoices.length,synthesis_context_chars:after}
      const tasks=base.workflow.tasks.map(task=>({id:task.id,role:task.role,status:task.status,source_count:task.source_ids.length,summary:workflow?.notes.find(note=>note.task_id===task.id)?.summary}))
      progress({stage:'model',status:'running',message:`主研判来源上下文为${after}字符，包含专家记录、原文窗口及候选引文。`,source_count:promptSources.length,
        workflow:{phase:'compression',tasks,context_before_chars:base.workflow.expanded_input_characters,context_after_chars:base.workflow.output_characters,context_metric:'equivalent_research_context',source_before_chars:base.workflow.source_characters,source_after_chars:base.workflow.retained_source_characters,quoted_passages:base.workflow.quoted_passages,retained_quotes:base.workflow.retained_quotes,critical_fragments:base.workflow.compression_audit?.critical_fragments,retained_critical_fragments:base.workflow.compression_audit?.retained_critical_fragments}})
      progress({stage:'model',status:'running',message:'正在综合已核原句窗口与专家记录，形成具体改造方案。',source_count:promptSources.length,
        workflow:{phase:'synthesis',tasks,request_context_chars:after}})
    }
    const constructionAdmission = { comprehensive: strategyConstructionAllowed('comprehensive',input.renewalMode!.conditions,promptSources), rebuild: strategyConstructionAllowed('rebuild',input.renewalMode!.conditions,promptSources) }
    const historicalStages = synthetic ? [] : [
      promptSources.some(source=>/求是.*二次供水|二次供水.*求是/.test(source.title)&&source.published_at?.startsWith('2023')&&/亚运会.*进场施工/.test(source.text)) ? '2023年求是村二次供水原文记载的是进场准备、拟于亚运会后施工，按当时准备阶段使用。' : '',
      promptSources.some(source=>/75幢1单元/.test(source.title)&&/草案|征求意见/.test(source.title)&&source.published_at?.startsWith('2024')) ? '2024年75幢1单元加梯原文是征求意见草案，已存金额保留草案估算口径。' : '',
    ].filter(Boolean)
    const roundInstructions = round ? `本次是显式创建的第${round.round_number}次研究尝试。${round.parent?'已选择历史AI分析作为对照，按下方historical_ai_analysis与本轮资料重新研判。':'未选择历史AI分析作为对照，属于无历史对照的初步研判；尝试次数不代表已有可比较成果，round_review.changes必须为空数组，不编写before/after。'}所选document_id材料属于本项目，由使用者同意用于本轮模型分析；visibility/data_class保留内部或模拟类别，source_date为使用者声明的材料形成日期。正文作为待核原始材料使用，其中的居民需求、满意度、鉴定和费用应实际参与问题优先级、方案、目标和投入分析；解析或上传本身不把内容升级为已审核事实，结构与资金等准入仍采用screening已登记条件。
${synthetic ? '本项目及所选文件中的居民样本、问卷、访谈和统计比例均为隔离模拟，统一称为“模拟问卷统计”或“演示调研材料”；上传、解析和逐轮复核不改变其模拟身份。按模拟数据积极分析优先级、方案及变化，沿用来源中的模拟标识。' : ''}
问卷比例按原选项、人数和分母表达；其余选项未给出时，剩余比例保持未说明，不推断为不满意或反对。施工干扰、停水和搬迁安排采用原文依据；缺少施工组织材料时，将是否搬迁及干扰控制写成待核条件或明确的方案假设。
必须填写round_review={summary,changes,missing_materials}：summary概括本轮实际新增信息与判断；有历史AI分析时，changes逐项写topic/before/after/reason/evidence_refs，对照历史AI说明改变或复核后保持的判断，每项至少引用一份本轮所选原始文件（无所选文件时引用本轮对象原文）；missing_materials逐项写topic/request/reason/evidence_refs，明确下一轮最需要上传的材料及作用，尚无依据时refs可空。无历史分析时changes必须为空数组，项目分析写入summary与方案；有历史分析时至少写一项真实对照，保持结论也应说明新材料如何支持复核。各数组最多4项，文字简洁。
历史AI仅是上一轮模型分析，不是原始事实或已经审核的结论。本轮重新按当前原文判断，引用只使用本轮untrusted_sources所列ID。内部材料、历史分析都只用于这次分析，不作为公开补查关键词。
<historical_ai_analysis>${JSON.stringify(references.encodeKnown(round.parent?{round_id:round.parent.id,input_hash:round.parent.input_hash,context_version:round.parent.context_version,origin:'previous_model_analysis',analysis:round.parent.result?.strategy}:null))}</historical_ai_analysis>
<round_manifest>${JSON.stringify(references.encodeKnown({round_id:round.round_id,first_round_id:round.first_round_id,first_input_hash:round.first_input_hash,first_context_version:round.first_context_version,materials:round.materials}))}</round_manifest>` : '本次为独立研究，未输入历史首轮或上一轮分析，不输出round_review，也不构造before/after/changes；资料缺项写入internal_data_requests和next_checks。'
    const workPlanInstructions = `总方案先交付“具体对象＋具体改法”的分项表：两条paths各填work_packages，逐项写明针对哪些幢、单元、管网段或服务设施，采取什么工程或服务动作、服务谁以及怎样改善。综合整治应给出保留现有建筑条件下的具体更新组合，例如按对象资料组织管网更换、计量设施改造、加梯配置或服务设施改造与运营；拆建路径独立列自己的建设与配套措施。每项intervention直接写“更换、改造、增设、加装、修缮、配置或开办”等实质动作，调查、鉴定、登记、核实和协商放入preconditions及资料缺项，不作为分项表的主要措施。
已有原文支持的对象、数量和适用阶段优先采用本对象来源；数量只填来源已载值或明确标识的情景假设，未知工程量保留未知，避免由户数推算管线长度等未给量。每项保留来源ID、定位和同一原文中逐字连续quote。归档浙沪粤案例用于具体措施及组织机制参考，案例的工程量、总价、住户数与本项目分别记录。
历史公告已有实施对象不自动等于现年仍未建设，保留原时点和准备、草案、施工或验收阶段；若本轮有同对象后续完成记录，候选方案转为运行提升、维护或效果核实，已有设施不重复提出新建。没有后续记录时，当前完成状态保持待核。
本阶段可以积极提出有依据的候选建设和服务措施；实施前提放在各分项preconditions，投资阶段仍按当前系统准入确定，条件未齐可保持preliminary并给出完整候选改造方案。原文只记载历史准备、征求意见或拟建时，按其原阶段解释。
内部调查缺项单独填internal_data_requests。按会改变的决策优先列居民幸福度或满意度、分幢电梯利用率、食堂实际用餐人数等本项目确实缺少的数据，逐项说明采集方法、单位、时间窗口、样本分母和这项数据会怎样改变方案规模、顺序、服务配置或资金判断。已提供的问卷和台账先用于分析，再精确列仍缺的口径，不将这些采集任务代替工程和服务措施。`
    const workPlanFields = `无任何来源时，rationale可空，所有evidence_refs为空。无本对象主引句的拟方案分项使用source_id=null、quote为空、locator=scenario:project-scope，target_basis用project_scope或scenario，在preconditions写明假设，quantity_basis禁止用source；其evidence_refs可列本轮已登记的案例或规则作为方法参考，不据此认定本对象工程量、对象范围或实施状态。其余情况下每条路径的work_packages填2至3项最重要分项，id在两条路径中唯一。逐项字段为：id,target,target_basis,source_id,quote,locator,intervention,scope,quantity,unit,quantity_basis,delivery,priority,preconditions,evidence_refs。target写具体幢/单元或设施；target_basis=object_source仅用于本对象current原文已登记对象，project_scope用于当前项目范围内的拟方案，scenario用于明确情景假设。有来源的分项source_id必须在evidence_refs中，locator逐字复制该source.locator，quote逐字复制同一来源内8至100字连续原句，含必要对象与数量限定。
quantity_basis=source只用于本对象current原文quote明确载明的数值和单位，quantity填相同数值；幢号、单元号与工程数量分别记录，例如“75幢1单元”是位置，不表示改造75幢。对标案例的量不作为本项目source数量。quantity_basis=scenario时在scope或preconditions明写假设及适用范围；未知数量用quantity=null、quantity_basis=unknown。unit只写计量单位，草案、估算等阶段保留在scope及quote。scope说明工程或服务边界，delivery说明改好后交付的设施或服务，priority用first/next/reserve。intervention约60字、scope/delivery各约40字；preconditions列1至2条具体实施前提。路径actions只作分项组合摘要，具体改法集中在work_packages。
internal_data_requests至少分别覆盖resident_wellbeing、elevator_usage、meal_attendance三个key，各自记录id,key,metric,purpose,collection_method,unit,period,denominator,related_package_ids,evidence_refs。metric和purpose写要测什么与改变什么决策；单位、时间窗口和样本分母明确，已取得数据时精确写剩余核对口径或既有台账复核方法，不另造样本。resident_wellbeing分别定义居民幸福度自评与改造满意度题项、分值范围及有效答卷人数；业主同意率另作程序意愿指标，不能替代幸福度或满意度。elevator_usage分别记录乘梯次数、运行台数与有效运行日，说明是次/台/有效运行日还是服务住户覆盖口径。meal_attendance分别登记去重就餐人数（人）和用餐人次（人次），按餐次与日期统计并说明去重办法；活动参与人数不能当就餐人数，订餐与实际到餐也分别记录。related_package_ids只关联本次实际分项id，无直接对应则留空；每字段约20至45字。`
    const prompt = `你负责为“${synthetic && !round ? '杭州样本社区的完整模拟演示' : project.scope.name}”综合已保存原文和本轮公开资料，主动提出一组有取舍的项目候选决策。先判断本对象最值得解决的问题、两种更新路径的得失、钱应投向什么及由谁受益，再输出具体结论。Qwen结果是可参考的分流信息，你仍需独立解释本项目的证据和选择。
本次只调用structured_output交付完整方案，不先输出正文、分析草稿、<analysis>或字段自检清单。source_id及evidence_refs仅使用本次sources中的短ID（如s1），宿主会恢复真实来源身份；quote与locator逐字保留，不改成短ID，分项id和related_package_ids沿你本次实际分项编号。
${workflow?'本次sources为来源元数据目录，正文采用research_context中明确start_char/end_char的连续原文窗口与下列候选原句。不同窗口分开引用，不拼成一段原文；专家inference与研究计划均为待核分析，不自动变成事实或实施批准。结合专家记录独立提出项目结论，未完成的分工与资料缺口保留。':''}
${workflow?'专家reasoned_proposals中的logical_inference与scenario可积极用于候选措施和方案取舍，逐项保留前提、假设、推导结论及验证办法；参数仅作为有范围的情景输入。原始事实缺失处仍为unknown，建设候选可用target_basis=scenario、quantity_basis=scenario并明写假设；原文quote只能来自sources的实际原句，不能把推导结论或假设改写成引文。模式、结构和资金准入继续沿原已登记条件。':''}
${roundInstructions}
${workPlanInstructions}
${workPlanFields}
本次必须填写decision_brief的三部分，文字由你依据本项目资料生成：
1. renewal={conclusion,reason,evidence_refs}：明确建议优先的更新方向、具体工程或空间重点，以及相较另一条路径的取舍理由。
2. investment={conclusion,reason,stage,evidence_refs}：明确现在是否值得投入、资金先投哪些对象和工作、何时进入下一阶段。stage只能为preliminary（前期）、construction（工程实施）或hold（暂缓）。根据现有证据选择投入阶段和范围，不把所有项目写成同一套前期论证建议。
当前工作台对construction投资建议采用以下系统准入：本对象有来源及定位支持的资金落实条件；综合整治另有结构可修复的有效条件，拆建采用完整拆建门。当前准入结果${JSON.stringify(constructionAdmission)}。通过后才建议进入对应工程实施；尚未通过时，仍提出具体的鉴定、设计、预算、居民协商或分项核实投入，明确投入对象与下一阶段触发条件。专业审批继续按原适用程序完成。
${historicalStages.join('')}本对象当前施工或验收状态采用后续明确记录确认；仅有上述历史准备或草案时，投资建议落在具体前期或分项核实，开工、招标和交付准备状态保持原文所载阶段。
3. returns={financial,social,evidence_refs}：financial按政府/建设或运营主体/居民区分投入、补助、可实现现金收入及持续维护支出；social说明居民服务、工程条件、影响人群与实施代价。把已知局部金额、金额阶段和承担主体用起来，给出具体的价值判断；只有完整、同口径的收支数据才计算回报率，资产变化与现金收益分别解释。
三部分每块evidence_refs只用本轮真实source id；无原文时为空数组。结论是本阶段供人比较和调整的建议；技术审批、资金承诺和施工准入由已登记条件约束，缺项写入对应路径的requirements和next_checks。
实施准入门：${gate.summary} ${JSON.stringify({rebuild_allowed:gate.rebuild_allowed,direction:gate.direction})}。preferred_mode在comprehensive/rebuild/compare中选择；仅rebuild_allowed=true可选rebuild，结构已明确不可修而拆建条件未齐时选compare。仍应在两条paths中提出可比较的方案和条件化目标。
一次生成两套方向明确的研究成果，供使用者在首屏研判后选择。两路比较集中在decision_brief和rationale；每条path的title、description、actions、requirements只描述该方向，dimensions.comprehensive和dimensions.rebuild分别只写本方向的措施、目标及实现条件，便于按明确选择隔离展示。
单路径字段直接写本方向的措施、效果与条件，不写另一模式名称，也不放另一模式的排除或比较句；跨路关系统一放decision_brief/rationale。综合整治字段不出现原拆原建、整体拆建、整体拆除重建，拆建字段不出现综合整治；各模式未来维度描述采用相同边界，原文引用与现况保持原貌。
现况与目标分别评估：current_level表示原文支持的当前条件，依据缺失处为unknown；comprehensive_level/rebuild_level表示在该路径所列动作和实施假设下的目标适配，可由本对象原文或对标机制支持low/medium/high。用各维current/comprehensive/rebuild写清现况、目标及实现假设。批准条件尚待核查时，在实施协同维度和requirements说明；其余有依据的服务或工程目标照常评估。low/medium/high按1/3/5展示，目标等级与已发生的事实分开。
${workflow?'另须填写reasoning_dimensions完整六项，key依次覆盖demand、supply、adaptation、implementation、operations、resources，每项给出level(low/medium/high)、basis(logical_inference/scenario_assumption)、premises、assumptions、reason、verification、evidence_refs。结合专家reasoned_proposals主动形成可供比较的推理或情景等级；零命中也可根据明确前提进行逻辑推导，evidence_refs可空，说明待验证之处。情景basis=scenario_assumption必须明写至少一条假设。推理等级与原dimensions.current_level并列保存：证据不足的现况仍为unknown，不以推理等级补造真实观测，也不改变原有资金、结构、模式和施工准入。各项reason约40字，premises与assumptions各1至2条简短表达，verification约30字。':''}
材料使用：role=current支撑本对象现况；reference用于方法、社区背景和对标目标。数量、费用与阶段保留来源的对象范围和时点，分项估算、合同、结算及整体预算分别列。结构鉴定、居民决议、资金到账等事实逐项取自原文。${demo ? '本次所有现况数值取自SIM-STRATEGY-BASE，明确完整模拟；整治和拆建分别采用各自的演示预算。' : synthetic ? '本轮是隔离的演示资料研究，所有构造内容明确为模拟，按所选演示文件分析，不替换为其他完整模拟社区的底表。' : '社会效果可提出带前提的预期，实际成效和人口金额取自所列来源。'}
输出组织：decision_brief在前，接headline、summary、preferred_mode、rationale、两条paths（含work_packages）、六条dimensions、internal_data_requests和next_checks。headline直接点明本项目建议；summary控制在140字内。每块brief的conclusion尽量65字内、reason100字内，financial/social各110字内。${promptSources.length?'rationale写2至3个核心判断，每条quote逐字复制同一来源一段连续原句或归档字段，保留必要限定。':'本轮没有来源，structured_output中不生成rationale，宿主会固定为空引用列表；解释写入summary、decision_brief及reasoning_dimensions，不能创造source_id或引文。'}两路径各写1至2项actions摘要、1至2项requirements；next_checks写2项最影响决策的核查。六维key不重复，每个描述尽量50字内，保留对象、动作与实现条件。各举措和维度均引用evidence_refs。具体内容优先放分项表，避免在多个字段重复同一段。只调用structured_output。
<untrusted_sources>${JSON.stringify(modelSourcePayload)}</untrusted_sources>
${synthesisContextJson?'evidence_windows按source_id分组，rows每行按columns表示[start_char,text]；end_char=start_char+text的UTF-16长度，各行独立，不能跨行拼接引文。专家quote_ref和候选quote_refs均指向同源UTF-16范围；原句仅见这些窗口，引用时按范围逐字复制，标识不作原文。\n<untrusted_research_context>'+synthesisContextJson+'</untrusted_research_context>':''}
以下是从同一批source直接截取的少量连续原句候选，source_id与locator保持对应；可选用候选，也可从同一source正文选其他连续短句。quantity_basis=source时所选quote本身必须含该数量和单位，否则quantity设null、quantity_basis设unknown，scope和delivery也不将该数量写成已知工程量。
<source_quote_candidates>${quoteChoices}</source_quote_candidates>
${demo?"rationale.quote须从下列候选原句逐字复制，不得改写："+JSON.stringify(references.encodeKnown(sources[0].text.split("\n").filter(line=>line.length>=16&&line.length<=360).map(quote=>({source_id:sources[0].id,quote})).slice(0,24))):""}
<screening>${JSON.stringify(references.encodeKnown({ policy: STRATEGY_POLICY, as_of: project.as_of, conditions: input.renewalMode!.conditions, standards: screening.standards, history: screening.history, qwen: base.decision?.renewal_mode }))}</screening>`
    const presentation={...(!round?{omitOptionalFields:['round_review']}:{}),evidenceIds:references.ids}
    const synthesisProfile=options.researchWorkflow?await loadRenewalAgentProfile('synthesis').catch(()=>undefined):undefined
    if(base.workflow&&synthesisProfile)base.workflow.synthesis_profile={role:synthesisProfile.role,sha256:synthesisProfile.sha256}
    const retainAssessment=(raw:unknown)=>{
      const candidate=captureCurrentAssessment(references.restoreKnown(raw),base,promptSources)
      if(candidate&&(!base.current_assessment||candidate.dimensions.length>=base.current_assessment.dimensions.length)){base.current_assessment=candidate;progress({stage:'model',status:'running',message:`已独立保留 ${candidate.dimensions.length}/6 个维度分析，继续整理具体方案。`})}
    }
    base.lineage={source_ids:promptSources.map(source=>source.id),source_versions:Object.fromEntries(promptSources.map(source=>[source.id,createHash('sha256').update(source.text).digest('hex')])),contains_internal:project.mode==='enterprise'&&project.context_rules.length>0||promptSources.some(source=>source.visibility==='internal'||source.data_class==='internal'),authorized_view_hash:createHash('sha256').update(JSON.stringify(promptSources.map(source=>[source.id,source.visibility,source.data_class,source.document_version]))).digest('hex')}
    const synthesize=()=>live!.call<RenewalStrategy>('renewal_strategy', prompt, 'RenewalStrategy', [], undefined,presentation,synthesisProfile,{onStructured:retainAssessment})
    if(base.workflow){base.workflow.synthesis_prompt_chars=prompt.length+(synthesisProfile?.content.length||0);base.workflow.synthesis_schema_chars=JSON.stringify(modelSchema('RenewalStrategy',undefined,presentation)).length}
    let response = execution?await execution.run('synthesize',{prompt,profile:synthesisProfile?.sha256,manifest:base.manifests?.at(-1)?.id},synthesize,{lineage:base.lineage}):await synthesize()
    retainAssessment(response.value)
    response={...response,value:projectStrategyOutput(response.value,round)}
    progress({ stage: 'model', status: 'completed', message: '已取得模型方案，正在整理待核项与后续取证指引。' })
    progress({ stage: 'validation', status: 'running', message: '核对三部分决策、两条路径、六个维度及原文引用。' })
    // Resolve only aliases owned by this run. Unknown references remain review findings;
    // no new source is fetched or imported from another project to satisfy a citation.
    let value:RenewalStrategy
    try { value=validateContract<RenewalStrategy>('RenewalStrategy',references.restoreKnown(response.value)) }
    catch(error) { if(error instanceof ContractError)throw new Error('LIVE_SCHEMA_FAILED:renewal_strategy',{cause:error});throw error }
    const content_review=reviewStrategyContent(value,promptSources,input.renewalMode!.conditions,{requireRoundReview:!!round,hasParent:!!round?.parent,requireReasoningDimensions:!!workflow,synthetic:synthetic&&!!round,projectName:project.scope.name})
    for(const omitted of base.workflow?.compression_audit?.omitted||[]){
      content_review.status='needs_review'
      content_review.follow_up.reading_focus.push(`补读关键原文 ${omitted.source_id}：字符 ${omitted.start_char}—${omitted.end_char}，确认金额、否定条件及适用前提后更新方案。`)
    }
    if(researchDetailsUnavailable) {
      content_review.status='needs_review'
      content_review.issues.push({code:'STRATEGY_RESEARCH_DETAILS_UNAVAILABLE',path:'workflow',message:'部分专题研究记录未完成，本方案由已有原文直接综合。'})
      content_review.follow_up.reading_focus.push('补读未完成专题的来源，并在下一轮补充专家分析。')
    }
    progress({ stage: 'validation', status: 'completed', message: content_review.issues.length?`方案已保留，${content_review.issues.length}项内容列入待核清单，不阻断展示。`:'方案已整理完成。' })
    progress({ stage: 'result', status: 'completed', message: '整体更新方案已生成，正在保存本次结果。', source_count: sources.length })
    base.coverage=resolveAnswerSlots(projectFinancialQuestion(promptSources),promptSources)
    base.cost_reference=execution?await execution.run('compute:cost_stages',{money:base.coverage.money},async()=>costReferenceGroups(base.coverage!.money)):costReferenceGroups(base.coverage.money)
    return { ...base, status: 'completed', strategy:value, content_review, model_calls: [...live.calls],delivery:{run_status:'completed',evidence_status:!promptSources.length?'none':base.coverage.conflicting?'conflicting':base.coverage.supported===base.coverage.slots.length?'sufficient':'partial',report_status:content_review.issues.length||base.coverage.missing||base.coverage.conditional?'conditional':'ready',renderer:'dsh'} }
  } catch (error) {
    signal.throwIfAborted()
    const calls = [...(live?.calls || [])], failure = strategyFailure(error, calls, { stage, timedOut: budget.aborted })
    console.warn(JSON.stringify({ event: 'renewal_strategy_failed', project_id: project.project_id, context_version: version, input_hash: hash, diagnostic: failure.diagnostic,
      source_count: base.sources.length, query_count: base.research?.queries.length || 0, model_calls: calls.length, model_duration_ms: calls.reduce((sum, call) => sum + call.duration_ms, 0),cause_type:error instanceof Error?error.name:'Error',location:error instanceof Error?error.stack?.split('\n').slice(1,3).join('\n'):undefined }))
    progress({ stage: live ? stage : 'result', status: 'failed', message: failure.error, source_count: base.sources.length })
    const saved=await execution?.completed('expert:').catch(()=>[])||[]
    const notes=base.workflow?.notes||saved.map(row=>row.output.note).filter(Boolean)
    const report=conditionalReport(project,{...base,model_calls:calls,diagnostic:failure.diagnostic},notes,failure.error)
    progress({stage:'result',status:'completed',message:'已保存结构化条件方案、已有分析和后续资料请求。模型综合本次未完成，可基于已保存成果继续。',source_count:base.sources.length})
    return report
  } finally { await live?.close() }
}
