// CRE workspace chrome adapted into map exploration and a full-page project workspace.
import { useEffect, useId, useRef, useState, type ReactNode, type Ref } from 'react'
import {createPortal} from 'react-dom'
import { IconCube, IconMap2, IconFolder, IconBook2, IconPlus, IconSettings, IconArrowLeft, IconChevronDown, IconX, IconArrowUpRight, IconMenu2, IconLayoutGrid, IconFiles, IconChartLine, IconGitCompare, IconClipboardCheck, IconHistory } from '@tabler/icons-react'
import type { Stage } from './LifecycleSpine'
import type { Project } from '../api'
import { PROJECT_PAGES, type ProjectPage } from '../public-decisions'
import WaitingScene from './WaitingScene'
import {useWorkbenchAccess} from '../AdminAccess'
import './WorkspaceFrame.css'

export type WorkspaceGlobalView = 'map' | 'projects' | 'knowledge' | 'project'
export type WorkspaceProjectPage = ProjectPage
export const WORKSPACE_PROJECT_PAGES = PROJECT_PAGES
const projectPageIcons = {overview:IconLayoutGrid,evidence:IconFiles,assessment:IconChartLine,scenarios:IconGitCompare,actions:IconClipboardCheck,results:IconHistory}

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
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const mobileMenuId = useId(), mobileMenuButton = useRef<HTMLButtonElement>(null), mobileMenu = useRef<HTMLElement>(null)
  const {sessionLabel,sessionActions} = useWorkbenchAccess()
  const researchMain = useRef<HTMLElement>(null)
  const view = globalView || (detailsOpen ? 'project' : 'map')
  const surfaceOpen = view !== 'map', projectOpen = view === 'project'
  const structured = globalView !== undefined || onGlobalView !== undefined || onProjectPage !== undefined
  const pageLabel = WORKSPACE_PROJECT_PAGES.find(page => page.id === activeProjectPage)?.label || '项目总览'
  const projectPages = availableProjectPages === undefined ? WORKSPACE_PROJECT_PAGES : WORKSPACE_PROJECT_PAGES.filter(page => availableProjectPages.includes(page.id))
  const globalLabel = view === 'knowledge' ? '案例与规则' : '项目空间'
  const navigate = (next: WorkspaceGlobalView) => {
    setMobileMenuOpen(false)
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
  useEffect(() => {setMobileMenuOpen(false)},[globalView,activeProjectPage,project?.id])
  useEffect(() => {
    const media = window.matchMedia('(max-width: 760px)')
    const resized = () => {if(!media.matches)setMobileMenuOpen(false)}
    media.addEventListener('change',resized)
    return () => media.removeEventListener('change',resized)
  },[])
  useEffect(() => {
    if(!mobileMenuOpen)return
    setProjectsOpen(false)
    const panel=mobileMenu.current
    panel?.querySelector<HTMLButtonElement>('button')?.focus()
    const keydown=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();setMobileMenuOpen(false)}
      if(event.key!=='Tab'||!panel)return
      const buttons=Array.from(panel.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],select,[tabindex="0"]')).filter(element=>element.getClientRects().length>0)
      const first=buttons[0],last=buttons.at(-1)
      if(event.shiftKey&&(document.activeElement===first||!panel.contains(document.activeElement))){event.preventDefault();last?.focus()}
      else if(!event.shiftKey&&(document.activeElement===last||!panel.contains(document.activeElement))){event.preventDefault();first?.focus()}
    }
    document.addEventListener('keydown',keydown,true)
    return ()=>{document.removeEventListener('keydown',keydown,true);if(mobileMenuButton.current?.getClientRects().length)mobileMenuButton.current.focus();else researchMain.current?.focus({preventScroll:true})}
  },[mobileMenuOpen])
  const projectSwitch = <button className="research-project-switch" aria-label="切换项目" aria-expanded={projectsOpen} onClick={() => {setMobileMenuOpen(false);setProjectsOpen(value => !value)}}><IconFolder size={18} /><span>{project?.name || '项目研究'}</span><IconChevronDown size={16} /></button>
  const projectNavigation = <nav aria-label="项目工作区">{projectPages.map(page => <button key={page.id} type="button" data-project-page={page.id}
    aria-current={activeProjectPage === page.id ? 'page' : undefined} onClick={() => {setMobileMenuOpen(false);onProjectPage ? onProjectPage(page.id) : onTab(page.id)}}>{(() => {const PageIcon=projectPageIcons[page.id];return <PageIcon size={22} aria-hidden="true"/>})()}<span>{page.label}</span></button>)}</nav>
  const globalNavigation = <nav className="atlas-dock glass-panel" aria-label="主导航" {...inactiveProps}>
      <button className="atlas-logo" aria-label="返回地图探索" onClick={() => navigate('map')}><IconCube size={28} stroke={1.5} /></button>
      <span className="dock-divider" />
      <button className={view === 'map' ? 'is-active' : ''} title="地图探索" aria-label="地图探索" aria-current={view === 'map' ? 'page' : undefined} onClick={() => navigate('map')}><IconMap2 size={23} /><small>地图探索</small></button>
      <button className={projectsOpen || view === 'projects' || projectOpen ? 'is-active' : ''} title="项目空间" aria-label={structured ? '项目空间' : '打开项目列表'} aria-current={view === 'projects' || projectOpen ? 'page' : undefined} onClick={() => {setMobileMenuOpen(false);structured ? navigate('projects') : setProjectsOpen(value => !value)}}><IconFolder size={23} /><small>项目空间</small></button>
      {structured && <button className={view === 'knowledge' ? 'is-active' : ''} title="案例与规则" aria-label="案例与规则" aria-current={view === 'knowledge' ? 'page' : undefined} onClick={() => navigate('knowledge')}><IconBook2 size={23} /><small>案例与规则</small></button>}
      <div className="dock-spacer" />
      <button title="管理与设置" aria-label="管理与设置" onClick={()=>{setMobileMenuOpen(false);onSettings()}}><IconSettings size={23} /><small>设置</small></button>
      <span className="atlas-avatar" title="共享项目工作台">项</span>
    </nav>
  const errorNotice = error && <div className={surfaceOpen ? 'workspace-frame-error' : 'atlas-global-error glass-panel'} role="alert" {...inactiveProps}>{error}<button className="map-icon-button" aria-label="关闭错误" onClick={onDismissError}><IconX size={18} /></button></div>
  return <><div className={`map-shell workspace-frame${surfaceOpen ? ' map-shell--research' : ''}`} data-global-view={view} {...(mobileMenuOpen?{inert:''}:{})}>
    <header className="workspace-mobile-header" {...inactiveProps}>
      <button ref={mobileMenuButton} type="button" className="workspace-mobile-menu-trigger" aria-label="打开工作台导航" aria-haspopup="dialog" aria-expanded={mobileMenuOpen} aria-controls={mobileMenuId} onClick={()=>setMobileMenuOpen(true)}><IconMenu2 size={23}/><span>菜单</span></button>
      <div><strong>{projectOpen ? project?.name || '当前项目' : '旧区新生'}</strong><span>{projectOpen?pageLabel:view==='map'?'地图探索':globalLabel}</span></div>
    </header>
    <div className="map-stage" hidden={surfaceOpen}>{mapView}</div>
    <footer className="ai-disclaimer">AI 生成与搜索可能存在错误</footer>
    {globalNavigation}
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
        <button className="workspace-brand" aria-label="旧区新生，返回地图探索" onClick={() => navigate('map')}>旧区新生</button>
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
          {projectNavigation}
        </aside>}
        <div className="research-drawer-scroll" ref={scrollContainerRef}><div className="workspace-columns"><main ref={researchMain} tabIndex={-1} aria-label={projectOpen ? '项目主调研' : `${globalLabel}主内容`}>
          {surfaceOpen && errorNotice}
          <div data-workspace-surface="project" hidden={!projectOpen}>{children}{rail && <details className="research-support"><summary>项目范围与运行记录</summary><aside className="evidence-rail">{rail}</aside></details>}</div>
          <div data-workspace-surface="global" hidden={projectOpen || view === 'map'}>{globalContent}</div>
        </main></div></div>
      </div>
    </section>
    {bootLoading && <div className="workspace-boot-overlay"><WaitingScene variant="boot" title="正在打开项目空间" detail="正在读取本地项目与资料…" /></div>}
  </div>{mobileMenuOpen&&createPortal(<div className="workspace-mobile-menu-backdrop" onClick={()=>setMobileMenuOpen(false)}>
    <aside ref={mobileMenu} id={mobileMenuId} className="workspace-mobile-menu" role="dialog" aria-modal="true" aria-labelledby={`${mobileMenuId}-title`} onClick={event=>event.stopPropagation()}>
      <header><h2 id={`${mobileMenuId}-title`}>工作台导航</h2><button type="button" aria-label="收起工作台导航" onClick={()=>setMobileMenuOpen(false)}><IconX size={22}/></button></header>
      {globalNavigation}
      <section className="workspace-mobile-project"><h3>当前项目</h3>{projectSwitch}
        {projectOpen&&<>{projectNavigation}{!structured&&<nav aria-label="研判工作区">{stages.map(stage=><button key={stage.id} aria-current={tab===stage.id?'page':undefined} onClick={()=>{setMobileMenuOpen(false);onTab(stage.id)}}>{stage.label}</button>)}</nav>}
          <div className="workspace-mobile-mode" onClick={()=>setMobileMenuOpen(false)}>{modeControl}</div></>}
      </section>
      {(sessionLabel||sessionActions)&&<footer className="workspace-mobile-session"><span>{sessionLabel}</span><div>{sessionActions}</div></footer>}
    </aside>
  </div>,document.body)}</>
}
