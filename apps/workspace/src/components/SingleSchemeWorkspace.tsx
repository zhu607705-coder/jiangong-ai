import { useMemo, useState } from 'react'
import type { DecisionDashboard as Dashboard } from '../../../host/generated/contracts'
import type { Project } from '../api'
import type { StrategyPacket } from '../../../../packages/retrofit/strategy'
import { MODE_LABELS } from '../../../../packages/retrofit/renewal-mode'
import { calculateRetrofitPlan, type RetrofitPlan } from '../../../../packages/retrofit/planning'
import { buildCompleteCommunityDemo, buildStrategyDemo } from '../../../../packages/retrofit/complete-demo'
import { compareGoalPriorities, PRIORITY_DIMENSIONS, PRIORITY_PRESETS, type PriorityWeights } from '../../../../packages/retrofit/decision-priorities'
import { NEIGHBORHOOD_DASHBOARD_POLICY } from '../../../../packages/decision/dashboard'
import { currentDirectionText, type StrategyDirection } from './strategy-direction-text'
import type { SchemePane, StrategyWorkspaceNavigation } from './strategy-workspace'
import { createNeighborhoodDraft, type NeighborhoodDraft } from './NeighborhoodPanel'
import DecisionDashboard from './DecisionDashboard'
import CommunityOperationsPanel from './CommunityOperationsPanel'
import CompleteCommunityDemo from './CompleteCommunityDemo'
import ConcreteWorkPlan from './ConcreteWorkPlan'
import './single-scheme-workspace.css'

type Props = {
  project: Project
  result: StrategyPacket | null
  mode: StrategyDirection
  demoActive: boolean
  pane: SchemePane
  onNavigate: (target: StrategyWorkspaceNavigation) => void
  onEvidence: (refs: string[], packet?: StrategyPacket) => void
  onInvestigate?: () => void
}
const PANES: { id: SchemePane; label: string; description: string }[] = [
  { id: 'content', label: '内容与效果', description: '举措、实施条件与改后目标' },
  { id: 'funding', label: '建设与资金', description: '费用构成、计划资金与缺口' },
  { id: 'operations', label: '社区运营', description: '服务安排与月度收支' },
  { id: 'sensitivity', label: '敏感性与核验', description: '目标权重与本方案适配' },
]
const LEVELS = { low: 1, medium: 3, high: 5, unknown: null }
const show = (value: number | null | undefined, digits = 2) => value == null ? '待补充' : value.toLocaleString('zh-CN', { maximumFractionDigits: digits })
const unique = (refs: string[]) => [...new Set(refs)]

function initialFunding(mode: StrategyDirection, demoActive: boolean): NeighborhoodDraft {
  const draft = createNeighborhoodDraft()
  if (!demoActive) return draft
  const budget = buildStrategyDemo(mode).budget_wan, common = buildCompleteCommunityDemo()
  draft.inputs = { basic: String(budget), improvement: '0', enhancement: '0', reserve_percent: '0', planned_funding: String(Object.values(common.funding).reduce((sum, value) => sum + value, 0)), households: String(common.households) }
  draft.comparison = { current: calculateRetrofitPlan({ basic: budget, improvement: 0, enhancement: 0, reserve_percent: 0, planned_funding: Number(draft.inputs.planned_funding), households: common.households }), previous: null }
  return draft
}

/** Local scenario state belongs to one saved scheme and never writes project facts. */
export default function SingleSchemeWorkspace(props: Props) {
  const identity = `${props.project.id}:${props.project.context_version}:${props.result?.input_hash || ''}:${props.mode}:${props.demoActive}`
  return <SchemeWorkspace key={identity} {...props}/>
}

