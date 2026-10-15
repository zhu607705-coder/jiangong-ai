import { describe,expect,it } from 'vitest'
import { validateStrategy, type StrategySource } from '../../packages/retrofit/strategy'
import { buildStrategyDemo } from '../../packages/retrofit/complete-demo'
import type { RenewalStrategy } from '../../apps/host/generated/contracts'

const source:StrategySource={id:'CURRENT',title:'对象记录',text:'本小区已开展供水与电梯改善。',url:null,published_at:'2026-09-01',role:'current',locator:'line:1'}
function strategy():RenewalStrategy{return {headline:'供水与电梯整治，并行研究拆建条件',summary:'依据对象原文形成两条研究路径。',preferred_mode:'comprehensive',rationale:[{point:'已有分项改善记录',source_id:'CURRENT',quote:source.text}],paths:['comprehensive','rebuild'].map(mode=>({mode:mode as 'comprehensive'|'rebuild',title:mode,description:'研究路径',actions:[{title:'调查',detail:'取得对象材料',evidence_refs:['CURRENT']}],requirements:['专业核查']})),dimensions:['demand','supply','adaptation','implementation','operations','resources'].map(key=>({key:key as RenewalStrategy['dimensions'][number]['key'],current:'原文线索',current_level:'unknown',comprehensive:'整治目标',comprehensive_level:'medium',rebuild:'拆建目标',rebuild_level:'unknown',evidence_refs:['CURRENT']})),next_checks:[]}}
describe('source-grounded strategy',()=>{
  it('rejects invented or cross-file quotes and a strategy supported only by a reference case',()=>{
    expect(validateStrategy(strategy(),[source])).toBeTruthy()
    const value=strategy();value.rationale[0].quote='所有楼栋已鉴定且可以拆除重建。';expect(()=>validateStrategy(value,[source])).toThrow('STRATEGY_QUOTE_MISMATCH')
    expect(()=>validateStrategy(strategy(),[{...source,role:'reference'}])).toThrow('STRATEGY_OBJECT_EVIDENCE_MISSING')
  })
  it('prevents a verified physical restriction being hidden by a preferred-mode explanation',()=>{
    expect(()=>validateStrategy(strategy(),[source],[{kind:'structure_repairable',value:false,state:'restricted',source_ids:['CURRENT'],locators:['line:1']}])).toThrow('STRATEGY_MODE_RESTRICTED')
  })
  it('rejects a preferred rebuild direction when its necessity and feasibility gate has not passed',()=>{
    const value=strategy();value.preferred_mode='rebuild'
    expect(()=>validateStrategy(value,[source],[])).toThrow('STRATEGY_REBUILD_GATE_UNMET')
  })
  it('keeps both simulations on the same baseline and accounts for construction, demolition, relocation and reserve',()=>{
    const repair=buildStrategyDemo('comprehensive'),rebuild=buildStrategyDemo('rebuild')
    expect(rebuild.before).toEqual(repair.before)
    expect(repair.budget_wan).toBe(1584);expect(rebuild.budget_wan).toBe(20250+90+2880+2025)
    expect(rebuild.after.dimensions.find(row=>row.key==='resources')?.value).toBe(1.3)
    expect(rebuild.dimensions.find(row=>row.key==='resources')?.after).toContain('23645')
  })
})
