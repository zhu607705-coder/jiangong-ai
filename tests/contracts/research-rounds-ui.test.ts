import { afterEach, expect, test, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { Simulate } from 'react-dom/test-utils'
import { parseHTML } from 'linkedom'
import input from '../../fixtures/inputs/01_auto.json'
import StrategyOverview from '../../apps/workspace/src/components/StrategyOverview'
import InternalMaterialIntake from '../../apps/workspace/src/components/InternalMaterialIntake'
import type { Project } from '../../apps/workspace/src/api'
import type { StrategyPacket } from '../../packages/retrofit/strategy'
import type { ResearchMaterial, ResearchRound, ResearchRoundsResponse, CreateResearchRoundRequest } from '../../packages/retrofit/research-rounds'

vi.mock('../../apps/workspace/src/maps/RenewalModePanel', () => ({ default: () => null }))
vi.mock('../../apps/workspace/src/components/CompleteCommunityDemo', () => ({ default: () => null }))
vi.mock('../../apps/workspace/src/components/CommunityOperationsPanel', () => ({ default: () => null }))
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

const project: Project = { id: 'round-ui', name: '求是村轮次测试', context_version: 2, input: { ...input, project_id: 'round-ui', synthetic: false, business_profile: 'neighborhood', sources: [], facts: [], context_rules: [] } } as unknown as Project
function packet(version: number, headline: string): StrategyPacket {
  return { project_id: project.id, context_version: version, input_hash: `hash-${version}`, created_at: '2026-10-15T08:00:00Z', synthetic: false, status: 'completed', sources: [{ id: 'SRC', title: '项目原文', text: '现有资料说明需要逐栋核实结构和资金条件。', url: null, published_at: null, role: 'current', locator: 'line:1' }], decision: null, model_calls: [], research: null, error: null,
    strategy: { headline, summary: `${headline}。按楼栋核实后分项推进。`, preferred_mode: 'comprehensive', rationale: [{ point: '先明确实际范围', quote: '现有资料说明需要逐栋核实结构和资金条件。', source_id: 'SRC' }],
      paths: [{ mode: 'comprehensive', title: '分项改善方案', description: '按楼栋改善设施。', actions: [{ title: '逐栋调查', detail: '取得结构资料。', evidence_refs: ['SRC'] }], requirements: ['核实工程范围'] }, { mode: 'rebuild', title: '拆建专项论证', description: '核实安置条件。', actions: [{ title: '取得居民决议', detail: '确认规划。', evidence_refs: ['SRC'] }], requirements: ['确认安置'] }],
      dimensions: (['demand','supply','adaptation','implementation','operations','resources'] as const).map(key => ({ key, current: '已取得本对象材料', current_level: 'medium', comprehensive: '分项改善目标', comprehensive_level: 'medium', rebuild: '新建服务目标', rebuild_level: 'high', evidence_refs: ['SRC'] })), next_checks: [{ title: '结构资料', detail: '补充逐栋鉴定报告。', evidence_refs: ['SRC'] }] } }
}
const oldPacket = packet(1, '首轮：优先核实结构后分项更新'), newPacket = packet(2, '第二轮：依据新增鉴定调整分项范围')
newPacket.strategy!.round_review = { summary: '新增鉴定缩小了本期施工范围。', changes: [{ topic: '工程范围', before: '逐栋结构待核', after: '先开展已有鉴定的两栋', reason: '新增鉴定明确了对象范围。', evidence_refs: ['SRC'] }], missing_materials: [{ topic: '资金落实', request: '补充落实资金的文件', reason: '当前只有估算，需核实可用额度。', evidence_refs: ['SRC'] }] }
const material = (id: string): ResearchMaterial => ({ document_id: id, project_id: project.id, file_name: `${id}.pdf`, source_id: id, version: `sha-${id}`, material_category: 'structural_assessment', source_date: '2026-10-10', source_date_origin: 'user_declared', data_class: 'internal', visibility: 'internal', parse_status: 'extracted', locator: `document:${id}`, added_in_round: true })
const previousMaterial = material('首轮范围'), addedMaterial = material('新增鉴定')
function round(id: string, number: number, result: StrategyPacket | null, materials: ResearchMaterial[] = []): ResearchRound {
  return { id, project_id: project.id, round_number: number, context_version: result?.context_version || project.context_version, input_hash: result?.input_hash || '', parent_round_id: number > 1 ? 'r1' : null, parent_input_hash: number > 1 ? oldPacket.input_hash : null, parent_context_version: number > 1 ? 1 : null, first_round_id: 'r1', first_input_hash: oldPacket.input_hash, first_context_version: 1, origin: 'generated', status: result ? 'completed' : 'draft', material_intake: materials.length ? 'provided' : 'none', allow_internal_ai: !!materials.length, materials, missing_materials: result?.strategy?.round_review?.missing_materials || [{ topic: '结构鉴定', request: '补充结构鉴定报告', reason: '影响更新范围', evidence_refs: ['SRC'] }], result, error: null, created_at: '2026-10-15T08:00:00Z', updated_at: '2026-10-15T08:00:00Z' }
}
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })
function environment() {
  const dom = parseHTML('<html><body><div id="root"></div></body></html>')
  for (const [name, value] of Object.entries({ window: dom.window, document: dom.document, IS_REACT_ACT_ENVIRONMENT: true, requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0), cancelAnimationFrame: clearTimeout })) vi.stubGlobal(name, value)
  dom.window.HTMLElement.prototype.scrollIntoView = vi.fn()
  const root = createRoot(dom.document.getElementById('root')!)
  return { dom, root, container: dom.document.getElementById('root')!, cleanup: () => act(async () => root.unmount()) }
}
async function mount(data: ResearchRoundsResponse, current: StrategyPacket | null, generated: StrategyPacket = newPacket, pending?: { legacy?: Promise<StrategyPacket | null>; rounds?: Promise<ResearchRoundsResponse>; waitForRounds?: boolean }) {
  const env = environment(); let state = structuredClone(data), created: ResearchRound | null = null
  const transport = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const path = String(url), method = init?.method || 'GET'
    if (path.includes('/renewal-strategy') && method === 'GET') return json(pending?.legacy ? await pending.legacy : current)
    if (path.endsWith('/research-rounds') && method === 'GET') return json(pending?.rounds ? await pending.rounds : state)
    if (path.endsWith('/research-rounds/adopt')) { const adopted = { ...round('r1', 1, current || state.baseline_candidate), origin: 'adopted_history' as const }; state.rounds.push(adopted); return json({ round: adopted }) }
    if (path.endsWith('/research-rounds') && method === 'POST') { const body = JSON.parse(String(init?.body)) as CreateResearchRoundRequest; created = round(body.parent_round_id ? 'r2' : 'r1', body.parent_round_id ? 2 : 1, null, state.materials.filter(material => body.document_ids.includes(material.document_id))); state.rounds.push(created); return json({ round: created }) }
    if (path.endsWith('/run')) { const completed = { ...created!, result: generated, input_hash: generated.input_hash, status: 'completed' as const, missing_materials: generated.strategy?.round_review?.missing_materials || [] }; state.rounds = state.rounds.map(round => round.id === completed.id ? completed : round); return new Response(JSON.stringify({ type: 'complete', result: generated, round: completed }) + '\n', { headers: { 'content-type': 'application/x-ndjson' } }) }
    throw new Error(`Unexpected request ${path}`)
  })
  vi.stubGlobal('fetch', transport)
  await act(async () => env.root.render(createElement(StrategyOverview, { project, demoActive: false, onEvidence: vi.fn(), onInvestigate: vi.fn(), onUploadMaterial: vi.fn() })))
  if (pending?.waitForRounds !== false) await vi.waitFor(() => expect(env.container.querySelector('.research-intake [role=status]')).toBeNull())
  return { ...env, transport }
}

