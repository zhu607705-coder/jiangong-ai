import { useMemo, useState } from 'react'
import type { Project } from '../api'
import { buildCompleteCommunityDemo, renderCompleteDemoReport, summarizeDemoLedger } from '../../../../packages/retrofit/complete-demo'
import DecisionDashboard from './DecisionDashboard'
import CommunityOperationsPanel, { type OperationsPreview } from './CommunityOperationsPanel'
import './complete-community-demo.css'

const money = (value: number) => value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
const percent = (value: number) => (value * 100).toFixed(1) + '%'
function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type })), link = document.createElement('a')
  link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export default function CompleteCommunityDemo({ project }: { project: Project }) {
  const demo = useMemo(buildCompleteCommunityDemo, [])
  const actual = useMemo(() => summarizeDemoLedger(demo), [demo])
  const [phase, setPhase] = useState<'before' | 'after'>('before')
  const [previews, setPreviews] = useState<OperationsPreview[]>([])
  const [source, setSource] = useState<string[]>([])
  const baseline = previews.find(p => p.label === '基准')?.result
  const rows = [
    ['服务人次', 'served_visits', '人次/月'], ['去重服务人数', 'unique_users', '人/月'],
    ['居民自付收入', 'fee_income', '元/月'], ['运营现金支出', 'operating_cost', '元/月'],
    ['政府购买服务', 'government_purchase', '元/月'], ['运营补贴', 'operating_subsidy', '元/月'],
    ['补贴后现金结余', 'balance_after_support', '元/月'],
  ] as const
  function exportReport() {
    let report = renderCompleteDemoReport(demo)
    if (baseline) report += '\n## 正式计算接口返回的基准指标\n\n' + Object.entries(baseline.metrics).map(([key, value]) => `${key}: ${value}`).join('\n') + '\n'
    download('完整社区模拟报表.md', report, 'text/markdown;charset=utf-8')
  }
  return <section className="complete-community-demo" aria-label="完整社区数据模拟报表">
    <header className="full-demo-heading"><div><span className="full-demo-tag">全量数据模拟 · 可复算</span><h2>如果资料齐备，政府工作人员会看到什么</h2><p>展示对象为虚构的杭州样本社区。公开工程合同提供预算量级参考，人口、协商、工程条件和逐人次运营台账按下方规则构造。</p></div>
      <div className="full-demo-actions"><button type="button" onClick={exportReport}>导出完整模拟报表</button><button type="button" onClick={() => download('完整社区模拟数据.json', JSON.stringify(demo, null, 2), 'application/json')}>导出全套数据</button></div>
    </header>
    <div className="full-demo-overview" aria-label="模拟社区规模">
      <div><span>覆盖家庭</span><strong>600 <small>户</small></strong><p>540份问卷＋60户补访</p></div>
      <div><span>社区居民</span><strong>1,500 <small>人</small></strong><p>老人420 · 儿童180 · 其他900</p></div>
      <div><span>改造范围</span><strong>45,000 <small>㎡</small></strong><p>15幢，每幢40户</p></div>
      <div><span>拟方案建设预算</span><strong>1,584 <small>万元</small></strong><p>1440万元工程＋10%预备费</p></div>
    </div>
    <section className="full-demo-six" aria-label="完整模拟六维现况">
      <div className="full-demo-section-heading"><div><h3>现况诊断与拟方案改善</h3><p>每个维度都有数字、具体问题和拟处理内容；点击维度可查看推算依据。</p></div><div className="full-demo-switch"><button type="button" aria-pressed={phase === 'before'} onClick={() => setPhase('before')}>改造前现况</button><button type="button" aria-pressed={phase === 'after'} onClick={() => setPhase('after')}>拟改造方案</button></div></div>
      <DecisionDashboard value={phase === 'before' ? demo.beforeDashboard : demo.afterDashboard} onEvidence={setSource} presentation={{ title: '老旧小区六维观察 · 完整模拟', scale: '条件覆盖度 · 1–5级', method: '演示规则：1＋4×已满足条件比例，最高5级；当前现况与方案使用同一分母。分值用于展示逐维变化，施工安排另按工程接口、资金与居民协商条件决定。' }} />
      <div className="full-demo-observations">{demo.dimensions.map(d => <article key={d.key}><header><h4>{d.label}</h4><span>{demo.beforeDashboard.dimensions.find(r => r.key === d.key)!.value!.toFixed(1)} → {demo.afterDashboard.dimensions.find(r => r.key === d.key)!.value!.toFixed(1)}</span></header><p><strong>模拟现况：</strong>{d.before}</p><p><strong>拟方案：</strong>{d.after}</p><small>{d.source}</small></article>)}</div>
      {!!source.length && <div className="full-demo-source" role="status"><strong>所选维度的数据构造依据</strong>{demo.provenance.filter(p => source.includes(p.id)).map(p => <p key={p.id}>{p.basis} 来源：{p.source}</p>)}</div>}
    </section>
    <section className="full-demo-capital" aria-label="模拟资金与实施安排"><h3>建设资金与实施顺序</h3><div className="full-demo-funding"><div><span>财政资金</span><strong>1,280 万元</strong></div><div><span>居民出资</span><strong>160 万元</strong></div><div><span>合作方出资</span><strong>160 万元</strong></div><div><span>预算余额</span><strong>16 万元</strong></div></div><p>建设预算：基础类800、完善类440、提升类200万元，另设144万元预备费。先实施供水和适老通行，再按楼栋安排施工；30户异议与18户暂缓签署均进入协商台账。建设资金与下面的月度运营分开核算。</p></section>
    <section className="full-demo-cash" aria-label="完整模拟月度报表"><h3>2026年9月 · 使用、运营与财政视图</h3>
      {baseline ? <><div className="full-demo-overview"><div><span>服务人次 / 容量利用率</span><strong>{money(baseline.metrics.served_visits!)} <small>人次</small></strong><p>{percent(baseline.metrics.utilization!)} · 容量2044人次</p></div><div><span>月度去重居民 / 覆盖率</span><strong>{money(baseline.metrics.unique_users!)} <small>人</small></strong><p>{percent(baseline.metrics.coverage!)} · 目标1500人</p></div><div><span>经营收入 / 运营现金支出</span><strong>{money(baseline.metrics.earned_income!)} <small>元</small></strong><p>现金支出{money(baseline.metrics.operating_cost!)}元/月</p></div><div><span>补贴后运营结余</span><strong>{money(baseline.metrics.balance_after_support!)} <small>元/月</small></strong><p>所需补贴{money(baseline.metrics.required_subsidy!)}元/月</p></div></div>
      <div className="full-demo-budget"><div><h4>运营方年度预算</h4><p>经营收入 <strong>{money(baseline.metrics.earned_income! * 12 / 10000)}万元</strong>；运营成本 <strong>{money(baseline.metrics.operating_cost! * 12 / 10000)}万元</strong>。</p></div><div><h4>政府年度运营投入</h4><p>购买服务6万元＋补贴14.4万元＋直付维护2.4万元＝<strong>22.8万元</strong>；政府现金收入 <strong>0元</strong>。</p></div></div><p className="full-demo-footnote">年度预算按月度现金×12折算；月度去重人数只在该月计算。政府效果同时查看服务人次、覆盖率和设施利用率。</p></> : <p role="status" className="full-demo-loading">正在通过月度核算接口生成完整报表…</p>}
    </section>
    <CommunityOperationsPanel project={project} completeDemo={demo} onPreviews={setPreviews} />
    <section className="full-demo-ledger" aria-label="模拟台账核对"><div className="full-demo-section-heading"><div><h3>模拟月末台账 · 与基准计划核对</h3><p>1568条逐人次登记记录，跨项目去重286人。每条记录都有场次、居民编号、收费及变动支出；本表演示数据齐备后的核对效果。</p></div><button type="button" onClick={() => { const keys = ['id', 'period', 'date', 'service_id', 'slot', 'resident_id', 'paid', 'charge', 'variable_cost', 'kind'] as const; download('模拟服务台账-202609.csv', '\uFEFF' + [keys.join(','), ...demo.ledger.map(row => keys.map(key => row[key]).join(','))].join('\n'), 'text/csv;charset=utf-8') }}>导出1568行模拟台账</button></div>
      {baseline && <div className="full-demo-table"><table><thead><tr><th>指标</th><th>模拟基准计划</th><th>模拟台账汇总</th><th>台账−计划</th></tr></thead><tbody>{rows.map(([label, key, unit]) => <tr key={key}><td>{label}<small> {unit}</small></td><td>{money(baseline.metrics[key]!)}</td><td>{money(actual[key])}</td><td>{money(actual[key] - baseline.metrics[key]!)}</td></tr>)}</tbody></table></div>}
      <p>模拟台账：收费收入15,095元，固定支出26,500元、变动支出9,028元，运营现金支出35,528元；合作收入4,800元，购买服务5,000元、补贴12,000元，运营结余1,367元。政府直付2,000元单列。</p>
    </section>
    <details className="full-demo-provenance"><summary>全套数据怎样构造 · 参考、假设与公式</summary>{demo.provenance.map(p => <article key={p.id}><h4>{p.label}<span>{({ reference: '区间参考', assumption: '模拟假设', derived: '公式推算' })[p.kind]}</span></h4><p>{p.basis}</p><small>{p.source}</small></article>)}</details>
  </section>
}
