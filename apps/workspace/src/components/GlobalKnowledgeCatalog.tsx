import { useEffect, useMemo, useState, type FormEvent } from 'react'
import type { ExperienceCard, ExperienceEvidence, ExperienceField, KnowledgeCondition } from '../../../host/generated/contracts'
import { cardPresentationDetails } from '../../../../packages/experience/presentation'
import { api } from '../api'
import './global-knowledge-catalog.css'

type CatalogItem = { card: ExperienceCard; similar_conditions: string[]; important_differences: string[]; reuse_premises: string[] }
type Filters = { q: string; asOf: string }
type Props = { kind: 'case' | 'rule'; onOpenProject: (projectId: string) => void; onEvidence?: (projectId: string, evidence: ExperienceEvidence) => void }

// Display-only selective reuse of packages/experience/domain.ts FIELD_LABELS.
// Importing that module would also import document parsing and validation.
const fieldLabels: Record<ExperienceField['key'], string> = {
  decision_question: '决策问题', background: '背景目标', key_conditions: '关键条件', alternatives: '备选方案',
  proposal: '提议方案', actual_decision: '实际决策', decision_basis: '决策依据', implementation: '实际实施', outcome: '执行结果', applicability: '适用边界',
}
const fieldKeys = Object.keys(fieldLabels) as ExperienceField['key'][]
const operators: Record<KnowledgeCondition['operator'], string> = { eq: '等于', ne: '不等于', gt: '大于', gte: '不小于', lt: '小于', lte: '不大于', contains: '包含' }
const valueOf = (card: ExperienceCard, key: ExperienceField['key']) => card.fields.find(field => field.key === key)?.value?.trim() || '原文未记载'
const recordedAt = (value: string) => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleDateString('zh-CN') : '未登记'

function EvidenceQuotes({ projectId, items, onEvidence }: { projectId: string; items: ExperienceEvidence[]; onEvidence?: Props['onEvidence'] }) {
  return <div className="knowledge-catalog-quotes">{items.map((evidence, index) => <details key={JSON.stringify([evidence.document_id, evidence.version, evidence.locator, index])}>
    <summary>{evidence.document_id} · {evidence.locator}</summary>
    <blockquote>{evidence.quote}</blockquote>
    <dl className="knowledge-catalog-reference"><div><dt>文档</dt><dd>{evidence.document_id}</dd></div><div><dt>原文版本</dt><dd>{evidence.version}</dd></div><div><dt>定位</dt><dd>{evidence.locator}</dd></div></dl>
    {onEvidence && <button type="button" className="knowledge-catalog-text-button" onClick={() => onEvidence(projectId, evidence)}>定位来源项目原文</button>}
  </details>)}</div>
}

function Conditions({ title, items, projectId, onEvidence }: { title: string; items: KnowledgeCondition[]; projectId: string; onEvidence?: Props['onEvidence'] }) {
  if (!items.length) return null
  return <details className="knowledge-catalog-conditions"><summary>{title}（{items.length}）</summary><ul>{items.map((condition, index) => <li key={`${condition.fact_kind}:${index}`}>
    <p><strong>{condition.label}</strong> · {operators[condition.operator]} {String(condition.value)}{condition.unit ? ` ${condition.unit}` : ''}</p>
    {condition.source_value && <p>原文取值：{condition.source_value}</p>}
    <EvidenceQuotes projectId={projectId} items={condition.evidence} onEvidence={onEvidence}/>
  </li>)}</ul></details>
}

