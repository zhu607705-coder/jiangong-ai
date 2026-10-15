import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { parseHTML } from 'linkedom'
import fixture from '../../fixtures/inputs/01_auto.json'
import type { DecisionPacket, RenewalStrategy, Source } from '../../apps/host/generated/contracts'
import type { Project } from '../../apps/workspace/src/api'
import type { ResearchRound } from '../../packages/retrofit/research-rounds'
import type { StrategyPacket } from '../../packages/retrofit/strategy'
import { withConcreteWorkPlan } from './fixtures/strategy-work-plan'
import ProjectResultsPage, { renderStrategyReportMarkdown } from '../../apps/workspace/src/components/ProjectResultsPage'

const PROJECT_ID = 'P-RESULTS'
const CAMPUS_ID = 'P-0529974d-63fe-4ae8-804d-e5efb049f60a'
const original = '原件记录：29、30、31、48幢供水方案涉及252户。\n原文保留「分期安排」、标点与换行。'
const savedAt = '2026-10-13T04:05:06Z'
const onNavigate = vi.fn<(page: 'assessment' | 'scenarios' | 'results', section?: string, pane?: string) => void>()
const onRunDetails = vi.fn()
let root: Root, container: HTMLElement
let downloads: Blob[]

function project(id = PROJECT_ID): Project {
  const input = structuredClone(fixture) as Project['input']
  input.project_id = id
  input.synthetic = false
  input.business_profile = 'neighborhood'
  input.as_of = '2026-10-15'
  input.sources = [{ id: 'CURRENT', title: '本对象供水原件', untrusted_text: original,
    data_class: 'public', visibility: 'public', synthetic: false, hash: 'source-original-sha',
    locator: 'page:3;paragraph:2', content_status: 'full_text', published_at: '2026-10-01', date_status: 'verified',
  } satisfies Source]
  return { id, name: '求是村', context_version: 4, input }
}

function packet(p = project()): StrategyPacket {
  const source: StrategyPacket['sources'][number] = {
    id: 'CURRENT', title: '本对象供水原件', text: original, url: 'https://example.org/water-original',
    published_at: '2026-10-01', role: 'current', locator: 'page:3;paragraph:2',
    visibility: 'public', data_class: 'public', project_id: p.id, document_version: 'source-original-sha',
  }
  const strategy: RenewalStrategy = withConcreteWorkPlan({
    headline: '四幢供水改善与居民协同方案',
    summary: '优先核查四幢管线，按已保存资料研究分项改善。', preferred_mode: 'comprehensive',
    decision_brief: {
      renewal: { conclusion: '将四幢供水改善列为优先候选。', reason: '原件明确本对象供水范围。', evidence_refs: ['CURRENT'] },
      investment: { conclusion: '先编制管线调查和居民协商专项预算。', reason: '工程费用与资金落实仍待核实。', stage: 'preliminary', evidence_refs: ['CURRENT'] },
      returns: { financial: '建设分担与持续维护支出分别核算。', social: '研究改善252户用水可靠性。', evidence_refs: ['CURRENT'] },
    },
    rationale: [{ point: '现有资料记载四幢供水范围。', source_id: 'CURRENT', quote: original }],
    paths: [
      { mode: 'comprehensive', title: '分期修缮供水设施', description: '保留现有建筑，核实管线和计量方案。',
        actions: [{ title: '调查既有供水立管', detail: '按四幢逐项核实维修范围。', evidence_refs: ['CURRENT'] }], requirements: ['核实技术方案及施工期间用水安排。'] },
      { mode: 'rebuild', title: '拆建条件比较方案', description: '按原件之外尚待核实的拆建前提进行比较。',
        actions: [{ title: '核对拆建规划条件', detail: '核实安置、回搬及资金条件。', evidence_refs: ['CURRENT'] }], requirements: ['取得适用的规划和结构资料。'] },
    ],
    dimensions: [{ key: 'resources', current: '建设及维护费用尚待补充。', current_level: 'unknown',
      comprehensive: '核实分项维修和维护预算。', comprehensive_level: 'medium',
      rebuild: '核实新建与过渡费用。', rebuild_level: 'unknown', evidence_refs: ['CURRENT'] }],
    next_checks: [{ title: '补充专项预算', detail: '取得设计范围和资金凭据。', evidence_refs: ['CURRENT'] }],
  }, source)
  return { project_id: p.id, context_version: p.context_version, input_hash: 'strategy-input-v4', created_at: savedAt,
    synthetic: p.input.synthetic, status: 'completed', strategy, sources: [source], decision: null,
    model_calls: [], research: null, error: null }
}

