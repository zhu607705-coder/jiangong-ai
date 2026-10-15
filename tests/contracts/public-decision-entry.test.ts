import { afterEach, expect, test, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { parseHTML } from 'linkedom'
import { readFileSync } from 'node:fs'
import input from '../../fixtures/inputs/01_auto.json'
import App from '../../apps/workspace/src/App'
import DecisionBrief from '../../apps/workspace/src/components/DecisionBrief'
import StrategyOverview from '../../apps/workspace/src/components/StrategyOverview'
import { WorkbenchAccessContext } from '../../apps/workspace/src/AdminAccess'
import { initialWorkbenchProject, publicDecisionHref, readWorkbenchLink } from '../../apps/workspace/src/public-decisions'
import { projectRenewalModeInput, evaluateRenewalModeGate } from '../../packages/retrofit/renewal-mode'
import type { Project } from '../../apps/workspace/src/api'
import type { PublicStrategyIndexItem, StrategyPacket } from '../../packages/retrofit/strategy'
import type { ResearchRound, ResearchRoundsResponse } from '../../packages/retrofit/research-rounds'
import { QIUSHI_DEMO_PROJECT_ID, QIUSHI_SOURCE_PROJECT_ID } from '../../packages/retrofit/qiushi-demo'
import { buildCompleteCommunityDemo } from '../../packages/retrofit/complete-demo'
import { markOperationsDirection } from '../../apps/workspace/src/components/operations-direction'

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

async function mountWorkbench(search = '', snapshot = false, override?: StrategyPacket | null | Promise<StrategyPacket | null>, roundHistory?: ResearchRoundsResponse | Promise<ResearchRoundsResponse>, replay = false) {
  const dom = parseHTML('<html><body><div id="root"></div></body></html>')
  const location = { href: `http://example.test/${search}`, search }, storage = new Map([['hzz_project', emptyProject.id], ['hzz-complete-demo-project', savedProject.id]])
  const history = { replaceState: vi.fn((_state: unknown, _unused: string, path: string) => { const url = new URL(path, 'http://example.test'); location.href = url.href; location.search = url.search }) }
  Object.defineProperties(dom.window, { location: { configurable: true, value: location }, history: { configurable: true, value: history } })
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.document, location, history, MutationObserver: dom.window.MutationObserver, IS_REACT_ACT_ENVIRONMENT: true,
    requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0), cancelAnimationFrame: clearTimeout,
    localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) } })) vi.stubGlobal(key, value)
  const replayProject = project(QIUSHI_DEMO_PROJECT_ID, 14), replayed = structuredClone(saved)
  replayed.project_id = replayProject.id; replayed.input_hash = 'fixed-replay-hash'
  replayed.publication = { kind: 'saved_snapshot', is_current: false, current_input_hash: 'fixed-input', saved_at: replayed.created_at }
  replayed.strategy!.dimensions.forEach(row => { row.current_level = 'unknown' })
  replayed.strategy!.reasoning_dimensions = replayed.strategy!.dimensions.map(row => ({ key: row.key, level: 'medium', basis: 'scenario_assumption', premises: ['固定资料范围内尚无实测'], assumptions: ['按分项实施情景研究'], reason: '回放中的模型情景判断', verification: '取得本项目台账后复核', evidence_refs: [] }))
  replayed.workflow = { planner_status: 'completed', plan: null, tasks: [{ id: 'RESIDENTS', role: 'residents_operations', source_ids: [], status: 'completed', reasoning: 'reasoned_fallback' }], input_characters: 1000, source_characters: 500, retained_source_characters: 500, output_characters: 300, compression: 'retained', method: 'evidence_windows_and_untrusted_notes' }
  const packet = replay ? replayed : override === undefined ? (snapshot ? { ...saved, publication: { kind: 'saved_snapshot' as const, is_current: false, current_input_hash: 'changed-parameters', saved_at: saved.created_at } } : saved) : override
  // Existing simulation output is a UI transport fixture only; it is never seeded into a project or passed to a provider.
  const operationFixture = replay ? JSON.parse(readFileSync('research/test_results/complete-community-demo-calculations.json', 'utf8')).scenarios[1].result : null
  apiMock.mockImplementation((path: string) => {
    if (path === '/session') return Promise.resolve({ model_configured: true })
    if (path === '/projects') return Promise.resolve(replay ? [replayProject, emptyProject, savedProject] : [emptyProject, savedProject])
    if (path === '/projects/public-decisions') return Promise.resolve({ items: [published] })
    if (path === `/projects/${emptyProject.id}`) return Promise.resolve(emptyProject)
    if (path === `/projects/${savedProject.id}`) return Promise.resolve(savedProject)
    if (path === `/projects/${replayProject.id}`) return Promise.resolve(replayProject)
    if (replay && path.includes(replayProject.id) && /research-rounds|revision-diff|followups/.test(path)) throw new Error('Fixed replay must not read retry history')
    if (path.endsWith('/revision-diff')) return Promise.resolve({ available: false, changes: [] })
    if (path.endsWith('/followups') || path.endsWith('/documents')) return Promise.resolve([])
    if (path.endsWith('/research-rounds')) return Promise.resolve(roundHistory || { rounds: [], materials: [], baseline_candidate: null })
    if (path.endsWith('/knowledge/groups')) return Promise.resolve({ groups: [], documents: [] })
    if (path.endsWith('/knowledge/pipeline')) return Promise.resolve({ cards: [] })
    if (path.startsWith('/experiences/search?')) return Promise.resolve({ items: [] })
    if (path.includes('/renewal-strategy')) return Promise.resolve(path.includes(replay ? replayProject.id : savedProject.id) ? packet : null)
    if (replay && path.endsWith('/community-operations')) return Promise.resolve({ scenarios: [{ id: 'UI-OPS-FIXTURE', project_id: replayProject.id, context_version: 14, input_hash: 'ui-only-snapshot', created_at: replayed.created_at, input: markOperationsDirection(buildCompleteCommunityDemo().operations,'comprehensive'), result: operationFixture }], observations: [], comparisons: [] })
    if (replay && path.endsWith('/community-operations/preview')) return Promise.resolve(operationFixture)
    if (path.endsWith('/renewal-mode')) return Promise.resolve({ screening: projectRenewalModeInput(path.includes(savedProject.id) ? savedProject.input : emptyProject.input), decision: null })
    if (path === '/maps/config') return Promise.resolve({ configured: false })
    throw new Error(`Unexpected request ${path}`)
  })
  const focusBefore = dom.window.HTMLElement.prototype.focus, scrollBefore = dom.window.HTMLElement.prototype.scrollIntoView
  let focused: Element | null = null
  Object.defineProperty(dom.document, 'activeElement', { configurable: true, get: () => focused })
  dom.window.HTMLElement.prototype.focus = vi.fn(function (this: HTMLElement) { focused = this }); dom.window.HTMLElement.prototype.scrollIntoView = vi.fn()
  const root = createRoot(dom.document.getElementById('root')!)
  await act(async () => root.render(createElement(WorkbenchAccessContext.Provider, { value: roundHistory || replay ? { role: 'admin', canWrite: true } : { role: 'viewer', canWrite: false } }, createElement(App))))
  return { dom, location, root, cleanup: async () => { await act(async () => root.unmount()); dom.window.HTMLElement.prototype.focus = focusBefore; dom.window.HTMLElement.prototype.scrollIntoView = scrollBefore } }
}
type MountedWorkbench = Awaited<ReturnType<typeof mountWorkbench>>
async function page(app: MountedWorkbench, id: string) {
  const button = app.dom.document.querySelector<HTMLButtonElement>(`[data-project-page="${id}"]`)!
  expect(button.disabled).toBe(false)
  await act(async () => button.click())
  expect(button.getAttribute('aria-current')).toBe('page')
}
async function click(app: MountedWorkbench, selector: string, label: string) {
  const button = [...app.dom.document.querySelectorAll<HTMLButtonElement>(selector)].find(button => button.textContent?.trim() === label)
  expect(button, `找不到 ${selector} 内的 ${label}`).toBeDefined()
  await act(async () => button!.click())
}

