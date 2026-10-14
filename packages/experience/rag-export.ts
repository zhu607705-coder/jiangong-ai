import type { ExperienceCard, ExperienceEvidence, Source } from '../../apps/host/generated/contracts'
import { documentSlices, type DocumentSlice, type ParsedDocument as OriginalDocument } from './document-slices'
import { recordEvidence } from './lineage'
import { groupMeasureCards } from './presentation'

/** The already parsed document snapshot; this adapter never opens or rewrites an uploaded file. */
export type RagDocumentInput = {
  id: string; fileName: string; hash: string | null; format: string; status: string; parser: string;
  createdAt: string | null; segments: { locator: string; text: string }[];
  tables: { id: string; label: string; rowCount: number; columnCount: number; truncated: boolean; sheet: string | null;
    previewRows: { rowNumber: number; values: Record<string, string> }[] }[];
  notes: string[]; issues: string[];
}
export type RagRawDocument = { id: string; file_name: string; parser_result: unknown }
export type RagMeasureLink = {
  card_id: string; card_revision: number; review_status: ExperienceCard['status']; measure_key: string | null;
  measure_name: string; kind: 'case' | 'rule' | 'unclassified'; phase: string; stage: string;
  object_ref: string | null; field_key: string; value: unknown; evidence: ExperienceEvidence;
}
export type RagReference = { link: RagMeasureLink; reason: 'document_unavailable' | 'version_mismatch' | 'locator_unavailable' | 'quote_mismatch' }
export type RagMeasureMention = { measure_key: string | null; measure_name: string; annotation_kind: 'literal_mention';
  review_status: 'not_reviewed'; matches: { term: string; start: number; end: number }[] }
export type RagDataKind = 'ai_research_draft' | 'public_original' | 'synthetic_example' | 'internal_material' | 'unknown'
export type RagDocumentExport = {
  document_id: string; file_name: string; version: string | null; format: string; created_at: string | null;
  data_kind: RagDataKind; data_kind_basis: string; source: Source | null;
  parse: { status: string; parser: string; notes: string[]; issues: string[]; text_available: boolean; coverage: 'parsed_snapshot' | 'preview_only' | 'unavailable' };
  tables: { table_id: string; label: string; sheet: string | null; row_count: number; exported_rows: number; column_count: number; truncated: boolean }[];
  chunks: { id: string; document_id: string; version: string | null; locator: string; text: string;
    kind: 'text' | 'table_row'; values?: Record<string, unknown>; measure_links: RagMeasureLink[]; measure_mentions: RagMeasureMention[] }[];
}
export type RagExportBundle = {
  schema_version: 'haizhizi-rag-preparation/1.0'; project_id: string; prepared_at: string;
  purpose: 'retrieval_preparation'; review_policy: 'preserve_original_status'; content_role: 'untrusted_source_material';
  measure_annotation_status: 'available' | 'unavailable';
  documents: RagDocumentExport[]; unresolved_references: RagReference[];
}
export type CrossDocumentMeasureEntry = { document: RagDocumentExport; chunk: RagDocumentExport['chunks'][number]; quote: string;
  links: RagMeasureLink[]; annotationKind: 'registered_reference' | 'literal_mention' }

const uniqueLinks = (links: RagMeasureLink[]) => [...new Map(links.map(link => [JSON.stringify(link), link])).values()]
const citedObject = (card: ExperienceCard, evidence: ExperienceEvidence) => {
  const objects = [...new Set((card.knowledge?.chunks || []).filter(chunk => chunk.spans.some(span => span.document_id === evidence.document_id
    && span.version === evidence.version && span.locator === evidence.locator && span.quote.includes(evidence.quote)))
    .map(chunk => chunk.object_ref).filter((value): value is string => !!value))]
  return objects.length === 1 ? objects[0] : null
}