function round(result: StrategyPacket | null = packet(), patch: Partial<ResearchRound> = {}): ResearchRound {
  return { id: 'ROUND-1', project_id: PROJECT_ID, round_number: 1, context_version: 4, input_hash: result?.input_hash || 'failed-input',
    parent_round_id: null, parent_input_hash: null, parent_context_version: null,
    first_round_id: 'ROUND-1', first_input_hash: 'strategy-input-v4', first_context_version: 4,
    origin: 'generated', status: 'completed', material_intake: 'none', allow_internal_ai: false,
    materials: [], missing_materials: [], result, error: null, created_at: savedAt, updated_at: savedAt, ...patch }
}

function legacy(p = project()): DecisionPacket {
  return { schema_version: '2.0', project_id: p.id, run_id: 'RUN-RESULTS', revision: 2,
    snapshot_hash: 'legacy-snapshot', context_version: 3, mode: 'automatic', execution_mode: 'live', synthetic: false,
    status: 'partial', summary: '历史通用运行的真实摘要', as_of: '2026-10-01', created_at: '2026-10-01T01:02:03Z',
    findings: [], metrics: [], scenarios: [], reviews: [], followups: [], sources: [], context_rules: [],
    impact: { changed_rule_ids: [], invalidated: [], reused: [], changed_paths: [] }, warnings: [], missing_fields: [],
    artifact_refs: [], runtime: 'DeepSeek Harness', model: null }
}

beforeEach(() => {
  const { window } = parseHTML('<!doctype html><html><body><div id="root"></div></body></html>')
  vi.stubGlobal('window', window)
  vi.stubGlobal('document', window.document)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('The results page must use saved inputs')))
  downloads = []
  vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => { downloads.push(blob as Blob); return `blob:results-${downloads.length}` })
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  root = createRoot(window.document.getElementById('root')!)
  container = window.document.getElementById('root') as unknown as HTMLElement
  onNavigate.mockReset()
  onRunDetails.mockReset()
})

