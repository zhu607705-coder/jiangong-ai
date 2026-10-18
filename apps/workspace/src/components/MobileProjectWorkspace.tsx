import {useEffect,useMemo,useRef,useState,useSyncExternalStore,type ReactNode} from 'react'
import {IconArrowLeft,IconArrowRight,IconAdjustments,IconExternalLink,IconSearch} from '@tabler/icons-react'
import type {Project} from '../api'
import type {ProjectPage} from '../public-decisions'
import type {StrategyPacket} from '../../../../packages/retrofit/strategy'
import type {GuidancePreference} from '../../../../packages/decision/project-guidance'
import type {ResearchRound} from '../../../../packages/retrofit/research-rounds'
import {MODE_LABELS} from '../../../../packages/retrofit/renewal-mode'
import type {StrategyDirection} from './strategy-direction-text'
import {useWorkbenchAccess} from '../AdminAccess'
import {useProjectDecisionGuidance,useProjectGuidanceControls} from './ProjectDecisionGuidance'
import {MobileWorkspaceFocus,MobileModePublisher,type MobileWorkspaceRequest,type MobileModeReport} from './mobile-workspace-context'
import {renewalCheckEmphasis} from './decision-emphasis'
import {mobileProjectChapters,type MobileCard,type MobileTarget} from './mobile-project-model'
import './mobile-project-workspace.css'

