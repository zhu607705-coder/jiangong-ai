/** Full public-data workflow in an isolated process: no project/round or intelligence DB writes. */
import {readFile} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import {config} from '../apps/host/config.ts'
import {projectInput} from '../packages/contracts/validate.ts'
import {projectDecisionInput} from '../packages/decision/structured-route.ts'
import {researchRenewalStrategy} from '../services/map-screening/renewal-strategy.ts'
import {installIntelligenceHooks} from '../packages/intelligence/research-bridge.ts'
const fixture=JSON.parse(await readFile(new URL('../fixtures/inputs/01_auto.json',import.meta.url),'utf8'))
const project=projectInput({...fixture,project_id:'TEST-ONLINE-'+randomUUID(),synthetic:false,business_profile:'neighborhood',as_of:'2026-10-17',scope:{name:'建工新村',city:'天津市',geometry:null,coordinate_encoding:'WGS84',legal_parcel_confirmed:false},facts:[],sources:[],context_rules:[],events:[],candidate_ids:fixture.candidate_ids})
let capturedSources=0
const restore=installIntelligenceHooks({lookup:async()=>[],remember:async sources=>{capturedSources+=sources.length}})
const started=Date.now(),events=[]
try{
 const packet=await researchRenewalStrategy(project,0,projectDecisionInput(project),'isolated-live-test-'+randomUUID(),false,AbortSignal.timeout(360000),null,{researchWorkflow:true,onProgress:event=>{events.push({at_ms:Date.now()-started,...event});console.log(JSON.stringify({kind:'progress',at_ms:Date.now()-started,stage:event.stage,status:event.status,phase:event.workflow?.phase,message:event.message,source_count:event.source_count}))}})
 const quotes=[]
 function inspect(value){if(!value||typeof value!=='object')return;if(!Array.isArray(value)&&typeof value.source_id==='string'&&typeof value.quote==='string'&&value.quote){const source=packet.sources.find(s=>s.id===value.source_id);quotes.push({source_id:value.source_id,matched:!!source&&source.text.includes(value.quote),foreign:source?.object_binding?.relation==='different_object'})}for(const v of Object.values(value))if(v&&typeof v==='object')inspect(v)}
 inspect(packet.strategy)
 const work=packet.strategy?.paths.flatMap(path=>path.work_packages||[])||[]
 const summary={scope:'isolated_full_public_research_not_enterprise_accuracy',project_target:'天津市建工新村',status:packet.status,delivery:packet.delivery,elapsed_ms:Date.now()-started,headline:packet.strategy?.headline,preferred_mode:packet.strategy?.preferred_mode,public_queries:packet.research?.queries.length||0,sources:packet.sources.length,foreign_sources:packet.sources.filter(s=>s.object_binding?.relation==='different_object').length,foreign_as_current:packet.sources.filter(s=>s.object_binding?.relation==='different_object'&&s.role==='current').length,dimensions:packet.strategy?.dimensions.length||0,reasoning_dimensions:packet.strategy?.reasoning_dimensions?.length||0,work_packages:work.length,internal_data_requests:packet.strategy?.internal_data_requests?.length||0,quotes:{total:quotes.length,matched:quotes.filter(q=>q.matched).length,foreign_quotes:quotes.filter(q=>q.foreign).length},experts:packet.workflow?.tasks.map(t=>({role:t.role,status:t.status,attempts:t.attempts})),compression:packet.workflow?{before:packet.workflow.expanded_input_characters,after:packet.workflow.output_characters,retained_quotes:packet.workflow.retained_quotes,audit:packet.workflow.compression_audit}:null,model_calls:packet.model_calls.length,model_duration_ms:packet.model_calls.reduce((sum,c)=>sum+c.duration_ms,0),input_tokens:packet.model_calls.reduce((sum,c)=>sum+c.input_tokens,0),output_tokens:packet.model_calls.reduce((sum,c)=>sum+c.output_tokens,0),review_codes:packet.content_review?.issues.map(i=>i.code)||[],diagnostic:packet.diagnostic||null,project_writes:0,intelligence_writes:0,public_sources_captured_in_process:capturedSources}
 console.log(JSON.stringify({kind:'complete',summary,packet,events,project}))
}finally{restore()}

