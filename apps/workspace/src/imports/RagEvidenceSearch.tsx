import { useEffect, useState } from 'react'
import { api } from '../api'
import type { RetrievalHit, RetrievalRequest, RetrievalResponse } from '../../../../packages/experience/retrieval'
import type { RetrievalDecisionLocation, RetrievalFeatureLocation } from './retrieval-navigation'
import './rag-evidence-search.css'

const kinds = { public_original: '公开原件', ai_draft: 'AI研究草稿', synthetic: '模拟资料', internal_material: '内部材料', unknown: '类别待核' }
const statuses = { draft: '草稿待复核', approved: '已审核', rejected: '复核未通过' }
const measures: Record<string, string> = { pipe_network: '供水与管网', elevator: '电梯', maintenance: '长效维护', public_service: '公共服务' }
type Props = {
  projectId: string; revision?: number; onEvidence?: (refs: string[]) => void; variant?: 'page' | 'floating'; initialQuestion?: string; onLocateHit?: (hit: RetrievalHit) => void;
  decisionLocations?: (hit: RetrievalHit) => RetrievalDecisionLocation[]; onNavigateDecision?: (location: RetrievalDecisionLocation) => void;
  decisionLinksState?: 'loading' | 'ready' | 'unavailable';
  featureLocations?: (question: string) => RetrievalFeatureLocation[]; onNavigateFeature?: (location: RetrievalFeatureLocation) => void;
}
const scopeSummary = (query: RetrievalRequest) => [query.measure_key ? measures[query.measure_key] || query.measure_key : '不限举措', query.object_ref ? `对象 ${query.object_ref}` : '不限对象', query.stage ? `阶段 ${query.stage}` : '各阶段', query.as_of ? `截至 ${query.as_of}` : '不限资料日期', query.include_ai ? '含 AI 草稿与模拟' : '不含 AI 草稿与模拟'].join(' · ')

