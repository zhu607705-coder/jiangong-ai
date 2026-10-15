import type { ModelCall, RenewalStrategy, DecisionSupport, ResearchTrace } from '../../apps/host/generated/contracts'
import { evaluateRenewalModeGate, type ModeCondition } from './renewal-mode'

export const STRATEGY_POLICY = 'renewal-strategy-overview-v6'
export type StrategySource = { id: string; title: string; text: string; url: string | null; published_at: string | null; role: 'current' | 'reference'; locator: string;
  visibility?: 'public' | 'internal'; data_class?: 'public' | 'internal' | 'synthetic' | 'semi_synthetic'; document_id?: string; document_version?: string; project_id?: string;
  material_category?: import('./research-rounds').ResearchMaterialCategory; source_date?: string | null }
export type StrategyPublication = { kind: 'current' | 'saved_snapshot'; is_current: boolean; current_input_hash: string; saved_at: string }
export type PublicStrategyIndexItem = { project_id: string; project_name: string; context_version: number; strategy_context_version: number; created_at: string; headline: string; status: 'completed'; synthetic: false; is_current: boolean; input_hash: string }
export type PublicStrategyIndexResponse = { items: PublicStrategyIndexItem[] }
export type StrategyReview = { kind: 'source_and_metric_review'; reviewed_at: string; original_packet_sha256: string;
  changes: { path: string; before: unknown; after: unknown; reason: string }[] }
export type StrategyPacket = { project_id: string; context_version: number; input_hash: string; created_at: string; synthetic: boolean; status: 'completed' | 'failed' | 'unavailable';
  strategy: RenewalStrategy | null; sources: StrategySource[]; decision: DecisionSupport | null; model_calls: ModelCall[]; research: ResearchTrace | null; error: string | null; diagnostic?: StrategyDiagnostic; publication?: StrategyPublication; review?: StrategyReview }

export type StrategyDiagnostic = { code: 'MODEL_NOT_CONFIGURED' | 'MODEL_PROVIDER_FAILED' | 'MODEL_OUTPUT_INVALID' | 'MODEL_RATE_LIMITED' | 'MODEL_AUTH_FAILED' | 'MODEL_TIMEOUT' | 'RESEARCH_FAILED' | 'STRATEGY_EVIDENCE_INVALID' | 'STRATEGY_FAILED';
  stage?: string; stop_reason?: string; provider_code?: string }
export type StrategyProgress = { type: 'progress'; stage: 'sources' | 'research' | 'model' | 'validation' | 'result';
  status: 'running' | 'completed' | 'skipped' | 'failed'; message: string; source_count?: number; query_count?: number; round?: number; round_count?: number }
export type StrategyStreamEvent = StrategyProgress | { type: 'complete'; result: StrategyPacket } | { type: 'error'; message: string }