export default function GlobalKnowledgeCatalog({ kind, onOpenProject, onEvidence }: Props) {
  const [synthetic, setSynthetic] = useState(false)
  const [draft, setDraft] = useState<Filters>({ q: '', asOf: '' })
  const [filters, setFilters] = useState<Filters>({ q: '', asOf: '' })
  const [filterError, setFilterError] = useState('')
  const [retry, setRetry] = useState(0)
  const [loaded, setLoaded] = useState<{ key: string; items: CatalogItem[]; loading: boolean; error: string }>({ key: '', items: [], loading: true, error: '' })
  const parameters = new URLSearchParams({ kind, synthetic: String(synthetic), limit: '100' })
  if (filters.q) parameters.set('q', filters.q)
  if (filters.asOf) parameters.set('as_of', filters.asOf)
  const endpoint = `/experiences/search?${parameters}`
  const state = loaded.key === endpoint ? loaded : { items: [], loading: true, error: '' }
  const title = kind === 'case' ? '全局案例库' : '全局规则库'

  useEffect(() => {
    const controller = new AbortController()
    setLoaded({ key: endpoint, items: [], loading: true, error: '' })
    void api<{ items: CatalogItem[] }>(endpoint, undefined, controller.signal).then(result => {
      if (!controller.signal.aborted) setLoaded({ key: endpoint, items: result.items, loading: false, error: '' })
    }).catch(error => {
      if (!controller.signal.aborted) setLoaded({ key: endpoint, items: [], loading: false, error: error instanceof Error ? error.message : '资料暂未读取成功，请重试。' })
    })
    return () => controller.abort()
  }, [endpoint, retry])

  const items = useMemo(() => state.items.filter(item => item.card.status === 'approved' && item.card.knowledge?.kind === kind), [state.items, kind])
  const projects = new Set(items.map(item => item.card.project_id)).size
  const versions = new Set(items.flatMap(item => cardPresentationDetails(item.card).evidence.map(evidence => JSON.stringify([item.card.project_id, evidence.document_id, evidence.version])))).size

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const asOf = draft.asOf.trim()
    if (asOf && (!/^\d{4}-\d{2}-\d{2}$/.test(asOf) || !Number.isFinite(Date.parse(`${asOf}T00:00:00Z`)) || new Date(`${asOf}T00:00:00Z`).toISOString().slice(0, 10) !== asOf)) {
      setFilterError('请选择有效的审核版本截止日。'); return
    }
    setFilterError(''); setFilters({ q: draft.q.trim(), asOf }); setRetry(value => value + 1)
  }

  return <section className="global-knowledge-catalog" aria-label={title}>
    <header className="knowledge-catalog-heading"><div><span className="knowledge-catalog-eyebrow">跨项目知识资料</span><h2>{title}</h2><p>查阅已审核的{kind === 'case' ? '历史决策与实施经验' : '举措规则与适用条件'}，保留原项目、审核版本和逐字出处。</p></div><span className={`knowledge-catalog-scope${synthetic ? ' is-synthetic' : ''}`}>{synthetic ? '模拟演示 · 独立范围' : '真实资料'}</span></header>
    <form className="knowledge-catalog-filters" onSubmit={search} aria-label={`${title}筛选`}>
      <label htmlFor={`knowledge-${kind}-query`}>关键词<input id={`knowledge-${kind}-query`} type="search" maxLength={300} value={draft.q} placeholder="检索举措、条件或决策内容" onChange={event => setDraft(value => ({ ...value, q: event.target.value }))}/></label>
      <label htmlFor={`knowledge-${kind}-date`}>审核版本截止日<input id={`knowledge-${kind}-date`} type="date" value={draft.asOf} onChange={event => setDraft(value => ({ ...value, asOf: event.target.value }))}/></label>
      <label htmlFor={`knowledge-${kind}-scope`}>资料范围<select id={`knowledge-${kind}-scope`} value={String(synthetic)} onChange={event => setSynthetic(event.target.value === 'true')}><option value="false">真实资料</option><option value="true">模拟演示</option></select></label>
      <button type="submit" className="knowledge-catalog-primary">检索{kind === 'case' ? '案例' : '规则'}</button>
      {filterError && <p role="alert">{filterError}</p>}
    </form>
    <div className="knowledge-catalog-status" aria-live="polite">{state.loading ? <p role="status">正在读取{title}…</p> : state.error ? <p role="alert">{state.error}<button type="button" onClick={() => setRetry(value => value + 1)}>重新读取</button></p> : <><p>当前筛选 <strong>{items.length}</strong> 条（最多100条） · <strong>{projects}</strong> 个来源项目 · <strong>{versions}</strong> 个原文版本</p><span>{filters.asOf ? `截至 ${filters.asOf} 的审核历史版本` : '当前已审核历史版本'}</span></>}</div>
    {!state.loading && !state.error && !items.length && <div className="knowledge-catalog-empty"><h3>当前范围没有符合条件的已审核记录</h3><p>可调整关键词或截止日；资料在来源项目整理、审核后进入此处。</p></div>}
    <div className="knowledge-catalog-list">{items.map(({ card, important_differences, reuse_premises }) => {
      const presentation = cardPresentationDetails(card), knowledge = card.knowledge!
      const premises = [...new Set([card.fields.find(field => field.key === 'applicability')?.value, ...reuse_premises, ...knowledge.transfer_notes].filter((value): value is string => !!value?.trim()))]
      return <article className="knowledge-catalog-card" key={`${card.project_id}:${card.id}:${card.revision}`} data-card-id={card.id}>
        <header><div><span className="knowledge-catalog-kind">{kind === 'case' ? '历史案例' : '举措规则'}{knowledge.measure_name ? ` · ${knowledge.measure_name}` : ''}</span><h3>{card.title}</h3><p className="knowledge-catalog-card-meta">{card.project_type || '项目类型未登记'} · {card.development_mode || '模式未登记'} · {card.stage || '阶段未登记'}</p></div><span className="knowledge-catalog-approved">已审核 · 修订 {card.revision}</span></header>
        <div className="knowledge-catalog-provenance"><span>来源项目 <strong>{card.project_id}</strong></span><span>记录 {card.id}</span><span>记录更新 {recordedAt(card.updated_at)}</span></div>
        <p className="knowledge-catalog-question"><strong>决策问题</strong>{valueOf(card, 'decision_question')}</p>
        <dl className="knowledge-catalog-outcomes">{(['actual_decision', 'implementation', 'outcome'] as const).map(key => <div key={key}><dt>{fieldLabels[key]}</dt><dd>{valueOf(card, key)}</dd></div>)}</dl>
        <section className="knowledge-catalog-applicability" aria-label="适用条件与边界"><h4>适用条件与边界</h4><p>{valueOf(card, 'key_conditions')}</p>{premises.length > 0 && <ul>{premises.map(value => <li key={value}>{value}</li>)}</ul>}
          <Conditions title="逐项适用条件" items={knowledge.conditions} projectId={card.project_id} onEvidence={onEvidence}/>
          <Conditions title="不适用情形" items={knowledge.exclusions} projectId={card.project_id} onEvidence={onEvidence}/>
        </section>
        <details className="knowledge-catalog-records"><summary>十项决策记录与逐项出处</summary><dl>{fieldKeys.map(key => {
          const field = card.fields.find(value => value.key === key)
          return <div key={key}><dt>{fieldLabels[key]}</dt><dd><p>{valueOf(card, key)}</p>{!!field?.evidence.length && <EvidenceQuotes projectId={card.project_id} items={field.evidence} onEvidence={onEvidence}/>}</dd></div>
        })}</dl></details>
        <details className="knowledge-catalog-originals"><summary>查看原文引文（{presentation.evidence.length}）</summary>{presentation.evidence.length ? <EvidenceQuotes projectId={card.project_id} items={presentation.evidence} onEvidence={onEvidence}/> : <p>此历史记录未登记可定位引文。</p>}</details>
        {!!important_differences.length && <details className="knowledge-catalog-notes"><summary>历史材料缺项与使用说明</summary><ul>{important_differences.map(value => <li key={value}>{value}</li>)}</ul></details>}
        {card.review_note && <details className="knowledge-catalog-notes"><summary>审核记录说明</summary><p>{card.review_note}</p></details>}
        <footer><p>引用和适用范围随审核版本保留。</p><button type="button" className="knowledge-catalog-primary" onClick={() => onOpenProject(card.project_id)}>前往来源项目维护</button></footer>
      </article>
    })}</div>
  </section>
}
