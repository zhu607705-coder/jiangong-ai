import { useEffect, useRef, useState } from 'react'
import { IconBuildingCommunity, IconBuildingSkyscraper, IconSparkles, IconChevronDown, IconArrowUpRight } from '@tabler/icons-react'
import { api } from '../api'
import type { DecisionSupport } from '../../../host/generated/contracts'
import { MODE_LABELS, type RenewalModeInput, type RenewalModePacket } from '../../../../packages/retrofit/renewal-mode'
import { decisionErrorMessage } from '../../../../packages/decision/route-labels'
import type { StrategyPacket } from '../../../../packages/retrofit/strategy'
import './RenewalModePanel.css'

const money = (value: number) => value >= 1e8 ? `${(value / 1e8).toLocaleString('zh-CN', { maximumFractionDigits: 3 })} 亿元` : `${(value / 10000).toLocaleString('zh-CN', { maximumFractionDigits: 4 })} 万元`
const kinds: Record<string, string> = { contract_price: '合同价', winning_bid: '中标价', budget: '预算', tender_ceiling: '控制价', estimate: '估算', settlement: '结算' }
const conditionLabels: Record<string, string> = { structure_repairable: '可修复性', demolition_permitted: '拆除许可条件', rights_clear: '权属', rebuild_planning_confirmed: '拆建规划', resident_resolution_valid: '居民决议', relocation_ready: '安置', funding_secured: '落实资金', life_cycle_cost_compared: '全周期费用比选', maintenance_entity_confirmed: '维护主体' }

