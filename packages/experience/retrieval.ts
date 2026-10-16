import { createHash } from 'node:crypto'
import type { Source } from '../../apps/host/generated/contracts'
import type { ProjectRecord } from '../../apps/host/store'
import type { ParsedDocument } from './document-slices'
import type { RagDocumentExport, RagExportBundle, RagMeasureLink } from './rag-export'
import { documentDataKind } from './rag-export'
import { searchTokens } from '../intelligence/domain'

export type RetrievalSourceKind = 'public_original' | 'ai_draft' | 'synthetic' | 'internal_material' | 'unknown'
export type RetrievalRequest = {
  question: string; measure_key?: string; object_ref?: string; stage?: string;
  source_kind?: RetrievalSourceKind; include_ai?: boolean;
  review_status?: 'draft' | 'approved' | 'rejected'; as_of?: string; limit?: number;
  use_ai?:boolean;allow_internal_ai?:boolean;
}
export type RetrievalSkip = { document_id: string; locator?: string; code: string; reason: string }
type RagChunk = RagDocumentExport['chunks'][number]
export type RetrievalCandidate = {
  id: string; document_id: string; version: string; locator: string; text: string; file_name: string;
  evidence_kind?: 'document_chunk' | 'source_text'; content_status?: Source['content_status'];
  version_origin?: 'registered_hash' | 'text_sha256'; source_aliases?: string[];
  alias_locators: string[];
  source: Source; source_kind: RetrievalSourceKind; source_date: string | null;
  measure_links: RagMeasureLink[]; matched_measure_links: RagMeasureLink[];
  measure_mentions: NonNullable<RagChunk['measure_mentions']>;
  stages: string[]; objects: string[]; review_statuses: string[]; match_reasons: string[];
}
export type RetrievalContext = {id:string;document_id:string;version:string;locator:string;text:string;relationship:'heading'|'table_header'|'neighbor'}
export type RetrievalHit = RetrievalCandidate & { score: number; matched_excerpt?: string;context?:RetrievalContext[] }
export type RetrievalAnswerClaim = { text:string; citations:{hit_id:string;quote:string}[] }
export type RetrievalAssistance = {
  status:'api'|'partial'|'keyword_fallback'; model:string|null; calls:number;
  answer:RetrievalAnswerClaim[]; public_queries:string[]; internal_requests:string[]; reading_guidance:string[];
  index:{eligible:number;indexed:number;pending:number;reused:number}; warnings:string[];
}
export type RetrievalQueryExpansion = { matched_terms: string[]; added_term: string; reason: string }
export type RetrievalResponse = {
  project_id: string; question: string; rank_query: string; query_expansions: RetrievalQueryExpansion[]; as_of: string | null; hits: RetrievalHit[];
  candidate_counts: { documents: number; parsed_chunks: number; eligible_chunks: number; ranked_chunks: number; batches: number; unresolved_references: number;
    source_texts?: number; eligible_source_texts?: number };
  skipped: RetrievalSkip[]; method: 'metadata_gated_bm25' | 'metadata_gated_batched_bm25' | 'api_semantic_bm25' | 'keyword_fallback';
  assistance?:RetrievalAssistance;
  score_meaning: string; ranking_note: string; content_role: 'untrusted_source_material'; fact_writes: 0;
}
export type RankMatch = { source_id: string; score: number }
export type RetrievalRanker = (project: ProjectRecord['input'], query: string, limit?:number) => Promise<{ matches: RankMatch[] }>

