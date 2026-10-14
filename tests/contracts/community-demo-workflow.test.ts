import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { buildCompleteCommunityDemo } from '../../packages/retrofit/complete-demo'
import { defaultExploration, explorationInput, summarizeExploration } from '../../packages/retrofit/visual-analysis'
import { compareDemoPlans, demoInvestigations, readDemoPlans, validInvestigationProgress, type DemoPlan } from '../../packages/retrofit/demo-workflow'
import type { OperationsResult } from '../../apps/host/generated/contracts'

const demo = buildCompleteCommunityDemo()
const baseline:OperationsResult = JSON.parse(readFileSync('research/test_results/complete-community-demo-calculations.json','utf8')).scenarios[1].result
const before:DemoPlan = {name:'基准',parameters:{...defaultExploration},input:explorationInput(demo,defaultExploration),result:baseline}

test('comparison preserves signed budget changes and summaries describe actual independent schedules',()=>{
  const after = structuredClone(before)
  after.parameters = {demand:1.5,activitySlots:15,subsidy:0}
  after.input = explorationInput(demo,after.parameters)
  after.result.metrics.balance_after_support = -9450
  after.result.metrics.served_visits = 1594
  after.result.metrics.government_outlay = 7000
  const frozen = JSON.stringify([before,after])
  expect(compareDemoPlans(before,after).find(row=>row.label==='支持后现金结余')).toMatchObject({from:2294,to:-9450,delta:-11744})
  expect(compareDemoPlans(before,after).find(row=>row.label==='政府总投入')!.delta).toBe(-12000)
  const summary = summarizeExploration(after)
  expect(summary.balanceLabel).toBe('月度资金缺口')
  expect(summary.balance).toBe('9,450元/月')
  expect(summary.measures).toEqual(['减少活动室开放至15场/月（容量450人次/月）','取消运营补贴（较基准减少12,000元/月）','维持助餐26个供餐时段/月、咨询26场/月的独立排班'])
  expect(JSON.stringify([before,after])).toBe(frozen)
})

test('unknown quantities remain unknown instead of being summarized as satisfied',()=>{
  const after = structuredClone(before)
  after.result.services[0].unmet_visits = null
  expect(compareDemoPlans(before,after).find(row=>row.label==='尚未满足需求')!.delta).toBeNull()
  expect(summarizeExploration(after).outcome).toBe('未满足需求量待核')
})

test('saved plans must belong to the same synthetic facility and month and have valid parameters',()=>{
  const wrongFacility = structuredClone(before); wrongFacility.input.facility_id = 'REAL-OTHER'
  const wrongMonth = structuredClone(before); wrongMonth.input.period = '2026-08'
  const wrongRange = structuredClone(before); wrongRange.parameters.activitySlots = 200
  expect(readDemoPlans(demo,[before,wrongFacility,wrongMonth,wrongRange])).toEqual([before])
  expect(readDemoPlans(demo,null)).toEqual([])
})

test('investigation completion requires both a note and an evidence locator; all tasks state collection and completion',()=>{
  expect(validInvestigationProgress({status:'done',note:'',evidence:''}).status).toBe('pending')
  expect(validInvestigationProgress({status:'done',note:'核对排班',evidence:'演示排班表/第2行'}).status).toBe('done')
  expect(validInvestigationProgress({status:'made-up',note:'',evidence:''}).status).toBe('pending')
  expect(demoInvestigations).toHaveLength(5)
  expect(demoInvestigations.every(task=>task.object && task.method && task.fields && task.done)).toBe(true)
})
