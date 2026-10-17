import type { ModelCall, RenewalStrategy, DecisionSupport, ResearchTrace, RenewalResearchPlan, RenewalResearchNote } from '../../apps/host/generated/contracts'
import { evaluateRenewalModeGate, type ModeCondition } from './renewal-mode'

export const STRATEGY_POLICY = 'renewal-strategy-overview-v8-advisory'
export type StrategySource = { id: string; title: string; text: string; url: string | null; published_at: string | null; role: 'current' | 'reference'; locator: string;
  visibility?: 'public' | 'internal'; data_class?: 'public' | 'internal' | 'synthetic' | 'semi_synthetic'; document_id?: string; document_version?: string; project_id?: string;
  material_category?: import('./research-rounds').ResearchMaterialCategory; source_date?: string | null;
  object_binding?:import('./object-binding').ObjectBinding }
export type StrategyPublication = { kind: 'current' | 'saved_snapshot'; is_current: boolean; current_input_hash: string; saved_at: string }
export type PublicStrategyIndexItem = { project_id: string; project_name: string; context_version: number; strategy_context_version: number; created_at: string; headline: string; status: 'completed'; synthetic: false; is_current: boolean; input_hash: string }
export type PublicStrategyIndexResponse = { items: PublicStrategyIndexItem[] }
export type StrategyReview = { kind: 'source_and_metric_review'; reviewed_at: string; original_packet_sha256: string;
  changes: { path: string; before: unknown; after: unknown; reason: string }[] }
export type StrategyDemoReplay = { kind: 'validated_model_replay'; source_project_id: string; source_round_id: string;
  source_packet_sha256: string; source_structured_sha256: string; model_generated_at: string; validated_at: string;
  transformation: 'clear_nonexistent_parent_comparison'; validation_policy: string }
export type StrategyContentIssue = { code: string; path: string; message: string }
export type StrategyContentReview = { policy: 'advisory-v1'; status: 'clear' | 'needs_review'; checked_at: string; issues: StrategyContentIssue[]; follow_up: { search_queries:string[]; reading_focus:string[]; internal_data:string[] };
  recovered_from?: { round_id: string; session_id: string; candidate_sha256: string } }
export type StrategyPacket = { project_id: string; context_version: number; input_hash: string; created_at: string; synthetic: boolean; status: 'completed' | 'failed' | 'unavailable';current_assessment?:import('./strategy-assessment').CurrentAssessment;
  context_ref?:import('./project-context').ProjectContextRef; current_context?:{policy:'project-context-v1';generation:number;attempt_id:string|null;round_id:string|null;freshness:'current'|'legacy_snapshot'|'historical';object_review_required:boolean};
  strategy: RenewalStrategy | null; sources: StrategySource[]; decision: DecisionSupport | null; model_calls: ModelCall[]; research: ResearchTrace | null; error: string | null; diagnostic?: StrategyDiagnostic; publication?: StrategyPublication; review?: StrategyReview; content_review?: StrategyContentReview; workflow?:StrategyWorkflowTrace; demo_replay?:StrategyDemoReplay }

export type StrategyWorkflowProgress = { phase:'planning'|'specialists'|'compression'|'synthesis';
  tasks?:{id:string;role:RenewalResearchPlan['tasks'][number]['role'];status:'pending'|'running'|'completed'|'failed';source_count:number;summary?:string}[];
  context_before_chars?:number;context_after_chars?:number }
export type StrategyWorkflowTrace = {
  planner_status:'completed'|'failed'|'not_applicable';planner_error?:string;plan:RenewalResearchPlan|null;
  planner_profile?:{role:string;sha256:string};
  planner_backend?:'decision'|'dsh';decision_routing?:import('../../apps/host/generated/contracts').DecisionResearchRouting;
  tasks:{id:string;role:RenewalResearchPlan['tasks'][number]['role'];source_ids:string[];status:'completed'|'failed';error_code?:string;profile?:{role:string;sha256:string};
    retrieval?:{calls:number;query_matches:number;read_windows:{source_id:string;start_char:number;end_char:number;characters:number;query?:string|null;matched:boolean}[]};
    reasoning?:'direct_evidence'|'mixed'|'reasoned_fallback'|'not_produced';attempts?:number;effort?:{maxOutputTokens:number;timeoutMs:number;sourceCharacters:number;synthesisReserveMs:number}}[];
  input_characters:number;source_characters:number;retained_source_characters:number;output_characters:number;
  compression:'reduced'|'retained';method:'evidence_windows_and_untrusted_notes';notes?:RenewalResearchNote[];
  synthesis_quote_candidate_chars?:number;synthesis_context_chars?:number;synthesis_profile?:{role:string;sha256:string}
  quoted_passages?:number;retained_quotes?:number;expanded_input_characters?:number;compression_ratio?:number
}