test('the versions tab reloads saved research rounds and changes without starting any write or model request', async () => {
  const firstPacket = structuredClone(saved), nextPacket = structuredClone(saved)
  firstPacket.context_version = 13; firstPacket.input_hash = 'first-hash'; firstPacket.strategy!.headline = '首轮：结构资料待补后再分项更新'
  nextPacket.strategy!.headline = '第二轮：根据鉴定调整工程范围'
  nextPacket.strategy!.round_review = { summary: '新增鉴定明确了楼栋范围。', changes: [{ topic: '工程范围', before: '逐栋待核', after: '按新增鉴定先实施两栋', reason: '补充的结构资料明确适用对象。', evidence_refs: ['OBJECT'] }], missing_materials: [{ topic: '资金', request: '补充落实资金文件', reason: '明确实际可用额度。', evidence_refs: ['OBJECT'] }] }
  const makeRound = (id: string, number: number, result: StrategyPacket): ResearchRound => ({ id, project_id: savedProject.id, round_number: number, context_version: result.context_version, input_hash: result.input_hash, parent_round_id: number === 2 ? 'ROUND-1' : null, parent_input_hash: number === 2 ? firstPacket.input_hash : null, parent_context_version: number === 2 ? 13 : null, first_round_id: 'ROUND-1', first_input_hash: firstPacket.input_hash, first_context_version: 13, origin: 'generated', status: 'completed', material_intake: 'none', allow_internal_ai: false, materials: [], missing_materials: result.strategy!.round_review?.missing_materials || [], result, error: null, created_at: result.created_at, updated_at: result.created_at })
  const history: ResearchRoundsResponse = { rounds: [makeRound('ROUND-1', 1, firstPacket), makeRound('ROUND-2', 2, nextPacket)], materials: [], baseline_candidate: null }
  for (let refresh = 0; refresh < 2; refresh++) {
    const app = await mountWorkbench('?project=WITH-PLAN&view=compare', false, undefined, history)
    try {
      await vi.waitFor(() => expect(app.dom.document.querySelector('.decision-comparison')?.getAttribute('data-after-round')).toBe('ROUND-2'))
      expect(app.dom.document.querySelector('.decision-comparison')?.getAttribute('data-before-round')).toBe('ROUND-1')
      expect(app.dom.document.querySelector('.dc-change-reasons')?.textContent).toContain('补充的结构资料明确适用对象')
      expect(app.dom.document.querySelector('[aria-label="仍需补充的资料"]')?.textContent).toContain('补充落实资金文件')
      expect(app.dom.document.querySelector('.research-intake')).toBeNull()
      expect(app.dom.document.querySelector('.research-round-actions')).toBeNull()
      expect(app.dom.document.querySelector('.legacy-run-history')?.hasAttribute('open')).toBe(false)
      expect(apiMock.mock.calls.every(([, body]) => body === undefined)).toBe(true)
    } finally { await app.cleanup() }
  }
  expect(apiMock.mock.calls.filter(([path]) => path === '/projects/WITH-PLAN/research-rounds').length).toBeGreaterThanOrEqual(2)
})

