import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { parseHTML } from 'linkedom'
import type { Source } from '../../apps/host/generated/contracts'
import type { Project } from '../../apps/workspace/src/api'
import type { StrategyPacket } from '../../packages/retrofit/strategy'
import ProjectEvidenceDrawer, { type ProjectEvidenceDrawerProps } from '../../apps/workspace/src/components/ProjectEvidenceDrawer'

let root: Root, active: Element | null, trigger: HTMLButtonElement, fetchMock: ReturnType<typeof vi.fn>, mounted: boolean
const text = '现有供水管道老化，需先核对管线走向。'
const source = (extra: Partial<Source> = {}): Source => ({ id: 'S1', title: '对象调查资料', data_class: 'internal', visibility: 'internal', synthetic: false,
  untrusted_text: `调查记录。\n${text}\n下一步专项调查。`, hash: 'v-current', locator: 'document:D1', published_at: '2026-10-14',
  date_status: 'search_only', evidence_scope: 'object', object_refs: ['building:B1'], ...extra })
const project = (sources = [source()]): Project => ({ id: 'P1', name: '测试社区', context_version: 3,
  input: { project_id: 'P1', synthetic: false, sources } as Project['input'] })
const packet = (extra: Partial<StrategyPacket> = {}): StrategyPacket => ({ project_id: 'P1', context_version: 2, synthetic: false, created_at: '2026-10-13T10:00:00Z',
  sources: [{ id: 'P1:S1', title: '保存的结构调查', text: `历史记录。\n${text}\n历史后文。`, locator: 'page:2', role: 'current',
    document_version: 'v-saved', project_id: 'P1', data_class: 'internal', visibility: 'internal', source_date: '2026-10-01', published_at: null, url: null }],
  ...extra } as StrategyPacket)
const defaults = (): ProjectEvidenceDrawerProps => ({ open: true, project: project(), refs: ['S1'], onClose: vi.fn(), onOpenMaterials: vi.fn() })
const render = async (props: ProjectEvidenceDrawerProps) => { await act(async () => root.render(createElement(ProjectEvidenceDrawer, props))) }
const query = <T extends Element = HTMLElement>(selector: string) => document.querySelector<T>(selector)!
const key = async (value: string, shiftKey = false) => {
  const event = new window.Event('keydown', { bubbles: true, cancelable: true })
  Object.defineProperties(event, { key: { value }, shiftKey: { value: shiftKey } })
  await act(async () => document.dispatchEvent(event))
  return event
}

beforeEach(() => {
  const { window } = parseHTML('<!doctype html><html><body><button id="trigger">查看依据</button><div id="root"></div></body></html>')
  active = null
  Object.defineProperty(window.document, 'activeElement', { configurable: true, get: () => active })
  window.HTMLElement.prototype.focus = function() { active = this }
  for (const [name, value] of Object.entries({ window, document: window.document, HTMLElement: window.HTMLElement, Node: window.Node, IS_REACT_ACT_ENVIRONMENT: true })) vi.stubGlobal(name, value)
  fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock)
  trigger = window.document.getElementById('trigger') as unknown as HTMLButtonElement; trigger.focus()
  root = createRoot(window.document.getElementById('root')!); mounted = true
})
afterEach(async () => { if (mounted) await act(async () => root.unmount()); vi.unstubAllGlobals(); vi.restoreAllMocks() })