export type StrategyDiagnostic = { code: 'MODEL_NOT_CONFIGURED' | 'MODEL_PROVIDER_FAILED' | 'MODEL_OUTPUT_INVALID' | 'MODEL_OUTPUT_TRUNCATED' | 'MODEL_STRUCTURED_OUTPUT_MISSING' | 'MODEL_SCHEMA_INVALID' | 'MODEL_REQUEST_BUDGET_EXHAUSTED' | 'MODEL_RATE_LIMITED' | 'MODEL_AUTH_FAILED' | 'MODEL_TIMEOUT' | 'RESEARCH_FAILED' | 'RESEARCH_PREFLIGHT_FAILED' | 'RESEARCH_COMPRESSION_INVALID' | 'STRATEGY_EVIDENCE_INVALID' | 'STRATEGY_FAILED';
  stage?: string; stop_reason?: string; provider_code?: string }
export type StrategyProgress = { type: 'progress'; stage: 'sources' | 'research' | 'model' | 'validation' | 'result';
  status: 'running' | 'completed' | 'skipped' | 'failed'; message: string; source_count?: number; query_count?: number; round?: number; round_count?: number;workflow?:StrategyWorkflowProgress }
export type StrategyStreamEvent = StrategyProgress | { type: 'complete'; result: StrategyPacket } | { type: 'error'; message: string }

const providerCodes = new Set(['TRANSPORT', 'SERVER', 'TIMEOUT', 'AUTH', 'INVALID_CREDENTIAL', 'RATE_LIMIT', 'MALFORMED_RESPONSE', 'EMPTY_RESPONSE', 'BAD_REQUEST', 'NO_ADAPTER', 'MODEL_ERROR'])
const diagnosticMessages: Record<StrategyDiagnostic['code'], string> = {
  MODEL_NOT_CONFIGURED: '尚未配置模型服务，暂不能生成整体更新方案。',
  MODEL_PROVIDER_FAILED: '模型服务未完成本轮请求，整体更新方案生成失败。',
  MODEL_OUTPUT_INVALID: '模型返回内容未通过方案格式校验，本轮未发布方案。',
  MODEL_OUTPUT_TRUNCATED: '模型输出达到本轮长度上限，尚未交付完整的结构化方案。已取得资料保留。',
  MODEL_STRUCTURED_OUTPUT_MISSING: '模型未提交约定的结构化方案，本轮未发布方案。已取得资料保留。',
  MODEL_SCHEMA_INVALID: '模型已提交结构化结果，但字段未通过方案契约校验，本轮未发布方案。',
  MODEL_REQUEST_BUDGET_EXHAUSTED: '本轮模型调用已达到研究预算上限，尚未形成完整方案。已取得资料和专家分析保留。',
  MODEL_RATE_LIMITED: '模型服务限制了请求频率，本轮方案生成未完成。',
  MODEL_AUTH_FAILED: '模型服务未通过身份验证，本轮方案生成未完成。',
  MODEL_TIMEOUT: '本轮方案研究超时，尚未生成完整方案。',
  RESEARCH_FAILED: '公开资料检索未完成，本轮整体更新方案尚未生成。',
  RESEARCH_PREFLIGHT_FAILED: '运行准备检查未通过，尚未进入专家调研。请核对模型连接、角色文件与输出格式。',
  RESEARCH_COMPRESSION_INVALID: '上下文压缩未保留全部引用原句，已停止进入最终综合，原资料和专家记录保留。',
  STRATEGY_EVIDENCE_INVALID: '方案引用或适用条件未通过核验，本轮未发布方案。',
  STRATEGY_FAILED: '本轮方案生成未完成，暂未形成可展示的整体更新方案。',
}
const providerMessages: Record<string, string> = {
  TRANSPORT: '服务器暂时无法连接模型服务，本轮未生成整体更新方案。可继续查阅已取得资料，稍后重试。',
  BAD_REQUEST: '模型服务未接受本轮请求，整体更新方案生成失败。',
  NO_ADAPTER: '当前模型服务配置不可用，整体更新方案尚未生成。',
}
/** Only fixed codes cross the runtime boundary; provider messages and URLs never enter the product error. */
export function strategyFailure(error: unknown, calls: readonly ModelCall[], options: { stage?: StrategyProgress['stage']; timedOut?: boolean } = {}): { error: string; diagnostic: StrategyDiagnostic } {
  const message = error instanceof Error ? error.message : ''
  const parsed = /^LIVE_STAGE_FAILED:(renewal_strategy(?:_(?:quote_repair|format_retry|contract_retry))*):(completed|stop|error|aborted|max-tokens|failed)(?::([A-Z_]+))?/.exec(message)
  const call = parsed ? calls.filter(call => call.stage === parsed[1]).at(-1) : undefined
  const explicitBudget=parsed?.[3]&&/^RUN_MODEL_(?:STAGE_)?BUDGET_EXCEEDED$/.test(parsed[3])?parsed[3]:undefined
  const rawCode = explicitBudget || call?.error_code || parsed?.[3]
  const provider = rawCode && providerCodes.has(rawCode) ? rawCode : undefined
  let code: StrategyDiagnostic['code'] = 'STRATEGY_FAILED'
  if (message === 'RENEWAL_RESEARCH_PREFLIGHT_FAILED') code = 'RESEARCH_PREFLIGHT_FAILED'
  else if (message === 'RENEWAL_RESEARCH_COMPRESSION_EVIDENCE_LOSS') code = 'RESEARCH_COMPRESSION_INVALID'
  else if (message === 'MODEL_NOT_CONFIGURED') code = 'MODEL_NOT_CONFIGURED'
  else if (options.timedOut || provider === 'TIMEOUT') code = 'MODEL_TIMEOUT'
  else if (provider === 'AUTH' || provider === 'INVALID_CREDENTIAL') code = 'MODEL_AUTH_FAILED'
  else if (provider === 'RATE_LIMIT') code = 'MODEL_RATE_LIMITED'
  else if (/^RUN_MODEL_(?:STAGE_)?BUDGET_EXCEEDED$/.test(rawCode||message)) code = 'MODEL_REQUEST_BUDGET_EXHAUSTED'
  else if (parsed?.[2] === 'max-tokens') code = 'MODEL_OUTPUT_TRUNCATED'
  else if (rawCode === 'NO_STRUCTURED_OUTPUT') code = 'MODEL_STRUCTURED_OUTPUT_MISSING'
  else if (/^LIVE_SCHEMA_FAILED:/.test(message) || error instanceof Error && error.name === 'ContractError') code = 'MODEL_SCHEMA_INVALID'
  else if (provider === 'MALFORMED_RESPONSE' || provider === 'EMPTY_RESPONSE' || /^STRATEGY_(INCOMPLETE|DECISION_BRIEF_REQUIRED|BRIEF_INCOMPLETE|PATH_DIRECTION_MIXED|ROUND_REVIEW_REQUIRED|ROUND_REVIEW_INCOMPLETE|ROUND_COMPARISON_MISSING|WORK_PACKAGES_REQUIRED|WORK_PACKAGE_INCOMPLETE|WORK_PACKAGE_TASK_ONLY|INTERNAL_DATA_REQUESTS_REQUIRED|INTERNAL_DATA_REQUEST_INCOMPLETE|REASONING_DIMENSIONS_REQUIRED|REASONING_DIMENSIONS_INCOMPLETE|REASONING_ASSUMPTIONS_REQUIRED)$/.test(message)) code = 'MODEL_OUTPUT_INVALID'
  else if (/^STRATEGY_(QUOTE_MISMATCH|SOURCE_MISMATCH|OBJECT_EVIDENCE_MISSING|MODE_RESTRICTED|REBUILD_GATE_UNMET|BRIEF_EVIDENCE_MISSING|CONSTRUCTION_GATE_UNMET|ROUND_CHANGE_EVIDENCE_MISSING|WORK_PACKAGE_QUOTE_MISMATCH|WORK_PACKAGE_LOCATOR_MISMATCH|WORK_PACKAGE_TARGET_SCOPE|WORK_PACKAGE_QUANTITY_MISMATCH|WORK_PACKAGE_SCENARIO_REQUIRED|INTERNAL_DATA_PACKAGE_MISMATCH|SYNTHETIC_IDENTITY_MISMATCH|RELOCATION_ASSUMPTION_REQUIRED)$/.test(message)) code = 'STRATEGY_EVIDENCE_INVALID'
  else if (provider) code = 'MODEL_PROVIDER_FAILED'
  else if (options.stage === 'research') code = 'RESEARCH_FAILED'
  const diagnostic: StrategyDiagnostic = { code, ...(parsed ? { stage: parsed[1], stop_reason: parsed[2] } : {}), ...(provider ? { provider_code: provider } : {}) }
  const text = code === 'MODEL_PROVIDER_FAILED' && provider && Object.hasOwn(providerMessages, provider) ? providerMessages[provider] : diagnosticMessages[code]
  return { error: text, diagnostic }
}

