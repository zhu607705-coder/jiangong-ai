import { afterEach, expect, test, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { parseHTML } from 'linkedom'
import fixture from '../../fixtures/inputs/01_auto.json'
import ResearchReasoningNotes from '../../apps/workspace/src/components/ResearchReasoningNotes'
import StrategyOverview from '../../apps/workspace/src/components/StrategyOverview'
import { WorkbenchAccessContext } from '../../apps/workspace/src/AdminAccess'
import type { Project } from '../../apps/workspace/src/api'
import type { StrategyPacket } from '../../packages/retrofit/strategy'
import type { ResearchRound } from '../../packages/retrofit/research-rounds'

vi.mock('../../apps/workspace/src/maps/RenewalModePanel', () => ({ default: () => createElement('section', { className: 'renewal-mode-panel' }, '本项目条件初筛') }))
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

const keys = ['demand', 'supply', 'adaptation', 'implementation', 'operations', 'resources'] as const
const project = { id: 'REASONING', name: '推理展示项目', context_version: 3, input: { ...fixture, project_id: 'REASONING', synthetic: false, business_profile: 'neighborhood', sources: [], facts: [], context_rules: [] } } as unknown as Project
function packet(): StrategyPacket {
  return { project_id: project.id, context_version: 3, input_hash: 'saved-final', created_at: '2026-10-15T08:00:00Z', synthetic: false, status: 'completed', error: null, decision: null, model_calls: [], research: null,
    sources: [{ id: 'REAL-SOURCE', title: '本轮公开资料', text: '本小区已登记管网维护需求。', url: null, published_at: null, role: 'current', locator: 'line:2' }, { id: 'FOREIGN', project_id: 'OTHER', title: '其他项目', text: '不属于当前项目', url: null, published_at: null, role: 'reference', locator: 'line:1' }],
    strategy: { headline: '上次已保存的本项目分析', summary: '按本项目维护需求研究分项更新。', preferred_mode: 'comprehensive', rationale: [{ point: '管网需求应先核实', quote: '本小区已登记管网维护需求。', source_id: 'REAL-SOURCE' }],
      paths: [{ mode: 'comprehensive', title: '分项改善', description: '保留建筑，分项研究设施改善。', actions: [{ title: '更新管网', detail: '按本项目范围核实管网。', evidence_refs: ['REAL-SOURCE'] }], requirements: ['工程量待测'] }, { mode: 'rebuild', title: '重建路径', description: '安置与规划条件先核实。', actions: [], requirements: ['取得安置方案'] }],
      dimensions: keys.map(key => ({ key, current: `原始现况-${key}`, current_level: 'unknown', comprehensive: `分项改善-${key}`, comprehensive_level: 'medium', rebuild: `重建目标-${key}`, rebuild_level: 'high', evidence_refs: [] })), next_checks: [] } }
}
function attempted(): StrategyPacket {
  return { ...packet(), input_hash: 'failed-new', created_at: '2026-10-15T09:00:00Z', status: 'failed', strategy: null, error: 'LIVE_STAGE_FAILED:TRANSPORT', workflow: { planner_status: 'completed', plan: null, tasks: [{ id: 'COST', role: 'cost_value', source_ids: ['REAL-SOURCE'], status: 'completed', reasoning: 'mixed' }], input_characters: 1200, source_characters: 1000, retained_source_characters: 700, output_characters: 300, compression: 'reduced', method: 'evidence_windows_and_untrusted_notes', notes: [{ task_id: 'COST', summary: '不可显示的内部摘要', observations: [{ source_id: 'REAL-SOURCE', quote: '本小区已登记管网维护需求。', locator: 'line:2', inference: '不在界面展开的中间过程' }], missing_data: [], reasoned_proposals: [{ kind: 'logical_inference', premises: ['管网维护需求已登记'], assumptions: [], conclusion: '先确定分项更新范围，再安排工程投入', verification: '现场测绘并对照管网台账', evidence_refs: ['REAL-SOURCE', 'UNKNOWN', 'FOREIGN'] }, { kind: 'scenario', premises: ['社区服务可分期组织'], assumptions: ['每月服务从试运行开始'], conclusion: '设置月度运营试运行情景', verification: '用一个月实际台账核对', evidence_refs: [], parameters: [{ name: '月度结余情景', value: 0, low: -2000, high: 3000, unit: '元/月', basis: '用于试运行区间讨论' }] }] }] } }
}
function round(result: StrategyPacket): ResearchRound {
  return { id: 'R-NEW', project_id: project.id, round_number: 2, context_version: 3, input_hash: result.input_hash, parent_round_id: 'R-OLD', parent_input_hash: 'saved-final', parent_context_version: 3, first_round_id: 'R-OLD', first_input_hash: 'saved-final', first_context_version: 3, origin: 'generated', status: result.status === 'completed' ? 'completed' : 'failed', material_intake: 'none', allow_internal_ai: false, materials: [], missing_materials: [], result, error: result.error, created_at: result.created_at, updated_at: result.created_at }
}
function dom() {
  const parsed = parseHTML('<html><body><div id="root"></div></body></html>')
  for (const [key, value] of Object.entries({ window: parsed.window, document: parsed.document, IS_REACT_ACT_ENVIRONMENT: true, requestAnimationFrame: (fn: FrameRequestCallback) => setTimeout(() => fn(0), 0), cancelAnimationFrame: clearTimeout })) vi.stubGlobal(key, value)
  parsed.window.HTMLElement.prototype.scrollIntoView = vi.fn()
  const container = parsed.document.getElementById('root')!, root = createRoot(container)
  return { container, root }
}
const inspect = (result: StrategyPacket | null) => renderToStaticMarkup(createElement(ResearchReasoningNotes, { result, onEvidence: vi.fn() }))

test('legacy and absent proposals render no empty card', () => {
  expect(inspect(null)).toBe('')
  expect(inspect(packet())).toBe('')
  const value = attempted(); value.workflow!.notes![0].reasoned_proposals = []
  expect(inspect(value)).toBe('')
})

test('actual proposals show conclusions, assumptions and readonly parameters without exposing intermediate thoughts', async () => {
  const app = dom(), value = attempted(), evidence = vi.fn(), scenario = vi.fn(), transport = vi.fn()
  vi.stubGlobal('fetch', transport)
  try {
    await act(async () => app.root.render(createElement(ResearchReasoningNotes, { result: value, onEvidence: evidence, onScenario: scenario })))
    expect(app.container.querySelector('h3')?.textContent).toBe('已取得的推理建议')
    expect(app.container.textContent).toContain('本轮最终方案尚未形成')
    expect(app.container.textContent).toMatch(/逻辑推理.*投入与价值.*管网维护需求已登记/s)
    expect(app.container.textContent).toContain('情景假设')
    expect(app.container.textContent).toContain('每月服务从试运行开始')
    expect(app.container.textContent).toContain('现场测绘并对照管网台账')
    expect([...app.container.querySelectorAll('tbody tr td')].map(cell => cell.textContent)).toEqual(['0', '-2,000', '3,000', '元/月', '用于试运行区间讨论'])
    expect(app.container.querySelector('input,textarea,select')).toBeNull()
    expect(app.container.textContent).not.toMatch(/不可显示的内部摘要|不在界面展开的中间过程|已发布|准确率|ROI/)
    expect(app.container.querySelectorAll('article button')).toHaveLength(1)
    await act(async () => app.container.querySelector<HTMLButtonElement>('article button')!.click())
    expect(evidence).toHaveBeenCalledWith(['REAL-SOURCE'], value)
    await act(async () => app.container.querySelector<HTMLButtonElement>('footer button')!.click())
    expect(scenario).toHaveBeenCalledWith('funding')
    expect(app.container.querySelector('article h4')?.textContent).toBe(value.workflow!.notes![0].reasoned_proposals![0].conclusion)
    expect(transport).not.toHaveBeenCalled()
    await act(async () => app.root.render(createElement(ResearchReasoningNotes, { result: packet(), onEvidence: evidence })))
    expect(app.container.querySelector('.research-reasoning-notes')).toBeNull()
  } finally { await act(async () => app.root.unmount()) }
})

test.each(['public-first', 'round-first'] as const)('new failed expert notes survive beside an older valid final result: %s', async order => {
  const app = dom(), old = packet(), failed = attempted(), reported = vi.fn(), evidence = vi.fn()
  let releasePublic!: (value: Response) => void, releaseRounds!: (value: Response) => void
  const transport = vi.fn((url: string | URL | Request, _init?: RequestInit) => String(url).includes('/renewal-strategy') ? new Promise<Response>(resolve => { releasePublic = resolve }) : new Promise<Response>(resolve => { releaseRounds = resolve }))
  vi.stubGlobal('fetch', transport)
  const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } })
  const render = (page: 'assessment' | 'scheme', section: string) => createElement(WorkbenchAccessContext.Provider, { value: { role: 'admin', canWrite: true } }, createElement(StrategyOverview, { project, demoActive: false, workspacePage: page, section, schemeDirection: 'comprehensive', directionSelection: { identity: 'REASONING:3:false', mode: 'comprehensive' }, onEvidence: evidence, onStrategyResult: reported, onInvestigate: vi.fn() }))
  try {
    await act(async () => app.root.render(render('assessment', 'direction')))
    const publish = () => releasePublic(json(old)), rounds = () => releaseRounds(json({ rounds: [round(failed)], materials: [], baseline_candidate: null }))
    await act(async () => { (order === 'public-first' ? publish : rounds)() })
    await act(async () => { (order === 'public-first' ? rounds : publish)() })
    await vi.waitFor(() => expect(app.container.querySelector('.research-reasoning-notes h3')?.textContent).toBe('已取得的推理建议'))
    expect(app.container.querySelector('.decision-brief h3')?.textContent).toBe(old.strategy!.headline)
    expect(app.container.querySelector('.research-reasoning-notes')?.getAttribute('data-result-status')).toBe('failed')
    expect([...app.container.querySelectorAll('.renewal-mode-panel,.decision-brief,.research-reasoning-notes')][0].classList.contains('renewal-mode-panel')).toBe(true)
    expect(reported).toHaveBeenCalledWith(old)
    expect(reported.mock.calls.every(([value]) => value?.status === 'completed')).toBe(true)
    await act(async () => app.container.querySelector<HTMLButtonElement>('.research-reasoning-notes article button')!.click())
    expect(evidence).toHaveBeenCalledWith(['REAL-SOURCE'], failed)
    await act(async () => app.root.render(render('scheme', 'detail')))
    expect(app.container.querySelector('.single-scheme-workspace')).not.toBeNull()
    expect(app.container.querySelector('.research-reasoning-notes')).toBeNull()
    expect(app.container.textContent).not.toContain('设置月度运营试运行情景')
    expect(transport.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true)
  } finally { await act(async () => app.root.unmount()) }
})

test('a newer successful result with no proposals supersedes failed notes; another context never contributes notes', async () => {
  const app = dom(), current = { ...packet(), input_hash: 'new-final', created_at: '2026-10-15T10:00:00Z' }, wrongContext = { ...attempted(), context_version: 2, created_at: '2026-10-15T11:00:00Z' }
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request) => new Response(JSON.stringify(String(url).includes('/renewal-strategy') ? current : { rounds: [round(attempted()), round(wrongContext)], materials: [], baseline_candidate: null }), { headers: { 'Content-Type': 'application/json' } })))
  try {
    await act(async () => app.root.render(createElement(WorkbenchAccessContext.Provider, { value: { role: 'admin', canWrite: true } }, createElement(StrategyOverview, { project, demoActive: false, workspacePage: 'assessment', section: 'direction', onEvidence: vi.fn(), onStrategyResult: vi.fn(), onInvestigate: vi.fn() }))))
    await vi.waitFor(() => expect(app.container.querySelector('.decision-brief')).not.toBeNull())
    expect(app.container.querySelector('.research-reasoning-notes')).toBeNull()
    expect(app.container.textContent).not.toContain('设置月度运营试运行情景')
  } finally { await act(async () => app.root.unmount()) }
})
