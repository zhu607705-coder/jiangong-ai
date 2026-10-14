import { useEffect, useMemo, useState } from 'react'
import type { OperationsResult } from '../../../host/generated/contracts'
import { buildCompleteCommunityDemo, simulateScenarioUsers } from '../../../../packages/retrofit/complete-demo'
import { defaultExploration, explorationInput, summarizeExploration } from '../../../../packages/retrofit/visual-analysis'
import { compareDemoPlans, demoInvestigations, demoPlanName, demoPlanSavedTime, emptyProgress, readDemoPlans, validInvestigationProgress, type DemoPlan, type InvestigationProgress } from '../../../../packages/retrofit/demo-workflow'
import { api, type Project } from '../api'
import './community-demo-workflow.css'

const format = (value: number | null) => value == null ? '待核' : value.toLocaleString('zh-CN', {maximumFractionDigits:2})
function download(name:string, content:string) {
  const url = URL.createObjectURL(new Blob([content], {type:'text/markdown;charset=utf-8'})), link = document.createElement('a')
  link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}
function useDemoPlans(project:Project) {
  const demo = useMemo(buildCompleteCommunityDemo, [])
  const [plans, setPlans] = useState<DemoPlan[]>([]), [error, setError] = useState(''), [retry, setRetry] = useState(0), [example, setExample] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    setPlans([]); setError(''); setExample(false)
    let saved:DemoPlan[] = []
    try { saved = readDemoPlans(demo, JSON.parse(localStorage.getItem(`hzz-synthetic-explorations:${project.id}`) || '[]')) } catch {}
    if (saved.length >= 2) { setPlans(saved); return () => controller.abort() }
    setExample(true)
    void (async () => {
      const examples = [
        {parameters:{...defaultExploration}},
        {parameters:{demand:1.5,activitySlots:15,subsidy:0}},
        {parameters:{demand:1.5,activitySlots:45,subsidy:12000}},
      ]
      const endpoint = `/projects/${encodeURIComponent(project.id)}/community-operations/preview`
      const computed:DemoPlan[] = []
      for (const [index, example] of examples.entries()) {
        const draft = explorationInput(demo, example.parameters)
        const first = await api<OperationsResult>(endpoint,{input:draft},controller.signal)
        if (first.metrics.served_visits == null) throw new Error('示例服务量未完成计算')
        const input = simulateScenarioUsers(draft,first.metrics.served_visits,demo.visitsPerResident)
        const result = await api<OperationsResult>(endpoint,{input},controller.signal)
        computed.push({...example,name:`示例 ${demoPlanName(example.parameters,index+1)}`,input,result})
      }
      if (!controller.signal.aborted) setPlans(computed)
    })().catch(error => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : '示例计算暂不可用') })
    return () => controller.abort()
  },[project.id,project.context_version,demo,retry])
  return {plans,error,example,retry:() => setRetry(value => value + 1)}
}

