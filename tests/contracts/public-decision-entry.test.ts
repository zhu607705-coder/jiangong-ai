import { afterEach, expect, test, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { parseHTML } from 'linkedom'
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

async function mountWorkbench(search = '', snapshot = false, override?: StrategyPacket, roundHistory?: ResearchRoundsResponse) {
  const dom = parseHTML('<html><body><div id="root"></div></body></html>')
  const location = { href: `http://example.test/${search}`, search }, storage = new Map([['hzz_project', emptyProject.id], ['hzz-complete-demo-project', savedProject.id]])
  const history = { replaceState: vi.fn((_state: unknown, _unused: string, path: string) => { const url = new URL(path, 'http://example.test'); location.href = url.href; location.search = url.search }) }
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.document, location, history, MutationObserver: dom.window.MutationObserver, IS_REACT_ACT_ENVIRONMENT: true,
    requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0), cancelAnimationFrame: clearTimeout,
    localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) } })) vi.stubGlobal(key, value)
  const packet = override || (snapshot ? { ...saved, publication: { kind: 'saved_snapshot' as const, is_current: false, current_input_hash: 'changed-parameters', saved_at: saved.created_at } } : saved)
  apiMock.mockImplementation((path: string) => {
    if (path === '/session') return Promise.resolve({ model_configured: true })
    if (path === '/projects') return Promise.resolve([emptyProject, savedProject])
    if (path === '/projects/public-decisions') return Promise.resolve({ items: [published] })
    if (path === `/projects/${emptyProject.id}`) return Promise.resolve(emptyProject)
    if (path === `/projects/${savedProject.id}`) return Promise.resolve(savedProject)
    if (path.endsWith('/revision-diff')) return Promise.resolve({ available: false, changes: [] })
    if (path.endsWith('/followups') || path.endsWith('/documents')) return Promise.resolve([])
    if (path.endsWith('/research-rounds')) return Promise.resolve(roundHistory || { rounds: [], materials: [], baseline_candidate: null })
    if (path.endsWith('/knowledge/groups')) return Promise.resolve({ groups: [], documents: [] })
    if (path.endsWith('/knowledge/pipeline')) return Promise.resolve({ cards: [] })
    if (path.includes('/renewal-strategy')) return Promise.resolve(path.includes(savedProject.id) ? packet : null)
    if (path.endsWith('/renewal-mode')) return Promise.resolve({ screening: projectRenewalModeInput(path.includes(savedProject.id) ? savedProject.input : emptyProject.input), decision: null })
    if (path === '/maps/config') return Promise.resolve({ configured: false })
    throw new Error(`Unexpected request ${path}`)
  })
  const focusBefore = dom.window.HTMLElement.prototype.focus, scrollBefore = dom.window.HTMLElement.prototype.scrollIntoView
  dom.window.HTMLElement.prototype.focus = vi.fn(); dom.window.HTMLElement.prototype.scrollIntoView = vi.fn()
  const root = createRoot(dom.document.getElementById('root')!)
  await act(async () => root.render(createElement(WorkbenchAccessContext.Provider, { value: roundHistory ? { role: 'admin', canWrite: true } : { role: 'viewer', canWrite: false } }, createElement(App))))
  return { dom, location, root, cleanup: async () => { await act(async () => root.unmount()); dom.window.HTMLElement.prototype.focus = focusBefore; dom.window.HTMLElement.prototype.scrollIntoView = scrollBefore } }
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
  expect(apiMock.mock.calls.filter(([path]) => path === '/projects/WITH-PLAN/research-rounds')).toHaveLength(2)
})