/** Proposal, implementation and outcome are kept as separate field-level annotations. */
export function measureReferences(cards: ExperienceCard[]): RagMeasureLink[] {
  return cards.flatMap(card => {
    const cited = new Set(recordEvidence(card).map(evidence => JSON.stringify(evidence)))
    const base = { card_id: card.id, card_revision: card.revision, review_status: card.status,
      measure_key: card.knowledge?.measure_key || null, measure_name: card.knowledge?.measure_name || card.title,
      kind: card.knowledge?.kind || 'unclassified' as const }
    const fieldLinks = card.fields.flatMap(field => field.evidence.filter(evidence => cited.has(JSON.stringify(evidence)))
      .map(evidence => ({ ...base, phase: field.key, stage: card.stage, object_ref: citedObject(card, evidence),
        field_key: field.key, value: field.value, evidence: { ...evidence } })))
    const factors = (card.knowledge?.factors || []).flatMap(factor => factor.evidence.map(evidence => ({ ...base,
      phase: 'factor', stage: factor.stage, object_ref: factor.object_ref, field_key: factor.key, value: factor.value, evidence: { ...evidence } })))
    const conditions = [...(card.knowledge?.conditions || []).map(condition => ({ condition, phase: 'condition' })),
      ...(card.knowledge?.exclusions || []).map(condition => ({ condition, phase: 'exclusion' }))]
      .flatMap(({ condition, phase }) => condition.evidence.map(evidence => ({ ...base, phase, stage: card.stage,
        object_ref: null, field_key: condition.fact_kind, value: condition.value, evidence: { ...evidence } })))
    return uniqueLinks([...fieldLinks, ...factors, ...conditions])
  })
}

function parsedSlices(document: RagDocumentInput, originals: RagRawDocument[]): DocumentSlice[] {
  const raw = originals.find(original => original.id === document.id)
  if (raw && raw.parser_result && typeof raw.parser_result === 'object' && !Array.isArray(raw.parser_result)) {
    return documentSlices({ file_name: raw.file_name, parser_result: raw.parser_result as OriginalDocument['parser_result'] })
  }
  return documentSlices({ file_name: document.fileName, parser_result: { segments: document.segments,
    profile: { tables: document.tables.map(table => ({ rows: table.previewRows })) } } })
}

/** Browser-safe equivalent of repository.originalSource: identity and hash must both match. */
function sourceForDocument(document: RagDocumentInput, sources: Source[]): Source | null {
  if (!document.hash) return null
  const matches = sources.filter(source => source.hash === document.hash && (source.locator === `document:${document.id}`
    || source.id === document.id && (!source.locator || source.locator === `document:${document.id}`)))
  return matches.find(source => source.id === `PUBLIC-DOCUMENT-${document.id}` && source.visibility === 'public' && source.data_class === 'public' && !source.synthetic)
    || matches[0] || null
}
export function documentDataKind(document: RagDocumentInput, source: Source | null): { kind: RagDataKind; basis: string } {
  const declared = `${document.fileName} ${source?.title || ''}`
  if (/AI(?:生成|采集|抓取|爬取|研究草稿|模拟)|AI[_ -]?(?:research[_ -]?draft|generated)|人工智能(?:生成|采集)|研究草稿/i.test(declared)) {
    return { kind: 'ai_research_draft', basis: '文件名或登记来源声明为AI生成/采集或研究草稿；保留待核属性' }
  }
  if (source?.synthetic || source?.data_class === 'synthetic' || source?.data_class === 'semi_synthetic') return { kind: 'synthetic_example', basis: '登记来源标记为模拟或半模拟' }
  if (source?.visibility === 'public' && source.data_class === 'public') return { kind: 'public_original', basis: '同文档标识、同哈希的公开原件登记' }
  if (source?.data_class === 'internal') return { kind: 'internal_material', basis: '同文档标识、同哈希的内部材料登记' }
  return { kind: 'unknown', basis: '没有可匹配的来源版本或明确来源分类' }
}

