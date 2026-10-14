import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import type { OperationsResult } from '../../apps/host/generated/contracts'
import { buildCompleteCommunityDemo } from '../../packages/retrofit/complete-demo'
import { createDemoPlan, demoPlanName, demoPlanSavedTime, nextDemoPlanNumber, readDemoPlans, type DemoPlan } from '../../packages/retrofit/demo-workflow'
import { defaultExploration, explorationInput } from '../../packages/retrofit/visual-analysis'

const demo = buildCompleteCommunityDemo()
const result: OperationsResult = JSON.parse(readFileSync('research/test_results/complete-community-demo-calculations.json', 'utf8')).scenarios[1].result
const snapshot = {parameters:{...defaultExploration}, input:explorationInput(demo,defaultExploration), result}

test('legacy clock-only names become descriptive names without fabricating a save date or changing calculations', () => {
  const parameters = [defaultExploration, {demand:1.5,activitySlots:15,subsidy:0}, {demand:1.5,activitySlots:45,subsidy:12000}]
  const values = parameters.map((parameters,index) => ({name:`方案 ${index+1} · 00:${24+index}`, parameters:{...parameters}, input:explorationInput(demo,parameters), result:structuredClone(result)}))
  const frozen = JSON.stringify(values)
  const plans = readDemoPlans(demo,values)
  expect(plans.map(plan=>plan.name)).toEqual(['方案 1 · 基准运营','方案 2 · 需求高峰、缩减排班、取消补贴','方案 3 · 需求高峰、增加开放'])
  expect(plans).toHaveLength(3)
  for (let index=0;index<3;index++) {
    expect(plans[index].parameters).toEqual(values[index].parameters)
    expect(plans[index].input).toEqual(values[index].input)
    expect(plans[index].result).toEqual(values[index].result)
    expect(plans[index].createdAt).toBeUndefined()
    expect(demoPlanSavedTime(plans[index])).toEqual({kind:'legacy',text:`历史保存时刻 00:${24+index}（日期未记录）`})
  }
  expect(JSON.stringify(values)).toBe(frozen)
  expect(readDemoPlans(demo,plans)).toEqual(plans)
})

test('new plans keep the full timestamp separately and display a dated Beijing save time', () => {
  const plan = createDemoPlan(snapshot,1,'2026-10-14T00:24:00.000Z')
  expect(plan.name).toBe('方案 1 · 基准运营')
  expect(plan.createdAt).toBe('2026-10-14T00:24:00.000Z')
  expect(demoPlanSavedTime(plan)).toEqual({kind:'saved',text:'保存于 2026/10/14 08:24（北京时间）',dateTime:'2026-10-14T00:24:00.000Z'})
  expect(readDemoPlans(demo,[plan])).toEqual([plan])
  plan.input.name = 'changed'
  plan.result.metrics.served_visits = 1
  expect(snapshot.input.name).not.toBe('changed')
  expect(snapshot.result.metrics.served_visits).toBe(1630)
})

test('date-less or invalid timestamps stay unrecorded rather than using the current day', () => {
  const plan:DemoPlan = {...snapshot,name:'自定方案',createdAt:'00:24'}
  expect(readDemoPlans(demo,[plan])[0].createdAt).toBeUndefined()
  expect(demoPlanSavedTime(plan)).toBeNull()
  expect(demoPlanSavedTime({...plan,legacySavedTime:'25:00'})).toBeNull()
  expect(()=>createDemoPlan(snapshot,1,'00:24')).toThrow('保存时刻需要包含日期和时区')
})

test('user names are retained and deleting a middle plan does not reuse an existing number', () => {
  const first = createDemoPlan(snapshot,1,'2026-10-14T00:24:00Z')
  const third = createDemoPlan(snapshot,3,'2026-10-14T00:27:00Z')
  expect(nextDemoPlanNumber([first,third])).toBe(4)
  const custom = {...first,name:'居民议事后方案'}
  expect(readDemoPlans(demo,[custom])[0].name).toBe('居民议事后方案')
  expect(demoPlanName({demand:1,activitySlots:30,subsidy:6000},4)).toBe('方案 4 · 减少补贴')
})
