import { afterEach, expect, test, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { parseHTML } from 'linkedom'
import StrategyCurrentAssessment from '../../apps/workspace/src/components/StrategyCurrentAssessment'
import StrategyOverview from '../../apps/workspace/src/components/StrategyOverview'
import { WorkbenchAccessContext } from '../../apps/workspace/src/AdminAccess'
import type { DecisionDashboard as Dashboard } from '../../apps/host/generated/contracts'
import type { Project } from '../../apps/workspace/src/api'
import type { StrategyPacket } from '../../packages/retrofit/strategy'
import { NEIGHBORHOOD_DASHBOARD_POLICY } from '../../packages/decision/dashboard'
import input from '../../fixtures/inputs/01_auto.json'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
const keys = ['demand', 'supply', 'adaptation', 'implementation', 'operations', 'resources'] as const
function packet(): StrategyPacket {
  return { project_id: 'INFER', context_version: 1, input_hash: 'reasoned-current', created_at: '2026-10-15T10:00:00Z', synthetic: false, status: 'completed', error: null, sources: [], decision: null, model_calls: [], research: null,
    strategy: { headline: '按明确假设研究更新方向', summary: '现况资料不足，分开保留证据与情景判断。', preferred_mode: 'compare', rationale: [], paths: [{ mode: 'comprehensive', title: '保留建筑分项研究', description: '分项研究设施改善', actions: [], requirements: [] }, { mode: 'rebuild', title: '重建条件研究', description: '先核规划安置', actions: [], requirements: [] }], dimensions: keys.map(key => ({ key, current: `尚未取得-${key}`, current_level: 'unknown', comprehensive: '分项目标', comprehensive_level: 'medium', rebuild: '重建目标', rebuild_level: 'high', evidence_refs: [] })), next_checks: [], reasoning_dimensions: keys.map((key, i) => ({ key, level: i === 0 ? 'low' : i === 1 ? 'high' : 'medium', basis: i === 0 ? 'scenario_assumption' : 'logical_inference', premises: [`前提-${key}`], assumptions: i === 0 ? ['尚未实测的情景假设'] : [], reason: `评分原因-${key}`, verification: `验证方法-${key}`, evidence_refs: [] })) },
    workflow: { planner_status: 'completed', plan: null, tasks: [{ id: 'RESIDENTS', role: 'residents_operations', source_ids: [], status: 'completed', reasoning: 'reasoned_fallback' }], input_characters: 200, source_characters: 0, retained_source_characters: 0, output_characters: 700, compression: 'retained', method: 'evidence_windows_and_untrusted_notes' } }
}
function props(result = packet()) {
  const dashboard: Dashboard = { policy_version: NEIGHBORHOOD_DASHBOARD_POLICY, purpose: '六维现况', model: '实际研究模型', request_id: result.input_hash, status: 'completed', dimensions: keys.map(key => ({ key, value: null, confidence: null, basis: `尚未取得-${key}`, evidence_refs: [] })) }
  return { result, dashboard, descriptions: keys.map(key => ({ key, label: key, text: `尚未取得-${key}`, evidence_refs: [] })), demoActive: false, onEvidence: vi.fn(), onScheme: vi.fn() }
}
function dom() {
  const parsed = parseHTML('<html><body><div id="root"></div></body></html>')
  for (const [key, value] of Object.entries({ window: parsed.window, document: parsed.document, IS_REACT_ACT_ENVIRONMENT: true, requestAnimationFrame: (fn: FrameRequestCallback) => setTimeout(() => fn(0), 0), cancelAnimationFrame: clearTimeout })) vi.stubGlobal(key, value)
  parsed.window.HTMLElement.prototype.scrollIntoView = vi.fn()
  const container = parsed.document.getElementById('root')!, root = createRoot(container)
  return { container, root }
}

test('a genuine fallback opens the six model reasoning levels; selecting dimensions exposes premises, assumptions and validation', async () => {
  const app = dom(), value = props()
  try {
    await act(async () => app.root.render(createElement(StrategyCurrentAssessment, value)))
    expect(app.container.querySelector('.strategy-current-assessment')?.getAttribute('data-assessment-view')).toBe('reasoning')
    expect([...app.container.querySelectorAll('.dimension-readout strong')].map(row => row.textContent)).toEqual(['1.0', '5.0', '3.0', '3.0', '3.0', '3.0'])
    expect(app.container.querySelector('svg[role=img]')?.getAttribute('aria-label')).toBe('六维推理情景判断，6个维度已评估')
    expect(app.container.textContent).not.toMatch(/全部检索零命中|实测等级|六维模拟条件覆盖/)
    await act(async () => app.container.querySelector<HTMLButtonElement>('.dimension-readout button')!.click())
    expect(app.container.querySelector('.dimension-detail')?.textContent).toContain('情景假设')
    for (const text of ['前提：前提-demand', '假设：尚未实测的情景假设', '评分依据：评分原因-demand', '验证方式：验证方法-demand']) expect(app.container.querySelector('.dimension-detail')?.textContent).toContain(text)
    expect(app.container.querySelector('.dimension-detail button')).toBeNull()
    await act(async () => app.container.querySelectorAll<HTMLButtonElement>('.dimension-readout button')[1].click())
    expect(app.container.querySelector('.dimension-detail')?.textContent).toContain('假设：未额外设定')
    await act(async () => app.container.querySelector<HTMLButtonElement>('.strategy-assessment-switch button')!.click())
    expect([...app.container.querySelectorAll('.dimension-readout strong')].map(row => row.textContent)).toEqual(['—', '—', '—', '—', '—', '—'])
    expect(app.container.querySelectorAll('.radar-point,.radar-area')).toHaveLength(0)
    expect(app.container.querySelectorAll('.strategy-dimension-cards article')).toHaveLength(6)
    expect(app.container.querySelector('svg[role=img]')?.getAttribute('aria-label')).toContain('六维现况证据画像，0个维度已评估')
    await act(async () => app.root.render(createElement(StrategyCurrentAssessment, value)))
    expect(app.container.querySelector('.strategy-current-assessment')?.getAttribute('data-assessment-view')).toBe('evidence')
    expect(value.result.strategy!.dimensions.every(row => row.current_level === 'unknown')).toBe(true)
  } finally { await act(async () => app.root.unmount()) }
})

test('old or incomplete reasoning does not invent a chart or empty switch; complete measured views remain the default', () => {
  for (const change of [(value: StrategyPacket) => { delete value.strategy!.reasoning_dimensions }, (value: StrategyPacket) => { value.strategy!.reasoning_dimensions!.pop() }]) {
    const value = packet(); change(value)
    const document = parseHTML(renderToStaticMarkup(createElement(StrategyCurrentAssessment, props(value)))).document
    expect(document.querySelector('.strategy-assessment-switch')).toBeNull()
    expect(document.querySelectorAll('.radar-point')).toHaveLength(0)
    expect(document.querySelector('.strategy-current-assessment')?.getAttribute('data-assessment-view')).toBe('evidence')
  }
  const known = props(); known.dashboard.dimensions.forEach(row => { row.value = 3 })
  const knownDocument = parseHTML(renderToStaticMarkup(createElement(StrategyCurrentAssessment, known))).document
  expect(knownDocument.querySelector('.strategy-current-assessment')?.getAttribute('data-assessment-view')).toBe('evidence')
  const legacy = props(); delete legacy.result.workflow
  expect(parseHTML(renderToStaticMarkup(createElement(StrategyCurrentAssessment, legacy))).document.querySelector('.strategy-current-assessment')?.getAttribute('data-assessment-view')).toBe('evidence')
})

test('the actual assessment/current route shows the fallback chart without a work direction, no model POST or synthetic fact scores', async () => {
  const app = dom(), value = packet(), reported = vi.fn()
  const transport = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } }))
  vi.stubGlobal('fetch', transport)
  const project = { id: 'INFER', name: '推理画像项目', context_version: 1, input: { ...input, synthetic: false, business_profile: 'neighborhood', sources: [], facts: [], context_rules: [] } } as unknown as Project
  try {
    await act(async () => app.root.render(createElement(WorkbenchAccessContext.Provider, { value: { role: 'viewer', canWrite: false } }, createElement(StrategyOverview, { project, demoActive: false, workspacePage: 'assessment', section: 'current', onEvidence: vi.fn(), onInvestigate: vi.fn(), onStrategyResult: reported }))))
    await vi.waitFor(() => expect(app.container.querySelector('.strategy-current-assessment')?.getAttribute('data-assessment-view')).toBe('reasoning'))
    expect(app.container.querySelectorAll('.radar-point')).toHaveLength(6)
    expect(app.container.querySelector('.research-reasoning-notes,.single-scheme-workspace')).toBeNull()
    expect(reported).toHaveBeenCalledWith(value)
    expect(transport.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true)
    expect(value.strategy!.dimensions.every(row => row.current_level === 'unknown')).toBe(true)
  } finally { await act(async () => app.root.unmount()) }
})
