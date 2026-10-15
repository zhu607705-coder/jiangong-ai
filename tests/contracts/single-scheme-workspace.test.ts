import { afterEach, expect, test, vi } from 'vitest'
import { act, createElement, type ComponentProps } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { Simulate } from 'react-dom/test-utils'
import { parseHTML } from 'linkedom'
import fixture from '../../fixtures/inputs/01_auto.json'
import SingleSchemeWorkspace from '../../apps/workspace/src/components/SingleSchemeWorkspace'
import type { Project } from '../../apps/workspace/src/api'
import type { StrategyPacket } from '../../packages/retrofit/strategy'
import type { SchemePane } from '../../apps/workspace/src/components/strategy-workspace'
import type { StrategyDirection } from '../../apps/workspace/src/components/strategy-direction-text'

vi.mock('../../apps/workspace/src/components/CommunityOperationsPanel', () => ({ default: ({ direction }: { direction: string }) => createElement('div', { 'data-real-operations': direction }, '现有运营组件') }))
vi.mock('../../apps/workspace/src/components/CompleteCommunityDemo', () => ({ default: ({ direction, operationsOnly }: { direction: string; operationsOnly: boolean }) => createElement('div', { 'data-demo-operations': direction, 'data-operations-only': String(operationsOnly) }, '现有模拟运营组件') }))
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
const project: Project = { id: 'SINGLE-P', name: '单方案测试项目', context_version: 4, input: { ...fixture, synthetic: false } as Project['input'] }
const result: StrategyPacket = {
  project_id: project.id, context_version: 4, input_hash: 'single-scheme-hash-v4', created_at: '2026-10-15T03:00:00Z', synthetic: false, status: 'completed',
  sources: [{ id: 'SINGLE-S', title: '本项目调查', text: '保留可读原文及本对象条件。', role: 'current', locator: 'line:2', url: null, published_at: null }], model_calls: [], research: null, decision: null, error: null,
  strategy: { headline: '全局判断不可进入单方案', summary: '全局摘要不在单方案显示', preferred_mode: 'comprehensive', rationale: [], next_checks: [],
    decision_brief: { renewal: { conclusion: '全局改造结论', reason: '全局改造理由', evidence_refs: ['SINGLE-S'] }, investment: { conclusion: '全局投入结论', reason: '全局投入理由', stage: 'construction', evidence_refs: ['SINGLE-S'] }, returns: { financial: '全局财务收益', social: '全局社会收益', evidence_refs: ['SINGLE-S'] } },
    paths: [
      { mode: 'comprehensive', title: '修缮供水与通行', description: '本轮优先实施供水维修。原拆原建属于另一方向。', actions: [{ title: '修缮管网', detail: '分栋核实管道接口。', evidence_refs: ['SINGLE-S'] }], requirements: ['确认维修责任。', '原拆原建方案不在本页。'] },
      { mode: 'rebuild', title: '重建居住与公共空间', description: '编制腾退与回搬方案。综合整治属于另一方向。', actions: [{ title: '核对回搬安排', detail: '明确临时安置与回搬批次。', evidence_refs: ['SINGLE-S'] }], requirements: ['核对拆建规划条件。', '综合整治方案不在本页。'] },
    ], dimensions: (['demand', 'supply', 'adaptation', 'implementation', 'operations', 'resources'] as const).map(key => ({ key, current: `现况-${key}`, current_level: 'unknown', comprehensive: `修缮目标-${key}`, comprehensive_level: 'low', rebuild: `重建目标-${key}`, rebuild_level: 'high', evidence_refs: ['SINGLE-S'] })),
  },
}
function props(pane: SchemePane, mode: StrategyDirection = 'comprehensive'): ComponentProps<typeof SingleSchemeWorkspace> { return { project, result, mode, pane, demoActive: false, onNavigate: vi.fn(), onEvidence: vi.fn() } }
const markup = (value: ReturnType<typeof props>) => renderToStaticMarkup(createElement(SingleSchemeWorkspace, value))
function doc(value: string) { return parseHTML(`<html><body>${value}</body></html>`).document }
async function mount(value: ReturnType<typeof props>) {
  const dom = parseHTML('<html><body><div id="root"></div></body></html>')
  vi.stubGlobal('window', dom.window); vi.stubGlobal('document', dom.document); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const container = dom.document.getElementById('root')!, root = createRoot(container)
  await act(async () => root.render(createElement(SingleSchemeWorkspace, value)))
  return { container, root }
}