const sourceKind = (document: Pick<RagDocumentExport, 'data_kind'>): RetrievalSourceKind => ({
  public_original: 'public_original', ai_research_draft: 'ai_draft', synthetic_example: 'synthetic',
  internal_material: 'internal_material', unknown: 'unknown',
} as const)[document.data_kind]
const unique = (values: string[]) => [...new Set(values.filter(Boolean))].sort()
const validDate = (value: string | undefined): string | null => {
  if (!value || !/^\d{4}-\d{2}-\d{2}(?:$|T)/.test(value)) return null
  const date = value.slice(0, 10), parsed = new Date(`${date}T00:00:00Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date : null
}
const sameSource = (source: Source, documentId: string, hash: string) => source.hash === hash
  && (source.id === documentId || source.locator === `document:${documentId}`)
  && (!source.locator || source.locator === `document:${documentId}`)

/** Explicit wording bridges used by community documents; original questions and source text stay intact. */
export function expandRetrievalQuery(question: string): { rank_query: string; query_expansions: RetrievalQueryExpansion[] } {
  const rules = [
    { terms: ['楼栋', '楼幢'], added_term: '幢', reason: '楼栋数量在工程材料中常用“幢”记录，补充其原文计数单位。' },
    { terms: ['户数', '住户'], added_term: '户', reason: '住户数量在工程材料中常用“户”记录，补充其原文计数单位。' },
    { terms: ['排除'], added_term: '不纳入', reason: '排除范围在工程材料中可能写作“不纳入”，补充这一明确措辞。' },
    { terms: ['加梯'], added_term: '电梯', reason: '“加梯”在原文中也写作“加装电梯”，补充同一设施名称。' },
    { terms: ['花多少钱', '要多少钱', '花费多少'], added_term: '费用 投资 预算', reason: '日常费用问法对应工程材料中的费用、投资和预算词汇；仅扩展查找措辞，不推断金额。' },
    { terms: ['老人', '老年人', '长者'], added_term: '养老 老年 社区服务 邻里', reason: '老人的日常活动可能记在养老、老年、社区服务或邻里材料中；仅扩展查找词汇，不认定设施已适用。' },
    { terms: ['停车难', '找不到车位', '车位不够', '车位不足'], added_term: '停车 车位 泊位', reason: '停车困难在材料中可能用停车、车位或泊位记录；保留原问题并补充相应设施词汇。' },
    { terms: ['吃饭', '食堂', '用餐', '助餐'], added_term: '助餐 社区食堂 长者食堂 就餐 人次', reason: '补充助餐与食堂的常用表达。' },
    { terms: ['幸福', '满意', '过得怎么样', '住得舒服'], added_term: '幸福感 满意度 问卷 居住体验', reason: '补充居民感受和调查量表的表达。' },
    { terms: ['上楼', '乘梯', '电梯怎么', '电梯的', '加梯怎么'], added_term: '电梯 加装电梯 无障碍 使用频次 维保 托管', reason: '补充出行设施、运行与维护的表达。' },
    { terms: ['漏水', '水压', '停水'], added_term: '给水 管网 供水 渗漏 水泵', reason: '补充供水故障和设施名称。' },
    { terms: ['充电', '电动车'], added_term: '充电设施 充电桩 非机动车 消防', reason: '补充非机动车和充电设施表达。' },
  ]
  const query_expansions = rules.flatMap(rule => {
    const matched_terms = rule.terms.filter(term => question.includes(term))
    return matched_terms.length ? [{ matched_terms, added_term: rule.added_term, reason: rule.reason }] : []
  })
  return { rank_query: query_expansions.length ? `${question}\n${query_expansions.map(item => item.added_term).join(' ')}` : question, query_expansions }
}

const questionWords = new Set('有 有哪些 哪些 什么 怎么 如何 多少 什么时候 是否 有没有 能否 可否 请问 一下 关于 为什么 为何 怎样 哪里 资料 原文 查询 检索 查找 找到 查到 提供 说明 介绍 大概 大约 平时 去哪 去哪儿'.split(' '))
const genericWords = new Set('项目 小区 社区 居民 工程 改造 更新 当前 现在 需要 涉及 有关 相关 依据 措施 管理 方案 安排 情况 进展 步骤 确定 案例 中心 服务 活动 办法'.split(' '))
const subjectTopics = [
  ['二次供水', '供水', '自来水', '给水', '泵房', '水泵', '水压', '水表'],
  ['电梯', '加梯'], ['停车', '车位', '泊位', '泊车'],
  ['原拆原建', '拆除重建', '拆建', '重建', '自主更新'],
  ['养老', '老人', '老年', '长者', '康养', '助老', '邻里', '社区服务'],
]
const financialTerms = ['费用', '投资', '预算', '成本', '造价', '资金', '补助', '补贴', '融资', '自筹', '估算', '支出']
export function retrievalTopics(question: string) {
  const subjects = subjectTopics.filter(terms => terms.some(term => question.includes(term)))
  const financial = [...financialTerms, '多少钱', '花费'].some(term => question.includes(term))
  return { explicit: subjects.length > 0 || financial,
    matches: (text: string) => (!subjects.length || subjects.some(terms => terms.some(term => text.includes(term))))
      && (!financial || financialTerms.some(term => text.includes(term))) }
}
/** Body-only overlap gates BM25's existing common-word/punctuation matches; this is not a second ranking system. */
function retrievalTerms(project: ProjectRecord, query: ReturnType<typeof expandRetrievalQuery>, explicitTopic: boolean): string[] {
  const context = new Set(searchTokens(`${project.name} ${project.input.scope.name}`))
  const terms = searchTokens(query.rank_query).filter(term => !questionWords.has(term) && !/^\p{Script=Han}$/u.test(term))
  const specific = terms.filter(term => !genericWords.has(term) && !context.has(term))
  // Only traced expansion rules can admit a single-character counting unit; ordinary question characters stay excluded.
  const expanded = query.query_expansions.flatMap(expansion => expansion.added_term.split(/\s+/))
    .filter(term => term.length > 1 || !explicitTopic && (term === '户' || term === '幢'))
  // Intl's word segmentation can split these construction compounds into single characters; retain their exact phrase.
  const phrases = ['原拆原建', '拆除重建', '二次供水', '邻里中心'].filter(term => query.rank_query.includes(term))
  return unique([...phrases, ...expanded, ...(specific.length ? specific : phrases.length || expanded.length ? [] : terms)])
}

/** Scope labels only gain priority when their recorded object/title matches this project; foreign cases remain references. */
function scopePriority(candidate: RetrievalCandidate, projectTerms: string[]): number {
  const metadata = `${candidate.source.title} ${(candidate.source.object_refs || []).join(' ')}`.toLowerCase()
  if (!projectTerms.some(term => metadata.includes(term))) return 2
  return candidate.source.evidence_scope === 'object' ? 0 : candidate.source.evidence_scope === 'area' ? 1 : 2
}

type BuildingLocation = { building: string; unit: string | null; literal: string }
const locationNumerals = '零〇一二两三四五六七八九十百千'
function locationNumber(value: string): string {
  if (/^\d+$/.test(value)) return String(Number(value))
  const digits: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
  if (!/[十百千]/.test(value)) return String(Number([...value].map(char => digits[char]).join('')))
  let total = 0, digit = 0
  for (const char of value) {
    const unit = ({ 十: 10, 百: 100, 千: 1000 } as Record<string, number>)[char]
    if (unit) { total += (digit || 1) * unit; digit = 0 } else digit = digits[char]
  }
  return String(total + digit)
}
function buildingLocations(text: string): BuildingLocation[] {
  const pattern = new RegExp(`(?<![\\d${locationNumerals}])第?([\\d${locationNumerals}]{1,12})\\s*(?:幢|栋|号楼)(?:\\s*[-—/·]?\\s*的?第?([\\d${locationNumerals}]{1,12})\\s*单元)?`, 'gu')
  return [...text.normalize('NFKC').matchAll(pattern)].map(match => ({ building: locationNumber(match[1]), unit: match[2] ? locationNumber(match[2]) : null, literal: match[0] }))
}

/** Explicitly different building/unit identities cannot be rescued by semantic similarity. */
export function queryObjectCompatible(question:string,text:string):boolean {
  const wanted=buildingLocations(question),actual=buildingLocations(text)
  if(!wanted.length||!actual.length)return true
  return wanted.some(w=>actual.some(a=>a.building===w.building&&(w.unit===null||a.unit===null||a.unit===w.unit)))
}

/** Shared by direct questions and expert source reading; topics are preferences. */
export function passageQueryMatches(question:string,title:string,text:string,options:{bodyOnly?:boolean}={}):boolean {
  if(!queryObjectCompatible(question,title+'\n'+text))return false
  const query=expandRetrievalQuery(question),topics=retrievalTopics(question),joined=(options.bodyOnly?text:title+'\n'+text).toLowerCase()
  if(options.bodyOnly&&topics.explicit&&!topics.matches(text))return false
  const terms=[...searchTokens(query.rank_query),...query.query_expansions.flatMap(row=>row.added_term.split(/\s+/)),...(question.trim().length>=2?[question.trim()]:[])]
  return terms.some(term=>!questionWords.has(term)&&!genericWords.has(term)&&(term.length>1||!topics.explicit&&['户','幢'].includes(term))&&joined.includes(term))
    ||retrievalTopics(question).explicit&&retrievalTopics(question).matches(joined)
}

/** Context stays in separate original slices; never concatenate it into a verbatim quote. */
export function readRetrievalContext(hit:RetrievalCandidate,candidates:readonly RetrievalCandidate[]):RetrievalContext[] {
  const siblings=candidates.filter(row=>row.document_id===hit.document_id&&row.version===hit.version)
  const index=siblings.findIndex(row=>row.id===hit.id),table=hit.locator.match(/^(table:\d+)\/row:/)?.[1]
  const heading=siblings.slice(0,index).reverse().find(row=>/^\s*#{1,6}\s|(?:标题|项目名称)\s*[：:=]/m.test(row.text))
  const header=table?siblings.find(row=>row.locator===table+'/row:1'):undefined
  const selections=[{row:heading,relationship:'heading' as const},{row:header,relationship:'table_header' as const},...[-1,1].map(n=>({row:siblings[index+n],relationship:'neighbor' as const}))]
  const seen=new Set([hit.id])
  return selections.flatMap(({row,relationship})=>{
    if(!row||seen.has(row.id)||row.text.length>5000)return []
    seen.add(row.id)
    return [{id:row.id,document_id:row.document_id,version:row.version,locator:row.locator,text:row.text,relationship}]
  })
}

const annotationIdentity = (link: RagMeasureLink) => JSON.stringify([link.card_id, link.card_revision, link.review_status,
  link.measure_key, link.measure_name, link.kind, link.phase, link.stage, link.object_ref, link.field_key, link.value, link.evidence.quote])

/** Only a text parser's {Line,Text} mirror may share a hit. Independent citations and actual spreadsheet rows remain independent. */
function collapseTextMirrors(candidates: RetrievalCandidate[], bundle: RagExportBundle, skipped: RetrievalSkip[]): RetrievalCandidate[] {
  const removed = new Set<string>()
  for (const document of bundle.documents) {
    if (!/\.(?:txt|md)$/i.test(document.file_name)) continue
    const byLocator = new Map(candidates.filter(candidate => candidate.document_id === document.document_id && candidate.version === document.version)
      .map(candidate => [candidate.locator, candidate]))
    for (const mirror of document.chunks) {
      const values = mirror.values, candidate = byLocator.get(mirror.locator)
      if (!candidate || mirror.kind !== 'table_row' || !values || typeof values.Text !== 'string'
        || Object.keys(values).some(key => key !== 'Line' && key !== 'Text') || !/^\d+$/.test(String(values.Line)) || Number(values.Line) < 1) continue
      const raw = document.chunks.find(chunk => chunk.kind === 'text' && chunk.locator === `line:${Number(values.Line)}` && chunk.text === values.Text)
      const canonical = raw && byLocator.get(raw.locator)
      if (!canonical) continue
      const canonicalLinks = new Set(canonical.measure_links.map(annotationIdentity))
      if (candidate.measure_links.some(link => !canonicalLinks.has(annotationIdentity(link)))) continue
      canonical.alias_locators = unique([...canonical.alias_locators, mirror.locator])
      canonical.match_reasons.push(`解析镜像${mirror.locator}与本定位逐字一致，合并检索命中并保留别名定位`)
      skipped.push({ document_id: document.document_id, locator: mirror.locator, code: 'TEXT_PARSE_MIRROR',
        reason: `TXT/MD解析镜像的Text与${canonical.locator}逐字一致，且无额外独立举措引用；本次优先原文定位，导出仍保留两处定位。` })
      removed.add(candidate.id)
    }
  }
  return candidates.filter(candidate => !removed.has(candidate.id))
}

/** Saved Source bodies belong to the current input even when no upload/document row was created. */
function prepareSourceTexts(project: ProjectRecord, bundle: RagExportBundle, originals: ParsedDocument[], request: RetrievalRequest, skipped: RetrievalSkip[]) {
  const candidates: RetrievalCandidate[] = []
  if (bundle.project_id !== project.id || project.input.project_id !== project.id) return { candidates, sourceTexts: 0 }
  const documentIds = new Set([...bundle.documents.map(document => document.document_id), ...originals.map(document => document.id)])
  let sourceTexts = 0
  for (const source of project.input.sources) {
    // An uploaded document must pass the document/version gates above, never fall back through its source registration.
    if (bundle.documents.some(document => document.source?.id === source.id)
      || documentIds.has(source.id) || documentIds.has(source.id.replace(/^PUBLIC-DOCUMENT-/, ''))
      || source.locator?.startsWith('document:') && documentIds.has(source.locator.slice('document:'.length))) continue
    const skip = (code: string, reason: string) => skipped.push({ document_id: source.id, locator: source.locator, code, reason })
    const text = source.untrusted_text
    if (!text?.trim() || !['full_text', 'excerpt'].includes(source.content_status || '') || source.parse_status === 'empty' || source.parse_status === 'ocr_required') {
      skip('SOURCE_TEXT_UNAVAILABLE', '该来源未保存可用正文或摘录；仅有标题、链接或解析状态不能代替原文。'); continue
    }
    sourceTexts++
    // Reuse the same declared-AI/public/synthetic classification as uploaded material; this creates no document or parser state.
    const classification = documentDataKind({ id: source.id, fileName: source.title, hash: source.hash || null,
      format: 'source', status: 'extracted', parser: 'saved_source', createdAt: source.retrieved_at || null,
      segments: [], tables: [], notes: [], issues: [] }, source)
    const kind = sourceKind({ data_kind: classification.kind })
    if (source.visibility !== 'public' || kind === 'internal_material' || kind === 'unknown') {
      skip('SOURCE_NOT_PUBLIC', '补充检索仅纳入当前项目已登记的公开来源正文；内部材料继续走原有文档权限。'); continue
    }
    if (!request.include_ai && (kind === 'ai_draft' || kind === 'synthetic')) {
      skip('GENERATED_SOURCE_EXCLUDED', '默认检索排除AI草稿与模拟示例，可显式开启原文浏览。'); continue
    }
    if (request.source_kind && request.source_kind !== kind) { skip('SOURCE_KIND_FILTER', '来源类别不符合本次筛选。'); continue }
    const sourceDate = source.date_status === 'verified' ? validDate(source.published_at) : null
    if (request.as_of && !sourceDate) { skip('SOURCE_DATE_UNKNOWN', '来源正文时点未核实，上传或采集日期不替代正文时点。'); continue }
    if (request.as_of && sourceDate! > request.as_of) { skip('SOURCE_AFTER_AS_OF', '来源正文晚于本次研判时点。'); continue }
    const expires = validDate(source.expires_at)
    if (request.as_of && expires && expires < request.as_of) { skip('SOURCE_EXPIRED', '来源已超过登记有效期。'); continue }
    if (request.measure_key || request.object_ref || request.stage || request.review_status) {
      skip('SOURCE_ANNOTATION_UNAVAILABLE', '来源正文没有同版本举措审核引用，不能据标题或范围标签满足举措、对象、阶段及审核筛选。'); continue
    }
    if (text.length > 100000) { skip('CHUNK_TOO_LARGE', '来源正文超过现有检索契约的100000字上限，本次未截断或伪造定位。'); continue }
    const version = source.hash || createHash('sha256').update(text).digest('hex'), locator = source.locator || 'source:text'
    const contentStatus = source.body_truncated || source.records_truncated ? 'excerpt' : source.content_status
    const { untrusted_text: _sourceBody, public_records: _sourceRecords, ...metadata } = source
    candidates.push({ id: `RAG-${createHash('sha256').update(JSON.stringify([project.id, 'source_text', source.id, version, locator])).digest('hex')}`,
      evidence_kind: 'source_text', content_status: contentStatus, version_origin: source.hash ? 'registered_hash' : 'text_sha256', source_aliases: [],
      document_id: source.id, file_name: source.title, version, locator, text, alias_locators: [],
      source: structuredClone(metadata), source_kind: kind, source_date: sourceDate,
      measure_links: [], matched_measure_links: [], measure_mentions: [], stages: [], objects: unique(source.object_refs || []), review_statuses: [],
      match_reasons: ['当前项目已保存的公开来源正文；来源范围和正文/摘录状态沿用登记，不等同上传文件或审核事实',
        ...(source.hash ? ['版本使用已登记来源哈希'] : ['未登记来源哈希，版本使用本次已保存正文快照SHA-256，不代表已核对远端原件']),
        ...(!source.locator ? ['未登记页行定位，source:text仅指该来源当前已保存全文'] : []),
        ...(request.as_of ? [`正文时点${sourceDate}不晚于${request.as_of}`] : [])] })
  }
  // Imported project snapshots may attach the exact same public body repeatedly. Keep all source IDs as navigable aliases.
  const mirrors = new Map<string, RetrievalCandidate>()
  for (const candidate of candidates.sort((a, b) => a.source.id.length - b.source.id.length || a.source.id.localeCompare(b.source.id))) {
    const source = candidate.source
    const key = JSON.stringify([source.url || source.id, candidate.version, candidate.text, candidate.content_status,
      source.evidence_scope, source.object_refs, source.date_status, candidate.source_date, source.expires_at, source.body_truncated, source.records_truncated])
    const previous = mirrors.get(key)
    if (!previous) { mirrors.set(key, candidate); continue }
    previous.source_aliases!.push(candidate.source.id)
    skipped.push({ document_id: source.id, locator: candidate.locator, code: 'SOURCE_TEXT_MIRROR',
      reason: `同URL、正文、版本与来源范围的已保存镜像合并为${previous.source.id}，原来源ID保留为可定位别名。` })
  }
  return { candidates: [...mirrors.values()], sourceTexts }
}

/** All permission, source/version and metadata gates run before any ranking call. */
export function prepareRetrievalCandidates(project: ProjectRecord, bundle: RagExportBundle, originals: ParsedDocument[], request: RetrievalRequest) {
  const candidates: RetrievalCandidate[] = [], skipped: RetrievalSkip[] = []
  let parsedChunks = 0
  for (const document of bundle.documents) {
    const original = originals.find(item => item.id === document.document_id)
    const skip = (code: string, reason: string) => skipped.push({ document_id: document.document_id, code, reason })
    parsedChunks += document.chunks.length
    if (bundle.project_id !== project.id || !original || original.project_id !== project.id) { skip('DOCUMENT_SCOPE', '材料不属于当前已授权项目。'); continue }
    if (!document.version || document.version !== original.sha256 || original.parser_result.source_hash !== original.sha256) {
      skip('DOCUMENT_VERSION_CONFLICT', '解析快照与当前文档哈希不一致，需重新核对原件。'); continue
    }
    if (document.parse.status !== 'extracted') { skip('DOCUMENT_NOT_EXTRACTED', '原件尚未得到可用解析文本。'); continue }
    const version = document.version, source = document.source
    if (!source || !sameSource(source, document.document_id, version)
      || !project.input.sources.some(item => item.id === source.id && sameSource(item, document.document_id, version))) {
      skip('SOURCE_BINDING_REQUIRED', '没有当前项目中同文档标识、同定位、同哈希的来源登记。'); continue
    }
    const kind = sourceKind(document)
    if (!request.include_ai && (kind === 'ai_draft' || kind === 'synthetic')) {
      skip('GENERATED_SOURCE_EXCLUDED', '默认检索排除AI草稿与模拟示例，可显式开启原文浏览。'); continue
    }
    if (request.source_kind && request.source_kind !== kind) { skip('SOURCE_KIND_FILTER', '来源类别不符合本次筛选。'); continue }
    const sourceDate = source.date_status === 'verified' ? validDate(source.published_at) : null
    if (request.as_of && !sourceDate) { skip('SOURCE_DATE_UNKNOWN', '来源正文时点未核实，上传或采集日期不替代正文时点。'); continue }
    if (request.as_of && sourceDate! > request.as_of) { skip('SOURCE_AFTER_AS_OF', '来源正文晚于本次研判时点。'); continue }
    const expires = validDate(source.expires_at)
    if (request.as_of && expires && expires < request.as_of) { skip('SOURCE_EXPIRED', '来源已超过登记有效期。'); continue }
    for (const chunk of document.chunks) {
      const chunkSkip = (code: string, reason: string) => skipped.push({ document_id: document.document_id, locator: chunk.locator, code, reason })
      if (chunk.document_id !== document.document_id || chunk.version !== document.version || !chunk.text.trim()) {
        chunkSkip('CHUNK_VERSION_CONFLICT', '片段标识、版本或原文为空，未送入检索。'); continue
      }
      const links = chunk.measure_links.filter(link => link.evidence.document_id === document.document_id
        && link.evidence.version === document.version && link.evidence.locator === chunk.locator
        && !!link.evidence.quote.trim() && chunk.text.includes(link.evidence.quote))
      // The filters must match one citation; independent annotations never form an invented combined scope.
      const matched = links.filter(link => (!request.measure_key || link.measure_key === request.measure_key)
        && (!request.object_ref || link.object_ref === request.object_ref)
        && (!request.stage || link.stage === request.stage)
        && (!request.review_status || link.review_status === request.review_status))
      const mentions = chunk.measure_mentions || []
      const literalMatch = !!request.measure_key && !request.object_ref && !request.stage && !request.review_status
        && mentions.some(mention => mention.measure_key === request.measure_key)
      const annotationFilter = !!(request.measure_key || request.object_ref || request.stage || request.review_status)
      if (annotationFilter && !matched.length && !literalMatch) { chunkSkip('ANNOTATION_FILTER', '没有同时符合举措、对象、阶段及审核范围的同版本引用。'); continue }
      if (chunk.text.length > 100000) { chunkSkip('CHUNK_TOO_LARGE', '单片段超过现有检索契约的100000字上限，需在解析层明确分段后检索。'); continue }
      const reasons = ['当前项目、文档版本与来源绑定已核对']
      if (request.as_of) reasons.push(`正文时点${sourceDate}不晚于${request.as_of}`)
      if (annotationFilter && matched.length) reasons.push('筛选条件在同一条实际引用中匹配')
      if (literalMatch && !matched.length) reasons.push('原文逐字提及该举措，尚无对应审核引用')
      const { untrusted_text: _sourceBody, public_records: _sourceRecords, ...sourceMetadata } = source
      candidates.push({ id: `RAG-${createHash('sha256').update(JSON.stringify([project.id, document.document_id, document.version, chunk.locator])).digest('hex')}`,
        evidence_kind: 'document_chunk', content_status: source.content_status, version_origin: 'registered_hash',
        document_id: document.document_id, version: document.version, locator: chunk.locator, alias_locators: [], text: chunk.text,
        file_name: document.file_name, source: structuredClone(sourceMetadata), source_kind: kind, source_date: sourceDate,
        measure_links: links, matched_measure_links: annotationFilter ? matched : links, measure_mentions: mentions,
        stages: unique(links.map(link => link.stage)), objects: unique(links.map(link => link.object_ref || '')),
        review_statuses: unique(links.map(link => link.review_status)), match_reasons: reasons })
    }
  }
  const sources = prepareSourceTexts(project, bundle, originals, request, skipped)
  return { candidates: [...collapseTextMirrors(candidates, bundle, skipped), ...sources.candidates], skipped, parsedChunks, sourceTexts: sources.sourceTexts }
}

const virtualSource = (candidate: RetrievalCandidate): Source => ({ id: candidate.id, title: candidate.file_name,
  // The original URL is returned in hit metadata, but omitted here to prevent STORM URL deduplication losing sibling chunks.
  untrusted_text: candidate.text, data_class: candidate.source.data_class, visibility: candidate.source.visibility,
  synthetic: candidate.source.synthetic, hash: candidate.version, locator: candidate.locator })

/** Fairly interleave documents; all eligible slices participate, including uncited context and table rows beyond row 100. */
function interleave(candidates: RetrievalCandidate[]): RetrievalCandidate[] {
  const documents = new Map<string, RetrievalCandidate[]>()
  for (const candidate of candidates) {
    const values = documents.get(candidate.document_id) || []; values.push(candidate); documents.set(candidate.document_id, values)
  }
  const result: RetrievalCandidate[] = [], lists = [...documents.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, values]) => values)
  const length = Math.max(0, ...lists.map(values => values.length))
  for (let index = 0; index < length; index++) for (const list of lists) if (list[index]) result.push(list[index])
  return result
}

function batches(candidates: RetrievalCandidate[]): RetrievalCandidate[][] {
  const result: RetrievalCandidate[][] = []; let current: RetrievalCandidate[] = [], bytes = 0
  for (const candidate of interleave(candidates)) {
    const size = Buffer.byteLength(JSON.stringify(virtualSource(candidate)), 'utf8')
    if (current.length && (current.length >= 1000 || bytes + size > 1024 * 1024)) { result.push(current); current = []; bytes = 0 }
    current.push(candidate); bytes += size
  }
  if (current.length) result.push(current)
  return result
}

/** Reuse the single Python BM25 capability; no embedding store, model prompt or fact write is introduced. */
export async function retrieveProjectEvidence(project: ProjectRecord, bundle: RagExportBundle, originals: ParsedDocument[], request: RetrievalRequest, ranker: RetrievalRanker, options:{relaxTopics?:boolean;recallLimit?:number}={}): Promise<RetrievalResponse> {
  const prepared = prepareRetrievalCandidates(project, bundle, originals, request)
  const query = expandRetrievalQuery(request.question)
  const topics = retrievalTopics(request.question), terms = retrievalTerms(project, query, topics.explicit)
  // Named objects may be segmented into single Han characters. Require a continuous three-character name overlap,
  // rather than promoting every source which merely shares an institution/city word such as a two-character prefix.
  const names = [project.name, project.input.scope.name]
  const projectTerms = names.flatMap(name => [...name.matchAll(/\p{Script=Han}{3,}/gu)].flatMap(([run]) =>
    run === '片区研究' || run === '项目研究' ? [] : Array.from({ length: run.length - 2 }, (_, index) => run.slice(index, index + 3))))
  projectTerms.push(...searchTokens(names.join(' ')).filter(term => !/\p{Script=Han}/u.test(term) && term.length >= 3))
  const locations = buildingLocations(request.question)
  const locationTokens = new Set(locations.flatMap(location => searchTokens(location.literal)))
  const attributeTerms = terms.filter(term => !locationTokens.has(term) && !/^[\d零〇一二两三四五六七八九十百千]+$/.test(term) && !['单元', '楼栋', '楼幢', '号楼'].includes(term))
  const projectNames = unique(names.flatMap(name => [name.split(/[·|｜]/)[0].trim(), name.split(/[·|｜]/)[0].trim().replace(/^(?:浙江大学|浙大)/, '')]).filter(name => name.length >= 3))
  const locationMatch = (candidate: RetrievalCandidate) => {
    if (!locations.length) return false
    const refs = candidate.source.object_refs || [], metadata = `${candidate.source.title} ${refs.join(' ')}`
    if (!refs.includes(`project:${project.id}`) && (!projectNames.some(name => metadata.includes(name)) || refs.some(ref => ref.startsWith('project:')))) return false
    // Parse fields independently: a building in a title and an unrelated unit in a body cannot be spliced together.
    const recorded = [...buildingLocations(candidate.source.title), ...buildingLocations(candidate.text)]
    return locations.some(wanted => recorded.some(actual => actual.building === wanted.building && (wanted.unit === null || actual.unit === wanted.unit)))
  }
  const relevant = prepared.candidates.filter(candidate => {
    if(!queryObjectCompatible(request.question,candidate.file_name+'\n'+candidate.text))return false
    const text = candidate.text.toLowerCase(), bodyTerms = locations.length ? attributeTerms : terms
    if(options.relaxTopics) return passageQueryMatches(request.question,candidate.file_name,[candidate.text,...readRetrievalContext(candidate,prepared.candidates).map(row=>row.text)].join('\n')) || locationMatch(candidate)
    return topics.matches(candidate.text) && (topics.explicit || bodyTerms.some(term => text.includes(term)))
      || locationMatch(candidate) && attributeTerms.some(term => text.includes(term))
  })
  const priority = (candidate: RetrievalCandidate) => locationMatch(candidate) ? -1 : scopePriority(candidate, projectTerms)
  let rankCalls = 0
  const rank = async (candidates: RetrievalCandidate[]): Promise<RetrievalHit[]> => {
    rankCalls++
    const input = { ...project.input, facts: [], context_rules: [], events: [], sources: candidates.map(candidate=>{
      const source=virtualSource(candidate)
      return options.relaxTopics?{...source,untrusted_text:[candidate.text,...readRetrievalContext(candidate,prepared.candidates).map(row=>row.text)].join('\n')}:source
    }) }
    const ranked = await ranker(input, query.rank_query,options.recallLimit)
    const byId = new Map(candidates.map(candidate => [candidate.id, candidate])), seen = new Set<string>()
    return ranked.matches.flatMap(match => {
      const candidate = byId.get(match.source_id)
      if (!candidate || !Number.isFinite(match.score) || seen.has(match.source_id)) return []
      seen.add(match.source_id)
      return [{ ...candidate, score: match.score, match_reasons: [...candidate.match_reasons,
        options.relaxTopics?'关键词同时查找标题与正文，自动主题用于关联提示':'明确主题先核正文，计数单位不替代设施主题；通过后仍由现有BM25排序',
        ...(priority(candidate) === -1 ? ['问题中的楼幢、单元与同一项目来源的完整定位对应；正文支持所问属性，优先查找但不改变原文阶段或审核状态'] : []),
        priority(candidate) === 0 ? '来源登记为对象范围，且来源标题或对象标识与当前项目匹配，优先查找'
          : priority(candidate) === 1 ? '来源登记为社区范围，且来源标题或对象标识与当前项目匹配，随后查找' : '地区、外部案例或范围待核资料作为参考保留'] }]
    }).slice(0, options.recallLimit||5)
  }
  const finalists: RetrievalHit[] = []
  let batched = false
  for (const scope of [-1, 0, 1, 2]) {
    const initial = batches(relevant.filter(candidate => priority(candidate) === scope))
    batched ||= initial.length > 1
    let scoped: RetrievalHit[] = []
    for (const batch of initial) scoped.push(...await rank(batch))
    // Batch scores are not comparable. Re-rank within each scope using the same BM25 capability.
    if (initial.length > 1) {
      while (scoped.length > 1000) {
        const next: RetrievalHit[] = []
        for (let start = 0; start < scoped.length; start += 1000) next.push(...await rank(scoped.slice(start, start + 1000)))
        scoped = next
      }
      if (scoped.length) scoped = await rank(scoped)
    }
    finalists.push(...scoped)
  }
  return { project_id: project.id, question: request.question, ...query, as_of: request.as_of || null,
    hits: finalists.slice(0, options.recallLimit||request.limit || 5), candidate_counts: { documents: bundle.documents.length,
      parsed_chunks: prepared.parsedChunks, eligible_chunks: prepared.candidates.length, ranked_chunks: relevant.length,
      batches: rankCalls, unresolved_references: bundle.unresolved_references.length,
      source_texts: prepared.sourceTexts, eligible_source_texts: prepared.candidates.filter(candidate => candidate.evidence_kind === 'source_text').length }, skipped: prepared.skipped,
    method: batched ? 'metadata_gated_batched_bm25' : 'metadata_gated_bm25',
    score_meaning: 'BM25词项相关分数，可为负数；不是可信概率、工程效果或举措适用性评分。',
    ranking_note: '明确主题须在正文命中；同项目完整楼幢及单元定位允许标题绑定对象、正文分别支持所问属性并优先查找，计数单位不代替属性。同一来源内定位完整后，按来源范围查找对象、社区及地区案例参考；每档仍用同一BM25，档间分数不直接比较。'
      + (batched ? '大档按材料交错分批，每批最多1000片段及约1MB文本，候选再由同一BM25复排。' : '无正文主题词重合时保留无命中。'),
    content_role: 'untrusted_source_material', fact_writes: 0 }
}
