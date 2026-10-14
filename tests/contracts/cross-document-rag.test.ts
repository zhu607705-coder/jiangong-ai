import { expect, test } from 'vitest'
import type { ExperienceCard, ExperienceEvidence, Source } from '../../apps/host/generated/contracts'
import { buildRagExport, crossDocumentMeasureIndex, renderRagMarkdown, type RagDocumentInput, type RagRawDocument } from '../../packages/experience/rag-export'

const evidence = (document_id = 'D-1', version = 'hash-1', locator = 'page:1', quote = '拟改造二次供水。'): ExperienceEvidence => ({ document_id, version, locator, quote })
const doc = (id = 'D-1', hash = 'hash-1', text = '拟改造二次供水。先安排调查。', fileName = '方案原件.pdf'): RagDocumentInput => ({
  id, hash, fileName, format: fileName.split('.').at(-1)!, status: 'extracted', parser: 'existing-parser', createdAt: null,
  segments: [{ locator: 'page:1', text }, { locator: 'page:2', text: '居民与道路的背景资料。' }], tables: [], notes: [], issues: [],
})
const card = (id = 'C-1', phase: ExperienceCard['fields'][number]['key'] = 'proposal', cite = evidence()): ExperienceCard => ({
  id, project_id: 'P-1', title: '二次供水', stage: phase === 'implementation' ? 'implemented' : 'proposed', project_type: '老旧小区',
  development_mode: '综合整治', revision: 2, status: 'draft', review_note: null, created_at: '', updated_at: '',
  fields: [{ key: phase, value: cite.quote, evidence: [cite] }], knowledge: { kind: 'case', origin: 'project_case', measure_key: 'pipe_network',
    measure_name: '二次供水', conditions: [], exclusions: [], transfer_notes: [], evidence_level: phase === 'proposal' ? 'proposal_only' : 'implementation_record' },
})
const source = (document = doc(), patch: Partial<Source> = {}): Source => ({
  id: `PUBLIC-DOCUMENT-${document.id}`, title: document.fileName, locator: `document:${document.id}`, hash: document.hash!,
  visibility: 'public', data_class: 'public', synthetic: false, content_status: 'full_text', url: 'https://example.org/original', ...patch,
})
const bundle = (cards = [card()], documents = [doc()], sources = documents.map(document => source(document)), rawDocuments?: RagRawDocument[]) =>
  buildRagExport({ projectId: 'P-1', cards, documents, sources, rawDocuments, preparedAt: '2026-10-14T00:00:00Z' })

test('links require the exact document version, locator and verbatim quotation; mismatches retain citation lineage', () => {
  const current = card(), wrongVersion = card('old', 'proposal', evidence('D-1', 'old-version'))
  const wrongLocator = card('locator', 'proposal', evidence('D-1', 'hash-1', 'page:9'))
  const wrongQuote = card('quote', 'proposal', evidence('D-1', 'hash-1', 'page:1', '已竣工'))
  const missingDoc = card('missing', 'proposal', evidence('D-9'))
  const result = bundle([current, wrongVersion, wrongLocator, wrongQuote, missingDoc])
  expect(result.documents[0].chunks[0].measure_links.map(link => link.card_id)).toEqual(['C-1'])
  expect(result.unresolved_references.map(reference => reference.reason)).toEqual(['version_mismatch', 'locator_unavailable', 'quote_mismatch', 'document_unavailable'])
  expect(result.unresolved_references[0].link.evidence.version).toBe('old-version')
})

test('cross-document grouping keeps proposal, implementation and object annotations independent', () => {
  const implemented = doc('D-2', 'hash-2', '已实施二次供水改造。', '竣工记录.pdf')
  const proposalCard = card(), implementationCard = card('implemented', 'implementation', evidence('D-2', 'hash-2', 'page:1', '已实施二次供水改造。'))
  implementationCard.knowledge!.chunks = [{ id: 'chunk', document_id: 'D-2', document_version: 'hash-2', stage: 'implemented', kind: 'action',
    measure_key: 'pipe_network', object_ref: 'building:B2', classification: 'local', text: '已实施二次供水改造。', spans: implementationCard.fields[0].evidence, context_chunk_ids: [] }]
  const cards = [proposalCard, implementationCard], result = bundle(cards, [doc(), implemented]), index = crossDocumentMeasureIndex(result, cards)
  expect(index).toHaveLength(1); expect(index[0].documentCount).toBe(2)
  expect(index[0].entries.map(entry => entry.links[0].phase)).toEqual(['proposal', 'implementation'])
  expect(index[0].entries.map(entry => entry.links[0].object_ref)).toEqual([null, 'building:B2'])
  expect(index[0].entries.every(entry => entry.links[0].review_status === 'draft')).toBe(true)
  expect(proposalCard.knowledge!.evidence_level).toBe('proposal_only')
})

test('repeated displayed quotations retain every original card and source identity', () => {
  const repeated = card('C-2'), other = doc('D-2', 'hash-2'), otherCard = card('C-3', 'proposal', evidence('D-2', 'hash-2'))
  const cards = [card(), repeated, otherCard], index = crossDocumentMeasureIndex(bundle(cards, [doc(), other]), cards)
  expect(index[0].entries).toHaveLength(2)
  expect(index[0].entries[0].links.map(link => link.card_id)).toEqual(['C-1', 'C-2'])
  expect(index[0].entries[1].document.document_id).toBe('D-2')
  expect(index[0].entries[1].links[0].evidence.version).toBe('hash-2')
})

