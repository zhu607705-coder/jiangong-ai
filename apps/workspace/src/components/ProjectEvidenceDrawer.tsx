import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Source } from '../../../host/generated/contracts'
import type { Project } from '../api'
import type { StrategyPacket, StrategySource } from '../../../../packages/retrofit/strategy'
import { sourceHitFocus, type SourceHitFocusResult } from '../imports/retrieval-navigation'
import './ProjectEvidenceDrawer.css'

export type ProjectEvidenceReference = string | { source_id: string; claim?: string; quote?: string; locator?: string; version?: string }
export type ProjectEvidenceDrawerProps = {
  open: boolean; project: Project | null; packet?: StrategyPacket | null; refs: readonly ProjectEvidenceReference[]
  claim?: string; locator?: string; onClose: () => void; onOpenMaterials: (sourceId?: string) => void
}
type Reference = Exclude<ProjectEvidenceReference, string>
type EvidenceRow = { reference: Reference; registered?: Source; saved?: StrategySource; snapshot: boolean; missing?: string }
const localId = (id: string, projectId: string) => id.startsWith(`${projectId}:`) ? id.slice(projectId.length + 1) : id
const sameId = (first: string, second: string, projectId: string) => localId(first, projectId) === localId(second, projectId)
const classLabels = { public: '公开资料', internal: '内部资料', synthetic: '模拟资料', semi_synthetic: '半模拟资料' }
const scopeLabels = { object: '具体对象', area: '研究区域', background: '背景参考' }
const dateLabels = { verified: '已核验', search_only: '仅检索日期', conflict: '日期存在冲突', undated: '日期未登记' }
const focusMessages: Record<SourceHitFocusResult['status'], string> = {
  matched: '来源版本与连续原文核对通过，已标出引用。',
  'version-mismatch': '引用版本与所示来源不一致，未高亮。',
  'quote-mismatch': '该引文未在所示正文中连续出现，未高亮。',
  'version-unverified': '来源版本未核验，未高亮。',
}

