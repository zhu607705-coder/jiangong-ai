import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createElement, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { parseHTML } from 'linkedom'
import FloatingEvidenceSearch from '../../apps/workspace/src/imports/FloatingEvidenceSearch'
import RagEvidenceSearch from '../../apps/workspace/src/imports/RagEvidenceSearch'
import { api } from '../../apps/workspace/src/api'
import type { RetrievalResponse } from '../../packages/experience/retrieval'
import { retrievalFeatureLocations } from '../../apps/workspace/src/imports/retrieval-navigation'

vi.mock('../../apps/workspace/src/api', () => ({ api: vi.fn() }))
let root: Root, container: HTMLElement, active: Element | null
const response = (project = 'P-1'): RetrievalResponse => ({ project_id: project, question: '电梯托管费用', as_of: null,
  hits: [{ id: 'hit-1', document_id: 'D-1', version: 'doc-hash', locator: 'line:3', alias_locators: [], text: '最终将电梯托管费用降至每台每月300元。', file_name: '托管说明.txt',
    source: { id: 'S-1', title: '托管说明', data_class: 'public', visibility: 'public', synthetic: false, locator: 'document:D-1' },
    source_kind: 'public_original', source_date: null, measure_links: [], matched_measure_links: [], measure_mentions: [], stages: [], objects: [], review_statuses: [], match_reasons: [], score: 1 }],
  candidate_counts: { documents: 1, parsed_chunks: 1, eligible_chunks: 1, ranked_chunks: 1, batches: 1, unresolved_references: 0 },
  skipped: [], method: 'metadata_gated_bm25', score_meaning: '相关性', ranking_note: '', content_role: 'untrusted_source_material', fact_writes: 0,
  rank_query: '电梯托管费用', query_expansions: [],
})

beforeEach(() => {
  const { window } = parseHTML('<!doctype html><html><body><div id="root"></div></body></html>')
  active = null
  Object.defineProperty(window.document, 'activeElement', { configurable: true, get: () => active })
  window.HTMLElement.prototype.focus = function() { active = this }
  for (const [name, value] of Object.entries({ window, document: window.document, HTMLElement: window.HTMLElement, Node: window.Node, IS_REACT_ACT_ENVIRONMENT: true })) vi.stubGlobal(name, value)
  container = window.document.getElementById('root') as unknown as HTMLElement
  root = createRoot(container)
  vi.mocked(api).mockReset(); vi.mocked(api).mockResolvedValue(response())
  vi.stubGlobal('fetch',vi.fn(async(url:string,init:RequestInit)=>{
    const result=await api(url.replace(/^\/api/,''),JSON.parse(String(init.body)),init.signal as AbortSignal)
    return new Response(JSON.stringify({type:'complete',result})+'\n',{headers:{'Content-Type':'application/x-ndjson'}})
  }))
})
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals() })
const click = async (selector: string) => { const button = container.querySelector<HTMLButtonElement>(selector)!; expect(button).toBeTruthy(); await act(async () => button.click()); return button }
const mount = async (props: Parameters<typeof FloatingEvidenceSearch>[0] = {}) => { await act(async () => root.render(createElement(FloatingEvidenceSearch, props))) }

test('trigger opens an accessible nonmodal dialogue, focuses the question and Escape restores the trigger', async () => {
  await mount({ projectId: 'P-1', projectName: '测试社区' })
  expect(container.querySelector('[role="dialog"]')).toBeNull()
  const trigger = await click('.floating-evidence-trigger')
  const dialog = container.querySelector('[role="dialog"]')!
  expect(dialog.getAttribute('aria-modal')).toBe('false')
  expect(dialog.getAttribute('aria-labelledby')).toBeTruthy()
  expect(trigger.getAttribute('aria-expanded')).toBe('true')
  expect(active).toBe(container.querySelector('textarea'))
  const event = new window.Event('keydown', { cancelable: true }); Object.defineProperty(event, 'key', { value: 'Escape' })
  await act(async () => window.dispatchEvent(event))
  expect(container.querySelector('[role="dialog"]')).toBeNull(); expect(active).toBe(trigger)
  expect(trigger.getAttribute('aria-expanded')).toBe('false')
})

test('without a selected project it navigates or selects a project instead of querying an invented scope', async () => {
  const selectProject = vi.fn()
  await mount({ projects: [{ id: 'P-2', name: '社区二' }], onSelectProject: selectProject })
  await click('.floating-evidence-trigger')
  const select = container.querySelector('select')!
  for (const option of select.querySelectorAll('option')) option.removeAttribute('selected')
  const option = select.querySelector('option[value="P-2"]')!; option.setAttribute('selected', '')
  await act(async () => select.dispatchEvent(new window.Event('change', { bubbles: true })))
  expect(selectProject).toHaveBeenCalledWith('P-2'); expect(api).not.toHaveBeenCalled()
})

