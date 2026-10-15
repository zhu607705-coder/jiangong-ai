import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { parseHTML } from 'linkedom'
import fixture from '../../fixtures/inputs/01_auto.json'
import type { RenewalStrategy, Source } from '../../apps/host/generated/contracts'
import type { Project } from '../../apps/workspace/src/api'
import type { StrategyPacket } from '../../packages/retrofit/strategy'
import LogicEvidencePanel from '../../apps/workspace/src/components/LogicEvidencePanel'

let root: Root, container: HTMLElement
const onEvidence = vi.fn()
const sharedText = '建设资金分期安排。综合整治保留管网；原拆原建另核全周期费用。'
const sources: StrategyPacket['sources'] = [
  { id: 'SHARED', title: '同一文件的资金与两路径记录', text: sharedText, url: 'https://example.org/shared', published_at: '2026-10-14', role: 'current', locator: 'line:3' },
  { id: 'REPAIR', title: '分项修缮原件', text: '更新现有水表和管网。', url: null, published_at: '2026-10-14', role: 'current', locator: 'line:8' },
  { id: 'REBUILD', title: '重建专属原件', text: '落实回搬后新建住宅。', url: null, published_at: '2026-10-14', role: 'current', locator: 'page:4' },
  { id: 'STRUCTURE', title: '结构调查记录', text: '本对象已有结构修缮调查。', url: null, published_at: '2026-10-14', role: 'current', locator: 'page:2' },
]
function project(): Project {
  const input = structuredClone(fixture) as Project['input']
  input.project_id = 'P-LOGIC'; input.synthetic = false; input.business_profile = 'neighborhood'; input.as_of = '2026-10-15'
  input.sources = sources.map(source => ({ id: source.id, title: source.title, untrusted_text: source.text,
    data_class: 'public', visibility: 'public', synthetic: false, hash: `hash-${source.id}`, locator: source.locator,
    content_status: 'excerpt', published_at: source.published_at!, date_status: 'verified' } satisfies Source))
  input.facts = [
    { id: 'funding', kind: 'funding_secured', value: true, unit: null, source_id: 'SHARED', locator: 'line:3', object_ref: 'project:P-LOGIC', observed_at: '2026-10-14', epistemic_status: 'fact' },
    { id: 'structure', kind: 'structure_repairable', value: true, unit: null, source_id: 'STRUCTURE', locator: 'page:2', object_ref: 'project:P-LOGIC', observed_at: '2026-10-14', epistemic_status: 'fact' },
  ]
  return { id: input.project_id, name: '逻辑对应测试', context_version: 4, input }
}
function packet(): StrategyPacket {
  const strategy: RenewalStrategy = {
    headline: '两条路径的初步比较', summary: '综合整治与原拆原建的比较只在选择前展示。', preferred_mode: 'compare',
    rationale: [{ point: '综合整治与原拆原建都需核对资金。', source_id: 'SHARED', quote: '建设资金分期安排。' }],
    paths: [
      { mode: 'comprehensive', title: '分项修缮', description: '保留现有建筑。原拆原建另行比较。',
        actions: [{ title: '改造现有管网', detail: '先更新水表。整体拆建另行处理。', evidence_refs: ['SHARED', 'REPAIR'] }], requirements: ['核对修缮施工边界。'] },
      { mode: 'rebuild', title: '拆建新住宅', description: '先落实安置与回搬。综合整治另行比较。',
        actions: [{ title: '组织腾退与重建', detail: '核对过渡安排。', evidence_refs: ['SHARED', 'REBUILD'] }], requirements: ['取得适用的重建规划条件。'] },
    ], dimensions: [], next_checks: [],
  }
  return { project_id: 'P-LOGIC', context_version: 4, input_hash: 'plan-4', created_at: '2026-10-15T00:00:00Z',
    synthetic: false, status: 'completed', strategy, sources: structuredClone(sources), decision: null, model_calls: [], research: null, error: null }
}
beforeEach(() => {
  const { window } = parseHTML('<!doctype html><html><body><div id="root"></div></body></html>')
  vi.stubGlobal('window', window); vi.stubGlobal('document', window.document); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('The controlled panel must not fetch')))
  root = createRoot(window.document.getElementById('root')!); container = window.document.getElementById('root') as unknown as HTMLElement
  onEvidence.mockReset()
})
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals() })
const render = async (selectedDirection: 'comprehensive' | 'rebuild' | null, strategyPacket: StrategyPacket | null = packet(), current = project()) => {
  await act(async () => root.render(createElement(LogicEvidencePanel, { project: current, selectedDirection, strategyPacket, onEvidence })))
}
const decisionText = () => [...container.querySelectorAll('.logic-evidence-decision-copy')].map(row => row.textContent).join(' ')

