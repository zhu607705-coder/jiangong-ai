import { writeFileSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { buildCompleteCommunityDemo, summarizeDemoLedger, renderCompleteDemoReport, simulateScenarioUsers } from '../packages/retrofit/complete-demo'
import { projectPython } from './python-runtime'
import type { OperationsResult } from '../apps/host/generated/contracts'

const demo = buildCompleteCommunityDemo()
const inputs = [0.8, 1, 1.2].map((multiplier, index) => {
  const input = structuredClone(demo.operations)
  input.name += ` · ${['保守', '基准', '积极'][index]}`
  if (index !== 1) delete input.analysis_bounds
  for (const service of input.services) service.demand_visits.value = Math.round(service.demand_visits.value! * multiplier)
  return input
})
const evaluate = (data: unknown): OperationsResult[] => {
  const result = spawnSync(projectPython(), ['-c', 'import json,sys;from services.capabilities.community_operations import evaluate_operations;print(json.dumps([evaluate_operations(i).model_dump(mode="json") for i in json.load(sys.stdin)],ensure_ascii=False))'], { input: JSON.stringify(data), encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, env: { ...process.env, PYTHONUTF8: '1' } })
  if (result.status !== 0) throw new Error(result.stderr)
  return JSON.parse(result.stdout)
}
const first = evaluate(inputs)
const completeInputs = inputs.map((input, index) => simulateScenarioUsers(input, first[index].metrics.served_visits!, demo.visitsPerResident))
const results = evaluate(completeInputs)
for (const result of results) {
  if (result.missing.length || Object.values(result.metrics).some(v => v === null || !Number.isFinite(v))) throw new Error('Complete demo still contains missing metrics')
}
mkdirSync('research/test_results', { recursive: true })
mkdirSync('data/templates', { recursive: true })
writeFileSync('data/templates/complete-community-demo-v1.json', JSON.stringify(demo, null, 2) + '\n')
writeFileSync('research/test_results/complete-community-demo-calculations.json', JSON.stringify({ data_kind: 'synthetic', model_version: results[0].model_version, scenarios: completeInputs.map((input, index) => ({ input, result: results[index] })), ledger_summary: summarizeDemoLedger(demo), root_cause: { project_sources: 24, structured_facts: 0, prior_run: 'RUNTIME_FAILED', dashboard_input: 'empty', change: 'explicit complete-data simulation reuses existing radar and operations calculator without writing real facts or observations' } }, null, 2) + '\n')
writeFileSync('research/test_results/complete-community-demo-report.md', renderCompleteDemoReport(demo) + '\n## 计算接口的基准指标\n\n' + Object.entries(results[1].metrics).map(([k, v]) => `${k}: ${v}`).join('\n') + '\n')
console.log(JSON.stringify({ scenarios: results.map(r => ({ served: r.metrics.served_visits, unique: r.metrics.unique_users, coverage: r.metrics.coverage, cash: r.metrics.balance_after_support })), ledger_rows: demo.ledger.length, household_rows: demo.householdRegister.length, all_metrics_complete: true }))
