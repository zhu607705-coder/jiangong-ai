// CRE workspace chrome adapted into map exploration and a full-page project workspace.
import { useEffect, useRef, useState, type ReactNode, type Ref } from 'react'
import { IconCube, IconMap2, IconFolder, IconBook2, IconPlus, IconSettings, IconArrowLeft, IconChevronDown, IconX, IconArrowUpRight } from '@tabler/icons-react'
import type { Stage } from './LifecycleSpine'
import type { Project } from '../api'
import { PROJECT_PAGES, type ProjectPage } from '../public-decisions'
import WaitingScene from './WaitingScene'
import './WorkspaceFrame.css'

export type WorkspaceGlobalView = 'map' | 'projects' | 'knowledge' | 'project'
export type WorkspaceProjectPage = ProjectPage
export const WORKSPACE_PROJECT_PAGES = PROJECT_PAGES

export type WorkspaceFrameProps = {
  project: Project | null; projects: Project[]; stages: Stage[]; tab: string;
  onTab: (id: string) => void; onProject: (id: string) => void; onCreate: () => void;
  children: ReactNode; rail: ReactNode; modeControl: ReactNode; mapView: ReactNode;
  detailsOpen: boolean; bootLoading: boolean; onMap: () => void; onSettings: () => void; error: string; onDismissError: () => void;
  globalView?: WorkspaceGlobalView; onGlobalView?: (view: WorkspaceGlobalView) => void; globalContent?: ReactNode;
  activeProjectPage?: WorkspaceProjectPage; onProjectPage?: (page: WorkspaceProjectPage) => void;
  availableProjectPages?: ProjectPage[];
  scrollContainerRef?: Ref<HTMLDivElement>;
}

