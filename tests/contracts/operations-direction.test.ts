import { afterEach, expect, test, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { parseHTML } from 'linkedom'
import { readFileSync } from 'node:fs'
import fixture from '../../fixtures/inputs/01_auto.json'
import CommunityOperationsPanel from '../../apps/workspace/src/components/CommunityOperationsPanel'
import SingleSchemeWorkspace from '../../apps/workspace/src/components/SingleSchemeWorkspace'
import CompleteCommunityDemo, { operationsOnlyDemoData } from '../../apps/workspace/src/components/CompleteCommunityDemo'
import { markOperationsDirection, operationsSnapshotMatchesDirection } from '../../apps/workspace/src/components/operations-direction'
import { currentDirectionText } from '../../apps/workspace/src/components/strategy-direction-text'
import { buildCompleteCommunityDemo } from '../../packages/retrofit/complete-demo'
import type { OperationsSnapshot } from '../../apps/host/generated/contracts'
import type { Project } from '../../apps/workspace/src/api'

const apiMock = vi.hoisted(() => vi.fn())
vi.mock('../../apps/workspace/src/api', () => ({ api: apiMock }))
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); apiMock.mockReset() })
const input = buildCompleteCommunityDemo().operations
const result = JSON.parse(readFileSync('research/test_results/complete-community-demo-calculations.json', 'utf8')).scenarios[1].result
const snapshot = (id: string, scope = input.scope_note): OperationsSnapshot => ({ id, project_id: 'P-OPS', context_version: 3, created_at: '2026-10-15T00:00:00Z', input_hash: id, input: { ...structuredClone(input), name: id, scope_note: scope }, result })

test('direction scope is explicit and preserves operating parameters while rejecting unmarked or stale snapshots', () => {
  const marked = markOperationsDirection(input, 'rebuild')
  expect({ ...marked, scope_note: input.scope_note }).toEqual(input)
  expect(input.scope_note).not.toContain('【研究方向：原拆原建】')
  expect(operationsSnapshotMatchesDirection(snapshot('new', marked.scope_note), 'rebuild', 'P-OPS', 3)).toBe(true)
  expect(operationsSnapshotMatchesDirection(snapshot('legacy'), 'rebuild', 'P-OPS', 3)).toBe(false)
  expect(operationsSnapshotMatchesDirection(snapshot('other', markOperationsDirection(input, 'comprehensive').scope_note), 'rebuild', 'P-OPS', 3)).toBe(false)
  expect(operationsSnapshotMatchesDirection(snapshot('old', marked.scope_note), 'rebuild', 'P-OPS', 4)).toBe(false)
  expect(operationsSnapshotMatchesDirection(snapshot('conflict', marked.scope_note + '\n【研究方向：综合整治】'), 'rebuild', 'P-OPS', 3)).toBe(false)
})

test('legacy cross-route sentences stay out of a selected path without removing its own safety prerequisites', () => {
  const text = '先核实本方向结构安全，未确认前不进入施工。整体拆建不进入本路径。保留年度维护预算。'
  expect(currentDirectionText(text, 'comprehensive')).toBe('先核实本方向结构安全，未确认前不进入施工。保留年度维护预算。')
  expect(text).toContain('整体拆建不进入本路径')
})

test('the real operations panel only offers same-direction snapshots for restoration and observation matching', async () => {
  const dom = parseHTML('<html><body><div id="root"></div></body></html>')
  vi.stubGlobal('window', dom.window); vi.stubGlobal('document', dom.document); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const project = { id: 'P-OPS', name: '运营隔离测试', context_version: 3, input: { ...fixture, sources: [] } } as unknown as Project
  apiMock.mockResolvedValue({ scenarios: [snapshot('未登记方向的原中心'), snapshot('整治方向', markOperationsDirection(input, 'comprehensive').scope_note), snapshot('拆建方向', markOperationsDirection(input, 'rebuild').scope_note)], observations: [], comparisons: [] })
  const root = createRoot(dom.document.getElementById('root')!)
  try {
    await act(async () => root.render(createElement(CommunityOperationsPanel, { project, direction: 'rebuild' })))
    expect(apiMock).not.toHaveBeenCalled()
    const panel = dom.document.querySelector('details.community-operations') as unknown as HTMLDetailsElement
    await act(async () => { panel.open = true; panel.dispatchEvent(new dom.window.Event('toggle')) })
    await vi.waitFor(() => expect(dom.document.querySelectorAll('.ops-history-list>.ops-snapshot')).toHaveLength(1))
    expect(dom.document.querySelector('.ops-history-list')?.textContent).toContain('拆建方向')
    expect(dom.document.querySelector('.ops-history-list')?.textContent).not.toContain('未登记方向的原中心')
    expect(dom.document.querySelector('[aria-label="对应冻结情景"]')?.textContent).not.toContain('整治方向')
    expect(dom.document.querySelector('.ops-unscoped-history')?.hasAttribute('open')).toBe(false)
    expect(dom.document.querySelectorAll('.ops-unscoped-history .ops-snapshot-actions')).toHaveLength(0)
    expect(dom.document.querySelector('.ops-unscoped-history')?.textContent).toContain('未登记方向的原中心')
  } finally { await act(async () => root.unmount()) }
})

