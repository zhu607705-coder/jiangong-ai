import { useMemo, useState } from 'react'
import type { ProjectInput, DecisionDashboard as Dashboard, NeighborhoodActionAdvice } from '../../../host/generated/contracts'
import { calculateRetrofitPlan, evaluateRetrofitConditions, retrofitAdviceFromConditions, type RetrofitPlan } from '../../../../packages/retrofit/planning'
import { dashboardDimensions, isNeighborhoodDashboard, NEIGHBORHOOD_DASHBOARD_POLICY } from '../../../../packages/decision/dashboard'
import DecisionDashboard from './DecisionDashboard'
import './neighborhood.css'

export type NeighborhoodDraft = {
  inputs: {
    basic: string
    improvement: string
    enhancement: string
    reserve_percent: string
    planned_funding: string
    households: string
  }
  comparison: {
    current: ReturnType<typeof calculateRetrofitPlan>
    previous: ReturnType<typeof calculateRetrofitPlan> | null
  } | null
  calculatorOpen: boolean
}

export function createNeighborhoodDraft(): NeighborhoodDraft {
  return {
    inputs: { basic: '', improvement: '', enhancement: '', reserve_percent: '10', planned_funding: '', households: '' },
    comparison: null,
    calculatorOpen: false,
  }
}