export default function WorkspaceFrame({ project, projects, stages, tab, onTab, onProject, onCreate, children, rail,
  modeControl, mapView, detailsOpen, bootLoading, onMap, onSettings, error, onDismissError,
  globalView, onGlobalView, globalContent, activeProjectPage = 'overview', onProjectPage, availableProjectPages, scrollContainerRef }: WorkspaceFrameProps) {
  const [projectsOpen, setProjectsOpen] = useState(false)
  const researchMain = useRef<HTMLElement>(null)
  const view = globalView || (detailsOpen ? 'project' : 'map')
  const surfaceOpen = view !== 'map', projectOpen = view === 'project'
  const structured = globalView !== undefined || onGlobalView !== undefined || onProjectPage !== undefined
  const pageLabel = WORKSPACE_PROJECT_PAGES.find(page => page.id === activeProjectPage)?.label || '项目总览'
  const projectPages = availableProjectPages === undefined ? WORKSPACE_PROJECT_PAGES : WORKSPACE_PROJECT_PAGES.filter(page => availableProjectPages.includes(page.id))
  const globalLabel = view === 'knowledge' ? '案例与规则' : '项目空间'
  const navigate = (next: WorkspaceGlobalView) => {
    setProjectsOpen(false)
    if (onGlobalView) onGlobalView(next)
    else if (next === 'map') onMap()
    else if (next === 'projects') setProjectsOpen(true)
  }
  const inactiveProps = bootLoading ? { inert: '' } : {}
  useEffect(() => {
    if (surfaceOpen && !bootLoading) researchMain.current?.focus({ preventScroll: true })
  }, [surfaceOpen, view, bootLoading, project?.id])
  useEffect(() => { setProjectsOpen(false) }, [globalView])
  const projectSwitch = <button className="research-project-switch" aria-label="切换项目" aria-expanded={projectsOpen} onClick={() => setProjectsOpen(value => !value)}><IconFolder size={18} /><span>{project?.name || '项目研究'}</span><IconChevronDown size={16} /></button>
  const errorNotice = error && <div className={surfaceOpen ? 'workspace-frame-error' : 'atlas-global-error glass-panel'} role="alert" {...inactiveProps}>{error}<button className="map-icon-button" aria-label="关闭错误" onClick={onDismissError}><IconX size={18} /></button></div>
  return <div className={`map-shell workspace-frame${surfaceOpen ? ' map-shell--research' : ''}`}>
    <div className="map-stage" hidden={surfaceOpen}>{mapView}</div>
    <footer className="ai-disclaimer">AI 生成与搜索可能存在错误</footer>
    <nav className="atlas-dock glass-panel" aria-label="主导航" {...inactiveProps}>
      <button className="atlas-logo" aria-label="返回地图探索" onClick={() => navigate('map')}><IconCube size={28} stroke={1.5} /></button>
      <span className="dock-divider" />
      <button className={view === 'map' ? 'is-active' : ''} title="地图探索" aria-label="地图探索" aria-current={view === 'map' ? 'page' : undefined} onClick={() => navigate('map')}><IconMap2 size={23} /><small>地图探索</small></button>
      <button className={projectsOpen || view === 'projects' || projectOpen ? 'is-active' : ''} title="项目空间" aria-label={structured ? '项目空间' : '打开项目列表'} aria-current={view === 'projects' || projectOpen ? 'page' : undefined} onClick={() => structured ? navigate('projects') : setProjectsOpen(value => !value)}><IconFolder size={23} /><small>项目空间</small></button>
      {structured && <button className={view === 'knowledge' ? 'is-active' : ''} title="案例与规则" aria-label="案例与规则" aria-current={view === 'knowledge' ? 'page' : undefined} onClick={() => navigate('knowledge')}><IconBook2 size={23} /><small>案例与规则</small></button>}
      <div className="dock-spacer" />
      <button title="管理与设置" aria-label="管理与设置" onClick={onSettings}><IconSettings size={23} /><small>设置</small></button>
      <span className="atlas-avatar" title="共享项目工作台">项</span>
    </nav>
    {!surfaceOpen && <header className="atlas-global-header" {...inactiveProps}>
      <div className="atlas-wordmark"><strong>旧区新生</strong></div>
      <button className="atlas-project-switch glass-panel" aria-expanded={projectsOpen} onClick={() => setProjectsOpen(v => !v)}><IconFolder size={17} /><span>{project?.name || '项目空间'}</span><IconChevronDown size={15} /></button>
    </header>}
    {projectsOpen && <section className="atlas-project-menu glass-panel" aria-label="项目空间列表" {...inactiveProps}>
      <div className="map-card-heading"><h2>项目空间 <small>{projects.length}</small></h2><button className="map-icon-button" aria-label="关闭项目列表" onClick={() => setProjectsOpen(false)}><IconX size={18} /></button></div>
      <p>选择已保存项目，继续对应的资料与方案。</p>
      <div className="atlas-project-items">{projects.map(p => <button key={p.id} className={p.id === project?.id ? 'is-current' : ''} onClick={() => { onProject(p.id); setProjectsOpen(false) }}><IconFolder size={18} /><span><strong>{p.name}</strong><small>{p.input?.synthetic ? '合成测试项目' : p.input?.scope.name || '项目研究'}</small></span><IconArrowUpRight size={16} /></button>)}</div>
      {structured ? <button className="map-primary" onClick={() => navigate('projects')}>进入项目空间<IconArrowUpRight size={16} /></button>
        : <button className="map-primary" onClick={() => { setProjectsOpen(false); onCreate() }}><IconPlus size={16} />新建项目</button>}
    </section>}
    {!surfaceOpen && errorNotice}
    <section className="research-drawer" hidden={!surfaceOpen} aria-label={projectOpen ? '项目研究详情' : globalLabel} {...inactiveProps}>
      <header className="research-drawer-header workspace-frame-header">
        <button onClick={() => navigate('map')}><IconArrowLeft size={18} />返回地图</button>
        <nav className="workspace-frame-breadcrumbs" aria-label="当前位置">
          {projectOpen ? <><button onClick={() => navigate('projects')}>项目空间</button><span>/</span>{projectSwitch}<span>/</span><strong>{structured ? pageLabel : stages.find(stage => stage.id === tab)?.label || '项目研究'}</strong></>
            : <><span>旧区新生</span><span>/</span><strong>{globalLabel}</strong></>}
        </nav>
        {projectOpen && <div className="workspace-frame-mode">{modeControl}</div>}
      </header>
      {projectOpen && !structured && <nav className="research-tabs" aria-label="研判工作区">{stages.map(stage => <button key={stage.id} className={tab === stage.id ? 'active' : ''} aria-current={tab === stage.id ? 'page' : undefined} onClick={() => onTab(stage.id)}>{stage.label}</button>)}</nav>}
      <div className="workspace-frame-layout">
        {projectOpen && structured && <aside className="workspace-project-sidebar">
          <div className="workspace-project-identity"><strong>{project?.name || '当前项目'}</strong>{project && <span>资料 v{project.context_version}</span>}</div>
          <nav aria-label="项目工作区">{projectPages.map(page => <button key={page.id} type="button" data-project-page={page.id}
            aria-current={activeProjectPage === page.id ? 'page' : undefined} onClick={() => onProjectPage ? onProjectPage(page.id) : onTab(page.id)}>{page.label}</button>)}</nav>
        </aside>}
        <div className="research-drawer-scroll" ref={scrollContainerRef}><div className="workspace-columns"><main ref={researchMain} tabIndex={-1} aria-label={projectOpen ? '项目主调研' : `${globalLabel}主内容`}>
          {surfaceOpen && errorNotice}
          <div data-workspace-surface="project" hidden={!projectOpen}>{children}{rail && <details className="research-support"><summary>项目范围与运行记录</summary><aside className="evidence-rail">{rail}</aside></details>}</div>
          <div data-workspace-surface="global" hidden={projectOpen || view === 'map'}>{globalContent}</div>
        </main></div></div>
      </div>
    </section>
    {bootLoading && <div className="workspace-boot-overlay"><WaitingScene variant="boot" title="正在打开项目空间" detail="正在读取本地项目与资料…" /></div>}
  </div>
}
