import { useEffect, useRef, useState } from 'react'
import type { OperationsAnalysisBound, OperationsCashItem, OperationsInput, OperationsMetrics, OperationsObservedMetrics, OperationsResult, OperationsService, OperationsSnapshot, OperationsTimeBlock, OperationsValue, OperationsWorkspace } from '../../../host/generated/contracts'
import { api, type Project } from '../api'
import './community-operations.css'
import { isOperationsOriginal } from '../../../../packages/operations/sources'
import { simulateScenarioUsers, type CompleteCommunityDemo } from '../../../../packages/retrofit/complete-demo'

type ServiceField = 'capacity_per_slot' | 'available_slots' | 'demand_visits' | 'paid_share' | 'fee_per_visit' | 'variable_cost_per_visit'
export type OperationsPreview = { label: string; input: OperationsInput; result: OperationsResult | null; error: string; savedId?: string }
type Preview = OperationsPreview
type Feedback = { snapshotId: string; sourceId: string; locator: string; collectedAt: string; split: 'calibration' | 'holdout'; note: string; metrics: Record<keyof OperationsObservedMetrics, string> }

const cashLabels: Record<OperationsCashItem['kind'], string> = {
  fixed_cost: '固定运营现金支出', other_earned_income: '其他经营收入', government_purchase: '政府购买服务',
  operating_subsidy: '运营补贴', other_support: '其他支持', government_direct_cost: '政府直接支付',
}
const serviceFields: { key: ServiceField; label: string; unit: string; max?: number }[] = [
  { key: 'capacity_per_slot', label: '每场服务容量（人次/场）', unit: 'visit/slot' },
  { key: 'available_slots', label: '每月可用场次（场/月）', unit: 'slot/month' },
  { key: 'demand_visits', label: '每月需求量（人次/月）', unit: 'visit/month' },
  { key: 'paid_share', label: '付费人次占比（0–1）', unit: 'ratio', max: 1 },
  { key: 'fee_per_visit', label: '每付费人次收费（元/人次）', unit: 'yuan/visit' },
  { key: 'variable_cost_per_visit', label: '每服务人次变动支出（元/人次）', unit: 'yuan/visit' },
]
const monthlyCapacityFields = ['capacity_per_slot', 'available_slots', 'demand_visits']
const blockFields: { key: 'slots' | 'capacity_per_slot' | 'demand_visits'; label: string; unit: string }[] = [
  { key: 'slots', label: '该时段每月场次（场/月）', unit: 'slot/month' },
  { key: 'capacity_per_slot', label: '每场容量（人次/场）', unit: 'visit/slot' },
  { key: 'demand_visits', label: '该时段月需求（人次/月）', unit: 'visit/month' },
]
const boundTargets: Record<OperationsAnalysisBound['target'], { label: string; unit: string; displayUnit: string; field?: ServiceField; max?: number }> = {
  service_demand_multiplier: { label: '服务需求倍率', unit: 'ratio', displayUnit: '倍' },
  service_fee: { label: '每付费人次收费', unit: 'yuan/visit', displayUnit: '元/人次', field: 'fee_per_visit' },
  service_paid_share: { label: '付费人次占比', unit: 'ratio', displayUnit: '比例 0–1', field: 'paid_share', max: 1 },
  service_variable_cost: { label: '每服务人次变动支出', unit: 'yuan/visit', displayUnit: '元/人次', field: 'variable_cost_per_visit' },
  cash_amount: { label: '现金项目金额', unit: 'yuan/month', displayUnit: '元/月' },
}
const boundOrigins: Record<OperationsAnalysisBound['origin'], string> = { manual_scenario: '人工情景设定', literature_range: '文献参考范围', observed_range: '已观测范围' }
const valueKinds: { status: OperationsValue['status']; kind: OperationsValue['source_kind']; label: string }[] = [
  { status: 'missing', kind: 'missing', label: '待取得数据' },
  { status: 'factual', kind: 'observation', label: '实测事实 · 台账/调查' },
  { status: 'factual', kind: 'public_record', label: '公开事实 · 原始记录' },
  { status: 'reference', kind: 'literature', label: '参考参数 · 文献' },
  { status: 'reference', kind: 'public_record', label: '参考参数 · 公开案例' },
  { status: 'assumption', kind: 'interview', label: '情景假设 · 访谈' },
  { status: 'assumption', kind: 'demo', label: '情景假设 · 演示/手动设定' },
]
const observedLabels: Record<keyof OperationsObservedMetrics, string> = {
  served_visits: '服务人次', unique_users: '目标居民去重服务人数', fee_income: '服务收费收入',
  operating_cost: '运营现金支出', government_purchase: '政府购买服务', operating_subsidy: '运营补贴',
}
const mainMetrics: { key: keyof OperationsMetrics; label: string; unit: string }[] = [
  { key: 'served_visits', label: '服务人次', unit: '人次/月' },
  { key: 'utilization', label: '容量利用率', unit: '%' },
  { key: 'coverage', label: '目标人群覆盖率', unit: '%' },
  { key: 'earned_income', label: '经营收入（含政府合同）', unit: '元/月' },
  { key: 'operating_cost', label: '运营现金支出', unit: '元/月' },
  { key: 'government_purchase', label: '政府购买服务', unit: '元/月' },
  { key: 'operating_subsidy', label: '运营补贴', unit: '元/月' },
  { key: 'unfunded_gap', label: '支持后运营缺口', unit: '元/月' },
  { key: 'government_cost_per_visit', label: '财政每人次支出', unit: '元/人次' },
]
const extraMetrics: typeof mainMetrics = [
  { key: 'capacity_visits', label: '可提供服务容量', unit: '人次/月' },
  { key: 'unmet_visits', label: '未满足需求', unit: '人次/月' },
  { key: 'unique_users', label: '目标居民去重服务人数', unit: '人/月' },
  { key: 'fee_income', label: '服务收费收入', unit: '元/月' },
  { key: 'other_support', label: '其他支持', unit: '元/月' },
  { key: 'government_direct_cost', label: '政府直接支付', unit: '元/月' },
  { key: 'total_service_cost', label: '合计服务现金支出', unit: '元/月' },
  { key: 'government_outlay', label: '财政支出合计', unit: '元/月' },
  { key: 'balance_before_support', label: '补贴及其他支持前现金结余', unit: '元/月' },
  { key: 'balance_after_support', label: '支持后现金结余', unit: '元/月' },
  { key: 'required_subsidy', label: '所需运营补贴', unit: '元/月' },
  { key: 'commercial_cost_coverage', label: '市场收入现金支出覆盖率', unit: '%' },
]

