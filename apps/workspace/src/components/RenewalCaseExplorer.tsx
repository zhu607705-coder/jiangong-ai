import {useEffect,useMemo,useState} from 'react'
import {api} from '../api'
import type {RenewalModeInput,RenewalModePacket} from '../../../../packages/retrofit/renewal-mode'
import {CASE_MATCH_POLICY,CASE_TOPICS,CASE_PRESETS,caseContext,historyCases,rankRenewalCases,type CaseDirection,type CaseWeights,type RenewalCase} from '../../../../packages/retrofit/case-matching'
import './renewal-case-explorer.css'

const stages:Record<string,string>={contract_price:'合同价',winning_bid:'中标价',award:'中标价',budget:'预算',tender_budget:'预算',tender_ceiling:'控制价',estimate:'估算',settlement:'结算',total_investment:'总投资'}
const kindLabel=(kind:RenewalCase['kind'])=>kind==='official_cost'?'交易原件':kind==='workbook'?'导入线索 · 待核':'公开案例'
const safeLink=(value:string)=>{try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password?url.href:null}catch{return null}}
const money=(value:number)=>value>=1e8?(value/1e8).toLocaleString('zh-CN',{maximumFractionDigits:4})+' 亿元':(value/10000).toLocaleString('zh-CN',{maximumFractionDigits:4})+' 万元'

