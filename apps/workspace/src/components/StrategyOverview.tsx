import { useEffect, useMemo, useRef, useState } from 'react'
import { IconArrowRight, IconSparkles, IconRefresh } from '@tabler/icons-react'
import { api, ADMIN_LOGIN_REQUIRED_EVENT, ADMIN_LOGIN_REQUESTED_EVENT, type Project } from '../api'
import { useWorkbenchAccess } from '../AdminAccess'
import { isQiushiDemoProject } from '../../../../packages/retrofit/qiushi-demo'
import type { DecisionDashboard as Dashboard, DecisionPacket } from '../../../host/generated/contracts'
import { strategyFailureMessage, strategyStageLabel, strategyCallStatus, type StrategyPacket, type StrategyProgress, type StrategyStreamEvent, type PublicStrategyIndexItem } from '../../../../packages/retrofit/strategy'
import type { ResearchRound, ResearchRoundsResponse, ResearchRoundStreamEvent, CreateResearchRoundRequest } from '../../../../packages/retrofit/research-rounds'
import { publicDecisionHref } from '../public-decisions'
import { consumeStream } from '../maps/screening-stream'
import { MODE_LABELS, projectRenewalModeInput, evaluateRenewalModeGate } from '../../../../packages/retrofit/renewal-mode'
import { buildStrategyDemo } from '../../../../packages/retrofit/complete-demo'
import { NEIGHBORHOOD_DASHBOARD_POLICY } from '../../../../packages/decision/dashboard'
import DecisionDashboard from './DecisionDashboard'
import CompleteCommunityDemo from './CompleteCommunityDemo'
import CommunityOperationsPanel from './CommunityOperationsPanel'
import RenewalModePanel from '../maps/RenewalModePanel'
import DecisionBrief from './DecisionBrief'
import ResearchRoundsPanel, { type RoundSubmission } from './ResearchRoundsPanel'
import type { MaterialUploadMetadata } from './InternalMaterialIntake'
import SchemeComparison from './SchemeComparison'
import SingleSchemeWorkspace from './SingleSchemeWorkspace'
import StrategyResearchProgress from './StrategyResearchProgress'
import ResearchReasoningNotes from './ResearchReasoningNotes'
import StrategyContentNotice from './StrategyContentNotice'
import StrategyCurrentAssessment from './StrategyCurrentAssessment'
import type { SchemePane, StrategyWorkspaceNavigation } from './strategy-workspace'
export type { SchemePane, StrategyWorkspaceNavigation } from './strategy-workspace'
import { currentDirectionText } from './strategy-direction-text'
import './strategy-overview.css'