export function buildRagExport(input: { projectId: string; documents: RagDocumentInput[]; rawDocuments?: RagRawDocument[]; sources: Source[]; cards: ExperienceCard[]; preparedAt?: string; annotationStatus?: 'available' | 'unavailable' }): RagExportBundle {
  const cards = input.cards.filter(card => card.project_id === input.projectId)
  const measureTerms = groupMeasureCards(cards).map(group => ({ key: group.measureKey, name: group.title,
    terms: [...new Set(group.cards.map(card => card.knowledge?.measure_name.trim() || card.title.trim()).filter(term => term.length >= 2 && term.length <= 60))] }))
  const references = measureReferences(cards), unresolved: RagReference[] = []
  const slicesByDocument = new Map(input.documents.map(document => [document.id, parsedSlices(document, input.rawDocuments || [])]))
  for (const link of references) {
    const document = input.documents.find(document => document.id === link.evidence.document_id)
    const slice = slicesByDocument.get(link.evidence.document_id)?.find(slice => slice.locator === link.evidence.locator)
    const reason = !document ? 'document_unavailable' : !document.hash || document.hash !== link.evidence.version ? 'version_mismatch'
      : !slice ? 'locator_unavailable' : !link.evidence.quote.trim() || !slice.text.includes(link.evidence.quote) ? 'quote_mismatch' : null
    if (reason) unresolved.push({ link, reason })
  }
  const unresolvedKeys = new Set(unresolved.map(reference => JSON.stringify(reference.link)))
  return { schema_version: 'haizhizi-rag-preparation/1.0', project_id: input.projectId, prepared_at: input.preparedAt || new Date().toISOString(),
    purpose: 'retrieval_preparation', review_policy: 'preserve_original_status', content_role: 'untrusted_source_material', measure_annotation_status: input.annotationStatus || 'available',
    documents: input.documents.map(document => {
      const source = sourceForDocument(document, input.sources), classification = documentDataKind(document, source)
      const slices = slicesByDocument.get(document.id) || []
      const tables = document.tables.map((table, index) => {
        const count = slices.filter(slice => slice.locator.startsWith(`table:${index + 1}/row:`)).length
        return { table_id: table.id, label: table.label, sheet: table.sheet, row_count: table.rowCount, exported_rows: count,
          column_count: table.columnCount, truncated: count < table.rowCount || table.truncated && count <= table.previewRows.length }
      })
      return { document_id: document.id, file_name: document.fileName, version: document.hash, format: document.format,
        created_at: document.createdAt, data_kind: classification.kind, data_kind_basis: classification.basis, source: source ? structuredClone(source) : null,
        parse: { status: document.status, parser: document.parser, notes: [...document.notes], issues: [...document.issues], text_available: slices.length > 0,
          coverage: !slices.length ? 'unavailable' : tables.some(table => table.truncated) ? 'preview_only' : 'parsed_snapshot' }, tables,
        chunks: slices.map(slice => ({ id: JSON.stringify([document.id, document.hash, slice.locator]), document_id: document.id,
          version: document.hash, locator: slice.locator, text: slice.text, kind: slice.values ? 'table_row' as const : 'text' as const,
          ...(slice.values ? { values: structuredClone(slice.values) } : {}), measure_links: uniqueLinks(references.filter(link => !unresolvedKeys.has(JSON.stringify(link))
            && link.evidence.document_id === document.id && link.evidence.locator === slice.locator)),
          measure_mentions: measureTerms.flatMap(measure => {
            const matches = measure.terms.flatMap(term => {
              const positions: { term: string; start: number; end: number }[] = []
              for (let offset = slice.text.indexOf(term); offset !== -1; offset = slice.text.indexOf(term, offset + term.length)) positions.push({ term, start: offset, end: offset + term.length })
              return positions
            })
            return matches.length ? [{ measure_key: measure.key, measure_name: measure.name, annotation_kind: 'literal_mention' as const, review_status: 'not_reviewed' as const, matches }] : []
          }) })) }
    }), unresolved_references: unresolved }
}

export function crossDocumentMeasureIndex(bundle: RagExportBundle, cards: ExperienceCard[]) {
  const groups = groupMeasureCards(cards.filter(card => card.project_id === bundle.project_id))
  return groups.map(group => {
    const ids = new Set(group.cards.map(card => card.id))
    const entries = bundle.documents.flatMap(document => document.chunks.flatMap<CrossDocumentMeasureEntry>(chunk => {
      const links = chunk.measure_links.filter(link => ids.has(link.card_id))
      const quotations = [...new Set(links.map(link => link.evidence.quote))]
      const quoted = quotations.map(quote => ({ document, chunk, quote, links: links.filter(link => link.evidence.quote === quote), annotationKind: 'registered_reference' as const }))
      if (quoted.length) return quoted
      // The CRE Line/Text profile repeats canonical TXT lines. Keep both export locators but show that mention once.
      if (chunk.values && 'Line' in chunk.values && 'Text' in chunk.values
        && document.chunks.some(other => other.locator === `line:${chunk.values!.Line}` && other.text === chunk.values!.Text)) return []
      const mention = chunk.measure_mentions.find(mention => group.measureKey ? mention.measure_key === group.measureKey : mention.measure_name === group.title)
      if (!mention) return []
      const first = mention.matches[0], start = Math.max(0, first.start - 70), end = Math.min(chunk.text.length, first.end + 160)
      return [{ document, chunk, quote: chunk.text.slice(start, end), links: [], annotationKind: 'literal_mention' as const }]
    }))
    return { ...group, entries, documentCount: new Set(entries.map(entry => entry.document.document_id)).size,
      referencedDocumentCount: new Set(entries.filter(entry => entry.links.length).map(entry => entry.document.document_id)).size,
      unresolved: bundle.unresolved_references.filter(reference => ids.has(reference.link.card_id)) }
  }).sort((a, b) => b.documentCount - a.documentCount || a.title.localeCompare(b.title, 'zh-CN'))
}