afterEach(async () => {
  await act(async () => root.unmount())
  expect(fetch).not.toHaveBeenCalled()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function render(result: StrategyPacket | null = packet(), p = project(), rounds: ResearchRound[] = [], legacyPacket: DecisionPacket | null = null) {
  await act(async () => root.render(createElement(ProjectResultsPage, { project: p, packet: result, rounds, legacyPacket, onNavigate, onRunDetails })))
}
function button(label: string, scope: ParentNode = container): HTMLButtonElement {
  const found = [...scope.querySelectorAll<HTMLButtonElement>('button')].find(row => row.textContent?.trim() === label)
  expect(found, `Expected button: ${label}`).toBeDefined()
  return found!
}
async function click(label: string, scope: ParentNode = container) { await act(async () => button(label, scope).click()) }
function cardContaining(text: string): HTMLElement {
  const found = [...container.querySelectorAll<HTMLElement>('article')].find(row => row.textContent?.includes(text))
  expect(found, `Expected result card containing: ${text}`).toBeDefined()
  return found!
}
function includesSavedTime(scope: HTMLElement, value: string) {
  // Browsers normalize HTML attributes; linkedom preserves React's dateTime spelling.
  const recorded = [...scope.querySelectorAll('time')].find(time => (time.getAttribute('datetime') ?? time.getAttribute('dateTime')) === value)
  expect(recorded, `Expected a semantic time element retaining the original ISO timestamp ${value}`).toBeDefined()
  const expectedDisplay = new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
  expect(recorded!.textContent).toBe(`${expectedDisplay}（北京时间）`)
}
function exportedPacket(value: unknown): unknown {
  if (!value || typeof value !== 'object') return undefined
  const row = value as Record<string, unknown>
  if (row.project_id && row.input_hash && row.created_at && row.strategy) return value
  return Object.values(row).map(exportedPacket).find(Boolean)
}

test('current saved strategy displays its actual headline, creation time, context version and completed state', async () => {
  const result = packet(), before = JSON.stringify(result)
  await render(result, project(), [round(result)])
  const card = cardContaining(result.strategy!.headline)
  expect(card.textContent).toContain('四幢供水改善与居民协同方案')
  expect(card.textContent).toMatch(/(?:资料|上下文|版本|v)\s*4/i)
  expect(card.textContent).toMatch(/与当前资料一致|完成/)
  expect(container.textContent).toMatch(/首轮|基线/)
  includesSavedTime(card, savedAt)
  expect(card.textContent).not.toMatch(/已发布|已审核/)
  expect(JSON.stringify(result)).toBe(before)
})

test('a stale saved packet remains an older-version result and is not described as published or reviewed', async () => {
  const old = packet(); old.context_version = 2; old.input_hash = 'older-input-v2'; old.created_at = '2026-10-01T01:02:03Z'
  await render(old)
  const card = cardContaining(old.strategy!.headline)
  expect(card.textContent).toMatch(/(?:资料|上下文|版本|v)\s*2/i)
  expect(card.textContent).toMatch(/历史|旧资料版本结果|旧版|过期|资料已更新/)
  expect(card.textContent).not.toMatch(/当前已完成|已发布|已审核/)
  includesSavedTime(card, old.created_at)
  expect(button('导出 JSON', card).disabled).toBe(false)
})

test('without an explicit packet the default card uses the latest saved round at the same material baseline', async () => {
  const first = packet(), latest = packet()
  first.strategy!.headline = '同基线首轮旧方案'
  latest.strategy!.headline = '同基线最新保存方案'; latest.created_at = '2026-10-15T03:00:00Z'; latest.input_hash = 'latest-same-baseline'
  await render(null, project(), [round(first), round(latest, { id: 'ROUND-LATEST', round_number: 2 })])
  expect(container.querySelector('article[aria-label="已保存方案"]')?.textContent).toContain(latest.strategy!.headline)
  expect(container.querySelector('article[aria-label="研究轮次 1"]')?.textContent).toContain(first.strategy!.headline)
})

test('round and legacy dates preserve raw ISO values while displaying the Beijing calendar day across midnight', async () => {
  const result = packet(), roundTime = '2026-10-14T20:30:00Z', legacyTime = '2026-10-01T18:05:06Z'
  const old = legacy(); old.created_at = legacyTime
  await render(result, project(), [round(result, { created_at: roundTime })], old)
  includesSavedTime(container.querySelector<HTMLElement>('article[aria-label="研究轮次 1"]')!, roundTime)
  includesSavedTime(container.querySelector<HTMLElement>('article[aria-label="旧版运行报告"]')!, legacyTime)
})

test('the empty state navigates to direction assessment without generating or fetching a result', async () => {
  await render(null)
  expect(container.textContent).toMatch(/尚无|还没有|暂无/)
  const entry = [...container.querySelectorAll<HTMLButtonElement>('button')].find(row => /研判|方向/.test(row.textContent || ''))
  expect(entry).toBeDefined()
  await act(async () => entry!.click())
  expect(onNavigate).toHaveBeenCalledWith('assessment', 'direction')
  expect(container.querySelector('button[disabled]')?.textContent || '').not.toContain('正在生成')
})

test('saved result actions navigate to the existing compare/history pages and open run details', async () => {
  await render()
  await click('查看方案')
  expect(onNavigate).toHaveBeenLastCalledWith('scenarios', 'compare')
  await click('版本变化')
  expect(onNavigate).toHaveBeenLastCalledWith('results', 'history')
  await click('运行详情')
  expect(onRunDetails).toHaveBeenCalledTimes(1)
})

test('foreign packets, rounds, nested round results and legacy decisions cannot appear in this project', async () => {
  const other = project('P-OTHER'), foreign = packet(other)
  foreign.strategy!.headline = 'FOREIGN-STRATEGY-DO-NOT-DISPLAY'
  const otherLegacy = legacy(other); otherLegacy.summary = 'FOREIGN-LEGACY-DO-NOT-DISPLAY'
  const foreignRound = round(foreign, { id: 'FOREIGN-ROUND', project_id: other.id })
  const contaminatedRound = round(foreign, { id: 'LOCAL-ROUND-FOREIGN-RESULT' })
  await render(foreign, project(), [foreignRound, contaminatedRound], otherLegacy)
  expect(container.textContent).not.toMatch(/FOREIGN-STRATEGY|FOREIGN-LEGACY/)
  expect(container.querySelector('a[href="/api/runs/RUN-RESULTS/report"]')).toBeNull()
  expect([...container.querySelectorAll('button')].some(row => row.textContent === '导出 JSON')).toBe(false)
})

test('failed and obsolete rounds remain visible while a completed older round still exports its saved result', async () => {
  const old = packet(); old.context_version = 2; old.input_hash = 'first-round-input'
  old.strategy!.headline = '首轮供水旧方案原件'
  const completed = round(old, { id: 'ROUND-COMPLETED', context_version: 2, input_hash: old.input_hash })
  const failed = round(null, { id: 'ROUND-FAILED', round_number: 2, status: 'failed', error: '模型研究未完成', created_at: '2026-10-14T01:00:00Z' })
  const obsolete = round(null, { id: 'ROUND-OBSOLETE', round_number: 3, status: 'obsolete', error: '资料版本已变化', created_at: '2026-10-15T01:00:00Z' })
  await render(null, project(), [completed, failed, obsolete])
  expect(container.textContent).toMatch(/失败|未完成/)
  expect(container.textContent).toMatch(/失效|已过期|过期|版本已变化|资料已变化/)
  const oldCard = cardContaining(old.strategy!.headline)
  await click('导出 JSON', oldCard)
  expect(downloads).toHaveLength(1)
  expect(exportedPacket(JSON.parse(await downloads[0].text()))).toEqual(old)
})

test('the campus PDF is bound to the exact real project id rather than its shared display name', async () => {
  const pdf = 'deliverables/求是村_旧改深度调研与行动计划.pdf'
  const campus = project(CAMPUS_ID)
  await render(packet(campus), campus)
  const links = () => [...container.querySelectorAll<HTMLAnchorElement>('a')].filter(link => decodeURI(link.getAttribute('href') || '').includes(pdf))
  expect(links()).toHaveLength(1)
  await render(packet(), project())
  expect(links()).toHaveLength(0)
  campus.input.synthetic = true
  await render(packet(campus), campus)
  expect(links()).toHaveLength(0)
})

test('same-project historical DecisionPacket links directly to its real run report', async () => {
  const saved = legacy()
  await render(null, project(), [], saved)
  const link = container.querySelector<HTMLAnchorElement>('a[href="/api/runs/RUN-RESULTS/report"]')
  expect(link).not.toBeNull()
  expect(container.textContent).toContain(saved.summary)
  expect(container.textContent).not.toMatch(/已发布|已审核/)
})

test('JSON downloads preserve the complete saved packet, optional work plans, requests and exact source text', async () => {
  const result = packet(), before = JSON.stringify(result)
  await render(result)
  await click('导出 JSON')
  expect(downloads).toHaveLength(1)
  const exported = exportedPacket(JSON.parse(await downloads[0].text())) as StrategyPacket
  expect(exported).toEqual(result)
  expect(exported.strategy!.paths[0].work_packages).toEqual(result.strategy!.paths[0].work_packages)
  expect(exported.strategy!.internal_data_requests).toEqual(result.strategy!.internal_data_requests)
  expect(exported.sources[0].locator).toBe('page:3;paragraph:2')
  expect(exported.sources[0].text).toBe(original)
  expect(exported.strategy!.paths[0].work_packages![0].quantity).toBeNull()
  expect(JSON.stringify(result)).toBe(before)
})

test('Markdown export includes all three briefs, both saved paths and traceable original sources without invented values', () => {
  const p = project(), result = packet(p), before = JSON.stringify({ p, result })
  const report = renderStrategyReportMarkdown(p, result), brief = result.strategy!.decision_brief!
  for (const text of [result.strategy!.headline, result.strategy!.summary, brief.renewal.conclusion, brief.renewal.reason,
    brief.investment.conclusion, brief.investment.reason, brief.returns.financial, brief.returns.social,
    ...result.strategy!.paths.flatMap(path => [path.title, path.description, ...path.actions.flatMap(action => [action.title, action.detail]), ...path.requirements]),
    result.sources[0].id, result.sources[0].title, result.sources[0].locator, result.sources[0].url!, original]) expect(report).toContain(text)
  expect(report).toContain(savedAt)
  expect(report).not.toMatch(/已发布|已审核|工程量.?0|准确率|节省.*%/)
  expect(JSON.stringify({ p, result })).toBe(before)
})

test('direct Markdown export rejects a foreign project or a different real/synthetic scope', () => {
  const p = project()
  expect(() => renderStrategyReportMarkdown(p, packet(project('P-OTHER')))).toThrow()
  const simulated = packet(p); simulated.synthetic = true
  expect(() => renderStrategyReportMarkdown(p, simulated)).toThrow()
})