function EvidenceOriginal({ row, project, packet, onOpenMaterials }: {
  row: EvidenceRow; project: Project; packet?: StrategyPacket | null; onOpenMaterials: (sourceId: string) => void
}) {
  const { reference, registered, saved, snapshot } = row
  const body = snapshot ? saved?.text || '' : registered?.untrusted_text || ''
  const version = snapshot ? saved?.document_version : registered?.hash || registered?.raw_hash
  const sourceId = saved?.id || registered?.id || reference.source_id
  const source = useMemo((): Source => snapshot ? {
    id: sourceId, title: saved?.title || sourceId, untrusted_text: body, hash: version,
    // These fields satisfy the existing text-check contract; displayed metadata remains the saved value.
    visibility: saved?.visibility || 'internal', data_class: saved?.data_class || 'internal', synthetic: packet?.synthetic || false,
  } : registered || { id: sourceId, title: sourceId, visibility: 'internal', data_class: 'internal', synthetic: false },
  [snapshot, sourceId, saved, registered, body, version, packet?.synthetic])
  const quote = reference.quote || '', expectedVersion = reference.version || ''
  const [check, setCheck] = useState<{ source: Source; quote: string; version: string; result: SourceHitFocusResult } | null>(null)
  useEffect(() => {
    let active = true
    if (quote.trim() && version && expectedVersion) void sourceHitFocus(source, {
      source, version: expectedVersion, text: quote, evidence_kind: 'source_text', version_origin: 'registered_hash',
    }).then(result => { if (active) setCheck({ source, quote, version: expectedVersion, result }) })
    return () => { active = false }
  }, [source, quote, version, expectedVersion])
  const result = check?.source === source && check.quote === quote && check.version === expectedVersion ? check.result : null
  const title = saved?.title || registered?.title || reference.source_id
  const dataClass = snapshot ? saved?.data_class : registered?.data_class
  const visibility = snapshot ? saved?.visibility : registered?.visibility
  const sourceLocator = snapshot ? saved?.locator : registered?.locator
  const publishedAt = snapshot ? saved?.published_at : registered?.published_at
  const scope = snapshot ? saved?.role === 'current' ? '本对象资料（结果所用范围）' : '对标参考资料（结果所用范围）'
    : registered?.evidence_scope ? scopeLabels[registered.evidence_scope] : '对象范围未登记'
  const status = !quote.trim() ? null : !version || !expectedVersion ? '未同时登记引用版本与来源版本，未高亮。'
    : result ? focusMessages[result.status] : '正在核对引用版本与原文…'
  return <article className="project-evidence-source" data-source-id={sourceId} data-source-origin={snapshot ? 'snapshot' : 'current'}>
    <header><span className="project-evidence-source-kind">{snapshot ? '结果保存的来源快照' : '当前资料台账'}</span><h3>{title}</h3><code>{sourceId}</code></header>
    {reference.claim && <div className="project-evidence-claim"><strong>调用处判断</strong><p>{reference.claim}</p></div>}
    {row.missing ? <p className="project-evidence-notice" role="status">{row.missing}</p> : <>
      <dl className="project-evidence-metadata">
        <div><dt>来源定位</dt><dd>{sourceLocator || '未登记'}</dd></div>
        {reference.locator && <div><dt>引用位置</dt><dd>{reference.locator}</dd></div>}
        <div><dt>资料日期</dt><dd>{saved?.source_date ? `材料标注日期 ${saved.source_date}（未核验）` : publishedAt || '未登记'}
          {!snapshot && publishedAt && <span> · {registered?.date_status ? dateLabels[registered.date_status] : '核验状态未登记'}</span>}</dd></div>
        <div><dt>来源版本</dt><dd>{version || '未保存来源版本'}</dd></div>
        {reference.version && <div><dt>引用版本</dt><dd>{reference.version}</dd></div>}
        <div><dt>对象范围</dt><dd>{scope}{!snapshot && !!registered?.object_refs?.length && <span> · {registered.object_refs.join('、')}</span>}</dd></div>
        <div><dt>资料类别</dt><dd>{dataClass ? classLabels[dataClass] : '类别未保存'} · {visibility === 'internal' ? '项目内部' : visibility === 'public' ? '公开来源' : '访问范围未保存'}</dd></div>
        {snapshot && <div><dt>结果基准</dt><dd>项目 {project.id} · 资料 v{packet?.context_version} · 保存于 {packet?.created_at || '未登记'}</dd></div>}
      </dl>
      {quote.trim() && <div className="project-evidence-cited"><strong>调用处引文</strong><blockquote>{quote}</blockquote><p role="status" data-quote-check={result?.status || (!version || !expectedVersion ? 'version-unverified' : 'checking')}>{status}</p></div>}
      <h4>{snapshot ? '保存的原文' : '来源正文'}</h4>
      {body ? <blockquote className="project-evidence-original">{result?.status === 'matched'
        ? <>{result.before}<mark>{result.quote}</mark>{result.after}</> : body}</blockquote>
        : <p className="project-evidence-notice">该来源未保存可读正文。</p>}
    </>}
    {!row.missing && <button type="button" className="project-evidence-materials" onClick={() => onOpenMaterials(sourceId)}>进入资料台账查看此来源</button>}
  </article>
}