test('anonymous entry opens a real completed plan, including both paths, citations and all six dimensions', async () => {
  const app = await mountWorkbench()
  try {
    await vi.waitFor(() => expect(app.dom.document.querySelector('.strategy-summary h3')?.textContent).toBe(published.headline))
    expect(app.dom.document.querySelector('.research-drawer')?.hasAttribute('hidden')).toBe(false)
    expect(app.location.search).toContain('project=WITH-PLAN')
    expect(app.dom.document.querySelector('.full-demo-mode-toolbar')?.textContent).toContain('打开完整数据模拟演示')
    const buttons = () => [...app.dom.document.querySelectorAll<HTMLButtonElement>('.strategy-overview button')]
    const decisionSections = [...app.dom.document.querySelectorAll('.strategy-direction-selection,.strategy-original-paths,.renewal-mode-panel')]
    expect(decisionSections[0].classList.contains('strategy-direction-selection')).toBe(true)
    expect(app.dom.document.querySelectorAll('[data-direction-choice]')).toHaveLength(2)
    expect(app.dom.document.querySelector('.decision-ai-rationale details')?.hasAttribute('open')).toBe(false)
    expect(app.dom.document.querySelector('.strategy-overview')?.getAttribute('data-selected-direction')).toBe('')
    expect(buttons().find(button => button.textContent === '方案总览')?.disabled).toBe(true)
    await act(async () => app.dom.document.querySelector<HTMLButtonElement>('[data-direction-choice="rebuild"]')!.click())
    expect(app.dom.document.querySelector('.strategy-plan-detail>h3')?.textContent).toBe('拆建条件专项论证')
    await act(async () => buttons().find(button => button.textContent === '对应依据')!.click())
    expect(app.dom.document.querySelector('.strategy-source-detail blockquote')?.textContent).toContain('求是村保留建筑')
    await act(async () => buttons().find(button => button.textContent === '现况与改后评估')!.click())
    expect(app.dom.document.querySelectorAll('.strategy-dimension-cards article')).toHaveLength(6)
    expect(apiMock.mock.calls.every(([, body]) => body === undefined)).toBe(true)
  } finally { await app.cleanup() }
})

test('a link to an empty same-name project shows its own state and explicitly switches to the source project', async () => {
  const app = await mountWorkbench('?project=WITHOUT-PLAN&view=overview')
  try {
    await vi.waitFor(() => expect(app.dom.document.querySelector('.strategy-empty-project')?.textContent).toContain('资料 v0'))
    expect(app.dom.document.querySelector('.strategy-summary h3')?.textContent).not.toBe(published.headline)
    const link = app.dom.document.querySelector<HTMLAnchorElement>('.strategy-published-alternatives a')!
    expect(link.getAttribute('href')).toBe(publicDecisionHref(savedProject.id))
    expect(link.textContent).toContain('来源项目：浙大求是村 · 片区研究 · 资料 v14')
    await act(async () => link.dispatchEvent(new app.dom.window.Event('click', { bubbles: true, cancelable: true })))
    await vi.waitFor(() => expect(app.dom.document.querySelector('.strategy-summary h3')?.textContent).toBe(published.headline))
    expect(app.location.search).toContain('project=WITH-PLAN')
    expect(apiMock.mock.calls.every(([, body]) => body === undefined)).toBe(true)
  } finally { await app.cleanup() }
})

test('a same-project saved snapshot is openly readable and labelled with its saved version', async () => {
  const app = await mountWorkbench('?project=WITH-PLAN&view=overview', true)
  try {
    await vi.waitFor(() => expect(app.dom.document.querySelector('.strategy-saved-snapshot')?.textContent).toContain('资料 v14'))
    expect(app.dom.document.querySelector('.strategy-saved-snapshot')?.textContent).toContain('当前研判参数或参考资料已更新')
    expect(app.dom.document.querySelector('.strategy-summary h3')?.textContent).toBe(published.headline)
  } finally { await app.cleanup() }
})

