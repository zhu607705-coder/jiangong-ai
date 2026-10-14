import { writeFile, readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { buildCompleteCommunityDemo, simulateScenarioUsers } from '../packages/retrofit/complete-demo'
import { explorationInput } from '../packages/retrofit/visual-analysis'
import { cardsForChunk, entriesForChunk, recordEvidence } from '../packages/experience/lineage'
import type { OperationsResult, ExperienceCard, ActionChunk } from '../apps/host/generated/contracts'
// node --import tsx scripts/verify-community-workflow.ts <project> [version.md investigation.md]
const root='http://127.0.0.1:4310/api', id=process.argv[2]
assert(id, 'Provide the existing Qiushi project ID; this probe never creates or edits a project.')
const session=await fetch(`${root}/session`)
assert.equal(session.status,200)
const cookie=session.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ')
async function request(path:string,body?:unknown) {
  const response=await fetch(root+path,{method:body===undefined?'GET':'POST',headers:{Cookie:cookie,'Content-Type':'application/json','X-Requested-With':'haizhizi'},...(body===undefined?{}:{body:JSON.stringify(body)})})
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${path}`)
  return response.json()
}
const before=await request(`/projects/${id}`)
const followups=await request(`/projects/${id}/followups`)
const operationsBefore=await request(`/projects/${id}/community-operations`)
const pipeline=await request(`/projects/${id}/knowledge/pipeline`)
const cards=pipeline.cards as ExperienceCard[]
const doc=cards.flatMap(recordEvidence).find(evidence=>evidence.quote.includes('252'))!.document_id
const {chunks}=await request(`/projects/${id}/knowledge/chunks`,{document_id:doc}) as {chunks:ActionChunk[]}
const selected=chunks.find(chunk=>chunk.text.includes('252户'))!
const entries=entriesForChunk(selected,cardsForChunk(selected,cards))
assert(entries.some(entry=>entry.value==='252'&&entry.unit==='户'))
const demo=buildCompleteCommunityDemo(), plans=[]
for (const parameters of [{demand:1,activitySlots:30,subsidy:12000},{demand:1.5,activitySlots:15,subsidy:0},{demand:1.5,activitySlots:45,subsidy:12000}]) {
  const input=explorationInput(demo,parameters)
  const first=await request(`/projects/${id}/community-operations/preview`,{input}) as OperationsResult
  const finalInput=simulateScenarioUsers(input,first.metrics.served_visits!,demo.visitsPerResident)
  const result=await request(`/projects/${id}/community-operations/preview`,{input:finalInput}) as OperationsResult
  plans.push({parameters,served:result.metrics.served_visits,users:result.metrics.unique_users,cash:result.metrics.balance_after_support,government:result.metrics.government_outlay,unmet:result.services.reduce((sum,row)=>sum+row.unmet_visits!,0)})
}
assert.deepEqual(plans.map(plan=>[plan.served,plan.users,plan.cash,plan.government,plan.unmet]),[[1630,300,2294,19000,0],[1594,293,-9450,7000,851],[2224,409,4440,19000,221]])
const after=await request(`/projects/${id}`)
assert.deepEqual(after.input,before.input)
assert.equal(after.context_version,before.context_version)
assert.deepEqual(await request(`/projects/${id}/followups`),followups)
assert.deepEqual(await request(`/projects/${id}/community-operations`),operationsBefore)
let exportsReadback=false
if (process.argv[3] && process.argv[4]) {
  const versionExport=await readFile(process.argv[3],'utf8'), taskExport=await readFile(process.argv[4],'utf8')
  assert(versionExport.includes('|月度服务|1,630|2,224|594|人次/月|'))
  assert(versionExport.includes('关键举措')&&versionExport.includes('完整模拟'))
  assert(taskExport.includes('状态：')&&taskExport.includes('资料定位：')&&taskExport.includes('本机演示记录'))
  exportsReadback=true
}
const result={as_of:'2026-10-14',project:id,plans,evidence:{documents:pipeline.documents.length,cards:cards.length,selected_document_chunks:chunks.length,selected_quote:selected.text,linked_cards:cardsForChunk(selected,cards).length,entries},real_project_input_unchanged:true,real_followups_unchanged:true,real_operations_records_unchanged:true,exports_readback:exportsReadback}
await writeFile('research/test_results/community-workflow-live.json',JSON.stringify(result,null,2)+'\n')
process.stdout.write(JSON.stringify({plans,quote:selected.text,input_unchanged:true,operations_unchanged:true,exports_readback:exportsReadback})+'\n')
