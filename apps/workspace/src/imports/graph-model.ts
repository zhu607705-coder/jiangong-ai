import type { Fact, PublicRecord, Source } from '../../../host/generated/contracts'

export type ImportDocument = {
  id: string
  file_name: string
  created_at?: string
  parser_result: unknown
}

export type ParsedRow = { rowNumber: number; values: Record<string, string> }
export type ParsedColumn = {
  name: string
  valueType: string | null
  fillRate: number | null
  missingCount: number | null
  uniqueCount: number | null
  examples: string[]
  quality: 'parsed' | 'estimated' | 'preview' | 'unavailable'
}
export type ParsedTable = {
  id: string
  label: string
  kind: 'table' | 'text_lines'
  rowCount: number
  columnCount: number
  previewRows: ParsedRow[]
  columns: ParsedColumn[]
  truncated: boolean
  sheet: string | null
}
export type ParsedSegment = { locator: string; text: string }
export type ParsedDocument = {
  id: string
  fileName: string
  format: string
  status: string
  parser: string
  hash: string | null
  createdAt: string | null
  tables: ParsedTable[]
  segments: ParsedSegment[]
  notes: string[]
  issues: string[]
}

export type GraphDepth = 'map' | 'read' | 'full'
export type GraphScope = 'imports' | 'all'
export type GraphNodeKind = 'project' | 'document' | 'source' | 'table' | 'text_lines' | 'column' | 'segment' | 'fact' | 'record'
export type GraphNode = {
  id: string
  kind: GraphNodeKind
  label: string
  subtitle: string
  parentId: string | null
  level: 0 | 1 | 2 | 3
  relation: string
  documentId?: string
  sourceId?: string
  tableIndex?: number
  columnIndex?: number
  segmentIndex?: number
  factId?: string
  recordId?: string
}
export type GraphEdge = { id: string; from: string; to: string; relation: string }
export type GraphStats = {
  importedFiles: number
  linkedSources: number
  tables: number
  textLines: number
  parsedRows: number
  previewRows: number
  columns: number
  originalRowRecords: number
  otherFacts: number
  ocrRequired: number
  truncatedTables: number
  formats: Record<string, number>
}
export type ImportGraph = {
  nodes: GraphNode[]
  edges: GraphEdge[]
  documents: ParsedDocument[]
  sources: Source[]
  facts: Fact[]
  stats: GraphStats
  hiddenSources: number
  hiddenDetails: number
}

const object = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
const text = (value: unknown, fallback = ''): string => typeof value === 'string' ? value : fallback
const count = (value: unknown, fallback = 0): number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : fallback
const rate = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1 ? value : null
const strings = (value: unknown, limit = 20): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(0, limit) : []

function parsedRows(value: unknown): ParsedRow[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, 250).flatMap(candidate => {
    const row = object(candidate), rawValues = object(row?.values)
    if (!row || !rawValues || !Number.isSafeInteger(row.rowNumber) || Number(row.rowNumber) < 1) return []
    const values = Object.fromEntries(Object.entries(rawValues).map(([key, cell]) => [key, cell == null ? '' : String(cell)]))
    return [{ rowNumber: Number(row.rowNumber), values }]
  })
}

function parsedTable(candidate: unknown, documentId: string, index: number): ParsedTable | null {
  const raw = object(candidate)
  if (!raw) return null
  const rows = parsedRows(raw.rows)
  const rawColumns = Array.isArray(raw.columns) ? raw.columns : []
  const columnEntries = rawColumns.length ? rawColumns : Object.keys(rows[0]?.values || {})
  const totalRows = count(raw.rowCount, rows.length)
  const truncated = raw.truncated === true || totalRows > rows.length
  const columns = columnEntries.slice(0, 100).flatMap(entry => {
    const profile = object(entry)
    const name = typeof entry === 'string' ? entry : text(profile?.name)
    if (!name) return []
    const previewFilled = rows.filter(row => (row.values[name] || '').trim()).length
    const providedRate = rate(profile?.fillRate)
    const quality: ParsedColumn['quality'] = providedRate !== null ? truncated ? 'estimated' : 'parsed' : rows.length ? 'preview' : 'unavailable'
    return [{ name, valueType: profile ? text(profile.valueType) || null : null,
      fillRate: providedRate ?? (rows.length ? previewFilled / rows.length : null),
      missingCount: profile && Number.isSafeInteger(profile.missingCount) ? count(profile.missingCount) : rows.length ? rows.length - previewFilled : null,
      uniqueCount: profile && Number.isSafeInteger(profile.uniqueCount) ? count(profile.uniqueCount) : null,
      examples: strings(profile?.examples, 5), quality }]
  })
  return { id: text(raw.tableId, `${documentId}-T${index + 1}`), label: text(raw.label, `表 ${index + 1}`), kind: 'table',
    rowCount: totalRows, columnCount: count(raw.columnCount, columns.length), previewRows: rows,
    columns, truncated, sheet: text(object(raw.source)?.sheet) || null }
}

