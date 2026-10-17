import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Simulate } from 'react-dom/test-utils'
import { parseHTML } from 'linkedom'
import input from '../../fixtures/inputs/01_auto.json'
import type { Project } from '../../apps/workspace/src/api'
import type { StrategyPacket } from '../../packages/retrofit/strategy'
import type { ResearchRound } from '../../packages/retrofit/research-rounds'
import ProjectTasksPage, { buildProjectTasks, type ProjectTasksPageProps } from '../../apps/workspace/src/components/ProjectTasksPage'
import {taskObjectApplicability} from '../../packages/retrofit/project-tasks'

const project: Project = { id: 'TASK-P', name: '调查测试社区', context_version: 2, input: { ...input, project_id: 'TASK-P', synthetic: false, sources: [] } as Project['input'] }
function packet(version = 2): StrategyPacket {
  return { project_id: project.id, context_version: version, input_hash: `hash-${version}`, created_at: '2026-10-15T08:00:00Z', synthetic: false, status: 'completed', error: null,
    sources: ['S1', 'S2'].map(id => ({ id, title: `当轮材料${id}`, text: '需要核实项目条件。', locator: 'page:2', url: null, role: 'current' as const, published_at: '2026-10-10' })), decision: null, model_calls: [], research: null,
    strategy: { headline: '按资料安排调查', summary: '先核实结构、资金和居民需求。', preferred_mode: 'comprehensive', rationale: [], paths: [], dimensions: [],
      next_checks: [{ title: '结构资料', detail: '补充逐栋结构鉴定报告，核实工程范围。', evidence_refs: ['S1'] }, { title: '原拆原建安置条件', detail: '取得安置与居民决议文件。', evidence_refs: ['S2'] }, { title: '资金落实', detail: '补充落实资金文件。', evidence_refs: ['S1'] }, { title: '运营排班', detail: '补充现有中心排班表。', evidence_refs: ['S1'] }, { title: '居民需求', detail: '补充居民需求调查与服务使用情况。', evidence_refs: [] }],
      round_review: { summary: '部分条件仍需项目资料核实。', changes: [], missing_materials: [{ topic: '结构资料', request: '补充逐栋结构鉴定报告，核实工程范围。', reason: '决定本期保留建筑的施工范围。', evidence_refs: ['S2'] }, { topic: '满意度调查', request: '取得居民满意度问卷和样本说明。', reason: '明确居民反馈及服务优先级。', evidence_refs: [] }] } } }
}
function round(number: number, result: StrategyPacket): ResearchRound {
  return { id: `r${number}`, project_id: project.id, round_number: number, context_version: result.context_version, input_hash: result.input_hash, parent_round_id: null, parent_input_hash: null, parent_context_version: null, first_round_id: 'r1', first_input_hash: 'hash-1', first_context_version: 1, origin: 'generated', status: 'completed', material_intake: 'none', allow_internal_ai: false, materials: [], missing_materials: result.strategy!.round_review!.missing_materials, result, error: null, created_at: result.created_at, updated_at: result.created_at }
}
function collectionPacket() {
  const value = packet(), strategy = value.strategy!
  strategy.paths = (['comprehensive', 'rebuild'] as const).map((mode, index) => ({ mode, title: `${mode}方案`, description: '沿用本方向分项。', actions: [], requirements: [], work_packages: [{ id: index ? 'NEW-DINER' : 'LIFT-29', target: index ? '拟新建社区中心' : '29幢既有电梯', target_basis: 'project_scope', source_id: 'S1', quote: '需要核实项目条件。', locator: 'page:2', intervention: '按资料核实分项', scope: '本对象范围', quantity: null, unit: null, quantity_basis: 'unknown', delivery: '形成分项资料', priority: 'first', preconditions: [], evidence_refs: ['S1'] }] }))
  strategy.internal_data_requests = [
    { id: 'WELLBEING', key: 'resident_wellbeing', metric: '居民幸福度', purpose: '识别居民生活改善需求。', collection_method: '采用同一量表问卷并登记样本与访问日期。', unit: '量表得分', period: '本轮研判前的调查期', denominator: '有效受访居民，保留拒访与缺失说明', related_package_ids: [], evidence_refs: [] },
    { id: 'LIFT', key: 'elevator_usage', metric: '电梯利用率', purpose: '核实既有电梯的实际服务使用。', collection_method: '取得29幢电梯使用记录，按观察日汇总。', unit: '乘梯人次/日', period: '最近一个完整观察月', denominator: '有完整计数记录的开放日', related_package_ids: ['LIFT-29'], evidence_refs: ['S1'] },
    { id: 'MEAL', key: 'meal_attendance', metric: '食堂就餐人数', purpose: '核实社区中心助餐需求。', collection_method: '登记供餐时段与居民匿名标识，月内去重。', unit: '人/月', period: '计划运营月份', denominator: '该月开放供餐时段内服务居民', related_package_ids: ['NEW-DINER'], evidence_refs: ['S2'] },
  ]
  return value
}
let root: Root, active: Element | null, storage: Map<string, string>, fetchMock: ReturnType<typeof vi.fn>
const key = `hzz-strategy-investigations:${project.id}`
const defaults = (): ProjectTasksPageProps => ({ project, packet: packet(), onEvidence: vi.fn(), onSupplement: vi.fn() })
const query = <T extends Element = HTMLElement>(selector: string) => document.querySelector<T>(selector)!
const render = (props: ProjectTasksPageProps) => act(async () => root.render(createElement(ProjectTasksPage, props)))
beforeEach(() => {
  const { window } = parseHTML('<!doctype html><html><body><div id="root"></div></body></html>')
  active = null; Object.defineProperty(window.document, 'activeElement', { configurable: true, get: () => active })
  window.HTMLElement.prototype.focus = function () { active = this }
  storage = new Map([[key, JSON.stringify({ 'hash-2:0': 'material_received', untouched: 'in_progress' })]])
  for (const [name, value] of Object.entries({ window, document: window.document, HTMLElement: window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true, localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) } })) vi.stubGlobal(name, value)
  fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock)
  root = createRoot(window.document.getElementById('root')!)
})
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); vi.restoreAllMocks() })

