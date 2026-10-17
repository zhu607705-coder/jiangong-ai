import { afterEach, expect, test, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { parseHTML } from 'linkedom'
import fixture from '../../fixtures/inputs/01_auto.json'
import StrategyResearchProgress from '../../apps/workspace/src/components/StrategyResearchProgress'
import StrategyOverview from '../../apps/workspace/src/components/StrategyOverview'
import type { StrategyProgress, StrategyWorkflowProgress } from '../../packages/retrofit/strategy'
import type { ResearchRound } from '../../packages/retrofit/research-rounds'
import type { Project } from '../../apps/workspace/src/api'

vi.mock('../../apps/workspace/src/maps/RenewalModePanel', () => ({ default: () => createElement('section', { className: 'renewal-mode-panel' }, '本对象条件初筛') }))
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
const phase = (name: StrategyWorkflowProgress['phase'], extra: Partial<StrategyWorkflowProgress> = {}, status: StrategyProgress['status'] = 'running'): StrategyProgress => ({ type: 'progress', stage: 'model', status, message: `${name}实际阶段更新`, workflow: { phase: name, ...extra } })
const tasks: NonNullable<StrategyWorkflowProgress['tasks']> = [{ id: 'BUILDING', role: 'building_delivery', status: 'completed', source_count: 3, summary: '已整理建筑条件和对应来源。' }, { id: 'COST', role: 'cost_value', status: 'failed', source_count: 4 }]
const inspect = (events: StrategyProgress[], elapsed = 125) => parseHTML(renderToStaticMarkup(createElement(StrategyResearchProgress, { events, elapsed, onStop: vi.fn() }))).document

test('elapsed time does not invent a phase, source total, experts, compression or completion', () => {
  const document = inspect([], 900)
  expect(document.querySelector('.strategy-elapsed')?.textContent).toContain('900 秒')
  expect(document.querySelectorAll('.srp-timeline li,.srp-expert')).toHaveLength(0)
  expect(document.querySelector('.srp-compression')).toBeNull()
  expect(document.querySelector('.strategy-progress-summary')?.textContent).toContain('资料数量等待服务返回')
  expect(document.body.textContent).not.toMatch(/已完成|研究已完成|\d+(?:\.\d+)?%/)
})

test('legacy stage events retain explicit statuses and the latest service source count', () => {
  const document = inspect([{ type: 'progress', stage: 'sources', status: 'completed', message: '已读项目资料', source_count: 8 }, { type: 'progress', stage: 'research', status: 'completed', message: '已筛选来源', source_count: 5 }, { type: 'progress', stage: 'model', status: 'running', message: '正在研究两条路径' }])
  expect(document.querySelectorAll('.srp-timeline li[data-state=completed]')).toHaveLength(2)
  expect(document.querySelectorAll('.srp-timeline li[data-state=running]')).toHaveLength(1)
  expect(document.querySelector('.strategy-progress-summary')?.textContent).toContain('已整理 5 份资料')
  expect(document.querySelector('.srp-experts')).toBeNull()
  expect(document.querySelector('.strategy-research-progress')?.getAttribute('data-workflow')).toBe('legacy')
})

test('native phase advancement records execution without inventing completion and task failures stay visible', () => {
  const events = [phase('planning', { tasks: [] }), phase('specialists', { tasks: tasks.map(task => ({ ...task, status: 'running' })) }), { ...phase('compression', { tasks, context_before_chars: 12000, context_after_chars: 8000 }), source_count: 4 }]
  const document = inspect(events)
  expect(document.querySelectorAll('.srp-timeline li[data-state=recorded]')).toHaveLength(2)
  expect(document.querySelectorAll('.srp-timeline li[data-state=completed]')).toHaveLength(0)
  expect(document.querySelectorAll('.srp-expert')).toHaveLength(2)
  expect(document.querySelector('[data-task-id=BUILDING]')?.getAttribute('data-state')).toBe('completed')
  expect(document.querySelector('[data-task-id=COST]')?.getAttribute('data-state')).toBe('failed')
  expect(document.querySelector('.strategy-progress-summary')?.textContent).toContain('已整理 4 份资料')
  expect(document.querySelector('.srp-experts')?.textContent).not.toContain('居民需求与运营专家')
  expect(document.body.textContent).not.toMatch(/本轮方案研究已完成|\d+(?:\.\d+)?%/)
  const failure = inspect([...events, phase('compression', {}, 'failed')])
  expect(failure.querySelector('.srp-timeline li:last-child')?.getAttribute('data-state')).toBe('failed')
  expect(failure.querySelector('[data-task-id=COST]')?.getAttribute('data-state')).toBe('failed')
  expect(failure.querySelector('h3')?.textContent).toBe('本轮方案研究未完成')
})

test('compression displays one reported character pair and does not combine a retry with stale counts', () => {
  const recorded = phase('compression', { context_before_chars: 12000, context_after_chars: 8000 })
  const document = inspect([recorded, phase('compression', { context_before_chars: 4000 })])
  expect(document.querySelector('.srp-compression')?.textContent).toContain('4,000')
  expect(document.querySelector('.srp-compression')?.textContent).toContain('等待记录')
  expect(document.querySelector('.srp-compression')?.textContent).not.toMatch(/8,000|token|\d+%|节省/)
  const zero = inspect([phase('compression', { context_before_chars: 0, context_after_chars: 0 })])
  expect([...zero.querySelectorAll('.srp-compression dd')].map(row => row.textContent)).toEqual(['0字符', '0字符'])
  expect(inspect([phase('planning')]).querySelector('.srp-compression')).toBeNull()
})

test('compares equivalent contexts, reports real growth and keeps source-only counts separately',()=>{
  const document=inspect([phase('compression',{context_before_chars:35432,context_after_chars:35353,context_metric:'equivalent_research_context',source_before_chars:16540,source_after_chars:13241}),phase('synthesis',{request_context_chars:35579})])
  expect(document.querySelector('.srp-compression')?.textContent).toContain('35,432')
  expect(document.querySelector('.srp-compression')?.textContent).toContain('减少 79')
  expect(document.querySelector('.srp-compression')?.textContent).toContain('最终方案输入上下文 35,579')
  const growth=inspect([phase('compression',{context_before_chars:1000,context_after_chars:1400,context_metric:'equivalent_research_context'})])
  expect(growth.querySelector('.srp-compression')?.textContent).toContain('增加 400')
  const legacy=inspect([phase('compression',{context_before_chars:21844,context_after_chars:35579})])
  expect(legacy.querySelector('.srp-compression')?.textContent).toContain('历史记录统计范围不同')
})

test('task snapshots replace prior cards, summaries are bounded, and unrequested model thinking is never rendered', () => {
  const raw = { ...phase('specialists', { tasks: [{ ...tasks[0], summary: '已验证任务要点。'.repeat(100) }] }), thinking: '不可显示的模型思维全文', raw_trace: '私有推理轨迹' } as StrategyProgress
  const document = inspect([phase('specialists', { tasks }), raw])
  expect(document.querySelectorAll('.srp-expert')).toHaveLength(1)
  expect(document.querySelector('.srp-expert details p')!.textContent!.length).toBeLessThanOrEqual(281)
  expect(document.body.textContent).not.toMatch(/不可显示的模型思维全文|私有推理轨迹/)
  expect(inspect([raw, phase('planning', { tasks: [] })]).querySelector('.srp-experts')).toBeNull()
})

test('a completed synthesis does not claim the whole run complete before an explicit result event', () => {
  const synthesis = phase('synthesis', { tasks }, 'completed')
  expect(inspect([synthesis]).querySelector('h3')?.textContent).not.toBe('本轮方案研究已完成')
  const complete = inspect([synthesis, { type: 'progress', stage: 'result', status: 'completed', message: '结果已核对并保存', source_count: 4 }])
  expect(complete.querySelector('h3')?.textContent).toBe('本轮方案研究已完成')
  expect(complete.querySelector('.strategy-elapsed button')).toBeNull()
  expect(complete.querySelector('[data-task-id=COST]')?.getAttribute('data-state')).toBe('failed')
})

test('the real strategy stream retains same-stage workflow phases, keeps mode screening first and stops its request', async () => {
  const dom = parseHTML('<html><body><div id="root"></div></body></html>')
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.document, IS_REACT_ACT_ENVIRONMENT: true, requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0), cancelAnimationFrame: clearTimeout })) vi.stubGlobal(key, value)
  dom.window.HTMLElement.prototype.scrollIntoView = vi.fn()
  const project: Project = { id: 'PROGRESS', name: '协作进度测试', context_version: 0, input: { ...fixture, synthetic: false } as Project['input'] }
  const draft: ResearchRound = { id: 'ROUND-PROGRESS', project_id: project.id, round_number: 1, context_version: 0, input_hash: 'round-hash', parent_round_id: null, parent_input_hash: null, parent_context_version: null, first_round_id: 'ROUND-PROGRESS', first_input_hash: 'round-hash', first_context_version: 0, origin: 'generated', status: 'draft', material_intake: 'none', allow_internal_ai: false, materials: [], missing_materials: [], result: null, error: null, created_at: '2026-10-15T13:00:00Z', updated_at: '2026-10-15T13:00:00Z' }
  let stream: ReadableStreamDefaultController<Uint8Array> | undefined
  const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } })
  const transport = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).includes('/renewal-strategy')) return json(null)
    if (String(url).endsWith('/research-rounds')) return init?.method === 'POST' ? json({ round: draft }) : json({ rounds: [], materials: [], baseline_candidate: null })
    if (String(url).endsWith('/run')) return new Response(new ReadableStream<Uint8Array>({ start(controller) { stream = controller } }), { headers: { 'Content-Type': 'application/x-ndjson' } })
    throw new Error(`Unexpected request ${url}`)
  })
  vi.stubGlobal('fetch', transport)
  const container = dom.document.getElementById('root')!, root = createRoot(container)
  try {
    await act(async () => root.render(createElement(StrategyOverview, { project, demoActive: false, workspacePage: 'assessment', section: 'direction', onEvidence: vi.fn(), onInvestigate: vi.fn() })))
    await vi.waitFor(() => expect(container.querySelector('.research-intake [role=status]')).toBeNull())
    await act(async () => container.querySelector<HTMLButtonElement>('.research-intake-actions button:nth-child(2)')!.click())
    await vi.waitFor(() => expect(stream).toBeDefined())
    await act(async () => {
      const encoder = new TextEncoder()
      for (const event of [phase('planning', { tasks: [] }), phase('specialists', { tasks }), phase('compression', { tasks, context_before_chars: 12000, context_after_chars: 8000 })]) stream!.enqueue(encoder.encode(JSON.stringify(event) + '\n'))
    })
    await vi.waitFor(() => expect(container.querySelectorAll('.srp-timeline li')).toHaveLength(3))
    expect(container.querySelectorAll('.srp-expert')).toHaveLength(2)
    expect([...container.querySelectorAll('.renewal-mode-panel,.strategy-research-progress')][0].classList.contains('renewal-mode-panel')).toBe(true)
    await act(async () => container.querySelector<HTMLButtonElement>('.strategy-elapsed button')!.click())
    expect(container.querySelector('.strategy-research-progress h3')?.textContent).toBe('研究已停止')
    expect(container.querySelector('[data-task-id=COST]')?.getAttribute('data-state')).toBe('failed')
    expect(transport.mock.calls.find(([url]) => String(url).endsWith('/run'))?.[1]?.signal?.aborted).toBe(true)
  } finally { await act(async () => root.unmount()) }
})
