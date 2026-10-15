import type { Project } from './api'
import type { PublicStrategyIndexItem } from '../../../packages/retrofit/strategy'

export type WorkbenchView = 'overview' | 'evidence' | 'context' | 'compare' | 'actions' | 'map'
const views = new Set<WorkbenchView>(['overview', 'evidence', 'context', 'compare', 'actions', 'map'])
export function readWorkbenchLink(search: string) {
  const params = new URLSearchParams(search), requested = params.get('view')
  return { projectId: params.get('project') || null, view: requested && views.has(requested as WorkbenchView) ? requested as WorkbenchView : null, publicDirectory: requested === 'published' }
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

export function writeWorkbenchLink(projectId: string, view: WorkbenchView) {
  if (typeof window === 'undefined' || !window.location?.href || !window.history?.replaceState) return
  const url = new URL(window.location.href)
  url.searchParams.set('project', projectId); url.searchParams.set('view', view); url.hash = ''
  window.history.replaceState(null, '', `${url.pathname}${url.search}`)
}