test('an existing saved plan is adopted as the first baseline without automatic or repeated model generation', async () => {
  const app = await mount({ rounds: [], materials: [], baseline_candidate: oldPacket }, packet(2, oldPacket.strategy!.headline))
  try {
    expect(app.container.querySelector('.research-intake h3')?.textContent).toContain('有没有企业或项目内部资料')
    expect(app.transport.mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true)
    const keep = [...app.container.querySelectorAll<HTMLButtonElement>('.research-intake-actions button')].find(button => button.textContent?.includes('保留现有方案作为首轮'))!
    await act(async () => keep.click())
    await vi.waitFor(() => expect(app.container.querySelector('[data-round-id=r1]')?.textContent).toContain('首轮基线'))
    expect(app.transport.mock.calls.filter(([, init]) => init?.method === 'POST').map(([url]) => String(url))).toEqual(['/api/projects/round-ui/research-rounds/adopt'])
    expect(app.container.textContent).toContain('采纳已保存方案')
  } finally { await app.cleanup() }
})

test('choosing no internal materials explicitly creates and runs the first review, without an automatic POST', async () => {
  const app = await mount({ rounds: [], materials: [], baseline_candidate: null }, null, packet(2, '首轮现有资料研判'))
  try {
    expect(app.transport.mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true)
    const start = [...app.container.querySelectorAll<HTMLButtonElement>('.research-intake-actions button')].find(button => button.textContent?.includes('开展首轮研判'))!
    await act(async () => start.click())
    await vi.waitFor(() => expect(app.container.querySelector('.decision-brief h3')?.textContent).toBe('首轮现有资料研判'))
    const request = app.transport.mock.calls.find(([url, init]) => String(url).endsWith('/research-rounds') && init?.method === 'POST')!
    expect(JSON.parse(String(request[1]!.body))).toEqual({ expected_context_version: 2, material_intake: 'none', document_ids: [], allow_internal_ai: false })
    expect(app.container.querySelector('[data-round-id=r1]')).not.toBeNull()
  } finally { await app.cleanup() }
})