export function DemoPlanVersions({project,onExplore}:{project:Project;onExplore:()=>void}) {
  const {plans,error,example,retry} = useDemoPlans(project)
  const [from,setFrom] = useState(0), [to,setTo] = useState(2)
  const before = plans[Math.min(from,plans.length-1)], after = plans[Math.min(to,plans.length-1)]
  const rows = before && after ? compareDemoPlans(before,after) : []
  return <section className="demo-workflow" aria-label="模拟方案版本变化">
    <header><div><span className="demo-workflow-tag">完整模拟 · {example ? '示例方案' : '本机保留方案'}</span><h2>看见方案怎样变化</h2><p>选择两个版本，对照需求、关键举措和月度结果。每份方案保留当时的参数与计算结果。</p></div><button type="button" onClick={onExplore}>返回运营推演</button></header>
    <p className="demo-workflow-note">{example ? '当前本机不足两个保留方案，以下三个示例通过同一个月度核算接口计算。' : '以下读取运营推演中已保留的方案。'} 这里对照的是模拟预算方案。</p>
    {error ? <p role="alert">{error}<button type="button" onClick={retry}>重新计算</button></p> : !before || !after ? <p role="status">正在生成版本对照…</p> : <>
      <div className="demo-version-selectors"><label>原版本<select aria-label="原方案版本" value={Math.min(from,plans.length-1)} onChange={event=>setFrom(Number(event.target.value))}>{plans.map((plan,index)=><option key={index} value={index}>{plan.name}</option>)}</select></label><span aria-hidden="true">→</span><label>对比版本<select aria-label="对比方案版本" value={Math.min(to,plans.length-1)} onChange={event=>setTo(Number(event.target.value))}>{plans.map((plan,index)=><option key={index} value={index}>{plan.name}</option>)}</select></label></div>
      <div className="demo-version-summary" role="status"><strong>{rows.filter(row=>row.delta !== null && row.delta !== 0).length}项数值发生变化</strong><p>服务量变化 {format(rows.find(row=>row.label==='月度服务')!.delta)} 人次/月 · 现金结余变化 {format(rows.find(row=>row.label==='支持后现金结余')!.delta)} 元/月</p></div>
      <div className="demo-version-measures">{[before,after].map((plan,index)=>{const summary=summarizeExploration(plan), savedTime=demoPlanSavedTime(plan); return <article key={index}><span>{index===0?'原版本':'对比版本'}</span><h3>{plan.name}</h3>{savedTime?.kind==='saved' && <p className="demo-plan-saved-time"><time dateTime={savedTime.dateTime}>{savedTime.text}</time></p>}{savedTime?.kind==='legacy' && <details className="demo-plan-save-details"><summary>保存信息</summary><p>{savedTime.text}</p></details>}<p>{summary.condition}</p><h4>关键举措</h4><ul>{summary.measures.map(measure=><li key={measure}>{measure}</li>)}</ul><p className="demo-version-outcome">{summary.outcome}</p></article>})}</div>
      <div className="demo-version-table"><table><thead><tr><th>参数与结果</th><th>原版本</th><th>对比版本</th><th>变化</th></tr></thead><tbody>{rows.map(row=><tr key={row.label}><th>{row.label}<small>{row.unit}</small></th><td>{format(row.from)}</td><td>{format(row.to)}</td><td className={row.delta===0?'':'is-changed'}>{row.delta!=null && row.delta>0?'+':''}{format(row.delta)}</td></tr>)}</tbody></table></div>
      <p className="demo-workflow-note">需求、排班与补贴可能同时变化，表内差额为这组参数的合计结果。实际工程判断版本在返回真实项目后查看。</p>
      <button type="button" onClick={()=>download('模拟方案版本对比.md',`# 模拟方案版本对比\n\n${before.name} → ${after.name}\n\n完整模拟；来源：${example?'按月度接口计算的示例':'本机保存的预算方案'}。\n\n原版本${demoPlanSavedTime(before)?.text || '：未记录保存时间'}\n\n对比版本${demoPlanSavedTime(after)?.text || '：未记录保存时间'}\n\n|指标|原版本|对比版本|变化|单位|\n|---|---:|---:|---:|---|\n${rows.map(row=>`|${row.label}|${format(row.from)}|${format(row.to)}|${format(row.delta)}|${row.unit}|`).join('\n')}\n\n## 原版本关键举措\n${summarizeExploration(before).measures.map(row=>'- '+row).join('\n')}\n\n## 对比版本关键举措\n${summarizeExploration(after).measures.map(row=>'- '+row).join('\n')}`)}>导出版本对照</button>
    </>}
  </section>
}

