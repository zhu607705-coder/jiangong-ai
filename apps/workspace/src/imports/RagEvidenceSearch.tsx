import { useEffect,useState } from 'react'
import { api } from '../api'
import type { RetrievalHit,RetrievalRequest,RetrievalResponse } from '../../../../packages/experience/retrieval'
import './rag-evidence-search.css'

const kinds={public_original:'公开原件',ai_draft:'AI研究草稿',synthetic:'模拟资料',internal_material:'内部材料',unknown:'类别待核'}
const statuses={draft:'草稿待复核',approved:'已审核',rejected:'复核未通过'}
type Props={projectId:string;onEvidence?:(refs:string[])=>void;variant?:'page'|'floating';initialQuestion?:string;onLocateHit?:(hit:RetrievalHit)=>void}
export default function RagEvidenceSearch({projectId,onEvidence,variant='page',initialQuestion,onLocateHit}:Props) {
 const floating=variant==='floating'
 const [question,setQuestion]=useState(initialQuestion??(floating?'':'二次供水改造涉及哪些楼栋和户数，哪些楼栋被排除？'))
 const [measure,setMeasure]=useState(floating?'':'pipe_network'),[object,setObject]=useState(''),[stage,setStage]=useState(''),[asOf,setAsOf]=useState(''),[includeAI,setIncludeAI]=useState(false)
 const [result,setResult]=useState<RetrievalResponse|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('')
 const [request,setRequest]=useState<{projectId:string;query:RetrievalRequest}|null>(null)
 useEffect(()=>{setResult(null);setError('');setBusy(false);setRequest(null);setQuestion(initialQuestion??(floating?'':'二次供水改造涉及哪些楼栋和户数，哪些楼栋被排除？'));setMeasure(floating?'':'pipe_network');setObject('');setStage('');setAsOf('');setIncludeAI(false)},[projectId])
 useEffect(()=>{
  if (!request||request.projectId!==projectId) return
  const controller=new AbortController();setBusy(true);setError('');setResult(null)
  void api<RetrievalResponse>(`/projects/${encodeURIComponent(projectId)}/knowledge/retrieve`,request.query,controller.signal)
   .then(value=>{if(!controller.signal.aborted)setResult(value)})
   .catch(cause=>{if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'检索未完成')})
   .finally(()=>{if(!controller.signal.aborted)setBusy(false)})
  return ()=>controller.abort()
 },[projectId,request])
 function search(){setRequest({projectId,query:{question:question.trim(),...(measure.trim()?{measure_key:measure.trim()}:{}),...(object.trim()?{object_ref:object.trim()}:{}),...(stage.trim()?{stage:stage.trim()}:{}),...(asOf?{as_of:asOf}:{}),include_ai:includeAI,limit:5}})}
 const filters=<div className="rag-search-filters"><label>举措<select aria-label="RAG举措" value={measure} onChange={event=>setMeasure(event.target.value)}><option value="">不限举措</option><option value="pipe_network">供水与管网</option><option value="elevator">电梯</option><option value="maintenance">长效维护</option><option value="public_service">公共服务</option></select></label><label>对象标识<input aria-label="RAG对象" value={object} onChange={event=>setObject(event.target.value)} placeholder="例如 building:29幢"/></label><label>原文登记阶段<input aria-label="RAG阶段" value={stage} onChange={event=>setStage(event.target.value)} placeholder="留空查看各阶段"/></label><label>资料截止日期<input aria-label="RAG资料截止日期" type="date" value={asOf} onChange={event=>setAsOf(event.target.value)}/></label></div>
 return <section className={`rag-evidence-search${floating?' is-floating':''}`} aria-label={floating?'直接问项目资料':'按研判问题检索原文'} aria-busy={busy}>
  {!floating&&<header><h3>围绕研判问题，检索可定位原文</h3><p>按资料范围和版本查找，每条结果都有原文和出处。命中的文字与审核事实分别保留。</p></header>}
  <form onSubmit={event=>{event.preventDefault();search()}}><label>{floating?'直接输入你的问题':'需要核实的问题'}<textarea aria-label={floating?'直接问资料的问题':'RAG研判问题'} value={question} maxLength={500} placeholder={floating?'例如：二次供水涉及哪些楼栋？电梯托管费用有什么依据？':undefined} onChange={event=>setQuestion(event.target.value)}/></label>{floating?<details className="rag-floating-filters"><summary>限定资料范围</summary>{filters}</details>:filters}<div className="rag-search-submit"><label><input type="checkbox" checked={includeAI} onChange={event=>setIncludeAI(event.target.checked)}/>包括AI研究草稿（单独标注）</label><button type="submit" disabled={busy||!question.trim()}>{busy?'正在检索…':floating?'查找依据':'检索原文'}</button></div></form>
  {floating&&<div className="rag-floating-examples" aria-label="资料提问示例">{[
   {label:'供水范围',question:'二次供水改造涉及哪些楼栋和户数，哪些楼栋被排除？'},
   {label:'电梯托管',question:'电梯托管费用如何确定，有哪些管理措施？'},
   {label:'邻里中心',question:'邻里中心和养老服务有哪些改造安排？'},
  ].map(example=><button type="button" key={example.label} onClick={()=>setQuestion(example.question)}>{example.label}</button>)}</div>}
  {error&&<p role="alert">{error}</p>}
  {result?.project_id===projectId&&<div className="rag-search-results">
   <p role="status">{result.hits.length}条命中 · {result.candidate_counts.documents}份材料{!floating&&` · ${result.candidate_counts.eligible_chunks}个符合范围的原文片段`}</p>
   {result.hits.map(hit=><article key={hit.id}>
    <header><h4>{hit.file_name}{!floating&&` · ${hit.locator}`}</h4><span className={`rag-hit-kind kind-${hit.source_kind}`}>{kinds[hit.source_kind]}</span></header>
    <p>{floating?`原文定位：${hit.locator}`:hit.source_date?`来源日期 ${hit.source_date}`:'原来源日期未登记'} · {hit.review_statuses.map(value=>statuses[value as keyof typeof statuses]||value).join(' / ')||'原文提及，尚未形成已审核字段'}</p>
    <blockquote>{floating&&hit.text.length>280?`${hit.text.slice(0,280)}…`:hit.text}</blockquote>
    {floating&&hit.text.length>280&&<details><summary>展开完整原文片段</summary><blockquote>{hit.text}</blockquote></details>}
    {!floating&&<p>{hit.match_reasons.join('；')}</p>}
    <details><summary>{floating?'查看材料版本与范围':'查看举措、对象、阶段与材料版本'}</summary><p>版本：{hit.version}</p><p>举措：{[...new Set([...hit.measure_links.map(link=>link.measure_name),...hit.measure_mentions.map(mention=>mention.measure_name)])].join(' / ')||'未登记'}</p><p>对象：{hit.objects.join(' / ')||'未明确'}；阶段：{hit.stages.join(' / ')||'未记载'}</p>{!floating&&<p>原文相关性排序分：{hit.score}，分数不表示可信概率。</p>}</details>
    <div className="rag-hit-actions">{onLocateHit?<button type="button" onClick={()=>onLocateHit(hit)}>定位对应资料 →</button>:onEvidence&&<button type="button" onClick={()=>onEvidence([hit.source.id])}>定位项目材料</button>}{hit.source.url&&<a href={hit.source.url} target="_blank" rel="noreferrer">打开原来源 ↗</a>}</div>
   </article>)}
   {!result.hits.length&&<p>当前范围没有匹配原文，可检查对象或阶段是否已登记，或补充相应资料。</p>}
   <details><summary>{floating?'查看检索范围与未采用资料':`本次检索的范围检查与排除原因 · ${result.skipped.length}项`}</summary><p>{result.score_meaning} {result.ranking_note}</p><p>实际检索词：{result.rank_query}</p>{result.query_expansions.map(item=><p key={item.added_term}>{item.matched_terms.join(' / ')} → {item.added_term}：{item.reason}</p>)}{result.skipped.map((skip,index)=><p key={index}>{skip.document_id}{skip.locator?` · ${skip.locator}`:''}：{skip.reason}</p>)}</details>
  </div>}
 </section>
}
