import { useState } from 'react'
import type { DecisionDashboard as Dashboard, ResearchDimension } from '../../../host/generated/contracts'
import { dashboardDimensions, NEIGHBORHOOD_DASHBOARD_POLICY } from '../../../../packages/decision/dashboard'

/** Missing dimensions are never drawn as zero; individual known marks remain visible. */
export default function DecisionDashboard({value,onEvidence,presentation}:{value:Dashboard;onEvidence:(refs:string[])=>void;presentation?:{title:string;scale:string;method:string}}){
  const [selected,setSelected]=useState<ResearchDimension|null>(null)
  const rows=dashboardDimensions(value.policy_version).map(d=>({...d,result:value.dimensions.find(x=>x.key===d.key)}))
  const known=rows.filter(d=>d.result?.value!=null)
  const xy=(i:number,r:number)=>[84+Math.cos(-Math.PI/2+i*Math.PI/3)*r,84+Math.sin(-Math.PI/2+i*Math.PI/3)*r]
  const polygon=(r:number)=>rows.map((_,i)=>xy(i,r).join(',')).join(' ')
  const selectedRow=rows.find(d=>d.key===selected)
  return <section className="decision-dashboard" aria-label="六维方案研判">
    <header><h3>{presentation?.title || (value.policy_version===NEIGHBORHOOD_DASHBOARD_POLICY?'老旧小区六维观察':'方案研判')}</h3><span>{presentation?.scale || '适配度 · 1–5级'}</span></header>
    <div className="dashboard-visual">
      <svg viewBox="0 0 168 168" role="img" aria-label={`${presentation ? '六维模拟条件覆盖' : '六维方案适配'}，${known.length}个维度已评估`}>
        {[20,40,60].map(r=><polygon key={r} points={polygon(r)} className="radar-grid"/>)}
        {rows.map((d,i)=>{const p=xy(i,60);return <line key={d.key} x1="84" y1="84" x2={p[0]} y2={p[1]} className="radar-spoke"/>})}
        {known.length===6&&<polygon points={rows.map((d,i)=>xy(i,d.result!.value!/5*60).join(',')).join(' ')} className="radar-area"/>}
        {rows.map((d,i)=>{if(d.result?.value==null)return null;const p=xy(i,d.result.value/5*60),next=rows[(i+1)%6].result?.value;return <g key={d.key}>{known.length<6&&next!=null&&<line x1={p[0]} y1={p[1]} x2={xy((i+1)%6,next/5*60)[0]} y2={xy((i+1)%6,next/5*60)[1]} className="radar-edge"/>}<circle cx={p[0]} cy={p[1]} r="3.5" className="radar-point"/></g>})}
        {rows.map((d,i)=>{const p=xy(i,74);return <text key={d.key} x={p[0]} y={p[1]} textAnchor="middle" dominantBaseline="central" className="radar-label">{d.label.slice(0,2)}</text>})}
      </svg>
      <div className="dimension-readout">{rows.map(d=><button key={d.key} className={selected===d.key?'selected':''} aria-pressed={selected===d.key} onClick={()=>setSelected(v=>v===d.key?null:d.key)}>
        <span>{d.label}</span><strong>{d.result?.value==null?'—':d.result.value.toFixed(1)}</strong>
        <span className="dimension-meter" aria-hidden="true">{[1,2,3,4,5].map(n=><i key={n} className={d.result?.value!=null&&d.result.value>=n-.5?'filled':''}/>)}</span>
      </button>)}</div>
    </div>
    {selectedRow&&<div className="dimension-detail"><strong>{selectedRow.label}</strong><p>{selectedRow.result?.basis||selectedRow.question}</p>{!!selectedRow.result?.evidence_refs.length&&<button onClick={()=>onEvidence(selectedRow.result!.evidence_refs)}>查看依据 ↗</button>}</div>}
    <details className="dashboard-method"><summary>评分依据</summary><p>{presentation?.method || '按当前参与方案逐维评价；缺证据的维度留空。点击维度查看原文依据。'}</p>{!presentation && rows.map(d=><p key={d.key}><strong>{d.label}：</strong>{d.levels[0]} → {d.levels[2]} → {d.levels[4]}</p>)}<p>{value.model} · {value.policy_version}</p></details>
  </section>
}
