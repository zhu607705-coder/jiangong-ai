import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { Simulate } from 'react-dom/test-utils'
import { parseHTML } from 'linkedom'
import type { ExperienceCard, ExperienceEvidence } from '../../apps/host/generated/contracts'
import GlobalKnowledgeCatalog from '../../apps/workspace/src/components/GlobalKnowledgeCatalog'

const evidence: ExperienceEvidence = { document_id: 'DOC-HISTORICAL-ORIGINAL', version: 'a'.repeat(64), locator: 'page:3/paragraph:2', quote: '现场查验记录：一号楼雨季倒灌，先更新该楼排水接口。' }
const card = (kind: 'case' | 'rule' = 'case', overrides: Partial<ExperienceCard> = {}): ExperienceCard => ({
  id: `EXP-${kind}`, project_id: 'P-SOURCE-HISTORY', title: kind === 'case' ? '分楼栋排水改造复盘' : '排水接口核查规则', project_type: '老旧小区', development_mode: '综合整治', stage: '实施后复盘',
  status: 'approved', revision: 3, review_note: '按工程记录核实范围', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z',
  fields: [
    { key: 'decision_question', value: '先改哪栋楼的排水？', evidence: [evidence] },
    { key: 'key_conditions', value: '两栋楼雨污合流，须先核接口', evidence: [evidence] },
    { key: 'actual_decision', value: '先改造一号楼', evidence: [evidence] },
    { key: 'implementation', value: '一号楼管网更新完成', evidence: [evidence] },
    { key: 'outcome', value: '复查雨季未再倒灌', evidence: [evidence] },
    { key: 'applicability', value: '仅适用于已核查排水接口的楼栋', evidence: [evidence] },
  ],
  knowledge: { kind, origin: kind === 'case' ? 'project_case' : 'official_policy', measure_key: 'drainage', measure_name: '排水接口', conditions: [{ fact_kind: 'interface_verified', label: '接口完成核查', operator: 'eq', value: true, unit: null, source_value: '须先核接口', evidence: [evidence] }], exclusions: [], transfer_notes: ['逐栋核对接驳条件'], evidence_level: 'implementation_record' },
  ...overrides,
})
const results = (...cards: ExperienceCard[]) => ({ items: cards.map(value => ({ card: value, similar_conditions: [], important_differences: [], reuse_premises: ['保留分楼栋实施的原始范围'] })) })
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

async function mount(kind: 'case' | 'rule', transport: ReturnType<typeof vi.fn>, handlers: { onOpenProject: (projectId: string) => void; onEvidence?: (projectId: string, evidence: ExperienceEvidence) => void } = { onOpenProject: vi.fn() }) {
  const dom = parseHTML('<html><body><div id="root"></div></body></html>')
  vi.stubGlobal('window', dom.window); vi.stubGlobal('document', dom.document); vi.stubGlobal('Event', dom.window.Event); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('fetch', transport)
  const root = createRoot(dom.document.getElementById('root')!)
  const render = async (next: 'case' | 'rule') => { await act(async () => root.render(createElement(GlobalKnowledgeCatalog, { kind: next, ...handlers }))) }
  await render(kind)
  return { dom, render, handlers, close: async () => { await act(async () => root.unmount()) } }
}

function button(document: Document, text: string) {
  const found = [...document.querySelectorAll('button')].find(value => value.textContent === text)
  if (!found) throw new Error(`Missing button: ${text}`)
  return found
}

function expectReadsOnly(transport: ReturnType<typeof vi.fn>) {
  for (const [url, init] of transport.mock.calls) {
    expect(String(url)).toMatch(/^\/api\/experiences\/search\?/)
    const query = new URL(String(url), 'http://localhost').searchParams
    expect(query.has('project_id')).toBe(false); expect(query.has('exclude_project')).toBe(false)
    expect(query.get('limit')).toBe('100')
    expect(init.method).toBe('GET'); expect(init.body).toBeUndefined()
  }
}