test('goal preferences are interactive for visitors and keep the rule-based action independent', async () => {
  const app = await mountWorkbench('?project=WITH-PLAN&view=overview')
  try {
    await vi.waitFor(() => expect(app.dom.document.querySelector('.decision-brief h3')?.textContent).toBe(published.headline))
    const initialAction = app.dom.document.querySelector('.decision-current-action')?.textContent
    const preset = [...app.dom.document.querySelectorAll<HTMLButtonElement>('.decision-presets button')].find(button => button.textContent === '财政承受优先')!
    await act(async () => preset.click())
    expect(app.dom.document.querySelector<HTMLInputElement>('[aria-label="资金交付目标权重"]')?.value).toBe('5')
    expect(preset.getAttribute('aria-pressed')).toBe('true')
    expect(app.dom.document.querySelector('.decision-current-action')?.textContent).toBe(initialAction)
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
  const button = (name: string) => [...app.dom.document.querySelectorAll<HTMLButtonElement>('.strategy-overview button')].find(row => row.textContent === name)!
  try {
    await vi.waitFor(() => expect(app.dom.document.querySelector('[data-direction-choice="comprehensive"]')).not.toBeNull())
    expect(button('方案总览').disabled).toBe(true)
    await act(async () => app.dom.document.querySelector<HTMLButtonElement>('[data-direction-choice="comprehensive"]')!.click())
    expect(app.dom.document.querySelector('.strategy-overview')?.textContent).not.toContain('原拆原建')
    expect(app.dom.document.querySelector('.strategy-overview')?.textContent).not.toContain('整体拆建')
    expect(app.dom.document.querySelector('.decision-criteria')).toBeNull()
    await act(async () => button('现况与改后评估').click())
    await act(async () => button('改后目标对照').click())
    expect(app.dom.document.querySelector('.strategy-assessment')?.textContent).toContain('综合整治专属目标')
    expect(app.dom.document.querySelector('.strategy-assessment')?.textContent).not.toContain('原拆原建专属目标')
    expect(app.dom.document.querySelectorAll('.strategy-assessment .dimension-readout')).toHaveLength(1)
    expect(app.dom.document.querySelector('.strategy-assessment .dimension-readout')?.textContent).toContain('1')
    await act(async () => button('返回方向判断').click())
    await act(async () => app.dom.document.querySelector<HTMLButtonElement>('[data-direction-choice="rebuild"]')!.click())
    expect(app.dom.document.querySelector('.strategy-plan-detail')?.textContent).toContain('拆建条件专项论证')
    expect(app.dom.document.querySelector('.strategy-overview')?.textContent).not.toContain('综合整治专属目标')
    expect(app.dom.document.querySelector('.strategy-overview')?.textContent).not.toContain('保留建筑、分项改善')
    await act(async () => button('现况与改后评估').click())
    await act(async () => button('改后目标对照').click())
    expect(app.dom.document.querySelector('.strategy-assessment')?.textContent).toContain('原拆原建专属目标')
    expect(app.dom.document.querySelector('.strategy-assessment .dimension-readout')?.textContent).toContain('5')
    expect(app.dom.document.querySelector('.strategy-assessment')?.textContent).not.toContain('综合整治专属目标')
    const outerTab = (label: string) => [...app.dom.document.querySelectorAll<HTMLButtonElement>('.research-tabs button')].find(row => row.textContent === label)!
    await act(async () => outerTab('逻辑与证据').click())
    await act(async () => outerTab('研判总览').click())
    await vi.waitFor(() => expect(app.dom.document.querySelector('.strategy-plan-detail>h3')?.textContent).toBe('拆建条件专项论证'))
    expect(app.dom.document.querySelector('.strategy-overview')?.getAttribute('data-selected-direction')).toBe('rebuild')
    expect(app.dom.document.querySelector('.decision-brief')).toBeNull()
    await act(async () => app.root.render(createElement(WorkbenchAccessContext.Provider, { value: { role: 'viewer', canWrite: false } }, createElement(StrategyOverview, { project: { ...savedProject, context_version: 15 }, demoActive: false, directionSelection: { identity: 'WITH-PLAN:14:false', mode: 'rebuild' }, onEvidence: vi.fn(), onInvestigate: vi.fn() }))))
    expect(app.dom.document.querySelector('.strategy-overview')?.getAttribute('data-selected-direction')).toBe('')
    expect(button('方案总览').disabled).toBe(true)
    expect(app.dom.document.querySelector('.strategy-plan-detail')).toBeNull()
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