function today() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  return ['year', 'month', 'day'].map(key => parts.find(part => part.type === key)?.value).join('-')
}
function nextMonth() {
  const [year, month] = today().split('-').map(Number)
  return `${month === 12 ? year + 1 : year}-${String(month === 12 ? 1 : month + 1).padStart(2, '0')}`
}
function afterMonth(period: string) {
  const [year, month] = period.split('-').map(Number)
  return `${month === 12 ? year + 1 : year}-${String(month === 12 ? 1 : month + 1).padStart(2, '0')}-01`
}
const missingValue = (unit: string): OperationsValue => ({ value: null, unit, status: 'missing', source_kind: 'missing', source: '待取得数据', as_of: today() })
const demoValue = (value: number, unit: string): OperationsValue => ({ value, unit, status: 'assumption', source_kind: 'demo', source: '纯演示参数：手动设定，用于检验系统流程与程序核算', as_of: today() })
const newService = (id: string): OperationsService => ({
  id, name: '社区服务', resource_id: `resource-${id}`, schedule_note: '',
  capacity_per_slot: missingValue('visit/slot'), available_slots: missingValue('slot/month'), demand_visits: missingValue('visit/month'),
  paid_share: missingValue('ratio'), fee_per_visit: missingValue('yuan/visit'), variable_cost_per_visit: missingValue('yuan/visit'),
})
const newBlock = (): OperationsTimeBlock => ({ id: `block-${crypto.randomUUID().slice(0, 8)}`, name: '新增时段', slots: missingValue('slot/month'), capacity_per_slot: missingValue('visit/slot'), demand_visits: missingValue('visit/month') })
function boundBase(input: OperationsInput, target: OperationsAnalysisBound['target'], itemId: string): number | null {
  if (target === 'cash_amount') return input.cash_items.find(item => item.economic_item_id === itemId)?.amount.value ?? null
  const service = input.services.find(item => item.id === itemId)
  if (!service) return null
  if (target === 'service_demand_multiplier') return 1
  const field = boundTargets[target].field!
  return service[field].value
}
function boundItems(input: OperationsInput, target: OperationsAnalysisBound['target']) {
  return target === 'cash_amount' ? input.cash_items.map(item => ({ id: item.economic_item_id, label: `${cashLabels[item.kind]} · ${item.description}` })) : input.services.map(service => ({ id: service.id, label: service.name }))
}
function makeBound(input: OperationsInput, target: OperationsAnalysisBound['target'], itemId: string): OperationsAnalysisBound {
  const base = boundBase(input, target, itemId)
  return { id: `bound-${crypto.randomUUID().slice(0, 8)}`, target, item_id: itemId, low: base ?? Number.NaN, high: base ?? Number.NaN, unit: boundTargets[target].unit, origin: 'manual_scenario', basis: '', source_ref: '待补范围依据', as_of: today() }
}
function blankInput(): OperationsInput {
  return {
    name: '社区运营方案', facility_id: '', facility_name: '', period: nextMonth(), scope_note: '',
    target_population: missingValue('person'), unique_users: missingValue('person'), cost_scope_complete: false,
    services: [newService('service-1')],
    cash_items: (Object.keys(cashLabels) as OperationsCashItem['kind'][]).map(kind => ({ economic_item_id: `cash-${kind}`, description: cashLabels[kind], kind, amount: missingValue('yuan/month') })),
  }
}
function demoInput(): OperationsInput {
  const input = blankInput()
  input.name = '社区服务中心演示方案'; input.facility_id = 'DEMO-CENTER-01'; input.facility_name = '演示社区服务中心'
  input.scope_note = '纯演示：一个中心一个月，服务需求可在所列场次内匹配。现金核算不含建设投资、折旧和贷款本息。'
  input.target_population = demoValue(1000, 'person'); input.unique_users = demoValue(120, 'person'); input.cost_scope_complete = true
  const service = input.services[0]
  service.name = '社区活动服务'; service.schedule_note = '演示独立活动室：每场1小时、20席位，每月26场；假设需求可匹配这些场次。'
  const values = [20, 26, 400, 0.4, 10, 2]
  serviceFields.forEach((field, index) => { service[field.key] = demoValue(values[index], field.unit) })
  const cashValues: Record<OperationsCashItem['kind'], number> = { fixed_cost: 10000, other_earned_income: 1000, government_purchase: 2000, operating_subsidy: 6000, other_support: 0, government_direct_cost: 0 }
  input.cash_items.forEach(item => { item.amount = demoValue(cashValues[item.kind], 'yuan/month') })
  return input
}
const emptyWorkspace = (): OperationsWorkspace => ({ scenarios: [], observations: [], comparisons: [] })
const emptyFeedback = (): Feedback => ({ snapshotId: '', sourceId: '', locator: '', collectedAt: today(), split: 'calibration', note: '', metrics: { served_visits: '', unique_users: '', fee_income: '', operating_cost: '', government_purchase: '', operating_subsidy: '' } })
const errorMessage = (error: unknown) => error instanceof Error ? error.message : '请求未完成，请重试。'
const show = (value: number | null | undefined, unit = '') => value == null ? '待补充' : `${(unit === '%' ? value * 100 : value).toLocaleString('zh-CN', { maximumFractionDigits: 2 })}${unit === '%' ? '%' : ''}`
const basisName = (value: OperationsValue) => valueKinds.find(option => option.status === value.status && option.kind === value.source_kind)?.label || value.status

function ValueField({ label, value, onChange, max, disabled = false }: { label: string; value: OperationsValue; onChange: (value: OperationsValue) => void; max?: number; disabled?: boolean }) {
  return <div className="ops-value-field">
    <label className="ops-field">{label}<input type="number" min="0" max={max ?? 1e12} step={['person', 'visit/slot', 'visit/month', 'slot/month'].includes(value.unit) ? '1' : 'any'} aria-label={label} disabled={disabled} value={value.value ?? ''} placeholder="待补充" onChange={event => {
      const number = event.currentTarget.value === '' ? null : event.currentTarget.valueAsNumber
      if (number !== null && !Number.isFinite(number)) return
      onChange(number === null ? { ...value, value: null, status: 'missing', source_kind: 'missing' } : value.status === 'missing' ? { ...value, value: number, status: 'assumption', source_kind: 'demo', source: '用户填写的情景假设，待补充取值依据' } : { ...value, value: number })
    }} /></label>
    <details className="ops-source-editor"><summary>依据：{basisName(value)}</summary>
      <div className="ops-source-grid">
        <label className="ops-field">数据性质与来源<select aria-label={`${label}：数据性质与来源`} disabled={disabled} value={`${value.status}:${value.source_kind}`} onChange={event => {
          const option = valueKinds.find(item => `${item.status}:${item.kind}` === event.target.value)!
          onChange({ ...value, status: option.status, source_kind: option.kind, ...(option.status === 'missing' ? { value: null } : {}) })
        }}>{valueKinds.map(option => <option key={`${option.status}:${option.kind}`} value={`${option.status}:${option.kind}`} disabled={value.value === null && option.status !== 'missing'}>{option.label}</option>)}</select></label>
        <label className="ops-field">取得依据日期<input type="date" aria-label={`${label}：取得依据日期`} disabled={disabled} max={today()} value={value.as_of} onChange={event => onChange({ ...value, as_of: event.target.value })} /></label>
        <label className="ops-field ops-wide">来源说明与定位<textarea aria-label={`${label}：来源说明与定位`} disabled={disabled} rows={2} maxLength={1500} value={value.source} onChange={event => onChange({ ...value, source: event.target.value })} placeholder="材料名称、页码/行号、访谈对象或假设理由" /></label>
      </div>
    </details>
  </div>
}

function Metrics({ result, extra = false }: { result: OperationsResult; extra?: boolean }) {
  return <dl className="ops-metrics">{(extra ? extraMetrics : mainMetrics).map(metric => <div className="ops-metric" key={metric.key}><dt>{metric.label}{metric.unit !== '%' ? <small>{metric.unit}</small> : null}</dt><dd>{show(result.metrics[metric.key], metric.unit)}</dd></div>)}</dl>
}