describe('global reviewed case and rule catalogue', () => {
  it('loads real global cases without a current project, shows actual evidence, and opens the source project', async () => {
    const transport = vi.fn().mockResolvedValue(response(results(card(), card('case', { id: 'EXP-DRAFT', title: '未审核草稿', status: 'draft' }), card('rule'))))
    const view = await mount('case', transport)
    try {
      await vi.waitFor(() => expect(view.dom.document.querySelector('[data-card-id="EXP-case"]')).not.toBeNull())
      expect(transport).toHaveBeenCalledWith('/api/experiences/search?kind=case&synthetic=false&limit=100', expect.objectContaining({ method: 'GET', credentials: 'same-origin' }))
      const text = view.dom.document.body.textContent!
      expect(text).toContain('全局案例库'); expect(text).toContain('当前筛选 1 条（最多100条）')
      expect(text).toContain('P-SOURCE-HISTORY'); expect(text).toContain('已审核 · 修订 3')
      expect(text).toContain('先改造一号楼'); expect(text).toContain('一号楼管网更新完成'); expect(text).toContain('复查雨季未再倒灌')
      expect(text).toContain('仅适用于已核查排水接口的楼栋'); expect(text).toContain('须先核接口')
      expect(text).toContain(evidence.quote); expect(text).toContain(evidence.document_id); expect(text).toContain(evidence.version); expect(text).toContain(evidence.locator)
      expect(text).not.toContain('未审核草稿'); expect(text).not.toContain('排水接口核查规则')
      expect(text).not.toMatch(/匹配当前项目|新增草稿|生成研判/)
      expect([...view.dom.document.querySelectorAll('button')].some(value => value.textContent === '定位来源项目原文')).toBe(false)
      await act(async () => { button(view.dom.document as unknown as Document, '前往来源项目维护').click() })
      expect(view.handlers.onOpenProject).toHaveBeenCalledWith('P-SOURCE-HISTORY')
      expectReadsOnly(transport)
    } finally { await view.close() }
  })

  it('switches case/rule props and discards a late response from the previous global scope', async () => {
    let resolveCase!: (value: Response) => void
    const pendingCase = new Promise<Response>(resolve => { resolveCase = resolve })
    const transport = vi.fn().mockImplementation((url: string) => url.includes('kind=case') ? pendingCase : Promise.resolve(response(results(card('rule')))))
    const view = await mount('case', transport)
    try {
      await view.render('rule')
      await vi.waitFor(() => expect(view.dom.document.querySelector('[data-card-id="EXP-rule"]')).not.toBeNull())
      await act(async () => { resolveCase(response(results(card()))) })
      expect(view.dom.document.body.textContent).toContain('全局规则库')
      expect(view.dom.document.body.textContent).toContain('排水接口核查规则')
      expect(view.dom.document.body.textContent).not.toContain('分楼栋排水改造复盘')
      expect(transport.mock.calls.map(([url]) => url)).toEqual(['/api/experiences/search?kind=case&synthetic=false&limit=100', '/api/experiences/search?kind=rule&synthetic=false&limit=100'])
      expectReadsOnly(transport)
    } finally { await view.close() }
  })

  it('applies q and the historical review cutoff through the existing read endpoint', async () => {
    const transport = vi.fn().mockImplementation(async () => response(results(card())))
    const view = await mount('case', transport)
    try {
      const query = view.dom.document.getElementById('knowledge-case-query')!, date = view.dom.document.getElementById('knowledge-case-date')!
      await act(async () => { Simulate.change(query, { target: { value: '供水 居民' } } as never); Simulate.change(date, { target: { value: '2026-08-01' } } as never) })
      await act(async () => { Simulate.submit(view.dom.document.querySelector('form')!) })
      await vi.waitFor(() => expect(transport.mock.calls.length).toBe(2))
      const url = new URL(transport.mock.calls.at(-1)![0], 'http://localhost')
      expect(url.searchParams.get('q')).toBe('供水 居民'); expect(url.searchParams.get('as_of')).toBe('2026-08-01')
      await vi.waitFor(() => expect(view.dom.document.body.textContent).toContain('截至 2026-08-01 的审核历史版本'))
      expectReadsOnly(transport)
    } finally { await view.close() }
  })

  it('keeps synthetic demonstrations separate and clears real records while the new scope loads', async () => {
    let resolveSynthetic!: (value: Response) => void
    const synthetic = new Promise<Response>(resolve => { resolveSynthetic = resolve })
    const transport = vi.fn().mockImplementation((url: string) => url.includes('synthetic=true') ? synthetic : Promise.resolve(response(results(card()))))
    const view = await mount('case', transport)
    try {
      await vi.waitFor(() => expect(view.dom.document.querySelector('[data-card-id="EXP-case"]')).not.toBeNull())
      await act(async () => { Simulate.change(view.dom.document.getElementById('knowledge-case-scope')!, { target: { value: 'true' } } as never) })
      expect(view.dom.document.querySelector('[data-card-id="EXP-case"]')).toBeNull()
      expect(view.dom.document.body.textContent).toContain('模拟演示 · 独立范围')
      await act(async () => { resolveSynthetic(response(results(card('case', { id: 'SYN-CASE', project_id: 'P-SYNTHETIC', title: '模拟管网案例' })))) })
      await vi.waitFor(() => expect(view.dom.document.querySelector('[data-card-id="SYN-CASE"]')).not.toBeNull())
      expect(view.dom.document.body.textContent).not.toContain('分楼栋排水改造复盘')
      expect(transport.mock.calls.at(-1)![0]).toBe('/api/experiences/search?kind=case&synthetic=true&limit=100')
      expectReadsOnly(transport)
    } finally { await view.close() }
  })

  it('passes the exact original project and evidence to optional source navigation', async () => {
    const transport = vi.fn().mockResolvedValue(response(results(card('rule')))), onEvidence = vi.fn()
    const view = await mount('rule', transport, { onOpenProject: vi.fn(), onEvidence })
    try {
      await vi.waitFor(() => expect(view.dom.document.querySelector('[data-card-id="EXP-rule"]')).not.toBeNull())
      await act(async () => { button(view.dom.document as unknown as Document, '定位来源项目原文').click() })
      expect(onEvidence).toHaveBeenCalledWith('P-SOURCE-HISTORY', evidence)
      expectReadsOnly(transport)
    } finally { await view.close() }
  })

  it('retries a failed read without creating cards or invoking a model', async () => {
    const transport = vi.fn().mockResolvedValueOnce(response({ detail: '资料读取暂不可用' }, 503)).mockResolvedValueOnce(response(results()))
    const view = await mount('rule', transport)
    try {
      await vi.waitFor(() => expect(view.dom.document.body.textContent).toContain('资料读取暂不可用'))
      await act(async () => { button(view.dom.document as unknown as Document, '重新读取').click() })
      await vi.waitFor(() => expect(view.dom.document.body.textContent).toContain('当前范围没有符合条件的已审核记录'))
      expect(transport).toHaveBeenCalledTimes(2)
      expectReadsOnly(transport)
    } finally { await view.close() }
  })
})