test('anonymous entry opens the saved project overview, then its direction, plan citations and six current dimensions', async () => {
  const app = await mountWorkbench()
  try {
    await vi.waitFor(() => expect(app.dom.document.querySelector('#project-overview-recommendation')?.textContent).toBe(published.headline))
    expect(app.dom.document.querySelector('.research-drawer')?.hasAttribute('hidden')).toBe(false)
    expect(app.location.search).toContain('project=WITH-PLAN')
    expect(app.dom.document.querySelector('.project-overview-result-meta')?.textContent).toContain('资料 v14')
    await page(app, 'assessment')
    await vi.waitFor(() => expect(app.dom.document.querySelector('.decision-brief h3')?.textContent).toBe(published.headline))
    expect(app.dom.document.querySelectorAll('[data-direction-choice]')).toHaveLength(2)
    expect(app.dom.document.querySelector('.decision-ai-rationale details')?.hasAttribute('open')).toBe(false)
    expect(app.dom.document.querySelector('.strategy-overview')?.getAttribute('data-selected-direction')).toBe('')
    await act(async () => app.dom.document.querySelector<HTMLButtonElement>('[data-direction-choice="rebuild"]')!.click())
    await click(app, '.strategy-direction-selection button', '进入本方向方案 →')
    await vi.waitFor(() => expect(app.dom.document.querySelector('.single-scheme-workspace h2')?.textContent).toBe('拆建条件专项论证'))
    await click(app, '.cwp-legacy button', '查看举措依据 ↗')
    expect(app.dom.document.querySelector('.project-evidence-original')?.textContent).toContain('求是村保留建筑')
    expect(app.dom.document.querySelector('.project-evidence-baseline')?.textContent).toContain('资料 v14')
    expect(app.dom.document.querySelector('[data-project-page="scenarios"]')?.getAttribute('aria-current')).toBe('page')
    await click(app, '.project-evidence-heading button', '关闭 ×')
    await page(app, 'assessment')
    await click(app, '.strategy-subnav button', '六维现况')
    expect(app.dom.document.querySelectorAll('.strategy-dimension-cards article')).toHaveLength(6)
    expect(apiMock.mock.calls.every(([, body]) => body === undefined)).toBe(true)
  } finally { await app.cleanup() }
})

