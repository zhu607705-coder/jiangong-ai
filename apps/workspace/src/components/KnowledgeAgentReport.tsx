import { useId, useState } from 'react'
import type { KnowledgeAgentReport as ReportValue, KnowledgeCitation, KnowledgeConditionMatch, KnowledgeMatch, KnowledgeTrace, Source } from '../../../host/generated/contracts'
import { RETROFIT_ACTION_LABELS } from '../../../../packages/retrofit/policy'
import './knowledge-agent-report.css'

type Props = { value: ReportValue; trace: KnowledgeTrace; sources: Source[]; onEvidence: (refs: string[]) => void }
type OriginalCitation = { document_id: string; version: string; locator: string; quote: string; original_source?: { id: string; url?: string; visibility?: string; hash?: string; title?: string } | null }
const actions = RETROFIT_ACTION_LABELS
const states = { matched: '命中', unmatched: '未命中', unknown: '未知', conflict: '冲突' }
const operators = { eq: '=', ne: '≠', gt: '>', gte: '≥', lt: '<', lte: '≤', contains: '包含' }
const sourceUrl = (value?: string): string | undefined => { try { const url = new URL(value || ''); return ['http:', 'https:'].includes(url.protocol) ? url.href : undefined } catch { return undefined } }
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)

/** The document citation remains separate from the generated KB source and its hash. */
function originalCitations(source?: Source): OriginalCitation[] {
  if (!source?.untrusted_text) return []
  try {
    const payload: unknown = JSON.parse(source.untrusted_text)
    if (!object(payload) || !Array.isArray(payload.citations)) return []
    return payload.citations.flatMap((item: unknown) => {
      if (!object(item) || !['document_id', 'version', 'locator', 'quote'].every(key => typeof item[key] === 'string')) return []
      const nested = item.original_source
      const original = object(nested) && typeof nested.id === 'string' ? {
        id: nested.id, url: typeof nested.url === 'string' ? nested.url : undefined,
        visibility: typeof nested.visibility === 'string' ? nested.visibility : undefined,
        hash: typeof nested.hash === 'string' ? nested.hash : undefined, title: typeof nested.title === 'string' ? nested.title : undefined,
      } : null
      return [{ document_id: item.document_id as string, version: item.version as string, locator: item.locator as string, quote: item.quote as string, original_source: original }]
    })
  } catch { return [] }
}

function OriginalEvidence({ item, internal }: { item: OriginalCitation; internal: boolean }) {
  const url = sourceUrl(item.original_source?.url)
  return <div className="knowledge-agent-original"><div className="knowledge-agent-reference-meta"><span>{internal || item.original_source?.visibility === 'internal' ? '内部文档来源' : '文档来源'} · {item.document_id}</span><span>原文定位 {item.locator}</span><span>材料版本 {item.version}</span>
    {item.original_source?.id && <span>原始来源 {item.original_source.id}</span>}{item.original_source?.hash && <span>原始来源哈希 {item.original_source.hash}</span>}</div>
    <blockquote>{item.quote}</blockquote>{url && <a href={url} target="_blank" rel="noopener noreferrer">打开原始材料</a>}
  </div>
}

