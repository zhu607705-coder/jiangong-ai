import { afterEach, expect, test, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { Simulate } from 'react-dom/test-utils'
import { parseHTML } from 'linkedom'
import DecisionComparison, { decisionComparisonMetrics } from '../../apps/workspace/src/components/DecisionComparison'
import type { ResearchMaterial, ResearchRound } from '../../packages/retrofit/research-rounds'
import type { StrategyPacket } from '../../packages/retrofit/strategy'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
const keys = ['demand', 'supply', 'adaptation', 'implementation', 'operations', 'resources'] as const
function packet(version: number): StrategyPacket {
  return { project_id: 'COMPARE', context_version: version, input_hash: `hash-${version}`, created_at: `2026-10-${String(10 + version).padStart(2, '0')}T03:00:00Z`, synthetic: false, status: 'completed', error: null, model_calls: [], research: null, decision: null,
    sources: Array.from({ length: version }, (_, index) => ({ id: `SRC-${index + 1}`, title: `第${index + 1}份原文`, text: `第${index + 1}份资料的连续原文，记录本项目结构与资金范围。`, url: null, published_at: '2026-10-10', role: 'current', locator: `line:${index + 1}`, visibility: 'internal' })),
    strategy: { preferred_mode: version > 1 ? 'rebuild' : 'comprehensive', headline: version > 1 ? '原拆原建全局标题' : '综合整治全局标题', summary: '模型比较两条路径。',
      decision_brief: { renewal: { conclusion: version > 1 ? '原拆原建全局判断' : '综合整治全局判断', reason: '根据模型主要路径说明。', evidence_refs: ['SRC-1'] }, investment: { conclusion: '原拆原建整体工程投入', reason: '整体工程资金说明。', stage: 'construction', evidence_refs: ['SRC-1'] }, returns: { financial: '原拆原建全局回报预期', social: '原拆原建全局社会预期', evidence_refs: ['SRC-1'] } },
      paths: [{ mode: 'comprehensive', title: `分项改善方案 v${version}`, description: `本期逐栋更新范围 v${version}。原拆原建不在本路径。`, actions: [{ title: `逐栋核实 v${version}`, detail: `按本期材料实施分项改善 v${version}。`, evidence_refs: [`SRC-${version}`] }], requirements: ['补充落实资金文件'] }, { mode: 'rebuild', title: `原拆原建专项方案 v${version}`, description: '原拆原建重新组织住宅与服务。', actions: [{ title: '原拆原建安置调查', detail: '原拆原建安置条件需核实。', evidence_refs: ['SRC-1'] }], requirements: ['取得安置资料'] }],
      dimensions: keys.map((key, index) => ({ key, current: `当前事实说明${index + 1}`, current_level: index < version ? 'high' : 'unknown', comprehensive: key === 'resources' ? `分项改善预计费用 ${version * 100} 万元，需核实本期范围。` : `分项服务目标 ${index + 1} v${version}。`, comprehensive_level: index < version ? version === 1 ? 'low' : 'medium' : 'unknown', rebuild: `原拆原建服务目标${index + 1}`, rebuild_level: 'high', evidence_refs: [`SRC-${Math.min(version, index + 1)}`] })),
      rationale: [{ point: '原始判断原因', source_id: 'SRC-1', quote: '第1份资料的连续原文，记录本项目结构与资金范围。' }], next_checks: [{ title: '资金', detail: '补充落实资金文件', evidence_refs: ['SRC-1'] }],
      round_review: { summary: '补充资料后明确范围。', changes: [{ topic: '范围', before: '逐栋待核', after: '已明确两栋的论证范围', reason: '新增原文说明了适用楼栋。', evidence_refs: [`SRC-${version}`] }], missing_materials: [{ topic: '资金', request: '补充落实资金文件', reason: '明确实际额度。', evidence_refs: ['SRC-1'] }] } } }
}
function material(id: string, version: string): ResearchMaterial { return { document_id: id, project_id: 'COMPARE', file_name: `${id}.pdf`, source_id: id, version, data_class: 'internal', visibility: 'internal', parse_status: 'extracted', locator: `document:${id}`, material_category: 'structural_assessment', source_date: '2026-10-10', source_date_origin: 'user_declared', added_in_round: false } }
function round(number: number, files: ResearchMaterial[] = []): ResearchRound { const result = packet(number); return { id: `r${number}`, project_id: result.project_id, round_number: number, context_version: number, input_hash: result.input_hash, parent_round_id: number > 1 ? 'r1' : null, parent_input_hash: number > 1 ? 'hash-1' : null, parent_context_version: number > 1 ? 1 : null, first_round_id: 'r1', first_input_hash: 'hash-1', first_context_version: 1, origin: 'generated', status: 'completed', material_intake: files.length ? 'provided' : 'none', allow_internal_ai: !!files.length, materials: files, missing_materials: result.strategy!.round_review!.missing_materials, result, error: null, created_at: result.created_at, updated_at: result.created_at } }
const first = round(1, [material('鉴定', 'v1')]), second = round(2, [material('鉴定', 'v2')]), latest = round(4, [material('鉴定', 'v2'), material('问卷', 'v1')])
async function mount(props: Partial<Parameters<typeof DecisionComparison>[0]> = {}) {
  const dom = parseHTML('<html><body><div id="root"></div></body></html>')
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.document, IS_REACT_ACT_ENVIRONMENT: true })) vi.stubGlobal(key, value)
  const fetchMock = vi.fn(() => { throw new Error('Decision comparison must only consume saved props') }); vi.stubGlobal('fetch', fetchMock)
  const onSupplement = vi.fn(), onEvidence = vi.fn(), container = dom.document.getElementById('root')!, root = createRoot(container)
  const values = { rounds: [first, second, latest], materials: [...latest.materials, material('待纳入', 'v1')], selectedDirection: 'comprehensive' as const, onSupplement, onEvidence, ...props }
  await act(async () => root.render(createElement(DecisionComparison, values)))
  return { container, root, onSupplement, onEvidence, fetchMock, cleanup: () => act(async () => root.unmount()) }
}

