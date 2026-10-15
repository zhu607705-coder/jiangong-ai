import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { parseHTML } from 'linkedom'
import fixture from '../../fixtures/inputs/01_auto.json'
import type { Project } from '../../apps/workspace/src/api'
import type { PublicStrategyIndexItem } from '../../packages/retrofit/strategy'
import { GlobalKnowledge, GlobalProjects, type GlobalProjectsProps } from '../../apps/workspace/src/components/GlobalWorkspace'

let root: Root, container: HTMLElement
const onProject = vi.fn(), onCreate = vi.fn(), onOpenPublished = vi.fn()
const project = (id: string, version: number): Project => ({ id, name: '同名研究项目', context_version: version,
  input: { ...structuredClone(fixture), project_id: id, synthetic: false, scope: { ...structuredClone(fixture.scope), name: `研究对象 ${id}` } } as Project['input'],
})
const published: PublicStrategyIndexItem = { project_id: 'P-A', project_name: '同名研究项目', context_version: 9, strategy_context_version: 7,
  created_at: '2026-10-15T06:24:00Z', headline: '已保存的管网更新方案', status: 'completed', synthetic: false, is_current: false, input_hash: 'real-saved-hash' }
const props = (patch: Partial<GlobalProjectsProps> = {}): GlobalProjectsProps => ({ projects: [project('P-A', 9), project('P-B', 3)], publishedPlans: [published], onProject, onCreate, onOpenPublished, ...patch })

beforeEach(() => {
  const { window } = parseHTML('<!doctype html><html><body><div id="root"></div></body></html>')
  vi.stubGlobal('window', window); vi.stubGlobal('document', window.document); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Global pages must not fetch')))
  container = window.document.getElementById('root') as unknown as HTMLElement; root = createRoot(container)
  onProject.mockReset(); onCreate.mockReset(); onOpenPublished.mockReset()
})
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals() })
const renderProjects = async (patch: Partial<GlobalProjectsProps> = {}) => { await act(async () => root.render(createElement(GlobalProjects, props(patch)))) }
const click = async (selector: string) => { await act(async () => container.querySelector<HTMLButtonElement>(selector)!.click()) }

test('work projects display supplied identities and versions without inventing progress or dates', async () => {
  const supplied = props(), before = JSON.stringify(supplied)
  await act(async () => root.render(createElement(GlobalProjects, supplied)))
  const cards = [...container.querySelectorAll('[data-project-id]')]
  expect(cards).toHaveLength(2)
  expect(cards[0].textContent).toContain('研究对象 P-A'); expect(cards[0].textContent).toContain('资料版本 v9')
  expect(cards[1].textContent).toContain('研究对象 P-B'); expect(cards[1].textContent).toContain('资料版本 v3')
  expect(cards[0].querySelector('code')?.textContent).toBe('P-A')
  expect(cards[1].querySelector('code')?.textContent).toBe('P-B')
  expect(cards[0].textContent).not.toMatch(/最近更新|已完成研判|综合整治|准确率/)
  expect(container.querySelector('[data-published-project-id]')).toBeNull()
  expect([...container.querySelectorAll('nav[aria-label="项目空间分类"] button')].map(button => button.textContent)).toEqual(['项目列表', '已发布成果'])
  expect(JSON.stringify(supplied)).toBe(before); expect(fetch).not.toHaveBeenCalled()
})

test('same-name work project buttons preserve the exact project id', async () => {
  await renderProjects(); await click('[data-project-id="P-B"] button'); await click('[data-project-id="P-A"] button')
  expect(onProject.mock.calls).toEqual([['P-B'], ['P-A']]); expect(onOpenPublished).not.toHaveBeenCalled()
})

test('creation and published snapshot navigation use separate callbacks', async () => {
  await renderProjects(); await click('.global-workspace-heading button'); await click('[data-project-section="published"]'); await click('[data-published-project-id="P-A"] button')
  expect(onCreate).toHaveBeenCalledOnce(); expect(onOpenPublished).toHaveBeenCalledWith('P-A'); expect(onProject).not.toHaveBeenCalled()
  expect(container.querySelector('[data-project-id]')).toBeNull()
})

test('published outcomes show their saved headline, source, version and actual generated timestamp', async () => {
  await renderProjects({ activeSection: 'published' })
  const card = container.querySelector('[data-published-project-id="P-A"]')!
  expect(card.textContent).toContain(published.headline); expect(card.textContent).toContain(`来源项目：${published.project_name}`)
  expect(card.textContent).toContain('成果资料版本 v7'); expect(card.textContent).toContain('项目当前资料版本 v9')
  const time = card.querySelector('time')!
  expect(card.textContent).toContain('历史快照'); expect(time.getAttribute('datetime') ?? time.getAttribute('dateTime')).toBe(published.created_at)
  expect(card.textContent).toContain('14:24'); expect(card.textContent).toContain('北京时间')
  expect(container.querySelector('details')).toBeNull()
})