test('the fixed Qiushi replay keeps all six pages and local scenario controls while isolating live writes and failed history', async () => {
  const app = await mountWorkbench(`?project=${QIUSHI_DEMO_PROJECT_ID}&view=overview`, false, undefined, undefined, true)
  try {
    await vi.waitFor(() => expect(app.dom.document.querySelector('#project-overview-recommendation')?.textContent).toBe(published.headline))
    expect(app.dom.document.querySelector('.qiushi-demo-replay strong')?.textContent).toBe('求是村演示回放 · 已校验方案与固定资料')
    expect(app.dom.document.querySelector('.qiushi-demo-replay a')?.getAttribute('href')).toBe(publicDecisionHref(QIUSHI_SOURCE_PROJECT_ID))
    expect(app.dom.document.querySelector('.workspace-frame-mode')?.textContent).toContain('已保存方案回放')
    expect(app.dom.document.querySelectorAll('[data-project-page]')).toHaveLength(6)
    await page(app, 'evidence')
    expect(app.dom.document.querySelector('input[type=file],.research-intake')).toBeNull()
    await click(app, '.workspace-section-nav button', '项目经验与约束')
    expect(app.dom.document.querySelector('.experience-input,.experience-extract,.knowledge-workbench')).toBeNull()
    await page(app, 'assessment')
    expect(app.dom.document.querySelector('.decision-brief h3')?.textContent).toBe(published.headline)
    expect(app.dom.document.querySelector('.strategy-top>button,.research-intake,.research-rounds')).toBeNull()
    await click(app, '.strategy-subnav button', '六维现况')
    expect(app.dom.document.querySelector('.strategy-current-assessment')?.getAttribute('data-assessment-view')).toBe('reasoning')
    await click(app, '.strategy-assessment-switch button', '证据画像')
    expect(app.dom.document.querySelectorAll('.radar-point')).toHaveLength(0)
    await click(app, '.strategy-assessment-switch button', '推理情景')
    expect(app.dom.document.querySelectorAll('.radar-point')).toHaveLength(6)
    await page(app, 'scenarios')
    await act(async () => app.dom.document.querySelector<HTMLButtonElement>('[data-open-scheme=comprehensive]')!.click())
    expect(app.dom.document.querySelector('.single-scheme-workspace')?.getAttribute('data-scheme')).toBe('comprehensive')
    await click(app, '.cwp-legacy button', '查看举措依据 ↗')
    expect(app.dom.document.querySelector('.project-evidence-original')?.textContent).toContain('求是村保留建筑')
    await click(app, '.project-evidence-heading button', '关闭 ×')
    const pane = async (name: string) => act(async () => [...app.dom.document.querySelectorAll<HTMLButtonElement>('.ssw-tabs button')].find(button => button.querySelector('strong')?.textContent === name)!.click())
    await pane('建设与资金')
    expect(app.dom.document.querySelectorAll('.ssw-funding-inputs input')).toHaveLength(6)
    expect([...app.dom.document.querySelectorAll<HTMLInputElement>('.ssw-funding-inputs input')].every(input => !input.disabled)).toBe(true)
    await pane('敏感性与核验')
    expect(app.dom.document.querySelectorAll('.ssw-weight-controls input[type=range]')).toHaveLength(6)
    await act(async () => app.dom.document.querySelectorAll<HTMLButtonElement>('.ssw-presets button')[1].click())
    expect(app.dom.document.querySelectorAll('.ssw-weight-controls output')).toHaveLength(6)
    await pane('社区运营')
    await vi.waitFor(() => expect(app.dom.document.querySelector('.community-operations--standalone')).not.toBeNull())
    expect(app.dom.document.querySelector('[aria-label="真实运营反馈"]')).toBeNull()
    expect(app.dom.document.querySelector('[aria-label="保守需求倍率"]')?.hasAttribute('disabled')).toBe(false)
    await vi.waitFor(() => expect(app.dom.document.querySelectorAll('.ops-history-list>.ops-snapshot')).toHaveLength(1))
    await click(app, '.ops-snapshot-actions button', '载入为新草稿')
    await click(app, '.ops-toolbar button', '计算三种情景')
    await vi.waitFor(() => expect(app.dom.document.querySelectorAll('.ops-preview-grid>.ops-result-card')).toHaveLength(3))
    expect(app.dom.document.querySelector('.ops-preview-grid')?.textContent).not.toMatch(/冻结保存|保存真实/)
    expect(app.dom.document.querySelector('.ops-error,[role=alert]')).toBeNull()
    expect(apiMock.mock.calls.filter(([path])=>String(path).endsWith('/community-operations/preview'))).toHaveLength(3)
    await page(app, 'actions')
    expect(app.dom.document.querySelector('.project-tasks-page')).not.toBeNull()
    await page(app, 'results')
    expect(app.dom.document.querySelector('.project-results-primary h3')?.textContent).toBe(published.headline)
    await click(app, '.workspace-section-nav button', '版本变化')
    expect(app.dom.document.querySelector('.qiushi-replay-version')?.textContent).toContain('固定演示资料基线')
    expect(app.dom.document.querySelector('.qiushi-replay-version')?.textContent).toContain('取得逐栋结构资料')
    expect(app.dom.document.querySelector('.legacy-run-history')).toBeNull()
    expect(app.dom.document.querySelector('.feedback.error,[role=alert]')).toBeNull()
    expect(app.dom.document.body.textContent).not.toMatch(/真实模型研判|资料已更新|同意.*进入模型/)
    expect(apiMock.mock.calls.every(([path, body]) => body === undefined || String(path).endsWith('/community-operations/preview'))).toBe(true)
    expect(apiMock.mock.calls.some(([path]) => String(path).includes(QIUSHI_DEMO_PROJECT_ID) && /research-rounds|revision-diff|followups/.test(String(path)))).toBe(false)
  } finally { await app.cleanup() }
})

test('a link to an empty same-name project shows its own state and explicitly switches to the source project', async () => {
  const app = await mountWorkbench('?project=WITHOUT-PLAN&view=overview')
  try {
    await vi.waitFor(() => expect(app.dom.document.querySelector('.workspace-project-identity')?.textContent).toContain('资料 v0'))
    expect(app.dom.document.querySelector('#project-overview-recommendation')?.textContent).not.toBe(published.headline)
    expect(app.location.search).toContain('project=WITHOUT-PLAN')
    await act(async () => app.dom.document.querySelector<HTMLButtonElement>('.atlas-dock [aria-label="项目空间"]')!.click())
    await act(async () => app.dom.document.querySelector<HTMLButtonElement>('[data-project-section="published"]')!.click())
    await vi.waitFor(() => expect(app.dom.document.querySelector('[data-published-project-id="WITH-PLAN"]')).not.toBeNull())
    const source = app.dom.document.querySelector<HTMLElement>('[data-published-project-id="WITH-PLAN"]')!
    expect(source.textContent).toContain('来源项目：浙大求是村 · 片区研究')
    expect(source.textContent).toContain('成果资料版本 v14')
    expect(source.querySelector('code')?.textContent).toBe(savedProject.id)
    await act(async () => source.querySelector<HTMLButtonElement>('button')!.click())
    await vi.waitFor(() => expect(app.dom.document.querySelector('#project-overview-recommendation')?.textContent).toBe(published.headline))
    expect(app.location.search).toContain('project=WITH-PLAN')
    expect(apiMock.mock.calls.every(([, body]) => body === undefined)).toBe(true)
  } finally { await app.cleanup() }
})