test('opens a body portal with source metadata and caller claim without fetching or changing input', async () => {
  const props = { ...defaults(), claim: '先核对供水条件', locator: '方案举措 1' }, original = JSON.stringify(props.project)
  await render(props)
  expect(query('[role="dialog"]').getAttribute('aria-modal')).toBe('true')
  expect(document.getElementById('root')!.querySelector('[role="dialog"]')).toBeNull()
  expect(query('.project-evidence-backdrop').parentElement).toBe(document.body)
  expect(query('.project-evidence-body').textContent).toContain('先核对供水条件')
  expect(query('.project-evidence-body').textContent).toContain('方案举措 1')
  expect(query('.project-evidence-metadata').textContent).toContain('document:D1')
  expect(query('.project-evidence-metadata').textContent).toContain('2026-10-14 · 仅检索日期')
  expect(query('.project-evidence-metadata').textContent).toContain('building:B1')
  expect(query('.project-evidence-metadata').textContent).toContain('内部资料 · 项目内部')
  expect(query('.project-evidence-original').textContent).toBe(source().untrusted_text)
  expect(active).toBe(query('[aria-label="关闭依据详情"]'))
  expect(fetchMock).not.toHaveBeenCalled(); expect(JSON.stringify(props.project)).toBe(original)
  expect(props.onOpenMaterials).not.toHaveBeenCalled()
})

test('same-project old packet wins over current text and uses its own saved version for exact highlighting', async () => {
  const saved = packet(), original = JSON.stringify(saved)
  await render({ ...defaults(), packet: saved, refs: [{ source_id: 'S1', quote: text, version: 'v-saved', claim: '保留历史判断', locator: 'page:2/paragraph:1' }] })
  await vi.waitFor(() => expect(query('mark')?.textContent).toBe(text))
  expect(query('.project-evidence-original').textContent).toBe(saved.sources[0].text)
  expect(query('.project-evidence-baseline').textContent).toContain('历史结果快照 · 资料 v2（当前资料 v3）')
  expect(query('.project-evidence-source').getAttribute('data-source-origin')).toBe('snapshot')
  expect(query('.project-evidence-metadata').textContent).toContain('v-saved')
  expect(query('.project-evidence-metadata').textContent).toContain('2026-10-01（未核验）')
  expect(query('.project-evidence-metadata').textContent).toContain('page:2/paragraph:1')
  expect(query('.project-evidence-source').textContent).toContain('保留历史判断')
  expect(document.body.textContent).not.toContain('v-current')
  expect(JSON.stringify(saved)).toBe(original)
})

test('old packets never replace a missing saved source with a current source under the same reference', async () => {
  await render({ ...defaults(), packet: packet({ sources: [] }) })
  expect(query('.project-evidence-source').textContent).toContain('当前资料不能代替历史原文')
  expect(document.querySelector('.project-evidence-original')).toBeNull()
  expect(document.body.textContent).not.toContain(source().untrusted_text)
})

test('foreign packet, inconsistent project input and foreign saved source are rejected without exposing their body', async () => {
  const props = defaults()
  await render({ ...props, packet: packet({ project_id: 'P2' }), claim: '其他项目判断' })
  expect(query('[role="alert"]').textContent).toContain('其他项目')
  expect(document.body.textContent).not.toContain('历史记录')
  expect(document.body.textContent).not.toContain('其他项目判断')
  expect(document.querySelector('.project-evidence-original')).toBeNull()
  await render({ ...props, project: { ...project(), input: { ...project().input, project_id: 'P2' } } })
  expect(query('[role="alert"]').textContent).toContain('其他项目')
  const saved = packet(); saved.sources[0].project_id = 'P2'
  await render({ ...props, packet: saved })
  expect(query('.project-evidence-source').textContent).toContain('该来源登记在其他项目')
  expect(document.body.textContent).not.toContain('历史记录')
  expect(document.querySelector('mark')).toBeNull()
})

test('exact same-project aliases work while a foreign namespace does not alias to a local source', async () => {
  await render({ ...defaults(), refs: [{ source_id: 'P1:S1', quote: text, version: 'v-current' }, 'P2:S1'] })
  await vi.waitFor(() => expect(query('mark')?.textContent).toBe(text))
  expect(document.querySelectorAll('.project-evidence-original')).toHaveLength(1)
  expect(query('[data-source-id="P2:S1"]').textContent).toContain('当前项目未保存此来源')
})