export default function NeighborhoodPanel({ project, dashboard, draft, onDraftChange, onEvidence, assessedAdvice }: {
  project: ProjectInput
  dashboard?: Dashboard
  assessedAdvice?: NeighborhoodActionAdvice
  draft: NeighborhoodDraft
  onDraftChange: (update: (current: NeighborhoodDraft) => NeighborhoodDraft) => void
  onEvidence: (refs: string[]) => void
}) {
  const conditions=useMemo(()=>evaluateRetrofitConditions(project),[project])
  const advice = assessedAdvice || retrofitAdviceFromConditions(conditions)
  const conditionLabels={confirmed:'已满足',unmet:'条件未成立',missing:'缺少依据',conflict:'资料有分歧',veto:'存在否决条件'}
  const radar:Dashboard = dashboard && isNeighborhoodDashboard(dashboard.policy_version)?dashboard:{policy_version:NEIGHBORHOOD_DASHBOARD_POLICY,purpose:'老旧小区综合整治提升',model:'尚未评估',request_id:'not-evaluated',status:'partial',dimensions:dashboardDimensions(NEIGHBORHOOD_DASHBOARD_POLICY).map(d=>({key:d.key,value:null,confidence:null,basis:d.question,evidence_refs:[]}))}
  const { inputs, comparison } = draft
  const [error,setError] = useState('')
  const labels:Record<keyof typeof inputs,string>={basic:'基础类工程（万元）',improvement:'完善类工程（万元）',enhancement:'提升类工程（万元）',reserve_percent:'预备费比例（%）',planned_funding:'计划资金（万元）',households:'涉及户数（户）'}
  function calculate() {
    try {
      const values=Object.fromEntries(Object.entries(inputs).map(([key,value])=>[key,value.trim()?Number(value):null])) as unknown as RetrofitPlan
      if(values.households!==null&&!Number.isInteger(values.households))throw Error('户数须为整数')
      if(values.reserve_percent===null)throw Error('请填写预备费比例')
      const current=calculateRetrofitPlan(values)
      if(current.total===null)throw Error('三类工程请分别填写预算；未纳入本方案的项目填写0')
      setError('');onDraftChange(old=>({...old,comparison:{current,previous:old.comparison?.current||null}}))
    } catch(reason) {setError((reason as Error).message)}
  }
  const show=(value:number|null)=>value===null?'待补充':value.toLocaleString('zh-CN',{maximumFractionDigits:2})
  return <section className="neighborhood-panel" aria-label="老旧小区改造工作台">
    <header><small>老旧小区综合整治提升</small><h3>{advice.label}</h3><p>先比较本方案的居民需求、工程与实施前置条件，再安排专项调查。</p></header>
    <div className="retrofit-reasons">{advice.reasons.map(reason=><div key={reason.text}><p>{reason.text}</p>{reason.evidence_refs.length>0&&<button onClick={()=>onEvidence(reason.evidence_refs)}>查看触发依据（{reason.evidence_refs.length}）</button>}</div>)}</div>
    <details className="retrofit-condition-panel" aria-label="六维条件与行动门槛">
      <summary>条件与行动门槛 · 截止 {conditions.evaluated_as_of}</summary>
      <p>每维按本项目确认事实核对。独立否决优先；条件未成立、资料缺失或冲突时先补查；六维条件与专业规则确认均满足才开展专项调查。</p>
      <div className="retrofit-condition-grid">{conditions.dimensions.map(d=><article key={d.key}>
        <header><strong>{d.label}</strong><span>{conditionLabels[d.state]}</span></header>
        {d.checks.map(check=><p key={check.key}>{check.label}：{conditionLabels[check.state]}</p>)}
        {d.evidence_refs.length>0&&<button onClick={()=>onEvidence(d.evidence_refs)}>核对来源（{d.evidence_refs.length}）</button>}
      </article>)}</div>
      <p><strong>本方案专业规则复核：</strong>{conditionLabels[conditions.rule_confirmation.state]}。独立于六维适配等级。</p>
      {conditions.rule_confirmation.evidence_refs.length>0&&<button onClick={()=>onEvidence(conditions.rule_confirmation.evidence_refs)}>核对专业规则依据</button>}
      {conditions.admission_notes.length>0&&<details><summary>未参与条件判断的资料（{conditions.admission_notes.length}）</summary>{conditions.admission_notes.map((note,i)=><p key={i}>{note.reason} · 来源 {note.source_id}{note.locator?' · '+note.locator:''}</p>)}</details>}
    </details>
    <DecisionDashboard value={radar} onEvidence={onEvidence}/>
    {advice.missing.length>0&&<><p>本轮优先：{advice.missing.slice(0,2).map(check=>check.label).join('、')}。</p><details><summary>核查材料与交付物（{advice.missing.length}）</summary><div className="retrofit-checks">{advice.missing.map(check=><article key={check.key}><strong>{check.label}</strong><p>{check.where}</p><small>补齐后检查：{check.impact}</small></article>)}</div></details></>}
    <p className="retrofit-method">六维图用于逐项观察；行动建议按项目范围内的确认事实与规则判定。明确否决条件优先，缺失资料保持待补充。规则：{advice.rule_version}</p>
    <details className="retrofit-calculator" open={draft.calculatorOpen} onToggle={e=>{const open=e.currentTarget.open;onDraftChange(old=>old.calculatorOpen===open?old:{...old,calculatorOpen:open})}}><summary>调整改造方案与静态资金测算</summary><p>本次会话草稿，非已审批方案。下列数字均为本次方案假设。未填写的参数保留未知；计算结果供比较工程范围，不自动改写行动建议。</p>
      <div className="retrofit-inputs">{Object.entries(labels).map(([key,label])=><label key={key}>{label}<input aria-label={label} type="number" min="0" step={key==='households'?'1':'0.01'} value={inputs[key as keyof typeof inputs]} onChange={e=>{const value=e.target.value;onDraftChange(old=>({...old,inputs:{...old.inputs,[key]:value}}))}}/></label>)}</div>
      <button className="secondary" onClick={calculate}>计算并与上次方案比较</button>{error&&<p role="alert">{error}</p>}
      {comparison&&<div className="retrofit-plan-result"><dl><div><dt>含预备费总额（万元）</dt><dd>{show(comparison.current.total)}</dd></div><div><dt>假设资金缺口（万元）</dt><dd>{show(comparison.current.funding_gap)}</dd></div><div><dt>户均工程投入（万元/户）</dt><dd>{show(comparison.current.per_household)}</dd></div></dl>{comparison.previous&&<p>相对上次方案总额变化：{show(comparison.current.total===null||comparison.previous.total===null?null:comparison.current.total-comparison.previous.total)} 万元。变化来自三类工程预算或预备费调整；住户分摊及财政批准仍需原始依据。</p>}</div>}
    </details>
  </section>
}
