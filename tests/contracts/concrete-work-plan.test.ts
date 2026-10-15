import { afterEach, expect, test, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { parseHTML } from 'linkedom'
import fixture from '../../fixtures/inputs/01_auto.json'
import ConcreteWorkPlan from '../../apps/workspace/src/components/ConcreteWorkPlan'
import SingleSchemeWorkspace from '../../apps/workspace/src/components/SingleSchemeWorkspace'
import type { RenewalInternalDataRequest, RenewalWorkPackage } from '../../apps/host/generated/contracts'
import type { StrategyPacket } from '../../packages/retrofit/strategy'
import type { Project } from '../../apps/workspace/src/api'

vi.mock('../../apps/workspace/src/components/CommunityOperationsPanel', () => ({ default: () => null }))
vi.mock('../../apps/workspace/src/components/CompleteCommunityDemo', () => ({ default: () => null }))
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
const quote = '29幢2单元现有供水管线需逐段测量长度。\n现有额外电梯数量为0台。'
function work(id: string, overrides: Partial<RenewalWorkPackage> = {}): RenewalWorkPackage {
  return { id, target: '29幢2单元供水设施', target_basis: 'object_source', source_id: 'OBJECT', quote, locator: 'line:22', intervention: '更换破损立管并按楼层分段接驳', scope: '本单元立管与相连阀门，不扩入其他楼栋', quantity: null, unit: 'm', quantity_basis: 'unknown', delivery: '形成可独立检修的供水管段并完成试压交付', priority: 'first', preconditions: ['取得停水与入户协调安排'], evidence_refs: ['OBJECT'], ...overrides }
}
function request(id: string, key: RenewalInternalDataRequest['key'], related: string[]): RenewalInternalDataRequest {
  return { id, key, metric: { resident_wellbeing: '居民幸福度与生活便利度', elevator_usage: '电梯日均利用率', meal_attendance: '食堂用餐人数', other: '项目共同采集项' }[key], purpose: '校准服务配置与实施优先序', collection_method: '逐户问卷并与分时计数对照', unit: '人次／日', period: '连续四周，工作日与周末分别记录', denominator: '登记常住600户；记录实际应答户数与有效样本', related_package_ids: related, evidence_refs: ['OBJECT'] }
}
function packet(): StrategyPacket {
  return { project_id: 'P-CONCRETE', context_version: 8, input_hash: 'work-plan-hash', synthetic: false, status: 'completed', created_at: '2026-10-15T09:00:00Z', error: null, sources: [{ id: 'OBJECT', title: '本项目设施原文', text: quote, url: null, published_at: '2026-10-01', role: 'current', locator: 'line:22' }], model_calls: [], research: null, decision: null,
    strategy: { headline: '总体建议不代替具体清单', summary: '按楼栋分项安排。', preferred_mode: 'comprehensive', rationale: [], next_checks: [],
      internal_data_requests: [request('HAPPY', 'resident_wellbeing', ['WATER', 'REBUILD']), request('MEAL', 'meal_attendance', ['SERVICE']), request('OTHER-PATH', 'elevator_usage', ['REBUILD']), request('UNLINKED', 'other', [])],
      paths: [{ mode: 'comprehensive', title: '供水与公共服务分项方案', description: '按明确楼栋与设施交付分项安排。', actions: [{ title: '旧版概括建议', detail: '先核对接口条件。', evidence_refs: ['OBJECT'] }], requirements: ['落实本期工程范围'], work_packages: [work('WATER'), work('SERVICE', { target: '拟设的社区活动点', target_basis: 'scenario', quantity: 2, unit: '处', quantity_basis: 'scenario', intervention: '配置活动设施与共享开放时段', delivery: '形成可预约的公共活动空间', priority: 'next' }), work('ZERO', { target: '当前额外电梯设备', quantity: 0, unit: '台', quantity_basis: 'source', intervention: '保留接口，按后续方案安排设备', priority: 'reserve' })] },
        { mode: 'rebuild', title: '原拆原建方案', description: '拆建安置专项安排。', actions: [], requirements: [], work_packages: [work('REBUILD', { target: '住房重建A组', intervention: '原拆原建实施安排', quantity: 10, unit: '栋', quantity_basis: 'scenario' })] }], dimensions: (['demand', 'supply', 'adaptation', 'implementation', 'operations', 'resources'] as const).map(key => ({ key, current: '现况待评价', current_level: 'unknown', comprehensive: '本方向交付目标', comprehensive_level: 'medium', rebuild: '另一方向目标', rebuild_level: 'high', evidence_refs: ['OBJECT'] })) } }
}
const documentFor = (value: StrategyPacket) => parseHTML(renderToStaticMarkup(createElement(ConcreteWorkPlan, { packet: value, direction: 'comprehensive', onEvidence: vi.fn() }))).document

test('the work table presents actual objects, interventions and delivery while keeping unknown, zero and scenario quantities distinct', () => {
  const document = documentFor(packet()), table = document.querySelector('.cwp-work-table')!
  expect(table.querySelectorAll('tbody tr')).toHaveLength(3)
  expect(table.textContent).toContain('29幢2单元供水设施')
  expect(table.textContent).toContain('更换破损立管并按楼层分段接驳')
  expect(table.textContent).toContain('完成试压交付')
  expect(table.querySelector('[data-work-package-id=WATER]')?.textContent).toContain('工程量待测')
  expect(table.querySelector('[data-work-package-id=SERVICE]')?.textContent).toContain('2 处')
  expect(table.querySelector('[data-work-package-id=SERVICE]')?.textContent).toContain('情景设定')
  expect(table.querySelector('[data-work-package-id=SERVICE]')?.textContent).toContain('情景对象')
  expect(table.querySelector('[data-work-package-id=ZERO]')?.textContent).toContain('0 台')
  expect(table.querySelector('[data-work-package-id=ZERO]')?.textContent).toContain('原文记载数值')
  expect(table.textContent).toContain('取得停水与入户协调安排')
  expect(table.textContent).not.toMatch(/住房重建A组|原拆原建实施安排|万元|ROI/)
  expect(document.querySelector('.cwp-legacy')).toBeNull()
})

test('unknown basis or a missing unit never becomes a definite quantity', () => {
  const value = packet(), rows = value.strategy!.paths[0].work_packages!
  rows[0].quantity = 99
  rows[1].unit = null
  const document = documentFor(value)
  expect(document.querySelector('[data-work-package-id=WATER]')?.textContent).not.toContain('99')
  expect(document.querySelector('[data-work-package-id=WATER]')?.textContent).toContain('工程量待测')
  expect(document.querySelector('[data-work-package-id=SERVICE] .cwp-quantity-missing')?.textContent).toBe('工程量待测')
})

test('internal collection lists keep method, unit, window and denominator and link only the current path packages', () => {
  const document = documentFor(packet()), requests = document.querySelector('[aria-label="本方向内部数据采集计划"]')!
  expect(requests.querySelectorAll('tbody tr')).toHaveLength(2)
  expect(requests.textContent).toContain('居民幸福度与生活便利度')
  expect(requests.textContent).toContain('食堂用餐人数')
  expect(requests.textContent).toContain('逐户问卷并与分时计数对照')
  expect(requests.textContent).toContain('人次／日')
  expect(requests.textContent).toContain('连续四周，工作日与周末分别记录')
  expect(requests.textContent).toContain('实际应答户数与有效样本')
  expect(requests.textContent).not.toMatch(/电梯日均利用率|住房重建A组/)
  expect(document.querySelector('.cwp-unlinked-requests')?.textContent).toContain('尚未关联具体分项')
})

test('literal quote and locator survive unchanged and navigation delegates the exact saved packet without writing', async () => {
  const value = packet(), dom = parseHTML('<html><body><div id="root"></div></body></html>')
  for (const [key, val] of Object.entries({ window: dom.window, document: dom.document, IS_REACT_ACT_ENVIRONMENT: true })) vi.stubGlobal(key, val)
  const fetchMock = vi.fn(), onEvidence = vi.fn(), onInvestigate = vi.fn(), scroll = vi.fn()
  vi.stubGlobal('fetch', fetchMock); dom.window.HTMLElement.prototype.scrollIntoView = scroll; dom.window.HTMLElement.prototype.focus = vi.fn()
  const container = dom.document.getElementById('root')!, root = createRoot(container)
  try {
    await act(async () => root.render(createElement(ConcreteWorkPlan, { packet: value, direction: 'comprehensive', onEvidence, onInvestigate })))
    expect(container.querySelector('[data-work-package-id=WATER] blockquote')?.textContent).toBe(quote)
    expect(container.querySelector('[data-work-package-id=WATER] .cwp-locator')?.textContent).toBe('line:22')
    const original = [...container.querySelectorAll<HTMLButtonElement>('[data-work-package-id=WATER] button')].find(button => button.textContent === '查看原始来源 ↗')!
    await act(async () => original.click())
    expect(onEvidence).toHaveBeenCalledWith(['OBJECT'], value)
    await act(async () => container.querySelector<HTMLButtonElement>('.cwp-data-table td:last-child .cwp-link')!.click())
    expect(container.querySelector('[data-work-package-id=WATER]')?.getAttribute('data-focused')).toBe('true')
    expect(scroll).toHaveBeenCalledOnce()
    await act(async () => container.querySelector<HTMLButtonElement>('.cwp-investigate')!.click())
    expect(onInvestigate).toHaveBeenCalledOnce()
    expect(fetchMock).not.toHaveBeenCalled()
  } finally { await act(async () => root.unmount()) }
})

test('an older packet retains its actions as labelled legacy advice and does not invent a work table', () => {
  const value = packet(); delete value.strategy!.paths[0].work_packages
  const document = documentFor(value)
  expect(document.querySelector('.cwp-legacy')?.textContent).toContain('旧版概括建议')
  expect(document.querySelector('.cwp-heading')?.textContent).toContain('旧版建议')
  expect(document.querySelector('.cwp-work-table')).toBeNull()
  expect(document.querySelector('.cwp-legacy')?.textContent).toContain('重新研究')
  expect(document.querySelector('.cwp-legacy')?.textContent).not.toContain('29幢2单元')
})

test('the single scheme content places the concrete table first and uses the exact user pane names', () => {
  const value = packet(), project: Project = { id: value.project_id, name: '具体方案项目', context_version: value.context_version, input: { ...fixture, synthetic: false } as Project['input'] }
  const document = parseHTML(renderToStaticMarkup(createElement(SingleSchemeWorkspace, { project, result: value, mode: 'comprehensive', demoActive: false, pane: 'content', onNavigate: vi.fn(), onEvidence: vi.fn() }))).document
  expect(document.querySelector('.ssw-content-grid')?.firstElementChild?.classList.contains('concrete-work-plan')).toBe(true)
  expect(document.querySelectorAll('.cwp-work-table')).toHaveLength(1)
  expect(document.querySelector('.ssw-actions')).toBeNull()
  expect([...document.querySelectorAll('.ssw-tabs strong')].map(element => element.textContent)).toEqual(['内容与效果', '建设与资金', '社区运营', '敏感性与核验'])
  expect(document.body.textContent).not.toContain('住房重建A组')
})
