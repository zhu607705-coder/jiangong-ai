import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { IconArrowRight, IconCheck, IconClipboardList, IconFileSearch, IconHistory } from '@tabler/icons-react'
import type { Project } from '../api'
import type { StrategyPacket } from '../../../../packages/retrofit/strategy'
import type { ResearchRound } from '../../../../packages/retrofit/research-rounds'
import { type StrategyDirection } from './strategy-direction-text'
import './ProjectTasksPage.css'

import {buildProjectTasks,type ProjectTaskProgress,type ProjectInvestigationTask} from '../../../../packages/retrofit/project-tasks'
import {useProjectDecisionGuidance,orderByDecision} from './ProjectDecisionGuidance'
import TaskMaterialImport,{type TaskUpload,type TaskExtract} from './TaskMaterialImport'
export {buildProjectTasks,type ProjectTaskProgress,type ProjectInvestigationTask} from '../../../../packages/retrofit/project-tasks'

export type ProjectTasksPageProps = {
  project: Project; packet: StrategyPacket | null; rounds?: ResearchRound[];
  direction?: StrategyDirection | null; section?: 'current' | 'history';
  onEvidence: (refs: string[], packet?: StrategyPacket) => void; onSupplement: () => void;
  onUploadTask?:TaskUpload;onExtractTask?:TaskExtract;onReassess?:()=>void;
}
const progressLabels: Record<ProjectTaskProgress, string> = { not_started: '尚未开展', in_progress: '正在调查', material_received: '材料已取得' }

function readProgress(key: string): Record<string, ProjectTaskProgress> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) || '{}')
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    return Object.fromEntries(Object.entries(value).filter(([, status]) => typeof status === 'string' && Object.hasOwn(progressLabels, status)))
  } catch { return {} }
}
function taskProgress(task: ProjectInvestigationTask, values: Record<string, ProjectTaskProgress>): ProjectTaskProgress {
  if (values[task.id]) return values[task.id]
  const statuses = task.progress_keys.map(key => values[key])
  return statuses.includes('material_received') ? 'material_received' : statuses.includes('in_progress') ? 'in_progress' : 'not_started'
}
const dateLabel = (value: string) => {
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString('zh-CN') : '日期未登记'
}