function Citations({ title, citations, sources, onEvidence, programRefs = [] }: { title: string; citations: KnowledgeCitation[]; sources: Source[]; onEvidence: Props['onEvidence']; programRefs?: string[] }) {
  const [expanded, setExpanded] = useState<number | null>(null), id = useId()
  const current = expanded === null ? undefined : citations[expanded]
  const source = current ? sources.find(item => item.id === current.source_id) : undefined
  const programSource = !!current && programRefs.includes(current.source_id)
  const originals = originalCitations(source)
  // The KB locator may refer to an aggregate card. Avoid presenting unrelated
  // document quotes as an exact mapping of the agent's selected citation.
  const located = current?.quote.trim() ? originals.filter(item => item.locator === current.locator && item.quote.includes(current.quote)) : []
  const shown = located.length ? located : originals
  const displayQuote = current?.quote || (!originals.length ? source?.untrusted_text : '')
  return <div className="knowledge-agent-citations" role="group" aria-label={title}>
    <span className="knowledge-agent-caption">{title}</span><div className="knowledge-agent-source-buttons">{citations.map((citation, index) => {
      const referenced = sources.find(item => item.id === citation.source_id)
      return <button type="button" key={`${citation.source_id}:${citation.locator}:${index}`} aria-expanded={expanded === index} aria-controls={`${id}-quote`} onClick={() => setExpanded(expanded === index ? null : index)}>[来源{index + 1}] {referenced?.title || citation.source_id}</button>
    })}</div>
    {!citations.length && <p className="knowledge-agent-muted">当前未提供引用。</p>}
    {current && <div className="knowledge-agent-citation-detail" id={`${id}-quote`}>
      <div className="knowledge-agent-reference-meta"><strong>{source?.title || '来源待补充'}</strong><span>来源 {current.source_id}</span><span>{programSource ? '程序条件来源 / 正文' : `引用定位 ${current.locator || '尚未提供精确原文定位'}`}</span>{source?.hash && <span>来源记录版本 {source.hash}</span>}</div>
      {displayQuote && <blockquote>{displayQuote}</blockquote>}
      {!source && <p className="knowledge-agent-muted">当前结果未附带该来源，请补齐后核对引文。</p>}
      {source?.synthetic && <small className="knowledge-agent-muted">合成测试材料</small>}
      <div className="knowledge-agent-evidence-actions"><button type="button" disabled={!source} onClick={() => onEvidence([current.source_id])}>{programSource ? '查看程序条件来源' : '在资料中查看'}</button>
        {sourceUrl(source?.url) && <a href={sourceUrl(source?.url)} target="_blank" rel="noopener noreferrer">打开原始来源</a>}
        {source?.visibility === 'internal' && !sourceUrl(source.url) && !shown.length && <span className="knowledge-agent-muted">内部文档来源</span>}</div>
      {!!shown.length && <details className="knowledge-agent-originals"><summary>{located.length ? '对应原始文档' : '所引案例或规则的原始材料'} · {shown.length}</summary>{shown.map((item, index) => <OriginalEvidence key={`${item.document_id}:${item.version}:${item.locator}:${index}`} item={item} internal={source?.visibility === 'internal'} />)}</details>}
    </div>}
  </div>
}

function Condition({ item, sources, onEvidence }: { item: KnowledgeConditionMatch; sources: Source[]; onEvidence: Props['onEvidence'] }) {
  const refs = item.evidence_refs.filter(ref => sources.some(source => source.id === ref))
  return <div className="knowledge-agent-condition"><p><span className={`knowledge-agent-state is-${item.state}`}>{states[item.state]}</span><strong>{item.condition.label}</strong><small>{item.condition.fact_kind}</small></p>
    <p className="knowledge-agent-muted">{item.reason}</p><small className="knowledge-agent-muted">条件取值 {operators[item.condition.operator]} {String(item.condition.value)} {item.condition.unit || ''}{item.condition.source_value ? ` · 原文取值 ${item.condition.source_value}` : ''}</small>
    <details><summary>条件原文引用 · {item.condition.evidence.length}</summary>{item.condition.evidence.map((evidence, index) => <OriginalEvidence key={`${evidence.document_id}:${index}`} item={evidence} internal={sources.some(source => refs.includes(source.id) && source.visibility === 'internal')} />)}
      {!!refs.length && <button type="button" onClick={() => onEvidence(refs)}>查看条件来源</button>}</details>
  </div>
}

function MatchedCards({ cardIds, conditionKeys, matches, hitIds, sources, onEvidence }: { cardIds: string[]; conditionKeys: string[]; matches: KnowledgeMatch[]; hitIds: Set<string>; sources: Source[]; onEvidence: Props['onEvidence'] }) {
  const knownKeys = new Set<string>()
  const cards = cardIds.map(id => { const card = matches.find(item => item.card_id === id); const conditions = card?.conditions.filter(item => conditionKeys.includes(item.condition.fact_kind)) || []; conditions.forEach(item => knownKeys.add(item.condition.fact_kind)); return { id, card, conditions } })
  const missingKeys = conditionKeys.filter(key => !knownKeys.has(key))
  return <details className="knowledge-agent-matches"><summary>查看引用的案例与条件 · {cardIds.length}</summary>{cards.map(({ id, card, conditions }) => <div className="knowledge-agent-matched-card" key={id}>
    {card ? <><h5>{card.title} <small>v{card.card_revision} · {card.kind === 'case' ? '案例' : '规则'} · {hitIds.has(id) ? '适用命中' : '候选待核'}</small></h5><small className="knowledge-agent-muted">{card.card_id} · 来源项目 {card.source_project_id}</small>{conditions.map((item, index) => <Condition key={`${item.condition.fact_kind}:${index}`} item={item} sources={sources} onEvidence={onEvidence} />)}{!conditions.length && <p className="knowledge-agent-muted">本条建议未标注该卡的结构化条件。</p>}</> : <p className="knowledge-agent-muted">匹配记录未包含卡 {id}，请补齐后核对。</p>}
  </div>)}{!!missingKeys.length && <p className="knowledge-agent-muted">条件映射待核：{missingKeys.join('、')}</p>}</details>
}

