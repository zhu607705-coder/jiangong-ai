import { useEffect, useMemo, useRef, useState } from 'react'
import type { ExperienceCard, Source } from '../../../host/generated/contracts'
import { buildRagExport, crossDocumentMeasureIndex, ragDataKindLabels, ragPhaseLabels, ragReviewLabels, renderRagMarkdown,
  type RagDataKind, type RagExportBundle } from '../../../../packages/experience/rag-export'
import { api } from '../api'
import type { ImportDocument, ParsedDocument } from './graph-model'
import './cross-document-measures.css'

const reasonLabels = { document_unavailable: '当前未导入该原件', version_mismatch: '与当前材料版本不同', locator_unavailable: '当前解析快照没有该定位', quote_mismatch: '引文与该定位的原文未逐字匹配' }
const measureDisplayNames: Record<string,string> = {elevator:'电梯',pipe_network:'二次供水',maintenance:'物业与维护',public_service:'公共服务'}
const dataKinds: RagDataKind[] = ['public_original', 'ai_research_draft', 'synthetic_example', 'internal_material', 'unknown']
function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const anchor = window.document.createElement('a')
  anchor.href = url; anchor.download = name; anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export default function CrossDocumentMeasures({ projectId, revision, documents, rawDocuments, sources, onEvidence }: {
  projectId: string; revision: number; documents: ParsedDocument[]; rawDocuments: ImportDocument[]; sources: Source[];
  onEvidence?: (refs: string[]) => void;
}) {
  const scope = `${projectId}:${revision}`
  const [knowledge, setKnowledge] = useState<{ scope: string; cards: ExperienceCard[]; error: string; loading: boolean }>({ scope: '', cards: [], error: '', loading: true })
  const [retry, setRetry] = useState(0), [measureId, setMeasureId] = useState(''), [documentFilter, setDocumentFilter] = useState('all')
  const [exportScope, setExportScope] = useState('all'), [selection, setSelection] = useState<{ documentId: string; locator: string } | null>(null)
  const rawRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const controller = new AbortController()
    setKnowledge({ scope, cards: [], error: '', loading: true })
    void api<{ cards: ExperienceCard[] }>(`/projects/${encodeURIComponent(projectId)}/knowledge/pipeline`, undefined, controller.signal)
      .then(result => { if (!controller.signal.aborted) setKnowledge({ scope, cards: result.cards, error: '', loading: false }) })
      .catch(error => { if (!controller.signal.aborted) setKnowledge({ scope, cards: [], error: error instanceof Error ? error.message : '举措引用暂不可读', loading: false }) })
    return () => controller.abort()
  }, [projectId, scope, retry])
  useEffect(() => { setMeasureId(''); setDocumentFilter('all'); setExportScope('all'); setSelection(null) }, [projectId])
  const loading = knowledge.scope !== scope || knowledge.loading
  const cards = knowledge.scope === scope ? knowledge.cards : []
  const prepared = useMemo(() => {
    try { return { bundle: buildRagExport({ projectId, documents, rawDocuments, sources, cards, annotationStatus: knowledge.error ? 'unavailable' : 'available' }), error: '' } }
    catch (error) { return { bundle: null, error: error instanceof Error ? error.message : '原文定位存在冲突，请核查解析材料。' } }
  }, [projectId, documents, rawDocuments, sources, cards, knowledge.error])
  const bundle = prepared.bundle
  const measures = useMemo(() => bundle ? crossDocumentMeasureIndex(bundle, cards) : [], [bundle, cards])
  const current = measures.find(measure => measure.id === measureId) || measures[0]
  const entries = (current?.entries || []).filter(entry => documentFilter === 'all' || entry.document.document_id === documentFilter)
  const selectedDocument = bundle?.documents.find(document => document.document_id === selection?.documentId)
  const selectedChunk = selectedDocument?.chunks.find(chunk => chunk.locator === selection?.locator)
  const exportSelection = exportScope === 'all' || !documents.some(document => document.id === exportScope) ? 'all' : exportScope
  const exportBundle = (): RagExportBundle | null => bundle ? { ...bundle, prepared_at: new Date().toISOString(),
    documents: bundle.documents.filter(document => exportSelection === 'all' || document.document_id === exportSelection),
    unresolved_references: bundle.unresolved_references.filter(reference => exportSelection === 'all' || reference.link.evidence.document_id === exportSelection) } : null
  const exportFile = (format: 'md' | 'json') => {
    const value = exportBundle(); if (!value) return
    const document = exportSelection === 'all' ? null : value.documents[0]
    const name = (document?.file_name.replace(/\.[^.]+$/, '') || `项目材料-${projectId}`).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    download(`${name}-RAG.${format}`, format === 'md' ? renderRagMarkdown(value) : `${JSON.stringify(value, null, 2)}\n`, format === 'md' ? 'text/markdown;charset=utf-8' : 'application/json;charset=utf-8')
  }
  const locate = (documentId: string, locator: string) => {
    setSelection({ documentId, locator })
    window.requestAnimationFrame(() => rawRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }))
  }
  if (!documents.length) return null
  return <section className="cross-document-measures" aria-label="跨文本举措定位与RAG材料导出">
    <header className="cross-measures-heading"><div><h3>跨文本定位同一举措</h3><p>选一项举措，对照不同材料的原文、阶段、对象与审核记录。</p></div><span>引用对照 · 保留各份原件</span></header>
    <div className="cross-measures-export"><div><strong>整理为 Markdown / JSON</strong><p>包含已保存解析原文、未引用的上下文及来源版本。表格预览明确记录截取范围。</p></div><div><label>导出范围<select aria-label="选择RAG导出范围" value={exportSelection} onChange={event => setExportScope(event.target.value)}><option value="all">全部 {documents.length} 份材料</option>{documents.map(document => <option key={document.id} value={document.id}>{document.fileName}</option>)}</select></label><button type="button" disabled={loading || !bundle} onClick={() => exportFile('md')}>导出 Markdown</button><button type="button" disabled={loading || !bundle} onClick={() => exportFile('json')}>导出 JSON</button></div></div>
    <p className="cross-measures-purpose">文件用于后续检索准备，保留原审核状态。下载在本机完成，不修改原件。</p>
    {prepared.error && <p role="alert">{prepared.error}，本次导出已暂停。</p>}
    {knowledge.error && <p role="alert">举措引用读取失败：{knowledge.error}。仍可导出原文，文件会注明举措关联暂不可读。<button type="button" onClick={() => setRetry(value => value + 1)}>重新读取引用</button></p>}
    {loading ? <p role="status">正在读取跨文本引用…</p> : bundle && <>
      <div className="cross-measures-layout"><nav className="cross-measures-list" aria-label="跨文本举措列表">{measures.map(measure => <button type="button" key={measure.id} aria-pressed={current?.id === measure.id} onClick={() => { setMeasureId(measure.id); setSelection(null); setDocumentFilter('all') }}><strong>{measureDisplayNames[measure.measureKey || ""] || measure.title}</strong><span>{measure.documentCount}份出现此举措的材料 · {measure.entries.length}条定位</span></button>)}{!measures.length && <p>尚无已登记的举措引用。原文与上下文仍可导出。</p>}</nav>
      <div className="cross-measures-compare">{current && <><header><div><h4>{measureDisplayNames[current.measureKey || ""] || current.title}</h4><p>{current.documentCount}份材料可定位，{current.referencedDocumentCount}份已有引用记录。提议、实施与结果分别展示，原文提及保留待核状态。</p></div><label>对照材料<select aria-label="筛选跨文本原件" value={documentFilter} onChange={event => setDocumentFilter(event.target.value)}><option value="all">全部关联材料</option>{[...new Map(current.entries.map(entry => [entry.document.document_id, entry.document])).values()].map(document => <option key={document.document_id} value={document.document_id}>{document.file_name}</option>)}</select></label></header>
        <div className="cross-measures-sections">{dataKinds.filter(kind => entries.some(entry => entry.document.data_kind === kind)).map(kind => <section key={kind} aria-label={`${ragDataKindLabels[kind]}举措对照`}><header><h5>{ragDataKindLabels[kind]}</h5>{kind === 'ai_research_draft' && <p>AI草稿保留为调查线索，文中提及与已核实事实分别记录。</p>}</header><div className="cross-measures-quotes">{entries.filter(entry => entry.document.data_kind === kind).map(entry => <article key={`${entry.chunk.id}:${entry.quote}`}><header><strong>{entry.document.file_name}</strong><span className={`cross-data-kind ${entry.document.data_kind}`}>{ragDataKindLabels[entry.document.data_kind]}</span></header><p className="cross-measures-locator">原文定位：{entry.chunk.locator} · {entry.annotationKind === 'literal_mention' ? '原文提及（摘录）' : '已登记引文'}</p><blockquote>{entry.quote}</blockquote>{!entry.links.length && <p className="cross-measures-mention">逐字命中举措名称，尚未形成关联证据记录；阶段和对象待核。</p>}<div className="cross-measures-records">{entry.links.map((link, index) => <div key={index}><strong>{ragPhaseLabels[link.phase] || link.phase}</strong><span>{link.stage || '阶段未记载'} · 对象：{link.object_ref || '原文对象尚未绑定'} · {ragReviewLabels[link.review_status]}</span><details><summary>原记录与材料版本</summary><p>{link.card_id} · 记录修订 {link.card_revision}</p><p>文档：{link.evidence.document_id}<br/>版本：{link.evidence.version}</p></details></div>)}</div><button type="button" onClick={() => locate(entry.document.document_id, entry.chunk.locator)}>定位完整原文片段</button>{entry.document.source && onEvidence && <button type="button" onClick={() => onEvidence([entry.document.source!.id])}>查看来源材料</button>}</article>)}</div></section>)}</div>
        {!entries.length && <p>所选材料中尚无可逐字定位的引用。</p>}
        {!!current.unresolved.length && <details className="cross-measures-unresolved"><summary>{current.unresolved.length}条引用尚未绑定当前材料快照</summary>{current.unresolved.map((reference, index) => <article key={index}><p>{reference.link.evidence.document_id} · {reference.link.evidence.locator} · {reasonLabels[reference.reason]}</p><blockquote>{reference.link.evidence.quote}</blockquote><p>引用版本：{reference.link.evidence.version} · {ragPhaseLabels[reference.link.phase] || reference.link.phase} · {ragReviewLabels[reference.link.review_status]}</p></article>)}</details>}
      </>}</div></div>
      {selectedChunk && selectedDocument && <section className="cross-measures-original" ref={rawRef} tabIndex={-1} aria-label="跨文本定位的原文片段"><header><h4>{selectedDocument.file_name} · {selectedChunk.locator}</h4><button type="button" onClick={() => setSelection(null)}>收起原文</button></header><pre>{selectedChunk.text}</pre><p>原件版本：{selectedDocument.version || '未登记'}</p><details><summary>查看前后上下文</summary>{selectedDocument.chunks.slice(Math.max(0, selectedDocument.chunks.indexOf(selectedChunk) - 1), selectedDocument.chunks.indexOf(selectedChunk) + 2).filter(chunk => chunk !== selectedChunk).map(chunk => <div key={chunk.id}><strong>{chunk.locator}</strong><pre>{chunk.text}</pre></div>)}</details></section>}
      <details className="cross-measures-manifest"><summary>查看导出材料清单与解析范围</summary>{bundle.documents.map(document => <article key={document.document_id}><strong>{document.file_name}</strong><p>{ragDataKindLabels[document.data_kind]} · {document.chunks.length}段已保存原文 · {document.parse.coverage === 'preview_only' ? '含表格预览' : document.parse.coverage === 'unavailable' ? '尚无可读原文' : '解析快照'}</p>{document.tables.map(table => <p key={table.table_id}>{table.label} · 导出{table.exported_rows}/{table.row_count}行{table.truncated ? ' · 已截取预览' : ''}</p>)}<p>版本：{document.version || '未登记'}</p></article>)}</details>
    </>}
  </section>
}
