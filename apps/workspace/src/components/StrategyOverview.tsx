import { useEffect, useMemo, useRef, useState } from 'react'
import { IconArrowRight, IconSparkles, IconRefresh } from '@tabler/icons-react'
import { api, ADMIN_LOGIN_REQUIRED_EVENT, ADMIN_LOGIN_REQUESTED_EVENT, type Project } from '../api'
import { useWorkbenchAccess } from '../AdminAccess'
import type { DecisionDashboard as Dashboard, DecisionPacket } from '../../../host/generated/contracts'
import { strategyFailureMessage, strategyStageLabel, strategyCallStatus, type StrategyPacket, type StrategyProgress, type StrategyStreamEvent } from '../../../../packages/retrofit/strategy'
import { consumeStream } from '../maps/screening-stream'
import { MODE_LABELS, projectRenewalModeInput, evaluateRenewalModeGate } from '../../../../packages/retrofit/renewal-mode'
import { buildStrategyDemo } from '../../../../packages/retrofit/complete-demo'
import { NEIGHBORHOOD_DASHBOARD_POLICY } from '../../../../packages/decision/dashboard'
import DecisionDashboard from './DecisionDashboard'
import CompleteCommunityDemo from './CompleteCommunityDemo'
import CommunityOperationsPanel from './CommunityOperationsPanel'
import RenewalModePanel from '../maps/RenewalModePanel'
import './strategy-overview.css'

