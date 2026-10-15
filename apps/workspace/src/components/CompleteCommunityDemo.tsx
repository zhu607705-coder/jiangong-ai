import { useMemo, useState, type CSSProperties } from 'react'
import type { Project } from '../api'
import { buildCompleteCommunityDemo, renderCompleteDemoReport, summarizeDemoLedger } from '../../../../packages/retrofit/complete-demo'
import DecisionDashboard from './DecisionDashboard'
import CommunityOperationsPanel, { type OperationsPreview } from './CommunityOperationsPanel'
import { CommunityDataFabric, ServiceCapacityVisual, MonthlyCashFlowVisual, DailyLedgerVisual } from './CommunityAnalysisVisuals'
import CommunityOperationsPlayground, { type ExplorationSnapshot } from './CommunityOperationsPlayground'
import CostNeuralPreview from './CostNeuralPreview'
import { AnimatedNumber, useAnalysisMotion } from './analysis-motion'
import type { StrategyDirection } from './strategy-direction-text'
import './complete-community-demo.css'

const analysisColors = { blue: '#236b70', secondary: '#5890ba', teal: '#439b82', red: '#cb6352', violet: '#8176a8', gold: '#e2ac59', ink: '#263f43', muted: '#52676a', reference: '#d6dfdf' }
const money = (value: number) => value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
const percent = (value: number) => (value * 100).toFixed(1) + '%'
function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type })), link = document.createElement('a')
  link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function operationsOnlyDemoData(demo: ReturnType<typeof buildCompleteCommunityDemo>, direction: StrategyDirection | undefined, analysis: { selectedScenario: string; scenarios: OperationsPreview[]; playground: ExplorationSnapshot | null }) {
  return { kind: 'synthetic_monthly_operations', direction: direction || null, scope: '共同社区服务输入与月度收支，不包含建设投资或改造评价', population: demo.population, households: demo.households, operations: demo.operations, ledger: demo.ledger, analysis }
}

