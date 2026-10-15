import { afterEach, expect, test, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { parseHTML } from 'linkedom'
import input from '../../fixtures/inputs/01_auto.json'
import App from '../../apps/workspace/src/App'
import { WorkbenchAccessContext } from '../../apps/workspace/src/AdminAccess'
import { projectRenewalModeInput } from '../../packages/retrofit/renewal-mode'
import type { Project } from '../../apps/workspace/src/api'
import type { StrategyPacket } from '../../packages/retrofit/strategy'
import type { RetrievalHit, RetrievalResponse } from '../../packages/experience/retrieval'

const apiMock = vi.hoisted(() => vi.fn())
vi.mock('../../apps/workspace/src/api', () => ({ api: apiMock, ADMIN_LOGIN_REQUIRED_EVENT: 'test-expired', ADMIN_LOGIN_REQUESTED_EVENT: 'test-login' }))
vi.mock('../../apps/workspace/src/components/WaitingScene', () => ({ default: () => null, WaitingMotif: () => null }))
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); apiMock.mockReset() })

test.each([
  { snapshotVersion: 'source-hash', quoteCheck: 'matched' },
  { snapshotVersion: undefined, quoteCheck: 'version-unverified' },
] as const)('the real workbench opens the shared quote drawer ($quoteCheck), returns to its page and navigates to the cited current assessment', async ({ snapshotVersion, quoteCheck }) => {
  const dom = parseHTML('<html><body><div id="root"></div></body></html>'), scrolled = vi.fn()
  const location = { href: 'http://example.test/?project=PUBLIC-SEARCH-PROJECT&view=overview', search: '?project=PUBLIC-SEARCH-PROJECT&view=overview' }
  const updateLocation = (_state: unknown, _unused: string, path: string) => { const url = new URL(path, 'http://example.test'); location.href = url.href; location.search = url.search }
  const history = { pushState: vi.fn(updateLocation), replaceState: vi.fn(updateLocation) }
  let active: Element | null = null
  const focusBefore = dom.window.HTMLElement.prototype.focus, scrollBefore = dom.window.HTMLElement.prototype.scrollIntoView
  Object.defineProperty(dom.document, 'activeElement', { configurable: true, get: () => active })
  dom.window.HTMLElement.prototype.focus = function () { active = this }
  dom.window.HTMLElement.prototype.scrollIntoView = scrolled
  const storage = new Map<string, string>()
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.document, location, history, HTMLElement: dom.window.HTMLElement, MutationObserver: dom.window.MutationObserver, IS_REACT_ACT_ENVIRONMENT: true,
    requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0), cancelAnimationFrame: clearTimeout,
    localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) } })) vi.stubGlobal(key, value)
  const quote = '电梯托管费用为每台每月300元。'
  const project = { id: 'PUBLIC-SEARCH-PROJECT', name: '项目检索演示', context_version: 0, runs: [], input: { ...structuredClone(input), project_id: 'PUBLIC-SEARCH-PROJECT', synthetic: false, business_profile: 'neighborhood', facts: [], context_rules: [], sources: [
    { id: 'PUBLIC-SOURCE', title: '电梯托管公开资料', hash: 'source-hash', locator: 'source:public-record', content_status: 'excerpt', untrusted_text: `社区运维情况。${quote}合同另行核对。`, data_class: 'public', visibility: 'public', synthetic: false },
  ] } } as unknown as Project
  const source = project.input.sources[0]
  const strategy: StrategyPacket = { project_id: project.id, context_version: 0, input_hash: 'strategy-hash', created_at: '2026-10-15T00:00:00Z', synthetic: false, status: 'completed', sources: [{ id: source.id, title: source.title, text: source.untrusted_text!, locator: source.locator!, role: 'current', url: null, published_at: null, document_version: snapshotVersion, visibility: source.visibility, data_class: source.data_class }],
    model_calls: [], decision: null, research: null, error: null, strategy: { headline: '先核维护与托管条件', summary: '建议核查托管安排。', preferred_mode: 'comprehensive', rationale: [], paths: [], next_checks: [], dimensions: [
      { key: 'operations', current: '已有托管费用记录', current_level: 'medium', comprehensive: '维护目标另行落实', comprehensive_level: 'medium', rebuild: '需另核新建维护费用', rebuild_level: 'unknown', evidence_refs: [source.id] },
    ] } }
  const hit: RetrievalHit = { id: 'SOURCE-HIT', document_id: source.id, evidence_kind: 'source_text', content_status: 'excerpt', version: 'source-hash', text: quote, locator: source.locator!, file_name: source.title, source,
    alias_locators: [], source_kind: 'public_original', source_date: null, measure_links: [], matched_measure_links: [], measure_mentions: [], stages: [], objects: [], review_statuses: [], match_reasons: ['当前项目已收集来源中的托管费用记录'], score: 1 }
  const retrieved: RetrievalResponse = { project_id: project.id, question: '电梯托管费用如何确定，有哪些管理措施？', rank_query: '电梯托管费用', query_expansions: [], as_of: null, hits: [hit], candidate_counts: { documents: 0, source_texts: 1, eligible_source_texts: 1, parsed_chunks: 1, eligible_chunks: 1, ranked_chunks: 1, batches: 1, unresolved_references: 0 }, skipped: [], method: 'metadata_gated_bm25', score_meaning: '相关性', ranking_note: '', content_role: 'untrusted_source_material', fact_writes: 0 }
  apiMock.mockImplementation((path: string) => {
    if (path === '/session') return Promise.resolve({ model_configured: false })
    if (path === '/projects') return Promise.resolve([project])
    if (path === '/projects/public-decisions') return Promise.resolve({ items: [] })
    if (path === `/projects/${project.id}`) return Promise.resolve(project)
    if (path.endsWith('/revision-diff')) return Promise.resolve({ available: false, changes: [] })
    if (path.endsWith('/followups') || path.endsWith('/documents')) return Promise.resolve([])
    if (path.includes('/renewal-strategy')) return Promise.resolve(strategy)
    if (path.endsWith('/renewal-mode')) return Promise.resolve({ screening: projectRenewalModeInput(project.input), decision: null })
    if (path === '/maps/config') return Promise.resolve({ configured: false })
    if (path.endsWith('/knowledge/retrieve')) return Promise.resolve(retrieved)
    if (path.endsWith('/knowledge/groups')) return Promise.resolve({ groups: [], documents: [] })
    if (path.endsWith('/knowledge/pipeline')) return Promise.resolve({ cards: [] })
    throw new Error(`Unexpected workbench request ${path}`)
  })
  const root = createRoot(dom.document.getElementById('root')!)
  const click = async (predicate: (button: HTMLButtonElement) => boolean, within: ParentNode = dom.document as unknown as Document) => {
    const button = [...within.querySelectorAll<HTMLButtonElement>('button')].find(predicate)
    expect(button).toBeTruthy()
    await act(async () => button!.dispatchEvent(new dom.window.Event('click', { bubbles: true })))
  }
  const search = async () => {
    await click(button => button.classList.contains('floating-evidence-trigger'))
    await click(button => button.textContent === '电梯托管', dom.document.querySelector('.floating-evidence-panel') as unknown as HTMLElement)
    await act(async () => dom.document.querySelector('.floating-evidence-panel form')!.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })))
    await vi.waitFor(() => expect(dom.document.querySelector('.floating-evidence-panel')?.textContent).toContain('现况评估 · 长效维护'))
  }
  try {
    await act(async () => root.render(createElement(WorkbenchAccessContext.Provider, { value: { role: 'viewer', canWrite: false } }, createElement(App))))
    await vi.waitFor(() => expect(dom.document.querySelector('.floating-evidence-trigger')).not.toBeNull())
    await vi.waitFor(() => expect(dom.document.querySelector('.project-overview')).not.toBeNull())
    const originalPage = dom.document.querySelector('.project-overview'), originalURL = location.href, navigationCount = history.pushState.mock.calls.length
    const scrollContainer = dom.document.querySelector<HTMLElement>('.research-drawer-scroll')!
    scrollContainer.scrollTop = 240
    dom.document.body.style.overflow = 'auto'
    await search()
    await click(button => button.textContent?.includes('定位这段原文') || false)
    await vi.waitFor(() => {
      const drawer = dom.document.querySelector('.project-evidence-drawer')!
      expect(drawer?.getAttribute('role')).toBe('dialog')
      expect(drawer?.querySelector('.project-evidence-cited blockquote')?.textContent).toBe(quote)
      expect(drawer?.querySelector('[data-quote-check]')?.getAttribute('data-quote-check')).toBe(quoteCheck)
    })
    const drawer = dom.document.querySelector('.project-evidence-drawer')!, row = drawer.querySelector('[data-source-id="PUBLIC-SOURCE"]')!
    const metadata = (label: string) => [...row.querySelectorAll('.project-evidence-metadata>div')].find(item => item.querySelector('dt')?.textContent === label)?.querySelector('dd')?.textContent
    expect(row.getAttribute('data-source-origin')).toBe('snapshot')
    expect(row.querySelector('h3')?.textContent).toBe(source.title)
    expect(row.querySelector('.project-evidence-original')?.textContent).toBe(source.untrusted_text)
    expect(metadata('来源定位')).toBe(source.locator)
    expect(metadata('引用位置')).toBe(hit.locator)
    expect(metadata('引用版本')).toBe(hit.version)
    expect(metadata('来源版本')).toBe(snapshotVersion || '未保存来源版本')
    expect(metadata('资料类别')).toBe('公开资料 · 公开来源')
    expect(metadata('结果基准')).toContain(`项目 ${project.id} · 资料 v0`)
    if (quoteCheck === 'matched') expect(row.querySelector('.project-evidence-original mark')?.textContent).toBe(quote)
    else {
      expect(row.querySelector('.project-evidence-original mark')).toBeNull()
      expect(row.querySelector('[data-quote-check]')?.textContent).toContain('未高亮')
    }
    expect(active).toBe(drawer.querySelector('[aria-label="关闭依据详情"]'))
    expect(location.href).toBe(originalURL)
    expect(dom.document.querySelector('[data-project-page="overview"]')?.getAttribute('aria-current')).toBe('page')
    expect(dom.document.body.style.overflow).toBe('hidden')
    await click(button => button.getAttribute('aria-label') === '关闭依据详情', drawer)
    await vi.waitFor(() => expect(dom.document.querySelector('.project-evidence-drawer')).toBeNull())
    expect(location.href).toBe(originalURL)
    expect(history.pushState.mock.calls).toHaveLength(navigationCount)
    expect(dom.document.querySelector('.project-overview')).toBe(originalPage)
    expect(scrollContainer.scrollTop).toBe(240)
    expect(dom.document.body.style.overflow).toBe('auto')
    await search()
    await click(button => button.textContent?.includes('现况评估 · 长效维护') || false)
    await vi.waitFor(() => {
      const target = dom.document.querySelector('.strategy-current-assessment .dimension-readout button[data-retrieval-focused="true"]')
      expect(target?.querySelector('span')?.textContent).toBe('长效维护')
      expect(target?.querySelector('strong')?.textContent).toBe('3.0')
      expect(active).toBe(target)
    })
    await click(button => button.getAttribute('data-retrieval-focused') === 'true', dom.document.querySelector('.strategy-current-assessment .dimension-readout')!)
    expect(dom.document.querySelector('.strategy-current-assessment .dimension-detail strong')?.textContent).toBe('长效维护')
    expect(dom.document.querySelector('.strategy-current-assessment .dimension-detail p')?.textContent).toBe('已有托管费用记录')
    expect(dom.document.querySelector('.strategy-current-assessment .dimension-detail button')?.textContent).toBe('查看依据 ↗')
    expect(dom.document.querySelector('[data-project-page="assessment"]')?.getAttribute('aria-current')).toBe('page')
    expect(dom.document.querySelector('[data-retrieval-awaiting-direction]')).toBeNull()
    expect(dom.document.querySelector('.strategy-workspace')?.getAttribute('data-selected-direction')).toBe('')
    expect(new URL(location.href).searchParams.get('view')).toBe('assessment')
    expect(new URL(location.href).searchParams.get('section')).toBe('current')
    expect(new URL(location.href).searchParams.has('scheme')).toBe(false)
    expect(scrolled).toHaveBeenCalledWith({ block: 'center', behavior: 'auto' })
    expect(apiMock.mock.calls.filter(([, body]) => body !== undefined).every(([path]) => path.endsWith('/knowledge/retrieve'))).toBe(true)
  } finally {
    await act(async () => root.unmount())
    dom.window.HTMLElement.prototype.focus = focusBefore; dom.window.HTMLElement.prototype.scrollIntoView = scrollBefore
  }
})