/** Old cached failures have no diagnostic field; recover only known categories from their call records. */
export function strategyFailureMessage(packet: { diagnostic?: StrategyDiagnostic; error?: string | null; model_calls?: readonly ModelCall[]; status?: string }): string {
  const lastCall=packet.model_calls?.filter(call=>call.stage.startsWith('renewal_strategy')).at(-1)
  if(packet.diagnostic?.stop_reason==='max-tokens'||lastCall?.finish_reason==='max-tokens')return diagnosticMessages.MODEL_OUTPUT_TRUNCATED
  if (packet.diagnostic && Object.hasOwn(diagnosticMessages, packet.diagnostic.code)) {
    const provider = packet.diagnostic.provider_code
    return packet.diagnostic.code === 'MODEL_PROVIDER_FAILED' && provider && Object.hasOwn(providerMessages, provider) ? providerMessages[provider] : diagnosticMessages[packet.diagnostic.code]
  }
  if (packet.status === 'unavailable' || packet.error === '请先配置 DeepSeek 模型接口。') return diagnosticMessages.MODEL_NOT_CONFIGURED
  return strategyFailure(new Error(packet.error || ''), packet.model_calls || []).error
}

export function strategyStageLabel(stage: string): string {
  if (stage.startsWith('renewal_strategy')) return '方案生成'
  if (stage === 'renewal_public_research') return '资料检索'
  if (stage === 'renewal_research_route') return '模式判定'
  return '模型调用'
}
export function strategyCallStatus(reason: string): string {
  return ({ error: '失败', aborted: '已取消', stop: '完成', 'tool-calls': '工具调用', 'max-tokens': '达到输出长度上限' } as Record<string, string>)[reason] || '未记录结束状态'
}

