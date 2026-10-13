import { readFileSync } from 'node:fs'
import { test, expect } from 'vitest'
import { buildCompleteCommunityDemo } from '../../packages/retrofit/complete-demo'
import { buildingSummaries, dailyLedgerSeries, cashFlowRows, explorationInput } from '../../packages/retrofit/visual-analysis'
import type { OperationsResult } from '../../apps/host/generated/contracts'
const demo = buildCompleteCommunityDemo()
const baseline: OperationsResult = JSON.parse(readFileSync('research/test_results/complete-community-demo-calculations.json', 'utf8')).scenarios[1].result

test('interactive draft separates demand, activity scheduling and subsidy without changing the registered sample', () => {
  const original = JSON.stringify(demo)
  const input = explorationInput(demo, { demand: 1.5, activitySlots: 15, subsidy: 0 })
  expect(input.services.map(service => service.demand_visits.value)).toEqual([1080, 1248, 117])
  expect(input.services.map(service => service.available_slots.value)).toEqual([15, 26, 26])
  expect(input.cash_items.find(row => row.kind === 'operating_subsidy')!.amount.value).toBe(0)
  expect(input.cash_items.find(row => row.kind === 'government_purchase')!.amount.value).toBe(5000)
  expect(input.cash_items.find(row => row.kind === 'government_direct_cost')!.amount.value).toBe(2000)
  expect(input.services.every(service => service.demand_visits.source_kind === 'demo')).toBe(true)
  expect(JSON.stringify(demo)).toBe(original)
  expect(() => explorationInput(demo, { demand: NaN, activitySlots: 30, subsidy: 12000 })).toThrow('OUT_OF_RANGE')
})

test('building drilldown reconciles household, population and stage-specific consent', () => {
  const before = buildingSummaries(demo, 'before'), after = buildingSummaries(demo, 'after')
  expect(after.reduce((sum, b) => sum + b.households, 0)).toBe(600)
  expect(after.reduce((sum, b) => sum + b.residents, 0)).toBe(1500)
  expect(before.reduce((sum, b) => sum + b.support, 0)).toBe(354)
  expect(after.reduce((sum, b) => sum + b.support, 0)).toBe(552)
  expect(after[13]).toMatchObject({ support: 32, objection: 8, unsigned: 0 })
  expect(after[14]).toMatchObject({ support: 0, objection: 22, unsigned: 18 })
  expect(after.every(b => b.windows.length === b.households)).toBe(true)
})

test('daily ledger chart uses all calendar dates and exactly reconciles additive quantities', () => {
  const series = dailyLedgerSeries(demo)
  expect(series).toHaveLength(30)
  expect(series.reduce((sum, day) => sum + day.visits, 0)).toBe(1568)
  expect(series.reduce((sum, day) => sum + day.income, 0)).toBe(15095)
  expect(series.reduce((sum, day) => sum + day.variableCost, 0)).toBe(9028)
  expect(series[29]).toMatchObject({ date: '2026-09-30', visits: 22 })
  expect(series.reduce((sum, day) => sum + day.users, 0)).not.toBe(286)
})

test('cash graph preserves the actor split and reconciles total inflow to outflow', () => {
  const flow = cashFlowRows(baseline)!
  expect(flow.total).toBe(37612)
  expect(flow.direct).toBe(2000)
  expect(flow.government).toBe(19000)
  expect(flow.outputs.reduce((sum, r) => sum + r.value, 0) + flow.direct).toBe(39612)
  expect(flow.outputs.find(r => r.key === 'fixed')!.value).toBe(26000)
  const deficit = structuredClone(baseline)
  deficit.metrics.operating_cost! += 5000; deficit.metrics.balance_after_support! -= 5000
  deficit.metrics.unfunded_gap = 2706
  expect(cashFlowRows(deficit)!.inputs.find(r => r.key === 'gap')!.value).toBe(2706)
  const incomplete = structuredClone(baseline); incomplete.metrics.earned_income = null
  expect(cashFlowRows(incomplete)).toBeNull()
})