/** Read-only, project-scoped evidence view. It never fetches or changes the selected project. */
export default function ProjectEvidenceDrawer({ open, project, packet, refs, claim, locator, onClose, onOpenMaterials }: ProjectEvidenceDrawerProps) {
  const headingId = useId(), dialogRef = useRef<HTMLElement>(null), closeRef = useRef<HTMLButtonElement>(null)
  const onCloseRef = useRef(onClose); onCloseRef.current = onClose
  useLayoutEffect(() => {
    if (!open || typeof document === 'undefined') return
    const trigger = document.activeElement as HTMLElement | null, body = document.body, previousOverflow = body.style.overflow
    body.style.overflow = 'hidden'
    closeRef.current?.focus({ preventScroll: true })
    const focusables = () => [...(dialogRef.current?.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, summary, [tabindex]') || [])]
      .filter(element => !element.hasAttribute('disabled') && (!element.hasAttribute('tabindex') || element.tabIndex >= 0) && !element.closest('[hidden], [inert], [aria-hidden="true"]'))
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onCloseRef.current(); return }
      if (event.key !== 'Tab') return
      const elements = focusables(), first = elements[0], last = elements.at(-1), active = document.activeElement
      if (!first || !last) { event.preventDefault(); closeRef.current?.focus(); return }
      if (event.shiftKey && (active === first || !dialogRef.current?.contains(active))) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && (active === last || !dialogRef.current?.contains(active))) { event.preventDefault(); first.focus() }
    }
    const containFocus = (event: FocusEvent) => { if (!dialogRef.current?.contains(event.target as Node)) closeRef.current?.focus({ preventScroll: true }) }
    document.addEventListener('keydown', keydown, true)
    document.addEventListener('focusin', containFocus, true)
    return () => {
      document.removeEventListener('keydown', keydown, true)
      document.removeEventListener('focusin', containFocus, true)
      body.style.overflow = previousOverflow
      if (trigger?.isConnected) trigger.focus({ preventScroll: true })
    }
  }, [open])
  if (!open || typeof document === 'undefined') return null
  const wrongProject = !!project && (project.input.project_id !== project.id || !!packet && packet.project_id !== project.id)
  const wrongSynthetic = !!project && !!packet && packet.synthetic !== project.input.synthetic
  const invalid = wrongProject || wrongSynthetic
  const historical = !!project && !!packet && packet.context_version !== project.context_version
  const rows: EvidenceRow[] = project && !invalid ? refs.map(value => {
    const reference = typeof value === 'string' ? { source_id: value } : value
    const saved = packet?.sources.find(source => sameId(source.id, reference.source_id, project.id))
    if (saved?.project_id && saved.project_id !== project.id) return { reference, snapshot: true, missing: '该来源登记在其他项目，已拒绝展示。' }
    if (saved) return { reference, saved, snapshot: true }
    if (historical) return { reference, snapshot: true, missing: '本结果未保存此来源；当前资料不能代替历史原文。' }
    const registered = project.input.sources.find(source => sameId(source.id, reference.source_id, project.id))
    return { reference, registered, snapshot: false, missing: registered ? undefined : '当前项目未保存此来源。' }
  }) : []
  const browse = (sourceId?: string) => { onClose(); onOpenMaterials(sourceId) }
  return createPortal(<div className="project-evidence-backdrop" onClick={event => { if (event.target === event.currentTarget) onClose() }}>
    <section ref={dialogRef} className="project-evidence-drawer" role="dialog" aria-modal="true" aria-labelledby={headingId}>
      <header className="project-evidence-heading"><div><span>原文与来源</span><h2 id={headingId}>依据详情</h2><p>{project?.name || '尚未选择项目'}</p></div><button ref={closeRef} type="button" aria-label="关闭依据详情" onClick={onClose}>关闭 <span aria-hidden="true">×</span></button></header>
      <div className="project-evidence-body">
        {!invalid && claim && <div className="project-evidence-claim"><strong>调用处判断</strong><p>{claim}</p>{locator && <small>判断位置：{locator}</small>}</div>}
        {!invalid && !claim && locator && <p className="project-evidence-context">调用位置：{locator}</p>}
        {!project ? <p className="project-evidence-notice" role="status">选择项目后查看其来源原文。</p>
          : invalid ? <p className="project-evidence-notice" role="alert">{wrongProject ? '所传结果或资料属于其他项目，已拒绝展示。' : '所传结果与当前项目的模拟状态不一致，已拒绝展示。'}</p>
          : <>{packet && <p className={`project-evidence-baseline${historical ? ' is-historical' : ''}`} role="status">{historical
            ? `历史结果快照 · 资料 v${packet.context_version}（当前资料 v${project.context_version}）。原文沿用该结果保存的版本。`
            : `本项目结果快照 · 资料 v${packet.context_version}。来源正文沿用结果保存的版本。`}</p>}
            {!rows.length && <p className="project-evidence-notice">调用处未登记来源引用。</p>}
            {rows.map((row, index) => <EvidenceOriginal key={`${project.id}:${row.reference.source_id}:${index}`} row={row} project={project} packet={packet} onOpenMaterials={browse} />)}</>}
      </div>
      <footer className="project-evidence-footer">{project && !invalid && <button type="button" onClick={() => browse()}>进入完整资料台账</button>}<span>Esc 关闭并返回原位置</span></footer>
    </section>
  </div>, document.body)
}
