import { afterEach, expect, test, vi } from 'vitest'
import { act, createElement, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { parseHTML } from 'linkedom'
import input from '../../fixtures/inputs/01_auto.json'
import StrategyOverview, { type StrategyDirectionSelection, type StrategyWorkspaceNavigation, type SchemePane } from '../../apps/workspace/src/components/StrategyOverview'
import { WorkbenchAccessContext } from '../../apps/workspace/src/AdminAccess'
import type { Project } from '../../apps/workspace/src/api'
import type { StrategyPacket } from '../../packages/retrofit/strategy'
import type { ResearchRound } from '../../packages/retrofit/research-rounds'
import { projectRenewalModeInput } from '../../packages/retrofit/renewal-mode'

vi.mock('../../apps/workspace/src/components/CommunityOperationsPanel', () => ({ default: ({ direction }: { direction: string }) => createElement('div', { 'data-operations-mode': direction }, '本方向月度运营') }))
vi.mock('../../apps/workspace/src/components/CompleteCommunityDemo', () => ({ default: ({ direction, operationsOnly }: { direction: string; operationsOnly: boolean }) => createElement('div', { 'data-demo-operations-mode': direction, 'data-operations-only': String(operationsOnly) }, '本方向模拟运营') }))
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
const project = { id: 'WS', name: '方案独立工作区', context_version: 4, runs: [], input: { ...input, project_id: 'WS', synthetic: false, business_profile: 'neighborhood', sources: [], facts: [], context_rules: [] } } as unknown as Project
const saved: StrategyPacket = { project_id: project.id, context_version: 4, input_hash: 'workspace-hash', created_at: '2026-10-15T08:00:00Z', synthetic: false, status: 'completed', error: null, decision: null, model_calls: [], research: null,
  sources: [{ id: 'OBJECT', title: '本对象材料', text: '本项目逐栋核实结构与资金后分项更新。', url: null, published_at: null, role: 'current', locator: 'line:1' }, { id: 'CASE', title: '对标项目的维护安排', text: '对标项目登记了长期维护责任。', url: null, published_at: '2025-01-01', role: 'reference', locator: 'line:2' }],
  strategy: { headline: 'AI本项目综合整治与分期建议', summary: '先核实结构，再明确分期更新范围。', preferred_mode: 'comprehensive', rationale: [{ point: '依据对象资料确定调查顺序', quote: '本项目逐栋核实结构与资金后分项更新。', source_id: 'OBJECT' }, { point: '维护责任可作为本项目协商的对标事项', quote: '对标项目登记了长期维护责任。', source_id: 'CASE' }],
    paths: [{ mode: 'comprehensive', title: '保留建筑分项改善', description: '按楼栋更新设施，保持范围可核对。', actions: [{ title: '逐栋核实管网', detail: '按本项目原文核定分项工程。', evidence_refs: ['OBJECT'] }], requirements: ['取得结构鉴定'] }, { mode: 'rebuild', title: '原拆原建专项论证', description: '重建与安置前提专项核对。', actions: [{ title: '原拆原建居民安置调查', detail: '逐项核实原拆原建安置条件。', evidence_refs: ['OBJECT'] }], requirements: ['落实安置资料'] }],
    dimensions: (['demand', 'supply', 'adaptation', 'implementation', 'operations', 'resources'] as const).map(key => ({ key, current: `现况-${key}`, current_level: 'medium', comprehensive: `分项改善目标-${key}`, comprehensive_level: 'medium', rebuild: `原拆原建目标-${key}`, rebuild_level: 'high', evidence_refs: ['OBJECT'] })), next_checks: [{ title: '结构资料', detail: '补充结构鉴定', evidence_refs: ['OBJECT'] }] } }

async function mount(initial: { page: 'assessment' | 'scheme'; section: string; pane?: SchemePane; scheme?: 'comprehensive' | 'rebuild' }, value: StrategyPacket | null = saved, options: { collaborative?: boolean; rounds?: ResearchRound[] } = {}) {
  const dom = parseHTML('<html><body><div id="root"></div></body></html>')
  for (const [key, val] of Object.entries({ window: dom.window, document: dom.document, IS_REACT_ACT_ENVIRONMENT: true, requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0), cancelAnimationFrame: clearTimeout })) vi.stubGlobal(key, val)
  dom.window.HTMLElement.prototype.scrollIntoView = vi.fn()
  const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } })
  const transport = vi.fn(async (path: string | URL | Request, _init?: RequestInit) => { if (String(path).includes('/renewal-strategy')) return json(value); if (String(path).endsWith('/renewal-mode')) return json({ screening: projectRenewalModeInput(project.input), decision: null }); if (String(path).endsWith('/research-rounds')) return json({ rounds: options.rounds || [], materials: [], baseline_candidate: null }); throw new Error(`Unexpected request ${path}`) })
  vi.stubGlobal('fetch', transport)
  const navigate = vi.fn(), evidence = vi.fn(), choose = vi.fn(), reported = vi.fn<(result: StrategyPacket | null) => void>()
  function Harness() {
    const [location, setLocation] = useState(initial), [selection, setSelection] = useState<StrategyDirectionSelection | null>(null)
    const onNavigate = (target: StrategyWorkspaceNavigation) => { navigate(target); if (target.view === 'assessment' || target.view === 'scenarios') setLocation({ page: target.view === 'assessment' ? 'assessment' : 'scheme', section: target.section || 'direction', pane: target.pane, scheme: target.scheme }) }
    return createElement(WorkbenchAccessContext.Provider, { value: { role: options.collaborative ? 'admin' : 'viewer', canWrite: !!options.collaborative } }, createElement(StrategyOverview, { project, demoActive: false, workspacePage: location.page, section: location.section, pane: location.pane, schemeDirection: location.scheme, directionSelection: selection, onDirectionSelect: mode => { choose(mode); setSelection({ identity: 'WS:4:false', mode }) }, onNavigate, onEvidence: evidence, onStrategyResult: reported, onInvestigate: vi.fn() }))
  }
  const container = dom.document.getElementById('root')!, root = createRoot(container)
  await act(async () => root.render(createElement(Harness)))
  await vi.waitFor(() => expect(container.querySelector('[role=status]')).toBeNull())
  return { container, root, transport, navigate, evidence, choose, reported, cleanup: () => act(async () => root.unmount()) }
}