export function normalizeImportDocument(row: ImportDocument): ParsedDocument {
  const parsed = object(row.parser_result) || {}, profile = object(parsed.profile) || {}
  const format = row.file_name.split('.').at(-1)?.toLowerCase() || 'file'
  const tables = (Array.isArray(profile.tables) ? profile.tables : []).slice(0, 50)
    .flatMap((candidate, index) => parsedTable(candidate, row.id, index) || [])
    .map(table => ({ ...table, kind: format === 'txt' || format === 'md' ? 'text_lines' as const : 'table' as const }))
  const segments = (Array.isArray(parsed.segments) ? parsed.segments : []).slice(0, 1000).flatMap(candidate => {
    const segment = object(candidate), locator = text(segment?.locator)
    return locator ? [{ locator, text: text(segment?.text) }] : []
  })
  return { id: row.id, fileName: row.file_name, format, status: text(parsed.status, 'unknown'),
    parser: text(parsed.parser, '未标注解析器'), hash: text(parsed.source_hash) || null,
    createdAt: text(row.created_at) || null, tables, segments,
    notes: strings(parsed.notes, 20), issues: strings(profile.issues, 20) }
}

function mergedSources(projectSources: Source[], researchSources: Source[]): Source[] {
  // Current project input owns its upload/source version; finished-run sources add
  // public research context but cannot overwrite newer project records.
  return [...new Map([...researchSources, ...projectSources].map(source => [source.id, source])).values()]
}

