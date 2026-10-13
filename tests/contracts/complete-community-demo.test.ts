import { expect, test } from 'vitest'
import { buildCompleteCommunityDemo, summarizeDemoLedger, simulateScenarioUsers, renderCompleteDemoReport } from '../../packages/retrofit/complete-demo'
import { validate } from '../../packages/contracts/validate'

test('complete demonstration supplies six auditable dimensions and a fully labelled monthly input', () => {
  const demo = buildCompleteCommunityDemo()
  validate('OperationsInput', demo.operations)
  for (const dashboard of [demo.beforeDashboard, demo.afterDashboard]) {
    validate('DecisionDashboard', dashboard)
    expect(dashboard.dimensions).toHaveLength(6)
    expect(dashboard.dimensions.every(d => Number.isFinite(d.value) && d.value! >= 1 && d.value! <= 5 && d.basis && d.evidence_refs.length)).toBe(true)
  }
  expect(demo.provenance.every(row => row.basis && row.source && row.kind)).toBe(true)
  expect(demo.capital.total).toBe(1584)
  expect(demo.capital.funding_gap).toBe(0)
  expect(demo.householdRegister.reduce((sum, h) => sum + h.residents, 0)).toBe(demo.population)
  expect(demo.householdRegister.filter(h => h.after_consent === 'support')).toHaveLength(552)
  const values = [demo.operations.target_population, demo.operations.unique_users, ...demo.operations.cash_items.map(c => c.amount), ...demo.operations.services.flatMap(s => [s.capacity_per_slot, s.available_slots, s.demand_visits, s.paid_share, s.fee_per_visit, s.variable_cost_per_visit])]
  expect(values.every(v => Number.isFinite(v.value) && v.status === 'assumption' && v.source_kind === 'demo' && v.source)).toBe(true)
})

test('synthetic service rows reconcile to charges, capacity, distinct residents and cash balances', () => {
  const demo = buildCompleteCommunityDemo(), ledger = summarizeDemoLedger(demo)
  expect(demo.ledger).toHaveLength(1568)
  expect(ledger.unique_users).toBe(286)
  expect(ledger.fee_income).toBe(15095)
  expect(ledger.operating_cost).toBe(35528)
  expect(ledger.balance_after_support).toBe(1367)
  expect(ledger.government_outlay).toBe(19000)
  for (const service of demo.operations.services) {
    const rows = demo.ledger.filter(row => row.service_id === service.id)
    const bySlot = new Map<string, number>()
    for (const row of rows) bySlot.set(row.slot, (bySlot.get(row.slot) || 0) + 1)
    expect([...bySlot.values()].every(count => count <= service.capacity_per_slot.value!)).toBe(true)
    expect(rows.every(row => row.period === demo.operations.period && row.kind === 'synthetic')).toBe(true)
  }
})

test('deduplicated scenario people use served visits and a stated repeat-frequency assumption', () => {
  const demo = buildCompleteCommunityDemo()
  const input = simulateScenarioUsers(demo.operations, 1304, demo.visitsPerResident)
  expect(input.unique_users.value).toBe(240)
  expect(input.unique_users.source_kind).toBe('demo')
  expect(input.unique_users.source).toContain('5.433')
  expect(demo.operations.unique_users.value).toBe(300)
  expect(() => simulateScenarioUsers({ ...demo.operations, unique_users: { ...demo.operations.unique_users, status: 'factual', source_kind: 'observation' } }, 1304, demo.visitsPerResident)).toThrow()
  expect(() => simulateScenarioUsers(demo.operations, 1304, 0)).toThrow()
})

test('complete report identifies synthetic records and separates capital from monthly operator and fiscal cash', () => {
  const demo = buildCompleteCommunityDemo(), report = renderCompleteDemoReport(demo)
  expect(report).toContain('模拟演示')
  expect(report).toContain('1584')
  expect(report).toContain('1568')
  expect(report).toContain('1367')
  expect(report).toContain('1 + 4')
  expect(report).not.toContain('待补充')
})