const providerCodes = new Set(['TRANSPORT', 'SERVER', 'TIMEOUT', 'AUTH', 'INVALID_CREDENTIAL', 'RATE_LIMIT', 'MALFORMED_RESPONSE', 'EMPTY_RESPONSE', 'BAD_REQUEST', 'NO_ADAPTER', 'MODEL_ERROR'])
const diagnosticMessages: Record<StrategyDiagnostic['code'], string> = {
  MODEL_NOT_CONFIGURED: '尚未配置模型服务，暂不能生成整体更新方案。',
  MODEL_PROVIDER_FAILED: '模型服务未完成本轮请求，整体更新方案生成失败。',
  MODEL_OUTPUT_INVALID: '模型返回内容未通过方案格式校验，本轮未发布方案。',
  MODEL_RATE_LIMITED: '模型服务限制了请求频率，本轮方案生成未完成。',
  MODEL_AUTH_FAILED: '模型服务未通过身份验证，本轮方案生成未完成。',
  MODEL_TIMEOUT: '本轮方案研究超时，尚未生成完整方案。',
  RESEARCH_FAILED: '公开资料检索未完成，本轮整体更新方案尚未生成。',
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
  const parsed = /^LIVE_STAGE_FAILED:(renewal_strategy(?:_(?:quote_repair|format_retry|contract_retry))*):(completed|error|aborted|max-tokens|failed)(?::([A-Z_]+))?/.exec(message)
  const call = parsed ? calls.filter(call => call.stage === parsed[1]).at(-1) : undefined
  const rawCode = call?.error_code || parsed?.[3]
  const provider = rawCode && providerCodes.has(rawCode) ? rawCode : undefined
  let code: StrategyDiagnostic['code'] = 'STRATEGY_FAILED'
  if (message === 'MODEL_NOT_CONFIGURED') code = 'MODEL_NOT_CONFIGURED'
  else if (options.timedOut || provider === 'TIMEOUT') code = 'MODEL_TIMEOUT'
  else if (provider === 'AUTH' || provider === 'INVALID_CREDENTIAL') code = 'MODEL_AUTH_FAILED'
  else if (provider === 'RATE_LIMIT') code = 'MODEL_RATE_LIMITED'
  else if (provider === 'MALFORMED_RESPONSE' || provider === 'EMPTY_RESPONSE' || parsed?.[2] === 'max-tokens' || error instanceof Error && error.name === 'ContractError' || /^STRATEGY_(INCOMPLETE|DECISION_BRIEF_REQUIRED|BRIEF_INCOMPLETE|PATH_DIRECTION_MIXED|ROUND_REVIEW_REQUIRED|ROUND_REVIEW_INCOMPLETE|ROUND_COMPARISON_MISSING|WORK_PACKAGES_REQUIRED|WORK_PACKAGE_INCOMPLETE|WORK_PACKAGE_TASK_ONLY|INTERNAL_DATA_REQUESTS_REQUIRED|INTERNAL_DATA_REQUEST_INCOMPLETE)$/.test(message)) code = 'MODEL_OUTPUT_INVALID'
  else if (/^STRATEGY_(QUOTE_MISMATCH|SOURCE_MISMATCH|OBJECT_EVIDENCE_MISSING|MODE_RESTRICTED|REBUILD_GATE_UNMET|BRIEF_EVIDENCE_MISSING|CONSTRUCTION_GATE_UNMET|ROUND_CHANGE_EVIDENCE_MISSING|WORK_PACKAGE_QUOTE_MISMATCH|WORK_PACKAGE_LOCATOR_MISMATCH|WORK_PACKAGE_TARGET_SCOPE|WORK_PACKAGE_QUANTITY_MISMATCH|WORK_PACKAGE_SCENARIO_REQUIRED|INTERNAL_DATA_PACKAGE_MISMATCH|SYNTHETIC_IDENTITY_MISMATCH|RELOCATION_ASSUMPTION_REQUIRED)$/.test(message)) code = 'STRATEGY_EVIDENCE_INVALID'
  else if (provider) code = 'MODEL_PROVIDER_FAILED'
  else if (options.stage === 'research') code = 'RESEARCH_FAILED'
  const diagnostic: StrategyDiagnostic = { code, ...(parsed ? { stage: parsed[1], stop_reason: parsed[2] } : {}), ...(provider ? { provider_code: provider } : {}) }
  const text = code === 'MODEL_PROVIDER_FAILED' && provider && Object.hasOwn(providerMessages, provider) ? providerMessages[provider] : diagnosticMessages[code]
  return { error: text, diagnostic }
}