test('the real single-scheme operations page displays its body immediately, loads saved records, and aborts the read on unmount', async () => {
  const dom = parseHTML('<html><body><div id="root"></div></body></html>')
  vi.stubGlobal('window', dom.window); vi.stubGlobal('document', dom.document); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const project = { id: 'P-OPS', name: '独立运营页面', context_version: 3, input: { ...fixture, synthetic: false, sources: [] } } as unknown as Project
  apiMock.mockResolvedValue({ scenarios: [snapshot('本方向冻结运营', markOperationsDirection(input, 'rebuild').scope_note)], observations: [], comparisons: [] })
  const root = createRoot(dom.document.getElementById('root')!)
  let readSignal: AbortSignal | undefined
  try {
    await act(async () => root.render(createElement(SingleSchemeWorkspace, { project, result: null, mode: 'rebuild', demoActive: false, pane: 'operations', onNavigate: vi.fn(), onEvidence: vi.fn() })))
    await vi.waitFor(() => expect(dom.document.querySelector('.ops-history-list')?.textContent).toContain('本方向冻结运营'))
    expect(dom.document.querySelector('section.community-operations--standalone>.ops-body')).not.toBeNull()
    expect(dom.document.querySelector('details.community-operations')).toBeNull()
    expect(dom.document.querySelector('[aria-label="运营情景比较"]')).not.toBeNull()
    expect(dom.document.querySelector('details.ops-demo-parameters')).not.toBeNull()
    expect(apiMock).toHaveBeenCalledOnce()
    expect(apiMock.mock.calls[0][0]).toBe('/projects/P-OPS/community-operations')
    expect(apiMock.mock.calls[0][1]).toBeUndefined()
    readSignal = apiMock.mock.calls[0][2] as AbortSignal
    expect(readSignal.aborted).toBe(false)
  } finally { await act(async () => root.unmount()) }
  expect(readSignal?.aborted).toBe(true)
})

test('demolition simulation operations omit capital and six-dimensional targets, and local comparisons are isolated by direction', async () => {
  const dom = parseHTML('<html><body><div id="root"></div></body></html>'), demo = buildCompleteCommunityDemo()
  const plan = (name: string) => ({ name, parameters: { demand: 1, activitySlots: 30, subsidy: 12000 }, input: demo.operations, result })
  const storage = new Map([
    ['hzz-synthetic-explorations:P-OPS', JSON.stringify([plan('旧的全量本地方案')])],
    ['hzz-synthetic-explorations:P-OPS:3:comprehensive', JSON.stringify([plan('整治方向专属本地方案')])],
    ['hzz-synthetic-explorations:P-OPS:3:rebuild', JSON.stringify([plan('拆建方向专属本地方案')])],
  ])
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.document, IS_REACT_ACT_ENVIRONMENT: true,
    matchMedia: () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
    requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 0), cancelAnimationFrame: clearTimeout,
    localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) } })) vi.stubGlobal(key, value)
  apiMock.mockResolvedValue(result)
  const project = { id: 'P-OPS', context_version: 3, name: '模拟运营隔离', input: { ...fixture, sources: [] } } as unknown as Project
  const root = createRoot(dom.document.getElementById('root')!)
  try {
    await act(async () => root.render(createElement(CompleteCommunityDemo, { project, operationsOnly: true, direction: 'rebuild' })))
    await vi.waitFor(() => expect(dom.document.querySelector('.playground-saved')?.textContent).toContain('拆建方向专属本地方案'))
    expect(dom.document.querySelector('.playground-saved')?.textContent).not.toContain('整治方向专属本地方案')
    expect(dom.document.querySelector('.full-demo-capital')).toBeNull()
    expect(dom.document.querySelector('.full-demo-six')).toBeNull()
    expect(dom.document.querySelector('.full-demo-provenance')).toBeNull()
    expect(dom.document.body.textContent).not.toMatch(/1,584|1584|神经网络|拟方案建设预算/)
    const exported = operationsOnlyDemoData(demo, 'rebuild', { selectedScenario: '基准', scenarios: [], playground: null })
    expect(exported.direction).toBe('rebuild')
    expect(Object.keys(exported)).not.toEqual(expect.arrayContaining(['capital', 'dimensions', 'afterDashboard', 'householdRegister']))
    expect(JSON.stringify(exported)).not.toContain('"capital"')
    await act(async () => root.render(createElement(CompleteCommunityDemo, { project, operationsOnly: true, direction: 'comprehensive' })))
    await vi.waitFor(() => expect(dom.document.querySelector('.playground-saved')?.textContent).toContain('整治方向专属本地方案'))
    expect(dom.document.querySelector('.playground-saved')?.textContent).not.toContain('拆建方向专属本地方案')
    expect(storage.get('hzz-synthetic-explorations:P-OPS:3:rebuild')).toContain('拆建方向专属本地方案')
    expect(storage.get('hzz-synthetic-explorations:P-OPS:3:comprehensive')).toContain('整治方向专属本地方案')
    expect(storage.get('hzz-synthetic-explorations:P-OPS')).toContain('旧的全量本地方案')
  } finally { await act(async () => root.unmount()) }
})
