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
import type { ResearchRound } from '../../packages/retrofit/research-rounds'
import type { StrategyPacket } from '../../packages/retrofit/strategy'

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
    await vi.waitFor(() => expect(container.textContent).toContain('尚无已保存的完整方案'))
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

test('a writable local session starts one research run only after explicitly answering the internal-material question', async () => {
  const { container, root, dom } = setup()
  const project = { id: 'local-project', context_version: 0, name: '本机项目', input: { ...fixture, project_id: 'local-project' } } as unknown as Project
  const screening = projectRenewalModeInput(project.input)
  const base = '/api/projects/local-project/research-rounds'
  const draft: ResearchRound = { id: 'explicit-first-round', project_id: project.id, round_number: 1, context_version: 0, input_hash: 'first-round-input', parent_round_id: null, parent_input_hash: null, parent_context_version: null, first_round_id: 'explicit-first-round', first_input_hash: 'first-round-input', first_context_version: 0, origin: 'generated', status: 'draft', material_intake: 'none', allow_internal_ai: false, materials: [], missing_materials: [], result: null, error: null, created_at: '2026-10-15T08:00:00Z', updated_at: '2026-10-15T08:00:00Z' }
  const failed: StrategyPacket = { project_id: project.id, context_version: 0, input_hash: draft.input_hash, created_at: draft.created_at, synthetic: project.input.synthetic, status: 'failed', strategy: null, sources: [], decision: null, model_calls: [], research: null, error: 'MODEL_NOT_CONFIGURED' }
  const finished: ResearchRound = { ...draft, status: 'failed', result: failed, error: '测试响应：本轮未生成方案' }
  let attempted = false
  const transport = vi.fn((url: string, init: RequestInit) => {
    if (url.includes('renewal-strategy')) return Promise.resolve(response(null))
    if (url === base) return Promise.resolve(response(init.method === 'POST' ? { round: draft } : { rounds: attempted ? [finished] : [], materials: [], baseline_candidate: null }))
    if (url === `${base}/${draft.id}/run`) { attempted = true; return Promise.resolve(response({ round: finished, result: failed })) }
    if (url.endsWith('/renewal-mode')) return Promise.resolve(response({ screening, decision: null }))
    throw new Error(`Unexpected request ${init.method} ${url}`)
  })
  vi.stubGlobal('fetch', transport)
  try {
    await act(async () => root.render(createElement(StrategyOverview, { project, demoActive: false, onEvidence: vi.fn(), onInvestigate: vi.fn() })))
    await vi.waitFor(() => expect(container.querySelector('.research-intake h3')?.textContent).toContain('有没有企业或项目内部资料'))
    expect(transport.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(0)
    expect(transport.mock.calls.every(([, init]) => init.method === 'GET')).toBe(true)
    const start = [...container.querySelectorAll<HTMLButtonElement>('.research-intake-actions button')].find(button => button.textContent === '暂不补充，先用现有公开资料开展首轮研判')!
    await vi.waitFor(() => expect(start.disabled).toBe(false))
    await act(async()=>start.dispatchEvent(new dom.window.Event('click',{bubbles:true})))
    await vi.waitFor(() => expect(transport.mock.calls.filter(([url, init]) => url === `${base}/${draft.id}/run` && init.method === 'POST')).toHaveLength(1))
    const writes = transport.mock.calls.filter(([, init]) => init.method === 'POST')
    expect(writes.map(([url]) => url)).toEqual([base, `${base}/${draft.id}/run`])
    expect(JSON.parse(String(writes[0][1].body))).toEqual({ expected_context_version: 0, material_intake: 'none', document_ids: [], allow_internal_ai: false })
    expect(JSON.parse(String(writes[1][1].body))).toEqual({})
    expect(new Headers(writes[1][1].headers).get('X-Requested-With')).toBe('haizhizi')
    expect(transport.mock.calls.filter(([url]) => url.includes('renewal-strategy')).every(([, init]) => init.method === 'GET')).toBe(true)
    await vi.waitFor(() => expect(container.querySelector(`[data-round-id="${draft.id}"]`)?.textContent).toContain('本轮未完成'))
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
