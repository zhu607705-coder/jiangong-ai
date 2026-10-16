import { createHash, randomUUID } from 'node:crypto'
import { readFile, realpath } from 'node:fs/promises'
import { relative, resolve, sep, basename, dirname } from 'node:path'
import { config } from '../apps/host/config'
import { Store } from '../apps/host/store'
import { validate } from '../packages/contracts/validate'
import type { RenewalStrategy } from '../apps/host/generated/contracts'
import type { ResearchRound } from '../packages/retrofit/research-rounds'
import { projectRenewalModeInput } from '../packages/retrofit/renewal-mode'
import { reviewStrategyContent, strategyModelReferences, type StrategyPacket } from '../packages/retrofit/strategy'

// Operational recovery of an actual, persisted model result. No provider or search calls.
const [projectId,roundId,nativePath,apply]=process.argv.slice(2)
if(!projectId||!roundId||!nativePath||apply&&apply!=='--apply')throw new Error('Usage: recover-renewal-strategy <project> <failed-round> <native-jsonl> [--apply]')
const hash=(value:string)=>createHash('sha256').update(value).digest('hex')
const root=await realpath(resolve(config.dataDir,'sessions')),file=await realpath(nativePath)
const within=relative(root,file)
if(within.startsWith('..'+sep)||within==='..'||resolve(root,within)!==file||basename(file)!=='session.v4.jsonl')throw new Error('RECOVERY_SESSION_SCOPE')
const store=await Store.open(config.dataDir,config.DATABASE_URL)
try {
  const project=await store.project(projectId,config.ownerId)
  if(!project)throw new Error('RECOVERY_PROJECT_NOT_FOUND')
  const row=(await store.db.query<{payload:ResearchRound;input_snapshot:unknown}>('SELECT payload,input_snapshot FROM renewal_research_rounds WHERE id=$1 AND owner_id=$2 AND project_id=$3',[roundId,config.ownerId,projectId])).rows[0]
  const original=row?.payload,packet=original?.result
  if(!original||original.status!=='failed'||!packet||packet.diagnostic?.code!=='STRATEGY_EVIDENCE_INVALID'||packet.project_id!==projectId||packet.context_version!==project.context_version||packet.synthetic!==project.input.synthetic)throw new Error('RECOVERY_FAILED_ROUND_SCOPE')
  if(packet.sources.some(source=>source.visibility==='internal'||source.data_class==='internal'||source.project_id&&source.project_id!==projectId))throw new Error('RECOVERY_PRIVATE_SOURCE_REQUIRES_SEPARATE_REVIEW')
  const sessionId=basename(dirname(file))
  const call=packet.model_calls.filter(call=>/^renewal_strategy(?:_quote_repair)?$/.test(call.stage)).at(-1)
  if(call?.session_id!==sessionId)throw new Error('RECOVERY_SESSION_NOT_OWNED_BY_ROUND')
  const events=(await readFile(file,'utf8')).split('\n').filter(Boolean).map(line=>JSON.parse(line))
  if(events[0]?.id!==sessionId)throw new Error('RECOVERY_SESSION_IDENTITY')
  const output=events.filter(event=>event.type==='tool/call'&&event.data?.name==='structured_output').at(-1)?.data.arguments
  if(typeof output!=='string')throw new Error('RECOVERY_NO_STRUCTURED_OUTPUT')
  const strategy=validate<RenewalStrategy>('RenewalStrategy',strategyModelReferences(packet.sources).restoreKnown(JSON.parse(output)))
  const content_review=reviewStrategyContent(strategy,packet.sources,projectRenewalModeInput(project.input).conditions,{requireRoundReview:true,hasParent:!!original.parent_round_id,requireReasoningDimensions:!!packet.workflow,synthetic:packet.synthetic,projectName:project.name})
  content_review.recovered_from={round_id:roundId,session_id:sessionId,candidate_sha256:hash(output)}
  const inputHash=hash(JSON.stringify({source_hash:packet.input_hash,policy:content_review.policy,candidate_sha256:hash(output)}))
  const now=new Date().toISOString(),id='ROUND-'+randomUUID()
  const result:StrategyPacket={...packet,input_hash:inputHash,created_at:now,status:'completed',strategy,error:null,content_review}
  delete result.diagnostic;delete result.publication
  const evidence={status:apply?'recovered':'dry_run',project_id:projectId,source_round_id:roundId,source_packet_sha256:hash(JSON.stringify(packet)),candidate_sha256:hash(output),headline:strategy.headline,work_packages:strategy.paths.map(path=>path.work_packages?.length||0),dimensions:strategy.dimensions.length,issues:content_review.issues,provider_calls:0,original_round_unchanged:true,new_round_id:null as string|null}
  if(apply) {
    evidence.new_round_id=await store.db.transaction(async db=>{
      const locked=(await db.query<{context_version:number}>('SELECT context_version FROM projects WHERE id=$1 AND owner_id=$2 FOR UPDATE',[projectId,config.ownerId])).rows[0]
      if(locked?.context_version!==packet.context_version)throw new Error('RECOVERY_PROJECT_CHANGED')
      const rounds=(await db.query<{payload:ResearchRound}>('SELECT payload FROM renewal_research_rounds WHERE owner_id=$1 AND project_id=$2 ORDER BY round_number',[config.ownerId,projectId])).rows.map(row=>row.payload)
      const existing=rounds.find(round=>round.result?.content_review?.recovered_from?.round_id===roundId)
      if(existing)return existing.id
      if(rounds.some(round=>['running','draft','completed'].includes(round.status)))throw new Error('RECOVERY_NEWER_RESULT_EXISTS')
      const round:ResearchRound={...original,id,round_number:Math.max(...rounds.map(round=>round.round_number))+1,input_hash:inputHash,first_round_id:original.parent_round_id?original.first_round_id:id,first_input_hash:original.parent_round_id?original.first_input_hash:inputHash,origin:'adopted_history',status:'completed',result,error:null,created_at:now,updated_at:now,missing_materials:strategy.round_review?.missing_materials||[]}
      await db.query('INSERT INTO renewal_research_rounds(id,owner_id,project_id,round_number,payload,input_snapshot) VALUES($1,$2,$3,$4,$5,$6)',[id,config.ownerId,projectId,round.round_number,JSON.stringify(round),JSON.stringify(row.input_snapshot)])
      await db.query('INSERT INTO renewal_strategy_assessments(owner_id,project_id,input_hash,payload) VALUES($1,$2,$3,$4)',[config.ownerId,projectId,inputHash,JSON.stringify(result)])
      return id
    })
  }
  console.log(JSON.stringify(evidence))
} finally {await store.db.close()}