test('a same-project saved snapshot is openly readable and labelled with its saved version', async () => {
  const app = await mountWorkbench('?project=WITH-PLAN&view=overview', true)
  try {
    await vi.waitFor(() => expect(app.dom.document.querySelector('#project-overview-recommendation')?.textContent).toBe(published.headline))
    expect(app.dom.document.querySelector('.project-overview-result-meta')?.textContent).toContain('资料 v14')
    await page(app, 'results')
    expect(app.dom.document.querySelector('.project-results-page')?.textContent).toContain('同资料版本保存快照')
    expect(app.dom.document.querySelector('.project-results-page')?.textContent).toContain('v14')
  } finally { await app.cleanup() }
})

test('goal preferences remain interactive in single-scheme sensitivity while the rule-based action stays independent', async () => {
  const app = await mountWorkbench('?project=WITH-PLAN&view=overview')
  try {
    await vi.waitFor(() => expect(app.dom.document.querySelector('#project-overview-recommendation')?.textContent).toBe(published.headline))
    await page(app, 'assessment')
    const initialAction = app.dom.document.querySelector('.decision-program-check')?.textContent
    expect(initialAction).toBeTruthy()
    await act(async () => app.dom.document.querySelector<HTMLButtonElement>('[data-direction-choice="comprehensive"]')!.click())
    await click(app, '.strategy-direction-selection button', '进入本方向方案 →')
    const sensitivity = [...app.dom.document.querySelectorAll<HTMLButtonElement>('.ssw-tabs button')].find(button => button.textContent?.includes('敏感性与核验'))!
    await act(async () => sensitivity.click())
    const preset = [...app.dom.document.querySelectorAll<HTMLButtonElement>('.ssw-presets button')].find(button => button.textContent === '财政承受优先')!
    await act(async () => preset.click())
    expect(app.dom.document.querySelector<HTMLInputElement>('[aria-label="资金交付权重"]')?.value).toBe('5')
    expect(preset.getAttribute('aria-pressed')).toBe('true')
    expect(app.dom.document.querySelector('.single-scheme-workspace')?.getAttribute('data-scheme')).toBe('comprehensive')
    await page(app, 'assessment')
    expect(app.dom.document.querySelector('.decision-program-check')?.textContent).toBe(initialAction)
    expect(apiMock.mock.calls.every(([, body]) => body === undefined)).toBe(true)
  } finally { await app.cleanup() }
})

test('AI decision fields and actual rationale lead the direction page while the rule direction stays independent', () => {
  const packet = structuredClone(saved), model = packet.strategy!
  model.decision_brief = {
    renewal: { conclusion: '优先更新本对象的设施与服务短板', reason: '已取得分项更新资料，先按楼栋核定实施边界。', evidence_refs: ['OBJECT'] },
    investment: { conclusion: '先投入本期分项论证', reason: '当前资金资料支持核查专项范围与承担方式。', stage: 'preliminary', evidence_refs: ['OBJECT'] },
    returns: { financial: '按分项建设与年度维护费用核算财务收支。', social: '改善设施可达性并降低日常使用干扰。', evidence_refs: ['OBJECT'] },
  }
  model.rationale = Array.from({ length: 3 }, (_, index) => ({ point: `本项目实际判断依据 ${index + 1}`, quote: savedProject.input.sources[0].untrusted_text!, source_id: 'OBJECT' }))
  packet.model_calls = [{ stage: 'renewal_strategy', requested_model: 'deepseek-flash', returned_model: 'actual-model', finish_reason: 'stop', input_tokens: 100, output_tokens: 200, duration_ms: 1000, session_id: null }]
  const gate = evaluateRenewalModeGate(projectRenewalModeInput(savedProject.input))
  const document = parseHTML(renderToStaticMarkup(createElement(DecisionBrief, { result: packet, gate, onEvidence: vi.fn(), onPlan: vi.fn() }))).document
  expect(document.querySelector('.decision-brief>header>span')?.textContent).toContain('AI 综合研判')
  expect(document.querySelector('.decision-brief>header h3')?.textContent).toBe(published.headline)
  expect(document.querySelector('.decision-brief>header>p')?.textContent).toBe(model.decision_brief.renewal.reason)
  expect(document.querySelectorAll('.decision-questions h4')[0].textContent).toBe(model.decision_brief.renewal.conclusion)
  expect(document.querySelectorAll('.decision-questions h4')[1].textContent).toBe(model.decision_brief.investment.conclusion)
  expect(document.querySelector('.decision-returns')?.textContent).toContain(model.decision_brief.returns.financial)
  expect(document.querySelector('.decision-returns')?.textContent).toContain(model.decision_brief.returns.social)
  expect(document.querySelectorAll('.decision-ai-rationale>article')).toHaveLength(3)
  expect(document.querySelector('.decision-ai-meta')?.textContent).toContain('actual-model')
  expect(document.querySelector('.decision-ai-meta')?.textContent).toContain('1 份资料')
  expect(document.querySelector('[aria-label="程序核验方向"]')?.textContent).toContain('综合整治')
})

