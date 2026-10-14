import { useEffect, useState } from 'react'
import type { ActionChunk, ExperienceCard, Source } from '../../../host/generated/contracts'
import { cardsForChunk, entriesForChunk, evidenceMatchesChunk, recordEvidence } from '../../../../packages/experience/lineage'
import { groupMeasureCards } from '../../../../packages/experience/presentation'
import { api } from '../api'
import type { ParsedDocument } from './graph-model'
import './document-evidence-lineage.css'

const fieldLabels: Record<string,string> = {decision_question:'决策问题',background:'背景',key_conditions:'关键条件',alternatives:'备选方案',proposal:'提议',actual_decision:'实际决策',decision_basis:'决策依据',implementation:'实际实施',outcome:'实际结果',boundary:'适用边界'}
const reviewLabels = {draft:'草稿待复核',approved:'已审核',rejected:'复核未通过'}

export default function DocumentEvidenceLineage({ projectId, revision, documents, sources, onEvidence }: {
  projectId: string; revision: number; documents: ParsedDocument[]; sources: Source[]; onEvidence?: (refs: string[]) => void;
}) {
  const scope = `${projectId}:${revision}`
  const [documentId, setDocumentId] = useState(''), [chunkId, setChunkId] = useState('')
  const [cards, setCards] = useState<{scope: string; rows: ExperienceCard[]; error: string; loading: boolean}>({ scope: '', rows: [], error: '', loading: true })
  const [loaded, setLoaded] = useState<{key: string; chunks: ActionChunk[]; loading: boolean; error: string}>({ key: '', chunks: [], loading: true, error: '' })
  const [retry, setRetry] = useState(0)
  const [view, setView] = useState<'evidence'|'all'>('evidence')
  const currentCards = cards.scope === scope ? cards.rows : []
  const document = documents.find(row => row.id === documentId)
    || documents.find(row => !documentId && currentCards.some(card => recordEvidence(card).some(evidence => evidence.document_id === row.id && evidence.version === row.hash)))
    || documents[0]
  useEffect(() => {
    const controller = new AbortController()
    setCards({scope, rows: [], error: '', loading: true})
    void api<{cards: ExperienceCard[]}>(`/projects/${encodeURIComponent(projectId)}/knowledge/pipeline`, undefined, controller.signal)
      .then(result => { if (!controller.signal.aborted) setCards({ scope, rows: result.cards, error: '', loading: false }) })
      .catch(error => { if (!controller.signal.aborted) setCards({scope, rows:[], error: error instanceof Error ? error.message : '证据引用暂不可读', loading: false}) })
    return () => controller.abort()
  }, [projectId, scope, retry])
  const key = `${scope}:${document?.id || ''}:${document?.hash || ''}`
  useEffect(() => {
    if (!document || (!documentId && (cards.loading || cards.scope !== scope))) return
    const controller = new AbortController()
    setChunkId(''); setLoaded({ key, chunks: [], loading: true, error: '' })
    void api<{chunks: ActionChunk[]}>(`/projects/${encodeURIComponent(projectId)}/knowledge/chunks`, { document_id: document.id }, controller.signal)
      .then(result => { if (!controller.signal.aborted) setLoaded({ key, chunks: result.chunks, loading: false, error: '' }) })
      .catch(error => { if (!controller.signal.aborted) setLoaded({ key, chunks: [], loading: false, error: error instanceof Error ? error.message : '暂时无法读取材料拆分' }) })
    return () => controller.abort()
  }, [projectId, key, documentId, cards.loading, cards.scope, retry])
  const chunks = loaded.key === key ? loaded.chunks : []
  const citedChunks = chunks.filter(chunk => cardsForChunk(chunk, currentCards).length > 0)
  const visibleChunks = view === 'all' ? chunks : citedChunks
  const selected = visibleChunks.find(chunk => chunk.id === chunkId)
    || visibleChunks.find(chunk => currentCards.some(card => (card.knowledge?.factors || []).some(factor => typeof factor.value === 'number' && factor.evidence.some(evidence => evidenceMatchesChunk(evidence, chunk)))))
    || visibleChunks.find(chunk => chunk.kind === 'action') || visibleChunks[0]
  const linked = selected ? cardsForChunk(selected, currentCards) : []
  const documentCards = currentCards.filter(card => recordEvidence(card).some(evidence => evidence.document_id === document?.id && evidence.version === document?.hash))
  const evidenceCount = new Set(documentCards.flatMap(card => recordEvidence(card).filter(evidence => evidence.document_id === document?.id && evidence.version === document?.hash).map(evidence => JSON.stringify([evidence.locator,evidence.quote])))).size
  const groups = groupMeasureCards(linked)
  const source = sources.find(source => source.locator === `document:${document?.id}` || source.id === document?.id || source.id === `PUBLIC-DOCUMENT-${document?.id}`)
  if (!documents.length) return <div className="document-lineage-empty">材料导入并完成解析后，这里会显示原文片段、证据摘录和关联举措。</div>
  return <section className="document-lineage" aria-label="材料拆分与证据关联">
    <header><div><h3>材料怎样拆成证据</h3><p>选一份原件，点选原文片段，查看引用它的字段与举措。</p></div><label>选择原件<select aria-label="选择拆分原件" value={document?.id || ''} onChange={event => setDocumentId(event.target.value)}>{documents.map(row => <option value={row.id} key={row.id}>{row.fileName}</option>)}</select></label></header>
    <div className="document-lineage-stages"><div><span>原始材料</span><strong>{documents.length}份</strong></div><div><span>本材料原文片段</span><strong>{loaded.loading || loaded.key !== key ? '读取中' : loaded.error ? '暂不可读' : `${chunks.length}段`}</strong></div><div><span>已引用的证据摘录</span><strong>{cards.scope !== scope || cards.loading ? '读取中' : cards.error ? '暂不可读' : `${evidenceCount}条`}</strong></div><div><span>本材料关联举措</span><strong>{cards.scope !== scope || cards.loading ? '读取中' : cards.error ? '暂不可读' : `${groupMeasureCards(documentCards).length}类`}</strong></div></div>
    {cards.error && <p role="alert">证据引用读取失败：{cards.error}<button type="button" onClick={() => setRetry(value => value + 1)}>重新读取</button></p>}
    <div className="document-lineage-filter"><button type="button" aria-pressed={view === 'evidence'} onClick={() => setView('evidence')}>已被引用的片段 · {citedChunks.length}</button><button type="button" aria-pressed={view === 'all'} onClick={() => setView('all')}>全部原文片段</button></div>
    {loaded.error ? <p role="alert">{loaded.error}<button onClick={() => setRetry(value => value + 1)}>重新读取</button></p> : <div className="document-lineage-layout"><div className="document-lineage-chunks" aria-label="原文拆分片段">{visibleChunks.map(chunk => <button type="button" key={chunk.id} aria-pressed={selected?.id === chunk.id} onClick={() => setChunkId(chunk.id)}><strong>片段 {chunks.indexOf(chunk) + 1} · {chunk.kind === 'action' ? '举措内容' : '背景与上下文'}</strong><span>{chunk.spans[0]?.locator}</span><p>{chunk.text.slice(0, 110)}{chunk.text.length > 110 ? '…' : ''}</p></button>)}{!visibleChunks.length && !loaded.loading && <p>当前没有已引用片段，可以切换查看全部原文。</p>}</div><div className="document-lineage-detail">
      {selected && <><h4>原文与定位</h4>{selected.spans.map((span, index) => <div key={index}><p>{document?.fileName} · {span.locator}</p><blockquote>{span.quote}</blockquote></div>)}
      <h4>这段原文对应的证据与举措</h4>{cards.loading || cards.scope !== scope ? <p>正在读取证据引用…</p> : cards.error ? <p>证据引用暂不可读，保留原文供核对。</p> : groups.length ? groups.map(group => <article key={group.id}><header><strong>{group.title}</strong><span>{group.cards.length}条关联记录</span></header><p>{[...new Set(group.cards.map(card => reviewLabels[card.status]))].join(' · ')} · 相同值合并展示</p>{new Set(selected.text.match(/\d+幢/g)||[]).size>1 && <p className="document-lineage-scope-note">原文涉及多栋建筑，户数按原文的整体范围理解；草稿对象绑定需逐项复核。</p>}<dl>{entriesForChunk(selected,group.cards).map((entry,index)=><div key={index}><dt>{fieldLabels[entry.label] || entry.label}</dt><dd>{entry.value} {entry.unit}<details><summary>查看对象与阶段</summary><p>{entry.object || '原文对象尚未绑定'} · {entry.stage} · {entry.cardIds.length}条关联记录</p></details></dd></div>)}</dl><details><summary>查看{group.cards.length}条关联记录与审核状态</summary>{group.cards.map(card=><p key={card.id}>{card.title} · {reviewLabels[card.status]} · {card.stage}<br/>{card.id}</p>)}</details></article>) : <p>这段原文当前尚无同版本、同定位的举措引用；原文片段与审核后的事实分别记录。</p>}
      <details><summary>查看材料版本与拆分标识</summary><p>原件版本：{selected.document_version}</p><p>片段：{selected.id}</p><p>对象：{selected.object_ref || '未明确对象'} · 阶段：{selected.stage || '原文未记载'}</p></details>{source && onEvidence && <button type="button" onClick={() => onEvidence([source.id])}>定位完整材料原文</button>}</>}
    </div></div>}
  </section>
}