export default function RagEvidenceSearch({ projectId, revision = 0, onEvidence, variant = 'page', initialQuestion, onLocateHit, decisionLocations, onNavigateDecision, decisionLinksState = 'ready', featureLocations, onNavigateFeature }: Props) {
  const floating = variant === 'floating'
  const [question, setQuestion] = useState(initialQuestion ?? '')
  const [measure, setMeasure] = useState(''), [object, setObject] = useState(''), [stage, setStage] = useState(''), [asOf, setAsOf] = useState(''), [includeAI, setIncludeAI] = useState(false)
  const [result, setResult] = useState<RetrievalResponse | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [request, setRequest] = useState<{ projectId: string; revision: number; query: RetrievalRequest } | null>(null)
  function clearFilters() { setMeasure(''); setObject(''); setStage(''); setAsOf(''); setIncludeAI(false) }
  useEffect(() => { setResult(null); setError(''); setBusy(false); setRequest(null); setQuestion(initialQuestion ?? ''); clearFilters() }, [projectId, revision, initialQuestion])
  useEffect(() => {
    if (!request || request.projectId !== projectId || request.revision !== revision) return
    const controller = new AbortController(); setBusy(true); setError(''); setResult(null)
    void api<RetrievalResponse>(`/projects/${encodeURIComponent(projectId)}/knowledge/retrieve`, request.query, controller.signal)
      .then(value => { if (!controller.signal.aborted) setResult(value) })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '检索未完成') })
      .finally(() => { if (!controller.signal.aborted) setBusy(false) })
    return () => controller.abort()
  }, [projectId, revision, request])
  const query: RetrievalRequest = { question: question.trim(), ...(measure.trim() ? { measure_key: measure.trim() } : {}), ...(object.trim() ? { object_ref: object.trim() } : {}), ...(stage.trim() ? { stage: stage.trim() } : {}), ...(asOf ? { as_of: asOf } : {}), include_ai: includeAI, limit: 5 }
  const filtered = !!(measure || object || stage || asOf || includeAI)
  function search(unrestricted = false) {
    if (!query.question) return
    if (unrestricted) clearFilters()
    setRequest({ projectId, revision, query: unrestricted ? { question: query.question, include_ai: false, limit: 5 } : query })
  }
  const filters = <div className="rag-search-filters"><label>举措<select aria-label="RAG举措" value={measure} onChange={event => setMeasure(event.target.value)}><option value="">不限举措</option>{Object.entries(measures).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label>对象标识<input aria-label="RAG对象" value={object} onChange={event => setObject(event.target.value)} placeholder="留空检索项目全部对象" /></label><label>原文登记阶段<input aria-label="RAG阶段" value={stage} onChange={event => setStage(event.target.value)} placeholder="留空查看各阶段" /></label><label>资料截止日期<input aria-label="RAG资料截止日期" type="date" value={asOf} onChange={event => setAsOf(event.target.value)} /></label></div>
  return <section className={`rag-evidence-search${floating ? ' is-floating' : ''}`} aria-label={floating ? '直接问项目资料' : '按研判问题检索原文'} aria-busy={busy}>
    {!floating && <header><h3>围绕研判问题，检索可定位原文</h3><p>查找本项目已导入文件与已收集来源；命中后可定位原文，或查看实际引用它的判断、评估和调查项。</p></header>}
    <form onSubmit={event => { event.preventDefault(); search() }}><label>{floating ? '直接输入你的问题' : '需要核实的问题'}<textarea aria-label={floating ? '直接问资料的问题' : 'RAG研判问题'} value={question} maxLength={500} placeholder="例如：电梯托管费用是多少？停车和邻里中心有哪些安排？" onChange={event => setQuestion(event.target.value)} /></label>{floating ? <details className="rag-floating-filters"><summary>限定资料范围{filtered ? ' · 已限定' : ' · 当前不限举措'}</summary>{filters}</details> : filters}
      <p className="rag-current-scope" aria-label="当前检索范围">{scopeSummary(query)}{filtered && <button type="button" onClick={clearFilters}>清除筛选</button>}</p>
      <div className="rag-search-submit"><label><input type="checkbox" checked={includeAI} onChange={event => setIncludeAI(event.target.checked)} />包括 AI 研究草稿与模拟资料（单独标注）</label><button type="submit" disabled={busy || !question.trim()}>{busy ? '正在检索…' : floating ? '查找依据' : '检索原文'}</button></div></form>
    <div className="rag-floating-examples" aria-label="资料提问示例">{[
      { label: '供水范围', question: '二次供水改造涉及哪些楼栋和户数，哪些楼栋被排除？' },
      { label: '电梯托管', question: '电梯托管费用如何确定，有哪些管理措施？' },
      { label: '邻里中心', question: '邻里中心和养老服务有哪些改造安排？' },
      { label: '停车改善', question: '现有资料记录了哪些停车和充电设施改善？' },
      { label: '资金投入', question: '更新资金由谁承担，投资和运营费用有什么依据？' },
      { label: '更新模式', question: '综合整治与原拆原建各有哪些实施条件和依据？' },
    ].map(example => <button type="button" key={example.label} onClick={() => { clearFilters(); setQuestion(example.question); setRequest(null); setResult(null) }}>{example.label}</button>)}</div>
    {error && <p role="alert">{error}</p>}
    {result?.project_id === projectId && request?.revision === revision && <div className="rag-search-results">
      <p role="status">{result.hits.length}条命中 · {result.candidate_counts.documents}份导入文件{result.candidate_counts.source_texts !== undefined && ` · ${result.candidate_counts.source_texts}份已收集来源`}{!floating && ` · ${result.candidate_counts.eligible_chunks}个符合范围的原文片段`}</p>
      <div className="rag-submitted-scope"><strong>本次问题：{result.question}</strong><p>{request && scopeSummary(request.query)}</p></div>
      {!!featureLocations?.(result.question).length && onNavigateFeature && <nav className="rag-feature-shortcuts" aria-label="相关功能入口"><strong>相关功能入口</strong><p>按问题事项匹配工作台功能；这些入口不表示已经检索到证据或形成了决策。</p>{featureLocations(result.question).map(location => <div key={location.id}><button type="button" onClick={() => onNavigateFeature(location)}>{location.label} →</button><p>{location.detail}</p></div>)}</nav>}
      {result.hits.map(hit => {
        const locations = decisionLocations?.(hit) || []
        return <article key={hit.id}>
          <header><h4>{hit.file_name}</h4><span className={`rag-hit-kind kind-${hit.source_kind}`}>{kinds[hit.source_kind]}</span></header>
          <p>原文定位：{hit.locator} · {hit.source_date ? `来源 ${hit.source_date}` : '原来源日期未登记'}{hit.content_status === 'excerpt' ? ' · 已收集摘录' : hit.content_status === 'full_text' ? ' · 已获取正文' : ''}</p>
          <p>{hit.review_statuses.map(value => statuses[value as keyof typeof statuses] || value).join(' / ') || '原文提及，尚未形成已审核字段'}</p>
          <blockquote>{floating && hit.text.length > 280 ? `${hit.text.slice(0, 280)}…` : hit.text}</blockquote>
          {floating && hit.text.length > 280 && <details><summary>展开完整原文片段</summary><blockquote>{hit.text}</blockquote></details>}
          <div className="rag-hit-basis"><strong>命中依据</strong><p>{hit.match_reasons.length ? hit.match_reasons.join('；') : '按本次问题检索得到的原文片段，可打开定位核对。'}</p></div>
          <div className="rag-hit-actions">{onLocateHit ? <button type="button" onClick={() => onLocateHit(hit)}>定位这段原文 →</button> : onEvidence && <button type="button" onClick={() => onEvidence([hit.source.id])}>定位项目材料</button>}{hit.source.url && /^https?:\/\//i.test(hit.source.url) && <a href={hit.source.url} target="_blank" rel="noreferrer">打开原来源 ↗</a>}</div>
          {decisionLocations && <div className="rag-hit-decisions"><strong>相关决策位置</strong>{locations.length && onNavigateDecision ? <><ul>{locations.slice(0, 3).map(location => <li key={location.id}><button type="button" onClick={() => onNavigateDecision(location)}>{location.label} →</button><p>{location.relation}</p></li>)}</ul>{locations.length > 3 && <details><summary>展开其余 {locations.length - 3} 个引用位置</summary><ul>{locations.slice(3).map(location => <li key={location.id}><button type="button" onClick={() => onNavigateDecision(location)}>{location.label} →</button><p>{location.relation}</p></li>)}</ul></details>}</> : <p>{decisionLinksState === 'loading' ? '正在读取已保存方案的引用关系…' : decisionLinksState === 'unavailable' ? '方案引用关系暂未读取，可先定位原文核对。' : '已保存方案尚未引用此来源；检索命中本身不代表已经形成决策。'}</p>}</div>}
          <details><summary>查看举措、对象、阶段与材料版本</summary><p>版本：{hit.version}</p><p>举措：{[...new Set([...hit.measure_links.map(link => link.measure_name), ...hit.measure_mentions.map(mention => mention.measure_name)])].join(' / ') || '未登记'}</p><p>对象：{hit.objects.join(' / ') || '未明确'}；阶段：{hit.stages.join(' / ') || '未记载'}</p>{!floating && <p>原文相关性排序分：{hit.score}，分数不表示可信概率。</p>}</details>
        </article>
      })}
      {!result.hits.length && <div className="rag-empty-results"><p>本次范围没有匹配原文。可更换问题中的具体对象或事项，或清除已设定的筛选后重查。</p>{filtered && <button type="button" onClick={() => search(true)}>清除筛选并重查</button>}{onEvidence && <button type="button" onClick={() => onEvidence([])}>查看当前项目全部资料</button>}</div>}
      <details><summary>{floating ? '查看检索范围与未采用资料' : `本次检索的范围检查与排除原因 · ${result.skipped.length}项`}</summary><p>{result.score_meaning} {result.ranking_note}</p><p>实际检索词：{result.rank_query}</p>{result.query_expansions.map(item => <p key={item.added_term}>{item.matched_terms.join(' / ')} → {item.added_term}：{item.reason}</p>)}{result.skipped.map((skip, index) => <p key={index}>{skip.document_id}{skip.locator ? ` · ${skip.locator}` : ''}：{skip.reason}</p>)}</details>
    </div>}
  </section>
}
