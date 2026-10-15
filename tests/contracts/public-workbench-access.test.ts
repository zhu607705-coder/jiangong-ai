import { afterEach, expect, test, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { parseHTML } from 'linkedom'
import fixture from '../../fixtures/inputs/01_auto.json'
import { WorkbenchAccessContext } from '../../apps/workspace/src/AdminAccess'
import StrategyOverview from '../../apps/workspace/src/components/StrategyOverview'
import PreliminaryCard from '../../apps/workspace/src/maps/PreliminaryCard'
import MapWorkspace from '../../apps/workspace/src/maps/MapWorkspace'
import IntelligencePanel from '../../apps/workspace/src/intelligence/IntelligencePanel'
import { projectRenewalModeInput } from '../../packages/retrofit/renewal-mode'
import type { Project } from '../../apps/workspace/src/api'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
const response = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })
function setup() {
  const dom = parseHTML('<html><body><div id="root"></div></body></html>')
  vi.stubGlobal('window', dom.window); vi.stubGlobal('document', dom.document); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const container = dom.document.getElementById('root')!, root = createRoot(container)
  return { dom, container, root }
}

test('a public visitor searches intelligence without requesting administrator status or management tabs', async () => {
  const { container, root } = setup()
  const transport = vi.fn(() => Promise.resolve(response({ items: [], truncated: false })))
  vi.stubGlobal('fetch', transport)
  try {
    await act(async () => root.render(createElement(WorkbenchAccessContext.Provider, { value: { role: 'viewer', canWrite: false } }, createElement(IntelligencePanel, { onOpenProject: vi.fn() }))))
    await vi.waitFor(() => expect(container.textContent).toContain('当前没有匹配资料'))
    expect(transport.mock.calls.every(call => !(call as unknown as [string])[0].includes('/intelligence/status'))).toBe(true)
    expect([...container.querySelectorAll('.intel-tabs button')].map(button => button.textContent)).toEqual(['检索'])
    expect(container.textContent).not.toContain('管理信源')
  } finally { await act(async () => root.unmount()) }
})

test('a viewer restores saved strategy data without starting model research after a cache miss', async () => {
  const { container, root } = setup()
  const project = { id: 'public-project', context_version: 0, name: '公开项目', input: fixture } as unknown as Project
  const screening = projectRenewalModeInput(project.input)
  const transport = vi.fn((url: string) => Promise.resolve(response(url.includes('renewal-strategy') ? null : { screening, decision: null })))
  vi.stubGlobal('fetch', transport)
  try {
    await act(async () => root.render(createElement(WorkbenchAccessContext.Provider, { value: { role: 'viewer', canWrite: false } }, createElement(StrategyOverview, { project, demoActive: false, onEvidence: vi.fn(), onInvestigate: vi.fn() }))))
    await vi.waitFor(() => expect(container.textContent).toContain('管理员生成并保存方案后'))
    expect(transport.mock.calls.length).toBeGreaterThan(0)
    expect(transport.mock.calls.every(call => (call as unknown as [string, RequestInit])[1].method === 'GET')).toBe(true)
    const buttons = [...container.querySelectorAll('button')]
    expect(buttons.find(button => button.textContent?.includes('重新检索与研判'))?.hasAttribute('disabled')).toBe(true)
    expect(buttons.find(button => button.textContent?.includes('判定改造模式'))?.hasAttribute('disabled')).toBe(true)
  } finally { await act(async () => root.unmount()) }
})

test('selecting an unstudied map point as a viewer does not create a screening context', async () => {
  const { container, root } = setup(), transport = vi.fn(), onContext = vi.fn()
  vi.stubGlobal('fetch', transport)
  try {
    await act(async () => root.render(createElement(WorkbenchAccessContext.Provider, { value: { role: 'viewer', canWrite: false } }, createElement(PreliminaryCard, {
      selection: { id: 'point-120,30', kind: 'point', name: '选中位置', longitude: 120, latitude: 30, coordinate_encoding: 'GCJ-02' },
      profile: 'neighborhood', theme: 'overall', cell: null, onContext, onProfile: vi.fn(), onOpenProject: vi.fn(),
    }))))
    await vi.waitFor(() => expect(container.textContent).toContain('管理员登录后可研究'))
    expect(transport).not.toHaveBeenCalled(); expect(onContext).not.toHaveBeenCalled()
  } finally { await act(async () => root.unmount()) }
})

test('the local administrator still starts strategy generation when no saved result exists', async () => {
  const { container, root } = setup()
  const project = { id: 'local-project', context_version: 0, name: '本机项目', input: fixture } as unknown as Project
  const screening = projectRenewalModeInput(project.input)
  const transport = vi.fn((url: string, init: RequestInit) => Promise.resolve(response(url.includes('renewal-strategy')
    ? init.method === 'POST' ? { strategy: null, model_calls: [], sources: [], error: null } : null
    : { screening, decision: null })))
  vi.stubGlobal('fetch', transport)
  try {
    await act(async () => root.render(createElement(StrategyOverview, { project, demoActive: false, onEvidence: vi.fn(), onInvestigate: vi.fn() })))
    await vi.waitFor(() => expect(transport.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(1))
    expect(container.querySelector('.strategy-top button')?.hasAttribute('disabled')).toBe(false)
    expect(transport.mock.calls.find(([, init]) => init.method === 'POST')?.[0]).toContain('/projects/local-project/renewal-strategy')
  } finally { await act(async () => root.unmount()) }
})

test('a viewer can open an existing map project while creation and screening remain unavailable', async () => {
  const { container, root, dom } = setup(), onOpenProject = vi.fn(), transport = vi.fn()
  const project = { id: 'saved-project', context_version: 0, name: '已保存项目', input: fixture } as unknown as Project
  vi.stubGlobal('fetch', transport)
  try {
    await act(async () => root.render(createElement(WorkbenchAccessContext.Provider, { value: { role: 'viewer', canWrite: false } }, createElement(MapWorkspace, {
      ready: false, interactionBlocked: false, project, focusProject: 1, settingsRequest: 0, onOpenProject, onCreateFromPlace: vi.fn(),
    }))))
    await vi.waitFor(() => expect(container.querySelector('.atlas-inspector')?.textContent).toContain('已保存项目'))
    const open = [...container.querySelectorAll('button')].find(button => button.textContent?.includes('进入项目研判'))!
    expect(open.hasAttribute('disabled')).toBe(false)
    await act(async () => open.dispatchEvent(new dom.window.Event('click', { bubbles: true })))
    expect(onOpenProject).toHaveBeenCalledOnce()
    expect(container.querySelector('.area-selection-controls button')?.hasAttribute('disabled')).toBe(true)
    expect(container.querySelector('.screening-start')?.hasAttribute('disabled')).toBe(true)
    expect(transport).not.toHaveBeenCalled()
  } finally { await act(async () => root.unmount()) }
})