const levels = { low: 1, medium: 3, high: 5, unknown: null }
const dimensions = { demand:'居民需求', supply:'公共服务', adaptation:'居住工程', implementation:'实施协同', operations:'长效维护', resources:'资金交付' }
export type StrategyDirectionSelection = { identity: string; mode: 'comprehensive' | 'rebuild' }
export default function StrategyOverview({ project, demoActive, onEvidence, onInvestigate, packet, publishedPlans = [], onOpenPublishedPlan, directionSelection, onDirectionSelect, onStrategyResult, onUploadMaterial, materialBusy = false, materialRequest = 0, workspacePage, section, pane = 'content', schemeDirection, onNavigate }: {
  project:Project; demoActive:boolean; onEvidence:(refs:string[], sourcePacket?:StrategyPacket)=>void; onInvestigate:()=>void; packet?:DecisionPacket|null;
  publishedPlans?: PublicStrategyIndexItem[]; onOpenPublishedPlan?: (projectId:string)=>void|Promise<void>;
  directionSelection?: StrategyDirectionSelection | null; onDirectionSelect?: (mode: 'comprehensive' | 'rebuild') => void;
  onStrategyResult?: (result: StrategyPacket | null) => void;
  onUploadMaterial?: (file: File, metadata: MaterialUploadMetadata) => Promise<void>; materialBusy?: boolean; materialRequest?: number;
  workspacePage?: 'assessment' | 'scheme'; section?: string; pane?: SchemePane; schemeDirection?: 'comprehensive' | 'rebuild' | null;
  onNavigate?: (target: StrategyWorkspaceNavigation) => void;
}) {
  const access = useWorkbenchAccess(),replay=isQiushiDemoProject(project.id)
  const canWrite = access.canWrite&&!replay
  const [tab,setTab] = useState<'direction'|'plan'|'assessment'|'operations'>(directionSelection?.identity===`${project.id}:${project.context_version}:${demoActive}`?'plan':'direction'),[localSelection,setLocalSelection] = useState<StrategyDirectionSelection|null>(null),[phase,setPhase] = useState<'before'|'after'>('before')
  const [result,setResult] = useState<StrategyPacket|null>(null),[activity,setActivity] = useState<'read'|'research'|null>(null),[error,setError] = useState(''),[sourceIds,setSourceIds] = useState<string[]>([])
  const [progress,setProgress] = useState<StrategyProgress[]>([]),[startedAt,setStartedAt] = useState(0),[elapsed,setElapsed] = useState(0),[stopped,setStopped] = useState(false)
  const [roundState,setRoundState] = useState<{key:string;loading:boolean;error:string;data:ResearchRoundsResponse}>({key:'',loading:false,error:'',data:{rounds:[],materials:[],baseline_candidate:null}})
  const [roundMutation,setRoundMutation] = useState(false)
  const [restoredIdentity,setRestoredIdentity]=useState('')
  const [reasoningResult,setReasoningResult]=useState<{key:string;packet:StrategyPacket}|null>(null)
  const [intakeVisible,setIntakeVisible]=useState(false)
  const [archivedSources,setArchivedSources]=useState<StrategyPacket['sources']|null>(null)
  const roundFlow=canWrite&&!demoActive
  const busy = activity !== null || roundMutation || materialBusy
  const controller = useRef<AbortController|null>(null), identity = `${project.id}:${project.context_version}:${demoActive}`
  const selection=directionSelection===undefined?localSelection:directionSelection
  const path=selection?.identity===identity?selection.mode:null
  const visibleTab=path?tab:'direction'
  const choiceAnchor=useRef<HTMLElement|null>(null)
  const intakeAnchor=useRef<HTMLDivElement|null>(null),briefAnchor=useRef<HTMLDivElement|null>(null)
  const contentAnchor=useRef<HTMLDivElement|null>(null),summaryAnchor=useRef<HTMLElement|null>(null),previousTab=useRef(tab)
  useEffect(()=>{if(previousTab.current===visibleTab)return;previousTab.current=visibleTab;const frame=requestAnimationFrame(()=>(visibleTab==='direction'?summaryAnchor.current:contentAnchor.current)?.scrollIntoView({block:'start',behavior:'smooth'}));return()=>cancelAnimationFrame(frame)},[visibleTab])
  const resultCallback=useRef(onStrategyResult);resultCallback.current=onStrategyResult
  const latestResult=useRef<{key:string;result:StrategyPacket}|null>(null)
  const currentIdentity = useRef(identity); currentIdentity.current=identity
  const endpoint = `/projects/${encodeURIComponent(project.id)}/renewal-strategy?demo=${demoActive}`
  const roundsEndpoint = `/projects/${encodeURIComponent(project.id)}/research-rounds`
  const rounds = roundState.key===identity?roundState.data:{rounds:[],materials:[],baseline_candidate:null}
  const sameScope=(candidate:StrategyPacket)=>candidate.project_id===project.id&&candidate.context_version===project.context_version&&candidate.synthetic===(demoActive||project.input.synthetic)
  function rememberReasoning(next:StrategyPacket|null,key:string) {
    if(currentIdentity.current!==key||!next||!sameScope(next))return
    setReasoningResult(previous=>{
      if(previous?.key!==key)return {key,packet:next}
      const before=Date.parse(previous.packet.created_at),after=Date.parse(next.created_at)
      return Number.isFinite(after)&&(!Number.isFinite(before)||after>before)?{key,packet:next}:previous
    })
  }
  function acceptResult(next:StrategyPacket|null,key:string) {
    if(currentIdentity.current!==key)return
    rememberReasoning(next,key)
    const previous=latestResult.current?.key===key?latestResult.current.result:null
    if(next?.status==='completed'&&next.strategy&&sameScope(next)) {
      const previousTime=Date.parse(previous?.created_at||''),nextTime=Date.parse(next.created_at)
      // Compare result creation, not adoption time or transport completion. Equal or unknown dates do not prove a newer result.
      const selected=!previous||Number.isFinite(nextTime)&&(!Number.isFinite(previousTime)||nextTime>previousTime)?next:previous
      latestResult.current={key,result:selected};setResult(selected)
    } else if(previous)setResult(previous)
    else setResult(next&&sameScope(next)?next:null)
  }
  async function readRounds(signal?:AbortSignal) {
    const key=identity
    setRoundState(previous=>({...previous,key,loading:true,error:''}))
    try {
      const data=await api<ResearchRoundsResponse>(roundsEndpoint,undefined,signal)
      if(!data||!Array.isArray(data.rounds)||!Array.isArray(data.materials))throw new Error('INVALID_ROUNDS')
      if(!signal?.aborted&&currentIdentity.current===key){
        setRoundState({key,loading:false,error:'',data})
        for(const round of data.rounds)if(round.project_id===project.id&&round.context_version===project.context_version){
          if(round.status==='completed'&&round.result?.status==='completed'&&round.result.strategy)acceptResult(round.result,key)
          else rememberReasoning(round.result,key)
        }
      }
    } catch {
      if(!signal?.aborted&&currentIdentity.current===key)setRoundState(previous=>({...previous,key,loading:false,error:'研判轮次暂时无法读取，请重试；已有方案仍可查看。'}))
    }
  }
  function keepRound(round:ResearchRound) {
    setRoundState(previous=>previous.key!==identity?previous:{...previous,data:{...previous.data,rounds:[...previous.data.rounds.filter(row=>row.id!==round.id),round]}})
    const saved=round.result
    if(round.status==='completed'&&saved?.status==='completed'&&saved.strategy)acceptResult(saved,identity)
    else rememberReasoning(saved,identity)
  }
  async function adoptCandidate(candidate:StrategyPacket):Promise<ResearchRound|null> {
    if(!roundFlow||busy)return null
    const key=identity;setRoundMutation(true);setError('')
    try {
      const next=await api<{round:ResearchRound}>(`${roundsEndpoint}/adopt`,{expected_context_version:project.context_version,input_hash:candidate.input_hash})
      if(currentIdentity.current!==key)return null
      keepRound(next.round);return next.round
    } catch { if(currentIdentity.current===key)setError('首轮基线保存未完成，原有方案仍保留，请重试。');return null }
    finally {if(currentIdentity.current===key)setRoundMutation(false)}
  }
  async function startRound(submission:RoundSubmission) {
    if(!roundFlow||busy||roundState.loading||roundState.error)return
    const key=identity
    let parent=rounds.rounds.filter(round=>round.status==='completed'&&round.result?.strategy).sort((a,b)=>a.round_number-b.round_number).at(-1)
    const candidate=rounds.baseline_candidate||(result?.status==='completed'&&result.strategy?result:null)
    if(!parent&&candidate){const adopted=await adoptCandidate(candidate);if(!adopted)return;parent=adopted}
    if(currentIdentity.current!==key)return
    controller.current?.abort();const abort=new AbortController();controller.current=abort
    setActivity('research');setProgress([]);setElapsed(0);setStartedAt(Date.now());setError('');setStopped(false)
    try {
      const input:CreateResearchRoundRequest={...submission,expected_context_version:project.context_version,...(parent?{parent_round_id:parent.id}:{})}
      const created=await api<{round:ResearchRound}>(roundsEndpoint,input,abort.signal)
      if(abort.signal.aborted||currentIdentity.current!==key)return
      keepRound(created.round)
      const response=await fetch(`/api${roundsEndpoint}/${encodeURIComponent(created.round.id)}/run`,{method:'POST',credentials:'same-origin',signal:abort.signal,headers:{'Content-Type':'application/json','Accept':'application/x-ndjson','X-Requested-With':'haizhizi'},body:'{}'})
      if(!response.ok)throw new Error('ROUND_REQUEST_FAILED')
      let next:StrategyPacket|null=null
      const accept=(event:ResearchRoundStreamEvent)=>{
        if(abort.signal.aborted||currentIdentity.current!==key)return
        if(event.type==='progress')setProgress(current=>[...current,event])
        else if(event.type==='complete'){next=event.result;keepRound(event.round)}
        else {if(event.round)keepRound(event.round);throw new Error('ROUND_REQUEST_FAILED')}
      }
      if(response.headers.get('content-type')?.includes('application/json')) {
        const saved=await response.json() as {round:ResearchRound;result?:StrategyPacket}
        const savedResult=saved.result||saved.round.result
        if(!savedResult)throw new Error('ROUND_RESULT_MISSING')
        accept({type:'complete',result:savedResult,round:saved.round})
      } else await consumeStream<ResearchRoundStreamEvent>(response,abort.signal,accept)
      if(!abort.signal.aborted&&currentIdentity.current===key&&next) {
        const completed=next as StrategyPacket
        if(completed.status!=='completed'&&latestResult.current?.key===key)setError(`本轮更新失败，展示上次已保存方案。${strategyFailureMessage(completed)}`)
        acceptResult(completed,key)
      }
    } catch {
      if(!abort.signal.aborted&&currentIdentity.current===key)setError('本轮补充研判未完成，首轮基线与已上传文件仍保留。可重新读取轮次后继续。')
    } finally {
      if(!abort.signal.aborted&&currentIdentity.current===key){setActivity(null);void readRounds()}
    }
  }
  async function research(refresh=false, restore=true) {
    controller.current?.abort(); const abort=new AbortController(), key=identity;controller.current=abort
    setActivity(refresh?'research':'read');setError('');setStopped(false)
    if(refresh){setProgress([]);setElapsed(0);setStartedAt(Date.now())}
    try {
      let next=restore?await api<StrategyPacket|null>(endpoint,undefined,abort.signal):null
      if(refresh&&canWrite){
        const response=await fetch(`/api${endpoint}`,{method:'POST',credentials:'same-origin',signal:abort.signal,headers:{'Content-Type':'application/json','Accept':'application/x-ndjson','X-Requested-With':'haizhizi'},body:JSON.stringify({expected_context_version:project.context_version,refresh})})
        if(!response.ok){
          if(response.status===401)window.dispatchEvent(new Event(ADMIN_LOGIN_REQUIRED_EVENT))
          if(response.status===403)window.dispatchEvent(new Event(ADMIN_LOGIN_REQUESTED_EVENT))
          throw new Error('STRATEGY_REQUEST_FAILED')
        }
        if(response.headers.get('content-type')?.includes('application/json'))next=await response.json() as StrategyPacket
        else {
          await consumeStream<StrategyStreamEvent>(response,abort.signal,event=>{
            if(abort.signal.aborted||currentIdentity.current!==key)return
            if(event.type==='progress')setProgress(current=>[...current,event])
            else if(event.type==='complete')next=event.result
            else throw new Error('STRATEGY_REQUEST_FAILED')
          })
        }
      }
      if(!abort.signal.aborted&&currentIdentity.current===key){
        if(next&&next.status!=='completed'&&latestResult.current?.key===key)setError(`本轮更新失败，展示上次已保存方案。${strategyFailureMessage(next)}`)
        acceptResult(next,key)
      }
    }catch{if(!abort.signal.aborted&&currentIdentity.current===key)setError(refresh?'研究连接未完成，请检查工作台连接后查看已保存结果。':'更新方案读取失败，请检查工作台连接后重试。')}
    finally{if(!abort.signal.aborted&&currentIdentity.current===key){setActivity(null);setRestoredIdentity(key)}}
  }
  useEffect(()=>{const readAbort=new AbortController();latestResult.current=null;setRestoredIdentity('');setResult(null);setReasoningResult(null);setTab(directionSelection?.identity===identity?'plan':'direction');setLocalSelection(null);setPhase('before');setSourceIds([]);setArchivedSources(null);setProgress([]);setRoundMutation(false);void research();if(roundFlow)void readRounds(readAbort.signal);return()=>{controller.current?.abort();readAbort.abort()}},[identity,canWrite])
  useEffect(()=>{if(!materialRequest)return;setTab('direction');setIntakeVisible(true);const frame=requestAnimationFrame(()=>intakeAnchor.current?.scrollIntoView({block:'start',behavior:'smooth'}));return()=>cancelAnimationFrame(frame)},[materialRequest])
  useEffect(()=>{if(activity!=='research')return;const timer=setInterval(()=>setElapsed(Math.floor((Date.now()-startedAt)/1000)),1000);return()=>clearInterval(timer)},[activity,startedAt])
  const resultMatches=!!result&&result.project_id===project.id&&result.context_version===project.context_version&&result.synthetic===(demoActive||project.input.synthetic)
  const strategy=resultMatches&&result?.status==='completed'?result.strategy:null, selected=strategy?.paths.find(row=>row.mode===path)
  const restoreFinished=restoredIdentity===identity&&(!roundFlow||roundState.key===identity&&!roundState.loading)
  const availableResult=strategy?result:restoreFinished?null:undefined
  useEffect(()=>{if(availableResult!==undefined)resultCallback.current?.(availableResult)},[availableResult,identity])
  const pathText=(text:string)=>path?currentDirectionText(text,path):text
  const modeInput=useMemo(()=>projectRenewalModeInput(project.input),[project.input]),modeGate=evaluateRenewalModeGate(modeInput)
  const guardedRebuild=!!strategy&&(strategy.preferred_mode==='rebuild'&&!modeGate.rebuild_allowed||strategy.preferred_mode==='comprehensive'&&modeGate.direction==='investigate')
  const failed=result?.status==='failed',unavailable=result?.status==='unavailable',failureMessage=error||((failed||unavailable)?strategyFailureMessage(result!):'')
  const latestCall=result?.model_calls.at(-1)
  const heading=(guardedRebuild?(modeGate.direction==='investigate'?'先核实结构处置与拆建前置条件':'本项目以综合整治为研究基线'):strategy?.headline)||(busy?(activity==='read'?'正在读取已保存方案':'正在研究整体更新方案'):error?(error.startsWith('研究连接')?'整体更新方案生成未完成':'更新方案读取失败'):stopped?'本轮研究已停止':failed?'整体更新方案生成失败':unavailable?'整体更新方案暂不可生成':'尚未保存本项目的整体更新方案')
  const summaryParts=(strategy?.summary||'').replace(/\bunknown\b/g,'尚无对应记录').replace(/\bpreferred_mode\s*(?:取|为|=|[:：])\s*(comprehensive|rebuild|compare|investigate)\b/g,(_,mode:keyof typeof MODE_LABELS)=>`研究方式为${MODE_LABELS[mode]}`).split(/(?<=[。！？])/).filter(Boolean)
  const leadSummary=summaryParts.find(text=>/(建议|方向|主路径|主线|策略|比选)/.test(text))||summaryParts[0]||''
  const restSummary=summaryParts.filter(text=>text!==leadSummary).join('')
  const demo=useMemo(()=>buildStrategyDemo(path||'comprehensive'),[path])
  const dashboard = (after:boolean):Dashboard|null => {
    if(!path)return null
    if(demoActive)return after?demo.after:demo.before
    if(!strategy)return null
    return {policy_version:NEIGHBORHOOD_DASHBOARD_POLICY,purpose:after?'改造方案目标':'现况证据适配',model:result?.model_calls.at(-1)?.returned_model||'DeepSeek',request_id:result?.input_hash||'',status:'completed',dimensions:strategy.dimensions.map(row=>({key:row.key,value:levels[after?(path==='comprehensive'?row.comprehensive_level:row.rebuild_level):row.current_level],confidence:null,basis:pathText(after?row[path]:row.current)||'本项说明待完善，完整研究见方向判断页。',evidence_refs:row.evidence_refs}))}
  }
  const current=dashboard(false),after=dashboard(true)
  const otherPublishedPlans = publishedPlans.filter(item => item.project_id !== project.id)
  const openSource=(refs:string[])=>{if(workspacePage){onEvidence(refs,result||undefined);return}setArchivedSources(null);setSourceIds(refs);const local=refs.filter(id=>project.input.sources.some(source=>source.id===id));if(local.length&&visibleTab==='assessment')onEvidence(local)}
  const openRoundEvidence=(refs:string[])=>{const packet=[...rounds.rounds].reverse().find(round=>round.result?.sources.some(source=>refs.includes(source.id)))?.result;if(workspacePage){onEvidence(refs,packet||undefined);return}setArchivedSources(packet?.sources||null);setSourceIds(refs)}
  const stopResearch=()=>{controller.current?.abort();setActivity(null);setStopped(true)}
  const progressPanel=(activity==='research'||progress.length>0||stopped)?<StrategyResearchProgress key={`${identity}:${startedAt}`} events={progress} elapsed={elapsed} onStop={stopResearch}/>:null
  function chooseDirection(mode:'comprehensive'|'rebuild'){setLocalSelection({identity,mode});onDirectionSelect?.(mode);setSourceIds([]);setPhase('before');if(!workspacePage)setTab('plan')}
  function openScheme(mode:'comprehensive'|'rebuild'){chooseDirection(mode);onNavigate?.({view:'scenarios',section:'detail',pane:'content',scheme:mode})}
  const directionMain=<div ref={briefAnchor}>
    {strategy&&result&&!demoActive&&<DecisionBrief key={result.input_hash} result={result} gate={modeGate} showPriorities={!workspacePage} onEvidence={refs=>{setArchivedSources(null);openSource(refs)}} onPlan={()=>workspacePage?onNavigate?.({view:'scenarios',section:'compare'}):choiceAnchor.current?.scrollIntoView({block:'center',behavior:'smooth'})}/>}
    {workspacePage==='assessment'&&<ResearchReasoningNotes result={reasoningResult?.key===identity?reasoningResult.packet:resultMatches?result:null} onEvidence={onEvidence} onScenario={strategy&&path&&onNavigate?pane=>onNavigate({view:'scenarios',section:'detail',pane,scheme:path}):undefined}/>}
    {(!workspacePage||strategy)&&<section ref={choiceAnchor} className="strategy-direction-selection" aria-label="选择本次研究方向"><h3>{workspacePage?'选择当前工作方向':'选择本次研究方向'}</h3><p>{workspacePage?'选择只切换工作对象，系统建议继续按上方资料与条件核验。方案比选可同时查看两个方向。':'结合上方分析与判定标准，明确选择后查看该方向的方案、指标和改后效果。研究方向可返回本页调整。'}</p><div>{(['comprehensive','rebuild'] as const).map(mode=><button key={mode} data-direction-choice={mode} aria-pressed={path===mode} disabled={workspacePage?false:busy||!strategy&&!demoActive} onClick={()=>chooseDirection(mode)}><strong>选择{MODE_LABELS[mode]}</strong><span>{strategy?.paths.find(row=>row.mode===mode)?.title||`${MODE_LABELS[mode]} · ${demoActive?'模拟研究':'待形成项目方案'}`}</span></button>)}</div>{workspacePage&&<button className="secondary strategy-enter-scheme" onClick={()=>path?openScheme(path):onNavigate?.({view:'scenarios',section:'compare'})}>{path?'进入本方向方案':'进入方案比选'} →</button>}</section>}
  </div>
  if(workspacePage){
    const activePage=strategy?workspacePage:'assessment'
    const activeSection=!strategy?'direction':activePage==='assessment'?(['current','cases'].includes(section||'')?section:'direction'):(section==='detail'?'detail':'compare')
    const workingMode=schemeDirection||path
    const currentDashboard:Dashboard=demoActive?demo.before:{policy_version:NEIGHBORHOOD_DASHBOARD_POLICY,purpose:'六维现况',model:latestCall?.returned_model||'已保存研判',request_id:result?.input_hash||'not-evaluated',status:strategy?'completed':'partial',dimensions:Object.entries(dimensions).map(([key,label])=>{const row=strategy?.dimensions.find(item=>item.key===key);return {key:key as keyof typeof dimensions,value:row?levels[row.current_level]:null,confidence:null,basis:row?.current||`${label}尚无本项目评价记录。`,evidence_refs:row?.evidence_refs||[]}})}
    const referenceSources=resultMatches?result?.sources.filter(source=>source.role==='reference')||[]:[]
    return <section className={`strategy-overview strategy-workspace strategy-workspace--${activePage}`} aria-label={activePage==='assessment'?'改造研判':'方案与测算'} data-selected-direction={workingMode||''} data-direction-identity={identity}>
      <header className="strategy-top"><div><h2>{activePage==='assessment'?'改造研判':'方案与测算'}</h2><p>{activePage==='assessment'?'判断模式与适用条件，再解释现况和相关案例。':'在同一资料基线上比选，再进入单方案核对内容、资金与运营。'}</p></div>{activePage==='assessment'&&activeSection==='direction'&&canWrite&&<button className="secondary" onClick={()=>setIntakeVisible(value=>!value)}>{intakeVisible?'返回判断':'补充资料与研判'}</button>}</header>
      <nav className="strategy-subnav" aria-label={activePage==='assessment'?'改造研判子页面':'方案与测算子页面'}>{(!strategy?[['direction','改造方向判断']]:activePage==='assessment'?[['direction','改造方向判断'],['current','六维现况'],['cases','相关案例']]:[['compare','方案比选'],['detail','单方案工作区']]).map(([id,label])=><button key={id} aria-current={activeSection===id?'page':undefined} onClick={()=>onNavigate?.({view:activePage==='assessment'?'assessment':'scenarios',section:id,...(activePage==='scheme'&&id==='detail'&&workingMode?{scheme:workingMode,pane}: {})})}>{label}</button>)}</nav>
      {strategy&&result&&<StrategyContentNotice packet={result}/>}
      {activePage==='assessment'&&activeSection==='direction'&&<RenewalModePanel strategy={strategy?result:null} endpoint={`/projects/${encodeURIComponent(project.id)}/renewal-mode`} contextVersion={project.context_version} input={modeInput} decision={strategy?result?.decision:null}/>}
      {activePage==='assessment'&&activeSection==='direction'&&progressPanel}
      {activity==='read'&&<p className="strategy-workspace-reading" role="status">正在读取本项目已保存方案与资料基线…</p>}
      {failureMessage&&!busy&&<section className="strategy-error" role="alert"><div><strong>{failureMessage}</strong><p>已保存报告与本项目资料继续保留。</p></div>{!!result?.sources.length&&<button onClick={()=>onEvidence(result.sources.map(source=>source.id),result)}>查看已取得资料</button>}<button onClick={()=>void research()}>重新读取已保存成果</button>{canWrite&&<button onClick={()=>setIntakeVisible(true)}>补充资料与重试</button>}</section>}
      {activePage==='assessment'&&activeSection==='direction'&&<>
        {strategy&&<div className="strategy-working-status"><strong>系统核验方向：{MODE_LABELS[modeGate.direction]}</strong><span>当前工作方向：{path?MODE_LABELS[path]:'尚未选择'}</span><span>资料基线 v{result?.context_version??project.context_version}</span></div>}
        {directionMain}
        {roundFlow&&(!strategy||intakeVisible)&&<div ref={intakeAnchor}><ResearchRoundsPanel intakeOnly projectName={project.name} revision={project.context_version} synthetic={project.input.synthetic} rounds={rounds.rounds} materials={rounds.materials} candidate={rounds.baseline_candidate||(result?.status==='completed'&&result.strategy?result:null)} busy={busy} loading={roundState.key!==identity||roundState.loading} error={roundState.key===identity?roundState.error:''} sourceCounts={{public:project.input.sources.filter(source=>source.data_class==='public').length,internal:project.input.sources.filter(source=>source.data_class==='internal').length,synthetic:project.input.sources.filter(source=>source.synthetic).length}} onAdopt={async candidate=>{await adoptCandidate(candidate)}} onStart={startRound} onUpload={onUploadMaterial} onReadCurrent={()=>setIntakeVisible(false)} onEvidence={openRoundEvidence} onReload={()=>void readRounds()}/></div>}
        {result&&<details className="strategy-search-record"><summary>本次研判的资料基线与模型记录</summary><p>项目 {project.id} · 资料 v{result.context_version} · 方案 {result.input_hash}</p>{result.model_calls.map((call,index)=><p key={index}>{strategyStageLabel(call.stage)} · {call.returned_model||call.requested_model} · {strategyCallStatus(call.finish_reason)} · {(call.duration_ms/1000).toLocaleString('zh-CN')} 秒</p>)}</details>}
      </>}
      {activePage==='assessment'&&activeSection==='current'&&result&&<StrategyCurrentAssessment key={`${identity}:${result.input_hash}`} result={result} dashboard={currentDashboard} demoActive={demoActive} descriptions={Object.entries(dimensions).map(([key,label])=>{const row=strategy?.dimensions.find(item=>item.key===key),sim=demo.dimensions.find(item=>item.key===key);return {key,label,text:demoActive?sim?.before||'':row?.current||'尚无对应现况评价，需补充本对象资料。',evidence_refs:row?.evidence_refs||(demoActive?['SIM-BASELINE']:[])}})} onEvidence={onEvidence} onScheme={()=>onNavigate?.({view:'scenarios',section:'detail',...(workingMode?{scheme:workingMode}:{})})}/>}
      {activePage==='assessment'&&activeSection==='cases'&&<section className="strategy-related-cases" aria-label="当前项目相关案例"><header><h3>本次研判关联的对标来源</h3><p>来源与当前项目的适用关系从本轮引用读取；公共案例维护在知识库。</p></header><div>{referenceSources.map(source=>{const reasons=strategy?.rationale.filter(row=>row.source_id===source.id)||[],actions=strategy?.paths.flatMap(row=>row.actions.filter(action=>action.evidence_refs.includes(source.id)).map(action=>({mode:row.mode,title:action.title})))||[];return <article key={source.id}><span>对标参考 · {source.published_at?.slice(0,10)||'来源日期未登记'}</span><h4>{source.title}</h4>{reasons.map((row,index)=><p key={index}>{row.point}</p>)}{!!actions.length&&<p>关联举措：{actions.map(action=>`${MODE_LABELS[action.mode]} · ${action.title}`).join('；')}</p>}<button className="text-button" onClick={()=>onEvidence([source.id],result||undefined)}>查看相关性与原文 →</button></article>})}</div>{!referenceSources.length&&<p className="strategy-workspace-empty">本轮尚未关联可读的对标参考来源。可先查看已有项目资料，或进入案例库查找可用材料。</p>}<button className="secondary" onClick={()=>onNavigate?.({view:'knowledge',section:'cases'})}>进入公共案例库 →</button></section>}
      {activePage==='scheme'&&activeSection==='compare'&&<SchemeComparison project={project} result={strategy?result:null} gate={modeGate} demoActive={demoActive} selectedDirection={path} onOpen={openScheme} onEvidence={onEvidence}/>}
      {activePage==='scheme'&&activeSection==='detail'&&(workingMode?<SingleSchemeWorkspace key={`${identity}:${workingMode}:${result?.input_hash||''}`} project={project} result={strategy?result:null} mode={workingMode} demoActive={demoActive} pane={pane} onNavigate={target=>onNavigate?.(target)} onEvidence={onEvidence}/>:<section className="strategy-scheme-entries" aria-label="选择单方案工作区"><h3>打开要继续研究的方案</h3><p>每个方案使用同一资料基线，并保留自己的参数、运营情景和效果目标。</p><div>{(['comprehensive','rebuild'] as const).map(mode=><button key={mode} data-open-scheme={mode} onClick={()=>openScheme(mode)}><strong>{MODE_LABELS[mode]}</strong><span>打开内容、建设资金、社区运营与敏感性工作区 →</span></button>)}</div></section>)}
    </section>
  }
  return <section className="strategy-overview" aria-label="更新方案总览" data-selected-direction={path||''} data-direction-identity={identity}>
    <header className="strategy-top"><div><span>研判总览</span><h2>{visibleTab==='direction'?'改造方向判断':`${MODE_LABELS[path!]} · ${visibleTab==='plan'?'方案总览':visibleTab==='assessment'?'现况与改后评估':'社区运营推演'}`}</h2><p>{visibleTab==='direction'?'先补充项目资料，看 AI 分析和判断标准，再明确选择本次研究方向。':`当前研究方向：${MODE_LABELS[path!]} · ${project.name}`}</p></div>{visibleTab==='direction'?<button className="secondary" disabled={busy||!canWrite} title={!canWrite?'当前为公开成果浏览':undefined} onClick={()=>roundFlow?intakeAnchor.current?.scrollIntoView({block:'start',behavior:'smooth'}):void research(true,false)}><IconRefresh size={17}/>{roundFlow?'补充资料与分轮研判':canWrite&&!result?'开始研究':'重新检索与研判'}</button>:<button className="secondary" onClick={()=>{setSourceIds([]);setTab('direction')}}>返回方向判断</button>}</header>
    <nav className="strategy-subnav" aria-label="研判总览子页面">{([['direction','改造方向判断'],['plan','方案总览'],['assessment','现况与改后评估'],['operations','社区运营推演']] as const).map(([id,label])=><button key={id} disabled={id!=='direction'&&!path} aria-current={visibleTab===id?'page':undefined} onClick={()=>{setSourceIds([]);setTab(id)}}>{label}</button>)}</nav>
    {visibleTab==='direction'&&<section ref={summaryAnchor}>
      {roundFlow?<div ref={intakeAnchor}><ResearchRoundsPanel projectName={project.name} revision={project.context_version} synthetic={project.input.synthetic} rounds={rounds.rounds} materials={rounds.materials} candidate={rounds.baseline_candidate||(result?.status==='completed'&&result.strategy?result:null)} busy={busy} loading={roundState.key!==identity||roundState.loading} error={roundState.key===identity?roundState.error:''} sourceCounts={{public:project.input.sources.filter(source=>source.data_class==='public').length,internal:project.input.sources.filter(source=>source.data_class==='internal').length,synthetic:project.input.sources.filter(source=>source.synthetic).length}} onAdopt={async candidate=>{await adoptCandidate(candidate)}} onStart={startRound} onUpload={onUploadMaterial} onReadCurrent={()=>(strategy?briefAnchor.current:intakeAnchor.current?.querySelector('.research-rounds'))?.scrollIntoView({block:'start',behavior:'smooth'})} onEvidence={openRoundEvidence} onReload={()=>void readRounds()}>{directionMain}</ResearchRoundsPanel></div>:directionMain}
      <details className="strategy-research-summary" open={!strategy||demoActive}><summary>完整研究摘要与模型记录</summary>
      <article className={`strategy-summary${failed&&!busy?' is-failed':''}`}><div className="strategy-model-label">{strategy?(error?'上次已保存的整体更新方案':'已保存的整体更新方案'):busy?'方案研究 · 进行中':failed?'方案研究 · 生成失败':unavailable?'方案研究 · 暂不可生成':'方案研究 · 尚未生成'}{demoActive?' · 模拟':''}</div><h3>{heading}</h3><p>{guardedRebuild?modeGate.summary:leadSummary||(failureMessage&&!busy?'本轮尚未形成完整的方案总览，可继续查看项目原文、已取得资料和历史记录。':'先比较保留建筑的综合整治与原拆原建，再核对结构、规划、居民、资金和安置条件。')}</p>{!guardedRebuild&&restSummary&&<details className="strategy-summary-more"><summary>展开现况与完整说明</summary><p>{restSummary}</p></details>}
        {strategy&&<div className="strategy-direction-label">{demoActive?`模拟研究方向：${MODE_LABELS[strategy.preferred_mode]}`:`当前研究方向：${MODE_LABELS[modeGate.direction]}`}</div>}
        {latestCall&&<div className="strategy-model-record">{latestCall.returned_model?`实际模型：${latestCall.returned_model}`:`请求模型：${latestCall.requested_model} · 未取得返回模型标识`} · {result!.model_calls.length} 条调用记录 · 最近一次耗时 {(latestCall.duration_ms/1000).toLocaleString('zh-CN',{maximumFractionDigits:1})} 秒 · {new Date(result!.created_at).toLocaleString('zh-CN')}</div>}
      </article>
      </details>
      {strategy&&<details className="strategy-original-paths"><summary>查看两方向的完整 AI 方案原文</summary>{strategy.paths.map(row=><article key={row.mode}><h3>{row.title}</h3><p>{row.description}</p>{row.actions.map(action=><div key={action.title}><h4>{action.title}</h4><p>{action.detail}</p></div>)}{row.requirements.map(text=><p key={text}>{text}</p>)}</article>)}<h3>六维原始分析</h3>{strategy.dimensions.map(row=><article key={row.key}><h4>{dimensions[row.key]}</h4><p>现况：{row.current}</p><p>综合整治：{row.comprehensive}</p><p>原拆原建：{row.rebuild}</p></article>)}</details>}
      {strategy && !demoActive && result?.publication?.kind === 'saved_snapshot' && <aside className="strategy-saved-snapshot" aria-label="已保存方案版本"><strong>{replay?'求是村固定演示方案':'本项目已保存的完整方案'} · 资料 v{result.context_version}</strong><p>{replay?'使用已校验的方案与固定资料进行交互回放。':`保存于 ${new Date(result.publication.saved_at).toLocaleString('zh-CN')}。当前研判参数或参考资料已更新；以下保留该次方案、原文依据和六维说明，可公开阅读。`}</p></aside>}
    </section>}
    <div ref={contentAnchor} className="strategy-content-anchor"/>
    {activity==='read'&&<div className="strategy-working" role="status"><IconSparkles size={22}/><div><strong>正在读取已保存的更新方案</strong><p>读取历史方案与原文依据，不自动发起新的模型研究。</p></div></div>}
    {visibleTab==='direction'&&progressPanel}
    {failureMessage&&!busy&&<div className="strategy-error" role="alert"><div><strong>{failureMessage}</strong><p>{result?.sources.length?`已保留 ${result.sources.length} 份来源资料`:'项目原文与历史记录仍可查看'}{result?.research?.queries.length?`及 ${result.research.queries.length} 项检索记录`:''}。</p></div><div className="strategy-error-actions">{!!result?.sources.length&&<button onClick={()=>openSource(result.sources.map(source=>source.id))}>查看已取得资料</button>}{canWrite&&<button onClick={()=>roundFlow?intakeAnchor.current?.scrollIntoView({block:'start',behavior:'smooth'}):void research(true,false)}>{roundFlow?'返回资料补充与轮次':'重新研究'}</button>}</div></div>}
    {visibleTab==='direction'&&<>
      {!strategy&&!busy&&<div className="strategy-empty-project"><p>当前项目“{project.name}” · 资料 v{project.context_version} 尚无已保存的完整方案。</p>{canWrite&&<p>可先回答内部资料询问，再使用现有资料或补充文件开展本轮研判。</p>}{!!otherPublishedPlans.length&&<section className="strategy-published-alternatives" aria-label="其他项目的公开方案"><h3>可以直接阅读这些已公开方案</h3><p>以下成果属于标注的来源项目；打开后切换到该项目，不作为当前项目的分析结论。</p>{otherPublishedPlans.map(item=><a href={publicDecisionHref(item.project_id)} key={item.project_id} onClick={onOpenPublishedPlan?event=>{event.preventDefault();void onOpenPublishedPlan(item.project_id)}:undefined}><strong>{item.headline}</strong><span>来源项目：{item.project_name} · 资料 v{item.strategy_context_version}</span><span>查看完整方案、依据与六维评估 →</span></a>)}</section>}</div>}
      {strategy&&result&&<StrategyContentNotice packet={result}/>}
      {!demoActive&&<RenewalModePanel strategy={result} endpoint={`/projects/${encodeURIComponent(project.id)}/renewal-mode`} contextVersion={project.context_version} input={modeInput} decision={result?.decision}/>}
    </>}
    {visibleTab==='plan'&&path&&<div className="strategy-plan-layout"><main className="strategy-plan-detail">
      {selected?<><h3>{pathText(selected.title)||`${MODE_LABELS[path]}研究方案`}</h3><p>{pathText(selected.description)||'本方向的详细说明见方向判断页完整原文。'}</p><div className="strategy-actions">{selected.actions.filter(action=>pathText(action.title)||pathText(action.detail)).map((action,index)=><article key={action.title}><span>{String(index+1).padStart(2,'0')}</span><div><h4>{pathText(action.title)||'本方向专项核实'}</h4><p>{pathText(action.detail)}</p><button onClick={()=>openSource(action.evidence_refs)}>对应依据</button></div></article>)}</div><details className="strategy-requirements"><summary>展开当前方向的实施前提</summary>{selected.requirements.map(pathText).filter(Boolean).map(requirement=><p key={requirement}>{requirement}</p>)}</details></>:demoActive?<><h3>{MODE_LABELS[path]} · 演示方案</h3><p>{demo.assumptions}</p></>:<p>正在读取当前方向的已保存方案…</p>}
      <button className="secondary" onClick={onInvestigate}>查看当前方向的调查与条件<IconArrowRight size={16}/></button>
    </main><aside className="strategy-selected-condition"><h3>当前方向：{MODE_LABELS[path]}</h3>{path==='rebuild'&&!modeGate.rebuild_allowed?<><p>当前为本方向的前期论证。以下条件需要逐项落实：</p><ul>{modeGate.checks.filter(row=>row.state!=='met').map(row=><li key={row.kind}>{row.label} · {row.state==='unknown'?'待核':row.state==='conflict'?'记录冲突':'未满足'}</li>)}</ul></>:<p>{path==='comprehensive'&&modeGate.direction!=='comprehensive'?'结构与实施条件需要先开展专项核查。':'按本方向的实施前提和资金安排推进前期论证。'}</p>}{demoActive&&<div className="strategy-cost-assumption"><strong>演示预算 {demo.budget_wan.toLocaleString('zh-CN')} 万元</strong><p>{demo.assumptions}</p></div>}{!demoActive&&strategy?.dimensions.find(row=>row.key==='resources')&&<p>{pathText(strategy.dimensions.find(row=>row.key==='resources')![path])}</p>}<button className="secondary" onClick={()=>{setTab('assessment');setPhase('after')}}>查看当前方向改后目标</button></aside></div>}
    {visibleTab==='assessment'&&path&&<section className="strategy-assessment" data-mode={path}><div className="strategy-assessment-controls"><strong>当前方向：{MODE_LABELS[path]}</strong><div className="strategy-choice"><button aria-pressed={phase==='before'} onClick={()=>setPhase('before')}>现有评估</button><button aria-pressed={phase==='after'} onClick={()=>setPhase('after')}>改后目标对照</button></div></div>
      <h3>{phase==='before'?'现有社区的六维现况':`${MODE_LABELS[path]} · 改后目标与落实条件`}</h3><p>{demoActive?'完整模拟 · 同一社区与分母；改后目标和实施条件分别写入逐维解释。':'基于原文的模型适配评价；改后是有前提的方案目标，未知维度留空。'}</p>
      {(phase==='before'?current:after)&&<DecisionDashboard value={(phase==='before'?current:after)!} compare={phase==='after'?current||undefined:undefined} animate onEvidence={openSource} presentation={{title:`${MODE_LABELS[path]} · 现况与改后目标${demoActive?' · 完整模拟':''}`,scale:demoActive?'条件覆盖度 · 1–5级':'证据适配 · 1/3/5级',method:demoActive?'分值=1+4×已满足条件比例，上限5；现况与当前方案使用同一社区基线。': '低/中/高按1/3/5展示本路径的证据适配；未知维度待补充评价。'}}/>}
      {demoActive&&<div className="strategy-cost-assumption"><strong>{MODE_LABELS[path]} · 演示预算 {demo.budget_wan.toLocaleString('zh-CN')} 万元</strong><p>{demo.assumptions}</p></div>}
      <div className="strategy-dimension-cards">{demoActive?demo.dimensions.map(row=><article key={row.key}><h4>{row.label}</h4><p><strong>现况：</strong>{row.before}</p><p><strong>{MODE_LABELS[path]}：</strong>{row.after}</p></article>):strategy?.dimensions.map(row=><article key={row.key}><h4>{dimensions[row.key]}</h4><p><strong>现况：</strong>{pathText(row.current)||'本项现况说明待完善。'}</p><p><strong>{MODE_LABELS[path]}：</strong>{pathText(row[path])||'本方向目标说明待完善。'}</p><button onClick={()=>openSource(row.evidence_refs)}>对应原文</button></article>)}</div>
    </section>}
    {visibleTab==='operations'&&path&&<section className="strategy-current-operations" aria-label={`${MODE_LABELS[path]}运营推演`}><p className="strategy-operations-direction"><strong>{MODE_LABELS[path]}</strong><span>{demoActive?'完整模拟 · 调整需求、排班与预算，比较运营效果':'当前研究方向 · 月度服务与收支推演'}</span></p>{demoActive?<CompleteCommunityDemo key={`${identity}:${path}`} project={project} operationsOnly direction={path}/>:<CommunityOperationsPanel key={`${identity}:${path}`} project={project} direction={path}/>}</section>}
    {!!sourceIds.length&&<section className="strategy-source-detail" aria-label="方案对应依据"><header><h3>{archivedSources?'历史轮次对应依据':'方案对应依据'}</h3><button onClick={()=>setSourceIds([])}>收起</button></header>{sourceIds.map(id=>{const source=(archivedSources||result?.sources)?.find(row=>row.id===id);return source?<article key={id}><strong>{source.title}</strong><p>{source.role==='current'?'本对象资料':'独立对标参考'} · {source.published_at?.slice(0,10)||'发布日期未登记'} · {source.locator}</p><blockquote>{source.text}</blockquote>{source.url&&/^https?:\/\//.test(source.url)&&<a href={source.url} target="_blank" rel="noreferrer">打开来源 ↗</a>}</article>:<p key={id}>{id} · {demoActive?'见模拟底表与上方公式。':'该轮来源暂不可读，可在原始报告中核对来源记录。'}</p>})}</section>}
    {visibleTab==='direction'&&(result?.research||!!result?.model_calls.length)&&<details className="strategy-search-record"><summary>查看实际检索与模型调用记录</summary>{guardedRebuild&&<p>历史模型原始方向：{MODE_LABELS[strategy!.preferred_mode]}；当前展示已应用九项拆建条件门控。</p>}{result?.research?.queries.map(query=><p key={query}>{query}</p>)}{result?.research?.warnings?.map((warning,index)=><p key={`warning-${index}`}>检索缺口：{warning.startsWith('为保留')?'本轮补查尚未执行，相关条件仍待核。':warning.includes('未取得可用正文')?'部分检索主题未取得可用正文，相关条件仍待核。':'部分来源未完整取得或尚待核实。'}</p>)}{result?.model_calls.map((call,index)=><p key={index}>{strategyStageLabel(call.stage)} · {call.returned_model||call.requested_model} · {strategyCallStatus(call.finish_reason)} · 耗时 {(call.duration_ms/1000).toLocaleString('zh-CN',{maximumFractionDigits:1})} 秒 · 已记录用量：输入{call.input_tokens} / 输出{call.output_tokens} tokens</p>)}</details>}
  </section>
}
