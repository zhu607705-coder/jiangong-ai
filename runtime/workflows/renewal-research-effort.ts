import type { RenewalResearchPlan,DecisionResearchRouting } from '../../apps/host/generated/contracts'
import type { StrategySource } from '../../packages/retrofit/strategy'

/** Resource allocation only: it never scores a mode or limits request counts. */
export function allocateRenewalEffort(tasks: RenewalResearchPlan['tasks'], sources: readonly StrategySource[], deadlineAt: number, now = Date.now(),routing?:DecisionResearchRouting,observed?:{expert_p95_ms?:number;synthesis_p95_ms?:number;sample_count:number}) {
  const synthesisReserveMs = observed?.synthesis_p95_ms?Math.max(60000,Math.min(240000,Math.ceil(observed.synthesis_p95_ms*1.2))):150_000
  const available = Math.max(0, deadlineAt - now - synthesisReserveMs)
  const weights = tasks.map(task => {
    const characters=sources.filter(source=>task.source_ids.includes(source.id)).reduce((total,source)=>total+source.text.length,0)
    const effort=routing?.tasks.find(row=>row.role===task.role)?.effort
    return {characters,effort,weight:(1+Math.log2(1+characters/1000)+task.question.length/240+(task.question_ids?.length||0)*.2+(/结构|消防|资金缺口|腾退/.test(task.question)?.5:0))*(effort==='brief'?.65:effort==='deep'?1.25:1)}
  })
  const maximum=Math.max(1,...weights.map(row=>row.weight))
  return weights.map(row=>({maxOutputTokens:row.effort==='brief'?3000:Math.min(8000,Math.max(3500,Math.ceil((3000+row.characters/8)/500)*500)+(row.effort==='deep'?1000:0)),
    timeoutMs:Math.min(row.effort==='brief'?90000:observed?.expert_p95_ms?Math.max(90000,observed.expert_p95_ms*1.4):Infinity,Math.floor(available*(.55+.45*row.weight/maximum))),sourceCharacters:row.characters,synthesisReserveMs,allocation_basis:observed?.sample_count?'observed_duration_and_question_impact':'question_impact_and_evidence_size'}))
}