export const STRATEGY_PROMPT_SOURCE_CHARS = 36000
/** Keep all acquired sources in the packet; only contiguous, relevant excerpts enter the model prompt. */
export function strategyPromptSources(sources: readonly StrategySource[], workReferenceIds: readonly string[] = []): StrategySource[] {
  const terms = /结构|鉴定|权属|规划|居民|安置|资金|投资|成本|造价|维护|维修|运营|拆|修缮|供水|电梯/
  const workRefs=new Set(workReferenceIds.slice(0,4))
  const ordered = sources.map((source, index) => ({ source, index })).sort((a, b) => Number(!!b.source.document_id) - Number(!!a.source.document_id) || Number(workRefs.has(b.source.id)) - Number(workRefs.has(a.source.id)) || Number(b.source.role === 'current') - Number(a.source.role === 'current') || Number(terms.test(b.source.text)) - Number(terms.test(a.source.text)) || a.index - b.index)
  const selected: StrategySource[] = []; let remaining = STRATEGY_PROMPT_SOURCE_CHARS
  const documentLimit = Math.min(5000, Math.floor(18000 / Math.max(1, sources.filter(row=>row.document_id).length)))
  for (const { source } of ordered) {
    if (remaining < 300) break
    const match = source.text.search(terms), start = source.role === 'current' || match < 0 ? 0 : Math.max(0, match - 400)
    const text = source.text.slice(start, start + Math.min(remaining, source.document_id ? documentLimit : workRefs.has(source.id) ? 2000 : source.role === 'current' ? 5000 : 3000))
    if (!text.trim()) continue
    selected.push({ ...source, text }); remaining -= text.length
  }
  return selected
}

const literal = (value: string) => value.normalize('NFKC').replace(/\s+/g, '')