function ScientificResults({ result, complete = false }: { result: OperationsResult; complete?: boolean }) {
  const science = result.science
  if (!science) return null
  const thresholdStatus = { feasible: '在所列条件下可达', infeasible: '当前条件下不可达', not_identifiable: '当前未识别', already_balanced: '已平衡' }
  const unitLabels: Record<string, string> = { ratio: '比例', multiplier: '倍', 'yuan/visit': '元/人次', 'yuan/month': '元/月', 'visit/month': '人次/月', person: '人' }
  const combination = (values: { id: string; value: number }[]) => values.map(item => `${science.sensitivity.find(entry => entry.id === item.id)?.label || item.id}：${show(item.value)}`).join('；') || '未识别有效组合'
  return <details className="ops-science"><summary>盈亏切换与参数敏感性</summary>
    <h5>盈亏切换值</h5>
    <div className="ops-threshold-list">{science.break_even.filter(threshold => !complete || threshold.value !== null).map(threshold => <article className="ops-threshold" key={threshold.key}>
      <div className="ops-section-heading"><strong>{threshold.label}</strong><span className="ops-badge">{thresholdStatus[threshold.status]}</span></div>
      <p className="ops-threshold-value">{threshold.value === null ? '未识别' : `${show(threshold.value)} ${unitLabels[threshold.unit] || threshold.unit}`}</p><p className="ops-muted">{threshold.basis}</p>
    </article>)}</div>
    {science.sensitivity.length > 0 && <><h5>逐项参数变化</h5><p className="ops-muted">每次只改变一项参数，比较支持后现金结余；其余参数保持当前情景取值。</p>{science.sensitivity.map(item => <article className="ops-sensitivity-card" key={item.id}><strong>{item.label}</strong>
      <div className="ops-table-wrap"><table className="ops-table"><thead><tr><th>设置</th><th>参数取值</th><th>现金结余（元/月）</th></tr></thead><tbody><tr><td>区间下端</td><td>{show(item.low)}</td><td>{show(item.low_balance)}</td></tr><tr><td>基准</td><td>{show(item.base)}</td><td>{show(item.base_balance)}</td></tr><tr><td>区间上端</td><td>{show(item.high)}</td><td>{show(item.high_balance)}</td></tr></tbody></table></div>
      <p>结余变化幅度：{show(item.span)} 元/月</p><p className="ops-muted">范围依据：{item.basis}</p><p className="ops-muted">来源：{item.source_ref}</p>
    </article>)}</>}
    {science.joint_range && <details className="ops-details"><summary>已测试参数组合范围</summary><p className="ops-muted">同时取各参数区间端点，检查这些组合的现金结余。结果范围对应已测试组合。</p><dl className="ops-range-summary">
      <div><dt>已测试组合</dt><dd>{science.joint_range.tested_corners}</dd></div><div><dt>有效组合</dt><dd>{science.joint_range.valid_corners}</dd></div>
      <div><dt>最低现金结余（元/月）</dt><dd>{show(science.joint_range.min_balance)}</dd></div><div><dt>最高现金结余（元/月）</dt><dd>{show(science.joint_range.max_balance)}</dd></div><div><dt>最大运营缺口（元/月）</dt><dd>{show(science.joint_range.worst_gap)}</dd></div>
    </dl><p>最低结余组合：{combination(science.joint_range.min_at)}</p><p>最高结余组合：{combination(science.joint_range.max_at)}</p></details>}
    {science.notes.map((note, index) => <p className="ops-muted" key={index}>{note}</p>)}
  </details>
}

function ResultDetails({ result }: { result: OperationsResult }) {
  return <details className="ops-details"><summary>{result.missing.length ? `计算口径与待补项（${result.missing.length}项）` : '计算口径与逐项依据'}</summary>
    <p>服务人次取同一核算范围内需求与容量的较小值；启用分时段后，先逐时段计算再加总。收费收入＝服务人次×付费占比×单次收费；变动支出按全部服务人次计算。</p>
    <p>经营收入＝服务收费＋其他经营收入＋政府购买服务；运营补贴和其他支持另列。市场收入覆盖率只用服务收费与其他经营收入除以运营现金支出。政府直接支付只计财政投入与合计服务支出。建设投资、折旧、贷款本息在建设经济模型中评估。</p>
    <p>每项服务须使用独立资源或事先拆分的独立排班，同一资源不能在不同服务中重复登记。分时段核算按已录入的时段计算需求与容量错配；月总量核算采用需求可匹配场次的假设。覆盖率采用目标居民去重人数。</p>
    <Metrics result={result} extra />
    {result.services.length > 0 && <div className="ops-table-wrap"><table className="ops-table"><caption>各服务月度结果；月合计上限假设容量可在全部时段间调配。</caption><thead><tr><th>服务与方法</th><th>容量</th><th>服务人次</th><th>月合计上限</th><th>时段错配少服务人次</th><th>利用率</th><th>收费收入</th><th>变动支出</th></tr></thead><tbody>{result.services.map(service => <tr key={service.id}><td>{service.name}<small>{service.capacity_method === 'time_blocks' ? '分时段核算' : '月总量核算'}</small></td><td>{show(service.capacity_visits)}</td><td>{show(service.served_visits)}</td><td>{show(service.monthly_pooled_upper_bound)}</td><td>{show(service.aggregation_overstatement_visits)}</td><td>{show(service.utilization, '%')}</td><td>{show(service.fee_income)}</td><td>{show(service.variable_cost)}</td></tr>)}</tbody></table></div>}
    {result.missing.length > 0 && <ul className="ops-missing-list">{result.missing.map((item, index) => <li key={`${item.field}:${index}`}><strong>{item.reason}</strong><p>采集方式：{item.collect_from}</p><small>{item.field}</small></li>)}</ul>}
    {result.warnings.map((warning, index) => <p className="ops-notice" key={index}>{warning}</p>)}
    <small className="ops-muted">程序核算版本：{result.model_version} · {result.status === 'complete' ? '当前参数齐全' : '部分指标待补充'}</small>
  </details>
}

function InputEvidence({ input }: { input: OperationsInput }) {
  const values = [
    { label: '目标人群', value: input.target_population }, { label: '目标居民去重服务人数', value: input.unique_users },
    ...input.services.flatMap(service => serviceFields.map(field => ({ label: `${service.name} · ${field.label}${service.time_blocks?.length && monthlyCapacityFields.includes(field.key) ? '（月总量备份）' : ''}`, value: service[field.key] }))),
    ...input.cash_items.map(item => ({ label: `${cashLabels[item.kind]} · ${item.description}`, value: item.amount })),
  ]
  return <details className="ops-details"><summary>冻结的参数与逐项依据</summary><p>{input.scope_note}</p>{input.services.map(service => <div key={service.id}><p>{service.name} · 资源 {service.resource_id}：{service.schedule_note}</p>
    {service.time_blocks?.length ? <details className="ops-details"><summary>{service.name} · 分时段原值与来源</summary><div className="ops-table-wrap"><table className="ops-table"><thead><tr><th>时段与参数</th><th>取值</th><th>数据性质</th><th>依据及取得日期</th></tr></thead><tbody>{service.time_blocks.flatMap(block => blockFields.map(field => <tr key={`${block.id}:${field.key}`}><td>{block.name} · {field.label}</td><td>{show(block[field.key].value)} {block[field.key].unit}</td><td>{basisName(block[field.key])}</td><td>{block[field.key].source}<small>{block[field.key].as_of}</small></td></tr>))}</tbody></table></div></details> : null}
  </div>)}<div className="ops-table-wrap"><table className="ops-table"><thead><tr><th>参数</th><th>取值</th><th>数据性质</th><th>依据及取得日期</th></tr></thead><tbody>{values.map((item, index) => <tr key={index}><td>{item.label}</td><td>{show(item.value.value)} {item.value.unit}</td><td>{basisName(item.value)}</td><td>{item.value.source}<small>{item.value.as_of}</small></td></tr>)}</tbody></table></div>
    {!!input.analysis_bounds?.length && <details className="ops-details"><summary>冻结的参数区间与范围依据</summary>{input.analysis_bounds.map(bound => <article className="ops-bound" key={bound.id}><strong>{boundTargets[bound.target].label} · {boundItems(input, bound.target).find(item => item.id === bound.item_id)?.label || bound.item_id}</strong><p>{show(bound.low)}—{show(bound.high)} {boundTargets[bound.target].displayUnit} · {boundOrigins[bound.origin]}</p><p>{bound.basis}</p><small>{bound.source_ref} · {bound.as_of}</small></article>)}</details>}
  </details>
}