test.each([
  { version: 'v-old', quote: text, status: 'version-mismatch' },
  { version: 'v-current', quote: '管道已经全部更换。', status: 'quote-mismatch' },
  { version: undefined, quote: text, status: 'version-unverified' },
])('does not highlight an unchecked quote: $status', async ({ version, quote, status }) => {
  await render({ ...defaults(), refs: [{ source_id: 'S1', quote, version }] })
  await vi.waitFor(() => expect(query('[data-quote-check]')?.getAttribute('data-quote-check')).toBe(status))
  expect(document.querySelector('mark')).toBeNull()
  expect(query('.project-evidence-original').textContent).toBe(source().untrusted_text)
})

test('a saved source without document version cannot borrow the current hash to highlight', async () => {
  const saved = packet(); delete saved.sources[0].document_version
  await render({ ...defaults(), packet: saved, refs: [{ source_id: 'S1', version: 'v-current', quote: text }] })
  expect(query('[data-quote-check]').getAttribute('data-quote-check')).toBe('version-unverified')
  expect(query('.project-evidence-metadata').textContent).toContain('未保存来源版本')
  expect(document.querySelector('mark')).toBeNull()
})

test('Tab stays within the drawer, Escape closes, and controlled closing restores focus and body scrolling', async () => {
  document.body.style.overflow = 'clip'
  const props = defaults(); await render(props)
  expect(document.body.style.overflow).toBe('hidden')
  const close = query<HTMLButtonElement>('[aria-label="关闭依据详情"]'), last = query<HTMLButtonElement>('.project-evidence-footer button')
  expect((await key('Tab', true)).defaultPrevented).toBe(true); expect(active).toBe(last)
  expect((await key('Tab')).defaultPrevented).toBe(true); expect(active).toBe(close)
  trigger.focus(); await key('Tab'); expect(active).toBe(close)
  await key('Escape'); expect(props.onClose).toHaveBeenCalledOnce()
  await render({ ...props, open: false })
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(active).toBe(trigger); expect(document.body.style.overflow).toBe('clip')
})

test('only backdrop clicks close; explicit materials action receives its source without fetching', async () => {
  const props = defaults(); await render(props)
  await act(async () => query('.project-evidence-original').dispatchEvent(new window.Event('click', { bubbles: true })))
  expect(props.onClose).not.toHaveBeenCalled()
  await act(async () => query<HTMLButtonElement>('.project-evidence-materials').click())
  expect(props.onClose).toHaveBeenCalledOnce(); expect(props.onOpenMaterials).toHaveBeenCalledWith('S1')
  expect(fetchMock).not.toHaveBeenCalled()
  await act(async () => query('.project-evidence-backdrop').dispatchEvent(new window.Event('click', { bubbles: true })))
  expect(props.onClose).toHaveBeenCalledTimes(2)
})

test('unmount restores the original overflow and focus, and a disconnected trigger is safe', async () => {
  const props = defaults(); await render(props)
  await act(async () => root.unmount()); mounted = false
  expect(document.body.style.overflow || '').toBe(''); expect(active).toBe(trigger)
  root = createRoot(document.getElementById('root')!); mounted = true
  await render(props); trigger.remove()
  await act(async () => root.unmount()); mounted = false
  expect(document.body.style.overflow || '').toBe('')
})

test('switching projects clears prior highlighting and never renders a mismatched old packet', async () => {
  const props = { ...defaults(), refs: [{ source_id: 'S1', quote: text, version: 'v-current' }] }
  await render(props); await vi.waitFor(() => expect(query('mark')?.textContent).toBe(text))
  const other = { ...project(), id: 'P2', input: { ...project().input, project_id: 'P2', sources: [source({ untrusted_text: '另一个项目正文。', hash: 'v2' })] } }
  await render({ ...props, project: other, packet: packet() })
  expect(document.querySelector('mark')).toBeNull(); expect(document.querySelector('.project-evidence-original')).toBeNull()
})