/** Reuses the owned-clone scoped-ID pattern in packages/experience/service.ts. */
export function strategyModelReferences(sources:readonly StrategySource[]) {
  const originalIds=new Set(sources.map(source=>source.id))
  let prefix='s'
  while(sources.some((_,index)=>originalIds.has(`${prefix}${index+1}`)))prefix='_'+prefix
  const originalByAlias=new Map(sources.map((source,index)=>[`${prefix}${index+1}`,source.id]))
  const aliasByOriginal=new Map([...originalByAlias].map(([alias,id])=>[id,alias]))
  function transform<T>(value:T,restore:boolean,strict:boolean):T {
    const clone=structuredClone(value)
    const ref=(id:unknown):unknown=>{
      if(typeof id!=='string') {if(strict)throw new Error('STRATEGY_SOURCE_MISMATCH');return id}
      const mapped=restore?originalByAlias.get(id)||(originalIds.has(id)?id:undefined):aliasByOriginal.get(id)||(originalByAlias.has(id)?id:undefined)
      if(mapped===undefined&&strict)throw new Error('STRATEGY_SOURCE_MISMATCH')
      return mapped??id
    }
    const visit=(node:unknown)=>{
      if(!node||typeof node!=='object')return
      if(Array.isArray(node)) {node.forEach(visit);return}
      for(const [key,item] of Object.entries(node)) {
        if(key==='source_id')(node as Record<string,unknown>)[key]=ref(item)
        else if((key==='evidence_refs'||key==='source_ids')&&Array.isArray(item))(node as Record<string,unknown>)[key]=item.map(ref)
        else visit(item)
      }
    }
    visit(clone);return clone
  }
  return {
    ids:[...originalByAlias.keys()],
    sources:sources.map(source=>({...source,id:aliasByOriginal.get(source.id)!})),
    encodeKnown:<T>(value:T)=>transform(value,false,false),
    restore:<T>(value:T)=>transform(value,true,true),
    restoreKnown:<T>(value:T)=>transform(value,true,false),
  }
}
/** Current workbench investment-stage admission, separate from statutory or professional approval. */
export function strategyConstructionAllowed(mode: RenewalStrategy['preferred_mode'], conditions: ModeCondition[], sources: readonly StrategySource[]): boolean {
  const gate = evaluateRenewalModeGate({conditions}), currentIds = new Set(sources.filter(source=>source.role==='current').map(source=>source.id))
  const citedAtObject = (kind: string, expected: boolean) => conditions.some(row=>row.kind===kind&&row.value===expected&&row.state===(expected?'supported':'restricted')&&row.source_ids.some(id=>currentIds.has(id))&&row.locators.some(locator=>locator.trim()))
  if (gate.checks.find(row=>row.kind==='funding_secured')?.state!=='met'||!citedAtObject('funding_secured',true)) return false
  if (mode==='rebuild') return gate.rebuild_allowed&&gate.checks.every(row=>citedAtObject(row.kind,row.kind!=='structure_repairable'))
  return mode==='comprehensive'&&gate.checks.find(row=>row.kind==='structure_repairable')?.state==='unmet'&&citedAtObject('structure_repairable',true)
}
export function validateStrategy(value: RenewalStrategy, sources: StrategySource[], conditions:ModeCondition[] = [], requireBrief = false, requireRoundReview = false, requireWorkPlan = false, requireReasoningDimensions = false, onIssue?: (code:string,path:string)=>void) {
  let path = 'strategy'
  const reject = (code:string) => { if(onIssue) onIssue(code,path); else throw new Error(code) }
  if (value.paths.length !== 2 || new Set(value.paths.map(path => path.mode)).size !== 2 || value.dimensions.length !== 6 || new Set(value.dimensions.map(row => row.key)).size !== 6) reject('STRATEGY_INCOMPLETE')
  const ids = new Set(sources.map(source => source.id))
  const reasoned=value.reasoning_dimensions,dimensionKeys=['demand','supply','adaptation','implementation','operations','resources']
  if(requireReasoningDimensions&&!reasoned)reject('STRATEGY_REASONING_DIMENSIONS_REQUIRED')
  if(reasoned) {
    if(reasoned.length!==6||new Set(reasoned.map(row=>row.key)).size!==6||reasoned.some(row=>!dimensionKeys.includes(row.key)))reject('STRATEGY_REASONING_DIMENSIONS_INCOMPLETE')
    for(const row of reasoned) {
      if(!['low','medium','high'].includes(row.level)||!['logical_inference','scenario_assumption'].includes(row.basis)||!Array.isArray(row.premises)||!row.premises.length||row.premises.some(text=>!text.trim())||!Array.isArray(row.assumptions)||row.assumptions.some(text=>!text.trim())||!row.reason?.trim()||!row.verification?.trim())reject('STRATEGY_REASONING_DIMENSIONS_INCOMPLETE')
      if(row.basis==='scenario_assumption'&&!row.assumptions.length)reject('STRATEGY_REASONING_ASSUMPTIONS_REQUIRED')
      if(!Array.isArray(row.evidence_refs)||row.evidence_refs.some(id=>!ids.has(id)))reject('STRATEGY_SOURCE_MISMATCH')
    }
  }
  for (const [index,row] of value.rationale.entries()) {
    path = `rationale.${index}`
    const source = sources.find(source => source.id === row.source_id)
    if (!source || row.quote.trim().length < 8 || !literal(source.text).includes(literal(row.quote))) reject('STRATEGY_QUOTE_MISMATCH')
  }
  path = 'evidence_refs'
  for (const row of [...value.paths.flatMap(path => path.actions), ...value.dimensions, ...value.next_checks]) if (row.evidence_refs.some(id => !ids.has(id))) reject('STRATEGY_SOURCE_MISMATCH')
  path = 'preferred_mode'
  if (!value.rationale.some(row => sources.find(source => source.id === row.source_id)?.role === 'current')) reject('STRATEGY_OBJECT_EVIDENCE_MISSING')
  if (value.preferred_mode==='comprehensive'&&conditions.some(row=>row.kind==='structure_repairable'&&row.value===false)||value.preferred_mode==='rebuild'&&conditions.some(row=>row.kind==='demolition_permitted'&&row.value===false)) reject('STRATEGY_MODE_RESTRICTED')
  if (value.preferred_mode==='rebuild'&&!evaluateRenewalModeGate({conditions}).rebuild_allowed) reject('STRATEGY_REBUILD_GATE_UNMET')
  path = 'decision_brief'
  const brief = value.decision_brief
  if (requireBrief && !brief) reject('STRATEGY_DECISION_BRIEF_REQUIRED')
  if (brief) {
    const texts = [brief.renewal?.conclusion, brief.renewal?.reason, brief.investment?.conclusion, brief.investment?.reason, brief.returns?.financial, brief.returns?.social]
    if (texts.some(text => typeof text !== 'string' || !text.trim()) || !['preliminary','construction','hold'].includes(brief.investment?.stage)) reject('STRATEGY_BRIEF_INCOMPLETE')
    for (const row of [brief.renewal, brief.investment, brief.returns]) {
      if (!Array.isArray(row.evidence_refs) || !row.evidence_refs.length) reject('STRATEGY_BRIEF_EVIDENCE_MISSING')
      if (row.evidence_refs.some(id => typeof id !== 'string' || !id.trim() || !ids.has(id))) reject('STRATEGY_SOURCE_MISMATCH')
    }
    if (requireBrief&&brief.investment.stage==='construction'&&!strategyConstructionAllowed(value.preferred_mode,conditions,sources)) reject('STRATEGY_CONSTRUCTION_GATE_UNMET')
  }
  if (requireBrief) for (const mode of ['comprehensive','rebuild'] as const) {
    const directionPath = value.paths.find(item=>item.mode===mode)
    if (!directionPath) continue
    path = `paths.${mode}`
    const text = [directionPath.title,directionPath.description,...directionPath.actions.flatMap(action=>[action.title,action.detail]),...directionPath.requirements,...(directionPath.work_packages?.flatMap(work=>[work.target,work.intervention,work.scope,work.delivery,...work.preconditions])||[]),...value.dimensions.map(dimension=>dimension[mode])].map(literal).join('\n')
    if ((mode==='comprehensive'?/原拆原建|整体拆建|整体拆除重建/:/综合整治/).test(text)) reject('STRATEGY_PATH_DIRECTION_MIXED')
  }
  path = 'round_review'
  const review = value.round_review
  if (requireRoundReview && !review) reject('STRATEGY_ROUND_REVIEW_REQUIRED')
  if (review) {
    if (!review.summary?.trim()) reject('STRATEGY_ROUND_REVIEW_INCOMPLETE')
    for (const change of review.changes) {
      const selectedDocuments=sources.filter(source=>source.document_id)
      if (![change.topic,change.before,change.after,change.reason].every(text=>typeof text==='string'&&text.trim()) || !change.evidence_refs.some(id=>(selectedDocuments.length?selectedDocuments:sources.filter(source=>source.role==='current')).some(source=>source.id===id))) reject('STRATEGY_ROUND_CHANGE_EVIDENCE_MISSING')
    }
    for (const item of review.missing_materials) if (![item.topic,item.request,item.reason].every(text=>typeof text==='string'&&text.trim())) reject('STRATEGY_ROUND_REVIEW_INCOMPLETE')
    for (const item of [...review.changes,...review.missing_materials]) if (item.evidence_refs.some(id=>!ids.has(id))) reject('STRATEGY_SOURCE_MISMATCH')
  }
  const workIds=new Set<string>()
  for(const directionPath of value.paths) {
    path = `paths.${directionPath.mode}`
    if(requireWorkPlan&&(!directionPath.work_packages||directionPath.work_packages.length<2))reject('STRATEGY_WORK_PACKAGES_REQUIRED')
    for(const work of directionPath.work_packages||[]) {
      path = `paths.${directionPath.mode}.work_packages.${work.id}`
      const texts=[work.id,work.target,work.source_id,work.locator,work.intervention,work.scope,work.delivery]
      if(texts.some(text=>typeof text!=='string'||!text.trim())||workIds.has(work.id)||!['object_source','project_scope','scenario'].includes(work.target_basis)||!['first','next','reserve'].includes(work.priority)||!Array.isArray(work.preconditions)||work.preconditions.some(text=>!text.trim()))reject('STRATEGY_WORK_PACKAGE_INCOMPLETE')
      workIds.add(work.id)
      if(!work.evidence_refs?.length||!work.evidence_refs.includes(work.source_id)||work.evidence_refs.some(id=>!ids.has(id)))reject('STRATEGY_SOURCE_MISMATCH')
      const source=sources.find(source=>source.id===work.source_id)!
      if(typeof work.quote!=='string'||work.quote.length<8||!source?.text.replace(/\r\n/g,'\n').includes(work.quote.replace(/\r\n/g,'\n')))reject('STRATEGY_WORK_PACKAGE_QUOTE_MISMATCH')
      if(work.locator!==source?.locator)reject('STRATEGY_WORK_PACKAGE_LOCATOR_MISMATCH')
      if(work.target_basis==='object_source'&&source?.role!=='current')reject('STRATEGY_WORK_PACKAGE_TARGET_SCOPE')
      const action=work.intervention.trim()
      const taskPatterns=[
        /^(?:调查|调研|鉴定|登记|核实|核查|勘察|测绘|协商|论证|收集|搜集|审核|评估|研究)/,
        /^(?:开展|完成|组织|进行|启动|安排|补充|编制|建立|形成|制定).{0,60}(?:调查|调研|鉴定|登记|核实|核查|勘察|测绘|协商|论证|评估|台账|方案|计划)[。；，,]*$/,
        /^(?:新增|建设|建立|配置).{0,30}(?:问卷|台账|调查表|材料目录)[。；，,]*$/,
        /^(?:对|针对)[^，。；,]{1,40}(?:开展|进行|组织)(?:调查|调研|鉴定|登记|核实|核查|勘察|测绘|协商|论证|评估)/,
      ]
      if(taskPatterns.some(pattern=>pattern.test(action)))reject('STRATEGY_WORK_PACKAGE_TASK_ONLY')
      if(!['source','scenario','unknown'].includes(work.quantity_basis)||work.quantity_basis==='unknown'&&work.quantity!==null||work.quantity_basis!=='unknown'&&(work.quantity===null||!Number.isFinite(work.quantity)||work.quantity<0||!work.unit?.trim()))reject('STRATEGY_WORK_PACKAGE_QUANTITY_MISMATCH')
      // Typed basis fields identify scenarios; their wording is not an admission condition.
      if(work.quantity_basis==='source'&&work.unit?.trim()&&work.quantity!==null) {
        const quantity=String(work.quantity).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')
        const unit=work.unit!.replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/平方米|平米|㎡|m²|m2/gi,'(?:平方米|平米|㎡|m²|m2)')
        const quoted=work.quote.replace(/\s+/g,'').replace(/(?<=\d),(?=\d{3}(?:\D|$))/g,'')
        const matches=[...quoted.matchAll(new RegExp(`(?<![\\d.])${quantity}${unit}`,'g'))]
        const supported=matches.some(match=>!['幢','栋','号楼'].includes(work.unit!)||!/^[(（]?\d+单元/.test(quoted.slice(match.index!+match[0].length)))
        if(source?.role!=='current'||!supported)reject('STRATEGY_WORK_PACKAGE_QUANTITY_MISMATCH')
      }
    }
  }
  path = 'internal_data_requests'
  const requests=value.internal_data_requests
  if(requireWorkPlan&&(!requests||!['resident_wellbeing','elevator_usage','meal_attendance'].every(key=>requests.some(request=>request.key===key))))reject('STRATEGY_INTERNAL_DATA_REQUESTS_REQUIRED')
  const requestIds=new Set<string>()
  for(const request of requests||[]) {
    path = `internal_data_requests.${request.id}`
    if([request.id,request.metric,request.purpose,request.collection_method,request.unit,request.period,request.denominator].some(text=>typeof text!=='string'||!text.trim())||requestIds.has(request.id))reject('STRATEGY_INTERNAL_DATA_REQUEST_INCOMPLETE')
    requestIds.add(request.id)
    if(request.related_package_ids.some(id=>!workIds.has(id)))reject('STRATEGY_INTERNAL_DATA_PACKAGE_MISMATCH')
    if(request.evidence_refs.some(id=>!ids.has(id)))reject('STRATEGY_SOURCE_MISMATCH')
  }
  return value
}