test('separates foreign-object legacy tasks from current object checks without changing stored IDs or locking material upload',async()=>{
 const value=packet(),localProject={...project,input:{...project.input,scope:{...project.input.scope,name:'建工新村',city:'天津市'}}}
 value.sources[0].object_binding={policy:'object-context-v1',project_id:project.id,city:'天津市',relation:'different_object',basis:'explicit_location_conflict',reason:'该资料记载杭州，当前项目登记为天津市。'}
 value.sources[0].role='reference'
 value.strategy!.next_checks=[{title:'居民户数核查',detail:'上传杭州4幢住宅、322户台账。',evidence_refs:['S1']}]
 value.content_review={policy:'advisory-v1',status:'needs_review',checked_at:value.created_at,issues:[{code:'OBJECT_LOCATION_CONFLICT',path:'sources.S1',message:'对象地点冲突'}],follow_up:{search_queries:['天津市 建工新村 项目地址 工程范围'],reading_focus:[],internal_data:[]}}
 const original=JSON.stringify(value),ids=buildProjectTasks(value).map(t=>t.id)
 await render({project:localProject,packet:value,onEvidence:vi.fn(),onSupplement:vi.fn(),onUploadTask:vi.fn()})
 expect(query('.project-task-object-notice').textContent).toContain('天津市')
 expect(query('.project-task-featured').textContent).toContain('项目地址')
 expect(query('.project-task-featured').textContent).not.toContain('322户')
 expect(query('.project-task-object-review').textContent).toContain('旧报告调查 · 核对适用范围')
 expect(query('.project-task-object-review').textContent).not.toContain('322户')
 await act(async()=>query<HTMLButtonElement>('.project-task-object-review button[data-task-id]').click())
 expect(query('[role=dialog]').textContent).toContain('旧报告原始要求 · 对象待核')
 expect(query('[role=dialog]').textContent).toContain('322户')
 expect(query('[role=dialog]').textContent).toContain('异地参考')
 expect(query('[role=dialog]').textContent).toContain('该资料记载杭州')
 expect(query('[role=dialog] input[type=file]')).not.toBeNull()
 expect(buildProjectTasks(value).map(t=>t.id)).toEqual(ids);expect(JSON.stringify(value)).toBe(original)
})

