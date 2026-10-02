import { useEffect, useMemo, useRef, useState } from 'react'
import type { Fact, Source } from '../../../host/generated/contracts'
import { api } from '../api'
import { buildImportGraph, layoutImportGraph, previewColumnValues, recordForNode,
  type GraphDepth, type GraphNode, type GraphScope, type ImportDocument, type ParsedColumn } from './graph-model'
import './import-graph.css'

type Props = {
  projectId: string
  projectName: string
  revision: number
  sources: Source[]
  researchSources: Source[]
  facts: Fact[]
}

const labels: Record<GraphNode['kind'], string> = {
  project: '项目', document: '导入文件', source: '关联来源', table: '解析表', text_lines: '文本行',
  column: '字段', segment: '原文定位', fact: '来源记录', record: '公开记录',
}
const safeLink = (value?: string) => {
  try { const url = new URL(value || ''); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null }
  catch { return null }
}
const percent = (value: number | null) => value === null ? '—' : `${Math.round(value * 100)}%`
const previewText = (value: unknown, max = 700) => {
  const raw = typeof value === 'string' ? value : JSON.stringify(value) ?? ''
  return raw.length > max ? `${raw.slice(0, max)}…` : raw
}

export default function ImportedDataExplorer({ projectId, projectName, revision, sources, researchSources, facts }: Props) {
  const requestKey = `${projectId}\u0000${revision}`
  const [documentLoad, setDocumentLoad] = useState<{ key: string; rows: ImportDocument[]; error: string; loading: boolean }>({ key: '', rows: [], error: '', loading: true })
  const [depth, setDepth] = useState<GraphDepth>('read')
  const [scope, setScope] = useState<GraphScope>('imports')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState(`project:${projectId}`)
  const [manualNode, setManualNode] = useState<GraphNode | null>(null)
  const [focusedColumn, setFocusedColumn] = useState<{ documentId: string; tableIndex: number; columnIndex: number } | null>(null)
  const [segmentQuery, setSegmentQuery] = useState('')
  const [segmentLimit, setSegmentLimit] = useState(20)
  const [zoom, setZoom] = useState(1)
  const canvasRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const controller = new AbortController()
    setDocumentLoad({ key: requestKey, rows: [], error: '', loading: true })
    setManualNode(null); setFocusedColumn(null); setSelectedId(`project:${projectId}`)
    setSegmentQuery(''); setSegmentLimit(20)
    void api<ImportDocument[]>(`/projects/${encodeURIComponent(projectId)}/documents`, undefined, controller.signal)
      .then(rows => { if (!controller.signal.aborted) setDocumentLoad({ key: requestKey, rows: Array.isArray(rows) ? rows : [], error: '', loading: false }) })
      .catch(reason => { if (!controller.signal.aborted) setDocumentLoad({ key: requestKey, rows: [], error: reason instanceof Error ? reason.message : '导入数据暂不可读', loading: false }) })
    return () => controller.abort()
  }, [projectId, requestKey])

  const documents = documentLoad.key === requestKey ? documentLoad.rows : []
  const loading = documentLoad.key !== requestKey || documentLoad.loading
  const error = documentLoad.key === requestKey ? documentLoad.error : ''
  const effectiveScope = scope === 'imports' && !documents.length ? 'all' : scope
  const graph = useMemo(() => buildImportGraph({ projectId, projectName, projectSources: sources, researchSources,
    facts, documents, depth, scope: effectiveScope, query }), [projectId, projectName, sources, researchSources, facts, documents, depth, effectiveScope, query])
  const layout = useMemo(() => layoutImportGraph(graph), [graph])
  const selected = manualNode && graph.nodes.some(node => node.id === manualNode.parentId)
    ? manualNode : graph.nodes.find(node => node.id === selectedId) || graph.nodes[0]
  const byId = new Map(layout.nodes.map(node => [node.id, node]))
  const chain = new Set<string>()
  let cursor: GraphNode | undefined = selected
  while (cursor) { chain.add(cursor.id); cursor = cursor.parentId ? graph.nodes.find(node => node.id === cursor!.parentId) : undefined }
  for (const node of graph.nodes) if (node.parentId === selected.id) chain.add(node.id)
  const breadcrumbs: GraphNode[] = []
  cursor = selected
  while (cursor) { breadcrumbs.unshift(cursor); cursor = cursor.parentId ? graph.nodes.find(node => node.id === cursor!.parentId) : undefined }
  const document = graph.documents.find(item => item.id === selected.documentId)
  const source = graph.sources.find(item => item.id === (selected.sourceId || selected.documentId))
  const table = document?.tables[selected.tableIndex ?? -1]
  const columnFocus = focusedColumn && (selected.kind === 'table' || selected.kind === 'text_lines') && focusedColumn.documentId === document?.id && focusedColumn.tableIndex === selected.tableIndex ? focusedColumn : null
  const column: ParsedColumn | undefined = table?.columns[columnFocus?.columnIndex ?? selected.columnIndex ?? -1]
  const segment = document?.segments[selected.segmentIndex ?? -1]
  const fact = graph.facts.find(item => item.id === selected.factId)
  const record = source && selected.recordId ? recordForNode(source, selected.recordId) : undefined
  const matchingSegments = document?.segments.map((item, index) => ({ item, index })).filter(({ item }) =>
    !segmentQuery || `${item.locator} ${item.text}`.toLowerCase().includes(segmentQuery.toLowerCase())) || []
  const openTable = (index: number) => {
    if (!document) return
    const item = document.tables[index]
    setFocusedColumn(null)
    setManualNode({ id: `detail-table:${document.id}:${index}`, kind: item.kind,
      label: item.kind === 'text_lines' ? '文本行' : item.label,
      subtitle: `${item.rowCount} 行解析 · ${item.previewRows.length} 行预览`, parentId: `document:${document.id}`,
      level: 2, relation: '解析得到', documentId: document.id, tableIndex: index })
  }
  const openSegment = (index: number) => {
    if (!document) return
    const item = document.segments[index]
    setManualNode({ id: `detail-segment:${document.id}:${index}`, kind: 'segment', label: item.locator,
      subtitle: item.text.slice(0, 55), parentId: `document:${document.id}`,
      level: 2, relation: '原文定位', documentId: document.id, segmentIndex: index })
  }
  const jumpToNode = (id: string) => {
    const node = byId.get(id), canvas = canvasRef.current
    if (!node) return
    setManualNode(null); setFocusedColumn(null); setSelectedId(id)
    setSegmentQuery(''); setSegmentLimit(20)
    if (canvas) canvas.scrollTo({ left: Math.max(0, (node.x + 110) * zoom - canvas.clientWidth / 2),
      top: Math.max(0, node.y * zoom - canvas.clientHeight / 2), behavior: 'smooth' })
  }

  if (loading || error) return <section className="import-explorer" aria-label="导入数据关系与分析">
    <header className="import-explorer-heading"><div><small>DATA ARCHITECTURE / 只读结构</small><h3>导入数据关系图</h3></div></header>
    {loading ? <p role="status" className="import-graph-note">正在读取本项目的解析结果…</p>
      : <p role="alert" className="import-graph-error">导入数据暂不可读：{error}。下方仍可查看项目来源列表。</p>}
  </section>

  return <section className="import-explorer" aria-label="导入数据关系与分析">
    <header className="import-explorer-heading">
      <div><small>DATA ARCHITECTURE / 只读结构</small><h3>导入数据关系图</h3>
        <p>项目、来源、解析表与字段按已保存的引用连线；选中节点查看结构和数据质量。</p></div>
      <span className="import-explorer-count">{graph.stats.importedFiles} 份导入文件</span>
    </header>
    <div className="import-metrics" aria-label="导入数据概况">
      <div><strong>{graph.stats.importedFiles}</strong><span>导入文件</span></div>
      <div><strong>{graph.stats.tables}</strong><span>解析表</span></div>
      <div><strong>{graph.stats.textLines}</strong><span>文本行</span></div>
      <div><strong>{graph.stats.parsedRows}</strong><span>解析行数</span></div>
      <div><strong>{graph.stats.previewRows}</strong><span>可见预览行</span></div>
      <div><strong>{graph.stats.originalRowRecords}</strong><span>来源绑定原始行</span></div>
      <div><strong>{graph.stats.ocrRequired}</strong><span>待 OCR 文件</span></div>
    </div>
    {!documents.length && <p className="import-graph-note">本项目尚无上传文件。图中显示已有项目来源；上传 CSV、Excel、Word、PDF 或文本后可展开表、字段与原文定位。</p>}
    <div className="import-graph-toolbar">
      <div className="import-graph-switch" aria-label="图示深度">{([
        ['map', '总览'], ['read', '结构'], ['full', '字段'],
      ] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={depth === value} onClick={() => setDepth(value)}>{label}</button>)}</div>
      <div className="import-graph-switch" aria-label="来源范围">
        <button type="button" aria-pressed={effectiveScope === 'imports'} disabled={!documents.length} onClick={() => setScope('imports')}>导入文件</button>
        <button type="button" aria-pressed={effectiveScope === 'all'} onClick={() => setScope('all')}>全部来源</button>
      </div>
      <label className="import-graph-search">筛选节点<input value={query} onChange={event => setQuery(event.target.value)} placeholder="文件名或来源名" /></label>
      <label className="import-graph-jump">快速定位节点<select value={selected.level === 1 ? selected.id : ''} onChange={event => jumpToNode(event.target.value)}>
        <option value="">选择文件或来源</option>{graph.nodes.filter(node => node.level === 1).map(node => <option key={node.id} value={node.id}>{node.label}</option>)}
      </select></label>
      <div className="import-graph-zoom" aria-label="图形缩放">
        <button type="button" aria-label="缩小关系图" onClick={() => setZoom(value => Math.max(.7, +(value - .15).toFixed(2)))}>−</button>
        <button type="button" aria-label="重置关系图缩放" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button>
        <button type="button" aria-label="放大关系图" onClick={() => setZoom(value => Math.min(1.45, +(value + .15).toFixed(2)))}>+</button>
      </div>
    </div>
    <div className="import-graph-body">
      <div className="import-graph-canvas" ref={canvasRef} role="region" aria-label="可交互的数据关系图" tabIndex={0}>
        <svg width={layout.width * zoom} height={layout.height * zoom} viewBox={`0 0 ${layout.width} ${layout.height}`} role="group" aria-label={`${graph.nodes.length} 个有来源的节点，${graph.edges.length} 条显式关系`}>
          <defs><pattern id="import-grid" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M 20 0 L 0 0 0 20" fill="none" stroke="#e7eeed" strokeWidth=".7"/></pattern></defs>
          <rect width={layout.width} height={layout.height} fill="url(#import-grid)" />
          {layout.edges.map(edge => {
            const from = byId.get(edge.from)!, to = byId.get(edge.to)!
            const middle = (from.x + 220 + to.x) / 2
            const highlighted = selected.kind === 'project' || chain.has(edge.from) && chain.has(edge.to)
            return <g key={edge.id} className={`import-edge ${highlighted ? 'is-related' : 'is-muted'}`}>
              <path d={`M ${from.x + 220} ${from.y} C ${middle} ${from.y}, ${middle} ${to.y}, ${to.x} ${to.y}`} />
              <title>{edge.relation}</title>
            </g>
          })}
          {layout.nodes.map(node => <g key={node.id} role="button" tabIndex={0}
            aria-label={`${labels[node.kind]}：${node.label}`} aria-pressed={selected.id === node.id}
            className={`import-node kind-${node.kind} ${selected.id === node.id ? 'is-selected' : ''} ${selected.kind !== 'project' && !chain.has(node.id) ? 'is-muted' : ''}`}
            transform={`translate(${node.x},${node.y - 31})`}
            onClick={() => { setManualNode(null); setFocusedColumn(null); setSelectedId(node.id); setSegmentQuery(''); setSegmentLimit(20) }}
            onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setManualNode(null); setFocusedColumn(null); setSelectedId(node.id); setSegmentQuery(''); setSegmentLimit(20) } }}>
            <rect width="220" height="62" rx="9" />
            <text className="import-node-kind" x="12" y="17">{labels[node.kind]}</text>
            <text className="import-node-title" x="12" y="37">{node.label.length > 18 ? `${node.label.slice(0, 18)}…` : node.label}</text>
            <text className="import-node-subtitle" x="12" y="53">{node.subtitle.length > 27 ? `${node.subtitle.slice(0, 27)}…` : node.subtitle}</text>
            <title>{node.label} · {node.subtitle}</title>
          </g>)}
        </svg>
      </div>
      <aside className="import-inspector" aria-label="节点分析">
        <div className="import-inspector-breadcrumb">{breadcrumbs.map((item, index) => <span key={item.id}>{index > 0 ? ' / ' : ''}{labels[item.kind]}</span>)}</div>
        {manualNode && selected.id === manualNode.id && <button type="button" className="import-back-button" onClick={() => setManualNode(null)}>返回文件</button>}
        <h4>{selected.label}</h4><p className="import-inspector-subtitle">{selected.subtitle}</p>
        {selected.kind === 'project' && <>
          <p>已关联 {graph.stats.linkedSources} 个来源；其中 {graph.stats.importedFiles} 份为本项目上传文件。</p>
          <dl className="import-inspector-stats"><div><dt>格式</dt><dd>{Object.entries(graph.stats.formats).map(([format, n]) => `${format.toUpperCase()} ${n}`).join(' · ') || '暂无导入'}</dd></div>
            <div><dt>其他结构化事实</dt><dd>{graph.stats.otherFacts}</dd></div><div><dt>已截取预览表</dt><dd>{graph.stats.truncatedTables}</dd></div></dl>
          <p className="import-quality-note">“解析行数”来自本地解析器，Excel 等格式有读取上限；“可见预览行”只统计实际可查看的记录，不能代替总量。</p>
        </>}
        {selected.kind === 'document' && document && <>
          <dl className="import-inspector-stats"><div><dt>解析状态</dt><dd>{document.status === 'ocr_required' ? '扫描页待 OCR' : document.status}</dd></div>
            <div><dt>解析器</dt><dd>{document.parser}</dd></div><div><dt>文件指纹</dt><dd className="import-hash">{document.hash || '未提供'}</dd></div>
            <div><dt>解析结构 / 原文段</dt><dd>{document.tables.length} / {document.segments.length}</dd></div></dl>
          {[...document.issues, ...document.notes].map(note => <p className="import-quality-note" key={note}>{note}</p>)}
          {document.status === 'ocr_required' && <p className="import-quality-note">未取得可读正文，图中不会生成字段或已核事实。</p>}
          {!!source?.locator && <p>来源定位：{source.locator}</p>}
          {!!document.tables.length && <><h5>全部解析结构</h5><div className="import-document-items">{document.tables.map((item, index) =>
            <button type="button" key={item.id} onClick={() => openTable(index)}>{item.kind === 'text_lines' ? '文本行' : item.label} · {item.rowCount} 行</button>)}</div></>}
          {!!document.segments.length && <><h5>原文定位（{document.segments.length}）</h5>
            <label className="import-segment-search">查找定位或内容<input value={segmentQuery} onChange={event => { setSegmentQuery(event.target.value); setSegmentLimit(20) }} /></label>
            <div className="import-document-items">{matchingSegments.slice(0, segmentLimit).map(({ item, index }) =>
              <button type="button" key={`${item.locator}:${index}`} onClick={() => openSegment(index)}>{item.locator} · {previewText(item.text, 65)}</button>)}</div>
            {matchingSegments.length > segmentLimit && <button type="button" className="import-more-button" onClick={() => setSegmentLimit(value => value + 20)}>再显示 20 个定位</button>}
            {!matchingSegments.length && <p className="import-quality-note">没有匹配的原文定位。</p>}
          </>}
        </>}
        {(selected.kind === 'table' || selected.kind === 'text_lines') && table && <>
          <dl className="import-inspector-stats"><div><dt>解析行数</dt><dd>{table.rowCount}</dd></div><div><dt>可见预览行</dt><dd>{table.previewRows.length}</dd></div>
            <div><dt>字段数</dt><dd>{table.columnCount}</dd></div>{table.sheet && <div><dt>工作表</dt><dd>{table.sheet}</dd></div>}</dl>
          {table.truncated && <p className="import-quality-note">这里只显示前 {table.previewRows.length} 行预览，统计不能当作全部原始文件。</p>}
          <h5>字段完整度</h5><div className="import-column-list">{table.columns.map((field, index) => <button type="button" key={`${field.name}:${index}`} aria-pressed={columnFocus?.columnIndex === index} onClick={() => setFocusedColumn({ documentId: document!.id, tableIndex: selected.tableIndex!, columnIndex: index })}>
            <span>{field.name}</span><strong>{percent(field.fillRate)}</strong><i style={{ width: `${Math.round((field.fillRate || 0) * 100)}%` }} /></button>)}</div>
          {columnFocus && column && <div className="import-focused-column"><h5>{column.name} · 字段分析</h5>
            <p>填充率 {percent(column.fillRate)} · 类型 {column.valueType || '未提供'} · 缺失 {column.missingCount ?? '—'}</p>
            <p className="import-quality-note">{column.quality === 'parsed' ? '填充率按解析行计算；去重值基于预览。' : column.quality === 'estimated' ? '填充率按截取的预览行推算。' : column.quality === 'preview' ? '仅按可见预览行估算。' : '缺少可用行预览。'}</p>
            <ul className="import-value-list">{previewColumnValues(table, column).map(entry => <li key={entry.value}><span>{previewText(entry.value, 45)}</span><strong>{entry.count}</strong></li>)}</ul>
          </div>}
          <h5>原始行预览</h5><div className="import-preview-scroll"><table><thead><tr><th>行</th>{table.columns.slice(0, 5).map(field => <th key={field.name}>{field.name}</th>)}</tr></thead>
            <tbody>{table.previewRows.slice(0, 8).map(row => <tr key={row.rowNumber}><th>{row.rowNumber}</th>{table.columns.slice(0, 5).map(field => <td key={field.name}>{previewText(row.values[field.name] || '', 70)}</td>)}</tr>)}</tbody></table></div>
        </>}
        {selected.kind === 'column' && column && table && <>
          <dl className="import-inspector-stats"><div><dt>字段类型</dt><dd>{column.valueType || '未提供'}</dd></div>
            <div><dt>填充率</dt><dd>{percent(column.fillRate)}</dd></div><div><dt>缺失数</dt><dd>{column.missingCount ?? '—'}</dd></div>
            <div><dt>去重值</dt><dd>{column.uniqueCount ?? '仅预览可见'}</dd></div></dl>
          <div className="import-fill-bar"><i style={{ width: `${Math.round((column.fillRate || 0) * 100)}%` }} /></div>
          <p className="import-quality-note">{column.quality === 'parsed' ? '按解析行计算。去重值仍基于预览。' : column.quality === 'estimated' ? '按最多 250 行预览推算，非全表逐行统计。' : column.quality === 'preview' ? '仅按可见预览行估算。' : '缺少可用行预览。'}</p>
          {!!column.examples.length && <p>样例：{column.examples.join(' · ')}</p>}
          <h5>预览中出现较多的值</h5><ul className="import-value-list">{previewColumnValues(table, column).map(entry => <li key={entry.value}><span>{previewText(entry.value, 45)}</span><strong>{entry.count}</strong></li>)}</ul>
        </>}
        {selected.kind === 'segment' && segment && <><p>原文定位：{segment.locator}</p><blockquote>{previewText(segment.text, 900)}</blockquote></>}
        {selected.kind === 'source' && source && <>
          <dl className="import-inspector-stats"><div><dt>资料类别</dt><dd>{source.data_class}</dd></div><div><dt>可见性</dt><dd>{source.visibility === 'internal' ? '本项目内部' : '公开'}</dd></div>
            <div><dt>内容状态</dt><dd>{source.content_status || '未标注'}</dd></div>{source.locator && <div><dt>定位</dt><dd>{source.locator}</dd></div>}</dl>
          {safeLink(source.url) && <a href={safeLink(source.url)!} target="_blank" rel="noopener noreferrer">查看原始来源 ↗</a>}
          {source.untrusted_text && <details><summary>原文摘录</summary><p>{previewText(source.untrusted_text, 800)}</p></details>}
        </>}
        {selected.kind === 'fact' && fact && <><p>记录类型：{fact.kind}</p><p>明确来源：{fact.source_id}</p>
          <p>原文定位：{fact.locator || fact.object_ref || '未标注'}</p><blockquote>{previewText(fact.value)}</blockquote>
          {fact.kind === 'table_row' && <p className="import-quality-note">这是解析出的原始行，不自动等同于已核业务事实。</p>}</>}
        {selected.kind === 'record' && record && <><p>对象：{record.subject}</p><p>来源：{record.source_id} · {record.adapter}</p><p>记录时点：{record.period}</p>
          <ul className="import-value-list">{record.fields.slice(0, 12).map(field => <li key={field.key}><span>{field.label || field.key}</span><strong>{previewText(field.value, 55)}</strong></li>)}</ul></>}
      </aside>
    </div>
    {(graph.hiddenSources > 0 || graph.hiddenDetails > 0) && <p className="import-graph-note">图形为避免拥挤收起了 {graph.hiddenSources} 个来源、{graph.hiddenDetails} 个结构、字段或定位；可筛选文件，并在文件面板打开收起的内容。</p>}
    <p className="import-graph-footnote">关系线只表示“项目归属、解析结果、字段结构或显式来源引用”。同名对象不会被自动合并；描述统计也不会自动触发模型研判。</p>
  </section>
}