function AnalysisBoundsEditor({ input, onChange }: { input: OperationsInput; onChange: (update: (value: OperationsInput) => OperationsInput) => void }) {
  const bounds = input.analysis_bounds || []
  const replace = (next: OperationsAnalysisBound[]) => onChange(value => {
    const result = { ...value }
    if (next.length) result.analysis_bounds = next
    else delete result.analysis_bounds
    return result
  })
  function addBound() {
    const candidate = (Object.keys(boundTargets) as OperationsAnalysisBound['target'][]).flatMap(target => boundItems(input, target).map(item => ({ target, id: item.id }))).find(item => !bounds.some(bound => bound.target === item.target && bound.item_id === item.id))
    if (candidate) replace([...bounds, makeBound(input, candidate.target, candidate.id)])
  }
  function loadPressureBounds() {
    const values: OperationsAnalysisBound[] = []
    if (input.services[0]) values.push({ ...makeBound(input, 'service_demand_multiplier', input.services[0].id), low: 0.7, high: 1.3, basis: '人为将本情景需求上下调整30%进行演示压力测试；不是统计估计范围。', source_ref: '演示压力测试：人为设定的需求倍率' })
    const fixed = input.cash_items.find(item => item.kind === 'fixed_cost' && item.amount.value !== null)
    if (fixed?.amount.value !== null && fixed?.amount.value !== undefined) values.push({ ...makeBound(input, 'cash_amount', fixed.economic_item_id), low: Math.round(fixed.amount.value * 0.9 * 100) / 100, high: Math.round(fixed.amount.value * 1.1 * 100) / 100, basis: '人为将已填固定支出上下调整10%进行演示压力测试；不是统计估计范围。', source_ref: '演示压力测试：人为设定的固定支出变化' })
    replace(values)
  }
  return <details className="ops-bounds"><summary>可选：参数区间与压力测试（{bounds.length}/6）</summary>
    <p className="ops-muted">只为需要检查的参数填写上下端点及依据。保持不变的参数可填相同端点；也可不设区间。基准情景会分析这些区间，保守与积极情景只计算各自需求设定。</p>
    <div className="ops-toolbar"><button type="button" className="ops-button" disabled={bounds.length >= 6} onClick={addBound}>添加参数区间</button><button type="button" className="ops-button" disabled={!input.services.length} onClick={loadPressureBounds}>载入演示压力区间</button></div>
    <p className="ops-muted">演示按钮会替换当前区间列表：首项服务需求倍率 0.7–1.3，首笔已填固定支出上下变化 10%。均为人为压力设置。</p>
    {bounds.map((bound, index) => {
      const definition = boundTargets[bound.target], items = boundItems(input, bound.target), base = boundBase(input, bound.target, bound.item_id)
      const change = (update: Partial<OperationsAnalysisBound>) => replace(bounds.map((item, position) => position === index ? { ...item, ...update } : item))
      const changeTarget = (target: OperationsAnalysisBound['target'], itemId: string) => change({ ...makeBound(input, target, itemId), id: bound.id })
      return <fieldset className="ops-bound" key={bound.id}><legend>参数区间 {index + 1}</legend><div className="ops-form-grid">
        <label className="ops-field">变化参数<select aria-label={`区间${index + 1}：变化参数`} value={bound.target} onChange={event => { const target = event.target.value as OperationsAnalysisBound['target']; changeTarget(target, boundItems(input, target)[0]?.id || '') }}>{Object.entries(boundTargets).map(([key, option]) => <option key={key} value={key}>{option.label}</option>)}</select></label>
        <label className="ops-field">对应服务或现金项目<select aria-label={`区间${index + 1}：对应项目`} value={bound.item_id} onChange={event => changeTarget(bound.target, event.target.value)}>{!items.some(item => item.id === bound.item_id) && <option value={bound.item_id}>原项目已调整，请重新选择</option>}{items.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <label className="ops-field">区间下端（{definition.displayUnit}）<input type="number" min="0" max={definition.max ?? 1e12} step="any" aria-label={`区间${index + 1}：下端`} value={Number.isFinite(bound.low) ? bound.low : ''} onChange={event => change({ low: event.target.valueAsNumber })} /></label>
        <label className="ops-field">区间上端（{definition.displayUnit}）<input type="number" min="0" max={definition.max ?? 1e12} step="any" aria-label={`区间${index + 1}：上端`} value={Number.isFinite(bound.high) ? bound.high : ''} onChange={event => change({ high: event.target.valueAsNumber })} /></label>
        <p className="ops-muted ops-wide">当前基准：{show(base)} {definition.displayUnit}{bound.target === 'service_demand_multiplier' ? '。1 倍表示当前基准情景需求，各时段需求会按相同倍率调整。' : '。区间只影响这一项参数。'}</p>
        <label className="ops-field">范围性质<select aria-label={`区间${index + 1}：范围性质`} value={bound.origin} onChange={event => change({ origin: event.target.value as OperationsAnalysisBound['origin'] })}>{Object.entries(boundOrigins).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label className="ops-field">取得依据日期<input type="date" max={today()} aria-label={`区间${index + 1}：取得依据日期`} value={bound.as_of} onChange={event => change({ as_of: event.target.value })} /></label>
        <label className="ops-field ops-wide">范围来源与定位<input aria-label={`区间${index + 1}：范围来源与定位`} maxLength={1500} value={bound.source_ref} onChange={event => change({ source_ref: event.target.value })} placeholder="写明文献/台账定位，或人工设定记录" /></label>
        <label className="ops-field ops-wide">范围设定的具体理由<textarea aria-label={`区间${index + 1}：具体理由`} rows={2} maxLength={1500} value={bound.basis} onChange={event => change({ basis: event.target.value })} placeholder="说明为何取这两个端点，以及与当前设施、月份的对应关系" /></label>
      </div><div className="ops-toolbar"><button type="button" className="ops-button ops-danger" onClick={() => replace(bounds.filter((_, position) => position !== index))}>移除参数区间 {index + 1}</button></div></fieldset>
    })}
  </details>
}

export default function CommunityOperationsPanel({ project, completeDemo, onPreviews, analysisRevision = 0, onCalculationState }: { project: Project; completeDemo?: CompleteCommunityDemo; onPreviews?: (previews: OperationsPreview[]) => void; analysisRevision?: number; onCalculationState?: (state: 'idle' | 'calculating' | 'error') => void }) {
  const scope = `${project.id}:${project.context_version}`
  const active = useRef({ scope, generation: 0 })
  if (active.current.scope !== scope) active.current = { scope, generation: active.current.generation + 1 }
  const controllers = useRef(new Set<AbortController>())
  const readSequence = useRef(0)
  const pending = useRef(false)
  const [open, setOpen] = useState(!!completeDemo)
  const [parametersOpen, setParametersOpen] = useState(!completeDemo)
  const [reload, setReload] = useState(0)
  const [loaded, setLoaded] = useState({ scope: '', loading: false, error: '', data: emptyWorkspace() })
  const [draft, setDraft] = useState<OperationsInput>(() => completeDemo ? structuredClone(completeDemo.operations) : blankInput())
  const [multipliers, setMultipliers] = useState(completeDemo ? ['0.8', '1', '1.2'] : ['0.7', '1', '1.3'])
  const [previews, setPreviews] = useState<Preview[]>([])
  const [feedback, setFeedback] = useState<Feedback>(emptyFeedback)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  useEffect(() => { onCalculationState?.(busy === 'preview' ? 'calculating' : error || previews.some(p => p.error) ? 'error' : 'idle') }, [busy, error, previews, onCalculationState])
  useEffect(() => { onPreviews?.(previews) }, [previews, onPreviews])
  const base = `/projects/${encodeURIComponent(project.id)}/community-operations`
  const workspace = loaded.scope === scope ? loaded.data : emptyWorkspace()
  const eligibleSources = project.input.sources.filter(isOperationsOriginal)
  const selectedSnapshot = workspace.scenarios.find(snapshot => snapshot.id === feedback.snapshotId)

  useEffect(() => {
    setPreviews([]); setFeedback(emptyFeedback()); setError(''); setNotice(''); setBusy(''); pending.current = false
    return () => { controllers.current.forEach(controller => controller.abort()); controllers.current.clear(); active.current.generation += 1 }
  }, [scope])

  useEffect(() => {
    if (!open || completeDemo) return
    const controller = new AbortController(), generation = active.current.generation, sequence = ++readSequence.current
    setLoaded(previous => ({ scope, loading: true, error: '', data: previous.scope === scope ? previous.data : emptyWorkspace() }))
    void api<OperationsWorkspace>(base, undefined, controller.signal).then(data => {
      if (!controller.signal.aborted && active.current.generation === generation && readSequence.current === sequence) setLoaded({ scope, loading: false, error: '', data })
    }).catch(cause => {
      if (!controller.signal.aborted && active.current.generation === generation && readSequence.current === sequence) setLoaded(previous => ({ ...previous, loading: false, error: errorMessage(cause) }))
    })
    return () => controller.abort()
  }, [base, scope, open, reload])

  function updateDraft(update: (value: OperationsInput) => OperationsInput) {
    setDraft(update); setPreviews([]); setError(''); setNotice('')
  }
  async function run(name: string, action: (signal: AbortSignal, current: () => boolean) => Promise<void>) {
    if (pending.current) return
    const generation = active.current.generation, controller = new AbortController()
    const current = () => !controller.signal.aborted && active.current.scope === scope && active.current.generation === generation
    pending.current = true; controllers.current.add(controller); setBusy(name); setError(''); setNotice('')
    try { await action(controller.signal, current) }
    catch (cause) { if (current()) setError(errorMessage(cause)) }
    finally { controllers.current.delete(controller); if (current()) { pending.current = false; setBusy('') } }
  }
  function inputIssues(): string[] {
    const issues: string[] = []
    if (!draft.facility_id.trim() || !draft.facility_name.trim() || !draft.name.trim() || !draft.scope_note.trim()) issues.push('请填写设施标识、设施名称、情景名称和核算范围。')
    if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(draft.period)) issues.push('请选择核算月份。')
    if (draft.services.some(service => !service.id.trim() || !service.name.trim() || !service.resource_id.trim() || !service.schedule_note.trim())) issues.push('请为各服务填写服务标识、名称、资源标识和场次排班说明。')
    if (multipliers.some(value => !value.trim() || !Number.isFinite(Number(value)) || Number(value) < 0)) issues.push('三个需求倍率均须为非负数。')
    const blocks = draft.services.flatMap(service => service.time_blocks || [])
    if (blocks.some(block => !block.id.trim() || !block.name.trim())) issues.push('每个分时段须填写名称和标识。')
    if (new Set(blocks.map(block => block.id)).size !== blocks.length) issues.push('分时段标识须唯一，请为不同时段使用不同标识。')
    const values = [draft.target_population, draft.unique_users, ...draft.services.flatMap(service => serviceFields.map(field => service[field.key])), ...blocks.flatMap(block => blockFields.map(field => block[field.key])), ...draft.cash_items.map(item => item.amount)]
    if (values.some(value => !value.source.trim() || !value.as_of || value.as_of > today())) issues.push('每个参数须保留来源说明，取得依据日期应不晚于今天。')
    const bounds = draft.analysis_bounds || []
    if (bounds.some(bound => !Number.isFinite(bound.low) || !Number.isFinite(bound.high) || bound.low < 0 || bound.low > bound.high || bound.high > (boundTargets[bound.target].max ?? 1e12))) issues.push('各参数区间须填写有效上下端点，下端不大于上端；付费占比在 0–1 之间。')
    if (bounds.some(bound => !bound.basis.trim() || !bound.source_ref.trim() || bound.source_ref.trim() === '待补范围依据' || !bound.as_of || bound.as_of > today())) issues.push('请补齐各参数区间的具体理由、来源定位和取得依据日期。')
    if (bounds.some(bound => !boundItems(draft, bound.target).some(item => item.id === bound.item_id))) issues.push('部分区间对应的服务或现金项目已调整，请重新选择。')
    if (new Set(bounds.map(bound => `${bound.target}:${bound.item_id}`)).size !== bounds.length) issues.push('同一参数只登记一个分析区间。')
    return issues
  }
  async function previewAll() {
    const issues = inputIssues()
    if (issues.length) { setError(issues.join(' ')); return }
    await run('preview', async (signal, current) => {
      setPreviews([])
      const requests = ['保守', '基准', '积极'].map((label, index): Preview => {
        const input = structuredClone(draft), multiplier = Number(multipliers[index])
        input.name = `${input.name.slice(0, 110)} · ${label}`
        if (index !== 1) delete input.analysis_bounds
        if (multiplier !== 1) input.services.forEach(service => {
          const scaled = (value: OperationsValue): OperationsValue => value.value === null ? value : {
            ...value, value: Math.round(value.value * multiplier),
            status: 'assumption', source_kind: 'demo', as_of: today(),
            source: `需求情景倍率 ${multiplier}，手动敏感性设定，四舍五入取整数人次；基准取值 ${value.value}；基准依据：${value.source}`.slice(0, 1500),
          }
          service.demand_visits = scaled(service.demand_visits)
          service.time_blocks?.forEach(block => { block.demand_visits = scaled(block.demand_visits) })
        })
        if (!completeDemo && (index !== 1 || multiplier !== 1)) input.unique_users = { ...missingValue('person'), source: '需求情景变化后，去重人数须另行调查或建模；未由人次倍率推算' }
        return { label, input, result: null, error: '' }
      })
      const results = await Promise.allSettled(requests.map(async item => {
        const result = await api<OperationsResult>(`${base}/preview`, { input: item.input }, signal)
        if (!completeDemo) return result
        if (result.metrics.served_visits === null) throw new Error('完整模拟服务量未计算完成')
        item.input = simulateScenarioUsers(item.input, result.metrics.served_visits, completeDemo.visitsPerResident)
        return api<OperationsResult>(`${base}/preview`, { input: item.input }, signal)
      }))
      if (!current()) return
      const next = requests.map((item, index) => {
        const result = results[index]
        return result.status === 'fulfilled' ? { ...item, result: result.value } : { ...item, error: errorMessage(result.reason) }
      })
      setPreviews(next)
    })
  }
  useEffect(() => { if (completeDemo) void previewAll() }, [completeDemo?.id, scope, analysisRevision])
  async function saveSnapshot(preview: Preview, index: number) {
    await run(`save:${index}`, async (signal, current) => {
      const snapshot = await api<OperationsSnapshot>(`${base}/scenarios`, { input: preview.input, expected_context_version: project.context_version }, signal)
      if (!current()) return
      setPreviews(previous => previous.map((item, position) => position === index ? { ...item, savedId: snapshot.id } : item))
      setNotice(`已冻结“${snapshot.input.name}”。之后的调整会另存新快照。`)
      const sequence = ++readSequence.current
      try {
        const data = await api<OperationsWorkspace>(base, undefined, signal)
        if (current() && readSequence.current === sequence) setLoaded({ scope, data, loading: false, error: '' })
      } catch (cause) {
        if (current() && readSequence.current === sequence) setLoaded(previous => ({ ...previous, loading: false, error: `保存已成功，列表读回失败：${errorMessage(cause)}` }))
      }
    })
  }
  const feedbackIssues: string[] = []
  if (project.input.synthetic) feedbackIssues.push('当前为模拟项目，真实运营反馈须在真实项目中登记。')
  if (!selectedSnapshot) feedbackIssues.push('先选择已冻结的情景。')
  if (selectedSnapshot && selectedSnapshot.input.period >= today().slice(0, 7)) feedbackIssues.push('完整月度实测须等待核算月份结束。')
  if (!feedback.sourceId || !eligibleSources.some(source => source.id === feedback.sourceId)) feedbackIssues.push('先取得并在项目资料中导入真实运营台账。')
  if (!feedback.locator.trim() || !feedback.note.trim()) feedbackIssues.push('填写原文定位与核对说明。')
  if (!feedback.collectedAt || feedback.collectedAt > today() || (selectedSnapshot && feedback.collectedAt < afterMonth(selectedSnapshot.input.period))) feedbackIssues.push('取得台账日期须在核算月结束后，且不晚于今天。')
  if (Object.values(feedback.metrics).every(value => value.trim() === '')) feedbackIssues.push('至少填写一个真实观测指标；未取得的指标留空。')
  if (Object.values(feedback.metrics).some(value => value.trim() !== '' && (!Number.isFinite(Number(value)) || Number(value) < 0))) feedbackIssues.push('实测值须为非负数。')
  if (['served_visits', 'unique_users'].some(key => feedback.metrics[key as keyof OperationsObservedMetrics].trim() !== '' && !Number.isInteger(Number(feedback.metrics[key as keyof OperationsObservedMetrics])))) feedbackIssues.push('实测人数与人次须为整数。')
  if (feedback.metrics.unique_users.trim() && feedback.metrics.served_visits.trim() && Number(feedback.metrics.unique_users) > Number(feedback.metrics.served_visits)) feedbackIssues.push('去重人数不能大于服务人次。')
  async function saveObservation() {
    if (!selectedSnapshot || feedbackIssues.length) return
    await run('observation', async (signal, current) => {
      const metrics = Object.fromEntries(Object.entries(feedback.metrics).map(([key, value]) => [key, value.trim() === '' ? null : Number(value)])) as unknown as OperationsObservedMetrics
      await api(`${base}/observations`, { snapshot_id: selectedSnapshot.id, observation: { facility_id: selectedSnapshot.input.facility_id, period: selectedSnapshot.input.period, source_id: feedback.sourceId, locator: feedback.locator.trim(), collected_at: feedback.collectedAt, split: feedback.split, note: feedback.note.trim(), metrics } }, signal)
      if (!current()) return
      setNotice('已保存真实观测与来源定位。请查看逐指标偏差；本次记录用于后续校准或独立检验。')
      setFeedback(emptyFeedback())
      const sequence = ++readSequence.current
      try {
        const data = await api<OperationsWorkspace>(base, undefined, signal)
        if (current() && readSequence.current === sequence) setLoaded({ scope, data, loading: false, error: '' })
      } catch (cause) {
        if (current() && readSequence.current === sequence) setLoaded(previous => ({ ...previous, loading: false, error: `观测已保存，列表读回失败：${errorMessage(cause)}` }))
      }
    })
  }

  return <details className="community-operations" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className="ops-summary"><span>社区运营与公共服务</span><small>比较月度使用、现金收支与财政投入</small></summary>
    {open && <div className="ops-body">
      <div className="ops-intro"><h3>{completeDemo ? "完整模拟月度报表 · 已自动填入并计算" : "把服务效果与运营账目放在一起看"}</h3><p>{completeDemo ? "三种情景使用同一核算接口；去重人数按明确的月均频次推算。参数、来源与区间已填入下方草稿。" : "填写设施、服务与现金项目，比较三种需求情景；冻结当前方案后，再用真实台账核对偏差。"}</p></div>
      {loaded.loading && <p className="ops-muted" role="status">正在读取本项目的运营记录…</p>}
      {loaded.error && <div className="ops-error" role="alert"><p>{loaded.error}</p><button type="button" className="ops-button" disabled={!!busy || loaded.loading} onClick={() => setReload(value => value + 1)}>重试读取记录</button></div>}
      {error && <p className="ops-error" role="alert">{error}</p>}
      {notice && <p className="ops-success" role="status">{notice}</p>}
      <details className="ops-demo-parameters" open={parametersOpen} onToggle={event => setParametersOpen(event.currentTarget.open)}><summary>{completeDemo ? "已填满的月度运营草稿 · 展开查看或调整" : "月度运营参数"}</summary><section className="ops-section" aria-label="运营参数草稿">
        <div className="ops-section-heading"><div><h3>1. 建立月度运营草稿</h3><p className="ops-muted">{completeDemo ? "设施、服务、现金与范围参数已完整构造；每个数字记录生成依据。" : "空白表示数据待取得；确认没有的项目请明确填 0。"}</p></div><div className="ops-toolbar"><button type="button" className="ops-button" disabled={!!busy} onClick={() => { updateDraft(() => completeDemo ? structuredClone(completeDemo.operations) : demoInput()); setMultipliers(completeDemo ? ['0.8', '1', '1.2'] : ['0.7', '1', '1.3']); setNotice('已载入纯演示参数。所有数值均为假设，按程序公式核算。') }}>{completeDemo ? "恢复完整模拟参数" : "载入演示参数"}</button>{!completeDemo && <button type="button" className="ops-button" disabled={!!busy} onClick={() => updateDraft(() => blankInput())}>清空为新草稿</button>}</div></div>
        <fieldset disabled={!!busy} className="ops-feedback-form"><legend className="sr-only">运营参数</legend>
          <div className="ops-form-grid">
            <label className="ops-field">设施标识<input aria-label="设施标识" maxLength={100} value={draft.facility_id} placeholder="用于匹配同一设施的后续台账" onChange={event => updateDraft(value => ({ ...value, facility_id: event.target.value }))} /></label>
            <label className="ops-field">设施名称<input aria-label="设施名称" maxLength={120} value={draft.facility_name} onChange={event => updateDraft(value => ({ ...value, facility_name: event.target.value }))} /></label>
            <label className="ops-field">情景名称<input aria-label="情景名称" maxLength={110} value={draft.name} onChange={event => updateDraft(value => ({ ...value, name: event.target.value }))} /></label>
            <label className="ops-field">核算月份<input aria-label="核算月份" type="month" value={draft.period} onChange={event => updateDraft(value => ({ ...value, period: event.target.value }))} /></label>
            <label className="ops-field ops-wide">核算范围与服务对象<textarea aria-label="核算范围与服务对象" rows={2} maxLength={1500} value={draft.scope_note} placeholder="写明设施范围、服务对象，以及费用纳入范围" onChange={event => updateDraft(value => ({ ...value, scope_note: event.target.value }))} /></label>
            <ValueField label="目标人群规模（人）" value={draft.target_population} onChange={next => updateDraft(value => ({ ...value, target_population: next }))} />
            <ValueField label="月度目标居民去重服务人数（人）" value={draft.unique_users} onChange={next => updateDraft(value => ({ ...value, unique_users: next }))} />
          </div>
          <div className="ops-section-heading"><h4>服务项目与容量</h4><button type="button" className="ops-button" disabled={draft.services.length >= 20} onClick={() => updateDraft(value => ({ ...value, services: [...value.services, newService(`service-${crypto.randomUUID().slice(0, 8)}`)] }))}>添加服务</button></div>
          {draft.services.map((service, index) => {
            const change = (update: Partial<OperationsService>) => updateDraft(value => ({ ...value, services: value.services.map((item, position) => position === index ? { ...item, ...update } : item) }))
            return <fieldset className="ops-service" key={index}><legend>服务 {index + 1}</legend><div className="ops-form-grid">
              <label className="ops-field">服务标识<input aria-label={`服务${index + 1}：标识`} maxLength={80} value={service.id} onChange={event => change({ id: event.target.value })} /></label>
              <label className="ops-field">服务名称<input aria-label={`服务${index + 1}：名称`} maxLength={120} value={service.name} onChange={event => change({ name: event.target.value })} /></label>
              <label className="ops-field">独立资源/排班标识<input aria-label={`服务${index + 1}：独立资源标识`} maxLength={100} value={service.resource_id} onChange={event => change({ resource_id: event.target.value })} /></label>
              <label className="ops-field">单场时长与排班依据<input aria-label={`服务${index + 1}：排班依据`} maxLength={1000} value={service.schedule_note} placeholder="如每场1小时，每月26场，使用独立活动室" onChange={event => change({ schedule_note: event.target.value })} /></label>
              {serviceFields.map(field => <ValueField key={field.key} label={`${service.name || `服务${index + 1}`}：${field.label}`} value={service[field.key]} max={field.max} disabled={!!service.time_blocks?.length && monthlyCapacityFields.includes(field.key)} onChange={next => change({ [field.key]: next })} />)}
            </div>
              <label className="ops-checkbox"><input type="checkbox" aria-label={`服务${index + 1}：启用分时段核算`} checked={!!service.time_blocks?.length} onChange={event => {
                const next = { ...service }
                if (event.target.checked) next.time_blocks = [{ id: `block-${crypto.randomUUID().slice(0, 8)}`, name: '月度总量（待拆分）', slots: structuredClone(service.available_slots), capacity_per_slot: structuredClone(service.capacity_per_slot), demand_visits: structuredClone(service.demand_visits) }]
                else delete next.time_blocks
                updateDraft(value => ({ ...value, services: value.services.map((item, position) => position === index ? next : item) }))
              }} /><span>启用分时段核算</span></label>
              {!!service.time_blocks?.length && <div className="ops-time-blocks"><p className="ops-notice">当前改按下方时段明细计算，原三项月总量保留并停用。首次开启只是把原值放入一个时段；请按午餐/晚餐、工作日/周末等实际安排拆分，避免把同一场次重复计入。</p>
                {service.time_blocks.map((block, blockIndex) => {
                  const changeBlock = (update: Partial<OperationsTimeBlock>) => change({ time_blocks: service.time_blocks!.map((item, position) => position === blockIndex ? { ...item, ...update } : item) })
                  return <fieldset className="ops-time-block" key={blockIndex}><legend>{service.name} · 时段 {blockIndex + 1}</legend><div className="ops-form-grid">
                    <label className="ops-field">时段标识<input aria-label={`服务${index + 1}时段${blockIndex + 1}：标识`} maxLength={80} value={block.id} onChange={event => changeBlock({ id: event.target.value })} /></label>
                    <label className="ops-field">时段名称<input aria-label={`服务${index + 1}时段${blockIndex + 1}：名称`} maxLength={160} value={block.name} placeholder="如工作日午餐" onChange={event => changeBlock({ name: event.target.value })} /></label>
                    {blockFields.map(field => <ValueField key={field.key} label={`${service.name}时段${blockIndex + 1}：${field.label}`} value={block[field.key]} onChange={next => changeBlock({ [field.key]: next })} />)}
                  </div><div className="ops-toolbar"><button type="button" className="ops-button ops-danger" disabled={service.time_blocks!.length <= 1} onClick={() => change({ time_blocks: service.time_blocks!.filter((_, position) => position !== blockIndex) })}>移除时段 {blockIndex + 1}</button></div></fieldset>
                })}
                <div className="ops-toolbar"><button type="button" className="ops-button" disabled={service.time_blocks.length >= 100} onClick={() => change({ time_blocks: [...service.time_blocks!, newBlock()] })}>添加分时段</button></div>
                <p className="ops-muted">收费与每人次变动支出沿用该服务设置。关闭分时段后，将恢复上方保留的月总量；分时记录不再参与本草稿。</p>
              </div>}
            <div className="ops-toolbar"><button type="button" className="ops-button ops-danger" disabled={draft.services.length <= 1} onClick={() => updateDraft(value => ({ ...value, services: value.services.filter((_, position) => position !== index) }))}>移除服务 {index + 1}</button></div></fieldset>
          })}
          <div className="ops-section-heading"><h4>月度现金项目</h4><button type="button" className="ops-button" disabled={draft.cash_items.length >= 100} onClick={() => updateDraft(value => ({ ...value, cash_items: [...value.cash_items, { economic_item_id: `cash-${crypto.randomUUID().slice(0, 8)}`, description: '新增现金项目', kind: 'fixed_cost', amount: missingValue('yuan/month') }] }))}>添加现金项目</button></div>
          <p className="ops-muted">同一笔经济事项使用同一标识，并只登记一次。政府直接支付填写未进入运营方支出的费用，避免重复核算。</p>
          {draft.cash_items.map((item, index) => {
            const change = (update: Partial<OperationsCashItem>) => updateDraft(value => ({ ...value, cash_items: value.cash_items.map((entry, position) => position === index ? { ...entry, ...update } : entry) }))
            return <fieldset className="ops-cash-item" key={index}><legend>现金项目 {index + 1} · {cashLabels[item.kind]}</legend><div className="ops-form-grid">
              <label className="ops-field">经济事项标识<input aria-label={`现金项目${index + 1}：经济事项标识`} maxLength={100} value={item.economic_item_id} onChange={event => change({ economic_item_id: event.target.value })} /></label>
              <label className="ops-field">收支类别<select aria-label={`现金项目${index + 1}：类别`} value={item.kind} onChange={event => change({ kind: event.target.value as OperationsCashItem['kind'] })}>{Object.entries(cashLabels).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}</select></label>
              <label className="ops-field">项目说明<input aria-label={`现金项目${index + 1}：说明`} maxLength={300} value={item.description} onChange={event => change({ description: event.target.value })} /></label>
              <ValueField label={`${item.description || cashLabels[item.kind]}（元/月）`} value={item.amount} onChange={next => change({ amount: next })} />
            </div><div className="ops-toolbar"><button type="button" className="ops-button ops-danger" onClick={() => updateDraft(value => ({ ...value, cash_items: value.cash_items.filter((_, position) => position !== index) }))}>移除现金项目 {index + 1}</button></div></fieldset>
          })}
          <label className="ops-checkbox"><input type="checkbox" checked={draft.cost_scope_complete} onChange={event => updateDraft(value => ({ ...value, cost_scope_complete: event.target.checked }))} /><span>已核对本月运营现金支出范围完整，包括人员、水电、日常维护等固定及变动支出。</span></label>
          <AnalysisBoundsEditor input={draft} onChange={updateDraft} />
        </fieldset>
      </section>
      </details><section className="ops-section" aria-label="运营情景比较"><h3>2. 比较需求变化后的运营结果</h3><p className="ops-muted">{completeDemo ? "完整模拟：需求倍率0.8 / 1 / 1.2；容量核算后的服务人次÷5.433333次/人/月推算去重人数，并按1500人封顶。" : "倍率是手动情景设定，默认 0.7 / 1 / 1.3 仅用于演示，需求量四舍五入为整数人次。除基准 1 倍情景外，去重人数保持待补充。"}</p>
        <div className="ops-presets">{['保守', '基准', '积极'].map((label, index) => <label className="ops-field" key={label}>{label}需求倍率<input aria-label={`${label}需求倍率`} type="number" min="0" step="0.1" disabled={!!busy} value={multipliers[index]} onChange={event => { setMultipliers(values => values.map((value, position) => position === index ? event.target.value : value)); setPreviews([]) }} /></label>)}</div>
        <div className="ops-toolbar"><button type="button" className="ops-button ops-primary" disabled={!!busy} onClick={() => void previewAll()}>{busy === 'preview' ? '正在计算三个情景…' : '计算三种情景'}</button></div>
        <div className="ops-preview-grid">{previews.map((preview, index) => <article className="ops-result-card" key={preview.label} aria-label={`${preview.label}情景结果`}><div className="ops-section-heading"><h4>{preview.label}</h4><span className="ops-badge">情景预测 · {preview.input.period}</span></div>
          {preview.result ? <><Metrics result={preview.result} /><ScientificResults result={preview.result} complete={!!completeDemo} /><ResultDetails result={preview.result} />{!completeDemo && <div className="ops-toolbar"><button type="button" className="ops-button ops-primary" disabled={!!busy || !!preview.savedId} onClick={() => void saveSnapshot(preview, index)}>{preview.savedId ? '已冻结保存' : busy === `save:${index}` ? '正在保存…' : `冻结保存${preview.label}情景`}</button></div>}</> : <><p className="ops-error" role="alert">{preview.error}</p><button type="button" className="ops-button" disabled={!!busy} onClick={() => completeDemo ? void previewAll() : void run(`retry:${index}`, async (signal, current) => { const result = await api<OperationsResult>(`${base}/preview`, { input: preview.input }, signal); if (current()) setPreviews(values => values.map((value, position) => position === index ? { ...value, result, error: '' } : value)) })}>重试{preview.label}情景</button></>}
        </article>)}</div>
      </section>
      {!completeDemo && <><section className="ops-section" aria-label="已冻结的运营情景"><div className="ops-section-heading"><h3>3. 已冻结的运营情景</h3><button type="button" className="ops-button" disabled={!!busy || loaded.loading} onClick={() => setReload(value => value + 1)}>刷新已保存记录</button></div>
        {!workspace.scenarios.length && !loaded.loading && <p className="ops-muted">尚未保存情景。计算后选择要保留的预测，作为日后台账比较的起点。</p>}
        <div className="ops-history-list">{workspace.scenarios.map(snapshot => <article className="ops-snapshot" key={snapshot.id} aria-label={`已冻结：${snapshot.input.name}`}><div className="ops-section-heading"><div><h4>{snapshot.input.name}</h4><p>{snapshot.input.facility_name} · {snapshot.input.period}</p><small className="ops-muted">保存于 {new Date(snapshot.created_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })} · 依据版本 {snapshot.context_version}</small></div><span className="ops-badge">已冻结</span></div>
          {snapshot.context_version !== project.context_version && <p className="ops-notice">项目依据已更新。此快照保留版本 {snapshot.context_version} 的预测，当前项目为版本 {project.context_version}。</p>}
          <p>服务 {show(snapshot.result.metrics.served_visits)} 人次/月 · 经营收入（含政府合同）{show(snapshot.result.metrics.earned_income)} 元/月 · 支持后运营缺口 {show(snapshot.result.metrics.unfunded_gap)} 元/月</p>
          <div className="ops-snapshot-actions"><button type="button" className="ops-button" disabled={!!busy} onClick={() => { updateDraft(() => structuredClone(snapshot.input)); setNotice(`已将“${snapshot.input.name}”载入草稿；计算后可另存新快照。`) }}>载入为新草稿</button><button type="button" className="ops-button" disabled={!!busy} onClick={() => setFeedback({ ...emptyFeedback(), snapshotId: snapshot.id })}>核对真实运营记录</button><a className="ops-button" href={`/api${base}/scenarios/${encodeURIComponent(snapshot.id)}/report`} download>导出情景报告</a></div>
          <InputEvidence input={snapshot.input} /><ScientificResults result={snapshot.result} /><ResultDetails result={snapshot.result} />
        </article>)}</div>
      </section>
      <section className="ops-section" aria-label="真实运营反馈"><h3>4. 用真实运营记录核对预测</h3><p className="ops-muted">按同一设施、同一月份和目标居民范围核对。校准样本用于调整，独立检验样本用于检查调整后的表现。</p>
        <fieldset className="ops-feedback-form" disabled={!!busy}><legend className="sr-only">真实观测录入</legend><div className="ops-form-grid">
          <label className="ops-field ops-wide">对应冻结情景<select aria-label="对应冻结情景" value={feedback.snapshotId} onChange={event => setFeedback({ ...emptyFeedback(), snapshotId: event.target.value })}><option value="">选择已保存的情景</option>{workspace.scenarios.map(snapshot => <option key={snapshot.id} value={snapshot.id}>{snapshot.input.name} · {snapshot.input.facility_name} · {snapshot.input.period}</option>)}</select></label>
          <label className="ops-field ops-wide">真实台账来源<select aria-label="真实台账来源" value={feedback.sourceId} onChange={event => setFeedback(value => ({ ...value, sourceId: event.target.value }))}><option value="">{eligibleSources.length ? '选择项目中已取得的真实原文' : '待取得并导入真实运营台账'}</option>{eligibleSources.map(source => <option key={source.id} value={source.id}>{source.title}</option>)}</select></label>
          <label className="ops-field">原文定位<input aria-label="真实台账原文定位" value={feedback.locator} maxLength={500} placeholder="如2026年9月台账，第2页第5–10行" onChange={event => setFeedback(value => ({ ...value, locator: event.target.value }))} /></label>
          <label className="ops-field">取得台账日期<input aria-label="取得台账日期" type="date" max={today()} min={selectedSnapshot ? afterMonth(selectedSnapshot.input.period) : undefined} value={feedback.collectedAt} onChange={event => setFeedback(value => ({ ...value, collectedAt: event.target.value }))} /></label>
          <label className="ops-field">样本用途<select aria-label="观测样本用途" value={feedback.split} onChange={event => setFeedback(value => ({ ...value, split: event.target.value as Feedback['split'] }))}><option value="calibration">校准样本</option><option value="holdout">独立检验样本</option></select></label>
          {Object.entries(observedLabels).map(([key, label]) => <label className="ops-field" key={key}>{label}实测（{key === 'served_visits' ? '人次' : key === 'unique_users' ? '人' : '元'}）<input aria-label={`${label}实测`} type="number" min="0" max={1e12} step="any" value={feedback.metrics[key as keyof OperationsObservedMetrics]} placeholder="按真实台账填写；待取得留空" onChange={event => setFeedback(value => ({ ...value, metrics: { ...value.metrics, [key]: event.target.value } }))} /></label>)}
          <label className="ops-field ops-wide">核对说明<textarea aria-label="真实台账核对说明" rows={2} maxLength={1500} value={feedback.note} placeholder="记录口径、设施与月份匹配情况，以及异常或调整原因" onChange={event => setFeedback(value => ({ ...value, note: event.target.value }))} /></label>
        </div></fieldset>
        {feedbackIssues.length > 0 && <p className="ops-muted">{feedbackIssues.join(' ')}</p>}
        <div className="ops-toolbar"><button type="button" className="ops-button ops-primary" disabled={!!busy || feedbackIssues.length > 0} onClick={() => void saveObservation()}>{busy === 'observation' ? '正在保存真实观测…' : '保存真实观测并核对偏差'}</button></div>
        {!workspace.comparisons.length && <p className="ops-muted">尚无真实运营对照。情景演示完成后，等待台账与调查结果接入。</p>}
        {workspace.comparisons.map(comparison => {
          const observation = workspace.observations.find(item => item.id === comparison.observation_id)
          const snapshot = workspace.scenarios.find(item => item.id === comparison.snapshot_id)
          return <article className="ops-snapshot" key={`${comparison.snapshot_id}:${comparison.observation_id}`} aria-label="预测与实测对照"><div className="ops-section-heading"><h4>{snapshot?.input.name || comparison.snapshot_id}</h4><span className="ops-badge">{comparison.split === 'holdout' ? '独立检验' : '校准样本'} · {comparison.timing === 'prospective' ? '事前预测对照' : '历史回看'}</span></div>
            {observation && <p>{observation.source_title} · {observation.input.locator} · 取得于 {observation.input.collected_at}</p>}
            <div className="ops-table-wrap"><table className="ops-table"><caption>差值＝实测−预测；实测为 0 时相对误差不计算。</caption><thead><tr><th>指标</th><th>预测</th><th>实测</th><th>差值</th><th>相对误差</th></tr></thead><tbody>{comparison.differences.map(difference => <tr key={difference.metric}><td>{observedLabels[difference.metric]}</td><td>{show(difference.predicted)}</td><td>{show(difference.observed)}</td><td>{show(difference.error)}</td><td>{difference.percentage_error === null ? '不计算' : show(difference.percentage_error, '%')}</td></tr>)}</tbody></table></div>
            {observation && <p className="ops-muted">核对记录：{observation.input.note}</p>}
          </article>
        })}
      </section></>}
    </div>}
  </details>
}
