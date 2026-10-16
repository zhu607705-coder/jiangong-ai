import { expect,test } from 'vitest'
import { allocateRenewalEffort } from '../../runtime/workflows/renewal-research-effort'
import type { StrategySource } from '../../packages/retrofit/strategy'
test('a larger source task gets more output capacity and time while preserving synthesis time',()=>{
  const sources=[{id:'a',text:'短文'.repeat(100)},{id:'b',text:'长文'.repeat(15000)}] as StrategySource[]
  const tasks=([{id:'small',source_ids:['a'],question:'核对一处设施',role:'residents_operations'},{id:'large',source_ids:['b'],question:'核对结构、实施与资金的相互条件',role:'building_delivery'}] as const).map(row=>({...row,source_ids:[...row.source_ids]}))
  const [small,large]=allocateRenewalEffort(tasks,sources,600000,0)
  expect(large.maxOutputTokens).toBeGreaterThan(small.maxOutputTokens);expect(large.timeoutMs).toBeGreaterThan(small.timeoutMs)
  expect(large.timeoutMs).toBeLessThanOrEqual(450000);expect(large.synthesisReserveMs).toBe(150000)
})