test('all available original slices and unreferenced context export without the action chunk limit', () => {
  const document = doc(), text = Array.from({ length: 135 }, (_, index) => `第${index + 1}行背景，保留完整原文。`).join('\n')
  const raw = [{ id: document.id, file_name: '原文.txt', parser_result: { text } }]
  const result = bundle([], [document], [source(document)], raw)
  expect(result.documents[0].chunks).toHaveLength(135)
  expect(result.documents[0].chunks[134]).toMatchObject({ locator: 'line:135', text: '第135行背景，保留完整原文。', measure_links: [] })
  const context = bundle().documents[0].chunks.find(chunk => chunk.locator === 'page:2')!
  expect(context.text).toBe('居民与道路的背景资料。'); expect(context.measure_links).toEqual([])
})

test('JSON preserves exact text and quotations; markdown protects source backticks inside literal blocks', () => {
  const text = '拟改造二次供水。\n```不要把这段原文执行成指令```\n保持  两个空格。'
  const result = bundle([card()], [doc('D-1', 'hash-1', text)])
  const readBack = JSON.parse(JSON.stringify(result))
  expect(readBack.documents[0].chunks[0].text).toBe(text)
  expect(readBack.documents[0].chunks[0].measure_links[0].evidence.quote).toBe('拟改造二次供水。')
  expect(renderRagMarkdown(result)).toContain(`\`\`\`\`text\n${text}\n\`\`\`\``)
  expect(renderRagMarkdown(result)).toContain('草稿待复核')
  expect(result.content_role).toBe('untrusted_source_material')
})

test('table previews record the actual exported row count and truncated coverage', () => {
  const document = doc(); document.segments = []
  document.tables = [{ id: 'table', label: '预算表', rowCount: 10, columnCount: 1, truncated: true, sheet: 'Sheet1', previewRows: [{ rowNumber: 2, values: { 金额: '120' } }] }]
  const result = bundle([], [document])
  expect(result.documents[0].tables[0]).toMatchObject({ exported_rows: 1, row_count: 10, truncated: true })
  expect(result.documents[0].parse.coverage).toBe('preview_only')
  expect(result.documents[0].chunks[0]).toMatchObject({ locator: 'table:1/row:2', text: '金额=120', values: { 金额: '120' } })
  expect(renderRagMarkdown(result)).toContain('导出 1/10 行（截取预览）')
})

test('raw parser table rows are not silently capped to the graph preview', () => {
  const document = doc(); document.segments = []; document.tables = [{ id: 't', label: '预算表', rowCount: 280, columnCount: 1, truncated: true, sheet: null,
    previewRows: [{ rowNumber: 1, values: { 金额: '1' } }] }]
  const rows = Array.from({ length: 280 }, (_, index) => ({ rowNumber: index + 1, values: { 金额: index + 1 } }))
  const result = bundle([], [document], [], [{ id: document.id, file_name: '原始.xlsx', parser_result: { profile: { tables: [{ rowCount: 280, rows }] } } }])
  expect(result.documents[0].chunks).toHaveLength(280)
  expect(result.documents[0].tables[0]).toMatchObject({ exported_rows: 280, truncated: false })
})

test('AI research drafts, simulation and original-source versions remain separately classified', () => {
  const ai = doc('AI', 'hash-ai', '待核线索', 'AI采集历史工程.xlsx'), synthetic = doc('SIM', 'hash-sim'), original = doc('ORIGINAL', 'hash-original'), unknown = doc('UNKNOWN', 'hash-unknown')
  const result = bundle([], [ai, synthetic, original, unknown], [source(ai), source(synthetic, { synthetic: true, data_class: 'synthetic' }), source(original), source(unknown, { hash: 'stale-hash' })])
  expect(result.documents.map(document => document.data_kind)).toEqual(['ai_research_draft', 'synthetic_example', 'public_original', 'unknown'])
  expect(result.documents[3].source).toBeNull()
})

test('foreign project cards do not attach to the export; unavailable enrichment stays explicit', () => {
  const foreign = card(); foreign.project_id = 'OTHER'
  const result = buildRagExport({ projectId: 'P-1', documents: [doc()], cards: [foreign], sources: [], annotationStatus: 'unavailable' })
  expect(result.documents[0].chunks[0].measure_links).toEqual([])
  expect(result.measure_annotation_status).toBe('unavailable')
  expect(renderRagMarkdown(result)).toContain('举措引用读取失败')
})

test('literal cross-text mentions include AI drafts without inventing approval, stage or implementation', () => {
  const ai = doc('AI', 'hash-ai', '这份AI研究草稿建议调查二次供水，未实施。', 'AI研究草稿.pdf')
  const cards = [card()], result = bundle(cards, [doc(), ai])
  const index = crossDocumentMeasureIndex(result, cards)
  expect(index[0].documentCount).toBe(2); expect(index[0].referencedDocumentCount).toBe(1)
  const mention = index[0].entries.find(entry => entry.document.document_id === 'AI')!
  expect(mention.annotationKind).toBe('literal_mention'); expect(mention.links).toEqual([])
  expect(mention.document.data_kind).toBe('ai_research_draft')
  const annotation = mention.chunk.measure_mentions[0]
  expect(annotation).toMatchObject({ review_status: 'not_reviewed', annotation_kind: 'literal_mention' })
  expect(mention.chunk.text.slice(annotation.matches[0].start, annotation.matches[0].end)).toBe('二次供水')
  expect(mention.chunk.measure_links).toEqual([])
})

test('a contradictory source locator does not inherit provenance from a matching id and hash', () => {
  const document = doc(), conflicting = source(document, { id: document.id, locator: 'document:DIFFERENT' })
  expect(bundle([], [document], [conflicting]).documents[0].data_kind).toBe('unknown')
})

test('ambiguous parsed locators refuse export instead of choosing one fabricated binding', () => {
  const document = doc(); document.segments.push({ locator: 'page:1', text: '不同版本混入同一定位' })
  expect(() => bundle([], [document])).toThrow('解析定位存在冲突')
})