test('carries foreign-object provenance through an internal task related package even without direct task refs',()=>{
 const value=collectionPacket()
 value.sources[0].object_binding={policy:'object-context-v1',project_id:project.id,city:'天津市',relation:'different_object',basis:'explicit_location_conflict',reason:'原楼栋属于杭州案例'}
 const task=buildProjectTasks(value).find(task=>task.internal_data?.id==='LIFT')!
 task.evidence_refs=[]
 expect(taskObjectApplicability(value,task)).toMatchObject({state:'foreign_reference',reason:'原楼栋属于杭州案例'})
 const projectTask=buildProjectTasks(value).find(task=>task.internal_data?.id==='WELLBEING')!
 expect(taskObjectApplicability(value,projectTask).state).toBe('unflagged')
})

test('tasks merge exact API duplicates without changing original text or legacy progress indices', () => {
  const value = packet(), original = JSON.stringify(value)
  const all = buildProjectTasks(value), selected = buildProjectTasks(value, 'comprehensive')
  expect(all).toHaveLength(6); expect(selected).toHaveLength(5)
  expect(selected.some(task => task.title.includes('原拆原建'))).toBe(false)
  expect(selected[0]).toMatchObject({ id: 'hash-2:0', kinds: ['next_check', 'missing_material'], evidence_refs: ['S1', 'S2'], reason: '决定本期保留建筑的施工范围。' })
  expect(selected.find(task => task.title === '资金落实')!.id).toBe('hash-2:2')
  expect(selected.find(task => task.title === '满意度调查')!.id).toMatch(/^hash-2:missing:/)
  expect(JSON.stringify(value)).toBe(original)
})

test('current page shows three key tasks plus visible remainder, keeps legacy local progress and returns focus after Escape', async () => {
  const props = { ...defaults(), direction: 'comprehensive' as const }
  await render(props)
  expect(document.querySelectorAll('.project-task-featured > button')).toHaveLength(3)
  expect(document.querySelectorAll('.project-task-remaining > button')).toHaveLength(2)
  expect(document.querySelector('details')).toBeNull()
  const trigger = query<HTMLButtonElement>('[data-task-id="hash-2:0"]'); trigger.focus()
  expect(trigger.textContent).toContain('材料已取得')
  await act(async () => trigger.click())
  expect(document.getElementById('root')!.querySelector('[role="dialog"]')).toBeNull()
  expect(query('.project-task-drawer-body').textContent).toContain('决定本期保留建筑的施工范围')
  expect(query('.project-task-drawer-body').textContent).toContain('本机浏览器')
  const select = query<HTMLSelectElement>('.project-task-progress-editor select')
  await act(async () => Simulate.change(select, { target: { value: 'in_progress' } } as never))
  const saved = JSON.parse(storage.get(key)!)
  expect(saved['hash-2:0']).toBe('in_progress'); expect(saved.untouched).toBe('in_progress')
  const escape = new window.Event('keydown', { bubbles: true, cancelable: true }); Object.defineProperty(escape, 'key', { value: 'Escape' })
  await act(async () => document.dispatchEvent(escape))
  expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(active).toBe(trigger)
  expect(fetchMock).not.toHaveBeenCalled()
})

test('a new missing item uses its own key and evidence opens the exact supplied packet', async () => {
  const props = defaults(); await render(props)
  const missing = buildProjectTasks(props.packet).find(task => task.title === '满意度调查')!
  const trigger = [...document.querySelectorAll<HTMLButtonElement>('.project-task-card')].find(button => button.getAttribute('data-task-id') === missing.id)!
  await act(async () => trigger.click())
  await act(async () => Simulate.change(query('.project-task-progress-editor select'), { target: { value: 'material_received' } } as never))
  expect(JSON.parse(storage.get(key)!)[missing.id]).toBe('material_received')
  expect(JSON.parse(storage.get(key)!)['hash-2:0']).toBe('material_received')
  await act(async () => query<HTMLButtonElement>('[aria-label="关闭调查任务详情"]').click())
  await act(async () => query<HTMLButtonElement>('[data-task-id="hash-2:0"]').click())
  const evidence = [...document.querySelectorAll<HTMLButtonElement>('.project-task-drawer button')].find(button => button.textContent?.includes('查看当轮引用原文'))!
  await act(async () => evidence.click())
  expect(props.onEvidence).toHaveBeenCalledWith(['S1', 'S2'], props.packet)
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  await act(async () => query<HTMLButtonElement>('.project-tasks-heading .project-task-primary').click())
  expect(props.onSupplement).toHaveBeenCalledTimes(1)
})

