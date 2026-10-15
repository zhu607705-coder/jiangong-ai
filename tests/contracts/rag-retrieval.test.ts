import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import express from 'express'
import type { Server } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import fixture from '../../fixtures/inputs/01_auto.json'
import type { ExperienceCard, ProjectInput, Source } from '../../apps/host/generated/contracts'
import type { ProjectRecord } from '../../apps/host/store'
import { Store } from '../../apps/host/store'
import { config } from '../../apps/host/config'
import { registerRagRetrieval, retrievalRequest } from '../../apps/host/rag-retrieval'
import { KnowledgePipelineService } from '../../packages/experience/pipeline'
import { ExperienceService } from '../../packages/experience/service'
import { ExperienceError } from '../../packages/experience/errors'
import type { ParsedDocument } from '../../packages/experience/document-slices'
import { buildRagExport } from '../../packages/experience/rag-export'
import { normalizeImportDocument } from '../../apps/workspace/src/imports/graph-model'
import { expandRetrievalQuery, prepareRetrievalCandidates, retrieveProjectEvidence, type RetrievalRanker, type RetrievalResponse } from '../../packages/experience/retrieval'
import { LiveSession } from '../../runtime/dsh/live-session'

const doc = (id: string, text = '二次供水拟改造。', patch: Partial<ParsedDocument> = {}): ParsedDocument => ({
  id, project_id: 'RAG-A', file_name: `${id}.pdf`, sha256: `hash-${id}`, created_at: '2026-10-14T00:00:00Z',
  parser_result: { status: 'extracted', source_hash: `hash-${id}`, segments: [{ locator: 'page:1', text }] }, ...patch,
})
const source = (document: ParsedDocument, patch: Partial<Source> = {}): Source => ({ id: `PUBLIC-DOCUMENT-${document.id}`,
  title: document.file_name, locator: `document:${document.id}`, hash: document.sha256, visibility: 'public', data_class: 'public',
  synthetic: false, published_at: '2026-09-01', date_status: 'verified', content_status: 'uploaded', url: 'https://example.org/shared-original', ...patch,
})
const card = (document: ParsedDocument, stage = 'proposed', status: ExperienceCard['status'] = 'draft', object_ref = 'building:B1'): ExperienceCard => ({
  id: `CARD-${document.id}`, project_id: 'RAG-A', revision: 1, title: '二次供水', project_type: '老旧小区', development_mode: '综合整治',
  stage, status, review_note: null, created_at: '', updated_at: '', fields: [{ key: stage === 'proposed' ? 'proposal' : 'implementation',
    value: document.parser_result.segments![0].text, evidence: [{ document_id: document.id, version: document.sha256, locator: 'page:1', quote: document.parser_result.segments![0].text }] }],
  knowledge: { kind: 'case', origin: 'project_case', measure_key: 'pipe_network', measure_name: '二次供水', conditions: [], exclusions: [], transfer_notes: [],
    evidence_level: 'proposal_only', chunks: [{ id: 'action', document_id: document.id, document_version: document.sha256,
      kind: 'action', classification: 'local', measure_key: 'pipe_network', object_ref, stage,
      text: document.parser_result.segments![0].text, spans: [{ document_id: document.id, version: document.sha256, locator: 'page:1', quote: document.parser_result.segments![0].text }], context_chunk_ids: [] }] },
})
const input = (id: string, sources: Source[] = []): ProjectInput => ({ ...structuredClone(fixture) as ProjectInput,
  project_id: id, synthetic: false, sources, facts: [], context_rules: [], events: [], mode: 'enterprise',
  scope: { name: '检索工程测试', geometry: null, coordinate_encoding: 'WGS84', legal_parcel_confirmed: false }, as_of: '2026-10-14' })
const project = (sources: Source[]): ProjectRecord => ({ id: 'RAG-A', input: input('RAG-A', sources), owner_id: config.ownerId,
  name: '检索工程测试', context_version: 1, created_at: '', updated_at: '' })
const bundle = (documents: ParsedDocument[], sources: Source[], cards: ExperienceCard[] = []) => buildRagExport({
  projectId: 'RAG-A', documents: documents.map(value => ({ ...normalizeImportDocument(value), hash: value.sha256 })),
  rawDocuments: documents, cards, sources,
})

