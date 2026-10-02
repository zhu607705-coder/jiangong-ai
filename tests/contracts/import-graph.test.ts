import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseMaterial, tableFacts } from '../../apps/host/ingest'
import { buildImportGraph, layoutImportGraph, normalizeImportDocument, previewColumnValues } from '../../apps/workspace/src/imports/graph-model'
import type { Fact, Source } from '../../apps/host/generated/contracts'

const source = (id: string): Source => ({ id, title: `${id}.csv`, data_class: 'synthetic', visibility: 'internal', synthetic: true, content_status: 'uploaded' })
const input = (extras: Partial<Parameters<typeof buildImportGraph>[0]> = {}) => ({
  projectId: 'P-TEST', projectName: '显式合成项目', projectSources: [source('DOC-1')], facts: [] as Fact[],
  documents: [] as Parameters<typeof buildImportGraph>[0]['documents'], depth: 'full' as const, scope: 'imports' as const,
  ...extras,
})

describe('source-backed imported-data graph', () => {
  it('projects actual CSV parser output without treating preview rows as all rows', () => {
    const dir = mkdtempSync(join(tmpdir(), 'import-graph-'))
    try {
      const file = join(dir, 'synthetic.csv')
      writeFileSync(file, '建筑编号,面积\n' + Array.from({ length: 300 }, (_, i) => `B-${i + 1},${i % 10 === 0 ? '' : i + 20}`).join('\n'))
      const parsed = parseMaterial({ documentId: 'DOC-1', fileName: 'synthetic.csv', filePath: file, mime: 'text/csv', type: 'workspace_material', projectRoot: dir })
      const graph = buildImportGraph(input({ documents: [{ id: 'DOC-1', file_name: 'synthetic.csv', parser_result: parsed }], facts: tableFacts(parsed.profile, 'DOC-1') }))
      expect(graph.stats).toMatchObject({ importedFiles: 1, tables: 1, parsedRows: 300, previewRows: 250, originalRowRecords: 250, truncatedTables: 1 })
      expect(graph.stats.otherFacts).toBe(0)
      expect(graph.nodes.map(node => node.kind)).toEqual(['project', 'document', 'table', 'column', 'column'])
      expect(graph.edges.map(edge => edge.relation)).toEqual(['项目上传', '解析得到', '列结构', '列结构'])
      expect(graph.documents[0].hash).toBe(parsed.source_hash)
      expect(graph.documents[0].tables[0].columns[1]).toMatchObject({ quality: 'estimated', fillRate: 0.9, missingCount: 30 })
      expect(graph.documents[0].tables[0].previewRows.at(-1)?.rowNumber).toBe(251)
      expect(previewColumnValues(graph.documents[0].tables[0], graph.documents[0].tables[0].columns[0])).toHaveLength(5)
      const layout = layoutImportGraph(graph)
      expect(layout.nodes.every(node => Number.isFinite(node.x) && Number.isFinite(node.y))).toBe(true)
      expect(layout.height).toBeGreaterThan(200)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('labels Excel/Word column quality as preview-only and keeps OCR-required PDFs empty', () => {
    const workbook = normalizeImportDocument({ id: 'DOC-X', file_name: 'buildings.xlsx', parser_result: { status: 'extracted', parser: 'local', profile: { tables: [{ label: '楼宇表', rowCount: 5, columns: ['建筑编号', '面积'], rows: [{ rowNumber: 2, values: { 建筑编号: 'B1', 面积: '100' } }, { rowNumber: 3, values: { 建筑编号: 'B2', 面积: '' } }] }] } } })
    expect(workbook.tables[0]).toMatchObject({ rowCount: 5, truncated: true, columnCount: 2 })
    expect(workbook.tables[0].columns[1]).toMatchObject({ quality: 'preview', fillRate: .5, missingCount: 1 })
    const scan = normalizeImportDocument({ id: 'DOC-P', file_name: 'scan.pdf', parser_result: { status: 'ocr_required', segments: [], profile: { tables: [] } } })
    expect(scan.tables).toEqual([])
    const graph = buildImportGraph(input({ documents: [{ id: scan.id, file_name: scan.fileName, parser_result: { status: scan.status, segments: [], profile: { tables: [] } } }], projectSources: [source('DOC-P')] }))
    expect(graph.stats.ocrRequired).toBe(1)
    expect(graph.nodes.map(node => node.kind)).toEqual(['project', 'document'])
  })

  it('only draws explicit source references and distinguishes uploads from other sources', () => {
    const linked: Source = { id: 'PUB-1', title: '公开来源', data_class: 'public', visibility: 'public', synthetic: false,
      public_records: [{ id: 'REC-1', adapter: 'procurement', subject: '已标识采购', scope: 'object', period: '2026-01-01', source_id: 'PUB-1', fields: [] }] }
    const facts = [{ id: 'F1', kind: 'rights_status', value: 'unknown', source_id: 'PUB-1', unit: null },
      { id: 'F2', kind: 'rights_status', value: 'unknown', source_id: 'DOC-1', unit: null },
      { id: 'F-FOREIGN', kind: 'rights_status', value: 'unknown', source_id: 'OTHER', unit: null }] as Fact[]
    const graph = buildImportGraph(input({ projectSources: [source('DOC-1'), linked], facts, scope: 'all', depth: 'read' }))
    expect(graph.nodes.map(node => node.kind)).toEqual(['project', 'source', 'fact', 'source', 'fact', 'record'])
    expect(graph.edges.filter(edge => edge.relation === '显式来源引用')).toHaveLength(2)
    expect(graph.nodes.find(node => node.id === 'fact:F1')?.parentId).toBe('source:PUB-1')
    expect(graph.nodes.find(node => node.id === 'fact:F2')?.parentId).toBe('source:DOC-1')
    expect(graph.nodes.some(node => node.id === 'fact:F-FOREIGN')).toBe(false)
    const overview = buildImportGraph(input({ projectSources: [linked], scope: 'all', depth: 'map' }))
    expect(overview.nodes.map(node => node.kind)).toEqual(['project', 'source'])
  })

  it('projects PDF page locators and bounds large graph detail without inventing relations', () => {
    const graph = buildImportGraph(input({ documents: [{ id: 'DOC-1', file_name: 'notes.pdf', parser_result: { status: 'extracted', segments: Array.from({ length: 8 }, (_, i) => ({ locator: `page:${i + 1}`, text: `合成第${i + 1}页` })), profile: { tables: [] } } }] }))
    expect(graph.nodes.filter(node => node.kind === 'segment')).toHaveLength(4)
    expect(graph.hiddenDetails).toBe(4)
    expect(graph.edges.every(edge => graph.nodes.some(node => node.id === edge.from) && graph.nodes.some(node => node.id === edge.to))).toBe(true)
  })

  it('keeps Word paragraphs alongside tables and counts text lines separately', () => {
    const mixed = buildImportGraph(input({ documents: [{ id: 'DOC-1', file_name: 'minutes.docx', parser_result: {
      status: 'extracted', segments: [{ locator: 'paragraph:1', text: '合成会议正文' }],
      profile: { tables: [{ label: 'Word table 1', rowCount: 1, columns: ['事项'], rows: [{ rowNumber: 2, values: { 事项: '改造' } }] }] },
    } }] }))
    expect(mixed.nodes.filter(node => node.kind === 'table')).toHaveLength(1)
    expect(mixed.nodes.filter(node => node.kind === 'segment')).toHaveLength(1)
    const text = buildImportGraph(input({ documents: [{ id: 'DOC-1', file_name: 'notes.md', parser_result: {
      status: 'extracted', profile: { tables: [{ label: '项目材料', rowCount: 2, columns: ['Line', 'Text'], rows: [
        { rowNumber: 1, values: { Line: '1', Text: '第一行' } }, { rowNumber: 2, values: { Line: '2', Text: '第二行' } },
      ] }] },
    } }] }))
    expect(text.stats).toMatchObject({ tables: 0, textLines: 2, parsedRows: 2 })
    expect(text.nodes.some(node => node.kind === 'text_lines')).toBe(true)
    expect(text.nodes.find(node => node.kind === 'document')?.subtitle).toBe('MD · 2 行文本')
  })

  it('does not manufacture a table or row from empty TXT/Markdown uploads', () => {
    const dir = mkdtempSync(join(tmpdir(), 'import-empty-'))
    try {
      const file = join(dir, 'empty.md')
      writeFileSync(file, ' \n ')
      const parsed = parseMaterial({ documentId: 'DOC-1', fileName: 'empty.md', filePath: file, mime: 'text/markdown', type: 'workspace_material', projectRoot: dir })
      expect(parsed.status).toBe('empty')
      expect(tableFacts(parsed.profile, 'DOC-1')).toEqual([])
      const graph = buildImportGraph(input({ documents: [{ id: 'DOC-1', file_name: 'empty.md', parser_result: parsed }] }))
      expect(graph.stats).toMatchObject({ importedFiles: 1, tables: 0, textLines: 0, parsedRows: 0, previewRows: 0 })
      expect(graph.nodes.map(node => node.kind)).toEqual(['project', 'document'])
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
