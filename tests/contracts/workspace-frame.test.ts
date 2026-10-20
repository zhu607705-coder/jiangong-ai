import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { act, createElement, createRef, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { parseHTML } from 'linkedom'
import fixture from '../../fixtures/inputs/01_auto.json'
import type { Project } from '../../apps/workspace/src/api'
import WorkspaceFrame, { type WorkspaceGlobalView, type WorkspaceFrameProps } from '../../apps/workspace/src/components/WorkspaceFrame'

vi.mock('../../apps/workspace/src/components/WaitingScene', () => ({ default: ({ title }: { title: string }) => createElement('div', { role: 'status' }, title) }))
let root: Root, container: HTMLElement, active: HTMLElement | null
const onGlobalView = vi.fn(), onProjectPage = vi.fn(), onProject = vi.fn(), onCreate = vi.fn(), onSettings = vi.fn(), onMap = vi.fn(), onDismissError = vi.fn(), onTab = vi.fn()
const project = (id: string, name = '真实项目'): Project => ({ id, name, context_version: 3, input: { ...structuredClone(fixture), project_id: id, synthetic: false } } as Project)
const projects = [project('P-one'), project('P-two', '另一真实项目')]
const scrollContainerRef = createRef<HTMLDivElement>()
let mounted = 0, unmounted = 0
function MapView() { useEffect(() => { mounted++; return () => { unmounted++ } }, []); return createElement('div', null, 'ACTUAL_MAP_VIEW') }
function props(globalView: WorkspaceGlobalView = 'project') {
  return { project: projects[0], projects, stages: [], tab: 'overview', onTab, onProject, onCreate,
    children: createElement('p', null, 'PROJECT_CONTENT'), rail: createElement('p', null, 'RUN_RECORDS'), modeControl: createElement('span', null, 'EXISTING_MODE_CONTROL'),
    mapView: createElement(MapView), detailsOpen: globalView !== 'map', bootLoading: false, onMap, onSettings, error: '', onDismissError,
    globalView, onGlobalView, activeProjectPage: 'assessment' as const, onProjectPage,
    globalContent: createElement('p', null, 'GLOBAL_CONTENT'), scrollContainerRef }
}
beforeEach(() => {
  const { window } = parseHTML('<!doctype html><html><body><div id="root"></div></body></html>')
  active = null; mounted = 0; unmounted = 0
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: (media: string) => ({ media, matches: false, addEventListener() {}, removeEventListener() {} }) })
  Object.defineProperty(window.document, 'activeElement', { configurable: true, get: () => active })
  window.HTMLElement.prototype.focus = function () { active = this as unknown as HTMLElement }
  for (const [name, value] of Object.entries({ window, document: window.document, HTMLElement: window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) vi.stubGlobal(name, value)
  container = window.document.getElementById('root') as unknown as HTMLElement; root = createRoot(container)
  for (const mock of [onGlobalView, onProjectPage, onProject, onCreate, onSettings, onMap, onDismissError, onTab]) mock.mockReset()
})
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals() })
const render = async (value: WorkspaceFrameProps = props()) => { await act(async () => root.render(createElement(WorkspaceFrame, value))) }

test('global navigation has three real destinations and places settings at the bottom without a global create shortcut', async () => {
  await render(props('map'))
  const nav = container.querySelector('nav[aria-label="主导航"]')!
  for (const label of ['地图探索', '项目空间', '案例与规则']) expect(nav.querySelector(`[aria-label="${label}"]`)).not.toBeNull()
  expect(nav.querySelector('[aria-label="新建项目"]')).toBeNull()
  expect([...nav.querySelectorAll('button')].at(-1)?.getAttribute('aria-label')).toBe('管理与设置')
  await act(async () => (nav.querySelector('[aria-label="案例与规则"]') as HTMLButtonElement).click())
  expect(onGlobalView).toHaveBeenCalledWith('knowledge')
  expect(onCreate).not.toHaveBeenCalled()
})
test('all six project pages are parallel visible navigation without lifecycle disabling or details nesting', async () => {
  await render()
  const nav = container.querySelector('nav[aria-label="项目工作区"]')!
  expect([...nav.querySelectorAll('button')].map(button => button.textContent)).toEqual(['项目总览', '资料与条件', '改造研判', '方案与测算', '调查任务', '成果与版本'])
  expect(nav.closest('details')).toBeNull()
  expect(nav.querySelectorAll('button[disabled]')).toHaveLength(0)
  expect(nav.querySelector('[aria-current="page"]')?.getAttribute('data-project-page')).toBe('assessment')
  await act(async () => (nav.querySelector('[data-project-page="scenarios"]') as HTMLButtonElement).click())
  expect(onProjectPage).toHaveBeenCalledWith('scenarios')
  expect(onTab).not.toHaveBeenCalled()
  expect(container.querySelector('.research-tabs')).toBeNull()
})