function SchemeWorkspace({ project, result, mode, demoActive, pane, onNavigate, onEvidence, onInvestigate }: Props) {
  const saved = result?.status === 'completed' && result.strategy && result.project_id === project.id && result.context_version === project.context_version && result.synthetic === (demoActive || project.input.synthetic) ? result : null
  const strategy = saved?.strategy, path = strategy?.paths.find(row => row.mode === mode)
  const [phase, setPhase] = useState<'before' | 'after'>('after')
  const [funding, setFunding] = useState(() => initialFunding(mode, demoActive))
  const [fundingError, setFundingError] = useState('')
  const [weights, setWeights] = useState<PriorityWeights>(() => ({ ...PRIORITY_PRESETS[0].weights }))
  const demo = useMemo(() => demoActive ? buildStrategyDemo(mode) : null, [demoActive, mode])
  const text = (value: string) => currentDirectionText(value, mode)
  const evidence = (refs: string[]) => onEvidence(unique(refs), saved || undefined)
  const sourceIds = useMemo(() => new Set(saved?.sources.filter(source => source.text.trim()).map(source => source.id) || []), [saved])
  const priority = useMemo(() => {
    if (!strategy) return { assessment: null, error: '' }
    try { return { assessment: compareGoalPriorities(strategy.dimensions, weights, sourceIds)[mode], error: '' } }
    catch { return { assessment: null, error: '至少为一个目标设置大于 0 的权重。' } }
  }, [strategy, weights, sourceIds, mode])
  const dashboard = (after: boolean): Dashboard | null => {
    if (demo) return after ? demo.after : demo.before
    if (!strategy || !saved) return null
    const rows = strategy.dimensions.map(row => ({ key: row.key, value: LEVELS[after ? row[`${mode}_level`] : row.current_level], confidence: null,
      basis: text(after ? row[mode] : row.current) || '本方向尚未登记对应说明。', evidence_refs: row.evidence_refs }))
    return { policy_version: NEIGHBORHOOD_DASHBOARD_POLICY, purpose: `${MODE_LABELS[mode]} · ${after ? '改后目标' : '现况评价'}`, model: saved.model_calls.at(-1)?.returned_model || '已保存方案评价', request_id: saved.input_hash, status: rows.every(row => row.value !== null) ? 'completed' : 'partial', dimensions: rows }
  }
  const current = dashboard(false), target = dashboard(true)
  function navigate(next: SchemePane) { onNavigate({ view: 'scenarios', section: 'detail', pane: next, scheme: mode }) }
  function updateFunding(key: keyof NeighborhoodDraft['inputs'], value: string) {
    setFunding(old => ({ ...old, inputs: { ...old.inputs, [key]: value }, comparison: null })); setFundingError('')
  }
  function calculateFunding() {
    try {
      const values = Object.fromEntries(Object.entries(funding.inputs).map(([key, value]) => [key, value.trim() ? Number(value) : null])) as unknown as RetrofitPlan
      if (values.reserve_percent === null) throw new Error('请填写预备费比例。')
      if (values.households !== null && !Number.isInteger(values.households)) throw new Error('户数须为整数。')
      const calculated = calculateRetrofitPlan(values)
      if (calculated.total === null) throw new Error('请分别填写三项费用；未纳入本方案的项目填 0。')
      setFunding(old => ({ ...old, comparison: { current: calculated, previous: old.comparison?.current || null } })); setFundingError('')
    } catch (error) { setFundingError(error instanceof Error ? error.message : '请核对预算参数。') }
  }
  const fundingLabels: Record<keyof NeighborhoodDraft['inputs'], string> = {
    basic: demoActive ? '本方向预算费用包（万元）' : mode === 'rebuild' ? '本方案建造费用（万元）' : '基础类工程（万元）', improvement: demoActive ? '追加完善类费用（万元）' : mode === 'rebuild' ? '拆除与过渡费用（万元）' : '完善类工程（万元）', enhancement: demoActive ? '追加提升类费用（万元）' : mode === 'rebuild' ? '配套完善费用（万元）' : '提升类工程（万元）',
    reserve_percent: demoActive ? '追加预备费（%）' : '预备费比例（%）', planned_funding: '计划资金（万元）', households: '涉及户数（户）',
  }
  const calculated = funding.comparison?.current
  return <section className="single-scheme-workspace" aria-label={`${MODE_LABELS[mode]}方案工作区`} data-scheme={mode} data-pane={pane}>
    <header className="ssw-header"><div><span className="ssw-eyebrow">{demoActive ? '合成情景 · 单方案推演' : project.input.synthetic ? '合成资料研判 · 单方案工作区' : '已选方向 · 单方案工作区'} · {MODE_LABELS[mode]}</span><h2>{path ? text(path.title) || `${MODE_LABELS[mode]}方案` : `${MODE_LABELS[mode]}方案`}</h2><p>{project.name} · 资料 v{project.context_version}{saved ? <span title={saved.input_hash}> · 方案 {saved.input_hash.slice(0, 12)}</span> : demoActive ? ' · 合成示例' : ' · 尚无本版本完整方案'}</p></div><button type="button" onClick={() => onNavigate({ view: 'scenarios', section: 'compare' })}>← 返回方案比选</button></header>
    <nav className="ssw-tabs" aria-label="单方案工作区页面">{PANES.map(item => <button type="button" key={item.id} aria-current={pane === item.id ? 'page' : undefined} className={pane === item.id ? 'active' : ''} onClick={() => navigate(item.id)}><strong>{item.label}</strong><span>{item.description}</span></button>)}</nav>
    {pane === 'content' && <div className="ssw-content-grid">
      {saved ? <ConcreteWorkPlan packet={saved} direction={mode} onEvidence={onEvidence} onInvestigate={onInvestigate || (() => onNavigate({ view: 'actions', scheme: mode }))}/> : <section className="ssw-panel ssw-plan"><header><span>具体改造安排</span><h3>{MODE_LABELS[mode]}方案内容</h3></header><p className="ssw-empty">本资料版本尚未保存该方向的详细举措。可返回研判页形成方案，再在这里继续细化。</p></section>}
      <section className="ssw-panel ssw-targets"><header><div><span>只看当前方案</span><h3>现况与改后目标</h3></div><div className="ssw-toggle"><button type="button" aria-pressed={phase === 'before'} onClick={() => setPhase('before')}>现况</button><button type="button" aria-pressed={phase === 'after'} onClick={() => setPhase('after')}>改后目标</button></div></header>{(phase === 'before' ? current : target) ? <DecisionDashboard value={(phase === 'before' ? current : target)!} compare={phase === 'after' ? current || undefined : undefined} onEvidence={evidence} presentation={{ title: `${MODE_LABELS[mode]} · ${phase === 'before' ? '现况评价' : '改后目标'}`, scale: demoActive ? '模拟条件覆盖 · 1–5级' : '证据适配 · 1/3/5级', method: demoActive ? demo!.assumptions : '沿用已保存方案低／中／高等级，依次显示为 1／3／5。缺失评价保留为空；目标等级不表示实际改造成效。' }}/>: <p className="ssw-empty">待本方向六维评价完成后展示，缺失项不补造分值。</p>}{demo && <p className="ssw-note">合成情景使用同一社区基线，改后目标按当前选择方向计算。</p>}</section>
    </div>}
    {pane === 'funding' && <div className="ssw-funding-grid"><section className="ssw-panel"><header><div><span>费用与资金</span><h3>测算本方案投入</h3></div><button type="button" className="ssw-link" onClick={() => onNavigate({ view: 'knowledge', section: 'costs' })}>查看同口径造价参考 ↗</button></header><p className="ssw-lead">{demoActive ? '合成情景以本方向已含费用的预算包起算，追加费用和预备费初始为 0。可调整参数比较资金缺口。' : '填写本方案预算与计划资金，测算投入和缺口。历史案例仅作参考，采用金额由项目材料或明确的情景假设确定。'}</p><div className="ssw-funding-inputs">{Object.entries(fundingLabels).map(([key, label]) => <label key={key}>{label}<input aria-label={label} type="number" min="0" max={key === 'reserve_percent' ? 100 : undefined} step={key === 'households' ? 1 : 'any'} value={funding.inputs[key as keyof typeof funding.inputs]} placeholder="待补充" onChange={event => updateFunding(key as keyof typeof funding.inputs, event.target.value)}/></label>)}</div><div className="ssw-form-actions"><button type="button" className="ssw-primary" onClick={calculateFunding}>计算预算与资金缺口</button><span>本地情景调整，不写入项目事实</span></div>{fundingError && <p className="ssw-error" role="alert">{fundingError}</p>}{demo && <details className="ssw-assumptions"><summary>查看合成预算依据</summary><p>{demo.assumptions}</p></details>}</section><section className="ssw-panel"><header><div><span>测算结果</span><h3>资金安排能覆盖多少投入</h3></div></header><dl className="ssw-kpis"><div><dt>含预备费总额</dt><dd>{show(calculated?.total)}<small>万元</small></dd></div><div><dt>计划资金缺口</dt><dd>{show(calculated?.funding_gap)}<small>万元</small></dd></div><div><dt>工程费用小计</dt><dd>{show(calculated?.subtotal)}<small>万元</small></dd></div><div><dt>户均工程投入</dt><dd>{show(calculated?.per_household)}<small>万元／户</small></dd></div></dl>{demoActive ? <p className="ssw-note">共同合成筹资安排：财政 1,280、居民 160、合作方 160 万元，共 1,600 万元。计划资金可调整；本方向预算独立核算。</p> : <p className="ssw-note">各方出资比例、到位时间和付款节点尚未结构化登记。计划资金不等于已落实资金；缺口与户均工程投入不代表居民实际分摊。</p>}<p className="ssw-note">建设投资与月度运营分别核算，本页不据此推算收益率或回本期。</p><button type="button" className="ssw-link" onClick={() => navigate('operations')}>继续查看运营安排 →</button></section></div>}
    {pane === 'operations' && <section className="ssw-operations"><div className="ssw-pane-heading"><h3>{MODE_LABELS[mode]} · 社区运营推演</h3><p>{demoActive ? '合成情景沿用共同社区服务输入，按所选方向独立保存本机方案。' : '按本方向登记设施、服务、收费、支出和资金支持，保留参数来源及核算月份。'}</p></div>{demoActive ? <CompleteCommunityDemo project={project} operationsOnly direction={mode}/> : <CommunityOperationsPanel project={project} direction={mode} standalone/>}</section>}
    {pane === 'sensitivity' && <section className="ssw-panel ssw-sensitivity"><header><div><span>目标偏好变化</span><h3>哪些目标影响本方案适配</h3></div></header>{strategy ? <><p className="ssw-lead">调整目标权重，观察当前方案的适配区间与各维贡献；实施准入继续由独立规则核验。</p><div className="ssw-presets" aria-label="目标权重预设">{PRIORITY_PRESETS.map(preset => <button type="button" key={preset.id} aria-pressed={PRIORITY_DIMENSIONS.every(({ key }) => preset.weights[key] === weights[key])} onClick={() => setWeights({ ...preset.weights })}>{preset.label}</button>)}</div><div className="ssw-sensitivity-grid"><div className="ssw-weight-controls">{PRIORITY_DIMENSIONS.map(({ key, label }) => <label key={key}><span>{label}<output>{weights[key]}</output></span><input aria-label={`${label}权重`} type="range" min="0" max="5" step="1" value={weights[key]} onChange={event => setWeights(old => ({ ...old, [key]: Number(event.target.value) }))}/></label>)}</div><div className="ssw-priority-result" aria-live="polite"><span>{MODE_LABELS[mode]} · 当前目标适配</span><strong>{priority.assessment ? priority.assessment.score === null ? `${show(priority.assessment.lower, 1)}–${show(priority.assessment.upper, 1)}` : show(priority.assessment.score, 1) : '待计算'}</strong><p>{priority.assessment ? priority.assessment.score === null ? '未知评价形成可能区间，未补为零或确定分。' : '当前有权重的维度均有评价与原文引用。' : '设置有效权重后查看本方案的适配结果。'}</p>{priority.assessment && <p>有依据的评价占当前权重 {show(priority.assessment.assessed_share * 100, 1)}%</p>}{priority.error && <p role="alert" className="ssw-error">{priority.error}</p>}</div></div>{priority.assessment && <div className="ssw-table-scroll"><table className="ssw-contribution-table"><caption>本方案的维度贡献</caption><thead><tr><th>维度</th><th>归一化权重</th><th>适配值</th><th>加权贡献</th><th>原文依据</th></tr></thead><tbody>{priority.assessment.contributions.map(row => <tr key={row.key}><th scope="row">{PRIORITY_DIMENSIONS.find(item => item.key === row.key)?.label}</th><td>{show(row.share * 100, 1)}%</td><td>{row.score === null ? '待评价' : show(row.score)}</td><td>{row.contribution === null ? '待评价' : show(row.contribution, 1)}</td><td>{row.evidence_refs.length ? <button type="button" className="ssw-link" onClick={() => evidence(row.evidence_refs)}>查看依据 ↗</button> : '未登记'}</td></tr>)}</tbody></table></div>}<details className="ssw-assumptions"><summary>计算口径</summary><p>复用目标权重敏感性模型：低／中／高适配映射为 20／60／100，按归一化权重加总；未知或没有可读原文引用的评价保留 20–100 的可能范围。权重和适配指数表示本次偏好分析，不是财务收益或实施许可。</p></details></> : <p className="ssw-empty">待本方向方案与六维评价完成后，再开展权重敏感性分析。</p>}</section>}
  </section>
}
