import { expect,test } from 'vitest'
import prototype from '../../data/templates/cost-neural-prototype.json'
import { predictCostNetwork,workbookCostFeatures,type CostNetwork } from '../../packages/construction-costs/neural-preview'
import synthetic from '../../research/training/cost-neural-prototype/synthetic-dataset.json'
import workbook from '../../research/training/cost-neural-prototype/workbook-dataset.json'

test('browser forward pass repeats the persisted Python default and all locked audit predictions',()=>{
 for (const [name,data] of Object.entries({synthetic,workbook})) {
  const result=prototype.datasets[name as keyof typeof prototype.datasets]
  const model=result.model as CostNetwork
  expect(predictCostNetwork(model,result.default_inputs)).toBeCloseTo(result.default_prediction,8)
  for (const row of data.rows.filter(row=>row.role==='locked_final_audit')) {
   const expected=result.audit_predictions.find(item=>item.id===row.id)!.predicted
   expect(predictCostNetwork(model,row.x)).toBeCloseTo(expected,8)
  }
 }
})
test('input preparation contains no target or target-derived price and rejects malformed values',()=>{
 expect(workbookCostFeatures(18000,'roof_and_related_facilities')).toEqual([Math.log(18000),1,0,0,0,0])
 expect(()=>workbookCostFeatures(0,'unknown')).toThrow()
 const model=prototype.datasets.synthetic.model as CostNetwork
 expect(()=>predictCostNetwork(model,[NaN])).toThrow()
 expect(()=>predictCostNetwork(model,[1,2])).toThrow()
})
test('the weak declared-price result and good synthetic result retain distinct evidence labels',()=>{
 expect(prototype.datasets.workbook.kind).toBe('workbook_unverified')
 expect(prototype.datasets.workbook.metrics.locked_final_audit.pso_bp.r2).toBeLessThan(0)
 expect(prototype.datasets.synthetic.kind).toBe('synthetic')
 expect(prototype.deployment_allowed).toBe(false)
 expect(prototype.datasets.workbook.split_counts).toEqual({train:20,development:4,replacement_gate:4,locked_final_audit:9})
})