test('current assessment is directly accessible without a mode and does not mount scheme or operations businesses', async () => {
  const app = await mount({ page: 'assessment', section: 'current' })
  try {
    expect(app.container.querySelectorAll('.strategy-current-assessment .strategy-dimension-cards article')).toHaveLength(6)
    expect(app.container.querySelector('.strategy-current-assessment')?.textContent).toContain('现况-resources')
    expect(app.container.querySelector('.strategy-current-assessment')?.textContent).not.toContain('分项改善目标')
    expect(app.container.querySelector('.scheme-comparison')).toBeNull()
    expect(app.container.querySelector('[data-operations-mode]')).toBeNull()
    expect([...app.container.querySelectorAll<HTMLButtonElement>('.strategy-subnav button')].every(button => !button.disabled)).toBe(true)
    expect(app.choose).not.toHaveBeenCalled()
    expect(app.transport.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true)
  } finally { await app.cleanup() }
})

test('case and current references use the shared evidence callback with their actual packet instead of switching source pages', async () => {
  const app = await mount({ page: 'assessment', section: 'cases' })
  try {
    expect(app.container.querySelector('.strategy-related-cases')?.textContent).toContain('对标项目的维护安排')
    await act(async () => app.container.querySelector<HTMLButtonElement>('.strategy-related-cases article button')!.click())
    expect(app.evidence).toHaveBeenCalledWith(['CASE'], saved)
    expect(app.navigate).not.toHaveBeenCalled()
    expect(app.container.querySelector('.strategy-source-detail')).toBeNull()
  } finally { await app.cleanup() }
})

test('scheme comparison always opens both candidates and an explicit click changes work direction but not the system recommendation', async () => {
  const app = await mount({ page: 'scheme', section: 'compare' })
  try {
    expect(app.container.querySelector('.scheme-comparison')?.textContent).toContain('综合整治')
    expect(app.container.querySelector('.scheme-comparison')?.textContent).toContain('原拆原建')
    const rebuild = app.container.querySelector<HTMLButtonElement>('[data-open-scheme=rebuild]')!
    expect(rebuild.disabled).toBe(false)
    await act(async () => rebuild.click())
    expect(app.choose).toHaveBeenCalledWith('rebuild')
    expect(app.navigate).toHaveBeenLastCalledWith({ view: 'scenarios', section: 'detail', pane: 'content', scheme: 'rebuild' })
    expect(app.container.querySelector('.single-scheme-workspace')?.textContent).not.toContain('分项改善目标')
    await act(async () => app.root.render(createElement(WorkbenchAccessContext.Provider, { value: { role: 'viewer', canWrite: false } }, createElement(StrategyOverview, { project, demoActive: false, workspacePage: 'assessment', section: 'direction', directionSelection: { identity: 'WS:4:false', mode: 'rebuild' }, onDirectionSelect: app.choose, onNavigate: app.navigate, onEvidence: app.evidence, onInvestigate: vi.fn() }))))
    await vi.waitFor(() => expect(app.container.querySelector('.strategy-working-status')?.textContent).toContain('系统核验方向：综合整治'))
    expect(app.container.querySelector('.strategy-working-status')?.textContent).toContain('当前工作方向：原拆原建')
    expect(app.container.querySelector('.decision-criteria')).toBeNull()
  } finally { await app.cleanup() }
})

test('mode screening precedes the AI summary, manual direction and internal intake without claiming AI completion', async () => {
  const app = await mount({ page: 'assessment', section: 'direction' }, saved, { collaborative: true })
  try {
    await act(async () => app.container.querySelector<HTMLButtonElement>('.strategy-top>button')!.click())
    const order = [...app.container.querySelectorAll('.renewal-mode-panel,.decision-brief,.strategy-direction-selection,.research-intake')]
    expect(order[0].classList.contains('renewal-mode-panel')).toBe(true)
    expect(order[1].classList.contains('decision-brief')).toBe(true)
    expect(order[2].classList.contains('strategy-direction-selection')).toBe(true)
    expect(order[3].classList.contains('research-intake')).toBe(true)
    expect(app.container.querySelector('.renewal-stage')?.textContent).toBe('等待开始判定')
    expect(app.reported).toHaveBeenCalledWith(saved)
    expect(app.reported.mock.calls.some(([result]) => result === null)).toBe(false)
  } finally { await app.cleanup() }
})