test('available project pages omit unavailable business entries while retaining global navigation, settings and the active page', async () => {
  await render({ ...props(), availableProjectPages: ['overview', 'evidence', 'assessment'] })
  const nav = container.querySelector('nav[aria-label="项目工作区"]')!
  expect([...nav.querySelectorAll('button')].map(button => button.textContent)).toEqual(['项目总览', '资料与条件', '改造研判'])
  expect(nav.querySelectorAll('button[disabled]')).toHaveLength(0)
  for (const id of ['scenarios', 'actions', 'results']) expect(nav.querySelector(`[data-project-page="${id}"]`)).toBeNull()
  expect(nav.querySelector('[aria-current="page"]')?.getAttribute('data-project-page')).toBe('assessment')
  expect(container.querySelector('[aria-label="当前位置"] strong')?.textContent).toBe('改造研判')
  await act(async () => (nav.querySelector('[data-project-page="evidence"]') as HTMLButtonElement).click())
  expect(onProjectPage).toHaveBeenCalledWith('evidence')
  for (const label of ['地图探索', '项目空间', '案例与规则', '管理与设置']) expect(container.querySelector(`.atlas-dock [aria-label="${label}"]`)).not.toBeNull()
  await act(async () => (container.querySelector('.atlas-dock [aria-label="管理与设置"]') as HTMLButtonElement).click())
  expect(onSettings).toHaveBeenCalledOnce()
})

test('project availability can expand to all six pages without remounting the map or changing navigation semantics', async () => {
  await render({ ...props(), availableProjectPages: ['overview', 'evidence', 'assessment'] })
  expect(container.querySelectorAll('[data-project-page]')).toHaveLength(3)
  await render({ ...props(), activeProjectPage: 'scenarios', availableProjectPages: ['overview', 'evidence', 'assessment', 'scenarios', 'actions', 'results'] })
  expect(container.querySelectorAll('[data-project-page]')).toHaveLength(6)
  expect(container.querySelector('[data-project-page="scenarios"]')?.getAttribute('aria-current')).toBe('page')
  await act(async () => (container.querySelector('[data-project-page="results"]') as HTMLButtonElement).click())
  expect(onProjectPage).toHaveBeenCalledWith('results')
  expect(mounted).toBe(1); expect(unmounted).toBe(0)
})
test('global content isolates project work without unmounting the map or interrupting project state', async () => {
  await render(props('map')); expect(mounted).toBe(1)
  await render(props('projects'))
  expect(container.querySelector('.research-drawer')?.textContent).toContain('GLOBAL_CONTENT')
  expect(container.querySelector('[data-workspace-surface="project"]')?.hasAttribute('hidden')).toBe(true)
  expect(container.querySelector('[data-workspace-surface="project"]')?.textContent).toContain('PROJECT_CONTENT')
  expect(container.querySelector('[data-workspace-surface="global"]')?.hasAttribute('hidden')).toBe(false)
  expect(container.querySelector('.map-stage')?.hasAttribute('hidden')).toBe(true)
  expect(container.querySelector('.map-stage')?.textContent).toBe('ACTUAL_MAP_VIEW')
  await render(props('knowledge')); await render(props('project')); await render(props('map'))
  expect(mounted).toBe(1); expect(unmounted).toBe(0)
  expect(container.querySelector('.map-stage')?.hasAttribute('hidden')).toBe(false)
})
test('project selection keeps its existing callback and closes its menu without inventing a selected project', async () => {
  await render()
  await act(async () => (container.querySelector('[aria-label="切换项目"]') as HTMLButtonElement).click())
  const menu = container.querySelector('[aria-label="项目空间列表"]')!
  await act(async () => [...menu.querySelectorAll('button')].find(button => button.textContent?.includes('另一真实项目'))!.click())
  expect(onProject).toHaveBeenCalledWith('P-two')
  expect(container.querySelector('[aria-label="项目空间列表"]')).toBeNull()
  expect(onCreate).not.toHaveBeenCalled()
})
test('exposes the existing scroll container and preserves its position when only a project page changes', async () => {
  await render()
  expect(scrollContainerRef.current).toBe(container.querySelector('.research-drawer-scroll'))
  scrollContainerRef.current!.scrollTop = 375
  expect(active?.getAttribute('aria-label')).toBe('项目主调研')
  await render({ ...props(), activeProjectPage: 'results' })
  expect(scrollContainerRef.current!.scrollTop).toBe(375)
})
test('load failures stay actionable in non-map pages and boot loading prevents navigation interaction', async () => {
  await render({ ...props('projects'), error: '真实项目读取失败' })
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('真实项目读取失败')
  await act(async () => (container.querySelector('[aria-label="关闭错误"]') as HTMLButtonElement).click())
  expect(onDismissError).toHaveBeenCalledOnce()
  await render({ ...props('projects'), bootLoading: true })
  expect(container.querySelector('nav[aria-label="主导航"]')?.hasAttribute('inert')).toBe(true)
  expect(container.querySelector('[role="status"]')?.textContent).toBe('正在打开项目空间')
})