test('the comparison uses actual first/latest round IDs and switches its baseline without a network or write', async () => {
  const app = await mount()
  try {
    expect(app.container.querySelector('.decision-comparison')?.getAttribute('data-before-round')).toBe('r1')
    expect(app.container.querySelector('.decision-comparison')?.getAttribute('data-after-round')).toBe('r4')
    expect(app.container.querySelector('.dc-story')?.textContent).toContain('2 份新增或更新文件')
    expect(app.container.querySelector('.dc-new-evidence')?.textContent).toContain('版本更新')
    await act(async () => Simulate.change(app.container.querySelector<HTMLSelectElement>('[aria-label="对照前版"]')!, { target: { value: 'r2' } } as never))
    expect(app.container.querySelector('.decision-comparison')?.getAttribute('data-before-round')).toBe('r2')
    expect(app.container.querySelector('.dc-story')?.textContent).toContain('1 份新增或更新文件')
    expect(app.container.querySelector('.dc-new-evidence')?.textContent).not.toContain('版本更新')
    expect(app.fetchMock).not.toHaveBeenCalled()
    expect(app.onSupplement).not.toHaveBeenCalled()
  } finally { await app.cleanup() }
})

test('selected direction excludes other-path recommendations and uses only its 1/3/5 grade series', async () => {
  const app = await mount()
  try {
    expect(app.container.querySelector('.dc-matrix')?.textContent).toContain('分项改善方案 v4')
    expect(app.container.textContent).not.toContain('原拆原建')
    expect(app.container.querySelector('.dc-change-reasons')).toBeNull()
    expect(app.container.querySelector('.dc-matrix')?.textContent).not.toContain('工程投入')
    expect(app.container.querySelector('.dc-matrix')?.textContent).toContain('400 万元')
    expect(app.container.textContent).not.toMatch(/ROI|回本期|收益率|300 万元|300%/)
    await act(async () => [...app.container.querySelectorAll<HTMLButtonElement>('[role=tab]')].find(button => button.textContent === '六维评价')!.click())
    const cells = app.container.querySelectorAll('[data-dimension=demand] td')
    expect(cells[0].textContent).toContain('低 · 1')
    expect(cells[1].textContent).toContain('中 · 3')
    expect(app.container.querySelector('[data-dimension=resources] td')?.textContent).toContain('待评价')
    expect(app.container.querySelector('.dc-matrix')?.textContent).not.toContain('高 · 5')
    expect(app.container.textContent).not.toContain('原拆原建')
  } finally { await app.cleanup() }
})

test('without a chosen path it compares model direction judgments and current evidence grades', async () => {
  const app = await mount({ selectedDirection: null })
  try {
    expect(app.container.querySelector('.dc-matrix')?.textContent).toContain('综合整治')
    expect(app.container.querySelector('.dc-matrix')?.textContent).toContain('原拆原建')
    expect(app.container.querySelector('.dc-change-reasons')?.textContent).toContain('新增原文说明了适用楼栋')
    await act(async () => [...app.container.querySelectorAll<HTMLButtonElement>('[role=tab]')].find(button => button.textContent === '六维评价')!.click())
    expect(app.container.querySelector('[data-dimension=demand] td')?.textContent).toContain('高 · 5')
    expect(app.container.querySelector('.dc-matrix-heading')?.textContent).toContain('现况证据适配')
  } finally { await app.cleanup() }
})

