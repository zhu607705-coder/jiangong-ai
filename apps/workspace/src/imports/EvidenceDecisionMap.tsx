import { useEffect, useState } from 'react'
import { api } from '../api'
import type { StrategyPacket } from '../../../../packages/retrofit/strategy'
import { MODE_LABELS } from '../../../../packages/retrofit/renewal-mode'
import './evidence-decision-map.css'

export default function EvidenceDecisionMap({projectId,revision,sourceIds,onEvidence,onOverview}:{projectId:string;revision:number;sourceIds:string[];onEvidence:(refs:string[])=>void;onOverview:()=>void}) {
  const [packet,setPacket]=useState<StrategyPacket|null>(null),[error,setError]=useState(''),[filter,setFilter]=useState('all')
  const [open,setOpen]=useState<string|null>(null)
  useEffect(()=>{const controller=new AbortController();setPacket(null);setError('');setOpen(null)
    void api<StrategyPacket|null>(`/projects/${encodeURIComponent(projectId)}/renewal-strategy?demo=false`,undefined,controller.signal).then(value=>{if(!controller.signal.aborted)setPacket(value)}).catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:'决策对应关系读取未完成。')});return()=>controller.abort()
  },[projectId,revision])
  const rows=[...(packet?.strategy?.rationale||[]).map((claim,index)=>({id:'claim-'+index,label:'整体判断',mode:'all',title:claim.point,refs:[claim.source_id],quote:claim.quote})),
    ...(packet?.strategy?.paths||[]).flatMap(path=>path.actions.map((action,index)=>({id:path.mode+index,label:MODE_LABELS[path.mode],mode:path.mode,title:action.title+'：'+action.detail,refs:action.evidence_refs,quote:''})))].filter(row=>filter==='all'||row.mode==='all'||row.mode===filter)
  return <section className="evidence-decision-map" aria-label="依据与决策对应">
    <header><div><span>资料如何参与判断</span><h3>依据与决策逐项对应</h3><p>先看判断与举措，再展开支持它的原文、范围和出处。</p></div><button onClick={onOverview}>打开方案总览 →</button></header>
    <div className="evidence-decision-filter">{([['all','全部判断'],['comprehensive','综合整治'],['rebuild','原拆原建']] as const).map(([id,label])=><button key={id} aria-pressed={filter===id} onClick={()=>setFilter(id)}>{label}</button>)}</div>
    {error&&<p role="alert">{error}</p>}
    {!rows.length&&<div className="evidence-decision-empty"><p>本项目尚无完成的方案概括。进入方案总览，由 DeepSeek 读取资料并生成判断与举措，对应引用会显示在这里。</p><button onClick={onOverview}>从现有资料开始研判</button></div>}
    {rows.map(row=><article key={row.id} className="evidence-decision-row"><div><span>{row.label}</span><p>{row.title}</p></div><div className="evidence-decision-sources">{row.refs.map(id=>{const source=packet?.sources.find(source=>source.id===id);return source?<div key={id}><strong>{source.title}</strong><p>{source.role==='current'?'本对象资料':'独立对标参考'} · {source.published_at?.slice(0,10)||'未登记日期'}</p><button aria-expanded={open===row.id+id} onClick={()=>setOpen(open===row.id+id?null:row.id+id)}>展开对应依据</button>
      {open===row.id+id&&<div className="evidence-decision-original"><p>来源片段范围：{source.locator}</p><blockquote>{row.quote||source.text}</blockquote>{row.quote&&<details><summary>核对该来源的完整片段</summary><blockquote>{source.text}</blockquote></details>}{source.url&&/^https?:\/\//.test(source.url)&&<a href={source.url} target="_blank" rel="noreferrer">打开原始来源 ↗</a>}{sourceIds.includes(source.id)&&<button onClick={()=>onEvidence([source.id])}>定位项目资料</button>}</div>}</div>:<p key={id}>引用 {id}</p>})}{!row.refs.length&&<p>方案提议 · 尚未引用具体材料</p>}</div></article>)}
  </section>
}
