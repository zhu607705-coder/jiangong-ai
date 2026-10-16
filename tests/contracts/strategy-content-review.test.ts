import { describe,it,expect } from 'vitest'
import { reviewStrategyContent, strategyModelReferences, validateStrategy, type StrategySource } from '../../packages/retrofit/strategy'
import type { RenewalStrategy } from '../../apps/host/generated/contracts'
import { withConcreteWorkPlan } from './fixtures/strategy-work-plan'

const source:StrategySource={id:'REF',title:'公开案例',text:'历史案例已开展供水与电梯改善。',url:null,published_at:null,role:'reference',locator:'line:1'}
function plan():RenewalStrategy {
  return withConcreteWorkPlan({headline:'分项更新候选方案',summary:'先比较工程与服务配置。',preferred_mode:'comprehensive',
    rationale:[{point:'参考既有改善措施',source_id:source.id,quote:source.text}],
    paths:(['comprehensive','rebuild'] as const).map(mode=>({mode,title:mode,description:'候选路径',actions:[],requirements:['核实实施条件']})),
    dimensions:(['demand','supply','adaptation','implementation','operations','resources'] as const).map(key=>({key,current:'对象现况待核',current_level:'unknown',comprehensive:'整治目标',comprehensive_level:'medium',rebuild:'拆建目标',rebuild_level:'medium',evidence_refs:[source.id]})),next_checks:[],
    decision_brief:{renewal:{conclusion:'优先研究分项措施',reason:'依据参考案例分析',evidence_refs:[source.id]},investment:{conclusion:'建议比较工程投入',reason:'条件另行核实',stage:'construction',evidence_refs:[source.id]},returns:{financial:'核实持续维护支出',social:'比较服务覆盖',evidence_refs:[source.id]}}},source)
}
describe('nonblocking strategy content review',()=>{
  it('returns all findings and actionable search/read guidance without altering claims or approving conditions',()=>{
    const value=plan(),before=structuredClone(value)
    value.paths[0].work_packages![0].quote='这段原句不在来源中。'
    const review=reviewStrategyContent(value,[source],[],{projectName:'浙大路18-1号'})
    expect(review.issues.map(issue=>issue.code)).toEqual(expect.arrayContaining(['STRATEGY_OBJECT_EVIDENCE_MISSING','STRATEGY_CONSTRUCTION_GATE_UNMET','STRATEGY_WORK_PACKAGE_QUOTE_MISMATCH']))
    expect(review.follow_up.search_queries[0]).toContain('浙大路18-1号')
    expect(review.follow_up.reading_focus.join('')).toContain('全文')
    expect(value.preferred_mode).toBe(before.preferred_mode)
    expect(value.decision_brief!.investment.stage).toBe('construction')
    expect(()=>validateStrategy(value,[source],[],true)).toThrow('STRATEGY_OBJECT_EVIDENCE_MISSING')
  })
  it('keeps unknown references as findings and never imports a different source or changes quoted text',()=>{
    const value=plan(),refs=strategyModelReferences([source])
    value.paths[0].work_packages![0].source_id='OTHER-PROJECT'
    value.paths[0].work_packages![0].evidence_refs=['OTHER-PROJECT']
    const restored=refs.restoreKnown(value)
    expect(()=>reviewStrategyContent(restored,[source])).not.toThrow()
    expect(reviewStrategyContent(restored,[source]).issues.map(issue=>issue.code)).toContain('STRATEGY_SOURCE_MISMATCH')
    expect(restored.paths[0].work_packages![0].source_id).toBe('OTHER-PROJECT')
    expect(restored.paths[0].work_packages![0].quote).toBe(source.text)
    expect(refs.sources).toHaveLength(1)
  })
})