test('metrics deduplicate references and require readable source text for a supported evaluated dimension', () => {
  const value = packet(2), before = JSON.stringify(value)
  value.sources.push({ ...value.sources[0] })
  value.strategy!.dimensions[1].evidence_refs = ['UNREGISTERED']
  expect(decisionComparisonMetrics(value)).toEqual({ sources: 2, supported: 1, unknown: 4 })
  value.sources.filter(source => source.id === 'SRC-1').forEach(source => { source.role = 'reference' })
  expect(decisionComparisonMetrics(value)).toEqual({ sources: 2, supported: 0, unknown: 4 })
  expect(decisionComparisonMetrics({ ...value, status: 'failed' })).toBeNull()
  expect(JSON.stringify(packet(2))).toBe(before)
  const duplicate = packet(2); duplicate.strategy!.dimensions.push({ ...duplicate.strategy!.dimensions[0] })
  expect(decisionComparisonMetrics(duplicate)).toEqual({ sources: 2, supported: 1, unknown: 5 })
  const targetOnly = packet(2)
  targetOnly.strategy!.dimensions.forEach(row => { row.current_level = 'unknown'; row.comprehensive_level = 'high'; row.rebuild_level = 'high' })
  expect(decisionComparisonMetrics(targetOnly)).toEqual({ sources: 2, supported: 0, unknown: 6 })
})

test('unknown fills and regressions are both shown instead of reporting only a net improvement', async () => {
  const changed = structuredClone(latest)
  changed.result!.strategy!.dimensions[0].current_level = 'unknown'
  const app = await mount({ rounds: [first, changed] })
  try {
    expect(app.container.querySelector('[data-metric=unknown]')?.textContent).toContain('新增有原文评价 3 维 · 新增待评 1 维')
    expect(app.container.querySelector('[data-metric=unknown]')?.textContent).not.toMatch(/准确|已核实|收益/)
  } finally { await app.cleanup() }
})

test('failed, foreign-project, other-synthetic and inconsistent-version rounds do not become a comparison endpoint', async () => {
  const failed = { ...round(5), status: 'failed' as const }, foreign = round(6), simulated = round(7), mismatch = round(8)
  foreign.project_id = 'OTHER'; foreign.result!.project_id = 'OTHER'
  simulated.result!.synthetic = true
  mismatch.result!.context_version = 99
  const app = await mount({ rounds: [first, latest, failed, foreign, simulated, mismatch] })
  try {
    expect(app.container.querySelector('.decision-comparison')?.getAttribute('data-after-round')).toBe('r4')
    expect(app.container.querySelector('[aria-label="对照新版"]')?.textContent).not.toMatch(/第 5|第 6|第 7|第 8/)
    expect(app.fetchMock).not.toHaveBeenCalled()
  } finally { await app.cleanup() }
})

test('source inspection preserves literal old text and supplies the correct packet to the existing navigation callback', async () => {
  const app = await mount()
  try {
    await act(async () => app.container.querySelector<HTMLButtonElement>('.dc-matrix tbody tr button')!.click())
    const dialog = app.container.querySelector('[role=dialog]')!
    expect(dialog.querySelector('blockquote')?.textContent).toBe(first.result!.sources[0].text)
    const locate = [...dialog.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '在资料页定位')!
    await act(async () => locate.click())
    expect(app.onEvidence).toHaveBeenCalledWith(['SRC-1'], first.result)
    expect(app.fetchMock).not.toHaveBeenCalled()
  } finally { await app.cleanup() }
})

test('an unadopted candidate remains a labelled current first edition and only links to continuing the review', async () => {
  const app = await mount({ rounds: [], candidate: packet(1) })
  try {
    expect(app.container.textContent).toContain('尚未采纳为首轮')
    expect(app.container.querySelector('.decision-comparison')?.getAttribute('data-before-round')).toBe('')
    expect(app.container.querySelector('[data-metric=sources]')?.textContent).toContain('待比较')
    expect(app.container.textContent).not.toContain('加一条企业经验')
    await act(async () => app.container.querySelector<HTMLButtonElement>('.dc-supplement')!.click())
    expect(app.onSupplement).toHaveBeenCalledOnce()
    expect(app.fetchMock).not.toHaveBeenCalled()
  } finally { await app.cleanup() }
})
