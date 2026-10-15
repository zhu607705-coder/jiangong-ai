import type { DecisionPacket, Source } from '../../../host/generated/contracts'
import type { RetrievalHit } from '../../../../packages/experience/retrieval'
import type { StrategyPacket } from '../../../../packages/retrofit/strategy'

export type RetrievalDecisionLocation = {
  id: string; label: string; relation: string; tab: 'overview' | 'actions';
  kind: 'rationale' | 'action' | 'dimension' | 'investigation' | 'scenario' | 'followup';
  text: string; mode?: 'comprehensive' | 'rebuild';
}
export type RetrievalFeatureLocation = { id: string; label: string; detail: string; tab: 'overview' | 'actions'; kind: 'cost-library' | 'mode-panel' | 'assessment' | 'investigations' }
export function retrievalFeatureLocations(question: string): RetrievalFeatureLocation[] {
  const locations: RetrievalFeatureLocation[] = []
  if (/造价|预算|资金|费用|投资|合同价|中标价|成本/.test(question)) locations.push({ id: 'cost-library', kind: 'cost-library', tab: 'overview', label: '查看历史造价参考', detail: '按问题中的造价、费用或资金事项打开工程库，分价格阶段核对；不是本项目预算结论。' })
  if (/模式|拆建|拆除|重建|原拆原建|综合整治/.test(question)) locations.push({ id: 'mode-panel', kind: 'mode-panel', tab: 'overview', label: '查看改造模式判定', detail: '查看综合整治与原拆原建的条件、标准和已保存的初判。' })
  if (/六维|现况|现状|评估|评定/.test(question)) locations.push({ id: 'assessment', kind: 'assessment', tab: 'overview', label: '打开现况与改后评估', detail: '查看已有六维资料与方案目标；缺少证据的维度仍需调查。' })
  if (/下一步|调查|核查|补充资料|待补|待核/.test(question)) locations.push({ id: 'investigations', kind: 'investigations', tab: 'actions', label: '打开下一步调查', detail: '查看当前项目已保存的调查任务与材料缺项。' })
  return locations
}
const dimensionLabels = { demand: '居民需求', supply: '公共服务', adaptation: '居住工程', implementation: '实施协同', operations: '长效维护', resources: '资金交付' }
const modeLabels = { comprehensive: '综合整治', rebuild: '原拆原建' }
const localId = (id: string, projectId: string) => id.startsWith(`${projectId}:`) ? id.slice(projectId.length + 1) : id
export const retrievalSourceIds = (hit: RetrievalHit) => [...new Set([hit.source.id, ...(hit.source_aliases || [])])]
const sameId = (id: string, hit: RetrievalHit, projectId: string) => retrievalSourceIds(hit).some(sourceId => localId(id, projectId) === localId(sourceId, projectId))

/** Relationships come from saved source citations, never from question keywords. */
export function retrievalDecisionLocations(hit: RetrievalHit, projectId: string, strategy: StrategyPacket | null, packet: DecisionPacket | null): RetrievalDecisionLocation[] {
  const locations: RetrievalDecisionLocation[] = []
  if (strategy?.project_id === projectId && !strategy.synthetic && strategy.strategy) {
    const source = strategy.sources.find(row => sameId(row.id, hit, projectId))
    if (source) {
      strategy.strategy.rationale.forEach((claim, index) => {
        if (!sameId(claim.source_id, hit, projectId)) return
        const overlap = !!claim.quote.trim() && (hit.text.includes(claim.quote) || claim.quote.includes(hit.text))
        locations.push({ id: `rationale-${index}`, kind: 'rationale', tab: 'overview', label: `方案判断 · ${claim.point}`, text: claim.point,
          relation: overlap ? '命中片段与该判断引用的原文重合' : '该判断引用了同一来源，可展开核对其具体引用' })
      })
      strategy.strategy.paths.forEach(path => path.actions.forEach((action, index) => {
        if (action.evidence_refs.some(id => sameId(id, hit, projectId))) locations.push({ id: `action-${path.mode}-${index}`, kind: 'action', tab: 'overview', mode: path.mode,
          label: `${modeLabels[path.mode]} · ${action.title}`, text: action.title, relation: '该举措的依据包含此来源' })
      }))
      strategy.strategy.dimensions.forEach(row => {
        if (row.evidence_refs.some(id => sameId(id, hit, projectId))) locations.push({ id: `dimension-${row.key}`, kind: 'dimension', tab: 'overview',
          label: `现况评估 · ${dimensionLabels[row.key]}`, text: dimensionLabels[row.key], relation: '该维度的现况与目标说明引用了此来源' })
      })
      strategy.strategy.next_checks.forEach((check, index) => {
        if (check.evidence_refs.some(id => sameId(id, hit, projectId))) locations.push({ id: `investigation-${index}`, kind: 'investigation', tab: 'actions',
          label: `下一步调查 · ${check.title}`, text: check.title, relation: '该调查项以此来源为核查线索' })
      })
    }
  }
  if (packet?.project_id === projectId) {
    const source = packet.sources.find(row => sameId(row.id, hit, projectId))
    const versionMatches = source && (![source.hash, source.raw_hash].filter(Boolean).length || [source.hash, source.raw_hash].includes(hit.version))
    if (versionMatches) {
      packet.scenarios.forEach(row => {
        if (row.evidence_refs.some(id => sameId(id, hit, projectId))) locations.push({ id: `scenario-${row.id}`, kind: 'scenario', tab: 'overview',
          label: `研判 v${packet.revision} · ${row.title}`, text: row.title, relation: '此已保存路径列出了该来源' })
      })
      packet.followups.forEach(row => {
        if (row.evidence_refs?.some(id => sameId(id, hit, projectId))) locations.push({ id: `followup-${row.id}`, kind: 'followup', tab: 'actions',
          label: `调查清单 · ${row.title}`, text: row.title, relation: '此调查任务明确引用了该来源' })
      })
    }
  }
  return locations
}

