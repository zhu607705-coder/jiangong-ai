import { useEffect, useMemo, useState } from 'react'
import { IconAdjustmentsHorizontal, IconArrowUpRight, IconBookmark, IconCoffee, IconUsers, IconHeartHandshake } from '@tabler/icons-react'
import { api, type Project } from '../api'
import type { OperationsInput, OperationsResult } from '../../../host/generated/contracts'
import { simulateScenarioUsers, type CompleteCommunityDemo } from '../../../../packages/retrofit/complete-demo'
import { defaultExploration, explorationInput, summarizeExploration, type ExplorationParameters } from '../../../../packages/retrofit/visual-analysis'
import { createDemoPlan, demoPlanSavedTime, nextDemoPlanNumber, readDemoPlans, type DemoPlan } from '../../../../packages/retrofit/demo-workflow'
import { AnimatedNumber } from './analysis-motion'
import { MonthlyCashFlowVisual } from './CommunityAnalysisVisuals'
import './community-operations-playground.css'

export type ExplorationSnapshot = { parameters: ExplorationParameters; input: OperationsInput; result: OperationsResult }
const format = (value: number) => value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })

export default function CommunityOperationsPlayground({ project, demo, baseline, motion, onResult, storageScope }: {
  project: Project; demo: CompleteCommunityDemo; baseline?: OperationsResult; motion: boolean;
  onResult: (value: ExplorationSnapshot | null) => void; storageScope?: string;
}) {
  const storageKey = `hzz-synthetic-explorations:${project.id}${storageScope ? `:${storageScope}` : ''}`
  const [parameters, setParameters] = useState(defaultExploration)
  const [computedState, setComputed] = useState<{ key: string; snapshot: ExplorationSnapshot } | null>(null)
  const computed = computedState?.key === storageKey ? computedState.snapshot : null
  const [busy, setBusy] = useState(true), [error, setError] = useState(''), [retry, setRetry] = useState(0)
  const [serviceId, setServiceId] = useState('activity')
  const readSaved = () => {
    try {
      const values: unknown = JSON.parse(localStorage.getItem(storageKey) || '[]')
      return readDemoPlans(demo, values)
    } catch { return [] }
  }
  const [savedState, setSavedState] = useState<{ key: string; plans: DemoPlan[] }>(() => ({ key: storageKey, plans: readSaved() }))
  const saved = savedState.key === storageKey ? savedState.plans : []
  const setSaved = (update: (values: DemoPlan[]) => DemoPlan[]) => setSavedState(current => ({ key: storageKey, plans: update(current.key === storageKey ? current.plans : readSaved()) }))
  useEffect(() => { setSavedState({ key: storageKey, plans: readSaved() }); setParameters({ ...defaultExploration }); setServiceId('activity') }, [storageKey])
  useEffect(() => { if (savedState.key === storageKey) try { localStorage.setItem(storageKey, JSON.stringify(savedState.plans)) } catch { /* Local comparison remains usable if browser storage is unavailable. */ } }, [savedState, storageKey])
  useEffect(() => {
    const controller = new AbortController()
    setBusy(true); setError(''); onResult(null)
    const timer = window.setTimeout(async () => {
      try {
        const input = explorationInput(demo, parameters)
        const endpoint = `/projects/${encodeURIComponent(project.id)}/community-operations/preview`
        const first = await api<OperationsResult>(endpoint, { input }, controller.signal)
        if (first.metrics.served_visits === null) throw new Error('服务量尚未完成计算')
        const finalInput = simulateScenarioUsers(input, first.metrics.served_visits, demo.visitsPerResident)
        const result = await api<OperationsResult>(endpoint, { input: finalInput }, controller.signal)
        if (controller.signal.aborted) return
        const value = { parameters: { ...parameters }, input: finalInput, result }
        setComputed({ key: storageKey, snapshot: value }); onResult(value)
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '计算暂时没有返回')
      } finally { if (!controller.signal.aborted) setBusy(false) }
    }, 220)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [parameters, project.id, project.context_version, demo, retry, onResult, storageKey])
  const result = computed?.result, metrics = result?.metrics
  const selected = result?.services.find(service => service.id === serviceId)
  const unchanged = useMemo(() => computed && JSON.stringify(computed.parameters) === JSON.stringify(parameters), [computed, parameters])
  function change(key: keyof ExplorationParameters, value: number) { setParameters(current => ({ ...current, [key]: value })) }
  function keep() {
    if (!computed || busy || error || !unchanged || saved.length === 3) return
    setSaved(values => [...values, createDemoPlan(computed, nextDemoPlanNumber(values))])
  }
  const deficit = metrics?.balance_after_support != null && metrics.balance_after_support < 0
  const unmet = result?.services.reduce((sum, service) => sum + (service.unmet_visits ?? 0), 0) ?? 0
  return <section className="operations-playground" aria-label="互动运营推演" aria-busy={busy}>
    <div className="playground-topline"><span><i />杭州样本社区 · 2026年9月 · 全量模拟</span><span className={`playground-live${error ? ' has-error' : ''}`} role="status">{busy ? '正在更新你的调整…' : error ? '本次调整未算完' : '已按当前调整更新'}</span></div>
    <div className="playground-layout">
      <aside className="playground-controls"><header><IconAdjustmentsHorizontal size={21} /><h3>试着调整一下</h3></header><p>拖动三个变量，看看服务和预算怎样一起变化。</p>
        <label className="playground-slider"><span>居民服务需求<strong>{Math.round(parameters.demand * 100)}<small>%</small></strong></span><input aria-label="居民服务需求" type="range" min=".5" max="1.5" step=".05" value={parameters.demand} onChange={event => change('demand', Number(event.target.value))} /><span className="playground-slider-scale"><small>50% 较少</small><small>150% 较多</small></span></label>
        <label className="playground-slider"><span>活动室开放场次<strong>{parameters.activitySlots}<small>场/月</small></strong></span><input aria-label="活动室开放场次" type="range" min="15" max="45" step="1" value={parameters.activitySlots} onChange={event => change('activitySlots', Number(event.target.value))} /><span className="playground-slider-scale"><small>15场</small><small>45场</small></span></label>
        <label className="playground-slider"><span>政府运营补贴<strong>{format(parameters.subsidy)}<small>元/月</small></strong></span><input aria-label="政府运营补贴" type="range" min="0" max="20000" step="500" value={parameters.subsidy} onChange={event => change('subsidy', Number(event.target.value))} /><span className="playground-slider-scale"><small>0元</small><small>20,000元</small></span></label>
        <div className="playground-presets"><button type="button" onClick={() => setParameters({ demand: 1.3, activitySlots: 40, subsidy: 12000 })}>试试需求高峰</button><button type="button" onClick={() => setParameters(current => ({ ...current, subsidy: 6000 }))}>减少补贴</button><button type="button" onClick={() => setParameters({ ...defaultExploration })}>回到基准</button></div>
        <details className="playground-assumptions"><summary>这些调整怎样计算</summary><p>需求基于原样本乘倍率；活动室仍为30席，每场1小时，在15–45场内由现有社区岗排班，固定工资预算不变。助餐、咨询排班保持原样。去重人数用已服务人次÷5.433333次/人/月推算。购买服务和政府直付另列。</p></details>
      </aside>
      <div className={`playground-result${busy ? ' is-updating' : ''}`}>
        <header className="playground-result-heading"><div><span>你的运营方案</span><h3>{!metrics ? '正在展开服务与预算' : deficit ? '这份方案还需要补齐资金' : unmet > 0 ? '部分服务需求尚未满足' : '当前服务需求已满足'}</h3></div><button type="button" disabled={busy || !!error || !computed || !unchanged || saved.length === 3} onClick={keep}><IconBookmark size={16} />{saved.length === 3 ? '已保留3个方案' : '保留作对照'}</button></header>
        {error && <div className="playground-error" role="alert">{error}。当前结果未更新，请重试。<button type="button" onClick={() => setRetry(value => value + 1)}>重新计算</button></div>}
        {metrics ? <>
          <div className="playground-kpis"><div><span>每月服务</span><strong><AnimatedNumber value={metrics.served_visits!} enabled={motion} /><small>人次</small></strong><p>月度覆盖 {metrics.unique_users} 位居民 · {(metrics.coverage! * 100).toFixed(1)}%</p></div><div><span>{deficit ? '每月资金缺口' : '支持后月度结余'}</span><strong className={deficit ? 'is-deficit' : 'is-positive'}><AnimatedNumber key={deficit ? "gap" : "balance"} value={Math.abs(metrics.balance_after_support!)} enabled={motion} /><small>元</small></strong><p>政府共投入 {format(metrics.government_outlay!)} 元/月</p></div></div>
          <div className="playground-service-canvas" aria-label="服务响应图">{result!.services.map((service, index) => {
            const icons = [IconUsers, IconCoffee, IconHeartHandshake], Icon = icons[index]
            const utilization = service.utilization ?? 0
            return <button type="button" key={service.id} className={`playground-service${serviceId === service.id ? ' is-active' : ''}`} aria-pressed={serviceId === service.id} aria-label={`查看${service.name}，服务${service.served_visits}人次`} onClick={() => setServiceId(service.id)}><div className={`playground-orbit orbit-${index}`}><svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="43" className="orbit-track" /><circle cx="50" cy="50" r="43" className="orbit-fill" strokeDasharray={Math.PI * 86} strokeDashoffset={Math.PI * 86 * (1 - utilization)} /></svg><Icon size={27} stroke={1.5} /></div><span>{service.name}</span><strong><AnimatedNumber value={service.served_visits!} enabled={motion} /><small>人次</small></strong><small>{service.unmet_visits ? `尚未满足${service.unmet_visits}人次需求` : '需求已满足'}</small></button>
          })}</div>
          {selected && <div className="playground-service-detail" role="status"><strong>{selected.name}</strong><span>开放容量 {format(selected.capacity_visits!)} 人次/月</span><span>利用率 {(selected.utilization! * 100).toFixed(1)}%</span><span>收费收入 {format(selected.fee_income!)} 元/月</span></div>}
          <div className="playground-change"><IconArrowUpRight size={18} /><span>{baseline ? `对比标准草稿的基准：服务${metrics.served_visits! - baseline.metrics.served_visits! >= 0 ? '增加' : '减少'}${format(Math.abs(metrics.served_visits! - baseline.metrics.served_visits!))}人次，政府投入${metrics.government_outlay! - baseline.metrics.government_outlay! >= 0 ? '增加' : '减少'}${format(Math.abs(metrics.government_outlay! - baseline.metrics.government_outlay!))}元/月。` : '每次调整都会重新核算容量、收费、支出与财政投入。'}</span></div>
        </> : <div className="playground-empty">正在连接你的服务安排与资金预算…</div>}
      </div>
    </div>
    {!!saved.length && <div className="playground-saved" aria-label="保留方案对照">
      <header><h4>方案对比</h4><span>保存在本机 · 完整模拟</span></header>
      <div className="playground-saved-grid">{saved.map((value, index) => {
        const summary = summarizeExploration(value)
        const savedTime = demoPlanSavedTime(value)
        return <article key={`${value.name}:${index}`}>
          <header><strong>{value.name}</strong><button type="button" aria-label={`移除${value.name}`} onClick={() => setSaved(values => values.filter((_, position) => position !== index))}>×</button></header>
          {savedTime?.kind === 'saved' && <p className="playground-plan-saved-time"><time dateTime={savedTime.dateTime}>{savedTime.text}</time></p>}
          {savedTime?.kind === 'legacy' && <details className="playground-plan-save-details"><summary>保存信息</summary><p>{savedTime.text}</p></details>}
          <p className="playground-plan-condition">需求条件：{summary.condition}</p>
          <section className="playground-plan-measures" aria-label={`${value.name}关键举措`}><h5>关键举措</h5><ul>{summary.measures.map(measure => <li key={measure}>{measure}</li>)}</ul></section>
          <dl className="playground-plan-metrics"><div><dt>服务量</dt><dd>{summary.service}</dd></div><div><dt>覆盖居民</dt><dd>{summary.coverage}</dd></div><div><dt>{summary.balanceLabel}</dt><dd className={summary.deficit ? 'is-deficit' : ''}>{summary.balance}</dd></div><div><dt>政府投入</dt><dd>{summary.government}</dd></div></dl>
          <p className="playground-plan-outcome">结果摘要：{summary.outcome}</p>
          <button type="button" onClick={() => setParameters({ ...value.parameters })}>恢复这个方案</button>
        </article>
      })}</div>
    </div>}
    <details className="playground-flow"><summary>看看这份方案的钱怎样流动</summary><MonthlyCashFlowVisual result={result || null} period={demo.operations.period} /></details>
  </section>
}
