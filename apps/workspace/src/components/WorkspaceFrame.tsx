// CRE workspace chrome adapted into map exploration and a full-page project workspace.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { IconCube, IconMap2, IconFolder, IconPlus, IconSettings, IconArrowLeft, IconChevronDown, IconX, IconArrowUpRight } from '@tabler/icons-react'
import type { Stage } from './LifecycleSpine'
import type { Project } from '../api'
import WaitingScene from './WaitingScene'

export default function WorkspaceFrame({ project, projects, stages, tab, onTab, onProject, onCreate, children, rail,
  modeControl, mapView, detailsOpen, bootLoading, onMap, onSettings, error, onDismissError }: {
  project: Project | null; projects: Project[]; stages: Stage[]; tab: string;
  onTab: (id: string) => void; onProject: (id: string) => void; onCreate: () => void;
  children: ReactNode; rail: ReactNode; modeControl: ReactNode; mapView: ReactNode;
  detailsOpen: boolean; bootLoading: boolean; onMap: () => void; onSettings: () => void; error: string; onDismissError: () => void;
}) {
  const [projectsOpen, setProjectsOpen] = useState(false)
  const researchMain = useRef<HTMLElement>(null)
  const inactiveProps = bootLoading ? { inert: '' } : {}
  useEffect(() => {
    if (detailsOpen && !bootLoading) researchMain.current?.focus({ preventScroll: true })
  }, [detailsOpen, bootLoading, project?.id])
  return <div className={`map-shell${detailsOpen ? ' map-shell--research' : ''}`}>
    <div className="map-stage" hidden={detailsOpen}>{mapView}</div>
    <footer className="ai-disclaimer">AI 生成与搜索可能存在错误</footer>
    <nav className="atlas-dock glass-panel" aria-label="主导航" {...inactiveProps}>
      <button className="atlas-logo" aria-label="返回地图探索" onClick={onMap}><IconCube size={28} stroke={1.5} /></button>
      <span className="dock-divider" />
      <button className={!detailsOpen && !projectsOpen ? 'is-active' : ''} title="地图探索" aria-label="地图探索" onClick={() => { onMap(); setProjectsOpen(false) }}><IconMap2 size={23} /><small>探索</small></button>
      <button className={projectsOpen || detailsOpen ? 'is-active' : ''} title="项目空间" aria-label="打开项目列表" aria-expanded={projectsOpen} onClick={() => setProjectsOpen(v => !v)}><IconFolder size={23} /><small>项目</small></button>
      <button title="新建项目" aria-label="新建项目" onClick={onCreate}><IconPlus size={23} /><small>新建</small></button>
      <div className="dock-spacer" />
      <button title="地图连接设置" aria-label="地图连接设置" onClick={onSettings}><IconSettings size={23} /><small>设置</small></button>
      <span className="atlas-avatar" title="本地项目负责人">项</span>
    </nav>
    {!detailsOpen && <header className="atlas-global-header" {...inactiveProps}>
      <div className="atlas-wordmark"><strong>建工 AI</strong></div>
      <button className="atlas-project-switch glass-panel" aria-expanded={projectsOpen} onClick={() => setProjectsOpen(v => !v)}><IconFolder size={17} /><span>{project?.name || '项目空间'}</span><IconChevronDown size={15} /></button>
    </header>}
    {projectsOpen && <section className="atlas-project-menu glass-panel" aria-label="项目空间列表" {...inactiveProps}>
      <div className="map-card-heading"><h2>项目空间 <small>{projects.length}</small></h2><button className="map-icon-button" aria-label="关闭项目列表" onClick={() => setProjectsOpen(false)}><IconX size={18} /></button></div>
      <p>选中项目，直接进入主调研页。</p>
      <div className="atlas-project-items">{projects.map(p => <button key={p.id} className={p.id === project?.id ? 'is-current' : ''} onClick={() => { onProject(p.id); setProjectsOpen(false) }}><IconFolder size={18} /><span><strong>{p.name}</strong><small>{p.input?.synthetic ? '合成测试项目' : p.input?.scope.name || '项目研究'}</small></span><IconArrowUpRight size={16} /></button>)}</div>
      <button className="map-primary" onClick={() => { setProjectsOpen(false); onCreate() }}><IconPlus size={16} />新建项目</button>
    </section>}
    {!detailsOpen && error && <div className="atlas-global-error glass-panel" role="alert" {...inactiveProps}>{error}<button className="map-icon-button" aria-label="关闭错误" onClick={onDismissError}><IconX size={16} /></button></div>}
    <section className="research-drawer" hidden={!detailsOpen} aria-label="项目研究详情" {...inactiveProps}>
      <header className="research-drawer-header"><button onClick={onMap}><IconArrowLeft size={18} />返回地图</button><button className="research-project-switch" aria-expanded={projectsOpen} onClick={() => setProjectsOpen(v => !v)}><IconFolder size={17} /><span>{project?.name || '项目研究'}</span><IconChevronDown size={15} /></button><div>{modeControl}</div></header>
      <nav className="research-tabs" aria-label="研判工作区">{stages.map(stage => <button key={stage.id} className={tab === stage.id ? 'active' : ''} aria-current={tab === stage.id ? 'page' : undefined} onClick={() => onTab(stage.id)}>{stage.label}</button>)}</nav>
      <div className="research-drawer-scroll"><div className="workspace-columns"><main ref={researchMain} tabIndex={-1} aria-label="项目主调研">{children}<details className="research-support"><summary>项目范围与运行记录</summary><aside className="evidence-rail">{rail}</aside></details></main></div></div>
    </section>
    {bootLoading && <div className="workspace-boot-overlay"><WaitingScene variant="boot" title="正在打开项目空间" detail="正在读取本地项目与资料…" /></div>}
  </div>
}