test('a materials navigation entry works when no project selector is supplied', async () => {
  const navigate = vi.fn(); await mount({ onOpenMaterials: navigate }); await click('.floating-evidence-trigger')
  await click('.floating-evidence-choose button')
  expect(navigate).toHaveBeenCalledOnce(); expect(container.querySelector('[role="dialog"]')).toBeNull()
})

test('natural language examples use the existing retrieval API without an implicit pipe-network filter', async () => {
  await mount({ projectId: 'P-1' }); await click('.floating-evidence-trigger')
  const examples = [...container.querySelectorAll<HTMLButtonElement>('.rag-floating-examples button')]
  await act(async () => examples.find(button => button.textContent === '电梯托管')!.click())
  await act(async () => container.querySelector('form')!.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })))
  expect(api).toHaveBeenCalledOnce()
  const [path, request] = vi.mocked(api).mock.calls[0]
  expect(path).toBe('/projects/P-1/knowledge/retrieve')
  expect(request).toMatchObject({ question: '电梯托管费用如何确定，有哪些管理措施？', include_ai: false, limit: 5 })
  expect(request).not.toHaveProperty('measure_key')
  expect(container.textContent).toContain('最终将电梯托管费用降至每台每月300元。')
})

test('a result carries its original document, version and locator to navigation and closes the window', async () => {
  const target = document.createElement('button'); document.body.appendChild(target)
  const locate = vi.fn(() => target.focus()); await mount({ projectId: 'P-1', onLocateHit: locate }); await click('.floating-evidence-trigger')
  await click('.rag-floating-examples button')
  await act(async () => container.querySelector('form')!.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })))
  await click('.rag-hit-actions button')
  expect(locate).toHaveBeenCalledWith(expect.objectContaining({ document_id: 'D-1', version: 'doc-hash', locator: 'line:3', source: expect.objectContaining({ id: 'S-1' }) }))
  expect(container.querySelector('[role="dialog"]')).toBeNull()
  expect(active).toBe(target)
})

test('switching projects waits for the owner project loader and hides the previous search scope', async () => {
  let finish!: () => void
  const loader = vi.fn(() => new Promise<void>(resolve => { finish = resolve }))
  await mount({ projectId: 'P-1', projects: [{ id: 'P-1', name: '社区一' }, { id: 'P-2', name: '社区二' }], onSelectProject: loader, openRequest: 1 })
  const select = container.querySelector<HTMLSelectElement>('[aria-label="悬浮检索项目"]')!
  for (const option of select.querySelectorAll('option')) option.removeAttribute('selected')
  select.querySelector('option[value="P-2"]')!.setAttribute('selected', '')
  await act(async () => select.dispatchEvent(new window.Event('change', { bubbles: true })))
  expect(loader).toHaveBeenCalledWith('P-2')
  expect(container.querySelector('textarea')).toBeNull()
  expect(container.textContent).toContain('正在读取所选项目资料')
  await mount({ projectId: 'P-2', projectName: '社区二', projects: [{ id: 'P-2', name: '社区二' }], onSelectProject: loader, openRequest: 1 })
  await act(async () => finish())
  expect(container.querySelector('textarea')!.value).toBe('')
  expect(container.querySelector('[role="dialog"]')).toBeTruthy()
  expect(api).not.toHaveBeenCalled()
})

test('external information-library requests open the window while project changes clear old questions and results', async () => {
  await mount({ projectId: 'P-1', openRequest: 0 }); expect(container.querySelector('[role="dialog"]')).toBeNull()
  await mount({ projectId: 'P-1', openRequest: 1 }); expect(container.querySelector('[role="dialog"]')).toBeTruthy()
  await click('.rag-floating-examples button')
  await act(async () => container.querySelector('form')!.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })))
  expect(container.textContent).toContain('托管说明.txt')
  await mount({ projectId: 'P-2', projectName: '社区二', openRequest: 1 })
  expect(container.querySelector('[role="dialog"]')).toBeTruthy(); expect(container.textContent).not.toContain('托管说明.txt')
  expect(container.querySelector('textarea')!.value).toBe('')
  expect(api).toHaveBeenCalledOnce()
})

