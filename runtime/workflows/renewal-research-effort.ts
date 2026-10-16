import type { RenewalResearchPlan } from '../../apps/host/generated/contracts'
import type { StrategySource } from '../../packages/retrofit/strategy'

/** Resource allocation only: it never scores a mode or limits request counts. */
export function allocateRenewalEffort(tasks: RenewalResearchPlan['tasks'], sources: readonly StrategySource[], deadlineAt: number, now = Date.now()) {
  const synthesisReserveMs = 150_000
  const available = Math.max(0, deadlineAt - now - synthesisReserveMs)
  const weights = tasks.map(task => {
    const characters=sources.filter(source=>task.source_ids.includes(source.id)).reduce((total,source)=>total+source.text.length,0)
    return {characters,weight:1+Math.log2(1+characters/1000)+task.question.length/240}
  })
  const maximum=Math.max(1,...weights.map(row=>row.weight))
  return weights.map(row=>({maxOutputTokens:Math.min(8000,Math.max(3500,Math.ceil((3000+row.characters/8)/500)*500)),
    timeoutMs:Math.floor(available*(.55+.45*row.weight/maximum)),sourceCharacters:row.characters,synthesisReserveMs}))
}
