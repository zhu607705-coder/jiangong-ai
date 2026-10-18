import { useId, useState, type ReactNode } from 'react'
import { IconArrowRight, IconFolder, IconPlus } from '@tabler/icons-react'
import type { PublicStrategyIndexItem } from '../../../../packages/retrofit/strategy'
import type { Project } from '../api'
import './GlobalWorkspace.css'

export type GlobalProjectsSection = 'projects' | 'published'
export type GlobalProjectsProps = {
  projects: Project[]
  publishedPlans: PublicStrategyIndexItem[]
  onProject: (id: string) => void
  onCreate: () => void
  onOpenPublished: (id: string) => void | Promise<void>
  loading?: boolean
  error?: string
  canCreate?: boolean
  activeSection?: GlobalProjectsSection
  onSectionChange?: (section: GlobalProjectsSection) => void
}

function publishedTime(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : `${date.toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  })}（北京时间）`
}

export function GlobalProjects({ projects, publishedPlans, onProject, onCreate, onOpenPublished, loading = false, error = '', canCreate = true, activeSection, onSectionChange }: GlobalProjectsProps) {
  const headingId = useId(), projectsId = useId(), publishedId = useId()
  const [localSection, setLocalSection] = useState<GlobalProjectsSection>('projects')
  const selected = activeSection ?? localSection
  return <section className="global-workspace global-projects" aria-labelledby={headingId} aria-busy={loading}>
    <header className="global-workspace-heading">
      <div><h1 id={headingId}>项目空间</h1><p>打开工作项目继续研究，或查看已发布成果对应的资料快照。</p></div>
      {canCreate && <button type="button" className="global-workspace-primary" onClick={onCreate}><IconPlus size={19} aria-hidden="true" />新建项目</button>}
    </header>
    <nav className="global-project-sections" aria-label="项目空间分类">{([['projects', '项目列表'], ['published', '已发布成果']] as const).map(([id, label]) =>
      <button type="button" key={id} data-project-section={id} aria-current={selected === id ? 'page' : undefined} onClick={() => {
        if (activeSection === undefined) setLocalSection(id)
        onSectionChange?.(id)
      }}>{label}</button>)}
    </nav>
    {loading && <p className="global-workspace-notice" role="status">正在读取项目与已发布成果…</p>}
    {error && <p className="global-workspace-error" role="alert">{error}</p>}
    {selected === 'projects' && <section className="global-workspace-section" aria-labelledby={projectsId}>
      <div className="global-workspace-section-heading"><h2 id={projectsId}>项目列表</h2><p>进入项目总览，继续补充资料、研判与方案工作。</p></div>
      {projects.length > 0 ? <div className="global-project-grid">{projects.map(project => <article className="global-project-card" key={project.id} data-project-id={project.id}>
        <div className="global-project-title"><IconFolder size={23} aria-hidden="true" /><h3>{project.name || project.id}</h3></div>
        <p className="global-project-scope">{project.input.scope.name}</p>
        <div className="global-workspace-badges"><span>资料版本 v{project.context_version}</span>{project.input.synthetic && <span>模拟项目</span>}</div>
        <p className="global-workspace-id">项目 ID <code>{project.id}</code></p>
        <button type="button" className="global-workspace-link" aria-label={`进入项目 ${project.name || project.id}（${project.id}）`} onClick={() => onProject(project.id)}>进入项目总览<IconArrowRight size={18} aria-hidden="true" /></button>
      </article>)}</div> : !loading && !error ? <div className="global-workspace-empty">
        <h3>还没有工作项目</h3><p>{canCreate ? '新建项目，登记研究对象并补充第一份资料。' : '当前没有可打开的工作项目，可切换“已发布成果”查看保存快照。'}</p>
        {canCreate && <button type="button" className="global-workspace-primary" onClick={onCreate}><IconPlus size={18} aria-hidden="true" />创建第一个项目</button>}
      </div> : null}
    </section>}
    {selected === 'published' && <section className="global-workspace-section global-published-section" aria-labelledby={publishedId}>
      <div className="global-workspace-section-heading"><h2 id={publishedId}>已发布成果</h2><p>每份成果保留其来源项目、生成时间和资料版本。</p></div>
      {publishedPlans.length > 0 ? <div className="global-published-list">{publishedPlans.map(plan => <article className="global-published-card" key={`${plan.project_id}:${plan.input_hash}`} data-published-project-id={plan.project_id}>
        <div className="global-published-copy"><div className="global-workspace-badges"><span>{plan.is_current ? '与当前资料一致' : '历史快照'}</span><span>成果资料版本 v{plan.strategy_context_version}</span></div>
          <h3>{plan.headline || '已发布研判成果'}</h3>
          <p>来源项目：{plan.project_name || plan.project_id}</p>
          <p className="global-workspace-id">项目 ID <code>{plan.project_id}</code></p>
          <p className="global-published-time">生成时间：<time dateTime={plan.created_at}>{publishedTime(plan.created_at)}</time></p>
          {plan.context_version !== plan.strategy_context_version && <p className="global-published-version">项目当前资料版本 v{plan.context_version}</p>}
        </div>
        <button type="button" className="global-workspace-link" aria-label={`查看已发布成果 ${plan.headline || plan.project_id}（${plan.project_id}）`} onClick={() => onOpenPublished(plan.project_id)}>查看已发布成果<IconArrowRight size={18} aria-hidden="true" /></button>
      </article>)}</div> : !loading && !error ? <div className="global-workspace-empty global-workspace-empty-compact"><h3>还没有已发布成果</h3><p>在工作项目中形成并发布成果后，可在这里查看对应快照。</p></div> : null}
    </section>}
  </section>
}