export default function RenewalModePanel({ endpoint, contextVersion, input, decision, strategy, compact=false, onInvestigate }: {
  endpoint: string; contextVersion?: number; input: RenewalModeInput; decision?: DecisionSupport | null; strategy?:StrategyPacket|null; compact?:boolean; onInvestigate?: () => void;
}) {
  const [packet, setPacket] = useState<RenewalModePacket | null>(null), [running, setRunning] = useState(false), [error, setError] = useState('')
  const [cachedStrategy,setCachedStrategy]=useState<StrategyPacket|null>(null)
  const [tab, setTab] = useState<'compare' | 'standards' | 'cases'>('compare'), [path, setPath] = useState<'comprehensive' | 'rebuild'>('comprehensive')
  const [caseId, setCaseId] = useState(input.cases[0]?.id), [openStandard, setOpenStandard] = useState('')
  const restoreController = useRef<AbortController | null>(null), requestController = useRef<AbortController | null>(null)
  const identity = useRef(''); identity.current = `${endpoint}|${contextVersion ?? ''}`
  useEffect(() => {
    const controller = new AbortController()
    restoreController.current = controller; requestController.current?.abort()
    setPacket(null); setCachedStrategy(null); setRunning(false); setError(''); setTab('compare'); setOpenStandard('')
    const projectRoute=endpoint.match(/^\/projects\/([^/]+)\/renewal-mode$/)
    if(projectRoute&&!compact)void api<StrategyPacket|null>(`/projects/${projectRoute[1]}/renewal-strategy?demo=false`,undefined,controller.signal).then(value=>{if(!controller.signal.aborted)setCachedStrategy(value)}).catch(()=>{})
    void api<RenewalModePacket>(endpoint, undefined, controller.signal).then(value => {
      if (!controller.signal.aborted) { setPacket(value); setPath(value.decision?.renewal_mode?.direction === 'rebuild' ? 'rebuild' : 'comprehensive') }
    }).catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : '模式资料读取未完成。') })
    return () => { controller.abort(); requestController.current?.abort() }
  }, [endpoint, contextVersion])
  const screening = packet?.screening || input, result = packet?.decision || decision, mode = result?.renewal_mode
  const agent=(strategy||cachedStrategy)?.status==='completed'&&!(strategy||cachedStrategy)?.synthetic?(strategy||cachedStrategy)?.strategy:null
  const example = screening.cases.find(row => row.id === caseId) || screening.cases[0]
  const evidence = screening.evidence.filter(row => mode?.source_ids.includes(row.source_id))
  useEffect(() => {
    if (mode?.direction === 'comprehensive' || mode?.direction === 'rebuild') setPath(mode.direction)
  }, [mode?.direction])
  // Every request belongs to this object. Unmounting or changing its snapshot cancels it.
  async function judge() {
    if (running) return
    restoreController.current?.abort()
    const controller = new AbortController(), currentIdentity = identity.current
    requestController.current = controller; setRunning(true); setError('')
    try {
      const value = await api<RenewalModePacket>(endpoint, { ...(contextVersion === undefined ? {} : { expected_context_version: contextVersion }), refresh: !!result }, controller.signal)
      if (!controller.signal.aborted && currentIdentity === identity.current) setPacket(value)
    } catch (e) { if (!controller.signal.aborted && currentIdentity === identity.current) setError(e instanceof Error ? e.message : '模式判定未完成。') }
    finally { if (!controller.signal.aborted && currentIdentity === identity.current) setRunning(false) }
  }
  const condition = (kind: string) => screening.conditions.find(row => row.kind === kind)
  return <section className="renewal-mode-panel" aria-label="改造模式判定">
    <header><span className="renewal-step">先判模式</span><h3>改造模式判定</h3><span className="renewal-stage">{screening.synthetic ? '模拟初判' : agent?'Agent 初步方案':mode ? '初步方向' : '两条路径'}</span></header>
    <div className={`renewal-direction is-${mode?.direction || 'compare'}`}>
      <strong>{agent ? MODE_LABELS[agent.preferred_mode] : mode ? MODE_LABELS[mode.direction] : '综合整治，还是原拆原建？'}</strong>
      <p>{agent&&!compact?agent.headline:mode?.summary || '先比较建筑保留与拆建的条件，再进入六维方案分析。'}</p>
      {agent&&!compact&&<p>{agent.summary.slice(0,260)}{agent.summary.length>260?'…':''}</p>}
      {mode && mode.status !== 'preliminary' && <p>模型原始方向：{MODE_LABELS[mode.model_choice.choice as keyof typeof MODE_LABELS]}</p>}
      {mode?.reasons.map(reason => <p className="renewal-restriction" key={reason}>{reason}</p>)}
      {mode && <p className="renewal-next"><span>优先调查</span>{mode.next_step}</p>}
      <div className="renewal-judge-actions">
        <button onClick={() => void judge()} disabled={running}><IconSparkles size={17}/>{running ? 'decision 正在判定…' : mode ? '更新模式初判' : '判定改造模式'}</button>
        {mode && <button onClick={() => { setTab('standards'); setOpenStandard(mode.priority_constraint.choice) }}>查看判定条件</button>}
      </div>
      {running && <button className="renewal-stop" onClick={() => { requestController.current?.abort(); setRunning(false) }}>停止本次判定</button>}
      {mode && <div className="renewal-meta">decision 初判 · 对象资料截至 {screening.as_of.slice(0, 10)}</div>}
      {(error || result && result.status !== 'completed') && <p className="renewal-error" role="alert">{error || decisionErrorMessage(result?.error_code || '')}</p>}
    </div>
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
        <p className="renewal-combination">可按楼栋组合：主体综合整治，特定楼栋另做拆建论证；年龄或单项费用不能单独决定模式。</p>
      </>}
      {tab === 'standards' && <>
        <p className="renewal-standard-intro">项目初筛标准 v1 · 先核限制，再比较效果和费用。逐栋鉴定与属地程序决定实施条件。</p>
        {screening.standards.map(row => {
          const rows = row.kinds.map(kind => condition(kind)).filter(Boolean)
          const status = rows.some(item => item?.state === 'conflict') ? '存在分歧' : rows.some(item => item?.state === 'restricted') ? '有限制记录' : rows.every(item => item?.state === 'supported') ? '已有条件记录' : '安排专项核查'
          return <article className="renewal-standard" key={row.key}>
            <button aria-expanded={openStandard === row.key} onClick={() => setOpenStandard(openStandard === row.key ? '' : row.key)}><strong>{row.label}</strong><span>{status}</span><IconChevronDown size={16}/></button>
            {openStandard === row.key && <div><p>{row.task}</p>{row.kinds.map(kind => <p className="renewal-condition" key={kind}>{conditionLabels[kind]}：{condition(kind)?.state === 'supported' ? '已登记满足' : condition(kind)?.state === 'restricted' ? '已登记不满足' : condition(kind)?.state === 'conflict' ? '记录冲突' : '尚无对应鉴定或确认记录'}</p>)}
              {!!rows.flatMap(item => item?.locators || []).length && <p>原文定位：{rows.flatMap(item => item?.locators || []).join('、')}</p>}
            </div>}
          </article>
        })}
        {onInvestigate && <button className="renewal-investigate" onClick={onInvestigate}>进入项目安排调查<IconArrowUpRight size={17}/></button>}
      </>}
      {tab === 'cases' && <>
        <div className="renewal-case-switch">{screening.cases.map(row => <button key={row.id} aria-pressed={example?.id === row.id} onClick={() => setCaseId(row.id)}>{row.name}<span>{row.city}</span></button>)}</div>
        {example && <article className="renewal-case">
          <h4>{example.name}<span>{example.mode}</span></h4><p>{example.reported_stage} · 来源日期 {example.published_at}</p>
          <dl>{example.metrics.map(metric => <div key={metric.label}><dt>{metric.label}</dt><dd>{metric.unit === '元' ? money(metric.value) : `${metric.value.toLocaleString('zh-CN')} ${metric.unit}`}<span>{metric.scope}</span></dd></div>)}</dl>
          <p>{example.funding_note}</p><p>{example.comparison_note}</p>
          <a href={example.url} target="_blank" rel="noreferrer">{example.publisher} · 查看原文 ↗</a>
          {example.related_source && <p>{example.related_source.note}<a href={example.related_source.url} target="_blank" rel="noreferrer">工程规模原文 ↗</a></p>}
        </article>}
        {screening.history && <div className="renewal-history">
          <h4>历史工程库 · 同阶段对照</h4><p>{screening.history.total.toLocaleString('zh-CN')} 条工程 · {screening.history.contract_count.toLocaleString('zh-CN')} 条有合同价 · {screening.history.settlement_count} 条有结算价</p>
          {screening.history.official_costs.filter(row => example?.name === '浙工新村' ? row.project_name.includes('浙工新村') : row.project_name.includes(example?.name || '')).map(row => <article key={row.id}><strong>{kinds[row.amount_kind] || row.amount_kind} · {money(row.amount_yuan)}</strong><p>{row.project_name}</p><p>{row.date} · {row.city || '来源所列区域'}</p><a href={row.url} target="_blank" rel="noreferrer">交易原件 ↗</a></article>)}
          <p>总投资、EPC合同与分项工程分别比较。用杭州工程量和价格重新测算，上海成本与收益不直接套用。</p>
          {!!screening.history.records.length && <details><summary>查看工作簿对应行</summary>{screening.history.records.map(row => <p key={row.id}>{row.project_name} · {row.locator} · 提供工作簿</p>)}</details>}
        </div>}
      </>}
    </div>
    <details className="renewal-evidence"><summary>本对象依据{evidence.length ? ` · ${evidence.length} 份主要原文` : ` · ${screening.evidence.length} 份可读材料`}</summary>
      {(evidence.length ? evidence : screening.evidence).map(row => <article key={row.source_id}><strong>{row.title}</strong><p>{row.published_at.slice(0, 10)} · {row.locator}</p><blockquote>{row.quote}</blockquote>{row.url && /^https?:\/\//.test(row.url) && <a href={row.url} target="_blank" rel="noreferrer">查看来源 ↗</a>}</article>)}
      {!screening.evidence.length && <p>先补充本小区逐栋调查或公开原件；案例参考保留为独立对标。</p>}
    </details>
  </section>
}
