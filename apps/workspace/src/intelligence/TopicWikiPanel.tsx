import {useEffect,useRef,useState} from 'react'
import {IconArrowLeft,IconArrowRight,IconBook2,IconDownload,IconRefresh} from '@tabler/icons-react'
import {api} from '../api'
import {useWorkbenchAccess} from '../AdminAccess'
import type {TopicDetail,TopicId} from '../../../../packages/intelligence/topic-wiki'
import './topic-wiki.css'

type Card={topic:TopicDetail['topic'];matching_sources:number;selected_sources:number;scan_truncated:boolean;updated_at:string|null;claims:number;stale:boolean;job:TopicDetail['job']}
const labels={finding:'跨材料结论',comparison:'案例差异',conflict:'材料分歧',hypothesis:'推理线索'}
const jobLabel=(job:TopicDetail['job'])=>job?.error==='DAILY_BUDGET_WAIT'?'已排队，等待下一日研读预算':job?.status==='queued'?'主题整理已排队':job?.status==='running'?'正在阅读原文并整理主题':job&&['failed','cancelled','interrupted','blocked_external'].includes(job.status)?'本次整理未完成，原有知识页与资料保留':null
export default function TopicWikiPanel({onSearch}:{onSearch:(query:string)=>void}){
  const {canWrite}=useWorkbenchAccess(),[items,setItems]=useState<Card[]>([]),[id,setId]=useState<TopicId|null>(null),[detail,setDetail]=useState<TopicDetail|null>(null),[busy,setBusy]=useState(false),[loading,setLoading]=useState(false),[error,setError]=useState('')
  const sequence=useRef(0)
  const compileController=useRef<AbortController|null>(null)
  async function load(topic:TopicId|null,signal:AbortSignal){
    if(signal.aborted)return
    const n=++sequence.current;setLoading(true);setError('')
    try{if(topic){const next=await api<TopicDetail>('/intelligence/wiki/topics/'+topic,undefined,signal);if(!signal.aborted&&n===sequence.current)setDetail(next)}else{const next=await api<{items:Card[]}>('/intelligence/wiki/topics',undefined,signal);if(!signal.aborted&&n===sequence.current)setItems(next.items)}}
    catch(e){if(!signal.aborted&&n===sequence.current)setError((e as Error).message)}finally{if(!signal.aborted&&n===sequence.current)setLoading(false)}
  }
  useEffect(()=>{const abort=new AbortController();compileController.current?.abort();setBusy(false);setDetail(null);void load(id,abort.signal);return()=>{abort.abort();compileController.current?.abort();sequence.current++}},[id])
  useEffect(()=>{if(!id||!detail?.job||!['queued','running'].includes(detail.job.status))return;const abort=new AbortController(),timer=setInterval(()=>void load(id,abort.signal),5000);return()=>{clearInterval(timer);abort.abort()}},[id,detail?.job?.status])
  async function compile(){if(!id||busy)return;const abort=new AbortController();compileController.current=abort;setBusy(true);setError('');try{await api('/intelligence/wiki/topics/'+id+'/compile',{},abort.signal);await load(id,abort.signal)}catch(e){if(!abort.signal.aborted)setError((e as Error).message)}finally{if(!abort.signal.aborted)setBusy(false)}}
  return <section className="topic-wiki" aria-label="主题知识 Wiki">
    <header className="topic-wiki-heading"><div><span><IconBook2 size={20}/> LLM Wiki · Topic</span><h2>{detail?.topic.title||'把资料积累成主题知识'}</h2><p>{detail?.topic.question||'围绕改造问题持续整理原文、案例差异和待补数据；新资料到来后修订知识页。'}</p></div>{id&&<button type="button" onClick={()=>setId(null)}><IconArrowLeft size={17}/>全部主题</button>}</header>
    {error&&<p role="alert" className="intel-error">{error}</p>}
    {loading&&!detail&&!items.length&&<p role="status">正在读取主题资料…</p>}
    {!id&&<div className="topic-wiki-grid">{items.map(item=><article key={item.topic.id}><IconBook2 size={26}/><h3>{item.topic.title}</h3><p>{item.topic.question}</p><div className="topic-wiki-counts"><span><b>{item.matching_sources}</b>份相关原文{item.scan_truncated&&'（窗口内）'}</span><span><b>{item.claims}</b>项已整理知识</span></div><span className="intel-status-chip" data-tone={item.stale?'warning':item.updated_at?'success':'neutral'}>{item.stale?'新资料待整合':item.updated_at?'已形成知识页':'原文已归集 · 可整理'}</span><button type="button" onClick={()=>setId(item.topic.id)}>进入主题<IconArrowRight size={18}/></button></article>)}</div>}
    {id&&detail&&<>
      <div className="topic-wiki-toolbar"><p>相关原文 <b>{detail.matching_sources}</b> 份 · {detail.page?`本版综合 ${detail.page.sources.length} 份`:`本次优先整理 ${detail.selected_sources} 份`}{detail.scan_truncated?' · 已达检索窗口，可继续补查':''}</p><div>{canWrite&&<button type="button" className="topic-wiki-primary" disabled={busy||['queued','running'].includes(detail.job?.status||'')||!detail.selected_sources||!!detail.page&&!detail.stale} onClick={()=>void compile()}><IconRefresh size={17}/>{busy?'提交中…':detail.page&&!detail.stale?'本版已更新':detail.page?'整合新增资料':'整理主题知识'}</button>}<button type="button" onClick={()=>{const abort=new AbortController();void load(id,abort.signal)}}>更新状态</button><button type="button" onClick={()=>onSearch(detail.topic.terms[0])}>查找主题原文</button></div></div>
      {detail.stale&&<p className="topic-wiki-notice">已归集新的相关资料。当前展示上一版知识页，可整合新增内容并保留修订历史。</p>}
      {jobLabel(detail.job)&&<p className="topic-wiki-notice" role="status">{jobLabel(detail.job)}</p>}
      {!detail.page&&<div className="topic-wiki-empty"><h3>原文可以进一步整理为主题知识</h3><p>同一主题会同时保留不同对象、地区和阶段，整理可借鉴做法与适用条件；尚需内部取得的数据列入下一步调查。</p></div>}
      {detail.page&&<>
        <div className="topic-wiki-version"><span>更新于 {new Date(detail.page.created_at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})} · 快照 {detail.page.input_hash.slice(0,10)}</span><div><a href={`/api/intelligence/wiki/topics/${id}/export?format=md`}><IconDownload size={15}/>Markdown</a><a href={`/api/intelligence/wiki/topics/${id}/export?format=json`}><IconDownload size={15}/>JSON</a></div></div>
        {Object.entries(labels).map(([kind,label])=>{const claims=detail.page!.claims.filter(c=>c.kind===kind);return !!claims.length&&<section className="topic-wiki-section" key={kind} data-kind={kind}><h3>{label}<span>{claims.length}</span></h3>{claims.map((claim,index)=><article key={index}><p>{claim.text}</p><details><summary>核对 {claim.refs.length} 处原文依据</summary>{claim.refs.map((ref,i)=>{const source=detail.page!.sources.find(s=>s.id===ref.source_id&&s.version===ref.version)!;return <blockquote key={i}><p>{ref.quote}</p><footer><a href={source.url} target="_blank" rel="noopener noreferrer">{source.title} ↗</a><span>{ref.locator} · {source.city||'地区见原文'} · {source.published_at?.slice(0,10)||'日期见原文'} · 版本 {ref.version.slice(0,10)}</span></footer></blockquote>})}</details></article>)}</section>})}
        <section className="topic-wiki-section topic-wiki-questions"><h3>下一步补充与内部调查</h3><ol>{detail.page.questions.map(q=><li key={q}>{q}</li>)}</ol></section>
        {!!detail.page.related_topics.length&&<section className="topic-wiki-related"><h3>相关主题</h3>{detail.page.related_topics.map(related=><button type="button" key={related} onClick={()=>setId(related)}>{{water:'二次供水与管网更新',elevator:'加装电梯与适老更新',dining:'社区食堂与助餐运营'}[related]} →</button>)}</section>}
        <details className="topic-wiki-history"><summary>资料基线与主题版本 · {detail.history.length} 版</summary><p>本版保留每条认识的原文及版本，归集范围内的资料变化会提示整合。</p>{detail.history.map(version=><p key={version.input_hash}>{version.created_at.slice(0,10)} · {version.input_hash.slice(0,12)}</p>)}<ul>{detail.page.sources.map(source=><li key={source.id}><a href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a> · {source.version.slice(0,10)}</li>)}</ul></details>
      </>}
    </>}
  </section>
}