export function buildImportGraph(input: {
  projectId: string
  projectName: string
  projectSources: Source[]
  researchSources?: Source[]
  facts: Fact[]
  documents: ImportDocument[]
  depth: GraphDepth
  scope: GraphScope
  query?: string
}): ImportGraph {
  const documents = input.documents.map(normalizeImportDocument)
  const sources = mergedSources(input.projectSources, input.researchSources || [])
  const stats: GraphStats = {
    importedFiles: documents.length, linkedSources: sources.length,
    tables: documents.reduce((sum, doc) => sum + doc.tables.filter(table => table.kind === 'table').length, 0),
    textLines: documents.reduce((sum, doc) => sum + doc.tables.filter(table => table.kind === 'text_lines').reduce((n, table) => n + table.rowCount, 0), 0),
    parsedRows: documents.reduce((sum, doc) => sum + doc.tables.reduce((n, table) => n + table.rowCount, 0), 0),
    previewRows: documents.reduce((sum, doc) => sum + doc.tables.reduce((n, table) => n + table.previewRows.length, 0), 0),
    columns: documents.reduce((sum, doc) => sum + doc.tables.reduce((n, table) => n + table.columnCount, 0), 0),
    originalRowRecords: input.facts.filter(fact => fact.kind === 'table_row').length,
    otherFacts: input.facts.filter(fact => fact.kind !== 'table_row').length,
    ocrRequired: documents.filter(doc => doc.status === 'ocr_required').length,
    truncatedTables: documents.reduce((sum, doc) => sum + doc.tables.filter(table => table.truncated).length, 0),
    formats: {},
  }
  for (const doc of documents) stats.formats[doc.format] = (stats.formats[doc.format] || 0) + 1
  const nodes: GraphNode[] = [{ id: `project:${input.projectId}`, kind: 'project', label: input.projectName,
    subtitle: `${documents.length} 份导入文件 · ${sources.length} 个关联来源`, parentId: null, level: 0, relation: '' }]
  const rootId = nodes[0].id
  const query = (input.query || '').trim().toLowerCase()
  const matchedDocuments = documents.filter(doc => !query || `${doc.fileName} ${doc.id}`.toLowerCase().includes(query))
  const uploadIds = new Set(documents.map(doc => doc.id))
  const linked = input.scope === 'all' ? sources.filter(source => !uploadIds.has(source.id) && (!query || `${source.title} ${source.id}`.toLowerCase().includes(query))) : []
  const totalSourceCards = matchedDocuments.length + linked.length
  const visibleCards = (input.depth === 'full' ? 8 : 16)
  const cards = [...matchedDocuments.map(doc => ({ kind: 'document' as const, doc })), ...linked.map(source => ({ kind: 'source' as const, source }))].slice(0, visibleCards)
  let hiddenDetails = 0
  for (const card of cards) {
    if (card.kind === 'document') {
      const doc = card.doc, id = `document:${doc.id}`, owner = sources.find(source => source.id === doc.id)
      const tableCount = doc.tables.filter(table => table.kind === 'table').length
      const textLineCount = doc.tables.filter(table => table.kind === 'text_lines').reduce((total, table) => total + table.rowCount, 0)
      const details = doc.status === 'ocr_required' ? '待 OCR' : [
        tableCount ? `${tableCount} 张表` : '', textLineCount ? `${textLineCount} 行文本` : '',
        doc.segments.length ? `${doc.segments.length} 段原文` : '',
      ].filter(Boolean).join(' · ') || '无可读结构'
      nodes.push({ id, kind: 'document', label: doc.fileName, subtitle: `${doc.format.toUpperCase()} · ${details}`,
        parentId: rootId, level: 1, relation: '项目上传', documentId: doc.id, sourceId: owner?.id })
      if (input.depth === 'map') continue
      const tableLimit = input.depth === 'full' ? 3 : 6
      for (const [tableIndex, table] of doc.tables.slice(0, tableLimit).entries()) {
        const tableId = `table:${doc.id}:${tableIndex}`
        nodes.push({ id: tableId, kind: table.kind, label: table.kind === 'text_lines' ? '文本行' : table.label,
          subtitle: `${table.rowCount} 行${table.kind === 'text_lines' ? '文本' : '解析'} · ${table.previewRows.length} 行预览${table.truncated ? ' · 已截取' : ''}`,
          parentId: id, level: 2, relation: '解析得到', documentId: doc.id, tableIndex })
        if (input.depth === 'full') {
          for (const [columnIndex, column] of table.columns.slice(0, 6).entries()) nodes.push({
            id: `column:${doc.id}:${tableIndex}:${columnIndex}`, kind: 'column', label: column.name,
            subtitle: column.fillRate === null ? '完整度未提供' : `${Math.round(column.fillRate * 100)}% ${column.quality === 'parsed' ? '解析填充' : '预览估算'}`,
            parentId: tableId, level: 3, relation: '列结构', documentId: doc.id, tableIndex, columnIndex,
          })
          hiddenDetails += Math.max(0, table.columns.length - 6)
        }
      }
      hiddenDetails += Math.max(0, doc.tables.length - tableLimit)
      for (const [segmentIndex, segment] of doc.segments.slice(0, 4).entries()) nodes.push({
        id: `segment:${doc.id}:${segmentIndex}`, kind: 'segment', label: segment.locator,
        subtitle: segment.text.slice(0, 55), parentId: id, level: 2, relation: '原文定位', documentId: doc.id, segmentIndex,
      })
      hiddenDetails += Math.max(0, doc.segments.length - 4)
      const facts = input.facts.filter(fact => fact.source_id === doc.id && fact.kind !== 'table_row')
      for (const fact of facts.slice(0, 4)) nodes.push({ id: `fact:${fact.id}`, kind: 'fact', label: fact.kind,
        subtitle: fact.locator || fact.object_ref || '来源事实', parentId: id, level: 2, relation: '显式来源引用', sourceId: doc.id, factId: fact.id })
      hiddenDetails += Math.max(0, facts.length - 4)
      const records = (owner?.public_records || []).filter(record => record.source_id === doc.id)
      for (const record of records.slice(0, 4)) nodes.push({ id: `record:${doc.id}:${record.id}`, kind: 'record', label: record.subject,
        subtitle: `${record.adapter} · ${record.period}`, parentId: id, level: 2, relation: '结构化原文记录', sourceId: doc.id, recordId: record.id })
      hiddenDetails += Math.max(0, records.length - 4)
    } else {
      const source = card.source, id = `source:${source.id}`
      nodes.push({ id, kind: 'source', label: source.title, subtitle: `${source.visibility === 'internal' ? '项目内部' : '公开来源'} · ${source.content_status || '状态未载'}`,
        parentId: rootId, level: 1, relation: '项目来源', sourceId: source.id })
      if (input.depth === 'map') continue
      const facts = input.facts.filter(fact => fact.source_id === source.id && fact.kind !== 'table_row')
      for (const fact of facts.slice(0, 4)) nodes.push({ id: `fact:${fact.id}`, kind: 'fact', label: fact.kind,
        subtitle: fact.locator || fact.object_ref || '来源事实', parentId: id, level: 2, relation: '显式来源引用', sourceId: source.id, factId: fact.id })
      hiddenDetails += Math.max(0, facts.length - 4)
      const records = (source.public_records || []).filter(record => record.source_id === source.id)
      for (const record of records.slice(0, 4)) nodes.push({ id: `record:${source.id}:${record.id}`, kind: 'record', label: record.subject,
        subtitle: `${record.adapter} · ${record.period}`, parentId: id, level: 2, relation: '结构化原文记录', sourceId: source.id, recordId: record.id })
      hiddenDetails += Math.max(0, records.length - 4)
    }
  }
  const edges = nodes.filter(node => node.parentId).map(node => ({ id: `${node.parentId}->${node.id}`,
    from: node.parentId!, to: node.id, relation: node.relation }))
  // We never infer a link from identical names or values. A fact with no known
  // source stays in the summary count rather than becoming a fabricated edge.
  return { nodes, edges, documents, sources, facts: input.facts,
    stats, hiddenSources: Math.max(0, totalSourceCards - cards.length), hiddenDetails }
}

