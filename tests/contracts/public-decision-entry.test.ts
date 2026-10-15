import { afterEach, expect, test, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { parseHTML } from 'linkedom'
import input from '../../fixtures/inputs/01_auto.json'
import App from '../../apps/workspace/src/App'
import { WorkbenchAccessContext } from '../../apps/workspace/src/AdminAccess'
import { initialWorkbenchProject, publicDecisionHref, readWorkbenchLink } from '../../apps/workspace/src/public-decisions'
import { projectRenewalModeInput } from '../../packages/retrofit/renewal-mode'
import type { Project } from '../../apps/workspace/src/api'
import type { PublicStrategyIndexItem, StrategyPacket } from '../../packages/retrofit/strategy'

const apiMock = vi.hoisted(() => vi.fn())
vi.mock('../../apps/workspace/src/api', () => ({ api: apiMock, ADMIN_LOGIN_REQUIRED_EVENT: 'test-expired', ADMIN_LOGIN_REQUESTED_EVENT: 'test-login' }))
vi.mock('../../apps/workspace/src/components/WaitingScene', () => ({ default: () => null, WaitingMotif: () => null }))
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); apiMock.mockReset() })

function project(id: string, revision: number): Project {
  return { id, name: '浙大求是村 · 片区研究', context_version: revision, runs: [], input: { ...structuredClone(input), project_id: id, synthetic: false, business_profile: 'neighborhood', facts: [], context_rules: [], sources: [
    { id: 'OBJECT', title: '求是村更新资料', hash: 'source-hash', locator: 'source:object', content_status: 'excerpt', untrusted_text: '求是村保留建筑开展分项更新，结构与实施条件需逐栋调查。', data_class: 'public', visibility: 'public', synthetic: false },
  ] } } as unknown as Project
}
const emptyProject = project('WITHOUT-PLAN', 0), savedProject = project('WITH-PLAN', 14)
const published: PublicStrategyIndexItem = { project_id: savedProject.id, project_name: savedProject.name, context_version: 14, strategy_context_version: 14, created_at: '2026-10-15T06:00:00Z', headline: '求是村综合整治与分栋调查方案', status: 'completed', synthetic: false, is_current: true, input_hash: 'current-hash' }
const saved: StrategyPacket = { project_id: savedProject.id, context_version: 14, input_hash: 'current-hash', created_at: published.created_at, synthetic: false, status: 'completed',
  sources: [{ id: 'OBJECT', title: '求是村更新资料', text: savedProject.input.sources[0].untrusted_text!, url: null, published_at: null, role: 'current', locator: 'source:object' }], decision: null, model_calls: [], research: null, error: null,
  publication: { kind: 'current', is_current: true, current_input_hash: 'current-hash', saved_at: published.created_at }, strategy: { headline: published.headline, summary: '建议以综合整治为基线，逐栋核对结构和资金条件。', preferred_mode: 'comprehensive',
    rationale: [{ point: '逐栋核查实施条件', source_id: 'OBJECT', quote: savedProject.input.sources[0].untrusted_text! }],
    paths: [{ mode: 'comprehensive', title: '保留建筑、分项改善', description: '逐项核对管网和设施更新。', actions: [{ title: '核对分项需求', detail: '以原文和现场调查确认范围。', evidence_refs: ['OBJECT'] }], requirements: ['核实结构可修复性'] },
      { mode: 'rebuild', title: '拆建条件专项论证', description: '仅作拆建前置条件对照，不据此批准实施。', actions: [{ title: '开展拆建条件调查', detail: '核实权属、规划、安置与居民决议。', evidence_refs: ['OBJECT'] }], requirements: ['前置条件逐项确认'] }],
    dimensions: (['demand', 'supply', 'adaptation', 'implementation', 'operations', 'resources'] as const).map(key => ({ key, current: '保留已取得材料并核对对象范围', current_level: 'medium', comprehensive: '分项更新目标', comprehensive_level: 'medium', rebuild: '拆建前提另行核实', rebuild_level: 'unknown', evidence_refs: ['OBJECT'] })),
    next_checks: [{ title: '取得逐栋结构资料', detail: '核对鉴定对象、时间与实施限制。', evidence_refs: ['OBJECT'] }],
  } }

