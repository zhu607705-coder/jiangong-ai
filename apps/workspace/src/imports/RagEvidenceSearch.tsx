import {consumeStream} from '../maps/screening-stream'
import { useEffect, useRef, useState } from 'react'
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
  const resultRoot=useRef<HTMLDivElement|null>(null)
  function inspectTrace(target:'scope'|'hits'|'citations'){const element=resultRoot.current?.querySelector<HTMLElement>(target==='scope'?'.rag-scope-details':target==='hits'?'article':'.rag-answer');if(element?.tagName==='DETAILS')(element as HTMLDetailsElement).open=true;element?.scrollIntoView?.({block:'nearest',behavior:'smooth'})}
  const [question, setQuestion] = useState(initialQuestion ?? '')
  const [measure, setMeasure] = useState(''), [object, setObject] = useState(''), [stage, setStage] = useState(''), [asOf, setAsOf] = useState(''), [includeAI, setIncludeAI] = useState(false)
  const [result, setResult] = useState<RetrievalResponse | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [request, setRequest] = useState<{ projectId: string; revision: number; query: RetrievalRequest } | null>(null)
  const [useAI,setUseAI]=useState(true),[allowInternalAI,setAllowInternalAI]=useState(false)
  const [indexBusy,setIndexBusy]=useState(false),[indexMessage,setIndexMessage]=useState('')
  const indexController=useRef<AbortController|null>(null)
  useEffect(()=>{setAllowInternalAI(false);setIndexMessage('');setIndexBusy(false);return()=>indexController.current?.abort()},[projectId,revision])
  function clearFilters() { setMeasure(''); setObject(''); setStage(''); setAsOf(''); setIncludeAI(false) }
  useEffect(() => { setResult(null); setError(''); setBusy(false); setRequest(null); setQuestion(initialQuestion ?? ''); clearFilters() }, [projectId, revision, initialQuestion])
  useEffect(() => {
    if (!request || request.projectId !== projectId || request.revision !== revision) return
    const controller = new AbortController(); setBusy(true); setError(''); setResult(null)
    const search=async()=>{
      if(!request.query.use_ai)return api<RetrievalResponse>(`/projects/${encodeURIComponent(projectId)}/knowledge/retrieve`,request.query,controller.signal)
      const response=await fetch(`/api/projects/${encodeURIComponent(projectId)}/knowledge/retrieve`,{method:'POST',credentials:'same-origin',signal:controller.signal,headers:{'Content-Type':'application/json','Accept':'application/x-ndjson','X-Requested-With':'haizhizi'},body:JSON.stringify(request.query)})
      if(!response.ok){const error=await response.json().catch(()=>({}));throw new Error(error.detail||'检索未完成')}
      if(!response.headers.get('content-type')?.includes('application/x-ndjson'))return response.json() as Promise<RetrievalResponse>
      let complete:RetrievalResponse|undefined
      await consumeStream<{type:'originals'|'complete';result:RetrievalResponse}|{type:'error';message:string}>(response,controller.signal,event=>{
        if(event.type==='error'){setError(event.message);return}
        setResult(event.result)
        if(event.type==='complete')complete=event.result
      })
      return complete
    }
    void search().then(value=>{if(value&&!controller.signal.aborted)setResult(value)})
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '检索未完成') })
      .finally(() => { if (!controller.signal.aborted) setBusy(false) })
    return () => controller.abort()
  }, [projectId, revision, request])
  function citationHit(id:string):RetrievalHit|undefined{
    const direct=result?.hits.find(hit=>hit.id===id)
    if(direct)return direct
    const parent=result?.hits.find(hit=>hit.context?.some(row=>row.id===id)),context=parent?.context?.find(row=>row.id===id)
    return parent&&context?{...parent,id:context.id,locator:context.locator,text:context.text,matched_excerpt:undefined,context:[],measure_links:[],matched_measure_links:[],measure_mentions:[],stages:[],objects:[],review_statuses:[]}:undefined
  }
  const query: RetrievalRequest = { question: question.trim(), ...(measure.trim() ? { measure_key: measure.trim() } : {}), ...(object.trim() ? { object_ref: object.trim() } : {}), ...(stage.trim() ? { stage: stage.trim() } : {}), ...(asOf ? { as_of: asOf } : {}), include_ai: includeAI, limit: 5,use_ai:useAI,allow_internal_ai:allowInternalAI }
  const filtered = !!(measure || object || stage || asOf || includeAI)
  function search(unrestricted = false) {
    if (!query.question) return
    if (unrestricted) clearFilters()
    setRequest({ projectId, revision, query: unrestricted ? { question: query.question, include_ai: false, limit: 5,use_ai:useAI,allow_internal_ai:allowInternalAI } : query })
  }
  async function buildIndex(){
    indexController.current?.abort()
    const controller=new AbortController();indexController.current=controller
    setIndexBusy(true);setIndexMessage('正在通过API建立语义索引，原文与关键词检索保持可用。')
    try{
      const {question:_question,use_ai:_useAI,...scope}=query
      const value=await api<{status:string;indexed:number;pending:number;model:string|null;warnings:string[]}>(`/projects/${encodeURIComponent(projectId)}/knowledge/index`,scope,controller.signal)
      if(controller.signal.aborted)return
      setIndexMessage(value.status==='unavailable'?'模型API尚未配置，当前可使用关键词检索。':`已索引 ${value.indexed} 个原文窗口${value.pending?`，另有 ${value.pending} 个待处理，可继续建立索引`:'，可进行语义与关键词混合检索'}。`)
    }catch{if(!controller.signal.aborted)setIndexMessage('本次索引未完成，已保存部分和关键词检索继续可用。')}
    finally{if(!controller.signal.aborted)setIndexBusy(false)}
  }
  const filters = <div className="rag-search-filters"><label>举措<select aria-label="RAG举措" value={measure} onChange={event => setMeasure(event.target.value)}><option value="">不限举措</option>{Object.entries(measures).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label>对象标识<input aria-label="RAG对象" value={object} onChange={event => setObject(event.target.value)} placeholder="留空检索项目全部对象" /></label><label>原文登记阶段<input aria-label="RAG阶段" value={stage} onChange={event => setStage(event.target.value)} placeholder="留空查看各阶段" /></label><label>资料截止日期<input aria-label="RAG资料截止日期" type="date" value={asOf} onChange={event => setAsOf(event.target.value)} /></label></div>
  return <section className={`rag-evidence-search${floating ? ' is-floating' : ''}`} aria-label={floating ? '直接问项目资料' : '按研判问题检索原文'} aria-busy={busy}>
    {!floating && <header><h3>围绕研判问题，检索可定位原文</h3><p>查找本项目已导入文件与已收集来源；命中后可定位原文，或查看实际引用它的判断、评估和调查项。</p></header>}
    <form onSubmit={event => { event.preventDefault(); search() }}><label>{floating ? '直接输入你的问题' : '需要核实的问题'}<textarea aria-label={floating ? '直接问资料的问题' : 'RAG研判问题'} value={question} maxLength={500} placeholder="例如：电梯托管费用是多少？停车和邻里中心有哪些安排？" onChange={event => setQuestion(event.target.value)} /></label>{floating ? <details className="rag-floating-filters"><summary>限定资料范围{filtered ? ' · 已限定' : ' · 当前不限举措'}</summary>{filters}</details> : filters}
      <p className="rag-current-scope" aria-label="当前检索范围">{scopeSummary(query)}{filtered && <button type="button" onClick={clearFilters}>清除筛选</button>}</p>
      <div className="rag-api-options"><label><input type="checkbox" checked={useAI} onChange={event=>setUseAI(event.target.checked)}/>AI理解、语义召回与回答</label>{useAI&&<label><input type="checkbox" checked={allowInternalAI} onChange={event=>setAllowInternalAI(event.target.checked)}/>允许本次AI处理内部资料（需服务器开启）</label>}</div>
      <div className="rag-search-submit"><label><input type="checkbox" checked={includeAI} onChange={event => setIncludeAI(event.target.checked)} />包括 AI 研究草稿与模拟资料（单独标注）</label><button type="submit" disabled={busy || indexBusy || !question.trim()}>{busy ? '正在检索与阅读…' : floating ? '查找依据' : '检索原文'}</button></div></form>
    {useAI&&<div className="rag-index-controls"><button type="button" disabled={busy||indexBusy} onClick={()=>void buildIndex()}>{indexBusy?'正在建立语义索引…':'建立 / 更新语义索引'}</button><span>公开资料自动按版本复用索引</span>{indexMessage&&<p role="status">{indexMessage}</p>}</div>}
    <div className="rag-floating-examples" aria-label="资料提问示例">{[
      { label: '供水范围', question: '二次供水改造涉及哪些楼栋和户数，哪些楼栋被排除？' },
      { label: '电梯托管', question: '电梯托管费用如何确定，有哪些管理措施？' },
      { label: '邻里中心', question: '邻里中心和养老服务有哪些改造安排？' },
      { label: '停车改善', question: '现有资料记录了哪些停车和充电设施改善？' },
      { label: '资金投入', question: '更新资金由谁承担，投资和运营费用有什么依据？' },
      { label: '更新模式', question: '综合整治与原拆原建各有哪些实施条件和依据？' },
    ].map(example => <button type="button" key={example.label} onClick={() => { clearFilters(); setQuestion(example.question); setRequest(null); setResult(null) }}>{example.label}</button>)}</div>
    {busy&&result&&<p role="status">已找到 {result.hits.length} 条原文，可以先阅读；语义补充仍在进行。</p>}
    {error && <p role="alert">{error}</p>}
    {result?.project_id === projectId && request?.revision === revision && <div ref={resultRoot} className="rag-search-results">
      <nav className="rag-evidence-process" aria-label="本次资料使用过程">
        <button type="button" onClick={()=>inspectTrace('scope')}><span>资料范围</span><strong>{result.candidate_counts.documents+(result.candidate_counts.source_texts||0)}</strong></button>
        <button type="button" onClick={()=>inspectTrace('scope')}><span>可检索原文</span><strong>{result.candidate_counts.eligible_chunks}</strong></button>
        <button type="button" onClick={()=>inspectTrace('hits')} disabled={!result.hits.length}><span>本轮命中</span><strong>{result.hits.length}</strong></button>
        <button type="button" onClick={()=>inspectTrace('citations')} disabled={!result.assistance?.answer.length}><span>回答引文</span><strong>{new Set(result.assistance?.answer.flatMap(row=>row.citations.map(cite=>JSON.stringify(cite)))||[]).size}</strong></button>
      </nav>
      <p role="status">{result.hits.length}条命中 · {result.candidate_counts.documents}份导入文件{result.candidate_counts.source_texts !== undefined && ` · ${result.candidate_counts.source_texts}份已收集来源`}{!floating && ` · ${result.candidate_counts.eligible_chunks}个符合范围的原文片段`}</p>
      <div className="rag-submitted-scope"><strong>本次问题：{result.question}</strong><p>{request && scopeSummary(request.query)}</p></div>
      {result.assistance&&<section className="rag-answer" aria-label="资料回答与后续查证"><header><h3>{result.assistance.answer.length?'资料回答':'继续寻找依据'}</h3><span>{result.method==='api_semantic_bm25'?'语义＋关键词':'关键词检索'}</span></header>
        {result.assistance.answer.map((claim,index)=><div key={index}><p>{claim.text}</p>{claim.citations.map((citation,i)=>{const hit=citationHit(citation.hit_id);return hit&&<div className="rag-answer-citation" key={`${citation.hit_id}:${i}`}><blockquote>{citation.quote}</blockquote><button type="button" onClick={()=>onLocateHit?onLocateHit({...hit,matched_excerpt:citation.quote}):onEvidence?.([hit.source.id])}>原文依据 · {hit.file_name} · {hit.locator} →</button></div>})}</div>)}
        {!!result.assistance.reading_guidance.length&&<div><strong>继续阅读</strong><ul>{result.assistance.reading_guidance.map(text=><li key={text}>{text}</li>)}</ul></div>}
        {!!result.assistance.public_queries.length&&<div><strong>公开资料补查</strong>{result.assistance.public_queries.map(text=><a key={text} href={`https://www.bing.com/search?q=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer">{text} ↗</a>)}</div>}
        {!!result.assistance.internal_requests.length&&<details><summary>需要内部补充的资料</summary><ul>{result.assistance.internal_requests.map(text=><li key={text}>{text}</li>)}</ul></details>}
        <details><summary>API与索引状态</summary><p>{result.assistance.model||'未配置模型'} · 已索引 {result.assistance.index.indexed} / {result.assistance.index.eligible} 个窗口 · 待处理 {result.assistance.index.pending} 个</p>{result.assistance.warnings.map((text,index)=><p key={index}>{text}</p>)}</details>
      </section>}
      {!!featureLocations?.(result.question).length && onNavigateFeature && <nav className="rag-feature-shortcuts" aria-label="相关功能入口"><strong>相关功能入口</strong><p>按问题事项匹配工作台功能；这些入口不表示已经检索到证据或形成了决策。</p>{featureLocations(result.question).map(location => <div key={location.id}><button type="button" onClick={() => onNavigateFeature(location)}>{location.label} →</button><p>{location.detail}</p></div>)}</nav>}
      {result.hits.map(hit => {
        const locations = decisionLocations?.(hit) || []
        const excerpt=hit.matched_excerpt||hit.text
        return <article key={hit.id}>
          <header><h4>{hit.file_name}</h4><span className={`rag-hit-kind kind-${hit.source_kind}`}>{kinds[hit.source_kind]}</span></header>
          <p>原文定位：{hit.locator} · {hit.source_date ? `来源 ${hit.source_date}` : '原来源日期未登记'}{hit.content_status === 'excerpt' ? ' · 已收集摘录' : hit.content_status === 'full_text' ? ' · 已获取正文' : ''}</p>
          <p>{hit.review_statuses.map(value => statuses[value as keyof typeof statuses] || value).join(' / ') || '原文提及，尚未形成已审核字段'}</p>
          <blockquote>{floating && excerpt.length > 280 ? `${excerpt.slice(0, 280)}…` : excerpt}</blockquote>
          {!!hit.context?.length&&<details className="rag-structural-context"><summary>查看所属标题、表头与相邻原文</summary>{hit.context.map(row=><div key={row.id}><strong>{row.relationship==='heading'?'所属标题':row.relationship==='table_header'?'对应表头':'相邻原文'} · {row.locator}</strong><blockquote>{row.text}</blockquote><button type="button" onClick={()=>{const selected=citationHit(row.id);if(selected)onLocateHit?.(selected)}}>定位这一段原文 →</button></div>)}</details>}
          {floating && excerpt.length > 280 && <details><summary>展开完整原文片段</summary><blockquote>{excerpt}</blockquote></details>}
          <div className="rag-hit-basis"><strong>命中依据</strong><p>{hit.match_reasons.length ? hit.match_reasons.join('；') : '按本次问题检索得到的原文片段，可打开定位核对。'}</p></div>
          <div className="rag-hit-actions">{onLocateHit ? <button type="button" onClick={() => onLocateHit(hit)}>定位这段原文 →</button> : onEvidence && <button type="button" onClick={() => onEvidence([hit.source.id])}>定位项目材料</button>}{hit.source.url && /^https?:\/\//i.test(hit.source.url) && <a href={hit.source.url} target="_blank" rel="noreferrer">打开原来源 ↗</a>}</div>
          {decisionLocations && <div className="rag-hit-decisions"><strong>相关决策位置</strong>{locations.length && onNavigateDecision ? <><ul>{locations.slice(0, 3).map(location => <li key={location.id}><button type="button" onClick={() => onNavigateDecision(location)}>{location.label} →</button><p>{location.relation}</p></li>)}</ul>{locations.length > 3 && <details><summary>展开其余 {locations.length - 3} 个引用位置</summary><ul>{locations.slice(3).map(location => <li key={location.id}><button type="button" onClick={() => onNavigateDecision(location)}>{location.label} →</button><p>{location.relation}</p></li>)}</ul></details>}</> : <p>{decisionLinksState === 'loading' ? '正在读取已保存方案的引用关系…' : decisionLinksState === 'unavailable' ? '方案引用关系暂未读取，可先定位原文核对。' : '已保存方案尚未引用此来源；检索命中本身不代表已经形成决策。'}</p>}</div>}
          <details><summary>查看举措、对象、阶段与材料版本</summary><p>版本：{hit.version}</p><p>举措：{[...new Set([...hit.measure_links.map(link => link.measure_name), ...hit.measure_mentions.map(mention => mention.measure_name)])].join(' / ') || '未登记'}</p><p>对象：{hit.objects.join(' / ') || '未明确'}；阶段：{hit.stages.join(' / ') || '未记载'}</p>{!floating && <p>原文相关性排序分：{hit.score}，分数不表示可信概率。</p>}</details>
        </article>
      })}
      {!result.hits.length && <div className="rag-empty-results"><p>本次范围没有匹配原文。可更换问题中的具体对象或事项，或清除已设定的筛选后重查。</p>{filtered && <button type="button" onClick={() => search(true)}>清除筛选并重查</button>}{onEvidence && <button type="button" onClick={() => onEvidence([])}>查看当前项目全部资料</button>}</div>}
      <details className="rag-scope-details"><summary>{floating ? '查看检索范围与未采用资料' : `本次检索的范围检查与排除原因 · ${result.skipped.length}项`}</summary><p>{result.score_meaning} {result.ranking_note}</p><p>实际检索词：{result.rank_query}</p>{result.query_expansions.map(item => <p key={item.added_term}>{item.matched_terms.join(' / ')} → {item.added_term}：{item.reason}</p>)}{result.skipped.map((skip, index) => <p key={index}>{skip.document_id}{skip.locator ? ` · ${skip.locator}` : ''}：{skip.reason}</p>)}</details>
    </div>}
  </section>
}
