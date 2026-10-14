import { createHash } from 'node:crypto'
import type { Source } from '../../apps/host/generated/contracts'
import type { ProjectRecord } from '../../apps/host/store'
import type { ParsedDocument } from './document-slices'
import type { RagDocumentExport, RagExportBundle, RagMeasureLink } from './rag-export'

export type RetrievalSourceKind = 'public_original' | 'ai_draft' | 'synthetic' | 'internal_material' | 'unknown'
export type RetrievalRequest = {
  question: string; measure_key?: string; object_ref?: string; stage?: string;
  source_kind?: RetrievalSourceKind; include_ai?: boolean;
  review_status?: 'draft' | 'approved' | 'rejected'; as_of?: string; limit?: number;
}
export type RetrievalSkip = { document_id: string; locator?: string; code: string; reason: string }
type RagChunk = RagDocumentExport['chunks'][number]
export type RetrievalCandidate = {
  id: string; document_id: string; version: string; locator: string; text: string; file_name: string;
  alias_locators: string[];
  source: Source; source_kind: RetrievalSourceKind; source_date: string | null;
  measure_links: RagMeasureLink[]; matched_measure_links: RagMeasureLink[];
  measure_mentions: NonNullable<RagChunk['measure_mentions']>;
  stages: string[]; objects: string[]; review_statuses: string[]; match_reasons: string[];
}
export type RetrievalHit = RetrievalCandidate & { score: number }
export type RetrievalQueryExpansion = { matched_terms: string[]; added_term: string; reason: string }
export type RetrievalResponse = {
  project_id: string; question: string; rank_query: string; query_expansions: RetrievalQueryExpansion[]; as_of: string | null; hits: RetrievalHit[];
  candidate_counts: { documents: number; parsed_chunks: number; eligible_chunks: number; ranked_chunks: number; batches: number; unresolved_references: number };
  skipped: RetrievalSkip[]; method: 'metadata_gated_bm25' | 'metadata_gated_batched_bm25';
  score_meaning: string; ranking_note: string; content_role: 'untrusted_source_material'; fact_writes: 0;
}
export type RankMatch = { source_id: string; score: number }
export type RetrievalRanker = (project: ProjectRecord['input'], query: string) => Promise<{ matches: RankMatch[] }>

const sourceKind = (document: RagDocumentExport): RetrievalSourceKind => ({
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

/** Three explicit wording bridges used by the current community documents; original questions and source text stay intact. */
export function expandRetrievalQuery(question: string): { rank_query: string; query_expansions: RetrievalQueryExpansion[] } {
  const rules = [
    { terms: ['楼栋', '楼幢'], added_term: '幢', reason: '楼栋数量在工程材料中常用“幢”记录，补充其原文计数单位。' },
    { terms: ['户数', '住户'], added_term: '户', reason: '住户数量在工程材料中常用“户”记录，补充其原文计数单位。' },
    { terms: ['排除'], added_term: '不纳入', reason: '排除范围在工程材料中可能写作“不纳入”，补充这一明确措辞。' },
  ]
  const query_expansions = rules.flatMap(rule => {
    const matched_terms = rule.terms.filter(term => question.includes(term))
    return matched_terms.length ? [{ matched_terms, added_term: rule.added_term, reason: rule.reason }] : []
  })
  return { rank_query: query_expansions.length ? `${question}\n${query_expansions.map(item => item.added_term).join(' ')}` : question, query_expansions }
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
        document_id: document.document_id, version: document.version, locator: chunk.locator, alias_locators: [], text: chunk.text,
        file_name: document.file_name, source: structuredClone(sourceMetadata), source_kind: kind, source_date: sourceDate,
        measure_links: links, matched_measure_links: annotationFilter ? matched : links, measure_mentions: mentions,
        stages: unique(links.map(link => link.stage)), objects: unique(links.map(link => link.object_ref || '')),
        review_statuses: unique(links.map(link => link.review_status)), match_reasons: reasons })
    }
  }
  return { candidates: collapseTextMirrors(candidates, bundle, skipped), skipped, parsedChunks }
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
export async function retrieveProjectEvidence(project: ProjectRecord, bundle: RagExportBundle, originals: ParsedDocument[], request: RetrievalRequest, ranker: RetrievalRanker): Promise<RetrievalResponse> {
  const prepared = prepareRetrievalCandidates(project, bundle, originals, request)
  const query = expandRetrievalQuery(request.question)
  let rankCalls = 0
  const rank = async (candidates: RetrievalCandidate[]): Promise<RetrievalHit[]> => {
    rankCalls++
    const input = { ...project.input, facts: [], context_rules: [], events: [], sources: candidates.map(virtualSource) }
    const ranked = await ranker(input, query.rank_query)
    const byId = new Map(candidates.map(candidate => [candidate.id, candidate])), seen = new Set<string>()
    return ranked.matches.flatMap(match => {
      const candidate = byId.get(match.source_id)
      if (!candidate || !Number.isFinite(match.score) || seen.has(match.source_id)) return []
      seen.add(match.source_id)
      return [{ ...candidate, score: match.score, match_reasons: [...candidate.match_reasons, '现有BM25依据问题与原文词项重合排序；分数表示文本相关程度'] }]
    }).slice(0, 5)
  }
  const initial = batches(prepared.candidates)
  let finalists: RetrievalHit[] = []
  for (const batch of initial) finalists.push(...await rank(batch))
  // Batch scores are not comparable. Re-rank the pooled candidates with the same capability instead of sorting those scores together.
  if (initial.length > 1) {
    while (finalists.length > 1000) {
      const next: RetrievalHit[] = []
      for (let start = 0; start < finalists.length; start += 1000) next.push(...await rank(finalists.slice(start, start + 1000)))
      finalists = next
    }
    if (finalists.length) finalists = await rank(finalists)
  }
  return { project_id: project.id, question: request.question, ...query, as_of: request.as_of || null,
    hits: finalists.slice(0, request.limit || 5), candidate_counts: { documents: bundle.documents.length,
      parsed_chunks: prepared.parsedChunks, eligible_chunks: prepared.candidates.length, ranked_chunks: prepared.candidates.length,
      batches: rankCalls, unresolved_references: bundle.unresolved_references.length }, skipped: prepared.skipped,
    method: initial.length > 1 ? 'metadata_gated_batched_bm25' : 'metadata_gated_bm25',
    score_meaning: 'BM25词项相关分数，可为负数；不是可信概率、工程效果或举措适用性评分。',
    ranking_note: initial.length > 1 ? '按文档交错分批召回，每批最多1000片段及约1MB文本；各批前5候选再用同一BM25复排，批次分数不直接比较。' : '在权限、来源版本和元数据筛选后，直接复用现有BM25原文检索。',
    content_role: 'untrusted_source_material', fact_writes: 0 }
}