test('public defaults select a completed project by ID, while an explicit same-name project remains distinct', () => {
  const projects = [emptyProject, savedProject]
  const normal = initialWorkbenchProject(projects, [published], { viewer: true, storedProjectId: emptyProject.id, search: '' })
  expect(normal.selected?.id).toBe(savedProject.id); expect(normal.showOverview).toBe(true)
  const explicit = initialWorkbenchProject(projects, [published], { viewer: true, storedProjectId: savedProject.id, search: '?project=WITHOUT-PLAN&view=overview' })
  expect(explicit.selected?.id).toBe(emptyProject.id)
  expect(initialWorkbenchProject(projects, [published], { viewer: false, storedProjectId: emptyProject.id, search: '' }).selected?.id).toBe(emptyProject.id)
  expect(initialWorkbenchProject(projects, [published], { viewer: false, storedProjectId: emptyProject.id, search: '?view=published' }).selected?.id).toBe(savedProject.id)
  expect(readWorkbenchLink(publicDecisionHref('P/测试').split('?')[1]).projectId).toBe('P/测试')
})

async function mountWorkbench(search = '', snapshot = false) {
  const dom = parseHTML('<html><body><div id="root"></div></body></html>')
  const location = { href: `http://example.test/${search}`, search }, storage = new Map([['hzz_project', emptyProject.id], ['hzz-complete-demo-project', savedProject.id]])
  const history = { replaceState: vi.fn((_state: unknown, _unused: string, path: string) => { const url = new URL(path, 'http://example.test'); location.href = url.href; location.search = url.search }) }
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.document, location, history, MutationObserver: dom.window.MutationObserver, IS_REACT_ACT_ENVIRONMENT: true,
    requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0), cancelAnimationFrame: clearTimeout,
    localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) } })) vi.stubGlobal(key, value)
  const packet = snapshot ? { ...saved, publication: { kind: 'saved_snapshot' as const, is_current: false, current_input_hash: 'changed-parameters', saved_at: saved.created_at } } : saved
  apiMock.mockImplementation((path: string) => {
    if (path === '/session') return Promise.resolve({ model_configured: true })
    if (path === '/projects') return Promise.resolve([emptyProject, savedProject])
    if (path === '/projects/public-decisions') return Promise.resolve({ items: [published] })
    if (path === `/projects/${emptyProject.id}`) return Promise.resolve(emptyProject)
    if (path === `/projects/${savedProject.id}`) return Promise.resolve(savedProject)
    if (path.endsWith('/revision-diff')) return Promise.resolve({ available: false, changes: [] })
    if (path.endsWith('/followups') || path.endsWith('/documents')) return Promise.resolve([])
    if (path.includes('/renewal-strategy')) return Promise.resolve(path.includes(savedProject.id) ? packet : null)
    if (path.endsWith('/renewal-mode')) return Promise.resolve({ screening: projectRenewalModeInput(path.includes(savedProject.id) ? savedProject.input : emptyProject.input), decision: null })
    if (path === '/maps/config') return Promise.resolve({ configured: false })
    throw new Error(`Unexpected request ${path}`)
  })
  const focusBefore = dom.window.HTMLElement.prototype.focus, scrollBefore = dom.window.HTMLElement.prototype.scrollIntoView
  dom.window.HTMLElement.prototype.focus = vi.fn(); dom.window.HTMLElement.prototype.scrollIntoView = vi.fn()
  const root = createRoot(dom.document.getElementById('root')!)
  await act(async () => root.render(createElement(WorkbenchAccessContext.Provider, { value: { role: 'viewer', canWrite: false } }, createElement(App))))
  return { dom, location, root, cleanup: async () => { await act(async () => root.unmount()); dom.window.HTMLElement.prototype.focus = focusBefore; dom.window.HTMLElement.prototype.scrollIntoView = scrollBefore } }
}

