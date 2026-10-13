import type { OperationsInput, OperationsResult } from '../../apps/host/generated/contracts'
import type { CompleteCommunityDemo } from './complete-demo'
import analysisColors from './analysis-palette.json'

export { analysisColors }

export type ExplorationParameters = { demand: number; activitySlots: number; subsidy: number }
export const defaultExploration: ExplorationParameters = { demand: 1, activitySlots: 30, subsidy: 12000 }

/** A reversible what-if draft over the registered sample; no real project writes. */
export function explorationInput(demo: CompleteCommunityDemo, parameters: ExplorationParameters): OperationsInput {
  if (!Number.isFinite(parameters.demand) || parameters.demand < .5 || parameters.demand > 1.5
    || !Number.isInteger(parameters.activitySlots) || parameters.activitySlots < 15 || parameters.activitySlots > 45
    || !Number.isFinite(parameters.subsidy) || parameters.subsidy < 0 || parameters.subsidy > 20000) throw new Error('EXPLORATION_PARAMETERS_OUT_OF_RANGE')
  const input = structuredClone(demo.operations)
  input.name = '互动推演 · 当前调整'
  input.scope_note += ' 互动假设：活动室15–45场内由现有社区岗排班，每场1小时，固定工资预算不变；助餐和咨询排班不变。'
  for (const service of input.services) {
    service.demand_visits.value = Math.round(service.demand_visits.value! * parameters.demand)
    service.demand_visits.source = `互动假设：样本月需求×${parameters.demand}；原始名册不变`
    if (service.id === 'activity') {
      service.available_slots.value = parameters.activitySlots
      service.available_slots.source = `互动排班假设：活动室每月${parameters.activitySlots}场，每场1小时；现有社区岗在15–45场内排班`
      service.schedule_note = `互动排班：独立活动室30席，每月${parameters.activitySlots}场，每场1小时；现有社区岗固定工资预算不变。`
    }
  }
  const subsidy = input.cash_items.find(row => row.kind === 'operating_subsidy')!
  subsidy.amount.value = parameters.subsidy
  subsidy.amount.source = `互动预算假设：月度运营补贴${parameters.subsidy}元；政府购买服务与直付分别保留`
  return input
}

export function buildingSummaries(demo: CompleteCommunityDemo, phase: 'before' | 'after') {
  return Array.from({ length: demo.buildings }, (_, index) => {
    const rows = demo.householdRegister.filter(row => row.building === index + 1)
    return { id: index + 1, households: rows.length, residents: rows.reduce((sum, row) => sum + row.residents, 0),
      support: rows.filter(row => (phase === 'before' ? row.before_consent : row.after_consent) === 'support').length,
      objection: phase === 'after' ? rows.filter(row => row.after_consent === 'objection').length : 0,
      unsigned: phase === 'after' ? rows.filter(row => row.after_consent === 'unsigned').length : rows.filter(row => row.before_consent !== 'support').length,
      windows: rows.map(row => phase === 'before' ? row.before_consent === 'support' ? 'support' : 'unsigned' : row.after_consent),
    }
  })
}

/** Full-calendar series. Daily distinct residents are never summed into monthly distinct residents. */
export function dailyLedgerSeries(demo: CompleteCommunityDemo) {
  const [year, month] = demo.operations.period.split('-').map(Number)
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return Array.from({ length: days }, (_, index) => {
    const date = `${demo.operations.period}-${String(index + 1).padStart(2, '0')}`
    const rows = demo.ledger.filter(row => row.date === date)
    return { day: index + 1, date, visits: rows.length, users: new Set(rows.map(row => row.resident_id)).size,
      income: rows.reduce((sum, row) => sum + row.charge, 0), variableCost: rows.reduce((sum, row) => sum + row.variable_cost, 0) }
  })
}

/** Reconcile both actor views before drawing weighted flows. Direct fiscal cost bypasses operator cash. */
export function cashFlowRows(result: OperationsResult) {
  const m = result.metrics
  const required = [m.fee_income, m.earned_income, m.operating_cost, m.government_purchase, m.operating_subsidy,
    m.other_support, m.government_direct_cost, m.balance_after_support, m.unfunded_gap]
  if (required.some(v => v === null || !Number.isFinite(v)) || result.services.some(row => row.variable_cost === null)) return null
  const privateOther = m.earned_income! - m.fee_income! - m.government_purchase!
  const variable = result.services.reduce((sum, row) => sum + (row.variable_cost ?? 0), 0)
  const inputs = [
    { key: 'fees', label: '居民服务收费', value: m.fee_income!, color: 'var(--analysis-blue)' },
    { key: 'private', label: '其他经营收入', value: privateOther, color: 'var(--analysis-teal)' },
    { key: 'purchase', label: '政府购买服务', value: m.government_purchase!, color: 'var(--analysis-violet)' },
    { key: 'subsidy', label: '运营补贴', value: m.operating_subsidy!, color: 'var(--analysis-gold)' },
    { key: 'support', label: '其他支持', value: m.other_support!, color: 'var(--analysis-teal)' },
    { key: 'gap', label: '待落实资金缺口', value: m.unfunded_gap!, color: 'var(--analysis-red)' },
  ].filter(row => row.value > 0)
  const outputs = [
    { key: 'fixed', label: '固定运营支出', value: m.operating_cost! - variable, color: 'var(--analysis-muted)' },
    { key: 'variable', label: '人次变动支出', value: variable, color: 'var(--analysis-secondary)' },
    { key: 'balance', label: '运营现金结余', value: Math.max(0, m.balance_after_support!), color: 'var(--analysis-teal)' },
  ].filter(row => row.value > 0)
  const total = inputs.reduce((sum, row) => sum + row.value, 0)
  if (Math.abs(total - outputs.reduce((sum, row) => sum + row.value, 0)) > 0.02 || variable > m.operating_cost! || privateOther < 0) throw new Error('CASH_FLOW_NOT_RECONCILED')
  return { inputs, outputs, total, direct: m.government_direct_cost!, government: m.government_purchase! + m.operating_subsidy! + m.government_direct_cost!, operatorCost: m.operating_cost! }
}
