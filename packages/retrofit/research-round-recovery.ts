import type { ResearchRound } from './research-rounds'

/** Link the saved recovery to its original attempt; the stored attempt is never rewritten. */
export function recoveredResearchRound(original:ResearchRound,rounds:readonly ResearchRound[]):ResearchRound|undefined {
  const before=original.result
  if(original.status!=='failed'||!before||before.status!=='failed'||before.project_id!==original.project_id||before.context_version!==original.context_version)return
  return rounds.filter(round=>{
    const value=round.result
    return round.id!==original.id&&round.project_id===original.project_id&&round.context_version===original.context_version&&round.status==='completed'
      &&value?.status==='completed'&&!!value.strategy&&value.project_id===original.project_id&&value.context_version===original.context_version&&value.synthetic===before.synthetic
      &&value.content_review?.recovered_from?.round_id===original.id
  }).sort((a,b)=>Date.parse(b.updated_at)-Date.parse(a.updated_at)||b.round_number-a.round_number)[0]
}

export function recoverySourceRound(recovery:ResearchRound,rounds:readonly ResearchRound[]):ResearchRound|undefined {
  const id=recovery.result?.content_review?.recovered_from?.round_id
  const source=rounds.find(round=>round.id===id)
  return source&&recoveredResearchRound(source,[recovery])?source:undefined
}
