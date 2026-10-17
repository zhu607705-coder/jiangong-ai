/** Offline only. Usage: node --import tsx scripts/replay-context-compression.ts SAVED_ROUND.json RECEIPT.json */
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {dirname} from 'node:path'
import {createHash} from 'node:crypto'
import assert from 'node:assert/strict'
import {compileRenewalResearchContext} from '../runtime/workflows/renewal-research'
import {packEvidenceContext} from '../packages/retrofit/evidence-compression'
import {sourceQuoteCandidates} from '../services/map-screening/renewal-strategy'
import {strategyModelReferences,type StrategyPacket} from '../packages/retrofit/strategy'
import type {ResearchRound} from '../packages/retrofit/research-rounds'
const [input,output]=process.argv.slice(2)
if(!input||!output)throw new Error('Usage: replay-context-compression SAVED_ROUND.json RECEIPT.json')
const bytes=await readFile(input),round=JSON.parse(bytes.toString('utf8')) as ResearchRound,packet=round.result as StrategyPacket
assert(packet?.workflow?.notes)
const workflow=packet.workflow,sources=packet.sources,notes=workflow.notes!,reads=workflow.tasks.flatMap(task=>task.retrieval?.read_windows||[]).map(window=>{
 const source=sources.find(source=>source.id===window.source_id);assert(source)
 return {...window,text:source.text.slice(window.start_char,window.end_char)}
})
const result=compileRenewalResearchContext(sources,notes,workflow.plan,workflow.tasks,reads)
assert.equal(result.expanded,workflow.expanded_input_characters,'Replay inputs differ from the saved comparison scope')
for(const [index,compact] of result.contextValue.untrusted_expert_notes.entries()){
 const restored={...compact,observations:compact.observations.map(({quote_ref,...row})=>{
  const window=result.contextValue.evidence_windows.find(window=>window.source_id===row.source_id&&window.start_char<=quote_ref.start_char&&window.end_char>=quote_ref.end_char);assert(window)
  return {...row,quote:window.text.slice(quote_ref.start_char-window.start_char,quote_ref.end_char-window.start_char)}
 })}
 assert.deepEqual(restored,notes[index],'Expert reasoning, assumptions, parameters and investigations must round-trip unchanged')
}
for(const window of result.contextValue.evidence_windows){const source=sources.find(source=>source.id===window.source_id)!;assert.equal(source.text.slice(window.start_char,window.end_char),window.text)}
assert.equal(result.audit.retention_ratio,1)
const references=strategyModelReferences(sources),compressed=references.encodeKnown(result.contextValue),packed=packEvidenceContext(compressed)
const {source_catalog,...research}=packed,quoteChoices=sourceQuoteCandidates(references.sources,[],compressed.evidence_windows)
const synthesis=JSON.stringify(source_catalog).length+JSON.stringify(research).length+JSON.stringify(quoteChoices).length
const receipt={checked_at:new Date().toISOString(),scope:'offline_saved_round_replay_no_provider_calls',round_id:round.id,project_id:packet.project_id,input_sha256:createHash('sha256').update(bytes).digest('hex'),report_sha256:createHash('sha256').update(JSON.stringify(packet)).digest('hex'),policy:'literal-evidence-v2',equivalent:{before:result.expanded,previous_after:workflow.output_characters,after:result.context.length,reduction_percent:Number(((1-result.context.length/result.expanded)*100).toFixed(2))},synthesis_evidence_payload:{previous:workflow.synthesis_context_chars,after:synthesis,reduction_percent:Number(((1-synthesis/workflow.synthesis_context_chars!)*100).toFixed(2)),excludes:'system instructions, output schema, project conditions, input/output tokens and billing'},body:{before:workflow.retained_source_characters,after:result.audit.retained_chars},retention:{expert_records:notes.length,quotes:notes.reduce((sum,note)=>sum+note.observations.length,0),critical_fragments:result.audit.critical_fragments,retained_critical_fragments:result.audit.retained_critical_fragments,omitted:result.audit.omitted.length,all_expert_fields_roundtrip:true,all_windows_literal:true},provider_calls:0,production_writes:0}
await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt))