test('the second review requires consent, submits inherited plus new documents, and retains both results and changes', async () => {
  const first = round('r1', 1, oldPacket, [previousMaterial])
  const app = await mount({ rounds: [first], materials: [previousMaterial, addedMaterial], baseline_candidate: oldPacket }, null)
  try {
    expect(app.container.querySelector('.decision-brief')).toBeNull()
    const start = [...app.container.querySelectorAll<HTMLButtonElement>('.research-round-actions button')].find(button => button.textContent?.includes('第 2 轮'))!
    expect(start.disabled).toBe(true)
    expect(app.container.textContent).toContain('新增鉴定.pdf')
    expect(app.container.textContent).toContain('2026-10-10（用户登记）')
    const consent = app.container.querySelector<HTMLInputElement>('[aria-label="同意本轮使用所选项目内部资料进行AI分析"]')!
    await act(async () => Simulate.change(consent, { target: { checked: true } } as never))
    expect(start.disabled).toBe(false)
    await act(async () => start.click())
    await vi.waitFor(() => expect(app.container.querySelector('.decision-brief h3')?.textContent).toBe(newPacket.strategy!.headline))
    const request = app.transport.mock.calls.find(([url, init]) => String(url).endsWith('/research-rounds') && init?.method === 'POST')!
    expect(JSON.parse(String(request[1]!.body))).toEqual({ expected_context_version: 2, parent_round_id: 'r1', material_intake: 'provided', document_ids: ['首轮范围', '新增鉴定'], allow_internal_ai: true })
    expect(app.container.querySelector('[data-round-id=r1]')?.textContent).toContain(oldPacket.strategy!.headline)
    expect(app.container.querySelector('[data-round-id=r2]')?.textContent).toContain(newPacket.strategy!.headline)
    expect(app.container.querySelector('[aria-label="相对首轮的判断变化"]')?.textContent).toContain('新增鉴定明确了对象范围')
    expect(app.container.querySelector('[aria-label="下一轮建议补充资料"]')?.textContent).toContain('补充落实资金的文件')
    await act(async () => app.container.querySelector<HTMLButtonElement>('[data-direction-choice=comprehensive]')!.click())
    expect(app.container.querySelector('.research-rounds')).toBeNull()
    expect(app.container.querySelector('.strategy-plan-detail')?.textContent).not.toContain('拆建专项论证')
  } finally { await app.cleanup() }
})