const levels = { low: 1, medium: 3, high: 5, unknown: null }
const dimensions = { demand:'居民需求', supply:'公共服务', adaptation:'居住工程', implementation:'实施协同', operations:'长效维护', resources:'资金交付' }
const researchSteps = [{ stage: 'sources', label: '读取项目资料' }, { stage: 'research', label: '检索与整理来源' }, { stage: 'model', label: '研究两条更新路径' }, { stage: 'validation', label: '核对原文与条件' }, { stage: 'result', label: '形成完整方案' }] as const
export default function StrategyOverview({ project, demoActive, onEvidence, onInvestigate, packet }: {
  project:Project; demoActive:boolean; onEvidence:(refs:string[])=>void; onInvestigate:()=>void; packet?:DecisionPacket|null;
}) {
  const { canWrite } = useWorkbenchAccess()
  const [tab,setTab] = useState<'plan'|'assessment'|'operations'>('plan'),[path,setPath] = useState<'comprehensive'|'rebuild'>('comprehensive'),[phase,setPhase] = useState<'before'|'after'>('before')
  const [result,setResult] = useState<StrategyPacket|null>(null),[activity,setActivity] = useState<'read'|'research'|null>(null),[error,setError] = useState(''),[sourceIds,setSourceIds] = useState<string[]>([])
  const [progress,setProgress] = useState<StrategyProgress[]>([]),[startedAt,setStartedAt] = useState(0),[elapsed,setElapsed] = useState(0),[stopped,setStopped] = useState(false)
  const busy = activity !== null
  const controller = useRef<AbortController|null>(null), identity = `${project.id}:${project.context_version}:${demoActive}`
  const contentAnchor=useRef<HTMLDivElement|null>(null),summaryAnchor=useRef<HTMLElement|null>(null),previousTab=useRef(tab)
  useEffect(()=>{if(previousTab.current===tab)return;previousTab.current=tab;const frame=requestAnimationFrame(()=>(tab==='plan'?summaryAnchor.current:contentAnchor.current)?.scrollIntoView({block:'start',behavior:'smooth'}));return()=>cancelAnimationFrame(frame)},[tab])
  const currentIdentity = useRef(identity); currentIdentity.current=identity
  const endpoint = `/projects/${encodeURIComponent(project.id)}/renewal-strategy?demo=${demoActive}`
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
            if(event.type==='progress')setProgress(current=>[...current.filter(previous=>previous.stage!==event.stage),event])
            else if(event.type==='complete')next=event.result
            else throw new Error('STRATEGY_REQUEST_FAILED')
          })
        }
      }
      if(!abort.signal.aborted&&currentIdentity.current===key){
        if(next&&next.status!=='completed'&&result?.status==='completed'&&result.strategy)setError(`本轮更新失败，展示上次已保存方案。${strategyFailureMessage(next)}`)
        else setResult(next)
        if(next?.status==='completed'&&(next.strategy?.preferred_mode==='comprehensive'||next.strategy?.preferred_mode==='rebuild'))setPath(next.strategy.preferred_mode==='rebuild'&&!evaluateRenewalModeGate(projectRenewalModeInput(project.input)).rebuild_allowed?'comprehensive':next.strategy.preferred_mode)
      }
    }catch{if(!abort.signal.aborted&&currentIdentity.current===key)setError(refresh?'研究连接未完成，请检查工作台连接后查看已保存结果。':'更新方案读取失败，请检查工作台连接后重试。')}
    finally{if(!abort.signal.aborted&&currentIdentity.current===key)setActivity(null)}
  }
  useEffect(()=>{setResult(null);setTab('plan');setSourceIds([]);setProgress([]);void research();return()=>controller.current?.abort()},[identity,canWrite])
  useEffect(()=>{if(activity!=='research')return;const timer=setInterval(()=>setElapsed(Math.floor((Date.now()-startedAt)/1000)),1000);return()=>clearInterval(timer)},[activity,startedAt])
  const strategy=result?.status==='completed'?result.strategy:null, selected=strategy?.paths.find(row=>row.mode===path)
  const modeInput=useMemo(()=>projectRenewalModeInput(project.input),[project.input]),modeGate=evaluateRenewalModeGate(modeInput)
  const guardedRebuild=!!strategy&&(strategy.preferred_mode==='rebuild'&&!modeGate.rebuild_allowed||strategy.preferred_mode==='comprehensive'&&modeGate.direction==='investigate')
  const failed=result?.status==='failed',unavailable=result?.status==='unavailable',failureMessage=error||((failed||unavailable)?strategyFailureMessage(result!):'')
  const lastProgress=progress.at(-1),completedSteps=researchSteps.filter(step=>progress.some(event=>event.stage===step.stage&&event.status==='completed')).length
  const progressSourceCount=[...progress].reverse().find(event=>event.source_count!==undefined)?.source_count??0
  const sourceCount=busy?progressSourceCount:result?.sources.length??progressSourceCount
  const latestCall=result?.model_calls.at(-1)
  const heading=(guardedRebuild?(modeGate.direction==='investigate'?'先核实结构处置与拆建前置条件':'本项目以综合整治为研究基线'):strategy?.headline)||(busy?(activity==='read'?'正在读取已保存方案':'正在研究整体更新方案'):error?(error.startsWith('研究连接')?'整体更新方案生成未完成':'更新方案读取失败'):stopped?'本轮研究已停止':failed?'整体更新方案生成失败':unavailable?'整体更新方案暂不可生成':'尚未保存本项目的整体更新方案')
  const summaryParts=(strategy?.summary||'').replace(/\bunknown\b/g,'尚无对应记录').split(/(?<=[。！？])/).filter(Boolean)
  const leadSummary=summaryParts.find(text=>/(建议|方向|主路径|主线|策略|比选)/.test(text))||summaryParts[0]||''
  const restSummary=summaryParts.filter(text=>text!==leadSummary).join('')
  const demo=useMemo(()=>buildStrategyDemo(path),[path])
  const dashboard = (after:boolean):Dashboard|null => {
    if(demoActive)return after?demo.after:demo.before
    if(!strategy)return packet?.decision_support?.dashboard||null
    return {policy_version:NEIGHBORHOOD_DASHBOARD_POLICY,purpose:after?'改造方案目标':'现况证据适配',model:result?.model_calls.at(-1)?.returned_model||'DeepSeek',request_id:result?.input_hash||'',status:'completed',dimensions:strategy.dimensions.map(row=>({key:row.key,value:levels[after?(path==='comprehensive'?row.comprehensive_level:row.rebuild_level):row.current_level],confidence:null,basis:after?row[path]:row.current,evidence_refs:row.evidence_refs}))}
  }
  const current=dashboard(false),after=dashboard(true)
  const openSource=(refs:string[])=>{setSourceIds(refs);const local=refs.filter(id=>project.input.sources.some(source=>source.id===id));if(local.length&&tab==='assessment')onEvidence(local)}
  return <section className="strategy-overview" aria-label="更新方案总览">
    <header className="strategy-top"><div><span>研判总览 / 方案总览</span><h2>整体更新策略</h2><p>{demoActive?'杭州样本社区 · 完整模拟':'基于本项目资料与公开案例'} · 综合整治与原拆原建对照</p></div><button className="secondary" disabled={busy||!canWrite} title={!canWrite?'管理员登录后可生成或更新方案':undefined} onClick={()=>void research(true,false)}><IconRefresh size={17}/>{canWrite&&!result?'开始研究':'重新检索与研判'}</button></header>
    {tab==='plan'&&<>
      <article ref={summaryAnchor} className={`strategy-summary${failed&&!busy?' is-failed':''}`}><div className="strategy-model-label">{strategy?(error?'上次已保存的整体更新方案':'已保存的整体更新方案'):busy?'方案研究 · 进行中':failed?'方案研究 · 生成失败':unavailable?'方案研究 · 暂不可生成':'方案研究 · 尚未生成'}{demoActive?' · 模拟':''}</div><h3>{heading}</h3><p>{guardedRebuild?modeGate.summary:leadSummary||(failureMessage&&!busy?'本轮尚未形成完整的方案总览，可继续查看项目原文、已取得资料和历史记录。':'先比较保留建筑的综合整治与原拆原建，再核对结构、规划、居民、资金和安置条件。')}</p>{!guardedRebuild&&restSummary&&<details className="strategy-summary-more"><summary>展开现况与完整说明</summary><p>{restSummary}</p></details>}
        {strategy&&<div className="strategy-direction-label">{guardedRebuild?(modeGate.direction==='investigate'?'当前方向：先核实处置与拆建条件':'当前研究基线：综合整治'):`优先研究：${MODE_LABELS[strategy.preferred_mode]}`}</div>}
        {latestCall&&<div className="strategy-model-record">{latestCall.returned_model?`实际模型：${latestCall.returned_model}`:`请求模型：${latestCall.requested_model} · 未取得返回模型标识`} · {result!.model_calls.length} 条调用记录 · 最近一次耗时 {(latestCall.duration_ms/1000).toLocaleString('zh-CN',{maximumFractionDigits:1})} 秒 · {new Date(result!.created_at).toLocaleString('zh-CN')}</div>}
      </article>
    </>}
    <nav className="strategy-subnav" aria-label="研判总览子页面">{([['plan','方案总览'],['assessment','现况与改后评估'],['operations','社区运营推演']] as const).map(([id,label])=><button key={id} aria-current={tab===id?'page':undefined} onClick={()=>setTab(id)}>{label}</button>)}</nav>
    <div className="strategy-logic" aria-label="整体研判逻辑"><button onClick={()=>setTab('plan')}>01 方案方向</button><IconArrowRight size={15}/><button onClick={()=>{setTab('assessment');setPhase('before')}}>02 现况依据</button><IconArrowRight size={15}/><button onClick={()=>setTab('plan')}>03 模式比选</button><IconArrowRight size={15}/><button onClick={()=>{setTab('assessment');setPhase('after')}}>04 改后目标</button><IconArrowRight size={15}/><button onClick={()=>setTab('operations')}>05 运营验证</button></div>
    <div ref={contentAnchor} className="strategy-content-anchor"/>
    {activity==='read'&&<div className="strategy-working" role="status"><IconSparkles size={22}/><div><strong>正在读取已保存的更新方案</strong><p>读取历史方案与原文依据，不自动发起新的模型研究。</p></div></div>}
    {(activity==='research'||progress.length>0)&&<section className={`strategy-progress${failed&&!busy||error?' is-failed':''}`} aria-label="整体更新方案研究进度" aria-live="polite">
      <header><div><span>研究进度</span><h3>{stopped?'研究已停止':busy?'正在研究整体更新方案':failed||error?'本轮研究未完成':'本轮研究已结束'}</h3></div><div className="strategy-elapsed">{elapsed} 秒{busy&&<button onClick={()=>{controller.current?.abort();setActivity(null);setStopped(true)}}>停止本次研究</button>}</div></header>
      <ol>{researchSteps.map((step,index)=>{const event=[...progress].reverse().find(event=>event.stage===step.stage),state=stopped&&event?.status==='running'?'stopped':event?.status||'pending';return <li key={step.stage} data-state={state}><span className="strategy-step-number">{event?.status==='completed'?'✓':String(index+1).padStart(2,'0')}</span><div><strong>{step.label}</strong><span>{({running:'进行中',completed:'已完成',skipped:'本轮跳过',failed:'未完成',pending:'等待前一步',stopped:'已停止'} as Record<string,string>)[state]}</span></div></li>})}</ol>
      <div className="strategy-progress-summary"><strong>{stopped?'本次研究已停止，已显示的资料与历史方案仍保留。':lastProgress?.message||'研究请求已提交，等待服务返回实际阶段。'}</strong><p>已完成 {completedSteps} 个环节 · 已整理 {sourceCount} 份资料{busy?` · 已等待 ${elapsed} 秒`:''}</p></div>
    </section>}
    {failureMessage&&!busy&&<div className="strategy-error" role="alert"><div><strong>{failureMessage}</strong><p>{result?.sources.length?`已保留 ${result.sources.length} 份来源资料`:'项目原文与历史记录仍可查看'}{result?.research?.queries.length?`及 ${result.research.queries.length} 项检索记录`:''}。</p></div><div className="strategy-error-actions">{!!result?.sources.length&&<button onClick={()=>setSourceIds(result.sources.map(source=>source.id))}>查看已取得资料</button>}{canWrite&&<button onClick={()=>void research(true,false)}>重新研究</button>}</div></div>}
    {tab==='plan'&&<>

      <div className="strategy-plan-layout"><main className="strategy-plan-detail"><div className="strategy-choice" aria-label="选择更新方案"><button aria-pressed={path==='comprehensive'} onClick={()=>setPath('comprehensive')}>综合整治 · 微调更新</button><button aria-pressed={path==='rebuild'} onClick={()=>setPath('rebuild')}>原拆原建 · 整体拆建</button></div>
        {selected&&<><h3>{selected.title}</h3><p>{selected.description}</p><div className="strategy-actions">{selected.actions.map((action,index)=><article key={action.title}><span>{String(index+1).padStart(2,'0')}</span><div><h4>{action.title}</h4><p>{action.detail}</p><button onClick={()=>openSource(action.evidence_refs)}>对应依据</button></div></article>)}</div><details className="strategy-requirements"><summary>展开这条路径的实施前提</summary>{selected.requirements.map(requirement=><p key={requirement}>{requirement}</p>)}</details></>}
        {!strategy&&!busy&&<p>{canWrite?'点击“开始研究”或“重新检索与研判”，根据本项目资料生成具体路径。':'管理员生成并保存方案后，可在此查看具体路径与对应依据。'}</p>}
        {strategy&&<section className="strategy-rationale"><h3>判断依据</h3>{strategy.rationale.map((claim,index)=><article key={index}><p>{claim.point}</p><button onClick={()=>openSource([claim.source_id])}>原文与出处</button></article>)}</section>}
        {strategy&&<section className="strategy-next-checks"><h3>下一步先调查什么</h3>{strategy.next_checks.map(check=><article key={check.title}><h4>{check.title}</h4><p>{check.detail}</p><button onClick={()=>openSource(check.evidence_refs)}>调查依据</button></article>)}<button className="secondary" onClick={onInvestigate}>进入下一步调查<IconArrowRight size={16}/></button></section>}
      </main><aside className="strategy-mode-aside">{demoActive?<div className="strategy-plan-detail"><h3>两种模式，同一社区</h3><p>600户 · 1500人 · 45000㎡</p><p>先比较改造内容与落实条件，再切换六维图查看变化。</p><button className="secondary" onClick={()=>{setTab('assessment');setPhase('after')}}>查看两种模式的六维对照</button><div className="strategy-cost-assumption"><strong>{MODE_LABELS[path]} · {demo.budget_wan.toLocaleString('zh-CN')} 万元</strong><p>{demo.assumptions}</p></div></div>:<RenewalModePanel compact strategy={result} endpoint={`/projects/${encodeURIComponent(project.id)}/renewal-mode`} contextVersion={project.context_version} input={projectRenewalModeInput(project.input)} decision={result?.decision} onInvestigate={onInvestigate}/>}</aside></div>
    </>}
    {tab==='assessment'&&<section className="strategy-assessment" data-mode={path}><div className="strategy-assessment-controls"><div className="strategy-choice"><button aria-pressed={path==='comprehensive'} onClick={()=>setPath('comprehensive')}>综合整治</button><button aria-pressed={path==='rebuild'} onClick={()=>setPath('rebuild')}>原拆原建</button></div><div className="strategy-choice"><button aria-pressed={phase==='before'} onClick={()=>setPhase('before')}>现有评估</button><button aria-pressed={phase==='after'} onClick={()=>setPhase('after')}>改后目标对照</button></div></div>
      <h3>{phase==='before'?'现有社区的六维现况':`${MODE_LABELS[path]} · 改后目标与落实条件`}</h3><p>{demoActive?'完整模拟 · 同一社区与分母；改后目标和实施条件分别写入逐维解释。':'基于原文的模型适配评价；改后是有前提的方案目标，未知维度留空。'}</p>
      {(phase==='before'?current:after)&&<DecisionDashboard value={(phase==='before'?current:after)!} compare={phase==='after'?current||undefined:undefined} animate onEvidence={openSource} presentation={{title:demoActive?'现况与方案六维对照 · 完整模拟':'现况与方案六维对照',scale:demoActive?'条件覆盖度 · 1–5级':'证据适配 · 1/3/5级',method:demoActive?'分值=1+4×已满足条件比例，上限5；两条路径使用同一社区基线。': '低/中/高按1/3/5展示模型对本路径的证据适配；unknown留空；不计算审批总分。'}}/>}
      {demoActive&&<div className="strategy-cost-assumption"><strong>{MODE_LABELS[path]} · 演示预算 {demo.budget_wan.toLocaleString('zh-CN')} 万元</strong><p>{demo.assumptions}</p></div>}
      <div className="strategy-dimension-cards">{demoActive?demo.dimensions.map(row=><article key={row.key}><h4>{row.label}</h4><p><strong>现况：</strong>{row.before}</p><p><strong>{MODE_LABELS[path]}：</strong>{row.after}</p></article>):strategy?.dimensions.map(row=><article key={row.key}><h4>{dimensions[row.key]}</h4><p><strong>现况：</strong>{row.current}</p><p><strong>{MODE_LABELS[path]}：</strong>{row[path]}</p><button onClick={()=>openSource(row.evidence_refs)}>对应原文</button></article>)}</div>
    </section>}
    {tab==='operations'&&(demoActive?<CompleteCommunityDemo project={project}/>:<CommunityOperationsPanel project={project}/>)}
    {!!sourceIds.length&&<section className="strategy-source-detail" aria-label="方案对应依据"><header><h3>方案对应依据</h3><button onClick={()=>setSourceIds([])}>收起</button></header>{sourceIds.map(id=>{const source=result?.sources.find(row=>row.id===id);return source?<article key={id}><strong>{source.title}</strong><p>{source.role==='current'?'本对象资料':'独立对标参考'} · {source.published_at?.slice(0,10)||'发布日期未登记'} · {source.locator}</p><blockquote>{source.text}</blockquote>{source.url&&/^https?:\/\//.test(source.url)&&<a href={source.url} target="_blank" rel="noreferrer">打开来源 ↗</a>}</article>:<p key={id}>{id} · 见模拟底表与上方公式。</p>})}</section>}
    {(result?.research||!!result?.model_calls.length)&&<details className="strategy-search-record"><summary>查看实际检索与模型调用记录</summary>{guardedRebuild&&<p>历史模型原始方向：{MODE_LABELS[strategy!.preferred_mode]}；当前展示已应用九项拆建条件门控。</p>}{result?.research?.queries.map(query=><p key={query}>{query}</p>)}{result?.research?.warnings?.map((warning,index)=><p key={`warning-${index}`}>检索缺口：{warning.startsWith('为保留')?'本轮补查尚未执行，相关条件仍待核。':warning.includes('未取得可用正文')?'部分检索主题未取得可用正文，相关条件仍待核。':'部分来源未完整取得或尚待核实。'}</p>)}{result?.model_calls.map((call,index)=><p key={index}>{strategyStageLabel(call.stage)} · {call.returned_model||call.requested_model} · {strategyCallStatus(call.finish_reason)} · 耗时 {(call.duration_ms/1000).toLocaleString('zh-CN',{maximumFractionDigits:1})} 秒 · 已记录用量：输入{call.input_tokens} / 输出{call.output_tokens} tokens</p>)}</details>}
  </section>
}