/** One browser-local relevance computation, shared by the dedicated page and mode reference tab. */
export default function RenewalCaseExplorer({input,endpoint,direction,onInvestigate}:{input:RenewalModeInput;endpoint?:string;direction?:CaseDirection|null;onInvestigate?:()=>void}){
 const [remote,setRemote]=useState<{key:string;input:RenewalModeInput}|null>(null),[loading,setLoading]=useState(false)
 const [kind,setKind]=useState<'public_case'|'official_cost'|'workbook'>('public_case'),[topic,setTopic]=useState(''),[region,setRegion]=useState(''),[query,setQuery]=useState(''),[preset,setPreset]=useState('problem'),[selected,setSelected]=useState(''),[weights,setWeights]=useState<CaseWeights>({...CASE_PRESETS[0].weights})
 const key=JSON.stringify([endpoint,input.target,input.as_of,input.matching_context,input.evidence.map(row=>[row.source_id,row.quote])])
 useEffect(()=>{if(!endpoint)return;const controller=new AbortController();setLoading(true);setRemote(null)
   void api<RenewalModePacket>(endpoint,undefined,controller.signal).then(value=>{if(!controller.signal.aborted&&Array.isArray(value.screening?.cases)&&value.screening.target===input.target)setRemote({key,input:value.screening})}).catch(()=>{}).finally(()=>{if(!controller.signal.aborted)setLoading(false)})
   return()=>controller.abort()
 },[key,endpoint])
 const screening=remote?.key===key?remote.input:input,baseContext=caseContext(screening),context={...baseContext,city:region||baseContext.city,city_basis:region?'filter' as const:baseContext.city_basis}
 const candidates=useMemo(()=>[...screening.cases.map(row=>({...row,kind:'public_case' as const})),...historyCases(screening.history)],[screening])
 const matches=useMemo(()=>rankRenewalCases(candidates.filter(row=>row.kind===kind),context,{direction,topic:topic||undefined,query,weights}),[candidates,screening,direction,kind,topic,region,query,weights])
 const current=matches.find(row=>row.item.id===selected)||matches[0],item=current?.item
 useEffect(()=>setSelected(''),[key,direction,kind,topic,region,query,preset])
 const counts={public_case:candidates.filter(row=>row.kind==='public_case').length,official_cost:candidates.filter(row=>row.kind==='official_cost').length,workbook:candidates.filter(row=>row.kind==='workbook').length}
 const usePreset=(id:string)=>{setPreset(id);setWeights({...CASE_PRESETS.find(row=>row.id===id)!.weights})}
 const exportMatches=()=>{const blob=new Blob([JSON.stringify({policy:CASE_MATCH_POLICY,created_at:new Date().toISOString(),context,filters:{kind,topic,query,direction},weights,matches},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='案例匹配与决策对应.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
 return <section className="case-explorer" aria-label="项目案例匹配">
  <header><div><span>对标当前项目 · {context.city||'地域待确认'}{direction&&` · ${direction==='comprehensive'?'综合整治':'原拆原建'}`}</span><h3>从相似问题找到可用做法</h3><p>左侧选择案例，右侧查看它对本项目的措施、投入与调查有什么帮助。</p></div><button onClick={exportMatches} disabled={!matches.length}>导出匹配清单</button></header>
  {context.object_note&&<p className="case-scope-note">{context.object_note}</p>}
  <div className="case-kind-tabs" role="group" aria-label="案例来源类别">{(['public_case','official_cost','workbook'] as const).map(value=><button key={value} aria-pressed={kind===value} onClick={()=>setKind(value)}>{kindLabel(value)} <strong>{counts[value]}</strong></button>)}{screening.history&&<span>历史库共 {screening.history.total.toLocaleString('zh-CN')} 条 · 按项目选入 {counts.workbook} 条线索</span>}</div>
  <div className="case-search-controls"><label>查找案例<input value={query} onChange={event=>setQuery(event.target.value)} placeholder="项目名、城市或措施"/></label><label>本次重点<select value={topic} onChange={event=>setTopic(event.target.value)} aria-label="案例匹配重点"><option value="">按本项目已有问题</option>{CASE_TOPICS.map(row=><option key={row.key} value={row.key}>{row.label}</option>)}</select></label><label>对标地域<input value={region} maxLength={40} onChange={event=>setRegion(event.target.value)} placeholder={baseContext.city||"城市名，仅用于本次匹配"} aria-label="案例对标城市"/></label><label>排序目标<select value={preset} onChange={event=>usePreset(event.target.value)} aria-label="案例排序目标">{CASE_PRESETS.map(row=><option key={row.id} value={row.id}>{row.label}</option>)}<option value="custom">自定义权重</option></select></label></div>
  <details className="case-weight-controls"><summary>调整匹配标准 · {matches.length} 项符合当前范围</summary><p>相关度按问题、方向、地域、来源和住户规模计算；只对已有字段比较。</p><div>{([{key:'issue',label:'问题相近'},{key:'direction',label:'方向一致'},{key:'region',label:'地域相近'},{key:'evidence',label:'原件依据'},{key:'scale',label:'规模相近'}] as const).map(row=><label key={row.key}>{row.label}<input type="range" min="0" max="5" step="1" value={weights[row.key]} aria-label={row.label+'权重'} onChange={event=>{const value=Number(event.target.value),next={...weights,[row.key]:value};if(Object.values(next).some(v=>v>0)){setPreset('custom');setWeights(next)}}}/><output>{weights[row.key]}</output></label>)}</div></details>
  {loading&&<p className="case-loading" role="status">正在匹配工程库；公开案例可先查看。</p>}
  <div className="case-two-columns"><nav className="case-results" aria-label="匹配案例列表">{matches.map(match=><button key={match.item.id} aria-pressed={item?.id===match.item.id} onClick={()=>setSelected(match.item.id)}><div><span>{match.item.city||'区域待核'} · {kindLabel(match.item.kind)}</span><strong>{match.score}{match.upper_score!==match.score?`–${match.upper_score}`:""}<small> 相关度</small></strong></div><h4>{match.item.name}</h4><p>{match.reasons.join('；')}</p></button>)}{!matches.length&&<div className="case-no-results"><strong>当前组合未找到对应案例</strong><p>可调整问题或搜索词，继续保留已选工作方向。</p><button onClick={()=>{setQuery('');setTopic('')}}>清除问题筛选</button></div>}</nav>
   {item&&current&&<article className="case-decision-detail" aria-label="案例与本项目决策对应"><header><span>{item.mode}</span><h4>{item.name}</h4><p>{item.reported_stage} · {item.published_at||'来源日期待复核'}</p></header>
    <div className="case-decision-use"><span>对当前决策的作用</span><strong>{item.decision_use||'结合现实工程范围核对可借鉴的做法。'}</strong><p>{current.reasons.join('；')}</p></div>
    <div className="case-compare-row"><div><span>本项目正在解决</span><strong>{topic?CASE_TOPICS.find(row=>row.key===topic)?.label:context.topics.length?context.topics.map(key=>CASE_TOPICS.find(row=>row.key===key)?.label||key).join('、'):'先选择需要比较的具体问题'}</strong><p>{context.target}</p></div><div><span>案例中的具体做法</span><ul>{(item.interventions?.length?item.interventions:[item.comparison_note]).map((action,index)=><li key={index}>{action}</li>)}</ul></div></div>
    <section className="case-metrics"><h5>范围、金额与实施阶段</h5>{item.metrics.length?<dl>{item.metrics.map((metric,index)=><div key={index}><dt>{stages[metric.label]||metric.label}</dt><dd>{metric.unit==='元'?money(metric.value):`${metric.value.toLocaleString('zh-CN')} ${metric.unit}`}<span>{metric.scope}</span></dd></div>)}</dl>:<p>该来源主要提供实施做法，费用按本项目工程量另行测算。</p>}<p>{item.funding_note}</p></section>
    <section className="case-transfer-checks"><h5>把做法转为本项目方案前，需要核对</h5><ul>{current.differences.map((text,index)=><li key={index}>{text}</li>)}</ul>{onInvestigate&&<button onClick={onInvestigate}>进入调查核实这些条件 →</button>}</section>
    <details className="case-match-explain"><summary>为什么排在这里 · 已比较 {current.known_factors} 项条件</summary><table><thead><tr><th>匹配标准</th><th>权重</th><th>对应程度</th></tr></thead><tbody>{current.factors.map(row=><tr key={row.key}><td>{row.label}</td><td>{row.weight}</td><td>{row.value===null?'资料不足，未计入':Math.round(row.value*100)+' / 100'}</td></tr>)}</tbody></table><p>权重决定候选排序，适用条件按本项目继续核对。</p></details>
    <details className="case-source"><summary>查看出处与原文摘录</summary>{item.source_quote&&<blockquote>{item.source_quote}</blockquote>}<p>{item.publisher} · {item.source_locator||item.source_title}</p>{safeLink(item.url)&&<a href={safeLink(item.url)!} target="_blank" rel="noreferrer">打开原始来源 ↗</a>}{item.related_source&&safeLink(item.related_source.url)&&<p><a href={safeLink(item.related_source.url)!} target="_blank" rel="noreferrer">查看补充规模原文 ↗</a></p>}</details>
   </article>}
  </div>
 </section>
}