test.each(['round-first', 'public-first'] as const)('a newer same-scope private result wins when responses arrive %s', async order => {
  const internal = structuredClone(newPacket), publicPlan = packet(2, '较旧公开结果')
  internal.created_at = '2026-10-15T09:00:00Z'; publicPlan.created_at = '2026-10-15T07:00:00Z'
  const history: ResearchRoundsResponse = { rounds: [round('r1', 1, oldPacket), round('r2', 2, internal, [addedMaterial])], materials: [addedMaterial], baseline_candidate: null }
  let finishPublic!: (result: StrategyPacket | null) => void, finishRounds!: (value: ResearchRoundsResponse) => void
  const legacy = new Promise<StrategyPacket | null>(resolve => { finishPublic = resolve }), savedRounds = new Promise<ResearchRoundsResponse>(resolve => { finishRounds = resolve })
  const app = await mount(history, publicPlan, internal, { legacy: order === 'round-first' ? legacy : undefined, rounds: order === 'public-first' ? savedRounds : undefined, waitForRounds: order !== 'public-first' })
  try {
    if (order === 'round-first') {
      await vi.waitFor(() => expect(app.container.querySelector('.decision-brief h3')?.textContent).toBe(internal.strategy!.headline))
      await act(async () => finishPublic(publicPlan))
    } else {
      await vi.waitFor(() => expect(app.container.querySelector('.decision-brief h3')?.textContent).toBe(publicPlan.strategy!.headline))
      await act(async () => finishRounds(history))
    }
    await vi.waitFor(() => expect(app.container.querySelector('.strategy-working')).toBeNull())
    expect(app.container.querySelector('.decision-brief h3')?.textContent).toBe(internal.strategy!.headline)
    expect(app.container.querySelector('.strategy-summary h3')?.textContent).toBe(internal.strategy!.headline)
    expect(app.transport.mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true)
  } finally { await app.cleanup() }
})

test('a freshly completed round replaces a public result only through its newer creation timestamp', async () => {
  const publicPlan = packet(2, '较新公开方案'), generated = packet(2, '刚生成的补充研判')
  publicPlan.created_at = '2026-10-15T10:00:00Z'; generated.created_at = '2026-10-15T11:00:00Z'
  const app = await mount({ rounds: [round('r1', 1, oldPacket, [previousMaterial])], materials: [previousMaterial, addedMaterial], baseline_candidate: null }, publicPlan, generated)
  try {
    expect(app.container.querySelector('.decision-brief h3')?.textContent).toBe(publicPlan.strategy!.headline)
    await act(async () => Simulate.change(app.container.querySelector<HTMLInputElement>('.research-internal-consent input')!, { target: { checked: true } } as never))
    await act(async () => app.container.querySelector<HTMLButtonElement>('.research-round-actions button')!.click())
    await vi.waitFor(() => expect(app.container.querySelector('.decision-brief h3')?.textContent).toBe(generated.strategy!.headline))
    expect(app.container.querySelector('[data-round-id=r1]')?.textContent).toContain(oldPacket.strategy!.headline)
    expect(app.container.querySelector('[data-round-id=r2]')?.textContent).toContain(generated.strategy!.headline)
  } finally { await app.cleanup() }
})