test('empty states retain the authorized create action and do not fabricate published records', async () => {
  await renderProjects({ projects: [], publishedPlans: [] })
  expect(container.textContent).toContain('还没有工作项目'); expect(container.textContent).not.toContain('还没有已发布成果')
  await click('.global-workspace-empty button'); expect(onCreate).toHaveBeenCalledOnce()
  expect(container.querySelector('[data-published-project-id]')).toBeNull()
  await click('[data-project-section="published"]'); expect(container.textContent).toContain('还没有已发布成果')
  expect(container.textContent).not.toContain('还没有工作项目')
  await renderProjects({ projects: [], publishedPlans: [], canCreate: false, activeSection: 'projects' })
  expect(container.querySelector('.global-workspace-heading button')).toBeNull()
  expect(container.querySelector('.global-workspace-empty button')).toBeNull()
  expect(container.querySelectorAll('nav[aria-label="项目空间分类"] button')).toHaveLength(2)
})

test('controlled project sections follow the parent route without silently switching business content', async () => {
  const onSectionChange = vi.fn()
  await renderProjects({ activeSection: 'published', onSectionChange })
  expect(container.querySelector('nav[aria-label="项目空间分类"] [aria-current="page"]')?.textContent).toBe('已发布成果')
  expect(container.querySelector('[data-project-id]')).toBeNull()
  await click('[data-project-section="projects"]'); expect(onSectionChange).toHaveBeenCalledWith('projects')
  expect(container.querySelector('[data-published-project-id]')).not.toBeNull()
  await renderProjects({ activeSection: 'projects', onSectionChange })
  expect(container.querySelector('[data-published-project-id]')).toBeNull()
  expect(container.querySelectorAll('[data-project-id]')).toHaveLength(2)
})

test('loading and failure states are exposed while preserving previously loaded projects', async () => {
  await renderProjects({ loading: true, error: '成果目录读取失败' })
  expect(container.querySelector('[aria-busy]')?.getAttribute('aria-busy')).toBe('true')
  expect(container.querySelector('[role="status"]')?.textContent).toContain('正在读取')
  expect(container.querySelector('[role="alert"]')?.textContent).toBe('成果目录读取失败')
  expect(container.querySelectorAll('[data-project-id]')).toHaveLength(2)
  await renderProjects({ projects: [], publishedPlans: [], loading: true })
  expect(container.textContent).not.toContain('还没有工作项目')
  await renderProjects({ projects: [], publishedPlans: [], error: '项目读取失败' })
  expect(container.textContent).not.toContain('还没有工作项目'); expect(container.querySelector('[role="alert"]')?.textContent).toBe('项目读取失败')
})

test('knowledge shell renders supplied reference content directly and keeps its classifications visible', async () => {
  await act(async () => root.render(createElement(GlobalKnowledge, { children: createElement('article', { 'data-real-library': true }, '已有规则来源与审核记录') })))
  expect(container.querySelector('h1')?.textContent).toBe('案例与规则')
  expect(container.textContent).toContain('参考资料'); expect(container.querySelector('[data-real-library]')?.textContent).toBe('已有规则来源与审核记录')
  expect([...container.querySelectorAll('nav button')].map(button => button.textContent)).toEqual(['案例库', '规则库', '成本参考'])
  expect(container.querySelector('details')).toBeNull(); expect(fetch).not.toHaveBeenCalled()
})

test('controlled knowledge navigation reports the section and renders the parent supplied section', async () => {
  const onSectionChange = vi.fn(), onProjectSpace = vi.fn()
  await act(async () => root.render(createElement(GlobalKnowledge, { activeSection: 'rules', onSectionChange, onProjectSpace, children: '真实规则列表' })))
  expect(container.querySelector('nav [aria-current="page"]')?.textContent).toBe('规则库')
  await click('[data-knowledge-section="costs"]'); expect(onSectionChange).toHaveBeenCalledWith('costs')
  expect(container.querySelector('[data-active-section]')?.getAttribute('data-active-section')).toBe('rules')
  await act(async () => root.render(createElement(GlobalKnowledge, { activeSection: 'costs', onSectionChange, onProjectSpace, children: '真实成本来源' })))
  expect(container.querySelector('nav [aria-current="page"]')?.textContent).toBe('成本参考')
  expect(container.querySelector('.global-knowledge-content')?.textContent).toBe('真实成本来源')
  await click('.global-workspace-heading button'); expect(onProjectSpace).toHaveBeenCalledOnce()
})

test('standalone knowledge empty state offers project navigation and can switch references locally', async () => {
  const onProjectSpace = vi.fn()
  await act(async () => root.render(createElement(GlobalKnowledge, { onProjectSpace })))
  await click('[data-knowledge-section="rules"]')
  expect(container.querySelector('[data-active-section]')?.getAttribute('data-active-section')).toBe('rules')
  expect(container.querySelector('.global-workspace-empty')?.textContent).toContain('选择资料后查看规则库')
  await click('.global-workspace-empty button'); expect(onProjectSpace).toHaveBeenCalledOnce()
})