test('the selected direction alone determines subsequent plan text, assessment targets and metric levels', async () => {
  const packet = structuredClone(saved)
  packet.strategy!.paths[0].description += '整体拆建不进入本路径。'
  packet.strategy!.dimensions.forEach(row => { row.comprehensive = '综合整治专属目标'; row.comprehensive_level = 'low'; row.rebuild = '原拆原建专属目标'; row.rebuild_level = 'high' })
  const app = await mountWorkbench('?project=WITH-PLAN&view=overview', false, packet)
  try {
    await vi.waitFor(() => expect(app.dom.document.querySelector('#project-overview-recommendation')?.textContent).toBe(published.headline))
    await page(app, 'assessment')
    await vi.waitFor(() => expect(app.dom.document.querySelector('[data-direction-choice="comprehensive"]')).not.toBeNull())
    await act(async () => app.dom.document.querySelector<HTMLButtonElement>('[data-direction-choice="comprehensive"]')!.click())
    await click(app, '.strategy-direction-selection button', '进入本方向方案 →')
    expect(app.dom.document.querySelector('.single-scheme-workspace')?.textContent).not.toContain('原拆原建')
    expect(app.dom.document.querySelector('.single-scheme-workspace')?.textContent).not.toContain('整体拆建')
    await act(async () => app.dom.document.querySelector<HTMLButtonElement>('.ssw-targets .dimension-readout button')!.click())
    expect(app.dom.document.querySelector('.single-scheme-workspace')?.textContent).toContain('综合整治专属目标')
    expect(app.dom.document.querySelector('.ssw-targets .dimension-readout')?.textContent).toContain('1')
    await page(app, 'assessment')
    await act(async () => app.dom.document.querySelector<HTMLButtonElement>('[data-direction-choice="rebuild"]')!.click())
    await click(app, '.strategy-direction-selection button', '进入本方向方案 →')
    expect(app.dom.document.querySelector('.single-scheme-workspace h2')?.textContent).toBe('拆建条件专项论证')
    expect(app.dom.document.querySelector('.single-scheme-workspace')?.textContent).not.toContain('综合整治专属目标')
    expect(app.dom.document.querySelector('.single-scheme-workspace')?.textContent).not.toContain('保留建筑、分项改善')
    await act(async () => app.dom.document.querySelector<HTMLButtonElement>('.ssw-targets .dimension-readout button')!.click())
    expect(app.dom.document.querySelector('.ssw-targets')?.textContent).toContain('原拆原建专属目标')
    expect(app.dom.document.querySelector('.ssw-targets .dimension-readout')?.textContent).toContain('5')
    await page(app, 'evidence')
    await page(app, 'scenarios')
    await act(async () => app.dom.document.querySelector<HTMLButtonElement>('[data-open-scheme="rebuild"]')!.click())
    await vi.waitFor(() => expect(app.dom.document.querySelector('.single-scheme-workspace h2')?.textContent).toBe('拆建条件专项论证'))
    expect(app.dom.document.querySelector('.strategy-overview')?.getAttribute('data-selected-direction')).toBe('rebuild')
    expect(app.dom.document.querySelector('.decision-brief')).toBeNull()
    expect(apiMock.mock.calls.every(([, body]) => body === undefined)).toBe(true)
    await act(async () => app.root.render(createElement(WorkbenchAccessContext.Provider, { value: { role: 'viewer', canWrite: false } }, createElement(StrategyOverview, { project: { ...savedProject, context_version: 15 }, demoActive: false, directionSelection: { identity: 'WITH-PLAN:14:false', mode: 'rebuild' }, onEvidence: vi.fn(), onInvestigate: vi.fn() }))))
    expect(app.dom.document.querySelector('.strategy-overview')?.getAttribute('data-selected-direction')).toBe('')
    const legacyPlan = [...app.dom.document.querySelectorAll<HTMLButtonElement>('.strategy-overview button')].find(row => row.textContent === '方案总览')!
    expect(legacyPlan.disabled).toBe(true)
    expect(app.dom.document.querySelector('.strategy-plan-detail')).toBeNull()
  } finally { await app.cleanup() }
})

