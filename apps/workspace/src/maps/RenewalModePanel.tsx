import { useEffect, useRef, useState } from 'react'
import { IconBuildingCommunity, IconBuildingSkyscraper, IconSparkles, IconChevronDown, IconArrowUpRight } from '@tabler/icons-react'
import { api, ADMIN_LOGIN_REQUIRED_EVENT, ADMIN_LOGIN_REQUESTED_EVENT } from '../api'
import { useWorkbenchAccess } from '../AdminAccess'
import type { DecisionSupport } from '../../../host/generated/contracts'
import { MODE_LABELS, evaluateRenewalModeGate, type RenewalModeInput, type RenewalModePacket, type RenewalModeProgress, type RenewalModeStreamEvent } from '../../../../packages/retrofit/renewal-mode'
import { decisionErrorMessage } from '../../../../packages/decision/route-labels'
import type { StrategyPacket } from '../../../../packages/retrofit/strategy'
import RenewalResearchEvidence from './RenewalResearchEvidence'
import { renewalCheckEmphasis } from '../components/decision-emphasis'
import { consumeStream } from './screening-stream'
import './RenewalModePanel.css'
import RenewalCaseExplorer from '../components/RenewalCaseExplorer'

const money = (value: number) => value >= 1e8 ? `${(value / 1e8).toLocaleString('zh-CN', { maximumFractionDigits: 3 })} 亿元` : `${(value / 10000).toLocaleString('zh-CN', { maximumFractionDigits: 4 })} 万元`
const kinds: Record<string, string> = { contract_price: '合同价', winning_bid: '中标价', budget: '预算', tender_ceiling: '控制价', estimate: '估算', settlement: '结算' }
const conditionLabels: Record<string, string> = { structure_repairable: '可修复性', demolition_permitted: '拆除许可条件', rights_clear: '权属', rebuild_planning_confirmed: '拆建规划', resident_resolution_valid: '居民决议', relocation_ready: '安置', funding_secured: '落实资金', life_cycle_cost_compared: '全周期费用比选', maintenance_entity_confirmed: '维护主体' }
const unknownConditions: Record<string, string> = {
  structure_repairable: '尚缺本对象逐栋安全鉴定与修缮可行性意见', demolition_permitted: '尚缺本对象拆除、保护要求及属地程序确认',
  rights_clear: '尚缺本对象权属与共有权益边界记录', rebuild_planning_confirmed: '尚缺本对象重建规划条件与指标确认',
  resident_resolution_valid: '尚缺适用程序下的居民决议记录', relocation_ready: '尚缺逐户腾退、过渡和回搬安排',
  funding_secured: '已查政策和公开估算；本项目尚缺财政批复、分户承担、维修资金余额及拨付时点',
  life_cycle_cost_compared: '已查费用口径和比较方法；本项目尚缺同口径修缮、重建两套全周期核算',
  maintenance_entity_confirmed: '尚缺后续接管主体、维护资金和年度预算记录',
}