export type PositionedNode = GraphNode & { x: number; y: number }
export function layoutImportGraph(graph: ImportGraph) {
  const children = new Map<string, GraphNode[]>()
  for (const node of graph.nodes) if (node.parentId) children.set(node.parentId, [...(children.get(node.parentId) || []), node])
  const spans = new Map<string, number>()
  function span(id: string): number {
    const descendants = children.get(id) || []
    const size = descendants.length ? Math.max(76, descendants.reduce((total, child) => total + span(child.id), 0) + (descendants.length - 1) * 12) : 76
    spans.set(id, size)
    return size
  }
  const root = graph.nodes[0]
  const height = Math.max(220, span(root.id) + 72)
  const placed = new Map<string, PositionedNode>()
  function place(node: GraphNode, top: number): void {
    const descendants = children.get(node.id) || []
    let cursor = top
    for (const child of descendants) { place(child, cursor); cursor += spans.get(child.id)! + 12 }
    // Keep the project root visible when a project has many sources. Internal
    // branches still center on their children to keep local structure readable.
    const y = node.level === 0 ? top + 38 : descendants.length
      ? (placed.get(descendants[0].id)!.y + placed.get(descendants.at(-1)!.id)!.y) / 2 : top + 38
    placed.set(node.id, { ...node, x: 34 + node.level * 272, y })
  }
  place(root, 36)
  return { width: 1110, height, nodes: graph.nodes.map(node => placed.get(node.id)!), edges: graph.edges }
}

export function previewColumnValues(table: ParsedTable, column: ParsedColumn): { value: string; count: number }[] {
  const frequencies = new Map<string, number>()
  for (const row of table.previewRows) {
    const value = (row.values[column.name] || '').trim()
    if (value) frequencies.set(value, (frequencies.get(value) || 0) + 1)
  }
  return [...frequencies].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-CN')).slice(0, 5)
    .map(([value, count]) => ({ value, count }))
}

export function recordForNode(source: Source, id: string): PublicRecord | undefined {
  return source.public_records?.find(record => record.id === id && record.source_id === source.id)
}