export default function CompleteCommunityDemo({ project, operationsOnly = false, direction }: { project: Project; operationsOnly?: boolean; direction?: StrategyDirection }) {
  const demo = useMemo(buildCompleteCommunityDemo, [])
  const actual = useMemo(() => summarizeDemoLedger(demo), [demo])
  const [phase, setPhase] = useState<'before' | 'after'>('before')
  const [previews, setPreviews] = useState<OperationsPreview[]>([])
  const [source, setSource] = useState<string[]>([])
  const [exploration, setExploration] = useState<ExplorationSnapshot | null>(null)
  const [scenario, setScenario] = useState('基准')
  const [calculationState, setCalculationState] = useState<'idle' | 'calculating' | 'error'>('calculating')
  const motion = useAnalysisMotion()
  const baseline = previews.find(p => p.label === '基准')?.result
  const selectedPreview = previews.find(p => p.label === scenario && p.result) || previews.find(p => p.label === '基准' && p.result)
  const selectedResult = selectedPreview?.result || null
  const activeScenario = selectedPreview?.label || scenario
  const period = selectedPreview?.input.period || demo.operations.period
  const rows = [
    ['服务人次', 'served_visits', '人次/月'], ['去重服务人数', 'unique_users', '人/月'],
    ['居民自付收入', 'fee_income', '元/月'], ['运营现金支出', 'operating_cost', '元/月'],
    ['政府购买服务', 'government_purchase', '元/月'], ['运营补贴', 'operating_subsidy', '元/月'],
    ['补贴后现金结余', 'balance_after_support', '元/月'],
  ] as const
  function exportReport() {
    let report = operationsOnly ? `# ${direction === 'rebuild' ? '原拆原建' : direction === 'comprehensive' ? '综合整治' : '当前方向'} · 月度运营模拟\n\n共同社区服务假设：${demo.population}人、${demo.households}户。仅列月度运营参数、收支与模拟台账，建设投资和改造评价在对应方向页面查看。\n\n## 基准运营输入\n\n\`\`\`json\n${JSON.stringify(demo.operations, null, 2)}\n\`\`\`\n\n## 台账汇总\n\n${JSON.stringify(actual, null, 2)}\n` : renderCompleteDemoReport(demo)
    report += '\n## 当前核算情景与参数\n\n'
    for (const preview of previews) if (preview.result) report += `\n### ${preview.label} · ${preview.input.period}\n\n` + Object.entries(preview.result.metrics).map(([key, value]) => `${key}: ${value}`).join('\n') + '\n\n参数与来源：\n```json\n' + JSON.stringify(preview.input, null, 2) + '\n```\n'
    if (exploration) report += '\n## 当前互动推演\n\n' + Object.entries(exploration.result.metrics).map(([key, value]) => `${key}: ${value}`).join('\n') + '\n\n调整参数与来源：\n```json\n' + JSON.stringify(exploration, null, 2) + '\n```\n'
    download(operationsOnly ? '当前方向月度运营模拟报表.md' : '完整社区模拟报表.md', report, 'text/markdown;charset=utf-8')
  }
  const theme = Object.fromEntries(Object.entries(analysisColors).map(([key, value]) => [`--analysis-${key}`, value])) as CSSProperties
  return <section className="complete-community-demo" style={theme} data-motion={motion.enabled ? 'on' : 'off'} aria-label="完整社区数据模拟报表">
    <header className="full-demo-heading analysis-hero-card"><div><span className="full-demo-tag">完整模拟 · 可交互推演</span><h2>拖动需求和预算，看看社区怎么运行</h2><p>600户 · 1500人 · 三类服务。调一调参数，保留不同方案，进行方案对比。</p></div>
      <div className="full-demo-actions"><button type="button" disabled={!baseline || !exploration || calculationState === 'calculating'} onClick={exportReport}>{operationsOnly ? '导出月度运营报表' : '导出完整模拟报表'}</button><button type="button" onClick={() => download(operationsOnly ? '当前方向月度运营数据.json' : '完整社区模拟数据.json', JSON.stringify(operationsOnly ? operationsOnlyDemoData(demo, direction, { selectedScenario: activeScenario, scenarios: previews, playground: exploration }) : { ...demo, analysis: { selectedScenario: activeScenario, scenarios: previews, playground: exploration } }, null, 2), 'application/json')}>{operationsOnly ? '导出月度运营数据' : '导出样本与当前分析'}</button><button type="button" className="analysis-motion-control" aria-pressed={motion.userReduced} onClick={() => motion.setUserReduced(!motion.userReduced)}>{motion.enabled ? '减少动效' : '动效已减少'}</button></div>
    </header>
    <CommunityOperationsPlayground key={`${project.id}:${project.context_version}:${operationsOnly ? direction || 'unselected' : ''}`} project={project} demo={demo} baseline={baseline || undefined} motion={motion.enabled} onResult={setExploration} storageScope={operationsOnly ? `${project.context_version}:${direction || 'unselected'}` : undefined} />
    {!operationsOnly && <><CostNeuralPreview />
    <details className="full-demo-secondary"><summary>查看社区名册、现况与改造安排</summary>
    <div className="full-demo-overview" aria-label="模拟社区规模">
      <div><span>覆盖家庭</span><strong><AnimatedNumber value={demo.households} enabled={motion.enabled} /> <small>户</small></strong><p>540份问卷＋60户补访</p></div>
      <div><span>社区居民</span><strong><AnimatedNumber value={demo.population} enabled={motion.enabled} /> <small>人</small></strong><div className="analysis-population-key" aria-hidden="true"><i style={{width:'28%',background:analysisColors.blue}} /><i style={{width:'12%',background:analysisColors.violet}} /><i style={{width:'60%',background:analysisColors.reference}} /></div><p>老人420 · 儿童180 · 其他900</p></div>
      <div><span>改造范围</span><strong><AnimatedNumber value={demo.buildingArea} enabled={motion.enabled} /> <small>㎡</small></strong><p>15幢，每幢40户</p></div>
      <div><span>拟方案建设预算</span><strong><AnimatedNumber value={demo.capital.total!} enabled={motion.enabled} /> <small>万元</small></strong><p>1440万元工程＋10%预备费</p></div>
    </div>
    <CommunityDataFabric demo={demo} phase={phase} motion={motion.enabled} />
    <section className="full-demo-six" aria-label="完整模拟六维现况">
      <div className="full-demo-section-heading"><div><h3>现况诊断与拟方案改善</h3><p>每个维度都有数字、具体问题和拟处理内容；点击维度可查看推算依据。</p></div><div className="full-demo-switch"><button type="button" aria-pressed={phase === 'before'} onClick={() => setPhase('before')}>改造前现况</button><button type="button" aria-pressed={phase === 'after'} onClick={() => setPhase('after')}>拟改造方案</button></div></div>
      <DecisionDashboard value={phase === 'before' ? demo.beforeDashboard : demo.afterDashboard} compare={phase === 'after' ? demo.beforeDashboard : undefined} animate={motion.enabled} onEvidence={setSource} presentation={{ title: '老旧小区六维观察 · 完整模拟', scale: '条件覆盖度 · 1–5级', method: '演示规则：1＋4×已满足条件比例，最高5级；当前现况与方案使用同一分母。分值用于展示逐维变化，施工安排另按工程接口、资金与居民协商条件决定。' }} />
      {phase === 'after' && <div className="analysis-radar-key"><span><i className="is-reference" />虚线：改造前现况</span><span><i />实线：拟改造方案</span></div>}
      <div className="full-demo-observations">{demo.dimensions.map(d => <article key={d.key}><header><h4>{d.label}</h4><span>{demo.beforeDashboard.dimensions.find(r => r.key === d.key)!.value!.toFixed(1)} → {demo.afterDashboard.dimensions.find(r => r.key === d.key)!.value!.toFixed(1)}</span></header><p><strong>模拟现况：</strong>{d.before}</p><p><strong>拟方案：</strong>{d.after}</p><small>{d.source}</small></article>)}</div>
      {!!source.length && <div className="full-demo-source" role="status"><strong>所选维度的数据构造依据</strong>{demo.provenance.filter(p => source.includes(p.id)).map(p => <p key={p.id}>{p.basis} 来源：{p.source}</p>)}</div>}
    </section>
    <section className="full-demo-capital" aria-label="模拟资金与实施安排"><h3>建设资金与实施顺序</h3><div className="full-demo-funding"><div><span>财政资金</span><strong>1,280 万元</strong></div><div><span>居民出资</span><strong>160 万元</strong></div><div><span>合作方出资</span><strong>160 万元</strong></div><div><span>预算余额</span><strong>16 万元</strong></div></div><p>建设预算：基础类800、完善类440、提升类200万元，另设144万元预备费。先实施供水和适老通行，再按楼栋安排施工；30户异议与18户暂缓签署均进入协商台账。建设资金与下面的月度运营分开核算。</p></section>
    </details></>}
    <details className="full-demo-secondary"><summary>展开标准情景、年度预算与完整参数</summary>
    <section className="analysis-workbench" aria-label="交互运营分析"><div className="analysis-workbench-controls"><div><span className="analysis-eyebrow">SCENARIO EXPLORER</span><h3>切换需求，观察运营如何变化</h3></div><div className="analysis-scenario-controls">{['保守','基准','积极'].map(label=><button key={label} type="button" aria-pressed={activeScenario===label} disabled={!previews.find(p=>p.label===label)?.result || calculationState === 'calculating'} onClick={()=>setScenario(label)}>{label}情景</button>)}</div></div>
      {selectedResult && <div className="analysis-live-metrics"><div className="analysis-live-metric"><span>{activeScenario} · 服务人次</span><strong><AnimatedNumber value={selectedResult.metrics.served_visits!} enabled={motion.enabled} /><small>人次/月</small></strong><p>容量 {money(selectedResult.metrics.capacity_visits!)} 人次</p></div><div className="analysis-live-metric"><span>目标居民覆盖</span><strong><AnimatedNumber value={selectedResult.metrics.coverage! * 100} decimals={1} enabled={motion.enabled} /><small>%</small></strong><p>{selectedResult.metrics.unique_users}位居民 / 1500人</p></div><div className="analysis-live-metric"><span>支持后现金结余</span><strong><AnimatedNumber value={selectedResult.metrics.balance_after_support!} enabled={motion.enabled} /><small>元/月</small></strong><p>经营收入 {money(selectedResult.metrics.earned_income!)} 元</p></div><div className="analysis-live-metric"><span>财政每服务人次支出</span><strong><AnimatedNumber value={selectedResult.metrics.government_cost_per_visit!} decimals={2} enabled={motion.enabled} /><small>元/人次</small></strong><p>购买、补贴与直付分账核对</p></div></div>}
      <ServiceCapacityVisual result={selectedResult} period={period} motion={motion.enabled} />
      <MonthlyCashFlowVisual result={selectedResult} period={period} />
    </section>
    <section className="full-demo-cash" aria-label="完整模拟月度报表"><h3>{activeScenario}情景 · {period} · 经营与财政预算</h3>
      {selectedResult ? <><div className="full-demo-overview"><div><span>服务人次 / 容量利用率</span><strong>{money(selectedResult.metrics.served_visits!)} <small>人次</small></strong><p>{percent(selectedResult.metrics.utilization!)} · 容量{money(selectedResult.metrics.capacity_visits!)}人次</p></div><div><span>月度去重居民 / 覆盖率</span><strong>{money(selectedResult.metrics.unique_users!)} <small>人</small></strong><p>{percent(selectedResult.metrics.coverage!)} · 目标1500人</p></div><div><span>经营收入 / 运营现金支出</span><strong>{money(selectedResult.metrics.earned_income!)} <small>元</small></strong><p>现金支出{money(selectedResult.metrics.operating_cost!)}元/月</p></div><div><span>补贴后运营结余</span><strong>{money(selectedResult.metrics.balance_after_support!)} <small>元/月</small></strong><p>所需补贴{money(selectedResult.metrics.required_subsidy!)}元/月</p></div></div>
      <div className="full-demo-budget"><div><h4>运营方年度预算</h4><p>经营收入 <strong>{money(selectedResult.metrics.earned_income! * 12 / 10000)}万元</strong>；运营成本 <strong>{money(selectedResult.metrics.operating_cost! * 12 / 10000)}万元</strong>。</p></div><div><h4>政府年度运营投入</h4><p>购买服务{money(selectedResult.metrics.government_purchase! * 12 / 10000)}万元＋补贴{money(selectedResult.metrics.operating_subsidy! * 12 / 10000)}万元＋直付维护{money(selectedResult.metrics.government_direct_cost! * 12 / 10000)}万元＝<strong>{money(selectedResult.metrics.government_outlay! * 12 / 10000)}万元</strong>；政府现金收入 <strong>0元</strong>。</p></div></div><p className="full-demo-footnote">年度预算按月度现金×12折算；月度去重人数只在该月计算。政府效果同时查看服务人次、覆盖率和设施利用率。</p></> : <p role="status" className="full-demo-loading">正在通过月度核算接口生成完整报表…</p>}
    </section>
    <CommunityOperationsPanel project={project} completeDemo={demo} onPreviews={setPreviews} onCalculationState={setCalculationState} direction={operationsOnly ? direction : undefined} />
    </details>
    <details className="full-demo-secondary"><summary>探索逐日台账，核对计划与月末结果</summary>
    <DailyLedgerVisual demo={demo} />
    <section className="full-demo-ledger" aria-label="模拟台账核对"><div className="full-demo-section-heading"><div><h3>模拟月末台账 · 与基准计划核对</h3><p>1568条逐人次登记记录，跨项目去重286人。每条记录都有场次、居民编号、收费及变动支出；本表演示数据齐备后的核对效果。</p></div><button type="button" onClick={() => { const keys = ['id', 'period', 'date', 'service_id', 'slot', 'resident_id', 'paid', 'charge', 'variable_cost', 'kind'] as const; download('模拟服务台账-202609.csv', '\uFEFF' + [keys.join(','), ...demo.ledger.map(row => keys.map(key => row[key]).join(','))].join('\n'), 'text/csv;charset=utf-8') }}>导出1568行模拟台账</button></div>
      {baseline && <div className="full-demo-table"><table><thead><tr><th>指标</th><th>模拟基准计划</th><th>模拟台账汇总</th><th>台账−计划</th></tr></thead><tbody>{rows.map(([label, key, unit]) => <tr key={key}><td>{label}<small> {unit}</small></td><td>{money(baseline.metrics[key]!)}</td><td>{money(actual[key])}</td><td>{money(actual[key] - baseline.metrics[key]!)}</td></tr>)}</tbody></table></div>}
      <p>模拟台账：收费收入15,095元，固定支出26,500元、变动支出9,028元，运营现金支出35,528元；合作收入4,800元，购买服务5,000元、补贴12,000元，运营结余1,367元。政府直付2,000元单列。</p>
    </section>
    </details>
    {!operationsOnly && <details className="full-demo-provenance"><summary>全套数据怎样构造 · 参考、假设与公式</summary>{demo.provenance.map(p => <article key={p.id}><h4>{p.label}<span>{({ reference: '区间参考', assumption: '模拟假设', derived: '公式推算' })[p.kind]}</span></h4><p>{p.basis}</p><small>{p.source}</small></article>)}</details>}
  </section>
}
