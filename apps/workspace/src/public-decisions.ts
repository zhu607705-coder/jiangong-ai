import type { Project } from './api'
import type { PublicStrategyIndexItem } from '../../../packages/retrofit/strategy'

export type WorkbenchView = 'overview' | 'evidence' | 'context' | 'compare' | 'actions' | 'map' | 'assessment' | 'scenarios' | 'results' | 'projects' | 'knowledge'
export type ProjectPage = 'overview' | 'evidence' | 'assessment' | 'scenarios' | 'actions' | 'results'
export type SchemePane = 'content' | 'funding' | 'operations' | 'sensitivity'
export type WorkbenchLocation = { view: WorkbenchView; section?: string; pane?: SchemePane; scheme?: 'comprehensive' | 'rebuild'; baseline?: number }
const views = new Set<WorkbenchView>(['overview', 'evidence', 'context', 'compare', 'actions', 'map', 'assessment', 'scenarios', 'results', 'projects', 'knowledge'])
const panes = new Set<SchemePane>(['content', 'funding', 'operations', 'sensitivity'])
export const PROJECT_PAGES: { id: ProjectPage; label: string }[] = [
  { id: 'overview', label: '项目总览' }, { id: 'evidence', label: '资料与条件' }, { id: 'assessment', label: '改造研判' },
  { id: 'scenarios', label: '方案与测算' }, { id: 'actions', label: '调查任务' }, { id: 'results', label: '成果与版本' },
]
export function resolveProjectLocation(view: string, section?: string) {
  const page: ProjectPage = view === 'context' ? 'evidence' : view === 'compare' ? 'results' : PROJECT_PAGES.some(item => item.id === view) ? view as ProjectPage : 'overview'
  const options: Record<ProjectPage, string[]> = { overview: ['summary'], evidence: ['files', 'profile', 'context'], assessment: ['direction', 'current', 'cases'], scenarios: ['compare', 'detail'], actions: ['current', 'history'], results: ['reports', 'history'] }
  const wanted = view === 'context' ? 'context' : view === 'compare' ? 'history' : section
  return { page, section: wanted && options[page].includes(wanted) ? wanted : options[page][0] }
}
export function readWorkbenchLink(search: string) {
  const params = new URLSearchParams(search), requested = params.get('view')
  const pane = params.get('pane'), scheme = params.get('scheme'), baseline = params.get('baseline')
  return { projectId: params.get('project') || null, view: requested && views.has(requested as WorkbenchView) ? requested as WorkbenchView : null, publicDirectory: requested === 'published',
    section: params.get('section') || undefined, pane: pane && panes.has(pane as SchemePane) ? pane as SchemePane : undefined,
    scheme: scheme === 'comprehensive' || scheme === 'rebuild' ? scheme as 'comprehensive'|'rebuild' : undefined,
    baseline: baseline && /^\d+$/.test(baseline) ? Number(baseline) : undefined }
}
export function publicDecisionHref(projectId: string) { return `/?project=${encodeURIComponent(projectId)}&view=overview` }

/** Explicit project IDs take precedence; same-name projects are never substituted. */
export function initialWorkbenchProject(projects: Project[], published: PublicStrategyIndexItem[], options: { search: string; viewer: boolean; storedProjectId: string | null }) {
  const link = readWorkbenchLink(options.search)
  const explicit = link.projectId ? projects.find(project => project.id === link.projectId) : undefined
  const available = published.map(item => projects.find(project => project.id === item.project_id && !project.input.synthetic)).find(Boolean)
  const fallback = projects.find(project => project.id === options.storedProjectId) || projects.find(project => !project.input.synthetic) || projects[0]
  const selected = explicit || ((options.viewer || link.publicDirectory) ? available || fallback : fallback)
  return { selected, unavailableProject: link.projectId && !explicit ? link.projectId : null,
    view: link.view || 'overview', showOverview: link.view !== 'map' && (!!link.projectId || link.publicDirectory || options.viewer) }
}

export function writeWorkbenchLink(projectId: string, view: WorkbenchView, details: Omit<WorkbenchLocation, 'view'> & { push?: boolean } = {}) {
  if (typeof window === 'undefined' || !window.location?.href || !window.history?.replaceState) return
  const url = new URL(window.location.href)
  url.searchParams.set('project', projectId); url.searchParams.set('view', view); url.hash = ''
  for (const field of ['section', 'pane', 'scheme', 'baseline'] as const) {
    const value = details[field]
    if (value === undefined) url.searchParams.delete(field)
    else url.searchParams.set(field, String(value))
  }
  if (details.push && typeof window.history.pushState === 'function') window.history.pushState(null, '', `${url.pathname}${url.search}`)
  else window.history.replaceState(null, '', `${url.pathname}${url.search}`)
}