test('all six project pages remain accessible without choosing a direction and the global library has its own entrance', async () => {
  const app = await mountWorkbench('?project=WITH-PLAN&view=overview')
  try {
    await vi.waitFor(() => expect(app.dom.document.querySelector('#project-overview-recommendation')?.textContent).toBe(published.headline))
    expect([...app.dom.document.querySelectorAll('[data-project-page]')].map(button => button.textContent)).toEqual(['项目总览', '资料与条件', '改造研判', '方案与测算', '调查任务', '成果与版本'])
    for (const id of ['evidence', 'assessment', 'scenarios', 'actions', 'results', 'overview']) await page(app, id)
    expect(app.dom.document.querySelector('.project-overview-directions')?.textContent).toContain('当前工作方向：尚未选择')
    const trigger = [...app.dom.document.querySelectorAll<HTMLButtonElement>('.project-overview-actions button')].find(button => button.textContent === '查看判断依据')!
    trigger.focus()
    const beforeUrl = app.location.search
    await act(async () => trigger.click())
    expect(app.dom.document.querySelector('.project-evidence-drawer')?.getAttribute('role')).toBe('dialog')
    expect(app.dom.document.querySelector('[data-project-page="overview"]')?.getAttribute('aria-current')).toBe('page')
    expect(app.location.search).toBe(beforeUrl)
    expect(app.dom.document.querySelector('.project-evidence-original')?.textContent).toBe(saved.sources[0].text)
    await click(app, '.project-evidence-heading button', '关闭 ×')
    expect(app.dom.document.activeElement).toBe(trigger)
    await act(async () => app.dom.document.querySelector<HTMLButtonElement>('.atlas-dock [aria-label="案例与规则"]')!.click())
    await vi.waitFor(() => expect(app.dom.document.querySelector('.global-knowledge-catalog')?.getAttribute('aria-label')).toBe('全局案例库'))
    expect([...app.dom.document.querySelectorAll('.global-knowledge-tabs button')].map(button => button.textContent)).toEqual(['案例库', '规则库', '成本参考'])
    await act(async () => app.dom.document.querySelector<HTMLButtonElement>('[data-knowledge-section="rules"]')!.click())
    await vi.waitFor(() => expect(apiMock.mock.calls.some(([path]) => path.startsWith('/experiences/search?kind=rule'))).toBe(true))
    expect(apiMock.mock.calls.every(([, body]) => body === undefined)).toBe(true)
  } finally { await app.cleanup() }
})

test('a current project-baseline deep link hydrates its selected scheme and pane without being cleared by identity effects', async () => {
  for (const [scheme, pane, title] of [['comprehensive', 'content', '保留建筑、分项改善'], ['rebuild', 'funding', '拆建条件专项论证']] as const) {
    const app = await mountWorkbench(`?project=WITH-PLAN&view=scenarios&section=detail&pane=${pane}&scheme=${scheme}&baseline=14`)
    try {
      await vi.waitFor(() => expect(app.dom.document.querySelector('.single-scheme-workspace')?.getAttribute('data-scheme')).toBe(scheme))
      expect(app.dom.document.querySelector('.single-scheme-workspace')?.getAttribute('data-pane')).toBe(pane)
      expect(app.dom.document.querySelector('.single-scheme-workspace h2')?.textContent).toBe(title)
      expect(app.dom.document.querySelector('.ssw-header')?.textContent).toContain('资料 v14')
      expect(app.dom.document.querySelector('[data-project-page="scenarios"]')?.getAttribute('aria-current')).toBe('page')
      expect(app.dom.document.querySelector('.strategy-scheme-entries')).toBeNull()
      const location = new URLSearchParams(app.location.search)
      expect(location.get('project')).toBe(savedProject.id)
      expect(location.get('scheme')).toBe(scheme); expect(location.get('pane')).toBe(pane); expect(location.get('baseline')).toBe('14')
      expect(apiMock.mock.calls.every(([, body]) => body === undefined)).toBe(true)
    } finally { await app.cleanup() }
  }
})

test('a stale deep-link baseline keeps the scheme unselected instead of applying it to the current project version', async () => {
  const app = await mountWorkbench('?project=WITH-PLAN&view=scenarios&section=detail&pane=content&scheme=comprehensive&baseline=13')
  try {
    await vi.waitFor(() => expect(app.dom.document.querySelector('.strategy-scheme-entries')).not.toBeNull())
    expect(app.dom.document.querySelector('.single-scheme-workspace')).toBeNull()
    expect(app.dom.document.querySelector('.strategy-overview')?.getAttribute('data-selected-direction')).toBe('')
    expect(app.dom.document.querySelector('.workspace-project-identity')?.textContent).toContain('资料 v14')
    expect(new URLSearchParams(app.location.search).get('baseline')).toBe('13')
    expect(apiMock.mock.calls.every(([, body]) => body === undefined)).toBe(true)
  } finally { await app.cleanup() }
})

const corePages = ['项目总览', '资料与条件', '改造研判']
function projectPageLabels(app: MountedWorkbench) { return [...app.dom.document.querySelectorAll('[data-project-page]')].map(button => button.textContent) }
function noEmptyResultCards(app: MountedWorkbench) {
  for (const selector of ['.project-overview-directions', '.project-overview-investigations', '.project-overview-work', '.project-overview-result-meta']) expect(app.dom.document.querySelector(selector), selector).toBeNull()
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }

test('a project without a valid saved result has three core pages and no empty decision or result cards', async () => {
  const app = await mountWorkbench('?project=WITHOUT-PLAN&view=overview')
  try {
    await vi.waitFor(() => expect(app.dom.document.querySelector('.project-overview')?.getAttribute('data-overview-state')).toBe('empty'))
    expect(projectPageLabels(app)).toEqual(corePages)
    noEmptyResultCards(app)
    expect(app.dom.document.querySelector('.project-overview-primary')?.textContent).toContain('进入改造研判')
    expect(apiMock.mock.calls.every(([, body]) => body === undefined)).toBe(true)
  } finally { await app.cleanup() }
})