/** Content findings guide review; they never discard a schema-valid model plan. */
export function reviewStrategyContent(value:RenewalStrategy,sources:StrategySource[],conditions:ModeCondition[]=[],options:{requireRoundReview?:boolean;hasParent?:boolean;requireReasoningDimensions?:boolean;synthetic?:boolean;projectName?:string}={}):StrategyContentReview {
  const messages:Record<string,string> = {
    STRATEGY_INCOMPLETE:'方案路径或六维内容需补齐。',
    STRATEGY_QUOTE_MISMATCH:'判断所引原句需与来源逐字核对。',
    STRATEGY_SOURCE_MISMATCH:'部分引用编号尚未对应本轮来源，请核对出处。',
    STRATEGY_OBJECT_EVIDENCE_MISSING:'目前主要依据对标资料；需补充本对象原文验证方案适用性。',
    STRATEGY_MODE_RESTRICTED:'模型提出的方向与已登记条件有差异，需复核。',
    STRATEGY_REBUILD_GATE_UNMET:'模型提出拆建方向，部分拆建条件仍未满足或待核。',
    STRATEGY_CONSTRUCTION_GATE_UNMET:'模型提出工程投入建议，结构、资金等实施条件仍需核实。',
    STRATEGY_PATH_DIRECTION_MIXED:'单路径内容含另一方向的描述，需整理。',
    STRATEGY_DECISION_BRIEF_REQUIRED:'需补齐决策摘要。',
    STRATEGY_BRIEF_INCOMPLETE:'决策摘要部分内容待补齐。',
    STRATEGY_BRIEF_EVIDENCE_MISSING:'决策摘要的引用依据待补充。',
    STRATEGY_ROUND_REVIEW_REQUIRED:'本轮资料变化说明待补充。',
    STRATEGY_ROUND_REVIEW_INCOMPLETE:'轮次变化说明有待完善。',
    STRATEGY_ROUND_CHANGE_EVIDENCE_MISSING:'版本变化的依据需核对。',
    STRATEGY_ROUND_COMPARISON_MISSING:'尚未说明与上一轮方案的具体变化。',
    STRATEGY_WORK_PACKAGES_REQUIRED:'路径分项需要进一步细化。',
    STRATEGY_WORK_PACKAGE_INCOMPLETE:'分项字段或编号需要整理。',
    STRATEGY_WORK_PACKAGE_QUOTE_MISMATCH:'分项所引原句需与来源核对。',
    STRATEGY_WORK_PACKAGE_LOCATOR_MISMATCH:'分项引用的原文位置需核对。',
    STRATEGY_WORK_PACKAGE_TARGET_SCOPE:'分项对象来自参考案例，需验证本项目适用范围。',
    STRATEGY_WORK_PACKAGE_TASK_ONLY:'分项偏向调查任务，具体改造动作待细化。',
    STRATEGY_WORK_PACKAGE_QUANTITY_MISMATCH:'分项数量、单位或其原文依据需核对。',
    STRATEGY_INTERNAL_DATA_REQUESTS_REQUIRED:'需补充居民感受、电梯使用和食堂就餐的内部调查安排。',
    STRATEGY_INTERNAL_DATA_REQUEST_INCOMPLETE:'内部调查口径需完善。',
    STRATEGY_INTERNAL_DATA_PACKAGE_MISMATCH:'调查任务与方案分项的关联需核对。',
    STRATEGY_REASONING_DIMENSIONS_REQUIRED:'六维推理记录待补充。',
    STRATEGY_REASONING_DIMENSIONS_INCOMPLETE:'六维推理说明需补齐。',
    STRATEGY_REASONING_ASSUMPTIONS_REQUIRED:'情景推理的假设需补充。',
    STRATEGY_RELOCATION_ASSUMPTION_REQUIRED:'搬迁安排需结合施工组织核实。',
    STRATEGY_SYNTHETIC_IDENTITY_MISMATCH:'模拟项目的部分文字误称真实调查，请结合模拟标记阅读。',
  }
  const issues:StrategyContentIssue[]=[]
  const add=(code:string,path:string)=>{if(!issues.some(issue=>issue.code===code&&issue.path===path))issues.push({code,path,message:messages[code]||'本项内容需要复核。'})}
  validateStrategy(value,sources,conditions,true,!!options.requireRoundReview,true,!!options.requireReasoningDimensions,add)
  if(options.hasParent&&!value.round_review?.changes.length)add('STRATEGY_ROUND_COMPARISON_MISSING','round_review')
  const analysis=[value.headline,value.summary,...value.rationale.map(row=>row.point),...Object.values(value.decision_brief||{}).flatMap(row=>Object.entries(row).filter(([key])=>key!=='evidence_refs').map(([,text])=>String(text))),
    ...value.paths.flatMap(path=>[path.title,path.description,...path.actions.flatMap(action=>[action.title,action.detail]),...path.requirements,...(path.work_packages?.flatMap(work=>[work.target,work.intervention,work.scope,work.delivery,...work.preconditions])||[])]),...value.dimensions.flatMap(row=>[row.current,row.comprehensive,row.rebuild]),
    value.round_review?.summary,...(value.round_review?.changes.flatMap(row=>[row.after,row.reason])||[]),...(value.reasoning_dimensions?.flatMap(row=>[...row.premises,...row.assumptions,row.reason,row.verification])||[])]
  const relocationClaim=/(?:无需|不需要?|不用)(?:居民)?(?:整体)?搬迁/
  const relocationCondition=/假设|前提|待核|待确认|需确认|若|如果|条件下|不能认定|尚未确认|施工组织.{0,8}(?:确认|核实)/
  if(analysis.some(text=>text?.split(/[。！？!?\n]/).some(sentence=>relocationClaim.test(sentence.replace(/\s+/g,''))&&!relocationCondition.test(sentence))))add('STRATEGY_RELOCATION_ASSUMPTION_REQUIRED','analysis')
  if(options.synthetic) {
    const claim=String.raw`真实(?:问卷(?:数据|调查|结果)|居民(?:调研|调查|访谈))`
    const denied=new RegExp(String.raw`(?:并非|不是|不属于|不能视为|不代表|尚无|未取得|未获得)\s*${claim}`,'g')
    if(analysis.some(text=>text&&new RegExp(claim).test(text.replace(denied,''))))add('STRATEGY_SYNTHETIC_IDENTITY_MISMATCH','analysis')
  }
  const name=options.projectName||'本项目'
  const codes=new Set(issues.map(issue=>issue.code))
  const search_queries:string[]=[],reading_focus:string[]=[],internal_data:string[]=[]
  if(codes.has('STRATEGY_OBJECT_EVIDENCE_MISSING')) {
    search_queries.push(`${name} 改造 工程公告 实施范围`,`${name} 房屋安全鉴定 规划 居民协商`)
    reading_focus.push('优先阅读本对象的官方公告和附件，记录楼幢、范围、日期及实施阶段。')
    internal_data.push('本对象档案、鉴定报告和已实施工程清单。')
  }
  if(issues.some(issue=>/QUOTE|LOCATOR|SOURCE_MISMATCH|QUANTITY/.test(issue.code)))reading_focus.push('回到所引资料全文和附件，对照原句、位置、数量与单位；未取得的数值列为待核参数。')
  if(issues.some(issue=>/GATE|MODE_RESTRICTED|RELOCATION/.test(issue.code))) {
    search_queries.push(`${name} 更新 资金 结构 规划 安置 条件`)
    reading_focus.push('核对鉴定结论、规划条件、居民决议、资金证明与施工组织。')
    internal_data.push('结构鉴定、资金落实证明、业主表决及安置安排。')
  }
  if(issues.some(issue=>/INTERNAL_DATA|TASK_ONLY|WORK_PACKAGES_REQUIRED/.test(issue.code)))internal_data.push('居民幸福度与满意度问卷、分幢电梯运行统计、食堂去重就餐人数及用餐人次。')
  if(issues.length&&!reading_focus.length)reading_focus.push('对照方案待核清单，补读关联原文并补充缺失材料，再形成下一版。')
  return {policy:'advisory-v1',status:issues.length?'needs_review':'clear',checked_at:new Date().toISOString(),issues,follow_up:{search_queries,reading_focus,internal_data}}

}

/** Reuses the next-round material queue; no new approval or research gate. */
export function strategySupplementRequests(review:StrategyContentReview|undefined):import('./research-rounds').ResearchMissingMaterial[] {
  if(!review)return []
  return review.issues.map(issue=>({topic:'后续资料补充',request:issue.message,reason:`对应方案字段：${issue.path}。补充后用于复核该项判断与方案参数。`,evidence_refs:[]}))
}