test('late responses from a previous project cannot populate the newly selected project', async () => {
  let resolve!: (value: RetrievalResponse) => void
  vi.mocked(api).mockImplementation(() => new Promise(value => { resolve = value }) as never)
  await mount({ projectId: 'P-1', openRequest: 1 }); await click('.rag-floating-examples button')
  await act(async () => container.querySelector('form')!.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })))
  await mount({ projectId: 'P-2', openRequest: 1 })
  await act(async () => resolve(response('P-1')))
  expect(container.textContent).not.toContain('托管说明.txt'); expect(container.querySelector('textarea')!.value).toBe('')
})

test('full-page retrieval also starts with a natural-language question and no hidden supply filter', async () => {
  await act(async () => root.render(createElement(RagEvidenceSearch, { projectId: 'P-1' })))
  expect(container.querySelector('textarea')!.value).toBe('')
  expect(container.querySelector('select')!.value).toBe('')
  expect(container.textContent).toContain('围绕研判问题，检索可定位原文')
  expect(container.querySelector('[aria-label="当前检索范围"]')?.textContent).toContain('不限举措')
})

test('choosing a different question clears the previous hidden measure restriction', async () => {
  await mount({ projectId: 'P-1', openRequest: 1 })
  const select = container.querySelector<HTMLSelectElement>('[aria-label="RAG举措"]')!
  for (const option of select.querySelectorAll('option')) option.removeAttribute('selected')
  select.querySelector('option[value="pipe_network"]')!.setAttribute('selected', '')
  await act(async () => select.dispatchEvent(new window.Event('change', { bubbles: true })))
  expect(container.querySelector('[aria-label="当前检索范围"]')?.textContent).toContain('供水与管网')
  await act(async () => [...container.querySelectorAll<HTMLButtonElement>('.rag-floating-examples button')].find(button => button.textContent === '停车改善')!.click())
  await act(async () => container.querySelector('form')!.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })))
  expect(vi.mocked(api).mock.calls[0][1]).toMatchObject({ question: '现有资料记录了哪些停车和充电设施改善？' })
  expect(vi.mocked(api).mock.calls[0][1]).not.toHaveProperty('measure_key')
  expect(container.querySelector('[aria-label="当前检索范围"]')?.textContent).toContain('不限举措')
})

test('decision navigation uses supplied citation relationships and closes the floating window', async () => {
  const location = { id: 'dimension-supply', label: '现况评估 · 公共服务', relation: '该维度引用了此来源', tab: 'overview', kind: 'dimension', text: '公共服务' } as const
  const navigate = vi.fn()
  await mount({ projectId: 'P-1', openRequest: 1, decisionLocations: () => [location], onNavigateDecision: navigate })
  await click('.rag-floating-examples button')
  await act(async () => container.querySelector('form')!.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })))
  expect(container.textContent).toContain('命中依据')
  expect(container.textContent).toContain('该维度引用了此来源')
  await click('.rag-hit-decisions button')
  expect(navigate).toHaveBeenCalledWith(location)
  expect(container.querySelector('[role="dialog"]')).toBeNull()
})

test('a same-project revision change discards old hits and their navigation targets', async () => {
  let resolve!: (value: RetrievalResponse) => void
  vi.mocked(api).mockImplementation(() => new Promise(value => { resolve = value }) as never)
  await mount({ projectId: 'P-1', revision: 1, openRequest: 1 }); await click('.rag-floating-examples button')
  await act(async () => container.querySelector('form')!.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })))
  await mount({ projectId: 'P-1', revision: 2, openRequest: 1 })
  await act(async () => resolve(response('P-1')))
  expect(container.textContent).not.toContain('托管说明.txt')
  expect(container.querySelector('.rag-hit-actions')).toBeNull()
})

test('zero source hits can still offer an explicitly labelled existing feature, not a fabricated decision', async () => {
  const result = { ...response(), question: '更新资金由谁承担，投资和运营费用有什么依据？', hits: [] }
  vi.mocked(api).mockResolvedValue(result)
  const navigate = vi.fn()
  await mount({ projectId: 'P-1', openRequest: 1, featureLocations: retrievalFeatureLocations, onNavigateFeature: navigate })
  await act(async () => [...container.querySelectorAll<HTMLButtonElement>('.rag-floating-examples button')].find(button => button.textContent === '资金投入')!.click())
  await act(async () => container.querySelector('form')!.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })))
  expect(container.textContent).toContain('0条命中')
  expect(container.querySelector('[aria-label="相关功能入口"]')?.textContent).toContain('不表示已经检索到证据或形成了决策')
  await click('.rag-feature-shortcuts button')
  expect(navigate).toHaveBeenCalledWith(expect.objectContaining({ kind: 'cost-library' }))
  expect(container.querySelector('[role="dialog"]')).toBeNull()
})
