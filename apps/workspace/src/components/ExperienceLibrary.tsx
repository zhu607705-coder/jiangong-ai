import { useEffect, useRef, useState } from 'react'
import type { ExperienceCard, ExperienceDraft, ExperienceEvidence, ExperienceField } from '../../../host/generated/contracts'
import { api } from '../api'
import WaitingScene from './WaitingScene'
import './experience-library.css'

type Props = { projectId: string; revision: number; synthetic: boolean; asOf: string; onProjectUpdated: () => void | Promise<void> }
type Document = { id: string; file_name: string; created_at?: string; parser_result?: { source_hash?: string; status?: string; segments?: { locator: string; text: string }[] } }
type Match = { card: ExperienceCard; similar_conditions: string[]; important_differences: string[]; reuse_premises: string[] }
const fields: { key: ExperienceField['key']; label: string }[] = [
  { key: 'decision_question', label: '决策问题' }, { key: 'background', label: '背景与目标' },
  { key: 'key_conditions', label: '关键条件' }, { key: 'alternatives', label: '备选方案' },
  { key: 'proposal', label: '提议方案' }, { key: 'actual_decision', label: '实际决策' },
  { key: 'decision_basis', label: '决策依据' },
  { key: 'implementation', label: '实施记录' }, { key: 'outcome', label: '实际结果' },
  { key: 'applicability', label: '适用边界与借鉴前提' },
]
const statusLabel = { draft: '待复核草稿', approved: '已审核', rejected: '审核未通过' }
const reason = (error: unknown) => error instanceof Error ? error.message : '请求暂未完成，请重试。'
const asDraft = (card: ExperienceCard): ExperienceDraft => ({ title: card.title, project_type: card.project_type,
  development_mode: card.development_mode, stage: card.stage,
  fields: fields.map(({ key }) => { const field = card.fields.find(item => item.key === key); return {
    key, value: field?.value ?? null, evidence: (field?.evidence || []).map(item => ({ ...item })),
  } }) })

function Evidence({ evidence, documents }: { evidence: ExperienceEvidence[]; documents: Document[] }) {
  return <div className="experience-evidence">{evidence.map((item, index) => <details key={`${item.document_id}:${item.locator}:${index}`}>
    <summary>{documents.find(document => document.id === item.document_id)?.file_name || item.document_id} · {item.locator}</summary>
    <blockquote>{item.quote}</blockquote><small>文档版本 {item.version}</small>
  </details>)}</div>
}

function CardContent({ card, documents }: { card: ExperienceCard; documents: Document[] }) {
  return <dl className="experience-fields">{fields.map(({ key, label }) => {
    const field = card.fields.find(item => item.key === key)
    return <div key={key}><dt>{label}</dt><dd>{field?.value || <span className="experience-missing">待补充</span>}
      {!!field?.evidence.length && <Evidence evidence={field.evidence} documents={documents} />}</dd></div>
  })}</dl>
}