test('selected repair maps only its saved actions to actual sources, retaining a multi-topic original verbatim', async () => {
  const current = project(), result = packet(), before = JSON.stringify({ current, result })
  await render('comprehensive', result, current)
  expect(container.querySelector('[data-selected-direction]')?.getAttribute('data-selected-direction')).toBe('comprehensive')
  const decisions = decisionText()
  expect(decisions).toContain('改造现有管网'); expect(decisions).not.toMatch(/原拆原建|整体拆建|组织腾退与重建/)
  expect(container.querySelector('[data-source-id="REBUILD"]')).toBeNull()
  expect(container.querySelector('[data-source-id="SHARED"] blockquote')?.textContent).toBe(sharedText)
  expect(container.textContent).toContain('全口径费用与资金')
  expect(container.querySelector('.logic-evidence-action-standards')?.textContent).toContain('全口径费用与资金')
  expect(JSON.stringify({ current, result })).toBe(before)
  expect(fetch).not.toHaveBeenCalled()
})
test('switching direction replaces action and evidence mappings instead of mixing the two routes', async () => {
  await render('comprehensive'); await render('rebuild')
  expect(decisionText()).toContain('组织腾退与重建')
  expect(decisionText()).not.toContain('改造现有管网')
  expect(container.querySelector('[data-source-id="REPAIR"]')).toBeNull()
  expect(container.querySelector('[data-source-id="REBUILD"] blockquote')?.textContent).toBe('落实回搬后新建住宅。')
  expect(container.querySelector('.logic-evidence-comparison')).toBeNull()
})
test('only the unselected stage offers both standards and the saved cross-route rationale', async () => {
  await render(null)
  expect(container.querySelector('.logic-evidence-comparison')?.textContent).toContain('综合整治')
  expect(container.querySelector('.logic-evidence-comparison')?.textContent).toContain('原拆原建')
  expect(container.textContent).toContain('综合整治与原拆原建都需核对资金。')
  expect(container.querySelector('.logic-evidence-action')).toBeNull()
})
test('evidence navigation uses the cited source id and missing references remain explicit', async () => {
  const result = packet(); result.strategy!.paths[0].actions[0].evidence_refs.push('MISSING')
  await render('comprehensive', result)
  const button = container.querySelector<HTMLButtonElement>('[data-source-id="REPAIR"] button')!
  await act(async () => button.click())
  expect(onEvidence).toHaveBeenCalledWith(['REPAIR'])
  expect(container.querySelector('[data-source-id="MISSING"]')?.textContent).toContain('本轮未保存对应来源片段')
})
test('null, foreign or stale strategy packets cannot create a current-direction decision mapping or fetch a public replacement', async () => {
  await render('comprehensive', null)
  expect(container.querySelector('.logic-evidence-action')).toBeNull()
  expect(container.textContent).toContain('尚无当前版本方案')
  for (const patch of [{ project_id: 'P-FOREIGN' }, { context_version: 3 }, { synthetic: true }]) {
    await render('comprehensive', { ...packet(), ...patch })
    expect(container.querySelector('.logic-evidence-action')).toBeNull()
    expect(container.querySelector('.logic-evidence-stale')).not.toBeNull()
  }
  expect(fetch).not.toHaveBeenCalled()
})
test('canonical dimensions organize the selected API explanation while unregistered conditions remain unknown', async () => {
  const current = project(), result = packet(); current.input.facts = []
  result.strategy!.dimensions = [{ key: 'resources', current: '现有预算资料待核。', current_level: 'unknown',
    comprehensive: '分期安排维修与运维预算。原拆原建费用另行比较。', comprehensive_level: 'medium',
    rebuild: '分别落实拆除、新建及过渡费用。综合整治另行比较。', rebuild_level: 'medium', evidence_refs: ['SHARED'] }]
  await render('comprehensive', result, current)
  const dimension = container.querySelector('.logic-evidence-dimension')!
  expect(dimension.textContent).toContain('资金交付 · 本方向说明')
  expect(dimension.querySelector(':scope>p')?.textContent).toBe('分期安排维修与运维预算。')
  expect(dimension.closest('.logic-evidence-standard')?.querySelector('h5')?.textContent).toBe('全口径费用与资金')
  expect(container.querySelector('.logic-evidence-conditions')?.textContent).toContain('待核实')
  expect(container.querySelector('.logic-evidence-conditions')?.textContent).not.toContain('已确认')
  await render('rebuild', result, current)
  expect(container.querySelector('.logic-evidence-dimension>p')?.textContent).toBe('分别落实拆除、新建及过渡费用。')
})