describe('owner-scoped source/version-aware read-only RAG retrieval', () => {
  let directory: string, store: Store, server: Server, base: string
  const model = vi.spyOn(LiveSession, 'open').mockRejectedValue(new Error('retrieval must never request a model'))
  const calls: ProjectInput[] = []
  const ranker = vi.fn<RetrievalRanker>(async (value, query) => {
    calls.push(value)
    if (query === '二次供水模拟能力服务失败') throw new ExperienceError(502, 'RAG_RETRIEVAL_UNAVAILABLE', '现有检索能力不可用')
    return { matches: value.sources.filter(item => item.untrusted_text!.includes('二次供水')).slice(0, 5).map(item => ({ source_id: item.id, score: -0.25 })) }
  })
  const documents = [doc('A'), doc('B', '二次供水已实施。'), doc('AI', '二次供水AI草稿。', { file_name: 'AI采集工程.txt' }),
    doc('SYN'), doc('UNDATED'), doc('FUTURE'), doc('STALE', '二次供水旧快照。', { parser_result: { status: 'extracted', source_hash: 'old', segments: [{ locator: 'page:1', text: '二次供水旧快照。' }] } }), doc('BIND')]
  const sources = documents.map(document => source(document, document.id === 'AI' ? { visibility: 'internal', data_class: 'internal' }
    : document.id === 'SYN' ? { synthetic: true, data_class: 'synthetic' }
    : document.id === 'UNDATED' ? { published_at: undefined, date_status: 'undated', retrieved_at: '2026-01-01' }
    : document.id === 'FUTURE' ? { published_at: '2027-01-01' }
    : document.id === 'BIND' ? { hash: 'incorrect-hash' } : {}))
  const cards = [card(documents[0]), card(documents[1], 'implemented', 'approved', 'building:B2')]
  const api = async (id: string, body: unknown) => {
    const response = await fetch(`${base}/api/projects/${id}/knowledge/retrieve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    return { status: response.status, value: await response.json() as RetrievalResponse & { code?: string } }
  }
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'rag-retrieval-')); store = await Store.open(directory)
    const service = new ExperienceService(store); await service.initialize()
    const pipeline = new KnowledgePipelineService(store, service); await pipeline.initialize()
    for (const [id, owner] of [['RAG-A', config.ownerId], ['RAG-B', config.ownerId], ['RAG-FOREIGN', 'another-owner']]) {
      await store.db.query('INSERT INTO projects(id,name,owner_id,input) VALUES($1,$2,$3,$4)', [id, '检索工程测试', owner, JSON.stringify(input(id, id === 'RAG-A' ? sources : []))])
    }
    for (const document of documents) await store.db.query('INSERT INTO documents(id,project_id,file_name,blob_name,sha256,parser_result) VALUES($1,$2,$3,$4,$5,$6)',
      [document.id, document.project_id, document.file_name, 'unused', document.sha256, JSON.stringify(document.parser_result)])
    for (const value of cards) {
      await store.db.query('INSERT INTO experience_cards(id,project_id,revision,payload) VALUES($1,$2,$3,$4)', [value.id, value.project_id, value.revision, JSON.stringify(value)])
      await store.db.query("INSERT INTO experience_history(card_id,revision,payload,action,reviewer,search_vector) VALUES($1,$2,$3,'create',$4,to_tsvector('simple','二次供水'))", [value.id, value.revision, JSON.stringify(value), config.ownerId])
    }
    const app = express(); app.use(express.json())
    registerRagRetrieval(app, store, async id => {
      const value = await store.project(id, config.ownerId)
      if (!value) throw new ExperienceError(404, 'PROJECT_NOT_FOUND', '项目不存在或无权访问')
      return value
    }, { pipeline, ranker })
    server = app.listen(0); await new Promise<void>(resolve => server.once('listening', resolve))
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  })
  afterAll(async () => { model.mockRestore(); await new Promise<void>(resolve => server.close(() => resolve())); await store.db.close(); await rm(directory, { recursive: true, force: true }) })

  it('returns exact originals from different documents even when their original URLs are identical', async () => {
    const response = await api('RAG-A', { question: '二次供水', source_kind: 'public_original', as_of: '2026-10-14' })
    expect(response.status).toBe(200); expect(response.value.hits.map(hit => hit.document_id)).toEqual(['A', 'B'])
    expect(response.value.hits.map(hit => hit.text)).toEqual(['二次供水拟改造。', '二次供水已实施。'])
    expect(response.value.hits[0].measure_links[0].review_status).toBe('draft')
    expect(response.value.hits[0].score).toBe(-0.25); expect(response.value.score_meaning).toContain('不是可信概率')
    expect(calls.at(-1)!.sources.every(item => item.url === undefined)).toBe(true)
    expect(calls.at(-1)!.facts).toEqual([]); expect(calls.at(-1)!.context_rules).toEqual([])
    expect(response.value.fact_writes).toBe(0); expect(model).not.toHaveBeenCalled()
  })
  it('gates AI, simulation, stale parser hashes and invalid source bindings before ranking', async () => {
    const response = await api('RAG-A', { question: '二次供水' })
    expect(response.value.skipped.map(skip => skip.code)).toEqual(expect.arrayContaining(['GENERATED_SOURCE_EXCLUDED', 'DOCUMENT_VERSION_CONFLICT', 'SOURCE_BINDING_REQUIRED']))
    const sent = calls.at(-1)!.sources.map(item => item.untrusted_text).join('\n')
    expect(sent).not.toContain('AI草稿'); expect(sent).not.toContain('旧快照')
    expect(response.value.hits.some(hit => ['AI', 'SYN', 'STALE', 'BIND'].includes(hit.document_id))).toBe(false)
  })
  it('explicit AI browsing preserves its classification and draft state without claiming approved evidence', async () => {
    const response = await api('RAG-A', { question: '二次供水', source_kind: 'ai_draft', include_ai: true })
    expect(response.value.hits).toHaveLength(1); expect(response.value.hits[0]).toMatchObject({ document_id: 'AI', source_kind: 'ai_draft', measure_links: [] })
    const approved = await api('RAG-A', { question: '二次供水', source_kind: 'ai_draft', include_ai: true, review_status: 'approved' })
    expect(approved.value.hits).toEqual([])
  })
  it('requires verified source dates and excludes future originals; upload and retrieval dates cannot fill them', async () => {
    const response = await api('RAG-A', { question: '二次供水', as_of: '2026-10-14' })
    expect(response.value.skipped).toEqual(expect.arrayContaining([
      expect.objectContaining({ document_id: 'UNDATED', code: 'SOURCE_DATE_UNKNOWN' }),
      expect.objectContaining({ document_id: 'FUTURE', code: 'SOURCE_AFTER_AS_OF' }),
    ]))
    expect(response.value.hits.every(hit => hit.source_date === '2026-09-01')).toBe(true)
  })
  it('keeps object, stage and approved-review filters attached to one actual same-version citation', async () => {
    const response = await api('RAG-A', { question: '二次供水', measure_key: 'pipe_network', object_ref: 'building:B2', stage: 'implemented', review_status: 'approved' })
    expect(response.value.hits.map(hit => hit.document_id)).toEqual(['B'])
    expect(response.value.hits[0].matched_measure_links[0]).toMatchObject({ object_ref: 'building:B2', stage: 'implemented', review_status: 'approved' })
    const incompatible = await api('RAG-A', { question: '二次供水', object_ref: 'building:B1', stage: 'implemented' })
    expect(incompatible.value.hits).toEqual([])
  })
  it('rejects foreign ownership, body scope spoofing and another project material access', async () => {
    expect((await api('RAG-FOREIGN', { question: '二次供水' })).status).toBe(404)
    expect((await api('RAG-A', { question: '二次供水', project_id: 'RAG-B' })).status).toBe(422)
    const other = await api('RAG-B', { question: '二次供水' }); expect(other.value.hits).toEqual([])
    expect(other.value.candidate_counts.documents).toBe(0)
  })
  it('reports capability failure instead of silently using another ranker', async () => {
    const response = await api('RAG-A', { question: '二次供水模拟能力服务失败' })
    expect(response.status).toBe(502); expect(response.value.code).toBe('RAG_RETRIEVAL_UNAVAILABLE')
  })
  it('validates question, exact-date, safe filter and limit bounds', () => {
    for (const value of [{ question: ' ' }, { question: 'x'.repeat(501) }, { question: 'x', as_of: '2026-02-30' },
      { question: 'x', limit: 6 }, { question: 'x', measure_key: "pipe'; DROP" }]) expect(retrievalRequest.safeParse(value).success).toBe(false)
  })
  it('does not modify any real facts or experience review state during repeated read-only requests', async () => {
    const before = (await store.project('RAG-A', config.ownerId))!
    const states = (await store.db.query<{ payload: ExperienceCard }>('SELECT payload FROM experience_cards WHERE project_id=$1 ORDER BY id', ['RAG-A'])).rows
    await api('RAG-A', { question: '二次供水', include_ai: true })
    expect((await store.project('RAG-A', config.ownerId))!.input).toEqual(before.input)
    expect((await store.db.query('SELECT payload FROM experience_cards WHERE project_id=$1 ORDER BY id', ['RAG-A'])).rows).toEqual(states)
  })
})

it('metadata filtering cannot splice approved review and another annotation object together', () => {
  const document = doc('X'), sourceValue = source(document), first = card(document, 'implemented', 'approved', 'building:B1')
  const second = { ...card(document, 'proposed', 'draft', 'building:B2'), id: 'CARD-second' }
  const result = prepareRetrievalCandidates(project([sourceValue]), bundle([document], [sourceValue], [first, second]), [document],
    { question: '二次供水', object_ref: 'building:B2', review_status: 'approved' })
  expect(result.candidates).toEqual([]); expect(result.skipped[0].code).toBe('ANNOTATION_FILTER')
})

it('same quotation in stale card versions never qualifies an approved-only retrieval', () => {
  const document = doc('X'), sourceValue = source(document), stale = card(document, 'implemented', 'approved')
  stale.fields[0].evidence[0].version = 'previous-version'; stale.knowledge!.chunks![0].spans[0].version = 'previous-version'
  const result = prepareRetrievalCandidates(project([sourceValue]), bundle([document], [sourceValue], [stale]), [document], { question: '二次供水', review_status: 'approved' })
  expect(result.candidates).toEqual([])
})

it('literal mentions are searchable without inventing reviewed cards, stages or objects', () => {
  const document = doc('X'), context = doc('Y', '居民提出二次供水问题。'), sources = [source(document), source(context)]
  const exported = bundle([document, context], sources, [card(document)])
  const result = prepareRetrievalCandidates(project(sources), exported, [document, context], { question: '二次供水', measure_key: 'pipe_network' })
  const mention = result.candidates.find(value => value.document_id === 'Y')!
  expect(mention.measure_links).toEqual([]); expect(mention.measure_mentions[0].review_status).toBe('not_reviewed')
  const approved = prepareRetrievalCandidates(project(sources), exported, [document, context], { question: '二次供水', measure_key: 'pipe_network', review_status: 'approved' })
  expect(approved.candidates).toEqual([])
})

it('reads all rows, ranks within the 1000-source contract and re-ranks pooled batch candidates rather than comparing batch scores', async () => {
  const large = doc('TABLE', '', { file_name: '大表.xlsx', parser_result: { status: 'extracted', source_hash: 'hash-TABLE',
    profile: { tables: [{ rows: Array.from({ length: 1012 }, (_, index) => ({ rowNumber: index + 2, values: { 举措: `二次供水${index}` } })) }] } } })
  const small = doc('SMALL'), sources = [source(large), source(small)], calls: ProjectInput[] = []
  const ranker: RetrievalRanker = async input => { calls.push(input); return { matches: input.sources.slice(-5).map(value => ({ source_id: value.id, score: calls.length })) } }
  const result = await retrieveProjectEvidence(project(sources), bundle([large, small], sources), [large, small], { question: '二次供水' }, ranker)
  expect(result.candidate_counts.eligible_chunks).toBe(1013)
  expect(calls).toHaveLength(3); expect(calls.every(value => value.sources.length <= 1000)).toBe(true)
  expect(calls[0].sources.slice(0, 2).some(value => value.title === 'SMALL.pdf')).toBe(true)
  expect(result.hits.every(hit => hit.score === 3)).toBe(true)
  expect(result.method).toBe('metadata_gated_batched_bm25')
  expect(calls.flatMap(value => value.sources).some(value => value.locator === 'table:1/row:1013')).toBe(true)
})

it('rejects foreign document rows and contradictory source locators even if text and hashes match', () => {
  const document = doc('X'), wrongScope = { ...document, project_id: 'RAG-B' }, sourceValue = source(document)
  const scoped = prepareRetrievalCandidates(project([sourceValue]), bundle([document], [sourceValue]), [wrongScope], { question: '二次供水' })
  expect(scoped.skipped[0].code).toBe('DOCUMENT_SCOPE')
  const wrongSource = { ...sourceValue, id: document.id, locator: 'document:other' }
  const binding = prepareRetrievalCandidates(project([wrongSource]), bundle([document], [wrongSource]), [document], { question: '二次供水' })
  expect(binding.skipped[0].code).toBe('SOURCE_BINDING_REQUIRED')
})

const textMirror = (id: string, extension = 'txt', mirrorText = '二次供水拟改造。'): ParsedDocument => doc(id, '', {
  file_name: `${id}.${extension}`, parser_result: { status: 'extracted', source_hash: `hash-${id}`, text: '二次供水拟改造。',
    segments: [{ locator: 'line:1', text: '二次供水拟改造。' }],
    profile: { tables: [{ rows: [{ rowNumber: 2, values: { Line: 1, Text: mirrorText } }] }] } },
})
const locatedCard = (document: ParsedDocument, locator: string, objectRef: string, stage = 'proposed', status: ExperienceCard['status'] = 'draft') => {
  const value = card(document, stage, status, objectRef)
  value.id = `${value.id}-${locator}`; value.fields[0].evidence[0].locator = locator
  value.knowledge!.chunks![0].spans[0].locator = locator
  return value
}

it('collapses only exact same-document TXT/MD parser mirrors for retrieval while preserving every exported locator', () => {
  for (const extension of ['txt', 'md']) {
    const document = textMirror('MIRROR', extension), sourceValue = source(document), exported = bundle([document], [sourceValue])
    const before = JSON.stringify(exported)
    const result = prepareRetrievalCandidates(project([sourceValue]), exported, [document], { question: '二次供水' })
    expect(exported.documents[0].chunks).toHaveLength(2)
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]).toMatchObject({ locator: 'line:1', text: '二次供水拟改造。', alias_locators: ['table:1/row:2'] })
    expect(result.skipped[0]).toMatchObject({ locator: 'table:1/row:2', code: 'TEXT_PARSE_MIRROR' })
    expect(JSON.stringify(exported)).toBe(before)
  }
})

it('never discards a mirror with an independent approved citation, stage or object scope', () => {
  const document = textMirror('MIRROR'), sourceValue = source(document)
  const rawCard = locatedCard(document, 'line:1', 'building:B1', 'proposed', 'draft')
  const mirrorCard = locatedCard(document, 'table:1/row:2', 'building:B2', 'implemented', 'approved')
  const exported = bundle([document], [sourceValue], [rawCard, mirrorCard])
  const unfiltered = prepareRetrievalCandidates(project([sourceValue]), exported, [document], { question: '二次供水' })
  expect(unfiltered.candidates).toHaveLength(2); expect(unfiltered.skipped).toEqual([])
  expect(unfiltered.candidates[0].objects).toEqual(['building:B1']); expect(unfiltered.candidates[1].objects).toEqual(['building:B2'])
  const filtered = prepareRetrievalCandidates(project([sourceValue]), exported, [document],
    { question: '二次供水', object_ref: 'building:B2', stage: 'implemented', review_status: 'approved' })
  expect(filtered.candidates).toHaveLength(1)
  expect(filtered.candidates[0]).toMatchObject({ locator: 'table:1/row:2', objects: ['building:B2'], review_statuses: ['approved'], alias_locators: [] })
  const onlyMirror = prepareRetrievalCandidates(project([sourceValue]), bundle([document], [sourceValue], [mirrorCard]), [document], { question: '二次供水' })
  expect(onlyMirror.candidates).toHaveLength(2)
})

it('does not deduplicate genuine Excel rows, different texts, files, versions or repeated original line positions', () => {
  const xlsx = textMirror('EXCEL', 'xlsx'), different = textMirror('DIFFERENT', 'txt', '二次供水已实施。')
  const first = textMirror('FIRST'), second = textMirror('SECOND'), sources = [xlsx, different, first, second].map(value => source(value))
  const result = prepareRetrievalCandidates(project(sources), bundle([xlsx, different, first, second], sources), [xlsx, different, first, second], { question: '二次供水' })
  expect(result.candidates.filter(value => value.document_id === 'EXCEL')).toHaveLength(2)
  expect(result.candidates.filter(value => value.document_id === 'DIFFERENT')).toHaveLength(2)
  expect(result.candidates.filter(value => value.document_id === 'FIRST')).toHaveLength(1)
  expect(result.candidates.filter(value => value.document_id === 'SECOND')).toHaveLength(1)
  expect(result.candidates.find(value => value.document_id === 'FIRST')!.id).not.toBe(result.candidates.find(value => value.document_id === 'SECOND')!.id)
  const original = doc('REPEATED', '', { file_name: 'repeated.txt', parser_result: { status: 'extracted', source_hash: 'hash-REPEATED', text: '二次供水拟改造。\n二次供水拟改造。' } })
  const originalSource = source(original)
  const repeated = prepareRetrievalCandidates(project([originalSource]), bundle([original], [originalSource]), [original], { question: '二次供水' })
  expect(repeated.candidates.map(value => value.locator)).toEqual(['line:1', 'line:2'])
  const nextVersion = { ...first, sha256: 'hash-FIRST-new', parser_result: { ...first.parser_result, source_hash: 'hash-FIRST-new' } }, nextSource = source(nextVersion)
  const next = prepareRetrievalCandidates(project([nextSource]), bundle([nextVersion], [nextSource]), [nextVersion], { question: '二次供水' })
  expect(next.candidates[0].id).not.toBe(result.candidates.find(value => value.document_id === 'FIRST')!.id)
})

it('traces the small community wording expansion and sends only that transparent query to the same ranker', async () => {
  const question = '二次供水改造涉及哪些楼栋和户数，哪些楼栋被排除？', document = doc('QUERY'), sourceValue = source(document)
  let received = ''
  const result = await retrieveProjectEvidence(project([sourceValue]), bundle([document], [sourceValue]), [document], { question },
    async (input, query) => { received = query; return { matches: [{ source_id: input.sources[0].id, score: 1 }] } })
  expect(result.question).toBe(question); expect(result.rank_query).toBe(`${question}\n幢 户 不纳入`)
  expect(received).toBe(result.rank_query)
  expect(result.query_expansions.map(value => [value.matched_terms, value.added_term])).toEqual([[['楼栋'], '幢'], [['户数'], '户'], [['排除'], '不纳入']])
  expect(result.query_expansions.every(value => value.reason.length > 0)).toBe(true)
  expect(result.hits[0].text).toBe('二次供水拟改造。')
  expect(expandRetrievalQuery('如何改造道路')).toEqual({ rank_query: '如何改造道路', query_expansions: [] })
  expect(expandRetrievalQuery('楼栋楼幢与住户').query_expansions[0].matched_terms).toEqual(['楼栋', '楼幢'])
})

describe('saved public source text in the same project retrieval', () => {
  const original = (id: string, text: string, patch: Partial<Source> = {}): Source => ({
    id, title: `${id}来源`, visibility: 'public', data_class: 'public', synthetic: false,
    untrusted_text: text, content_status: 'excerpt', hash: `registered-${id}`, locator: `public:${id}`,
    date_status: 'verified', published_at: '2026-09-01', evidence_scope: 'background', ...patch,
  })
  const literalRanker: RetrievalRanker = async (input, query) => ({ matches: input.sources
    .filter(source => source.untrusted_text!.includes(query)).slice(0, 5).map(source => ({ source_id: source.id, score: 1 })) })

  it('retrieves elevator, parking, funds and rebuilding originals when the project has no uploaded files', async () => {
    const sources = [original('LIFT', '电梯托管费用由每台每月600元降至300元。'),
      original('PARK', '停车位安排需要核对权属与周转需求。'), original('FUND', '资金主要用于共有部分维修、更新、改造。'),
      original('REBUILD', '原拆原建试点先核对产权、规划与业主协商条件。')]
    const current = project(sources), exported = bundle([], sources), before = JSON.stringify(current)
    for (const [question, id] of [['电梯', 'LIFT'], ['停车', 'PARK'], ['资金', 'FUND'], ['原拆原建', 'REBUILD']]) {
      const response = await retrieveProjectEvidence(current, exported, [], { question }, literalRanker)
      expect(response.hits).toHaveLength(1)
      expect(response.hits[0]).toMatchObject({ evidence_kind: 'source_text', document_id: id, source: { id },
        version: `registered-${id}`, version_origin: 'registered_hash', content_status: 'excerpt',
        locator: `public:${id}`, measure_links: [], review_statuses: [] })
      expect(response.candidate_counts).toMatchObject({ documents: 0, source_texts: 4, eligible_source_texts: 4 })
      expect(response.hits[0].text).toBe(sources.find(source => source.id === id)!.untrusted_text)
    }
    expect((await retrieveProjectEvidence(current, exported, [], { question: '量子纠缠' }, literalRanker)).hits).toEqual([])
    expect(JSON.stringify(current)).toBe(before)
  })

  it('preserves the actual stored scope, locator and full text; absent hashes use an explicit text snapshot version', () => {
    const text = '邻里中心已有文化康养与助老服务。', value = original('NEIGHBOR', text, {
      hash: undefined, content_status: 'full_text', body_truncated: true, object_refs: ['community:浙大求是社区'],
      evidence_scope: 'area', public_records: [], locator: undefined,
    })
    const prepared = prepareRetrievalCandidates(project([value]), bundle([], [value]), [], { question: '邻里中心' })
    expect(prepared.candidates[0]).toMatchObject({ document_id: 'NEIGHBOR', text, locator: 'source:text',
      version: createHash('sha256').update(text).digest('hex'), version_origin: 'text_sha256',
      content_status: 'excerpt', source: { evidence_scope: 'area', object_refs: ['community:浙大求是社区'], body_truncated: true } })
    expect(prepared.candidates[0].source).not.toHaveProperty('untrusted_text')
    expect(prepared.candidates[0].source).not.toHaveProperty('public_records')
    expect(prepared.candidates[0].match_reasons.join('；')).toContain('正文快照SHA-256')
  })

  it('keeps metadata-only, generated, internal, future and unknown-date sources outside the default eligible corpus', () => {
    const sources = [original('META', '电梯', { content_status: 'metadata_only' }), original('AI', '电梯', { title: 'AI研究草稿' }),
      original('SIM', '电梯', { synthetic: true, data_class: 'synthetic' }),
      original('PRIVATE', '电梯', { visibility: 'internal', data_class: 'internal' }),
      original('FUTURE', '电梯', { published_at: '2027-01-01' }),
      original('UNDATED', '电梯', { date_status: 'undated', published_at: undefined, retrieved_at: '2026-01-01' })]
    const prepared = prepareRetrievalCandidates(project(sources), bundle([], sources), [], { question: '电梯', as_of: '2026-10-14' })
    expect(prepared.candidates).toEqual([])
    expect(prepared.skipped.map(value => value.code)).toEqual(expect.arrayContaining([
      'SOURCE_TEXT_UNAVAILABLE', 'GENERATED_SOURCE_EXCLUDED', 'SOURCE_NOT_PUBLIC', 'SOURCE_AFTER_AS_OF', 'SOURCE_DATE_UNKNOWN',
    ]))
    const ai = prepareRetrievalCandidates(project(sources), bundle([], sources), [], { question: '电梯', include_ai: true, source_kind: 'ai_draft' })
    expect(ai.candidates.map(value => value.source.id)).toEqual(['AI'])
  })

  it('does not let unreviewed source text satisfy citation filters or bypass a failed document-version check', () => {
    const document = doc('STALE-SOURCE'), bound = source(document, { content_status: 'excerpt', untrusted_text: '电梯原文', hash: 'old-hash' })
    const publicText = original('EXTERNAL', '电梯原文')
    const current = project([bound, publicText]), exported = bundle([document], [bound, publicText])
    const prepared = prepareRetrievalCandidates(current, exported, [document], { question: '电梯' })
    expect(prepared.candidates.map(value => value.source.id)).toEqual(['EXTERNAL'])
    for (const filter of [{ measure_key: 'elevator' }, { object_ref: 'building:B1' }, { stage: 'implemented' }, { review_status: 'approved' as const }]) {
      expect(prepareRetrievalCandidates(current, exported, [document], { question: '电梯', ...filter }).candidates).toEqual([])
    }
    expect(prepareRetrievalCandidates(current, { ...exported, project_id: 'RAG-B' }, [], { question: '电梯' }).candidates).toEqual([])
  })

  it('collapses exact same-scope source mirrors but preserves changed body and scope with each source identity', () => {
    const first = original('DIRECT', '资金规则原文', { url: 'https://example.org/original' })
    const mirror = { ...first, id: 'OTHER-PROJECT:ATTACHED:DIRECT' }
    const changed = { ...first, id: 'CHANGED', untrusted_text: '资金规则另一段原文' }
    const differentScope = { ...first, id: 'AREA', evidence_scope: 'area' as const }
    const sources = [mirror, first, changed, differentScope]
    const prepared = prepareRetrievalCandidates(project(sources), bundle([], sources), [], { question: '资金' })
    expect(prepared.candidates).toHaveLength(3)
    expect(prepared.candidates.find(value => value.source.id === 'DIRECT')!.source_aliases).toEqual(['OTHER-PROJECT:ATTACHED:DIRECT'])
    expect(prepared.candidates.map(value => value.source.id)).toEqual(expect.arrayContaining(['CHANGED', 'AREA']))
  })

  it('requires meaningful query overlap in the original body before BM25, never a common question word or filename alone', async () => {
    const document = doc('NAV', '首页 > 联系我们', { file_name: '原拆原建与电梯资料.txt' })
    const values = [source(document), original('LIFT', '电梯托管费用每月300元。'),
      original('REBUILD', '原拆原建试点需要核对产权条件。'), original('UNRELATED', '有哪些人参与活动？需要什么资料？已有案例和服务。')]
    const ranker = vi.fn<RetrievalRanker>(async input => ({ matches: input.sources.slice(0, 5).map(source => ({ source_id: source.id, score: -1 })) }))
    for (const [question, id] of [['加梯有哪些费用？', 'LIFT'], ['原拆原建有哪些案例？', 'REBUILD']]) {
      const response = await retrieveProjectEvidence(project(values), bundle([document], values), [document], { question }, ranker)
      expect(response.hits.map(hit => hit.source.id)).toEqual([id])
      expect(response.candidate_counts.ranked_chunks).toBe(1)
    }
    ranker.mockClear()
    const missing = await retrieveProjectEvidence(project(values), bundle([document], values), [document], { question: '量子纠缠有哪些资料？' }, ranker)
    expect(missing.hits).toEqual([])
    expect(missing.candidate_counts.ranked_chunks).toBe(0)
    expect(ranker).not.toHaveBeenCalled()
  })

  it('keeps explicit household/building counting bridges through the body gate without admitting question-only single characters', async () => {
    const document = doc('COUNTS', '29、30、31、48幢，合计252户。'), value = source(document)
    const ranker = vi.fn<RetrievalRanker>(async input => ({ matches: input.sources.map(source => ({ source_id: source.id, score: 1 })) }))
    for (const [question, unit] of [['住户有多少？', '户'], ['楼栋有多少？', '幢']]) {
      const response = await retrieveProjectEvidence(project([value]), bundle([document], [value]), [document], { question }, ranker)
      expect(response.hits.map(hit => hit.text)).toEqual(['29、30、31、48幢，合计252户。'])
      expect(response.candidate_counts).toMatchObject({ eligible_chunks: 1, ranked_chunks: 1, batches: 1 })
      expect(response.query_expansions).toContainEqual(expect.objectContaining({ added_term: unit }))
    }
    expect(ranker).toHaveBeenCalledTimes(2)
    ranker.mockClear()
    for (const question of ['有什么？', '有哪些？']) {
      const response = await retrieveProjectEvidence(project([value]), bundle([document], [value]), [document], { question }, ranker)
      expect(response.hits).toEqual([])
      expect(response.query_expansions).toEqual([])
    }
    expect(ranker).not.toHaveBeenCalled()
  })

  it('expands colloquial cost, senior activity and parking questions into transparent lexical groups', async () => {
    const ranker = vi.fn<RetrievalRanker>(async input => ({ matches: input.sources.map(source => ({ source_id: source.id, score: 1 })) }))
    const cases = [
      { question: '改造大概要花多少钱？', words: ['费用', '投资', '预算'] },
      { question: '老人平时去哪活动？', words: ['养老', '老年', '社区服务', '邻里'] },
      { question: '停车难有哪些办法？', words: ['停车', '车位', '泊位'] },
    ]
    for (const row of cases) {
      const sources = row.words.map((word, index) => original(`TERM-${index}`, `${word}原文记录。`))
      const before = JSON.stringify(sources)
      const response = await retrieveProjectEvidence(project(sources), bundle([], sources), [], { question: row.question }, ranker)
      expect(response.hits.map(hit => hit.source.id).sort()).toEqual(sources.map(source => source.id).sort())
      expect(response.question).toBe(row.question)
      expect(response.query_expansions).toContainEqual(expect.objectContaining({ added_term: row.words.join(' ') }))
      expect(response.hits.every(hit => sources.some(source => source.untrusted_text === hit.text))).toBe(true)
      expect(ranker.mock.calls.at(-1)![1]).toBe(response.rank_query)
      expect(JSON.stringify(sources)).toBe(before)
    }
  })
})