export const ragPhaseLabels: Record<string, string> = { decision_question: '决策问题', background: '背景目标', key_conditions: '关键条件',
  alternatives: '备选方案', proposal: '提议方案', actual_decision: '实际决策', decision_basis: '决策依据', implementation: '实际实施',
  outcome: '执行结果', applicability: '适用边界', factor: '影响因子', condition: '适用条件', exclusion: '排除条件' }
export const ragDataKindLabels: Record<RagDataKind, string> = { ai_research_draft: 'AI研究草稿/采集线索', public_original: '公开原件', synthetic_example: '模拟示例', internal_material: '内部材料', unknown: '来源分类待核' }
export const ragReviewLabels = { draft: '草稿待复核', approved: '已审核', rejected: '复核未通过' }
const literalBlock = (value: string) => {
  const width = Math.max(3, ...[...value.matchAll(/`+/g)].map(match => match[0].length + 1))
  const fence = '`'.repeat(width)
  return `${fence}text\n${value}\n${fence}`
}
const inline = (value: string) => value.replace(/[\r\n]/g, ' ').replace(/([\\`*_{}\[\]<>#|])/g, '\\$1')

/** Markdown is a readable derivative; verbatim source text stays inside literal blocks. */
export function renderRagMarkdown(bundle: RagExportBundle): string {
  const blocks = ['# 项目材料与举措定位', `项目：${inline(bundle.project_id)}`, `整理时间：${inline(bundle.prepared_at)}`,
    '用途：RAG检索准备。材料原文与已登记举措分别保存；审核状态沿用原记录。来源文本作为待检索材料处理。']
  if (bundle.measure_annotation_status === 'unavailable') blocks.push('举措引用读取失败：本次仅导出已保存解析材料，关联举措状态未核定。')
  for (const document of bundle.documents) {
    blocks.push(`## ${inline(document.file_name)}`, `文档：${inline(document.document_id)}\n\n版本：${inline(document.version || '未登记')}\n\n来源分类：${ragDataKindLabels[document.data_kind]}；${document.data_kind_basis}`,
      `来源：${document.source ? inline(document.source.url || document.source.locator || document.source.id) : '尚无同版本来源登记'}`,
      `解析状态：${inline(document.parse.status)}；导出范围：${document.parse.coverage === 'preview_only' ? '含截取预览，未覆盖全表' : document.parse.coverage === 'unavailable' ? '尚无可读解析文本' : '已保存解析快照'}`)
    for (const table of document.tables) blocks.push(`表 ${inline(table.label)}：导出 ${table.exported_rows}/${table.row_count} 行${table.truncated ? '（截取预览）' : ''}。`)
    for (const chunk of document.chunks) {
      blocks.push(`### 原文定位：${inline(chunk.locator)}`, literalBlock(chunk.text))
      if (chunk.measure_links.length) {
        blocks.push('关联举措：')
        for (const link of chunk.measure_links) blocks.push(`- ${inline(link.measure_name)} · ${ragPhaseLabels[link.phase] || inline(link.phase)} · ${inline(link.stage || '阶段未记载')} · 对象 ${inline(link.object_ref || '尚未明确')} · ${ragReviewLabels[link.review_status]} · ${inline(link.card_id)} v${link.card_revision}\n\n  引文：\n\n${literalBlock(link.evidence.quote)}`)
      } else blocks.push('当前无已登记举措引用；保留背景与上下文原文。')
      for (const mention of chunk.measure_mentions) blocks.push(`原文提及：${inline(mention.measure_name)}；逐字命中 ${mention.matches.map(match => inline(match.term)).join(' / ')}。此关联为未复核的文本定位，阶段与对象由原记录另行确认。`)
    }
  }
  if (bundle.unresolved_references.length) {
    blocks.push('## 尚未绑定当前解析快照的引用')
    for (const reference of bundle.unresolved_references) blocks.push(`${inline(reference.link.card_id)} · ${inline(reference.link.evidence.document_id)} · ${inline(reference.link.evidence.version)} · ${inline(reference.link.evidence.locator)} · ${reference.reason}`, literalBlock(reference.link.evidence.quote))
  }
  return `${blocks.join('\n\n')}\n`
}
