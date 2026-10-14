import { useEffect, useState } from 'react'
import { api, type Project } from '../api'
import type { StrategyPacket } from '../../../../packages/retrofit/strategy'

export default function StrategyInvestigations({project,onEvidence}:{project:Project;onEvidence:(refs:string[])=>void}) {
  const [packet,setPacket]=useState<StrategyPacket|null>(null),[status,setStatus]=useState<Record<string,string>>({})
  const key=`hzz-strategy-investigations:${project.id}`
  useEffect(()=>{const controller=new AbortController();setPacket(null)
    try{setStatus(JSON.parse(localStorage.getItem(key)||'{}'))}catch{setStatus({})}
    void api<StrategyPacket|null>(`/projects/${encodeURIComponent(project.id)}/renewal-strategy?demo=false`,undefined,controller.signal).then(value=>{if(!controller.signal.aborted)setPacket(value)}).catch(()=>{});return()=>controller.abort()
  },[project.id,project.context_version])
  if(!packet?.strategy)return null
  function update(id:string,value:string){const next={...status,[id]:value};setStatus(next);localStorage.setItem(key,JSON.stringify(next))}
  return <section className="content-panel strategy-next-checks" aria-label="当前方案调查清单"><h2>当前方案要核实的调查点</h2><p>由本次 Agent 方案生成 · 本机记录调查进度，取得材料后进入资料页上传。</p>
    {packet.strategy.next_checks.map((check,index)=>{const id=`${packet.input_hash}:${index}`;return <article key={id}><h4>{index+1}. {check.title}</h4><p>{check.detail}</p><select aria-label={`${check.title}调查进度`} value={status[id]||'not_started'} onChange={event=>update(id,event.target.value)}><option value="not_started">尚未开展</option><option value="in_progress">正在调查</option><option value="material_received">材料已取得</option></select>{check.evidence_refs.some(id=>project.input.sources.some(source=>source.id===id))&&<button className="text-button" onClick={()=>onEvidence(check.evidence_refs.filter(id=>project.input.sources.some(source=>source.id===id)))}>查看调查依据</button>}</article>})}
  </section>
}
