import {createContext,useContext,useEffect,useRef,useState,type ReactNode} from 'react'
import {IconArrowRight,IconBolt,IconRefresh} from '@tabler/icons-react'
import {api,type Project} from '../api'
import {useWorkbenchAccess} from '../AdminAccess'
import {GUIDANCE_PAGES,PAGE_LABELS,type ProjectGuidance,type GuidanceDirection,type GuidancePage,type GuidancePreference,type GuidanceTarget} from '../../../../packages/decision/project-guidance'
import './project-decision-guidance.css'

const GuidanceContext=createContext<ProjectGuidance|null>(null)
export function useProjectDecisionGuidance(packetHash?:string){const result=useContext(GuidanceContext);return result&&!result.stale&&(!packetHash||result.strategy_hash===packetHash)?result:null}
export function orderByDecision<T>(rows:readonly T[],ranks:readonly {id:string;score:number}[],id:(row:T)=>string){const scores=new Map(ranks.map(row=>[row.id,row.score]));return [...rows].sort((a,b)=>(scores.get(id(b))??-1)-(scores.get(id(a))??-1))}

export default function ProjectDecisionGuidance({project,page,direction,packetHash,onNavigate,children}:{project:Project;page:string;direction:GuidanceDirection;packetHash?:string;onNavigate:(target:GuidanceTarget)=>void;children:ReactNode}){
 const {canWrite}=useWorkbenchAccess(),[preference,setPreference]=useState<GuidancePreference>('balanced')
 const [state,setState]=useState<{key:string;result:ProjectGuidance|null}>({key:'',result:null}),[busy,setBusy]=useState(false),[error,setError]=useState(''),[expanded,setExpanded]=useState(false)
 const controller=useRef<AbortController|null>(null),identity=useRef('')
 const enabled=project.input.business_profile==='neighborhood',key=[project.id,project.context_version,direction,preference,packetHash].join('|');identity.current=key
 const endpoint=`/projects/${encodeURIComponent(project.id)}/decision-guidance`
 const belongs=(value:ProjectGuidance|null)=>!!value&&value.policy==='project-decision-guidance-v1'&&value.project_id===project.id&&value.context_version===project.context_version&&value.direction===direction&&value.preference===preference
 useEffect(()=>{
  const abort=new AbortController();controller.current?.abort();controller.current=abort;setBusy(false);setError('');setExpanded(false);setState({key,result:null})
  if(enabled)void api<ProjectGuidance|null>(`${endpoint}?direction=${direction||'unselected'}&preference=${preference}`,undefined,abort.signal).then(result=>{if(!abort.signal.aborted&&identity.current===key)setState({key,result:belongs(result)?result:null})}).catch(()=>{})
  return()=>abort.abort()
 },[key,enabled])
 const result=state.key===key?state.result:null
 const focus=GUIDANCE_PAGES.includes(page as GuidancePage)?page as GuidancePage:'overview',stage=result?.stages[focus]
 async function judge(){
  if(busy||!canWrite)return
  controller.current?.abort();const abort=new AbortController();controller.current=abort;setBusy(true);setError('')
  try{const next=await api<ProjectGuidance>(endpoint,{expected_context_version:project.context_version,direction,preference,refresh:true},abort.signal);if(!abort.signal.aborted&&identity.current===key){if(!belongs(next))setError('项目资料或工作方向已变化，请刷新后重试。');else if(next.status==='failed')setError(next.error||'本次判断未更新，可稍后重试。');else setState({key,result:next})}}
  catch(error){if(!abort.signal.aborted&&identity.current===key)setError(error instanceof Error?error.message:'本次快速判断未更新。')}
  finally{if(!abort.signal.aborted&&identity.current===key)setBusy(false)}
 }
 const ranked=focus==='scenarios'?result?.measures:result?.materials
 return <GuidanceContext.Provider value={result?.status!=='failed'?result:null}>
  {enabled&&<section className="project-decision-guide" aria-label="Decision 项目工作建议" data-guidance-page={focus}>
   <header><div className="pdg-title"><span><IconBolt size={18}/> Decision 工作建议</span><strong>{busy?'正在比较工作重点与处理顺序':stage?.label||'让现有资料指向下一步'}</strong><p>{busy?'一次分析当前项目的六个工作环节，结果将在各页共用。':stage?.reason||'比较分析重点、举措和调查优先级，再进入对应工作页。'}</p></div><div className="pdg-controls"><label>目标偏好<select aria-label="快速判断目标偏好" value={preference} disabled={busy} onChange={event=>setPreference(event.target.value as GuidancePreference)}><option value="balanced">综合平衡</option><option value="residents">居民改善优先</option><option value="funding">财政承受优先</option></select></label><button type="button" onClick={()=>void judge()} disabled={busy||!canWrite}><IconRefresh size={16}/>{busy?'判断中…':result?'更新工作判断':'快速判断下一步'}</button>{stage&&<button type="button" className="pdg-primary" onClick={()=>onNavigate(stage.target)}>进入建议工作 <IconArrowRight size={16}/></button>}</div></header>
   {error&&<p className="pdg-error" role="status">{error}</p>}
   {result&&<><nav aria-label="Decision 六个工作环节">{GUIDANCE_PAGES.map(item=><button type="button" key={item} aria-current={item===focus?'page':undefined} onClick={()=>onNavigate({page:item,section:item==='evidence'?'files':item==='assessment'?'direction':item==='scenarios'?'compare':item==='actions'?'current':item==='results'?'history':''})}>{PAGE_LABELS[item]}{result.stages[item]&&<i aria-label="已判断"/>}</button>)}</nav>
    {!!ranked?.length&&<div className="pdg-priorities" aria-label={focus==='scenarios'?'Decision 举措优先顺序':'Decision 补充资料优先顺序'}>{ranked.slice(0,3).map((row,index)=><article key={row.id}><span className="pdg-rank">{index+1}</span><div><strong>{row.title}</strong><p>{row.detail}</p></div><span className="pdg-score">{row.score}<small>优先参考</small></span></article>)}</div>}
    <footer><span>资料 v{result.context_version} · {direction==='comprehensive'?'综合整治':direction==='rebuild'?'原拆原建':'方向尚未选择'} · {(result.duration_ms/1000).toFixed(2)} 秒</span><button type="button" aria-expanded={expanded} onClick={()=>setExpanded(value=>!value)}>{expanded?'收起判断依据':'查看各环节判断'}</button></footer>
    {expanded&&<div className="pdg-details">{GUIDANCE_PAGES.map(item=>result.stages[item]&&<article key={item}><strong>{PAGE_LABELS[item]} · {result.stages[item]!.label}</strong><p>{result.stages[item]!.reason}</p></article>)}<p>依据 {result.source_count} 份公开资料与已保存分析，优先参考分为当前目标下的处理顺序。判断不会修改已保存方案或正式实施条件。{result.issues.length>0?'部分判断未返回，其余结果可继续使用。':''}</p><p>Decision · {result.request_id}</p></div>}
   </>}
  </section>}
  {children}
 </GuidanceContext.Provider>
}