test.each(['round-first', 'public-first'] as const)('a newer public v6 plan wins over an adopted older round when responses arrive %s', async order => {
  const publicPlan = packet(2, '较新公开v6具体分项方案'), adopted = packet(2, '较旧已采纳v5方案')
  publicPlan.created_at = '2026-10-15T10:00:00Z'; adopted.created_at = '2026-10-15T08:00:00Z'
  publicPlan.strategy!.paths[0].work_packages = [{ id: 'V6-WATER', target: '本项目设施', target_basis: 'project_scope', source_id: 'SRC', quote: publicPlan.sources[0].text, locator: 'line:1', intervention: '更换破损管段并设置分段检修阀组', scope: '本期确认的供水设施范围', quantity: null, unit: null, quantity_basis: 'unknown', delivery: '分段试压合格后交付维护', priority: 'first', preconditions: ['核定楼栋和停水时段'], evidence_refs: ['SRC'] }]
  const history: ResearchRoundsResponse = { rounds: [{ ...round('adopted-old', 1, adopted), created_at: '2026-10-15T11:00:00Z', updated_at: '2026-10-15T11:00:00Z' }], materials: [], baseline_candidate: null }
  let finishPublic!: (value: StrategyPacket | null) => void, finishRounds!: (value: ResearchRoundsResponse) => void
  const publicResponse = new Promise<StrategyPacket | null>(resolve => { finishPublic = resolve }), roundsResponse = new Promise<ResearchRoundsResponse>(resolve => { finishRounds = resolve })
  const app = await mount(history, publicPlan, publicPlan, { legacy: order === 'round-first' ? publicResponse : undefined, rounds: order === 'public-first' ? roundsResponse : undefined, waitForRounds: order !== 'public-first' })
  try {
    if (order === 'round-first') {
      await vi.waitFor(() => expect(app.container.querySelector('.decision-brief h3')?.textContent).toBe(adopted.strategy!.headline))
      await act(async () => finishPublic(publicPlan))
    } else {
      await vi.waitFor(() => expect(app.container.querySelector('.decision-brief h3')?.textContent).toBe(publicPlan.strategy!.headline))
      await act(async () => finishRounds(history))
    }
    await vi.waitFor(() => expect(app.container.querySelector('.strategy-working')).toBeNull())
    expect(app.container.querySelector('.decision-brief h3')?.textContent).toBe(publicPlan.strategy!.headline)
    expect(app.container.querySelector('[data-round-id=adopted-old]')?.textContent).toContain(adopted.strategy!.headline)
    await act(async () => app.root.render(createElement(StrategyOverview, { project, demoActive: false, workspacePage: 'scheme', section: 'detail', schemeDirection: 'comprehensive', onEvidence: vi.fn(), onInvestigate: vi.fn() })))
    expect(app.container.querySelector('[data-work-package-id=V6-WATER]')?.textContent).toContain('更换破损管段')
    expect(app.transport.mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true)
  } finally { await app.cleanup() }
})

test('the shared intake form forwards user category and date to the original upload callback', async () => {
  const env = environment(), upload = vi.fn(async () => {})
  try {
    await act(async () => env.root.render(createElement(InternalMaterialIntake, { onUpload: upload, synthetic: true })))
    const category = env.container.querySelector<HTMLSelectElement>('[aria-label="内部资料类别"]')!, date = env.container.querySelector<HTMLInputElement>('[aria-label="资料形成日期"]')!, file = new File(['模拟鉴定'], '模拟材料.txt', { type: 'text/plain' })
    await act(async () => { Simulate.change(category, { target: { value: 'structural_assessment' } } as never); Simulate.change(date, { target: { value: '2026-10-12' } } as never) })
    const input = env.container.querySelector<HTMLInputElement>('[type=file]')!
    Object.defineProperty(input, 'files', { configurable: true, value: [file] })
    await act(async () => Simulate.change(input))
    expect(upload).toHaveBeenCalledWith(file, { material_category: 'structural_assessment', source_date: '2026-10-12' })
    expect(env.container.textContent).toContain('合成演示项目')
  } finally { await env.cleanup() }
})
