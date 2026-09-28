// CRE workspace chrome adapted into a map-first shell; existing research panels remain intact.
import { useState, type ReactNode } from 'react'
import { IconCube, IconMap2, IconFolder, IconPlus, IconSettings, IconArrowLeft, IconChevronDown, IconX, IconArrowUpRight } from '@tabler/icons-react'
import type { Stage } from './LifecycleSpine'
import type { Project } from '../api'

export default function WorkspaceFrame({ project, projects, stages, tab, onTab, onProject, onCreate, children, rail,
  modeControl, mapView, detailsOpen, onMap, onSettings, error, onDismissError }: {
  project: Project | null; projects: Project[]; stages: Stage[]; tab: string;
  onTab: (id: string) => void; onProject: (id: string) => void; onCreate: () => void;
  children: ReactNode; rail: ReactNode; modeControl: ReactNode; mapView: ReactNode;
  detailsOpen: boolean; onMap: () => void; onSettings: () => void; error: string; onDismissError: () => void;
}) {
  const [projectsOpen, setProjectsOpen] = useState(false)
  return <div className="map-shell">
    {mapView}
    <footer className="ai-disclaimer">AI 生成与搜索可能存在错误</footer>
    <nav className="atlas-dock glass-panel" aria-label="主导航">
      <button className="atlas-logo" aria-label="返回地图探索" onClick={onMap}><IconCube size={28} stroke={1.5} /></button>
      <span className="dock-divider" />
      <button className={!detailsOpen && !projectsOpen ? 'is-active' : ''} title="地图探索" aria-label="地图探索" onClick={() => { onMap(); setProjectsOpen(false) }}><IconMap2 size={23} /><small>探索</small></button>
      <button className={projectsOpen ? 'is-active' : ''} title="项目空间" aria-label="打开项目列表" aria-expanded={projectsOpen} onClick={() => setProjectsOpen(v => !v)}><IconFolder size={23} /><small>项目</small></button>
      <button title="新建项目" aria-label="新建项目" onClick={onCreate}><IconPlus size={23} /><small>新建</small></button>
      <div className="dock-spacer" />
      <button title="地图连接设置" aria-label="地图连接设置" onClick={onSettings}><IconSettings size={23} /><small>设置</small></button>
      <span className="atlas-avatar" title="本地项目负责人">项</span>
    </nav>
    <header className="atlas-global-header">
      <div className="atlas-wordmark"><strong>建工 AI</strong></div>
      <button className="atlas-project-switch glass-panel" aria-expanded={projectsOpen} onClick={() => setProjectsOpen(v => !v)}><IconFolder size={17} /><span>{project?.name || '项目空间'}</span><IconChevronDown size={15} /></button>
    </header>
    {projectsOpen && <section className="atlas-project-menu glass-panel" aria-label="项目空间列表">
      <div className="map-card-heading"><h2>项目空间 <small>{projects.length}</small></h2><button className="map-icon-button" aria-label="关闭项目列表" onClick={() => setProjectsOpen(false)}><IconX size={18} /></button></div>
      <p>选中项目，查看位置与简要信息。</p>
      <div className="atlas-project-items">{projects.map(p => <button key={p.id} className={p.id === project?.id ? 'is-current' : ''} onClick={() => { onProject(p.id); setProjectsOpen(false); onMap() }}><IconFolder size={18} /><span><strong>{p.name}</strong><small>{p.input?.synthetic ? '合成测试项目' : p.input?.scope.name || '项目研究'}</small></span><IconArrowUpRight size={16} /></button>)}</div>
      <button className="map-primary" onClick={() => { setProjectsOpen(false); onCreate() }}><IconPlus size={16} />新建项目</button>
    </section>}
    {!detailsOpen && error && <div className="atlas-global-error glass-panel" role="alert">{error}<button className="map-icon-button" aria-label="关闭错误" onClick={onDismissError}><IconX size={16} /></button></div>}
    <section className="research-drawer" hidden={!detailsOpen} aria-label="项目研究详情">
      <header className="research-drawer-header"><button onClick={onMap}><IconArrowLeft size={18} />返回地图</button><strong>{project?.name || '项目研究'}</strong><div>{modeControl}<button aria-label="关闭研究详情" onClick={onMap}><IconX size={20} /></button></div></header>
      <nav className="research-tabs" aria-label="研判工作区">{stages.map(stage => <button key={stage.id} className={tab === stage.id ? 'active' : ''} aria-current={tab === stage.id ? 'page' : undefined} onClick={() => onTab(stage.id)}>{stage.label}</button>)}</nav>
      <div className="research-drawer-scroll"><div className="workspace-columns"><main>{children}</main><aside className="evidence-rail">{rail}</aside></div></div>
    </section>
  </div>
}