function subscribe(callback:()=>void){const query=window.matchMedia('(max-width:760px)');query.addEventListener('change',callback);return ()=>query.removeEventListener('change',callback)}
const getSnapshot=()=>window.matchMedia('(max-width:760px)').matches
export default function MobileProjectWorkspace({project,page,packet,rounds=[],direction,loading,failed,demoActive,active,children,onNavigate,onEvidence,onDirectionSelect,onAskEvidence}:{
  project:Project;page:ProjectPage;packet:StrategyPacket|null;rounds?:ResearchRound[];direction:StrategyDirection|null;loading?:boolean;failed?:boolean;demoActive:boolean;active:boolean;children:ReactNode;
  onNavigate:(page:ProjectPage|'map'|'knowledge',section?:string,pane?:string,scheme?:StrategyDirection)=>void;
  onAskEvidence:()=>void;onEvidence:(refs:string[],packet?:StrategyPacket)=>void;onDirectionSelect:(direction:StrategyDirection)=>void;
}){
  const small=useSyncExternalStore(subscribe,getSnapshot,()=>false),mobile=small&&active&&project.input.business_profile==='neighborhood'&&!demoActive
  const {canWrite}=useWorkbenchAccess(),guidance=useProjectDecisionGuidance(packet?.input_hash),controls=useProjectGuidanceControls()
  const identity=`${project.id}:${project.context_version}:${page}`
  const [selection,setSelection]=useState({identity,chapter:'',index:0})
  const [detailTarget,setDetailTarget]=useState<string|null>(null),[reading,setReading]=useState<string|null>(null),[advice,setAdvice]=useState(false)
  const [request,setRequest]=useState<MobileWorkspaceRequest>(null)
  const [modeReport,setModeReport]=useState<MobileModeReport|null>(null)
  const titleRef=useRef<HTMLHeadingElement>(null),oldIdentity=useRef(identity)
  const chapters=useMemo(()=>{
    const rows=mobileProjectChapters({project,page,packet,rounds,direction,loading,failed})
    const mode=modeReport?.endpoint===`/projects/${encodeURIComponent(project.id)}/renewal-mode`&&modeReport.revision===project.context_version?modeReport:null
    if(mode){
      const conditions=rows.find(c=>c.id==='conditions')
      if(conditions)conditions.cards=mode.checks.map(check=>({id:check.kind,title:check.label,body:check.detail,eyebrow:renewalCheckEmphasis(check).label,tone:renewalCheckEmphasis(check).tone,refs:check.source_ids,target:{page:'assessment',section:'direction'},action:'查看条件与判定'}))
      if(page==='assessment'){
        const card=rows[0].cards[0],met=mode.checks.filter(c=>c.state==='met').length,unknown=mode.checks.filter(c=>c.state==='unknown').length
        card.title=mode.restoring?'正在读取本对象模式判定':mode.running?'改造模式判定正在进行':mode.hasResult?mode.direction==='comprehensive'?'综合整治优先研究':mode.direction==='rebuild'?'原拆原建优先论证':'先补充关键条件':'先开始判定本项目改造模式'
        card.body=mode.restoring?'正在读取本对象已保存的判定记录。':mode.hasResult?mode.summary:mode.progress.at(-1)?.message||'执行原有模式判定后，在这里查看系统建议与条件，后续研究方向由你选择。'
        card.eyebrow=mode.restoring?'读取判定记录':mode.running?'Decision 判定中':mode.hasResult?'已形成模式初判':'尚未开始模式判定';card.direction=mode.hasResult;card.refs=mode.sourceIds
        card.facts=[{label:'工作方向',value:direction?MODE_LABELS[direction]:'尚未选择'},{label:'判定原文',value:`${mode.sourceCount}份`},{label:'条件已满足',value:`${met}/${mode.checks.length}`},{label:'条件待核',value:String(unknown)}]
      }
    }
    return rows
  },[project,page,packet,rounds,direction,loading,failed,modeReport])
  const chapter=(selection.identity===identity?chapters.find(c=>c.id===selection.chapter):null)||chapters[0]
  const index=selection.identity===identity?Math.min(Math.max(0,selection.index),chapter.cards.length-1):0
  const card=chapter.cards[index]
  const full=mobile&&detailTarget===`${project.id}:${page}`
  useEffect(()=>{if(oldIdentity.current!==identity){oldIdentity.current=identity;setReading(null);setAdvice(false);setRequest(previous=>previous&&previous.projectId===project.id&&previous.revision===project.context_version&&page==='actions'?previous:null)}},[identity])
  useEffect(()=>{setReading(null)},[chapter.id,index])
  const choose=(id:string)=>{setSelection({identity,chapter:id,index:0});setReading(null)}
  const turn=(amount:number)=>{setSelection({identity,chapter:chapter.id,index:Math.max(0,Math.min(chapter.cards.length-1,index+amount))});titleRef.current?.focus({preventScroll:true})}
  const open=(target:MobileTarget={page})=>{
    if(target.taskId){
      setRequest({projectId:project.id,revision:project.context_version,taskId:target.taskId});setDetailTarget(null)
      if(target.page!==page){const actions=mobileProjectChapters({project,page:'actions',packet,rounds,direction}).find(c=>c.id==='current');setSelection({identity:`${project.id}:${project.context_version}:actions`,chapter:'current',index:Math.max(0,actions?.cards.findIndex(c=>c.id===target.taskId)||0)});onNavigate('actions','current')}
      return
    }
    setDetailTarget(target.workspace===false?null:`${project.id}:${target.page}`);setReading(null);setAdvice(false)
    onNavigate(target.page,target.section,target.pane,target.scheme)
  }
  const refs=card?.refs||[],currentRefs=new Set(packet?.sources.map(s=>s.id)||[])
  const evidence=()=>onEvidence(refs,refs.every(id=>currentRefs.has(id))?packet||undefined:undefined)
  const adviceStage=guidance?.stages[page]
  const read=reading===card.id
  const facts=(item:MobileCard)=>item.facts?.length?<dl className="mp-facts">{item.facts?.map((fact,i)=><div key={i}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}</dl>:null
  return <MobileModePublisher.Provider value={report=>{if(report.endpoint===`/projects/${encodeURIComponent(project.id)}/renewal-mode`&&report.revision===project.context_version)setModeReport(report)}}><MobileWorkspaceFocus.Provider value={{request,consume:()=>setRequest(null)}}><div className="mobile-project-layout" data-mobile={mobile} data-mode={advice?'advice':full?'details':'summary'}>
    {mobile&&<section className="mobile-project-screen" hidden={full&&!advice} aria-label="手机项目工作区">
      <header className="mp-context"><span>{project.input.synthetic?'模拟资料':'项目资料'} · v{project.context_version}{direction?` · ${MODE_LABELS[direction]}`:''}</span><button type="button" onClick={()=>{setAdvice(!advice);setReading(null)}}><IconAdjustments size={16}/>{advice?'返回本页':'建议'}</button><button type="button" onClick={onAskEvidence} aria-label="手机查项目资料"><IconSearch size={16}/>查资料</button></header>
      {!advice&&<nav className="mp-tabs" aria-label="手机页内切换">{chapters.map(c=><button type="button" key={c.id} aria-pressed={chapter.id===c.id} onClick={()=>choose(c.id)}>{c.label}</button>)}</nav>}
      {advice?<div className="mp-advice"><span className="mp-eyebrow">Decision · 本项目工作建议</span><h2>{controls?.busy?'正在更新工作建议':adviceStage?.label||'选择当前工作的目标偏好'}</h2><p>{adviceStage?.reason||'沿用本项目已有资料和同一套判断，调整各环节的处理顺序。'}</p><label>目标偏好<select aria-label="手机工作建议目标" value={controls?.preference||'balanced'} disabled={controls?.busy||!controls?.canWrite} onChange={event=>controls?.setPreference(event.target.value as GuidancePreference)}><option value="balanced">综合平衡</option><option value="residents">居民改善优先</option><option value="funding">财政承受优先</option></select></label>
        {controls?.error&&<p role="status">{controls.error}</p>}<button type="button" className="mp-primary" disabled={!controls?.canWrite||controls.busy} onClick={()=>controls?.refresh()}>{controls?.busy?'正在判断…':'更新工作建议'}</button>{adviceStage&&<button type="button" onClick={()=>{setAdvice(false);onNavigate(adviceStage.target.page,adviceStage.target.section,adviceStage.target.pane)}}>进入建议工作 <IconArrowRight size={16}/></button>}
      </div>:<div className={`mp-card${read?' is-reading':''}`} data-tone={card.tone||'neutral'}>
        <div className="mp-card-heading"><span className="mp-eyebrow">{card.eyebrow||chapter.label}</span><span className="mp-record-count">{index+1} / {chapter.cards.length}</span></div>
        {read&&<button type="button" className="mp-reading-back" onClick={()=>setReading(null)}><IconArrowLeft size={15}/>返回卡片</button>}
        <div className="mp-card-copy" tabIndex={read?0:undefined} aria-label={read?'完整说明':undefined}>
          <h2 ref={titleRef} tabIndex={-1}>{card.title}</h2><p>{card.body}</p>{facts(card)}
        </div>
        {!read&&card.direction&&<div className="mp-direction" aria-label="手机研究方向选择">{(['comprehensive','rebuild'] as const).map(mode=><button type="button" key={mode} aria-pressed={direction===mode} disabled={!canWrite} onClick={()=>onDirectionSelect(mode)}>{MODE_LABELS[mode]}</button>)}</div>}
        <div className="mp-card-actions"><button type="button" onClick={()=>setReading(read?null:card.id)}>{read?'收起说明':'完整说明'}</button>{refs.length>0&&<button type="button" onClick={evidence}>原文依据</button>}{card.target&&<button type="button" className="mp-primary" onClick={()=>open(card.target)}>{card.action||'打开工作区'}<IconArrowRight size={16}/></button>}</div>
      </div>}
      <footer className="mp-footer">{!advice&&<><button type="button" aria-label="上一条手机卡片" disabled={index===0} onClick={()=>turn(-1)}><IconArrowLeft size={17}/>上一条</button><span aria-live="polite">{chapter.label} · {index+1}/{chapter.cards.length}</span><button type="button" aria-label="下一条手机卡片" disabled={index===chapter.cards.length-1} onClick={()=>turn(1)}>下一条<IconArrowRight size={17}/></button></>}<button type="button" className="mp-workspace-entry" onClick={()=>open()}>完整工作区<IconExternalLink size={15}/></button></footer>
    </section>}
    <section className="mobile-project-original" hidden={mobile&&(!full||advice)} aria-label="完整项目工作区">
      {mobile&&<header className="mp-original-header"><button type="button" onClick={()=>{setDetailTarget(null);setReading(null)}}><IconArrowLeft size={17}/>返回手机摘要</button><span>完整工作区</span></header>}
      <div className="mp-original-content">{children}</div>
    </section>
  </div></MobileWorkspaceFocus.Provider></MobileModePublisher.Provider>
}