export type GlobalKnowledgeSection = 'archive' | 'cases' | 'rules' | 'costs'
export type GlobalKnowledgeProps = {
  children?: ReactNode
  onProjectSpace?: () => void
  activeSection?: GlobalKnowledgeSection
  onSectionChange?: (section: GlobalKnowledgeSection) => void
}
const knowledgeSections: { id: GlobalKnowledgeSection; label: string; description: string }[] = [
  { id: 'archive', label: '资料沉淀', description: '采集原文、保存版本、研读分类、关联事件，再复用到具体项目；随研究持续积累。' },
  { id: 'cases', label: '案例库', description: '查看案例的改造举措、适用条件与关键差异，并追溯原始材料。' },
  { id: 'rules', label: '规则库', description: '核对规则的来源、审核状态、适用对象与版本。' },
  { id: 'costs', label: '成本参考', description: '按工程范围、价格阶段、面积口径与价格年份查阅成本来源。' },
]

export function GlobalKnowledge({ children, onProjectSpace, activeSection, onSectionChange }: GlobalKnowledgeProps) {
  const [localSection, setLocalSection] = useState<GlobalKnowledgeSection>('archive')
  const selected = activeSection ?? localSection
  const section = knowledgeSections.find(item => item.id === selected)!
  const headingId = useId(), contentId = useId()
  return <section className="global-workspace global-knowledge" aria-labelledby={headingId}>
    <header className="global-workspace-heading"><div><h1 id={headingId}>案例与规则</h1><p>查阅案例、规则与成本参考，按来源和适用条件使用。</p></div>
      {onProjectSpace && <button type="button" className="global-workspace-secondary" onClick={onProjectSpace}>打开项目空间<IconArrowRight size={18} aria-hidden="true" /></button>}
    </header>
    <nav className="global-knowledge-tabs" aria-label="知识参考分类">{knowledgeSections.map(item => <button type="button" key={item.id} data-knowledge-section={item.id} aria-current={selected === item.id ? 'page' : undefined} onClick={() => {
      if (activeSection === undefined) setLocalSection(item.id)
      onSectionChange?.(item.id)
    }}>{item.label}</button>)}</nav>
    <section className="global-workspace-section global-knowledge-reference" aria-labelledby={contentId}>
      <div className="global-workspace-section-heading"><span className="global-workspace-eyebrow">参考资料</span><h2 id={contentId}>{section.label}</h2><p>{section.description}</p></div>
      <div className="global-knowledge-content" data-active-section={selected}>{children ?? <div className="global-workspace-empty"><h3>选择资料后查看{section.label}</h3><p>从项目空间打开研究对象，查看已有材料和可引用记录。</p>{onProjectSpace && <button type="button" className="global-workspace-primary" onClick={onProjectSpace}>前往项目空间<IconArrowRight size={18} aria-hidden="true" /></button>}</div>}</div>
    </section>
  </section>
}