/** Old cached failures have no diagnostic field; recover only known categories from their call records. */
export function strategyFailureMessage(packet: { diagnostic?: StrategyDiagnostic; error?: string | null; model_calls?: readonly ModelCall[]; status?: string }): string {
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
/** Current workbench investment-stage admission, separate from statutory or professional approval. */
export function strategyConstructionAllowed(mode: RenewalStrategy['preferred_mode'], conditions: ModeCondition[], sources: readonly StrategySource[]): boolean {
  const gate = evaluateRenewalModeGate({conditions}), currentIds = new Set(sources.filter(source=>source.role==='current').map(source=>source.id))
  const citedAtObject = (kind: string, expected: boolean) => conditions.some(row=>row.kind===kind&&row.value===expected&&row.state===(expected?'supported':'restricted')&&row.source_ids.some(id=>currentIds.has(id))&&row.locators.some(locator=>locator.trim()))
  if (gate.checks.find(row=>row.kind==='funding_secured')?.state!=='met'||!citedAtObject('funding_secured',true)) return false
  if (mode==='rebuild') return gate.rebuild_allowed&&gate.checks.every(row=>citedAtObject(row.kind,row.kind!=='structure_repairable'))
  return mode==='comprehensive'&&gate.checks.find(row=>row.kind==='structure_repairable')?.state==='unmet'&&citedAtObject('structure_repairable',true)
}
export function validateStrategy(value: RenewalStrategy, sources: StrategySource[], conditions:ModeCondition[] = [], requireBrief = false, requireRoundReview = false, requireWorkPlan = false) {
  if (value.paths.length !== 2 || new Set(value.paths.map(path => path.mode)).size !== 2 || value.dimensions.length !== 6 || new Set(value.dimensions.map(row => row.key)).size !== 6) throw new Error('STRATEGY_INCOMPLETE')
  const ids = new Set(sources.map(source => source.id))
  for (const row of value.rationale) {
    const source = sources.find(source => source.id === row.source_id)
    if (!source || row.quote.trim().length < 8 || !literal(source.text).includes(literal(row.quote))) throw new Error('STRATEGY_QUOTE_MISMATCH')
  }
  for (const row of [...value.paths.flatMap(path => path.actions), ...value.dimensions, ...value.next_checks]) if (row.evidence_refs.some(id => !ids.has(id))) throw new Error('STRATEGY_SOURCE_MISMATCH')
  if (!value.rationale.some(row => sources.find(source => source.id === row.source_id)?.role === 'current')) throw new Error('STRATEGY_OBJECT_EVIDENCE_MISSING')
  if (value.preferred_mode==='comprehensive'&&conditions.some(row=>row.kind==='structure_repairable'&&row.value===false)||value.preferred_mode==='rebuild'&&conditions.some(row=>row.kind==='demolition_permitted'&&row.value===false)) throw new Error('STRATEGY_MODE_RESTRICTED')
  if (value.preferred_mode==='rebuild'&&!evaluateRenewalModeGate({conditions}).rebuild_allowed) throw new Error('STRATEGY_REBUILD_GATE_UNMET')
  const brief = value.decision_brief
  if (requireBrief && !brief) throw new Error('STRATEGY_DECISION_BRIEF_REQUIRED')
  if (brief) {
    const texts = [brief.renewal?.conclusion, brief.renewal?.reason, brief.investment?.conclusion, brief.investment?.reason, brief.returns?.financial, brief.returns?.social]
    if (texts.some(text => typeof text !== 'string' || !text.trim()) || !['preliminary','construction','hold'].includes(brief.investment?.stage)) throw new Error('STRATEGY_BRIEF_INCOMPLETE')
    for (const row of [brief.renewal, brief.investment, brief.returns]) {
      if (!Array.isArray(row.evidence_refs) || !row.evidence_refs.length) throw new Error('STRATEGY_BRIEF_EVIDENCE_MISSING')
      if (row.evidence_refs.some(id => typeof id !== 'string' || !id.trim() || !ids.has(id))) throw new Error('STRATEGY_SOURCE_MISMATCH')
    }
    if (requireBrief&&brief.investment.stage==='construction'&&!strategyConstructionAllowed(value.preferred_mode,conditions,sources)) throw new Error('STRATEGY_CONSTRUCTION_GATE_UNMET')
  }
  if (requireBrief) for (const mode of ['comprehensive','rebuild'] as const) {
    const path = value.paths.find(path=>path.mode===mode)!
    const text = [path.title,path.description,...path.actions.flatMap(action=>[action.title,action.detail]),...path.requirements,...(path.work_packages?.flatMap(work=>[work.target,work.intervention,work.scope,work.delivery,...work.preconditions])||[]),...value.dimensions.map(dimension=>dimension[mode])].map(literal).join('\n')
    if ((mode==='comprehensive'?/原拆原建|整体拆建|整体拆除重建/:/综合整治/).test(text)) throw new Error('STRATEGY_PATH_DIRECTION_MIXED')
  }
  const review = value.round_review
  if (requireRoundReview && !review) throw new Error('STRATEGY_ROUND_REVIEW_REQUIRED')
  if (review) {
    if (!review.summary?.trim()) throw new Error('STRATEGY_ROUND_REVIEW_INCOMPLETE')
    for (const change of review.changes) {
      const selectedDocuments=sources.filter(source=>source.document_id)
      if (![change.topic,change.before,change.after,change.reason].every(text=>typeof text==='string'&&text.trim()) || !change.evidence_refs.some(id=>(selectedDocuments.length?selectedDocuments:sources.filter(source=>source.role==='current')).some(source=>source.id===id))) throw new Error('STRATEGY_ROUND_CHANGE_EVIDENCE_MISSING')
    }
    for (const item of review.missing_materials) if (![item.topic,item.request,item.reason].every(text=>typeof text==='string'&&text.trim())) throw new Error('STRATEGY_ROUND_REVIEW_INCOMPLETE')
    for (const item of [...review.changes,...review.missing_materials]) if (item.evidence_refs.some(id=>!ids.has(id))) throw new Error('STRATEGY_SOURCE_MISMATCH')
  }
  const workIds=new Set<string>()
  for(const path of value.paths) {
    if(requireWorkPlan&&(!path.work_packages||path.work_packages.length<2))throw new Error('STRATEGY_WORK_PACKAGES_REQUIRED')
    for(const work of path.work_packages||[]) {
      const texts=[work.id,work.target,work.source_id,work.locator,work.intervention,work.scope,work.delivery]
      if(texts.some(text=>typeof text!=='string'||!text.trim())||workIds.has(work.id)||!['object_source','project_scope','scenario'].includes(work.target_basis)||!['first','next','reserve'].includes(work.priority)||!Array.isArray(work.preconditions)||work.preconditions.some(text=>!text.trim()))throw new Error('STRATEGY_WORK_PACKAGE_INCOMPLETE')
      workIds.add(work.id)
      if(!work.evidence_refs?.length||!work.evidence_refs.includes(work.source_id)||work.evidence_refs.some(id=>!ids.has(id)))throw new Error('STRATEGY_SOURCE_MISMATCH')
      const source=sources.find(source=>source.id===work.source_id)!
      if(typeof work.quote!=='string'||work.quote.length<8||!source.text.replace(/\r\n/g,'\n').includes(work.quote.replace(/\r\n/g,'\n')))throw new Error('STRATEGY_WORK_PACKAGE_QUOTE_MISMATCH')
      if(work.locator!==source.locator)throw new Error('STRATEGY_WORK_PACKAGE_LOCATOR_MISMATCH')
      if(work.target_basis==='object_source'&&source.role!=='current')throw new Error('STRATEGY_WORK_PACKAGE_TARGET_SCOPE')
      const action=work.intervention.trim()
      const taskPatterns=[
        /^(?:调查|调研|鉴定|登记|核实|核查|勘察|测绘|协商|论证|收集|搜集|审核|评估|研究)/,
        /^(?:开展|完成|组织|进行|启动|安排|补充|编制|建立|形成|制定).{0,60}(?:调查|调研|鉴定|登记|核实|核查|勘察|测绘|协商|论证|评估|台账|方案|计划)[。；，,]*$/,
        /^(?:新增|建设|建立|配置).{0,30}(?:问卷|台账|调查表|材料目录)[。；，,]*$/,
        /^(?:对|针对)[^，。；,]{1,40}(?:开展|进行|组织)(?:调查|调研|鉴定|登记|核实|核查|勘察|测绘|协商|论证|评估)/,
      ]
      if(taskPatterns.some(pattern=>pattern.test(action)))throw new Error('STRATEGY_WORK_PACKAGE_TASK_ONLY')
      const scenarioText=[work.scope,...work.preconditions].join('；')
      if(!['source','scenario','unknown'].includes(work.quantity_basis)||work.quantity_basis==='unknown'&&work.quantity!==null||work.quantity_basis!=='unknown'&&(work.quantity===null||!Number.isFinite(work.quantity)||work.quantity<0||!work.unit?.trim()))throw new Error('STRATEGY_WORK_PACKAGE_QUANTITY_MISMATCH')
      if((work.quantity_basis==='scenario'||work.target_basis==='scenario')&&!/情景|假设|模拟/.test(scenarioText))throw new Error('STRATEGY_WORK_PACKAGE_SCENARIO_REQUIRED')
      if(work.quantity_basis==='source') {
        const quantity=String(work.quantity).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')
        const unit=work.unit!.replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/平方米|平米|㎡|m²|m2/gi,'(?:平方米|平米|㎡|m²|m2)')
        const quoted=work.quote.replace(/\s+/g,'').replace(/(?<=\d),(?=\d{3}(?:\D|$))/g,'')
        const matches=[...quoted.matchAll(new RegExp(`(?<![\\d.])${quantity}${unit}`,'g'))]
        const supported=matches.some(match=>!['幢','栋','号楼'].includes(work.unit!)||!/^[(（]?\d+单元/.test(quoted.slice(match.index!+match[0].length)))
        if(source.role!=='current'||!supported)throw new Error('STRATEGY_WORK_PACKAGE_QUANTITY_MISMATCH')
      }
    }
  }
  const requests=value.internal_data_requests
  if(requireWorkPlan&&(!requests||!['resident_wellbeing','elevator_usage','meal_attendance'].every(key=>requests.some(request=>request.key===key))))throw new Error('STRATEGY_INTERNAL_DATA_REQUESTS_REQUIRED')
  const requestIds=new Set<string>()
  for(const request of requests||[]) {
    if([request.id,request.metric,request.purpose,request.collection_method,request.unit,request.period,request.denominator].some(text=>typeof text!=='string'||!text.trim())||requestIds.has(request.id))throw new Error('STRATEGY_INTERNAL_DATA_REQUEST_INCOMPLETE')
    requestIds.add(request.id)
    if(request.related_package_ids.some(id=>!workIds.has(id)))throw new Error('STRATEGY_INTERNAL_DATA_PACKAGE_MISMATCH')
    if(request.evidence_refs.some(id=>!ids.has(id)))throw new Error('STRATEGY_SOURCE_MISMATCH')
  }
  return value
}