test('a failed response does not unlock result pages or display its unfinished strategy as a completed decision', async () => {
  const failed: StrategyPacket = { ...structuredClone(saved), status: 'failed', error: '本轮未完成', strategy: { ...structuredClone(saved.strategy!), headline: '未完成的内容不可作为成功成果' } }
  const app = await mountWorkbench('?project=WITH-PLAN&view=overview', false, failed)
  try {
    await vi.waitFor(() => expect(app.dom.document.querySelector('.project-overview')?.getAttribute('data-overview-state')).toBe('failed'))
    expect(projectPageLabels(app)).toEqual(corePages)
    noEmptyResultCards(app)
    expect(app.dom.document.querySelector('#project-overview-recommendation')?.textContent).not.toBe(failed.strategy!.headline)
    expect(app.dom.document.querySelector('.project-overview-notice')?.textContent).toContain('未形成完整结论')
    expect(apiMock.mock.calls.every(([, body]) => body === undefined)).toBe(true)
  } finally { await app.cleanup() }
})

test('a saved older-version round restores result pages after pending GETs without redirecting its deep version link early', async () => {
  const pending = deferred<ResearchRoundsResponse>(), old = structuredClone(saved)
  old.context_version = 13; old.input_hash = 'older-completed'; old.strategy!.headline = '旧版真实保存建议'
  const round: ResearchRound = { id: 'OLD-SAVED', project_id: savedProject.id, round_number: 1, context_version: 13, input_hash: old.input_hash, parent_round_id: null, parent_input_hash: null, parent_context_version: null, first_round_id: 'OLD-SAVED', first_input_hash: old.input_hash, first_context_version: 13, origin: 'generated', status: 'completed', material_intake: 'none', allow_internal_ai: false, materials: [], missing_materials: [], result: old, error: null, created_at: old.created_at, updated_at: old.created_at }
  const app = await mountWorkbench('?project=WITH-PLAN&view=compare', false, null, pending.promise)
  try {
    await vi.waitFor(() => expect(apiMock.mock.calls.some(([path]) => path === '/projects/WITH-PLAN/research-rounds')).toBe(true))
    expect(new URLSearchParams(app.location.search).get('view')).toBe('compare')
    expect(app.dom.document.querySelector('[data-project-page="assessment"]')?.getAttribute('aria-current')).not.toBe('page')
    await act(async () => pending.resolve({ rounds: [round], materials: [], baseline_candidate: null }))
    await vi.waitFor(() => expect(projectPageLabels(app)).toHaveLength(6))
    expect(new URLSearchParams(app.location.search).get('view')).toBe('compare')
    expect(app.dom.document.querySelector('[data-project-page="results"]')?.getAttribute('aria-current')).toBe('page')
    await page(app, 'overview')
    expect(app.dom.document.querySelector('#project-overview-recommendation')?.textContent).toBe(old.strategy!.headline)
    expect(app.dom.document.querySelector('.project-overview-result-meta')?.textContent).toContain('资料 v13')
    expect(app.dom.document.querySelector('.project-overview-notice')?.textContent).toContain('当前资料为 v14')
    expect(apiMock.mock.calls.every(([, body]) => body === undefined)).toBe(true)
  } finally { await app.cleanup() }
})

test('an empty deep scheme link redirects to assessment only after strategy restoration finishes', async () => {
  const pending = deferred<StrategyPacket | null>()
  const app = await mountWorkbench('?project=WITH-PLAN&view=scenarios&section=detail&pane=content&scheme=comprehensive&baseline=14', false, pending.promise)
  try {
    await vi.waitFor(() => expect(apiMock.mock.calls.some(([path]) => path.includes('/renewal-strategy'))).toBe(true))
    expect(new URLSearchParams(app.location.search).get('view')).toBe('scenarios')
    await act(async () => pending.resolve(null))
    await vi.waitFor(() => expect(new URLSearchParams(app.location.search).get('view')).toBe('assessment'))
    expect(projectPageLabels(app)).toEqual(corePages)
    expect(app.dom.document.querySelector('[data-project-page="assessment"]')?.getAttribute('aria-current')).toBe('page')
    expect(app.dom.document.querySelector('.single-scheme-workspace')).toBeNull()
    expect(app.dom.document.querySelector('.scheme-comparison')).toBeNull()
    expect(apiMock.mock.calls.every(([, body]) => body === undefined)).toBe(true)
  } finally { await app.cleanup() }
})

test('a demolition headline blocked by the rule gate is retained as model analysis rather than an execution recommendation', () => {
  const packet = structuredClone(saved)
  packet.strategy!.preferred_mode = 'rebuild'; packet.strategy!.headline = '直接实施整体拆建'
  const document = parseHTML(renderToStaticMarkup(createElement(DecisionBrief, { result: packet, gate: evaluateRenewalModeGate(projectRenewalModeInput(savedProject.input)), onEvidence: vi.fn(), onPlan: vi.fn() }))).document
  expect(document.querySelector('.decision-brief>header h3')?.textContent).not.toBe('直接实施整体拆建')
  expect(document.querySelector('.decision-original-analysis')?.textContent).toContain('直接实施整体拆建')
  expect(document.querySelector('.decision-program-check details')?.hasAttribute('open')).toBe(false)
})