test('a single scheme renders only its own path and targets, with real saved identity', () => {
  const first = doc(markup(props('content'))), second = doc(markup(props('content', 'rebuild')))
  expect(first.body.textContent).toContain('修缮供水与通行')
  expect(first.body.textContent).not.toMatch(/重建居住与公共空间|原拆原建|全局判断|全局投入|全局财务/)
  expect(second.body.textContent).toContain('核对回搬安排')
  expect(second.body.textContent).not.toMatch(/修缮供水与通行|综合整治|全局判断|全局投入|全局财务/)
  expect(first.querySelector('.ssw-header')?.textContent).toContain('资料 v4')
  expect(first.querySelector('.ssw-header span[title]')?.getAttribute('title')).toBe(result.input_hash)
  expect(first.querySelectorAll('.dimension-readout strong')[0]?.textContent).toBe('1.0')
  expect(second.querySelectorAll('.dimension-readout strong')[0]?.textContent).toBe('5.0')
})

test('real funding stays unfilled and user parameters use the existing budget calculation', async () => {
  const value = props('funding'), { container, root } = await mount(value)
  try {
    expect(container.querySelector<HTMLInputElement>('[aria-label="基础类工程（万元）"]')?.value).toBe('')
    expect(container.querySelector('.ssw-kpis')?.textContent).not.toMatch(/1,584|25,245|1600/)
    expect(container.querySelectorAll('.ssw-kpis dd')).toHaveLength(4)
    for (const [label, number] of Object.entries({ '基础类工程（万元）': '100', '完善类工程（万元）': '20', '提升类工程（万元）': '30', '计划资金（万元）': '140', '涉及户数（户）': '10' })) {
      const input = container.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!
      await act(async () => Simulate.change(input, { target: { value: number } } as never))
    }
    await act(async () => container.querySelector<HTMLButtonElement>('.ssw-primary')!.click())
    expect(Array.from(container.querySelectorAll('.ssw-kpis dd')).map(node => node.textContent)).toEqual(['165万元', '25万元', '150万元', '16.5万元／户'])
    const costs = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent?.includes('造价参考'))!
    await act(async () => costs.click())
    expect(value.onNavigate).toHaveBeenCalledWith({ view: 'knowledge', section: 'costs' })
    await act(async () => root.render(createElement(SingleSchemeWorkspace, { ...value, mode: 'rebuild' })))
    expect(container.querySelector<HTMLInputElement>('[aria-label="本方案建造费用（万元）"]')?.value).toBe('')
    expect(container.querySelector('.ssw-kpis dd')?.textContent).toContain('待补充')
  } finally { await act(async () => root.unmount()) }
})

test('simulation uses the selected budget package without adding reserve twice', () => {
  const first = doc(markup({ ...props('funding'), demoActive: true })), second = doc(markup({ ...props('funding', 'rebuild'), demoActive: true }))
  expect(first.querySelector<HTMLInputElement>('[aria-label="本方向预算费用包（万元）"]')?.value).toBe('1584')
  expect(second.querySelector<HTMLInputElement>('[aria-label="本方向预算费用包（万元）"]')?.value).toBe('25245')
  expect(second.querySelector<HTMLInputElement>('[aria-label="追加预备费（%）"]')?.value).toBe('0')
  expect(second.querySelector<HTMLInputElement>('[aria-label="计划资金（万元）"]')?.value).toBe('1600')
  expect(second.querySelectorAll('.ssw-kpis dd')[0]?.textContent).toBe('25,245万元')
  expect(second.querySelectorAll('.ssw-kpis dd')[1]?.textContent).toBe('23,645万元')
})