test('anonymous entry opens a real completed plan, including both paths, citations and all six dimensions', async () => {
  const app = await mountWorkbench()
  try {
    await vi.waitFor(() => expect(app.dom.document.querySelector('.strategy-summary h3')?.textContent).toBe(published.headline))
    expect(app.dom.document.querySelector('.research-drawer')?.hasAttribute('hidden')).toBe(false)
    expect(app.location.search).toContain('project=WITH-PLAN')
    expect(app.dom.document.querySelector('.full-demo-mode-toolbar')?.textContent).toContain('打开完整数据模拟演示')
    const buttons = () => [...app.dom.document.querySelectorAll<HTMLButtonElement>('.strategy-overview button')]
    await act(async () => buttons().find(button => button.textContent === '原拆原建 · 整体拆建')!.click())
    expect(app.dom.document.querySelector('.strategy-plan-detail>h3')?.textContent).toBe('拆建条件专项论证')
    await act(async () => buttons().find(button => button.textContent === '对应依据')!.click())
    expect(app.dom.document.querySelector('.strategy-source-detail blockquote')?.textContent).toContain('求是村保留建筑')
    await act(async () => buttons().find(button => button.textContent === '现况与改后评估')!.click())
    expect(app.dom.document.querySelectorAll('.strategy-dimension-cards article')).toHaveLength(6)
    expect(apiMock.mock.calls.every(([, body]) => body === undefined)).toBe(true)
  } finally { await app.cleanup() }
})

test('a link to an empty same-name project shows its own state and explicitly switches to the source project', async () => {
  const app = await mountWorkbench('?project=WITHOUT-PLAN&view=overview')
  try {
    await vi.waitFor(() => expect(app.dom.document.querySelector('.strategy-empty-project')?.textContent).toContain('资料 v0'))
    expect(app.dom.document.querySelector('.strategy-summary h3')?.textContent).not.toBe(published.headline)
    const link = app.dom.document.querySelector<HTMLAnchorElement>('.strategy-published-alternatives a')!
    expect(link.getAttribute('href')).toBe(publicDecisionHref(savedProject.id))
    expect(link.textContent).toContain('来源项目：浙大求是村 · 片区研究 · 资料 v14')
    await act(async () => link.dispatchEvent(new app.dom.window.Event('click', { bubbles: true, cancelable: true })))
    await vi.waitFor(() => expect(app.dom.document.querySelector('.strategy-summary h3')?.textContent).toBe(published.headline))
    expect(app.location.search).toContain('project=WITH-PLAN')
    expect(apiMock.mock.calls.every(([, body]) => body === undefined)).toBe(true)
  } finally { await app.cleanup() }
})

test('a same-project saved snapshot is openly readable and labelled with its saved version', async () => {
  const app = await mountWorkbench('?project=WITH-PLAN&view=overview', true)
  try {
    await vi.waitFor(() => expect(app.dom.document.querySelector('.strategy-saved-snapshot')?.textContent).toContain('资料 v14'))
    expect(app.dom.document.querySelector('.strategy-saved-snapshot')?.textContent).toContain('当前研判参数或参考资料已更新')
    expect(app.dom.document.querySelector('.strategy-summary h3')?.textContent).toBe(published.headline)
  } finally { await app.cleanup() }
})

test('goal preferences are interactive for visitors and keep the rule-based action independent', async () => {
  const app = await mountWorkbench('?project=WITH-PLAN&view=overview')
  try {
    await vi.waitFor(() => expect(app.dom.document.querySelector('.decision-brief h3')?.textContent).toContain('综合整治优先'))
    const initialAction = app.dom.document.querySelector('.decision-current-action')?.textContent
    const preset = [...app.dom.document.querySelectorAll<HTMLButtonElement>('.decision-presets button')].find(button => button.textContent === '财政承受优先')!
    await act(async () => preset.click())
    expect(app.dom.document.querySelector<HTMLInputElement>('[aria-label="资金交付目标权重"]')?.value).toBe('5')
    expect(preset.getAttribute('aria-pressed')).toBe('true')
    expect(app.dom.document.querySelector('.decision-current-action')?.textContent).toBe(initialAction)
    expect(apiMock.mock.calls.every(([, body]) => body === undefined)).toBe(true)
  } finally { await app.cleanup() }
})