function TaskDrawer({ task, packet, project, historical, status, onClose, onChange, onEvidence, onSupplement,onUploadTask,onExtractTask,onReassess,direction }: {
  task: ProjectInvestigationTask; packet: StrategyPacket; project: Project; historical: boolean; status: ProjectTaskProgress;
  onClose: () => void; onChange: (status: ProjectTaskProgress) => void;
  onEvidence: ProjectTasksPageProps['onEvidence']; onSupplement: () => void;
  onUploadTask?:TaskUpload;onExtractTask?:TaskExtract;onReassess?:()=>void;direction?:StrategyDirection|null;
}) {
  const headingId = useId(), dialog = useRef<HTMLElement>(null), closeButton = useRef<HTMLButtonElement>(null)
  const closeRef = useRef(onClose); closeRef.current = onClose
  useLayoutEffect(() => {
    const trigger = document.activeElement as HTMLElement | null, overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'; closeButton.current?.focus?.({ preventScroll: true })
    const focusables = () => [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled), [href], [tabindex="0"]') || [])]
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeRef.current(); return }
      if (event.key !== 'Tab') return
      const elements = focusables(), first = elements[0], last = elements.at(-1)
      if (event.shiftKey && (document.activeElement === first || !dialog.current?.contains(document.activeElement))) { event.preventDefault(); last?.focus?.() }
      else if (!event.shiftKey && (document.activeElement === last || !dialog.current?.contains(document.activeElement))) { event.preventDefault(); first?.focus?.() }
    }
    document.addEventListener('keydown', keydown, true)
    return () => { document.removeEventListener('keydown', keydown, true); document.body.style.overflow = overflow; if (trigger?.isConnected) trigger.focus?.({ preventScroll: true }) }
  }, [])
  const sources = task.evidence_refs.map(id => ({ id, source: packet.sources.find(source => source.id === id && (!source.project_id || source.project_id === project.id)) }))
  return createPortal(<div className="project-task-backdrop" onClick={event => { if (event.target === event.currentTarget) onClose() }}>
    <section ref={dialog} className="project-task-drawer" role="dialog" aria-modal="true" aria-labelledby={headingId}>
      <header><div><span>{historical ? '历史调查要求' : '调查任务详情'} · 资料 v{packet.context_version}</span><h2 id={headingId}>{task.title}</h2><p>{project.name}</p></div><button ref={closeButton} type="button" aria-label="关闭调查任务详情" onClick={onClose}>关闭 ×</button></header>
      <div className="project-task-drawer-body">
        <section><h3>为什么影响判断</h3><p>{task.reason || '本轮研判将此项列为下一步核查，取得相应资料后可重新研究方案。'}</p></section>
        <section><h3>需要取得的文件与信息</h3><p>{task.request}</p></section>
        {!historical&&onUploadTask&&<TaskMaterialImport projectId={project.id} revision={project.context_version} task={task} link={{task_id:task.id,input_hash:packet.input_hash,direction}} synthetic={project.input.synthetic} onUpload={onUploadTask} onExtract={onExtractTask} onReceived={()=>onChange('material_received')} onReassess={()=>{onClose();(onReassess||onSupplement)()}}/>}
        {task.internal_data && <section className="project-task-collection-scope"><h3>内部数据采集口径</h3><dl><div><dt>指标用途</dt><dd>{task.reason}</dd></div><div><dt>采集方法</dt><dd>{task.request}</dd></div><div><dt>单位</dt><dd>{task.internal_data.unit}</dd></div><div><dt>时间窗</dt><dd>{task.internal_data.period}</dd></div><div><dt>样本与分母</dt><dd>{task.internal_data.denominator}</dd></div><div><dt>关联对象</dt><dd>{task.internal_data.scope === 'project' ? '项目级调查 · 尚未关联具体工程分项' : task.internal_data.related_objects.length ? task.internal_data.related_objects.join('、') : `分项待定位：${task.internal_data.related_package_ids.join('、')}`}</dd></div></dl></section>}
        <section><h3>已引用的来源</h3>{sources.length ? <><ul className="project-task-source-list">{sources.map(({ id, source }) => <li key={id}><strong>{source?.title || id}</strong><span>{source?.locator || '当轮未登记定位'}{source?.published_at ? ` · ${dateLabel(source.published_at)}` : ''}</span></li>)}</ul><button type="button" onClick={() => { onClose(); onEvidence(task.evidence_refs, packet) }}>查看当轮引用原文 <IconArrowRight size={17}/></button></> : <p>本项没有登记来源引用，具体补充要求沿用当轮研判。</p>}</section>
        <section className="project-task-progress-editor"><h3>本机调查进度</h3>{historical ? <p>{progressLabels[status]} · 历史记录只读</p> : <label>当前进度<select aria-label={`${task.title}调查进度`} value={status} onChange={event => onChange(event.target.value as ProjectTaskProgress)}>{Object.entries(progressLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}<p>进度保存在本机浏览器；取得材料后仍需上传并开展补充研判。</p></section>
      </div>
      <footer>{!historical && <button className="project-task-primary" type="button" onClick={() => { onClose(); onSupplement() }}>补充项目资料 <IconArrowRight size={18}/></button>}<span>Esc 关闭并返回任务</span></footer>
    </section>
  </div>, document.body)
}

export default function ProjectTasksPage({ project, packet, rounds = [], direction = null, section = 'current', onEvidence, onSupplement,onUploadTask,onExtractTask,onReassess }: ProjectTasksPageProps) {
  const storageKey = `hzz-strategy-investigations:${project.id}`
  const [progressState, setProgress] = useState(() => ({ key: storageKey, values: readProgress(storageKey) }))
  const [saveError, setSaveError] = useState(''), [opened, setOpened] = useState<string | null>(null), [historyId, setHistoryId] = useState('')
  useEffect(() => { setProgress({ key: storageKey, values: readProgress(storageKey) }); setOpened(null); setHistoryId(''); setSaveError('') }, [storageKey])
  const retained=useRef<{project_id:string;packet:StrategyPacket}|null>(null)
  const progress = progressState.key === storageKey ? progressState.values : {}
  const matchesProject = (value: StrategyPacket | null): value is StrategyPacket => project.input.project_id === project.id && !!value && value.project_id === project.id && value.synthetic === project.input.synthetic && value.status === 'completed' && !!value.strategy
  if(matchesProject(packet))retained.current={project_id:project.id,packet}
  const current = matchesProject(packet) ? packet : onUploadTask&&retained.current?.project_id===project.id&&matchesProject(retained.current.packet)?retained.current.packet:null
  useEffect(() => { setOpened(null) }, [current?.input_hash,section])
  const validRounds = rounds.filter(round => round.project_id === project.id && round.status === 'completed' && matchesProject(round.result) && round.input_hash === round.result.input_hash && round.context_version === round.result.context_version)
  const history = [...validRounds].filter(round => round.input_hash !== current?.input_hash).sort((a, b) => b.round_number - a.round_number)
  const selectedRound = section === 'history' ? history.find(round => round.id === historyId) || history[0] : validRounds.find(round => round.input_hash === current?.input_hash && round.context_version === current?.context_version)
  const activePacket = section === 'history' ? selectedRound?.result || null : current
  const guidance=useProjectDecisionGuidance(activePacket?.input_hash)
  const tasks = useMemo(() => {const rows=buildProjectTasks(activePacket,direction,selectedRound?.missing_materials||[]);return section==='current'&&guidance?orderByDecision(rows,guidance.materials,row=>row.id):rows}, [activePacket, direction, selectedRound,section,guidance])
  const selected = tasks.find(task => task.id === opened)
  const counts = { all: tasks.length, received: tasks.filter(task => taskProgress(task, progress) === 'material_received').length, ongoing: tasks.filter(task => taskProgress(task, progress) === 'in_progress').length }
  function update(task: ProjectInvestigationTask, value: ProjectTaskProgress) {
    if (!Object.hasOwn(progressLabels, value)) return
    const next = { ...readProgress(storageKey), ...progress, ...Object.fromEntries(task.progress_keys.map(key => [key, value])) }
    setProgress({ key: storageKey, values: next })
    try { localStorage.setItem(storageKey, JSON.stringify(next)); setSaveError('') } catch { setSaveError('本机浏览器暂未保存这次进度；当前页面仍可继续使用。') }
  }
  function taskButton(task: ProjectInvestigationTask, index: number, compact = false) {
    const status = taskProgress(task, progress)
    return <button type="button" key={task.id} data-task-id={task.id} className={`project-task-card${compact ? ' is-compact' : ''}`} onClick={() => setOpened(task.id)} aria-label={`查看${task.title}调查详情`}>
      <span className="project-task-number">{String(index + 1).padStart(2, '0')}</span><div className="project-task-card-content"><div className="project-task-card-title"><h3>{task.title}</h3><span className={`project-task-status is-${status}`}>{status === 'material_received' && <IconCheck size={14}/>} {progressLabels[status]}</span></div><p>{task.request}</p><span className="project-task-card-kind">{task.internal_data ? task.internal_data.scope === 'project' ? '项目级内部调查' : '内部指标采集' : task.kinds.includes('missing_material') ? '关键资料缺项' : '研判建议核查'}{task.evidence_refs.length ? ` · ${task.evidence_refs.length} 条来源引用` : ''}</span></div><IconArrowRight className="project-task-open-icon" size={20}/>
    </button>
  }
  return <section className="project-tasks-page" aria-label={section === 'history' ? '历史调查记录' : '当前调查任务'} data-direction={direction || 'unselected'}>
    <header className="project-tasks-heading"><div><span>{section === 'history' ? <IconHistory size={20}/> : <IconClipboardList size={20}/>}调查任务</span><h2>{section === 'history' ? '回看每轮提出的调查要求' : '把关键缺项转成下一次行动'}</h2><p>{section === 'history' ? '按当轮资料基线查看任务和引用，原判断持续保留。' : '打开任务即可导入文件或调查记录，查看提取字段与工具记录，再带入下一轮判断。'}</p></div>{section === 'current' && <button type="button" className="project-task-primary" onClick={onSupplement}>补充项目资料 <IconArrowRight size={18}/></button>}</header>
    {guidance&&section==='current'&&<p className="pdg-task-badge">已按 Decision 的资料优先级排序 · 调查进度保留</p>}
    <div className="project-task-summary"><div><strong>{counts.all}</strong><span>本轮调查事项</span></div><div><strong>{counts.ongoing}</strong><span>正在调查</span></div><div><strong>{counts.received}</strong><span>材料已取得 · 本机</span></div><p>{direction ? `工作方向：${direction === 'comprehensive' ? '综合整治' : '原拆原建'}` : '尚未选择工作方向 · 展示当轮全部核查'}{activePacket && <span>依据资料 v{activePacket.context_version}{activePacket.context_version !== project.context_version ? ` · 当前资料 v${project.context_version}` : ''}</span>}</p></div>
    {section === 'history' && history.length > 0 && <label className="project-task-history-selector">选择历史研判<select aria-label="选择历史调查轮次" value={selectedRound?.id || ''} onChange={event => { setHistoryId(event.target.value); setOpened(null) }}>{history.map(round => <option key={round.id} value={round.id}>第 {round.round_number} 轮 · 资料 v{round.context_version} · {dateLabel(round.created_at)}</option>)}</select></label>}
    {saveError && <p className="project-task-notice" role="alert">{saveError}</p>}
    {!tasks.length ? <div className="project-tasks-empty"><IconFileSearch size={34} stroke={1.4}/><h3>{section === 'history' ? '暂无历史调查记录' : activePacket ? '本方向暂无已登记的调查事项' : '完成首轮研判后，调查建议会列在这里'}</h3><p>{section === 'history' ? '新的研判形成后，旧轮次的要求会保留在历史记录。' : '可先补充居民调研、工程鉴定或资金文件，再在改造研判中形成建议。'}</p></div> : <>
      <section className="project-task-featured" aria-label={section === 'history' ? '历史关键调查' : '当前关键调查'}>{tasks.slice(0, 3).map((task, index) => taskButton(task, index))}</section>
      {tasks.length > 3 && <section className="project-task-remaining" aria-label="其余调查清单"><h3>其余调查事项 <span>{tasks.length - 3}</span></h3>{tasks.slice(3).map((task, index) => taskButton(task, index + 3, true))}</section>}
    </>}
    {selected && activePacket && <TaskDrawer key={`${project.id}:${activePacket.input_hash}:${selected.id}`} task={selected} packet={activePacket} project={project} historical={section === 'history'} status={taskProgress(selected, progress)} onClose={() => setOpened(null)} onChange={value => update(selected, value)} onEvidence={onEvidence} onSupplement={onSupplement} onUploadTask={onUploadTask} onExtractTask={onExtractTask} onReassess={onReassess} direction={direction}/>}
  </section>
}