export default function RenewalModePanel({ endpoint, contextVersion, input, strategy, compact=false, onInvestigate }: {
  endpoint: string; contextVersion?: number; input: RenewalModeInput; decision?: DecisionSupport | null; strategy?:StrategyPacket|null; compact?:boolean; onInvestigate?: () => void;
}) {
  const { canWrite } = useWorkbenchAccess()
  const [snapshot, setSnapshot] = useState<{key:string; value:RenewalModePacket} | null>(null), [running, setRunning] = useState(false), [error, setError] = useState('')
  const [attempted,setAttempted]=useState(false), [progress,setProgress]=useState<RenewalModeProgress[]>([]), [notice,setNotice]=useState('')
  const [reviews,setReviews]=useState<{key:string;cards:{id:string;title:string}[];error:boolean}|null>(null)
  const [tab, setTab] = useState<'compare' | 'standards' | 'cases'>('compare'), [path, setPath] = useState<'comprehensive' | 'rebuild'>('comprehensive')
  const [openStandard, setOpenStandard] = useState('')
  const restoreController = useRef<AbortController | null>(null), requestController = useRef<AbortController | null>(null)
  const identity = useRef(''); identity.current = `${endpoint}|${contextVersion ?? ''}`
  const packet = snapshot?.key===identity.current?snapshot.value:null
  useEffect(() => {
    const controller = new AbortController(), reviewController=new AbortController(), currentIdentity=identity.current
    restoreController.current = controller; requestController.current?.abort()
    setSnapshot(null); setRunning(false); setError(''); setAttempted(false); setProgress([]); setNotice(''); setReviews(null); setTab('compare'); setOpenStandard('')
    const projectRoute=endpoint.match(/^\/projects\/([^/]+)\/renewal-mode$/)
    if(projectRoute)void api<{cards:{id:string;title:string;status:string}[]}>(`/projects/${projectRoute[1]}/experiences?status=draft`,undefined,reviewController.signal).then(value=>{
      if(!reviewController.signal.aborted&&currentIdentity===identity.current)setReviews({key:currentIdentity,cards:value.cards.filter(card=>card.status==='draft'),error:false})
    }).catch(()=>{if(!reviewController.signal.aborted&&currentIdentity===identity.current)setReviews({key:currentIdentity,cards:[],error:true})})
    void api<RenewalModePacket>(endpoint, undefined, controller.signal).then(value => {
      if (!controller.signal.aborted&&currentIdentity===identity.current) { setSnapshot({key:currentIdentity,value}); setPath(value.decision?.renewal_mode?.direction === 'rebuild' ? 'rebuild' : 'comprehensive') }
    }).catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : '模式资料读取未完成。') })
    return () => { controller.abort(); reviewController.abort(); requestController.current?.abort() }
  }, [endpoint, contextVersion])
  const screening = packet?.screening || input, result = attempted||packet?.origin==='explicit_mode'?packet?.decision:null, mode = result?.status==='completed'?result.renewal_mode:null
  const hasResult = !running && !!mode
  const gate = evaluateRenewalModeGate(screening)
  const direction = gate.direction==='investigate'||mode?.direction==='investigate'?'investigate':gate.direction
  const directionSummary = direction===gate.direction?gate.summary:mode?.summary||gate.summary
  const conditionCounts = { met: gate.checks.filter(row => row.state === 'met').length, unknown: gate.checks.filter(row => row.state === 'unknown').length, unmet: gate.checks.filter(row => row.state === 'unmet').length, conflict: gate.checks.filter(row => row.state === 'conflict').length }
  const agent=strategy?.status==='completed'&&!strategy.synthetic?strategy.strategy:null
  const evidence = screening.evidence.filter(row => mode?.source_ids.includes(row.source_id))
  useEffect(() => {
    setPath(direction === 'rebuild' ? 'rebuild' : 'comprehensive')
  }, [direction])
  // Every request belongs to this object. Unmounting or changing its snapshot cancels it.
  async function judge() {
    if (running||!canWrite) return
    restoreController.current?.abort()
    const controller = new AbortController(), currentIdentity = identity.current
    requestController.current = controller; setRunning(true); setAttempted(true); setError(''); setNotice(''); setProgress([])
    setSnapshot({key:currentIdentity,value:{screening,decision:null}})
    try {
      const response=await fetch(`/api${endpoint}`,{method:'POST',credentials:'same-origin',signal:controller.signal,headers:{'Content-Type':'application/json','Accept':'application/x-ndjson','X-Requested-With':'haizhizi'},body:JSON.stringify({...(contextVersion===undefined?{}:{expected_context_version:contextVersion}),refresh:!!result||attempted})})
      if(!response.ok){const body=await response.json().catch(()=>({}));if(response.status===401)window.dispatchEvent(new Event(ADMIN_LOGIN_REQUIRED_EVENT));if(response.status===403)window.dispatchEvent(new Event(ADMIN_LOGIN_REQUESTED_EVENT));throw new Error(body.detail||'模式判定未能启动。')}
      const accept=(event:RenewalModeStreamEvent)=>{
        if(controller.signal.aborted||currentIdentity!==identity.current)return
        if(event.type==='progress')setProgress(current=>[...current.filter(row=>row.phase!==event.phase),event])
        else if(event.type==='complete')setSnapshot({key:currentIdentity,value:event.result})
        else throw new Error(event.message)
      }
      if(response.headers.get('content-type')?.includes('application/json'))accept({type:'complete',result:await response.json()})
      else await consumeStream<RenewalModeStreamEvent>(response,controller.signal,accept)
    } catch (e) { if (!controller.signal.aborted && currentIdentity === identity.current) setError(e instanceof Error ? e.message : '模式判定未完成。') }
    finally { if (!controller.signal.aborted && currentIdentity === identity.current) setRunning(false) }
  }
  const condition = (kind: string) => screening.conditions.find(row => row.kind === kind)
  const reviewQueue=reviews?.key===identity.current?reviews:null
  const projectRoute=endpoint.match(/^\/projects\/([^/]+)\/renewal-mode$/)
  const phaseLabels={inputs:'整理判定输入',decision:'Decision 模式比较',validation:'条件核验与保存'}
  const fullPanel = <section className="renewal-mode-panel" aria-label="改造模式判定">
    <header><span className="renewal-step">先判模式</span><h3>改造模式判定</h3><span className="renewal-stage">{screening.synthetic?'模拟 · ':''}{running?'判定进行中':hasResult?'Decision 判定结果':'等待开始判定'}</span></header>
    {!hasResult&&!running&&<div className="renewal-mode-intro"><IconBuildingCommunity size={32}/><div><h4>{attempted?'本次判定尚未形成结果':'开始判定改造模式'}</h4><p>核对本对象资料，由 Decision 比较更新方向，再按条件逐项核验。</p></div><button className="renewal-start" onClick={()=>void judge()} disabled={!canWrite}>开始判定改造模式</button></div>}
    {(running||progress.length>0)&&<section className="renewal-run-progress" aria-label="模式判定进度" aria-live="polite"><header><h4>{running?'正在判定改造模式':hasResult?'本次判定已完成':'本次判定阶段记录'}</h4>{running&&<button onClick={()=>{requestController.current?.abort();setRunning(false);setNotice('本次判定已停止，可重新开始。')}}>停止判定</button>}</header><ol>{(['inputs','decision','validation'] as const).map((phase,index)=>{const event=progress.find(row=>row.phase===phase),state=event?.state==='running'&&!running?'interrupted':event?.state||(running&&index===0?'running':'pending');return <li key={phase} data-state={state}><b>{state==='completed'?'✓':String(index+1).padStart(2,'0')}</b><div><strong>{phaseLabels[phase]}</strong><p>{event?.message||(state==='running'?'已提交请求，正在整理本对象资料。':'等待上一环节完成')}{event?.source_count!==undefined&&` 本对象原文 ${event.source_count} 份 · 条件 ${event.condition_count} 项。`}</p></div></li>})}</ol></section>}
    {notice&&<p className="renewal-notice" role="status">{notice}</p>}
    {(error||result&&result.status!=='completed')&&<p className="renewal-error" role="alert">{error||decisionErrorMessage(result?.error_code||'',result?.error_detail)}</p>}
    {hasResult&&<div className="renewal-mode-result">
    <div className={`renewal-direction is-${direction}`}>
      <strong>{direction === 'comprehensive' ? '综合整治优先研究' : direction === 'rebuild' ? '原拆原建优先论证' : gate.rebuild_allowed ? '先完成两方案取舍' : MODE_LABELS.investigate}</strong>
      <dl className="renewal-decision-brief"><div className="renewal-main-reason"><dt>主要原因</dt><dd>{directionSummary.replace(/^综合整治优先研究[：，]\s*/, '')}</dd></div><div className="renewal-next"><dt>下一步</dt><dd>{gate.next_step}</dd></div></dl>
      <details open className="renewal-gate" aria-label="判定标准与条件">
        <summary><strong>判定标准与条件</strong><span className="renewal-gate-counts"><span className="decision-status-badge" data-tone="success">拆建条件已满足 {conditionCounts.met}/{gate.checks.length}</span>{conditionCounts.unknown > 0 && <span className="decision-status-badge" data-tone="warning">待核 {conditionCounts.unknown}</span>}{conditionCounts.unmet > 0 && <span className="decision-status-badge" data-tone={gate.checks.some(row => row.group === 'feasibility' && row.state === 'unmet') ? 'danger' : 'neutral'}>未满足 {conditionCounts.unmet}</span>}{conditionCounts.conflict > 0 && <span className="decision-status-badge" data-tone="danger">冲突 {conditionCounts.conflict}</span>}</span><IconChevronDown size={17} aria-hidden="true"/></summary>
        <h4>何时切换为原拆原建优先论证</h4>
        <p>先核实本对象拆建必要性和八项实施前提，再比较投入与使用效果。待核项保留为未知，逐项列明所需材料。</p>
        {(['necessity','feasibility'] as const).map(group => <div className="renewal-gate-group" key={group}>
          <h5>{group === 'necessity' ? '1. 本对象拆建必要性' : '2. 拆建实施可行前提'}</h5>
          <ul>{gate.checks.filter(row => row.group === group).map(row => <li key={row.kind} data-state={row.state} data-tone={renewalCheckEmphasis(row).tone}>
            <div className="renewal-gate-item"><span>{row.label}</span><strong className="decision-status-badge" data-tone={renewalCheckEmphasis(row).tone}>{row.state === 'met' ? group === 'necessity' ? '已触发' : '已满足' : row.state === 'unmet' ? group === 'necessity' ? '未触发' : '未满足' : row.state === 'conflict' ? '记录冲突' : '未知'}</strong></div>
            <p className="renewal-check-detail">{row.detail}</p>
            {(row.state==='unmet'||row.state==='conflict')&&!!row.locators.length&&<p className="renewal-check-locator">对应记录：{row.locators.join('、')}</p>}
            <details><summary>核验要求{row.source_ids.length ? ` · ${row.source_ids.length} 份依据` : ' · 待补依据'}</summary><p>{row.detail}</p>
              {row.source_ids.map(id => { const source = screening.evidence.find(item => item.source_id === id); return <p className="renewal-gate-source" key={id}>{source?.url && /^https?:\/\//.test(source.url) ? <a href={source.url} target="_blank" rel="noreferrer">{source.title} ↗</a> : source?.title || id}</p> })}
              {!!row.locators.length && <p className="renewal-gate-source">原文定位：{row.locators.join('、')}</p>}
            </details>
          </li>)}</ul>
        </div>)}
        <p className="renewal-gate-result">{gate.rebuild_allowed ? '九项条件已满足，进入两方案费用—效果取舍和属地前期论证。' : '按以上状态补齐或核实条件，形成可比较的两方案费用—效果表。'}</p>
      </details>
      {(mode || agent) && <details className="renewal-model-audit"><summary>查看判定过程与模型记录</summary><p>当前建议按本对象条件形成，以下保留模型原始输出和历史方案记录。</p>{mode && <p>原始模型偏好：{MODE_LABELS[mode.model_choice.choice as keyof typeof MODE_LABELS] || mode.model_choice.choice}</p>}{mode?.reasons.map(reason => <p className="renewal-restriction" key={reason}>{reason}</p>)}{agent && <p>历史方案偏好：{MODE_LABELS[agent.preferred_mode]}。{!compact && agent.headline}</p>}</details>}
      <div className="renewal-judge-actions">
        <button onClick={() => void judge()} disabled={running||!canWrite} title={!canWrite?'管理员登录后可生成模式初判':undefined}><IconSparkles size={17}/>{running ? '正在判定改造模式…' : mode ? '更新模式初判' : '判定改造模式'}</button>
        {mode && <button onClick={() => { setTab('standards'); setOpenStandard(mode.priority_constraint.choice) }}>查看判定条件</button>}
      </div>
      {mode && <div className="renewal-meta">{attempted?'本次 Decision 判定':'已保存的 Decision 判定'} · 对象资料截至 {screening.as_of.slice(0, 10)}</div>}
    </div>
    {projectRoute&&<section className="renewal-review-queue" aria-label="待审核资料"><header><h4>待审核资料</h4><span className="decision-status-badge" data-tone="warning">{!reviewQueue?'读取中':reviewQueue.error?'暂未读到审核队列':`${reviewQueue.cards.length} 项待审核`}</span></header>{reviewQueue&&!reviewQueue.error&&(reviewQueue.cards.length?<ul>{reviewQueue.cards.map(card=><li key={card.id}><strong>{card.title}</strong><span>提取草稿 · 待审核</span></li>)}</ul>:<p>当前没有待审核的提取草稿。</p>)}<a href={`/?project=${projectRoute[1]}&view=context`}>进入资料与条件核对审核记录 ↗</a></section>}
    <div className="renewal-tabs" role="tablist" aria-label="模式判定内容">
      {([['compare', '模式比选'], ['standards', '判定标准'], ['cases', '案例参考']] as const).map(([id, label]) => <button key={id} id={`renewal-tab-${id}`} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{label}</button>)}
    </div>
    <div className="renewal-content" role="tabpanel" aria-labelledby={`renewal-tab-${tab}`}>
      {tab === 'compare' && <>
        <div className="renewal-paths">
          <button aria-pressed={path === 'comprehensive'} onClick={() => setPath('comprehensive')}><IconBuildingCommunity size={22}/><span>综合整治<small>保留建筑 · 分项更新</small></span></button>
          <button aria-pressed={path === 'rebuild'} onClick={() => setPath('rebuild')}><IconBuildingSkyscraper size={22}/><span>原拆原建<small>拆除重建 · 安置回搬</small></span></button>
        </div>
        <dl className="renewal-path-data">
          {screening.standards.map(row => <div key={row.key}><dt>{row.label}</dt><dd>{row[path]}</dd></div>)}
        </dl>
        <p className="renewal-combination">按楼栋组织两条路径：分别列出修缮或拆建范围、居民影响、投入和长期使用效果。</p>
      </>}
      {tab === 'standards' && <>
        <p className="renewal-standard-intro">项目初筛标准 v2 · 逐栋核实结构和实施条件，按同一范围、价格年与使用目标比较两方案投入及效果。</p>
        {screening.standards.map(row => {
          const rows = row.kinds.map(kind => condition(kind)).filter(Boolean)
          const tone = rows.some(item => item?.state === 'conflict' || item?.state === 'restricted') ? 'danger' : rows.length === row.kinds.length && rows.every(item => item?.state === 'supported') ? 'success' : 'warning'
          const status = rows.some(item => item?.state === 'conflict') ? '存在分歧' : rows.some(item => item?.state === 'restricted') ? '有限制记录' : tone === 'success' ? '已有条件记录' : '安排专项核查'
          return <article className="renewal-standard" data-tone={tone} key={row.key}>
            <button aria-expanded={openStandard === row.key} onClick={() => setOpenStandard(openStandard === row.key ? '' : row.key)}><strong>{row.label}</strong><span>{status}</span><IconChevronDown size={16}/></button>
            {openStandard === row.key && <div><p>{row.task}</p>{row.kinds.map(kind => <p className="renewal-condition" data-state={condition(kind)?.state || 'unknown'} key={kind}>{conditionLabels[kind]}：{condition(kind)?.state === 'supported' ? '已登记满足' : condition(kind)?.state === 'restricted' ? '已登记不满足' : condition(kind)?.state === 'conflict' ? '记录冲突' : unknownConditions[kind] || '尚缺本对象对应确认记录'}</p>)}
              {!!rows.flatMap(item => item?.locators || []).length && <p>原文定位：{rows.flatMap(item => item?.locators || []).join('、')}</p>}
              {row.key === 'funding' && <RenewalResearchEvidence input={screening}/>}
            </div>}
          </article>
        })}
        {onInvestigate && <button className="renewal-investigate" onClick={onInvestigate}>进入项目安排调查<IconArrowUpRight size={17}/></button>}
      </>}
      {tab === 'cases' && <RenewalCaseExplorer input={screening} onInvestigate={onInvestigate}/>}
    </div>
    <details className="renewal-evidence"><summary>本对象依据{evidence.length ? ` · ${evidence.length} 份主要原文` : ` · ${screening.evidence.length} 份可读材料`}</summary>
      {(evidence.length ? evidence : screening.evidence).map(row => <article key={row.source_id}><strong>{row.title}</strong><p>{row.published_at.slice(0, 10)} · {row.locator}</p><blockquote>{row.quote}</blockquote>{row.url && /^https?:\/\//.test(row.url) && <a href={row.url} target="_blank" rel="noreferrer">查看来源 ↗</a>}</article>)}
      {!screening.evidence.length && <p>先补充本小区逐栋调查或公开原件；案例参考保留为独立对标。</p>}
    </details>
    </div>}
  </section>
  if(!compact)return fullPanel
  return <section className="renewal-mode-panel renewal-map-summary" aria-label="改造模式判定">
    <header><h3>改造方向初判</h3><span>{running?'判定中':hasResult?'已形成初判':result?.status==='failed'?'本次未完成':'尚未判定'}</span></header>
    <div className="renewal-map-body">
      {hasResult?<><strong className="renewal-map-conclusion">{direction==='comprehensive'?'综合整治优先研究':direction==='rebuild'?'原拆原建优先论证':'先补充关键条件'}</strong><p>{directionSummary}</p><div className="renewal-map-stats"><span>满足 {conditionCounts.met}/{gate.checks.length}</span><span>待核 {conditionCounts.unknown}</span>{conditionCounts.unmet>0&&<span>未满足 {conditionCounts.unmet}</span>}{conditionCounts.conflict>0&&<span>冲突 {conditionCounts.conflict}</span>}</div></>:<p>先核对本对象条件，再给出改造方向建议。</p>}
      {running&&<div className="renewal-map-progress" role="status"><strong>{progress.at(-1)?.phase==='validation'?'正在核对与保存':progress.at(-1)?.phase==='inputs'?'正在整理资料':'Decision正在比较'}</strong><p>{progress.at(-1)?.message||'请求已提交，正在读取本对象资料。'}</p></div>}
      {(error||result&&result.status!=='completed')&&<p className="renewal-error" role="alert">{error||decisionErrorMessage(result?.error_code,result?.error_detail)}</p>}
      {notice&&<p role="status">{notice}</p>}
      <button type="button" className="renewal-start" disabled={!canWrite||running} onClick={()=>void judge()}>{running?'正在判定…':hasResult?'更新模式初判':'开始判定改造模式'}</button>
    </div>
    <details className="renewal-map-details"><summary>判定条件、过程与原文依据</summary>{fullPanel}</details>
  </section>

}
