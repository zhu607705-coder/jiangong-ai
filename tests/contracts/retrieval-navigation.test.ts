import { afterEach, expect, test, vi } from 'vitest'
import { parseHTML } from 'linkedom'
import { createHash, webcrypto } from 'node:crypto'
import type { Source } from '../../apps/host/generated/contracts'
import type { RetrievalHit } from '../../packages/experience/retrieval'
import type { StrategyPacket } from '../../packages/retrofit/strategy'
import { findRetrievalDecisionElement, findRetrievalFeatureElement, focusRetrievalElement, retrievalDecisionLocations, retrievalFeatureLocations, sourceHitFocus } from '../../apps/workspace/src/imports/retrieval-navigation'

afterEach(() => vi.restoreAllMocks())
const text = '电梯托管费用降至每台每月300元。'
const hit = { source: { id: 'S-1' }, version: 'h1', text } as RetrievalHit
const source = { id: 'S-1', hash: 'h1', untrusted_text: `项目情况。${text}后续继续维护。` } as Source
const strategy = { project_id: 'P1', synthetic: false, sources: [{ id: 'P1:S-1', text }], strategy: {
  rationale: [{ source_id: 'P1:S-1', point: '改善维护安排', quote: text }],
  paths: [{ mode: 'comprehensive', actions: [{ title: '托管电梯', evidence_refs: ['P1:S-1'] }] }],
  dimensions: [{ key: 'operations', evidence_refs: ['P1:S-1'] }], next_checks: [{ title: '核对托管合同', evidence_refs: ['P1:S-1'] }],
} } as unknown as StrategyPacket

test('saved citations determine decision, assessment and investigation links rather than question keywords', () => {
  const links = retrievalDecisionLocations(hit, 'P1', strategy, null)
  expect(links.map(row => row.kind)).toEqual(['rationale', 'action', 'dimension', 'investigation'])
  expect(links[0].relation).toContain('原文重合')
  expect(links[2].label).toBe('现况评估 · 长效维护')
  expect(retrievalDecisionLocations({ ...hit, source: { ...source, id: 'UNRELATED' } }, 'P1', strategy, null)).toEqual([])
  expect(retrievalDecisionLocations(hit, 'OTHER-PROJECT', strategy, null)).toEqual([])
})

test('only explicit source aliases can bridge same-project source copies', () => {
  expect(retrievalDecisionLocations({ ...hit, source: { ...source, id: 'PRIMARY' }, source_aliases: ['S-1'] }, 'P1', strategy, null)).toHaveLength(4)
  expect(retrievalDecisionLocations({ ...hit, source: { ...source, id: 'PRIMARY' }, source_aliases: ['OTHER:S-1'] }, 'P1', strategy, null)).toEqual([])
})

test('public source highlighting preserves literal text and rejects other versions or quotes', async () => {
  expect(await sourceHitFocus(source, hit)).toEqual({ status: 'matched', before: '项目情况。', quote: text, after: '后续继续维护。' })
  expect(await sourceHitFocus(source, { ...hit, version: 'old-hash' })).toEqual({ status: 'version-mismatch' })
  expect(await sourceHitFocus(source, { ...hit, text: '每台每月200元。' })).toEqual({ status: 'quote-mismatch' })
})

test('an unregistered source hash is checked against the complete body, including on an HTTP IP page', async () => {
  const body = `  社区情况。\n${text}\n`, current = { ...source, hash: undefined, untrusted_text: body }
  const saved = { ...hit, text: body, evidence_kind: 'source_text' as const, version_origin: 'text_sha256' as const, version: createHash('sha256').update(body).digest('hex') }
  expect((await sourceHitFocus(current, saved, {})).status).toBe('matched')
  expect(await sourceHitFocus({ ...current, untrusted_text: body + '新增内容' }, saved, {})).toEqual({ status: 'version-mismatch' })
  expect(await sourceHitFocus({ ...current, untrusted_text: body.trim() }, saved, {})).toEqual({ status: 'version-mismatch' })
  expect(await sourceHitFocus(current, { ...saved, text }, {})).toEqual({ status: 'version-mismatch' })
  expect(await sourceHitFocus(current, { ...saved, version_origin: undefined }, {})).toEqual({ status: 'version-unverified' })
  expect((await sourceHitFocus(current, saved, webcrypto as unknown as Crypto)).status).toBe('matched')
  expect(await sourceHitFocus({ ...current, untrusted_text: body + '新增内容' }, saved, webcrypto as unknown as Crypto)).toEqual({ status: 'version-mismatch' })
})

test('focusing a located quote expands every parent details before scrolling and focusing the actual element', () => {
  const { document } = parseHTML('<details id="outer"><summary>材料</summary><details id="inner"><summary>原文</summary><mark id="quote">每月300元</mark></details></details>')
  const target = document.getElementById('quote')!, focus = vi.fn(), scroll = vi.fn()
  target.focus = focus; target.scrollIntoView = scroll
  focusRetrievalElement(target as unknown as HTMLElement)
  expect((document.getElementById('outer') as unknown as HTMLDetailsElement).open).toBe(true)
  expect((document.getElementById('inner') as unknown as HTMLDetailsElement).open).toBe(true)
  expect(scroll).toHaveBeenCalledWith({ block: 'center', behavior: 'auto' })
  expect(focus).toHaveBeenCalledWith({ preventScroll: true })
  expect(target.getAttribute('data-retrieval-focused')).toBe('true')
})

test('decision lookup activates the required inner tab and only returns an actual matching row', () => {
  const { document } = parseHTML('<section class="strategy-overview" data-selected-direction="comprehensive"><nav class="strategy-subnav"><button aria-current="page">方案总览</button><button id="assessment">现况与改后评估</button></nav><div class="strategy-dimension-cards"><article>长效维护</article></div></section>')
  const location = retrievalDecisionLocations(hit, 'P1', strategy, null).find(row => row.kind === 'dimension')!
  const tab = document.getElementById('assessment')!, click = vi.fn(() => tab.setAttribute('aria-current', 'page'))
  tab.click = click
  expect(findRetrievalDecisionElement(document as unknown as Document, location)).toBeNull()
  expect(click).toHaveBeenCalledOnce()
  expect(findRetrievalDecisionElement(document as unknown as Document, location)?.textContent).toBe('长效维护')
  expect(findRetrievalDecisionElement(document as unknown as Document, { ...location, text: '不存在的维度' })).toBeNull()
})

test('transparent feature shortcuts remain separate from saved citation relationships', () => {
  const shortcuts = retrievalFeatureLocations('预算资金和原拆原建模式，还需要做哪些下一步调查？')
  expect(shortcuts.map(row => row.kind)).toEqual(['cost-library', 'mode-panel', 'investigations'])
  expect(retrievalDecisionLocations({ ...hit, source: { ...source, id: 'NO-CITATION' } }, 'P1', null, null)).toEqual([])
  const { document } = parseHTML('<details><summary>历史内容</summary><section class="construction-cost-library"><button class="cost-library-toggle" aria-expanded="false">展开工程库</button></section></details>')
  const button = document.querySelector('button')!, click = vi.fn(() => button.setAttribute('aria-expanded', 'true'))
  button.click = click
  expect(findRetrievalFeatureElement(document as unknown as Document, shortcuts[0])).toBeNull()
  expect(click).toHaveBeenCalledOnce()
  expect(findRetrievalFeatureElement(document as unknown as Document, shortcuts[0])?.className).toBe('construction-cost-library')
})