export type SourceHitFocusResult = { status: 'matched'; before: string; quote: string; after: string } | { status: 'version-mismatch' | 'quote-mismatch' | 'version-unverified' }
export async function sourceHitFocus(source: Source, hit: Pick<RetrievalHit, 'source' | 'version' | 'text' | 'evidence_kind' | 'version_origin'>, cryptoProvider: { subtle?: Pick<SubtleCrypto, 'digest'> } | undefined = globalThis.crypto): Promise<SourceHitFocusResult> {
  const registered = source.hash || (hit.version_origin !== 'text_sha256' ? source.raw_hash : undefined)
  if (registered && registered !== hit.version) return { status: 'version-mismatch' }
  if (!registered) {
    if (hit.evidence_kind !== 'source_text' || hit.version_origin !== 'text_sha256' || !/^[a-f0-9]{64}$/i.test(hit.version)) return { status: 'version-unverified' }
    let digest: string | null = null
    if (cryptoProvider?.subtle) {
      try { digest = Array.from(new Uint8Array(await cryptoProvider.subtle.digest('SHA-256', new TextEncoder().encode(source.untrusted_text || ''))), byte => byte.toString(16).padStart(2, '0')).join('') } catch { /* HTTP deployments can compare the complete saved snapshot below. */ }
    }
    if (digest ? digest !== hit.version : source.untrusted_text !== hit.text) return { status: 'version-mismatch' }
  }
  const quote = hit.text.trim(), text = source.untrusted_text || '', start = quote ? text.indexOf(quote) : -1
  if (start < 0) return { status: 'quote-mismatch' }
  return { status: 'matched', before: text.slice(0, start), quote, after: text.slice(start + quote.length) }
}

export function focusRetrievalElement(element: HTMLElement) {
  for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) if (ancestor.tagName === 'DETAILS') (ancestor as HTMLDetailsElement).open = true
  element.setAttribute('tabindex', '-1'); element.setAttribute('data-retrieval-focused', 'true')
  element.scrollIntoView({ block: 'center', behavior: 'auto' }); element.focus({ preventScroll: true })
}

/** Open the real component's existing tabs; return a target only after it is present. */
export function findRetrievalDecisionElement(root: ParentNode, location: RetrievalDecisionLocation): HTMLElement | null {
  const text = (element: Element) => (element.textContent || '').replace(/\s+/g, ' ').trim()
  if (['rationale', 'action', 'dimension'].includes(location.kind)) {
    const strategy = root.querySelector('.strategy-overview')
    if (!strategy) return null
    const wantedTab = location.kind === 'dimension' ? '现况与改后评估' : '方案总览'
    const tab = [...strategy.querySelectorAll<HTMLButtonElement>('.strategy-subnav button')].find(button => text(button) === wantedTab)
    if (tab && tab.getAttribute('aria-current') !== 'page') { tab.click(); return null }
    if (location.kind === 'action' && location.mode) {
      const mode = [...strategy.querySelectorAll<HTMLButtonElement>('.strategy-choice button')].find(button => text(button).startsWith(`${modeLabels[location.mode!]} ·`))
      if (mode && mode.getAttribute('aria-pressed') !== 'true') { mode.click(); return null }
    }
    if (location.kind === 'dimension') {
      const before = [...strategy.querySelectorAll<HTMLButtonElement>('.strategy-assessment-controls button')].find(button => text(button) === '现有评估')
      if (before && before.getAttribute('aria-pressed') !== 'true') { before.click(); return null }
    }
    const selector = location.kind === 'rationale' ? '.strategy-rationale article' : location.kind === 'action' ? '.strategy-actions article' : '.strategy-dimension-cards article'
    return [...strategy.querySelectorAll<HTMLElement>(selector)].find(element => text(element).includes(location.text)) || null
  }
  const selector = location.kind === 'investigation' ? '.strategy-next-checks article' : location.kind === 'scenario' ? '.pathway' : '.followup-row'
  return [...root.querySelectorAll<HTMLElement>(selector)].find(element => text(element).includes(location.text)) || null
}

/** These are transparent feature shortcuts, separate from evidence-backed decision links. */
export function findRetrievalFeatureElement(root: ParentNode, location: RetrievalFeatureLocation): HTMLElement | null {
  if (location.kind === 'cost-library') {
    const library = root.querySelector<HTMLElement>('.construction-cost-library'), toggle = library?.querySelector<HTMLButtonElement>('.cost-library-toggle')
    if (toggle?.getAttribute('aria-expanded') === 'false') { toggle.click(); return null }
    return library || null
  }
  if (location.kind === 'investigations') return root.querySelector<HTMLElement>('[data-retrieval-investigations]')
  const strategy = root.querySelector('.strategy-overview')
  if (!strategy) return null
  const wanted = location.kind === 'assessment' ? '现况与改后评估' : '方案总览'
  const tab = [...strategy.querySelectorAll<HTMLButtonElement>('.strategy-subnav button')].find(button => button.textContent?.trim() === wanted)
  if (tab?.getAttribute('aria-current') !== 'page') { tab?.click(); return null }
  return strategy.querySelector<HTMLElement>(location.kind === 'assessment' ? '.strategy-assessment' : '.renewal-mode-panel')
}
