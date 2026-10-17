import 'dotenv/config'
import {randomUUID} from 'node:crypto'
import {mkdir,writeFile} from 'node:fs/promises'
import {dirname} from 'node:path'
import fixture from '../fixtures/inputs/01_auto.json'
import type {ProjectInput} from '../apps/host/generated/contracts'
import {projectDecisionInput} from '../packages/decision/structured-route'
import {researchRenewalStrategy} from '../services/map-screening/renewal-strategy'
import {config} from '../apps/host/config'
const output=process.argv[2]||'research/test_results/research-zero-source-probe-20261017.json',start=Date.now()
Object.assign(config,{decisionEnabled:false})
const project={...structuredClone(fixture),project_id:'PROTOCOL-ZERO-'+randomUUID(),synthetic:true,business_profile:'neighborhood',as_of:'2026-10-17',scope:{name:'隔离的零资料协议测试对象',geometry:null},facts:[],sources:[],context_rules:[]} as unknown as ProjectInput
try{
 const input=projectDecisionInput(project);input.renewalMode!.cases=[];input.renewalMode!.evidence=[]
 const result=await researchRenewalStrategy(project,0,input,'protocol-only',true,AbortSignal.timeout(180000),null,{researchWorkflow:true,onProgress:event=>console.log(JSON.stringify({stage:event.stage,status:event.status})),savedResearch:{sources:[],research:null},roundContext:{round_id:'protocol-only',round_number:1,allow_internal_ai:false,materials:[],sources:[],parent:null,first_round_id:'protocol-only',first_input_hash:'protocol-only',first_context_version:0}})
 const work=result.strategy?.paths.flatMap(path=>path.work_packages||[])||[]
 const receipt={checked_at:new Date().toISOString(),scope:'Isolated native zero-source protocol test; no real project or decision labels.',status:result.status,elapsed_ms:Date.now()-start,delivery:result.delivery,source_count:result.sources.length,dimensions:result.strategy?.dimensions.length,reasoning_dimensions:result.strategy?.reasoning_dimensions?.length,work_packages:work.length,no_invented_citations:work.every(row=>row.source_id===null&&row.quote===''&&row.evidence_refs.length===0)&&!result.strategy?.rationale.length,model_calls:result.model_calls,diagnostic:result.diagnostic||null,review_issue_codes:result.content_review?.issues.map(issue=>issue.code),project_writes:0}
 await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt))
 if(receipt.status!=='completed'||receipt.reasoning_dimensions!==6||!receipt.no_invented_citations)process.exitCode=1
}catch(error){await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify({checked_at:new Date().toISOString(),status:'blocked_external',error:error instanceof Error?error.name:'Error',elapsed_ms:Date.now()-start,project_writes:0},null,2)+'\n');process.exitCode=1}