export default function ExperienceLibrary({ projectId, revision, synthetic, asOf, onProjectUpdated }: Props) {
  const requestKey = `${projectId}\u0000${revision}\u0000${synthetic}\u0000${asOf}`
  const activeKey = useRef(requestKey); activeKey.current = requestKey
  const [loaded, setLoaded] = useState<{ key: string; documents: Document[]; cards: ExperienceCard[]; error: string; loading: boolean }>({ key: '', documents: [], cards: [], error: '', loading: true })
  const [mode, setMode] = useState<'project' | 'search'>('project')
  const [selectedDocuments, setSelectedDocuments] = useState<string[]>([])
  const [expanded, setExpanded] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ card: ExperienceCard; draft: ExperienceDraft } | null>(null)
  const [reviewNote, setReviewNote] = useState('')
  const [busy, setBusy] = useState('')
  const [actionError, setActionError] = useState('')
  const [notice, setNotice] = useState('')
  const [warnings, setWarnings] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [projectType, setProjectType] = useState('')
  const [developmentMode, setDevelopmentMode] = useState('')
  const [stage, setStage] = useState('')
  const [matches, setMatches] = useState<Match[]>([])
  const [searched, setSearched] = useState(false)
  const [searching, setSearching] = useState(false)
  const searchSequence = useRef(0)
  const base = `/projects/${encodeURIComponent(projectId)}/experiences`

  useEffect(() => {
    const controller = new AbortController()
    setLoaded({ key: requestKey, documents: [], cards: [], error: '', loading: true })
    setSelectedDocuments([]); setExpanded(null); setEditing(null); setReviewNote(''); setBusy('')
    setActionError(''); setNotice(''); setWarnings([]); setMatches([]); setSearched(false); setSearching(false)
    searchSequence.current += 1
    void Promise.all([
      api<Document[]>(`/projects/${encodeURIComponent(projectId)}/documents`, undefined, controller.signal),
      api<{ cards: ExperienceCard[] }>(base, undefined, controller.signal),
    ]).then(([documents, result]) => {
      if (!controller.signal.aborted && activeKey.current === requestKey) setLoaded({ key: requestKey, documents, cards: result.cards, error: '', loading: false })
    }).catch(error => {
      if (!controller.signal.aborted && activeKey.current === requestKey) setLoaded({ key: requestKey, documents: [], cards: [], error: reason(error), loading: false })
    })
    return () => controller.abort()
  }, [requestKey, projectId, base])

  const ready = loaded.key === requestKey
  const documents = ready ? loaded.documents : []
  const cards = ready ? loaded.cards : []
  const isLoading = !ready || loaded.loading
  const refreshCards = (next: ExperienceCard[]) => setLoaded(current => current.key === requestKey
    ? { ...current, cards: [...next, ...current.cards.filter(card => !next.some(item => item.id === card.id))] } : current)

  const extract = async () => {
    if (!selectedDocuments.length || busy) return
    const key = requestKey
    setBusy('extract'); setActionError(''); setNotice(''); setWarnings([])
    try {
      const result = await api<{ cards: ExperienceCard[]; warnings: string[]; model_calls: number }>(`${base}/extract`, { document_ids: selectedDocuments, use_model: false })
      if (activeKey.current !== key) return
      refreshCards(result.cards); setWarnings(result.warnings || []); setSelectedDocuments([])
      setExpanded(result.cards[0]?.id || null)
      setNotice(result.cards.length ? `已生成 ${result.cards.length} 张经验草稿，请对照原文复核。` : '未提取出经验卡；可先补充有决策记录的材料。')
    } catch (error) { if (activeKey.current === key) setActionError(reason(error)) }
    finally { if (activeKey.current === key) setBusy('') }
  }

  const editField = (key: ExperienceField['key'], patch: Partial<ExperienceField>) => setEditing(current => current ? {
    ...current, draft: { ...current.draft, fields: current.draft.fields.map(field => field.key === key ? { ...field, ...patch } : field) },
  } : current)
  const save = async () => {
    if (!editing || busy) return
    const key = requestKey
    const draft: ExperienceDraft = { ...editing.draft, title: editing.draft.title.trim(),
      fields: editing.draft.fields.map(field => ({ ...field, value: field.value?.trim() || null,
        evidence: field.value?.trim() ? field.evidence.map(item => ({ ...item, locator: item.locator.trim(), quote: item.quote.trim() })) : [],
      })) }
    if (!draft.title) { setActionError('请填写经验卡标题。'); return }
    const unsupported = draft.fields.find(field => field.value && (!field.evidence.length || field.evidence.some(item => !item.document_id || !item.version || !item.locator || !item.quote)))
    if (unsupported) { setActionError(`请为“${fields.find(field => field.key === unsupported.key)?.label}”选择来源文档并填写原文定位、逐字引文。`); return }
    setBusy('save'); setActionError(''); setNotice('')
    try {
      const card = await api<ExperienceCard>(`${base}/${encodeURIComponent(editing.card.id)}/update`, { draft, expected_revision: editing.card.revision })
      if (activeKey.current !== key) return
      refreshCards([card]); setEditing(null); setNotice('经验草稿已保存，仍需审核。')
    } catch (error) { if (activeKey.current === key) setActionError(reason(error)) }
    finally { if (activeKey.current === key) setBusy('') }
  }

  const review = async (card: ExperienceCard, status: 'approved' | 'rejected') => {
    if (busy) return
    if (!reviewNote.trim()) { setActionError('请填写复核备注，说明核对了哪些材料或未通过的原因。'); return }
    const key = requestKey
    setBusy(`review:${card.id}`); setActionError(''); setNotice('')
    try {
      const updated = await api<ExperienceCard>(`${base}/${encodeURIComponent(card.id)}/review`, { expected_revision: card.revision, status, note: reviewNote.trim() })
      if (activeKey.current !== key) return
      refreshCards([updated]); setReviewNote(''); setNotice(status === 'approved' ? '经验卡已审核，可供其他项目检索参考。' : '已记录未通过原因。')
    } catch (error) { if (activeKey.current === key) setActionError(reason(error)) }
    finally { if (activeKey.current === key) setBusy('') }
  }

  const search = async () => {
    const key = requestKey, sequence = ++searchSequence.current
    setSearching(true); setActionError(''); setNotice('')
    const parameters = new URLSearchParams({ q: query.trim(), project_type: projectType.trim(), development_mode: developmentMode.trim(), stage: stage.trim(), exclude_project: projectId, synthetic: String(synthetic), as_of: asOf })
    try {
      const result = await api<{ items: Match[] }>(`/experiences/search?${parameters}`)
      if (activeKey.current === key && searchSequence.current === sequence) { setMatches(result.items); setSearched(true) }
    } catch (error) { if (activeKey.current === key && searchSequence.current === sequence) setActionError(reason(error)) }
    finally { if (activeKey.current === key && searchSequence.current === sequence) setSearching(false) }
  }

  const reuse = async (card: ExperienceCard) => {
    if (busy) return
    const key = requestKey
    setBusy(`reuse:${card.id}`); setActionError(''); setNotice('')
    try {
      await api(`${base}/reuse`, { card_id: card.id, expected_version: revision, expected_card_revision: card.revision })
      if (activeKey.current !== key) return
      setNotice('已加入当前项目的经验参考，可在后续研判时查看。')
      await onProjectUpdated()
    } catch (error) { if (activeKey.current === key) setActionError(reason(error)) }
    finally { if (activeKey.current === key) setBusy('') }
  }

  const heading = <header className="experience-heading"><div><small>PROJECT EXPERIENCE</small><h3>项目经验沉淀</h3><p>将调研报告、测算表、会议纪要和复盘材料中的一次决策整理为经验卡，保留原文依据。</p></div>
    <span className="experience-mode-badge">{synthetic ? '合成资料演示' : '项目资料'}</span></header>
  if (isLoading || loaded.error) return <section className="experience-library" aria-label="项目经验沉淀">{heading}
    {isLoading ? <WaitingScene compact variant="research" title="正在读取项目经验" detail="读取历史材料、经验草稿与审核记录…" /> : <p role="alert">项目经验暂不可读：{loaded.error}</p>}</section>

  return <section className="experience-library" aria-label="项目经验沉淀">{heading}
    <div className="experience-tabs" aria-label="经验查看方式"><button type="button" aria-pressed={mode === 'project'} onClick={() => setMode('project')}>本项目经验 · {cards.length}</button>
      <button type="button" aria-pressed={mode === 'search'} onClick={() => setMode('search')}>检索已审核经验</button></div>
    {actionError && <p className="experience-error" role="alert">{actionError}</p>}
    {notice && <p className="experience-notice" role="status">{notice}</p>}
    {mode === 'project' ? <>
      <div className="experience-extract"><div><h4>从历史材料提取草稿</h4><p>选择已上传的决策材料。原文未记载的理由、实施或结果留作待补充。</p></div>
        {documents.length ? <><fieldset disabled={!!busy}><legend>选择历史材料</legend><div className="experience-document-list">{documents.map(document => <label key={document.id}>
          <input type="checkbox" checked={selectedDocuments.includes(document.id)} onChange={event => setSelectedDocuments(current => event.target.checked ? [...current, document.id] : current.filter(id => id !== document.id))} />
          <span>{document.file_name}<small>{document.parser_result?.status === 'ocr_required' ? '待 OCR，暂缺可提取正文' : '已保存材料'}</small></span></label>)}</div></fieldset>
          <button type="button" className="experience-primary" disabled={!selectedDocuments.length || !!busy} onClick={() => void extract()}>{busy === 'extract' ? '正在提取…' : '提取经验草稿'}</button><small className="experience-extract-note">使用已保存的解析内容进行本地提取。</small></>
          : <p className="experience-empty">先在上方上传历史项目材料，再提取经验卡。</p>}
        {!!warnings.length && <ul className="experience-warnings">{warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
      </div>
      {!cards.length && <p className="experience-empty">尚无经验卡。提取后的草稿会在这里逐项展示决策、实施和结果。</p>}
      <div className="experience-card-list">{cards.map(card => <article className="experience-card" key={card.id}>
        <button className="experience-card-heading" type="button" aria-expanded={expanded === card.id} onClick={() => { setExpanded(expanded === card.id ? null : card.id); setEditing(null); setReviewNote(''); setActionError('') }}>
          <span><strong>{card.title}</strong><small>{[card.project_type, card.development_mode, card.stage].filter(Boolean).join(' · ') || '项目分类待补充'}</small></span>
          <span className={`experience-status is-${card.status}`}>{statusLabel[card.status]} · v{card.revision}</span></button>
        {expanded === card.id && <div className="experience-card-body">
          {editing?.card.id === card.id ? <form className="experience-editor" onSubmit={event => { event.preventDefault(); void save() }}>
            <div className="experience-meta-editor">{([
              ['title', '经验卡标题'], ['project_type', '项目类型'], ['development_mode', '开发或改造模式'], ['stage', '项目阶段'],
            ] as const).map(([key, label]) => <label key={key}>{label}<input disabled={!!busy} value={editing.draft[key]} onChange={event => setEditing(current => current ? { ...current, draft: { ...current.draft, [key]: event.target.value } } : current)} /></label>)}</div>
            {fields.map(({ key, label }) => { const field = editing.draft.fields.find(item => item.key === key)!
              return <fieldset className="experience-field-editor" key={key} disabled={!!busy}><legend>{label}</legend>
                <textarea aria-label={`${label}内容`} value={field.value || ''} placeholder="原文未记载时留空" onChange={event => editField(key, { value: event.target.value || null })} />
                {field.evidence.map((evidence, index) => <div className="experience-reference-editor" key={index}>
                  <label>来源文档<select aria-label={`${label}来源文档${index + 1}`} value={evidence.document_id} onChange={event => {
                    const document = documents.find(item => item.id === event.target.value)
                    editField(key, { evidence: field.evidence.map((item, i) => i === index ? { ...item, document_id: event.target.value, version: document?.parser_result?.source_hash || '' } : item) })
                  }}><option value="">选择材料</option>{evidence.document_id && !documents.some(document => document.id === evidence.document_id) && <option value={evidence.document_id}>{evidence.document_id}（原引用）</option>}
                    {documents.map(document => <option key={document.id} value={document.id}>{document.file_name}</option>)}</select></label>
                  <label>原文定位<input aria-label={`${label}原文定位${index + 1}`} value={evidence.locator} placeholder="如 line:3、paragraph:2" onChange={event => editField(key, { evidence: field.evidence.map((item, i) => i === index ? { ...item, locator: event.target.value } : item) })} /></label>
                  <label className="experience-quote-editor">逐字引文<textarea aria-label={`${label}逐字引文${index + 1}`} value={evidence.quote} onChange={event => editField(key, { evidence: field.evidence.map((item, i) => i === index ? { ...item, quote: event.target.value } : item) })} /></label>
                  <small>版本 {evidence.version || '选择文档后读取'}</small><button type="button" onClick={() => editField(key, { evidence: field.evidence.filter((_, i) => i !== index) })}>移除引用</button>
                </div>)}
                <button type="button" disabled={field.evidence.length >= 5} onClick={() => editField(key, { evidence: [...field.evidence, { document_id: '', version: '', locator: '', quote: '' }] })}>为{label}添加原文引用</button>
              </fieldset>
            })}
            <div className="experience-actions"><button className="experience-primary" type="submit" disabled={!!busy}>{busy === 'save' ? '正在保存…' : '保存草稿'}</button><button type="button" disabled={!!busy} onClick={() => { setEditing(null); setActionError('') }}>取消编辑</button></div>
          </form> : <><CardContent card={card} documents={documents} />
            {card.review_note && <p className="experience-review-record">审核记录：{card.review_note}</p>}
            {card.status === 'draft' && <div className="experience-review"><button type="button" disabled={!!busy} onClick={() => { setEditing({ card, draft: asDraft(card) }); setActionError('') }}>编辑草稿与原文引用</button>
              <label>复核备注<textarea value={reviewNote} disabled={!!busy} placeholder="说明已核对的材料、适用边界或未通过原因" onChange={event => setReviewNote(event.target.value)} /></label>
              <div className="experience-actions"><button type="button" className="experience-primary" disabled={!!busy} onClick={() => void review(card, 'approved')}>{busy === `review:${card.id}` ? '正在提交…' : '审核通过'}</button>
                <button type="button" disabled={!!busy} onClick={() => void review(card, 'rejected')}>审核不通过</button></div></div>}
          </>}
        </div>}
      </article>)}</div>
    </> : <>
      <form className="experience-search" onSubmit={event => { event.preventDefault(); void search() }}>
        <label className="experience-search-query">决策问题或关键条件<input value={query} onChange={event => setQuery(event.target.value)} placeholder="如加装电梯、居民协商、管网改造" /></label>
        <label>项目类型<input value={projectType} onChange={event => setProjectType(event.target.value)} placeholder="如老旧小区改造" /></label>
        <label>开发或改造模式<input value={developmentMode} onChange={event => setDevelopmentMode(event.target.value)} placeholder="如整治提升" /></label>
        <label>项目阶段<input value={stage} onChange={event => setStage(event.target.value)} placeholder="如前期策划" /></label>
        <button type="submit" className="experience-primary" disabled={searching}>{searching ? '正在检索…' : '检索经验'}</button>
      </form>
      <p className="experience-search-note">检索截至 {asOf} 的其他项目已审核经验。原项目的提议、决策依据、实施和实际结果分别保留；加入当前项目后作为调查线索与候选方案参考。</p>
      {searching && <WaitingScene compact variant="research" title="正在匹配项目经验" detail="按项目类型、模式、阶段和条件检索已审核记录…" />}
      {searched && !searching && !matches.length && <p className="experience-empty">没有匹配的已审核经验，可调整条件后再次检索。</p>}
      {!searching && <div className="experience-card-list">{matches.map(match => <article className="experience-card" key={match.card.id}>
        <header className="experience-match-heading"><div><h4>{match.card.title}</h4><p>{[match.card.project_type, match.card.development_mode, match.card.stage].filter(Boolean).join(' · ')}</p><small>来源项目 {match.card.project_id} · v{match.card.revision}</small></div>
          <button type="button" className="experience-primary" disabled={!!busy} onClick={() => void reuse(match.card)}>{busy === `reuse:${match.card.id}` ? '正在加入…' : '加入当前项目参考'}</button></header>
        <div className="experience-comparison">{([
          ['相似条件', match.similar_conditions], ['重要差异', match.important_differences], ['借鉴前提', match.reuse_premises],
        ] as const).map(([label, values]) => <div key={label}><strong>{label}</strong>{values.length ? <ul>{values.map((value, index) => <li key={index}>{value}</li>)}</ul> : <p>未记录</p>}</div>)}</div>
        <details className="experience-match-details"><summary>查看完整经验与原文依据</summary><CardContent card={match.card} documents={[]} />{match.card.review_note && <p className="experience-review-record">审核记录：{match.card.review_note}</p>}</details>
      </article>)}</div>}
    </>}
  </section>
}
