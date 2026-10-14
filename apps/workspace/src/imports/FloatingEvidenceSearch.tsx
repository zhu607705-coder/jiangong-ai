import { useEffect, useId, useRef, useState } from 'react'
import type { RetrievalHit } from '../../../../packages/experience/retrieval'
import RagEvidenceSearch from './RagEvidenceSearch'
import './floating-evidence-search.css'

type Props = {
  projectId?: string | null; projectName?: string; projects?: { id: string; name: string }[];
  onSelectProject?: (id: string) => void | Promise<void>; onEvidence?: (refs: string[]) => void;
  onLocateHit?: (hit: RetrievalHit) => void; onOpenMaterials?: () => void; openRequest?: number;
}

/** A view of the existing project retrieval; no separate index, search client or material writes. */
export default function FloatingEvidenceSearch({ projectId, projectName, projects = [], onSelectProject, onEvidence, onLocateHit, onOpenMaterials, openRequest = 0 }: Props) {
  const [open, setOpen] = useState(false)
  const [selectingProject, setSelectingProject] = useState(false), [selectionError, setSelectionError] = useState('')
  const id = useId(), triggerRef = useRef<HTMLButtonElement>(null), panelRef = useRef<HTMLDivElement>(null)
  const previousOpenRequest = useRef(0)
  const close = () => { setOpen(false); triggerRef.current?.focus() }
  useEffect(() => {
    if (openRequest > 0 && openRequest !== previousOpenRequest.current) setOpen(true)
    previousOpenRequest.current = openRequest
  }, [openRequest])
  useEffect(() => {
    if (!open) return
    const panel = panelRef.current
    const first = panel?.querySelector<HTMLElement>('textarea') || panel?.querySelector<HTMLElement>('select') || panel?.querySelector<HTMLElement>('button')
    first?.focus()
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); setOpen(false); triggerRef.current?.focus() }
    }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [open, projectId, selectingProject])
  const locate = (hit: RetrievalHit) => {
    if (!projectId) return
    setOpen(false)
    if (onLocateHit) onLocateHit(hit)
    else onEvidence?.([hit.source.id])
  }
  const browse = () => { setOpen(false); onOpenMaterials?.() }
  const selectProject = async (id: string) => {
    if (!onSelectProject || selectingProject) return
    setSelectingProject(true); setSelectionError('')
    try { await onSelectProject(id) }
    catch (error) { setSelectionError(error instanceof Error ? error.message : '项目资料切换未完成，请重试。') }
    finally { setSelectingProject(false) }
  }
  const hasNavigator = !!onLocateHit || !!onEvidence
  return <div className={`floating-evidence-search${open ? ' is-open' : ''}`}>
    {open && <div ref={panelRef} id={`${id}-panel`} className="floating-evidence-panel" role="dialog" aria-modal="false" aria-labelledby={`${id}-title`}>
      <header><div><h2 id={`${id}-title`}>直接问资料</h2><p>{selectingProject ? '正在切换资料范围…' : projectId ? projectName || projects.find(project => project.id === projectId)?.name || '当前项目资料' : '选择项目，查找资料中的原文依据'}</p></div><button type="button" aria-label="收起直接问资料" onClick={close}><span aria-hidden="true">×</span></button></header>
      <div className="floating-evidence-body">
        {selectionError && <p role="alert">{selectionError}</p>}
        {selectingProject ? <p role="status">正在读取所选项目资料…</p> : <>
        {projectId ? <>
          <p className="floating-evidence-description">用一句话提问，找到材料原文，再定位对应资料页。</p>
          {!!projects.length && onSelectProject && <label className="floating-evidence-project">查找项目<select aria-label="悬浮检索项目" value={projectId} onChange={event => void selectProject(event.target.value)}>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>}
          <RagEvidenceSearch key={projectId} projectId={projectId} variant="floating" onLocateHit={hasNavigator ? locate : undefined} />
        </> : <div className="floating-evidence-choose"><h3>先选择一份项目资料库</h3><p>提问会在所选项目已导入的材料中查找。</p>{projects.length && onSelectProject ? <label>选择项目<select aria-label="选择悬浮检索项目" defaultValue="" onChange={event => { if (event.target.value) void selectProject(event.target.value) }}><option value="" disabled>请选择项目</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label> : onOpenMaterials ? <button type="button" onClick={browse}>进入资料库选择项目 →</button> : <p>打开项目后即可查询其资料。</p>}</div>}
        </>}
      </div>
      {projectId && onOpenMaterials && <footer><button type="button" onClick={browse}>打开项目资料与证据 →</button><span>Esc 收起</span></footer>}
    </div>}
    <button ref={triggerRef} type="button" className="floating-evidence-trigger" aria-haspopup="dialog" aria-expanded={open} aria-controls={`${id}-panel`} onClick={() => setOpen(value => !value)}><span aria-hidden="true">⌕</span>{open ? '收起资料查询' : '直接问资料'}</button>
  </div>
}