test('history keeps old requests read only and ignores another project or synthetic scope', async () => {
  const current = packet(), old = packet(1); old.strategy!.next_checks[0].title = '首轮旧结构调查'
  const foreign = round(3, { ...packet(3), project_id: 'OTHER' }); foreign.result!.strategy!.next_checks[0].title = '外项目秘密'
  const synthetic = round(4, { ...packet(4), synthetic: true }); synthetic.result!.strategy!.next_checks[0].title = '模拟范围任务'
  const props = { ...defaults(), packet: current, section: 'history' as const, rounds: [round(1, old), round(2, current), foreign, synthetic] }
  const before = storage.get(key)
  await render(props)
  expect(query('.project-task-history-selector').textContent).toContain('第 1 轮')
  expect(document.body.textContent).not.toContain('第 2 轮'); expect(document.body.textContent).not.toContain('外项目秘密'); expect(document.body.textContent).not.toContain('模拟范围任务')
  await act(async () => query<HTMLButtonElement>('[data-task-id="hash-1:0"]').click())
  expect(query('.project-task-progress-editor').textContent).toContain('历史记录只读')
  expect(document.querySelector('.project-task-progress-editor select')).toBeNull()
  expect(document.querySelector('.project-task-drawer footer .project-task-primary')).toBeNull()
  expect(storage.get(key)).toBe(before); expect(fetchMock).not.toHaveBeenCalled()
})

test('internal collection tasks follow the selected work packages and keep unlinked requests at project scope', () => {
  const value = collectionPacket(), original = JSON.stringify(value)
  const internal = (direction?: 'comprehensive' | 'rebuild') => buildProjectTasks(value, direction).filter(task => task.internal_data)
  expect(internal().map(task => task.internal_data!.id)).toEqual(['WELLBEING', 'LIFT', 'MEAL'])
  expect(internal('comprehensive').map(task => task.id)).toEqual(['hash-2:internal:WELLBEING', 'hash-2:internal:LIFT'])
  expect(internal('rebuild').map(task => task.id)).toEqual(['hash-2:internal:WELLBEING', 'hash-2:internal:MEAL'])
  expect(internal('comprehensive')[0].internal_data?.scope).toBe('project')
  expect(internal('comprehensive')[1].internal_data?.related_objects).toEqual(['29幢既有电梯'])
  expect(JSON.stringify(value)).toBe(original)
})

test('collection drawer shows the recorded measurement fields and updates only its independent internal progress key', async () => {
  await render({ ...defaults(), packet: collectionPacket(), direction: 'comprehensive' })
  expect(document.body.textContent).not.toContain('食堂就餐人数')
  await act(async () => query<HTMLButtonElement>('[data-task-id="hash-2:internal:LIFT"]').click())
  const scope = query('.project-task-collection-scope')
  expect(scope.textContent).toContain('核实既有电梯的实际服务使用')
  expect(scope.textContent).toContain('取得29幢电梯使用记录')
  expect(scope.textContent).toContain('乘梯人次/日')
  expect(scope.textContent).toContain('最近一个完整观察月')
  expect(scope.textContent).toContain('有完整计数记录的开放日')
  expect(scope.textContent).toContain('29幢既有电梯')
  await act(async () => Simulate.change(query('.project-task-progress-editor select'), { target: { value: 'in_progress' } } as never))
  const saved = JSON.parse(storage.get(key)!)
  expect(saved['hash-2:internal:LIFT']).toBe('in_progress')
  expect(saved['hash-2:0']).toBe('material_received')
  expect(saved['hash-2:internal:MEAL']).toBeUndefined()
  expect(fetchMock).not.toHaveBeenCalled()
})