test.each([
  { page: 'assessment', section: 'current' },
  { page: 'assessment', section: 'cases' },
  { page: 'scheme', section: 'detail', scheme: 'comprehensive' },
] as const)('without a completed result $page/$section keeps screening and intake while omitting empty dependent businesses', async location => {
  const app = await mount(location, null, { collaborative: true })
  try {
    expect(app.container.querySelector('.renewal-mode-panel')).not.toBeNull()
    expect(app.container.querySelector('.renewal-stage')?.textContent).toBe('等待开始判定')
    expect(app.container.querySelector('.renewal-mode-result')).toBeNull()
    expect(app.container.querySelector('.renewal-mode-intro button')?.textContent).toContain('开始判定改造模式')
    expect(app.container.querySelector('.research-intake')).not.toBeNull()
    expect(app.container.querySelector('.decision-brief,.strategy-direction-selection,.strategy-current-assessment,.strategy-related-cases,.scheme-comparison,.single-scheme-workspace,.strategy-scheme-entries')).toBeNull()
    expect(app.container.textContent).not.toMatch(/旧版建议|尚无本版本完整方案|尚无对应现况评价/)
    expect(app.reported).toHaveBeenCalledWith(null)
    expect(app.transport.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true)
  } finally { await app.cleanup() }
})

test('a failed result shows Chinese recovery actions after screening and never publishes a stray strategy', async () => {
  const failure: StrategyPacket = { ...saved, status: 'failed', strategy: null, error: 'LIVE_STAGE_FAILED:renewal_strategy:error:TRANSPORT' }
  const app = await mount({ page: 'assessment', section: 'cases' }, failure, { collaborative: true })
  try {
    const order = [...app.container.querySelectorAll('.renewal-mode-panel,.strategy-error,.research-intake')]
    expect(order[0].classList.contains('renewal-mode-panel')).toBe(true)
    expect(app.container.querySelector('.strategy-error')?.textContent).toContain('无法连接模型服务')
    expect(app.container.querySelector('.strategy-error')?.textContent).toContain('未生成整体更新方案')
    expect(app.container.querySelector('.strategy-error')?.textContent).toContain('重新读取已保存成果')
    expect(app.container.textContent).not.toContain('LIVE_STAGE_FAILED')
    expect(app.container.querySelector('.strategy-current-assessment,.strategy-related-cases,.single-scheme-workspace,.decision-brief')).toBeNull()
    expect(app.reported).toHaveBeenCalledWith(null)
  } finally { await app.cleanup() }
})

test('a completed saved result remains visible and available when another current read failed', async () => {
  const failure: StrategyPacket = { ...saved, status: 'failed', strategy: null, error: 'LIVE_STAGE_FAILED:renewal_strategy:error:TRANSPORT' }
  const record: ResearchRound = { id: 'SAVED-OLD', project_id: project.id, round_number: 1, context_version: project.context_version, input_hash: saved.input_hash, parent_round_id: null, parent_input_hash: null, parent_context_version: null, first_round_id: 'SAVED-OLD', first_input_hash: saved.input_hash, first_context_version: saved.context_version, origin: 'adopted_history', status: 'completed', material_intake: 'not_recorded', allow_internal_ai: false, materials: [], missing_materials: [], result: saved, error: null, created_at: saved.created_at, updated_at: saved.created_at }
  const app = await mount({ page: 'assessment', section: 'direction' }, failure, { collaborative: true, rounds: [record] })
  try {
    expect(app.container.querySelector('.decision-brief h3')?.textContent).toBe(saved.strategy!.headline)
    expect(app.container.querySelector('.strategy-direction-selection')).not.toBeNull()
    expect([...app.container.querySelectorAll<HTMLButtonElement>('.strategy-subnav button')].some(button => button.textContent === '六维现况')).toBe(true)
    expect(app.reported).toHaveBeenCalledWith(saved)
    expect(app.reported.mock.calls.some(([result]) => result === null)).toBe(false)
  } finally { await app.cleanup() }
})

test('an operations deep link mounts only the named scheme and keeps content, funding and other-path effects out of that pane', async () => {
  const app = await mount({ page: 'scheme', section: 'detail', pane: 'operations', scheme: 'rebuild' })
  try {
    expect(app.container.querySelector('[data-operations-mode=rebuild]')).not.toBeNull()
    expect(app.container.querySelector('[data-operations-mode=comprehensive]')).toBeNull()
    expect(app.container.textContent).not.toContain('分项改善目标')
    expect(app.container.querySelector('.scheme-comparison')).toBeNull()
    expect(app.choose).not.toHaveBeenCalled()
  } finally { await app.cleanup() }
})
