import { useEffect, useMemo, useRef, useState } from 'react'
import { IconArrowRight, IconSparkles, IconRefresh } from '@tabler/icons-react'
import { api, type Project } from '../api'
import type { DecisionDashboard as Dashboard, DecisionPacket } from '../../../host/generated/contracts'
import { type StrategyPacket } from '../../../../packages/retrofit/strategy'
import { MODE_LABELS, projectRenewalModeInput } from '../../../../packages/retrofit/renewal-mode'
import { buildStrategyDemo } from '../../../../packages/retrofit/complete-demo'
import { NEIGHBORHOOD_DASHBOARD_POLICY } from '../../../../packages/decision/dashboard'
import DecisionDashboard from './DecisionDashboard'
import CompleteCommunityDemo from './CompleteCommunityDemo'
import CommunityOperationsPanel from './CommunityOperationsPanel'
import RenewalModePanel from '../maps/RenewalModePanel'
import './strategy-overview.css'

const levels = { low: 1, medium: 3, high: 5, unknown: null }
const dimensions = { demand:'居民需求', supply:'公共服务', adaptation:'居住工程', implementation:'实施协同', operations:'长效维护', resources:'资金交付' }
export default function StrategyOverview({ project, demoActive, onEvidence, onInvestigate, packet }: {
  project:Project; demoActive:boolean; onEvidence:(refs:string[])=>void; onInvestigate:()=>void; packet?:DecisionPacket|null;
}) {
  const [tab,setTab] = useState<'plan'|'assessment'|'operations'>('plan'),[path,setPath] = useState<'comprehensive'|'rebuild'>('comprehensive'),[phase,setPhase] = useState<'before'|'after'>('before')
  const [result,setResult] = useState<StrategyPacket|null>(null),[busy,setBusy] = useState(false),[error,setError] = useState(''),[sourceIds,setSourceIds] = useState<string[]>([])
  const controller = useRef<AbortController|null>(null), identity = `${project.id}:${project.context_version}:${demoActive}`
  const contentAnchor=useRef<HTMLDivElement|null>(null),summaryAnchor=useRef<HTMLElement|null>(null),previousTab=useRef(tab)
  useEffect(()=>{if(previousTab.current===tab)return;previousTab.current=tab;const frame=requestAnimationFrame(()=>(tab==='plan'?summaryAnchor.current:contentAnchor.current)?.scrollIntoView({block:'start',behavior:'smooth'}));return()=>cancelAnimationFrame(frame)},[tab])
  const currentIdentity = useRef(identity); currentIdentity.current=identity
  const endpoint = `/projects/${encodeURIComponent(project.id)}/renewal-strategy?demo=${demoActive}`
  async function research(refresh=false, restore=true) {
    controller.current?.abort(); const abort=new AbortController(), key=identity;controller.current=abort
    setBusy(true);setError('')
    try {
      let next=restore?await api<StrategyPacket|null>(endpoint,undefined,abort.signal):null
      if(!next||refresh)next=await api<StrategyPacket>(endpoint,{expected_context_version:project.context_version,refresh},abort.signal)
      if(!abort.signal.aborted&&currentIdentity.current===key){setResult(next);if(next?.strategy?.preferred_mode==='comprehensive'||next?.strategy?.preferred_mode==='rebuild')setPath(next.strategy.preferred_mode)}
    }catch(e){if(!abort.signal.aborted&&currentIdentity.current===key)setError(e instanceof Error?e.message:'方案研究未完成。')}
    finally{if(!abort.signal.aborted&&currentIdentity.current===key)setBusy(false)}
  }
  useEffect(()=>{setResult(null);setTab('plan');setSourceIds([]);void research();return()=>controller.current?.abort()},[identity])
  const strategy=result?.strategy, selected=strategy?.paths.find(row=>row.mode===path)
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
    <header className="strategy-top"><div><span>研判总览 / 方案总览</span><h2>整体更新策略</h2><p>{demoActive?'杭州样本社区 · 完整模拟':'基于本项目资料与公开案例'} · 综合整治与原拆原建对照</p></div><button className="secondary" disabled={busy} onClick={()=>void research(true,false)}><IconRefresh size={17}/>重新检索与研判</button></header>
    {tab==='plan'&&<>
      <article ref={summaryAnchor} className="strategy-summary"><div className="strategy-model-label">DeepSeek Flash · Agent 综合方案{demoActive?' · 模拟':''}</div><h3>{strategy?.headline||'正在形成本项目的整体更新方向'}</h3><p>{leadSummary||'先比较保留建筑的综合整治与原拆原建，再核对结构、规划、居民、资金和安置条件。'}</p>{restSummary&&<details className="strategy-summary-more"><summary>展开现况与完整说明</summary><p>{restSummary}</p></details>}
        {strategy&&<div className="strategy-direction-label">优先研究：{MODE_LABELS[strategy.preferred_mode]}</div>}
        {!!result?.model_calls.length&&<div className="strategy-model-record">实际模型：{result.model_calls.at(-1)?.returned_model||result.model_calls.at(-1)?.requested_model} · {result.model_calls.length} 次 Agent 调用 · {result.research?.queries.length||0} 项公开检索 · {new Date(result.created_at).toLocaleString('zh-CN')}</div>}
      </article>
    </>}
    <nav className="strategy-subnav" aria-label="研判总览子页面">{([['plan','方案总览'],['assessment','现况与改后评估'],['operations','社区运营推演']] as const).map(([id,label])=><button key={id} aria-current={tab===id?'page':undefined} onClick={()=>setTab(id)}>{label}</button>)}</nav>
    <div className="strategy-logic" aria-label="整体研判逻辑"><button onClick={()=>setTab('plan')}>01 方案方向</button><IconArrowRight size={15}/><button onClick={()=>{setTab('assessment');setPhase('before')}}>02 现况依据</button><IconArrowRight size={15}/><button onClick={()=>setTab('plan')}>03 模式比选</button><IconArrowRight size={15}/><button onClick={()=>{setTab('assessment');setPhase('after')}}>04 改后目标</button><IconArrowRight size={15}/><button onClick={()=>setTab('operations')}>05 运营验证</button></div>
    <div ref={contentAnchor} className="strategy-content-anchor"/>
    {busy&&<div className="strategy-working" role="status"><IconSparkles size={22}/><div><strong>DeepSeek 正在检索资料并研究更新方案</strong><p>读取本对象原文、补充公开案例，形成两条路径和对应依据。</p></div><button onClick={()=>{controller.current?.abort();setBusy(false)}}>停止</button></div>}
    {(error||result?.error)&&<div className="strategy-error" role="alert">{error||result?.error}<button onClick={()=>void research(true,false)}>重新研究</button></div>}
    {tab==='plan'&&<>

      <div className="strategy-plan-layout"><main className="strategy-plan-detail"><div className="strategy-choice" aria-label="选择更新方案"><button aria-pressed={path==='comprehensive'} onClick={()=>setPath('comprehensive')}>综合整治 · 微调更新</button><button aria-pressed={path==='rebuild'} onClick={()=>setPath('rebuild')}>原拆原建 · 整体拆建</button></div>
        {selected&&<><h3>{selected.title}</h3><p>{selected.description}</p><div className="strategy-actions">{selected.actions.map((action,index)=><article key={action.title}><span>{String(index+1).padStart(2,'0')}</span><div><h4>{action.title}</h4><p>{action.detail}</p><button onClick={()=>openSource(action.evidence_refs)}>对应依据</button></div></article>)}</div><details className="strategy-requirements"><summary>展开这条路径的实施前提</summary>{selected.requirements.map(requirement=><p key={requirement}>{requirement}</p>)}</details></>}
        {!strategy&&!busy&&<p>点击“重新检索与研判”，由 Agent 根据本项目资料生成具体路径。</p>}
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
    {result?.research&&<details className="strategy-search-record"><summary>查看实际检索与 Agent 记录</summary>{result.research.queries.map(query=><p key={query}>{query}</p>)}{result.model_calls.map((call,index)=><p key={index}>{call.stage} · {call.returned_model||call.requested_model} · 输入{call.input_tokens} / 输出{call.output_tokens} tokens · {call.finish_reason}</p>)}</details>}
  </section>
}