function Items({ title, items }: { title: string; items: string[] }) {
  return items.length ? <div><h5>{title}</h5><ul>{items.map((item, index) => <li key={index}>{item}</li>)}</ul></div> : null
}

export default function KnowledgeAgentReport({ value, trace, sources, onEvidence }: Props) {
  const hits = [...trace.case_hits, ...trace.rule_hits], matches = [...hits, ...trace.candidates.filter(candidate => !hits.some(hit => hit.card_id === candidate.card_id))]
  const hitIds = new Set(hits.map(item => item.card_id))
  const decision = value.assessment.decision
  const changed = decision.action !== value.final_action
  const finalRefs = [...new Set(value.decision_evidence_refs)]
  const exactFinalCitations = value.final_citations ?? decision.citations.filter(citation => finalRefs.includes(citation.source_id))
  const programRefs = finalRefs.filter(ref => !exactFinalCitations.some(citation => citation.source_id === ref))
  const finalCitations = [...exactFinalCitations, ...programRefs.map(source_id => ({ source_id, locator: '', quote: '' }))]
  const status = trace.agent_status === 'executed' ? '已完成 Agent 研判' : trace.agent_status === 'offline_only' ? '本地条件建议' : trace.agent_status === 'blocked_external' ? 'Agent 研判受阻' : trace.agent_status === 'pending' ? 'Agent 研判待完成' : '研判结果'
  return <section className="knowledge-agent-report" aria-label="Agent 研判与行动依据">
    <header className="knowledge-agent-heading"><div><small>AGENT ASSESSMENT</small><h3>Agent 研判与行动依据</h3></div><span className="knowledge-agent-status">{status}</span></header>
    <p className="knowledge-agent-summary">{value.assessment.summary}</p>
    <article className="knowledge-agent-decision" aria-label="决策与行动依据"><dl><div><dt>Agent 初判</dt><dd>{actions[decision.action]}</dd></div><div><dt>最终行动</dt><dd className={`is-${value.final_action}`}>{actions[value.final_action]}</dd></div></dl>
      <p>{decision.reasoning}</p><Citations title="Agent 初判依据" citations={decision.citations} sources={sources} onEvidence={onEvidence} />
      {(changed || value.guard_reasons.length > 0) && <div className="knowledge-agent-guard"><strong>{changed ? '程序约束调整了最终行动' : '程序约束核验'}</strong><ul>{value.guard_reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul>{changed && !value.guard_reasons.length && <p>最终行动与初判不同，调整原因尚未提供。</p>}</div>}
      <Citations title="最终行动依据" citations={finalCitations} sources={sources} onEvidence={onEvidence} programRefs={programRefs} />
    </article>
    <div className="knowledge-agent-advice-list">{value.assessment.recommendations.map((item, index) => {
      const title = matches.find(match => item.matched_card_ids.includes(match.card_id) && match.measure_key === item.measure_key)?.measure_name || item.measure_key
      return <article className="knowledge-agent-advice" key={`${item.measure_key}:${index}`} aria-label={`举措建议 ${index + 1}：${title}`}><header><h4>{title}</h4><small>{item.measure_key}</small></header><p className="knowledge-agent-advice-text">{item.advice}</p>
        <Citations title={`建议 ${index + 1} 的依据`} citations={item.citations} sources={sources} onEvidence={onEvidence} /><p className="knowledge-agent-reasoning">{item.reasoning}</p>
        <MatchedCards cardIds={item.matched_card_ids} conditionKeys={item.matched_condition_keys} matches={matches} hitIds={hitIds} sources={sources} onEvidence={onEvidence} />
        <div className="knowledge-agent-next"><Items title="仍需核实" items={item.unknowns} /><Items title="下一步" items={item.next_steps} /></div>
      </article>
    })}</div>
    {!!value.assessment.disagreements.length && <details className="knowledge-agent-disagreements"><summary>证据与判断分歧 · {value.assessment.disagreements.length}</summary><ul>{value.assessment.disagreements.map((item, index) => <li key={index}>{item}</li>)}</ul></details>}
    <small className="knowledge-agent-footer">研判规则 {value.policy_version} · 匹配规则 {trace.policy_version} · 资料截至 {trace.evaluated_as_of}</small>
  </section>
}
