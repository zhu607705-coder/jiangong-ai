import { useEffect, useRef, useState } from 'react'
import { IconSparkles, IconRefresh, IconChevronDown, IconArrowUpRight } from '@tabler/icons-react'
import { api } from '../api'
import type { PlaceSelection } from '../../../../packages/maps/types'
import type { MapScreenAnalysis, MapScreenCell, MapScreenContext, MapScreenProfile, MapScreenTheme, Source } from '../../../host/generated/contracts'
import type { ResearchProgress } from '../../../../packages/research/events'
import { SCREEN_PROFILES, screenTiers } from '../../../../packages/maps/screening-policy'
import { decisionSignals, factorLabels } from '../../../../packages/maps/decision-factors'
import { DecisionRoute } from '../components/DecisionRoute'
import DecisionDashboard from '../components/DecisionDashboard'
import ResearchActivity from '../components/ResearchActivity'
import { analyzeSelection } from './screening-stream'
import { buildPreliminaryResearch } from '../../../../packages/maps/preliminary-research'
import { mapRenewalModeInput } from '../../../../packages/retrofit/renewal-mode'
import RenewalModePanel from './RenewalModePanel'

export default function PreliminaryCard({ selection, profile, cell, onContext, onProfile, onOpenProject, onAssessment }: {
  selection: PlaceSelection; profile: MapScreenProfile; theme: MapScreenTheme; cell: MapScreenCell | null;
  onContext: (id: string, context: MapScreenContext) => void; onProfile: (profile: MapScreenProfile) => void; onOpenProject: (id: string) => void; onAssessment?: (contextId: string, result: MapScreenAnalysis|null) => void;
}) {
  const [context,setContext]=useState<MapScreenContext|null>(null),[analysis,setAnalysis]=useState<MapScreenAnalysis|null>(null)
  const [stage,setStage]=useState<'context'|'analysis'|'done'>('context'),[error,setError]=useState(''),[retry,setRetry]=useState(0)
  const [sourcesOpen,setSourcesOpen]=useState(false),[progress,setProgress]=useState<ResearchProgress[]>([])
  const [tasksOpen,setTasksOpen]=useState(false)
  const analysisAbort=useRef<AbortController|null>(null)
  const callbacks=useRef({onContext,onAssessment});callbacks.current={onContext,onAssessment}
  const restoreAbort=useRef<AbortController|null>(null),viewIdentity=useRef('')
  viewIdentity.current=[selection.id,context?.id,profile].join('|')
  const card=useRef<HTMLElement|null>(null)
  useEffect(()=>{if(!sourcesOpen)card.current?.closest('aside')?.scrollTo({top:0,behavior:'auto'})},[selection.id,profile,sourcesOpen])
  useEffect(()=>{
    const controller=new AbortController();analysisAbort.current?.abort()
    setContext(null);setAnalysis(null);setStage('context');setError('');setSourcesOpen(false);setTasksOpen(false);setProgress([])
    const timer=window.setTimeout(async()=>{
      try{
        const target=cell?.context?.target||{kind:'point',longitude:selection.longitude,latitude:selection.latitude,radius_m:800,bounds:null,label:selection.name,
          label_origin:selection.poi_id?'public':'unresolved',...(selection.poi_id?{object_ref:`amap:${selection.poi_id}`}:{})}
        if(target.label)target.label=target.label.slice(0,180)
        const snapshot=!retry&&cell?.context?.address&&Date.parse(cell.context.expires_at)>Date.now()?cell.context:await api<MapScreenContext>('/maps/screening/context',{target},controller.signal)
        if(controller.signal.aborted)return
        setContext(snapshot);setStage('done');onContext(selection.id,snapshot)
      }catch(e){if(!controller.signal.aborted){setStage('done');setError(e instanceof Error?e.message:'资料暂未取得。')}}
    },180)
    return()=>{window.clearTimeout(timer);controller.abort();analysisAbort.current?.abort()}
  },[selection.id,selection.longitude,selection.latitude,cell?.context?.id,retry])
  function receiveStudy(result:MapScreenAnalysis|null,snapshot:MapScreenContext){
    setAnalysis(result)
    callbacks.current.onContext(selection.id,{...snapshot,research_sources:result?.research_sources,research_records:result?.research_records})
    callbacks.current.onAssessment?.(snapshot.id,result)
  }
  useEffect(()=>{
    analysisAbort.current?.abort();setAnalysis(null);setProgress([]);setError('');setStage(s=>s==='analysis'?'done':s)
    if(!context)return
    const controller=new AbortController(),identity=viewIdentity.current
    restoreAbort.current=controller
    // The local server owns validity, including deadlines, source edits and model
    // configuration. A component memo must not bypass that check on re-entry.
    void api<MapScreenAnalysis|null>(`/maps/screening/analysis/${encodeURIComponent(context.id)}?profile=${profile}`,undefined,controller.signal).then(result=>{
      if(!controller.signal.aborted&&viewIdentity.current===identity)receiveStudy(result,context)
    }).catch(()=>{})
    return()=>controller.abort()
  },[profile,context?.id])
  async function analyze(){
    if(!context||stage==='analysis')return
    restoreAbort.current?.abort()
    const controller=new AbortController();analysisAbort.current=controller
    const identity=viewIdentity.current
    setStage('analysis');setError('');setProgress([])
    try{
      await analyzeSelection(context.id,profile,controller.signal,event=>{
        if(controller.signal.aborted||analysisAbort.current!==controller||viewIdentity.current!==identity)return
        if(event.type==='progress')setProgress(old=>[...old,event].slice(-40))
        if(event.type==='error')setError(event.message)
        if(event.type==='brief'||event.type==='complete')receiveStudy(event.result,context)
      })
    }catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'研究未完成。')}
    finally{if(!controller.signal.aborted&&analysisAbort.current===controller)setStage('done')}
  }
  const model=analysis?.assessment,local=context?.local_projects.filter(p=>p.relation==='within_scope')||[]
  const sourceMap=new Map<string,Source&{ref:string;scope:string}>((context?.local_projects||[]).flatMap(p=>p.sources.map(s=>[`${p.project_id}:${s.id}`,{...s,ref:`${p.project_id}:${s.id}`,scope:p.relation==='city_background'?'城市背景':'所选项目'}] as const)))
  for(const s of analysis?.research_sources||[])if(!sourceMap.has(s.id))sourceMap.set(s.id,{...s,ref:s.id,scope:'公开研究'})
  const sources=[...sourceMap.values()]
  const cite=(refs:string[])=>refs.map(ref=>context?.groups.find(g=>g.source_id===ref)?.label||sourceMap.get(ref)?.title||'来源').join(' · ')
  function showEvidence(refs:string[]){setSourcesOpen(true);requestAnimationFrame(()=>document.getElementById('evidence-'+encodeURIComponent(refs[0]))?.scrollIntoView({block:'nearest',behavior:'auto'}))}
  const signals=context?decisionSignals(context,profile):[]
  const preview=context&&profile==='neighborhood'?buildPreliminaryResearch(context,{sources:analysis?.research_sources,records:analysis?.research_records}):null
  const projectAdvice=profile==='neighborhood'?local.filter(p=>p.business_profile==='neighborhood'&&(context?.target.object_ref===`project:${p.project_id}`||context?.target.boundary_source===`project:${p.project_id}`)).map(p=>p.neighborhood_action).filter(Boolean):[]
  const labels=factorLabels(profile)
  return <section ref={card} className="initial-assessment" aria-label="区域初步分析">
    {stage==='context'&&<p role="status">正在读取所选位置…</p>}
    {context&&<>
      {cell&&<div className="screening-tier" style={{'--tier-color':screenTiers(profile)[cell.tier].color} as React.CSSProperties}><i/>{screenTiers(profile)[cell.tier].label}</div>}
      {profile==='neighborhood'&&<RenewalModePanel key={context.id} endpoint={`/maps/screening/renewal-mode/${encodeURIComponent(context.id)}`} input={mapRenewalModeInput({...context,research_sources:analysis?.research_sources||context.research_sources})} decision={analysis?.decision_support} onInvestigate={local.length===1?()=>onOpenProject(local[0].project_id):undefined}/>}
      {preview&&<div className="preliminary-research" aria-label="对象初步调研">
        <h4>初步调研</h4>
        {preview.lines.map((line,index)=><p key={index}>{line.text}{!!line.sourceRefs.length&&<button className="claim-source" onClick={()=>showEvidence(line.sourceRefs)} title={cite(line.sourceRefs)}>依据</button>}</p>)}
        <div className="preliminary-actions"><button onClick={()=>setSourcesOpen(true)}>查看调研资料</button><button aria-expanded={tasksOpen} onClick={()=>setTasksOpen(v=>!v)}>调研清单</button></div>
        {tasksOpen&&<div className="preliminary-tasks" aria-label="初步调研清单">
          {!!preview.missing.length&&<p>先取得：{preview.missing.join('、')}。</p>}
          {projectAdvice.flatMap(advice=>advice?.missing||[]).slice(0,3).map(task=><p key={task.key}><strong>{task.label}</strong> · {task.where}</p>)}
          {!preview.missing.length&&!projectAdvice.some(advice=>advice?.missing.length)&&<p>回读对象范围、材料时点与当前采购或委托条件，再安排下一项调查。</p>}
          {local.map(p=><button key={p.project_id} onClick={()=>onOpenProject(p.project_id)}>进入项目调研 · {p.name}<IconArrowUpRight size={14}/></button>)}
        </div>}
      </div>}
      {model?<div className="assessment-narrative">
        {analysis?.refresh_required&&<p className="action-condition">此前简报 · 依据已变化</p>}
        <p className="assessment-headline">{model.summary}</p>
        {model.cautions.slice(0,1).map((c,i)=><p className="action-condition" key={i}>{c.text}<button className="claim-source" onClick={()=>showEvidence(c.evidence_refs)} title={cite(c.evidence_refs)}>依据</button></p>)}
        {model.next_steps.slice(0,1).map((step,i)=><p className="next-action" key={i}><strong>下一步</strong>{step}</p>)}
      </div>:stage!=='analysis'&&!preview&&<div className="selection-signals">{signals.length?signals.map(s=><article key={s.title}><h4>{s.title}</h4><p className="signal-observation">{s.observation}</p><p>{s.implication}</p></article>):<p>研究这处空间的具体参与路径。</p>}</div>}
      <div className="assessment-ai-action"><select aria-label="初判研究方向" value={profile} disabled={stage==='analysis'} onChange={e=>onProfile(e.target.value as MapScreenProfile)}><option value="neighborhood">{SCREEN_PROFILES.neighborhood.label}</option><optgroup label="其他方向（历史通用）">{Object.entries(SCREEN_PROFILES).filter(([id])=>id!=="neighborhood").map(([id,p])=><option key={id} value={id}>{p.label}</option>)}</optgroup></select>
        {stage==='analysis'?<button onClick={()=>{analysisAbort.current?.abort();setStage('done');setError(model?'简报已保留，评分已停止。':'已停止，已取得的过程保留。')}}>停止</button>:<button onClick={()=>void analyze()} disabled={!!model&&analysis?.status==='completed'&&!analysis.refresh_required}><IconSparkles size={15}/>{analysis?.refresh_required?'重新取证':model?(analysis?.status==='completed'?'已研判':'重试评分'):'研判此处'}</button>}</div>
      <ResearchActivity events={progress} running={stage==='analysis'}/>
      {analysis?.decision_support?.dashboard&&<DecisionDashboard value={analysis.decision_support.dashboard} onEvidence={showEvidence}/>}
      <button className="assessment-source-toggle" aria-expanded={sourcesOpen} onClick={()=>setSourcesOpen(v=>!v)}>查看依据 <IconChevronDown size={14}/></button>
      {sourcesOpen&&<div className="assessment-sources">
        {model?.opportunities.map((c,i)=><p key={i}>{c.text}<button className="claim-source" onClick={()=>showEvidence(c.evidence_refs)} title={cite(c.evidence_refs)}>依据</button></p>)}
        <p>{cell?cell.boundary_source:'位置周边 800 米'} · {new Date(analysis?.created_at||context.created_at).toLocaleString('zh-CN')}</p>
        {sources.map(s=><div key={s.ref} id={'evidence-'+encodeURIComponent(s.ref)}><strong>{s.title}</strong><p>{s.synthetic?'测试样本':s.scope} · {s.published_at?.slice(0,10)||'发布日期待补'}</p>
          {preview?.observations.filter(row=>row.sourceRefs.includes(s.ref)).map((row,i)=><dl className="preliminary-observation" key={`${row.factId||row.recordId}:${row.locator}:${i}`}><div><dt>{row.label}</dt><dd>{row.value}</dd></div><div><dt>对象范围</dt><dd>{row.scope}</dd></div><div><dt>统计 / 观察时点</dt><dd>{row.observedAt?.slice(0,10)||'未提供'}</dd></div><div><dt>来源发布日期</dt><dd>{row.publishedAt?.slice(0,10)||'未提供'}</dd></div><div><dt>原文定位</dt><dd>{row.locator}</dd></div></dl>)}
          {s.body_truncated&&<p>原文未完整取得，当前实施入口待核。</p>}
          {(analysis?.research_records||[]).filter(r=>r.source_id===s.id).map(r=><dl className="record-fields" key={r.id}>{r.fields.filter(f=>f.value!==null).map(f=><div key={f.key}><dt>{f.label}</dt><dd>{String(f.value)}{f.unit?' '+f.unit:''}</dd></div>)}</dl>)}
          {s.untrusted_text&&<details><summary>原文摘录</summary><p className="evidence-excerpt">{s.untrusted_text}</p></details>}{s.url&&/^https?:\/\//.test(s.url)&&<a href={s.url} target="_blank" rel="noreferrer">原始来源 ↗</a>}</div>)}
        <details><summary>地图线索</summary>{context.groups.map(g=><div key={g.key} id={'evidence-'+encodeURIComponent(g.source_id)}><strong>{g.label}</strong><p>{g.sample.map(p=>p.name).join('、')||g.issue||'暂无样本'}</p></div>)}{signals.map(s=><p key={s.title}>{s.next}</p>)}</details>
        {local.map(p=><button key={p.project_id} onClick={()=>onOpenProject(p.project_id)}>{p.name}<IconArrowUpRight size={14}/></button>)}
        {!!cell?.factors?.some(f=>f.state!=='unknown')&&<details><summary>已有项目条件</summary>{cell.factors.filter(f=>f.state!=='unknown').map(f=><div key={f.key}><strong>{labels[f.key]}</strong><p>{f.summary}</p>{!!f.evidence_refs.length&&<button onClick={()=>showEvidence(f.evidence_refs)}>查看来源</button>}</div>)}</details>}
        <details><summary>模型与研究记录</summary><DecisionRoute value={analysis?.decision_support} details/>{analysis?.research?.queries.map(q=><p key={q}>{q}</p>)}</details>
      </div>}
    </>}
    {(error||analysis?.reason)&&<div className="assessment-retry"><span>{error||analysis?.reason}</span><button aria-label="刷新片区资料" onClick={()=>setRetry(v=>v+1)}><IconRefresh size={14}/>重试</button></div>}
  </section>
}