export function DemoInvestigationPanel({project}:{project:Project}) {
  const storageKey = `hzz-synthetic-investigations:${project.id}`
  const [progress,setProgress] = useState<Record<string,InvestigationProgress>>(()=>{
    try { const saved=JSON.parse(localStorage.getItem(storageKey)||'{}'); return Object.fromEntries(demoInvestigations.map(task=>[task.id,validInvestigationProgress(saved[task.id])])) } catch {return {}}
  })
  const [saveError,setSaveError] = useState('')
  useEffect(()=>{try {localStorage.setItem(storageKey,JSON.stringify(progress));setSaveError('')} catch {setSaveError('本机存储暂不可用，当前修改可先导出保存。')}},[progress,storageKey])
  function change(id:string,value:Partial<InvestigationProgress>) {setProgress(current=>({...current,[id]:{...(current[id]||emptyProgress),...value}}))}
  const counts = demoInvestigations.reduce((sum,task)=>{sum[(progress[task.id]||emptyProgress).status]++;return sum},{pending:0,doing:0,done:0})
  return <section className="demo-workflow" aria-label="模拟下一步调查">
    <header><div><span className="demo-workflow-tag">完整模拟 · 调查工作流演示</span><h2>下一步，核实哪些资料</h2><p>从演示中的关键假设出发，明确调查对象、采集方式与完成条件。先核实服务量、人员和资金，再修订方案。</p></div><button type="button" onClick={()=>download('模拟调查清单.md',`# 模拟调查清单\n\n本机演示记录；状态由使用者填写，真实材料审核在真实项目中进行。\n\n${demoInvestigations.map(task=>{const state=progress[task.id]||emptyProgress;return `## P${task.priority} ${task.title}\n\n状态：${{pending:'待调查',doing:'调查中',done:'演示已完成'}[state.status]}\n\n对象：${task.object}\n\n采集方法：${task.method}\n\n字段：${task.fields}\n\n完成条件：${task.done}\n\n记录：${state.note||'尚未填写'}\n\n资料定位：${state.evidence||'尚未填写'}\n`}).join('\n')}`)}>导出调查清单</button></header>
    <div className="demo-investigation-counts"><div><strong>{counts.pending}</strong><span>待调查</span></div><div><strong>{counts.doing}</strong><span>调查中</span></div><div><strong>{counts.done}</strong><span>演示已完成</span></div></div>
    <p className="demo-workflow-note">进度与记录保存在本机模拟空间。填写完成记录和资料定位后才能标为“演示已完成”；真实项目的证据审核单独进行。</p>
    {saveError && <p role="alert">{saveError}</p>}
    <div className="demo-investigation-list">{demoInvestigations.map(task=>{const state=progress[task.id]||emptyProgress;return <article key={task.id}><header><span className="demo-investigation-priority">P{task.priority}</span><h3>{task.title}</h3><label>进度<select aria-label={`${task.title}进度`} value={state.status} onChange={event=>change(task.id,{status:event.target.value as InvestigationProgress['status']})}><option value="pending">待调查</option><option value="doing">调查中</option><option value="done" disabled={!state.note.trim()||!state.evidence.trim()}>演示已完成</option></select></label></header><dl><div><dt>调查对象</dt><dd>{task.object}</dd></div><div><dt>如何采集</dt><dd>{task.method}</dd></div><div><dt>所需字段</dt><dd>{task.fields}</dd></div><div><dt>完成条件</dt><dd>{task.done}</dd></div></dl><div className="demo-investigation-record"><label>调查记录<textarea aria-label={`${task.title}调查记录`} value={state.note} onChange={event=>change(task.id,{note:event.target.value,status:state.status==='done'&&!event.target.value.trim()?'doing':state.status})} placeholder="演示：核实了什么，发现了什么差异" /></label><label>资料定位<input aria-label={`${task.title}资料定位`} value={state.evidence} onChange={event=>change(task.id,{evidence:event.target.value,status:state.status==='done'&&!event.target.value.trim()?'doing':state.status})} placeholder="文件名、页码或登记表位置" /></label></div></article>})}</div>
  </section>
}