test('sensitivity shows the selected assessment only and preserves missing evidence as an interval', () => {
  const first = doc(markup(props('sensitivity'))), second = doc(markup(props('sensitivity', 'rebuild')))
  expect(first.querySelector('.ssw-priority-result>strong')?.textContent).toBe('20')
  expect(second.querySelector('.ssw-priority-result>strong')?.textContent).toBe('100')
  expect(first.body.textContent).not.toContain('原拆原建')
  expect(second.body.textContent).not.toContain('综合整治')
  const unreferenced = doc(markup({ ...props('sensitivity'), result: { ...result, sources: [] } }))
  expect(unreferenced.querySelector('.ssw-priority-result>strong')?.textContent).toBe('20–100')
  expect(unreferenced.querySelector('.ssw-contribution-table')?.textContent).toContain('待评价')
  const missing = doc(markup({ ...props('sensitivity'), result: null, demoActive: true }))
  expect(missing.body.textContent).toContain('待本方向方案与六维评价完成')
  expect(missing.querySelector('.ssw-priority-result')).toBeNull()
})

test('navigation is controlled and evidence receives the exact saved packet', async () => {
  const value = props('content'), { container, root } = await mount(value)
  try {
    await act(async () => container.querySelector<HTMLButtonElement>('.ssw-tabs button:nth-child(2)')!.click())
    expect(value.onNavigate).toHaveBeenCalledWith({ view: 'scenarios', section: 'detail', pane: 'funding', scheme: 'comprehensive' })
    expect(container.querySelector('.single-scheme-workspace')?.getAttribute('data-pane')).toBe('content')
    await act(async () => container.querySelector<HTMLButtonElement>('.ssw-actions .ssw-link')!.click())
    expect(value.onEvidence).toHaveBeenCalledWith(['SINGLE-S'], result)
    await act(async () => container.querySelector<HTMLButtonElement>('.ssw-header>button')!.click())
    expect(value.onNavigate).toHaveBeenCalledWith({ view: 'scenarios', section: 'compare' })
  } finally { await act(async () => root.unmount()) }
})

test('operations delegates to existing direction-scoped components and stale results are not published', () => {
  expect(doc(markup(props('operations', 'rebuild'))).querySelector('[data-real-operations="rebuild"]')).not.toBeNull()
  expect(doc(markup({ ...props('operations', 'rebuild'), demoActive: true })).querySelector('[data-demo-operations="rebuild"][data-operations-only="true"]')).not.toBeNull()
  const stale = doc(markup({ ...props('content'), result: { ...result, context_version: 3 } }))
  expect(stale.body.textContent).not.toContain('修缮供水与通行')
  expect(stale.querySelector('.ssw-targets .ssw-empty')).not.toBeNull()
})

test('a synthetic project reads its own saved round without replacing it with the complete demo', () => {
  const syntheticProject = { ...project, input: { ...project.input, synthetic: true } }, syntheticResult = { ...result, synthetic: true }
  const value = { ...props('content'), project: syntheticProject, result: syntheticResult, demoActive: false }
  const content = doc(markup(value)), funding = doc(markup({ ...value, pane: 'funding' }))
  expect(content.body.textContent).toContain('修缮供水与通行')
  expect(content.querySelector('.ssw-header span[title]')?.getAttribute('title')).toBe(result.input_hash)
  expect(content.querySelectorAll('.dimension-readout strong')[0]?.textContent).toBe('1.0')
  expect(funding.querySelector<HTMLInputElement>('[aria-label="基础类工程（万元）"]')?.value).toBe('')
  expect(funding.querySelector('.ssw-kpis dd')?.textContent).toContain('待补充')
})
