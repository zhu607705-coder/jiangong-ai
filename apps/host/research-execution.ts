import {randomUUID,createHash} from 'node:crypto'
import {canonical} from '../../packages/intelligence/domain'
import type {Store,Database,ProjectRecord} from './store'
import type {ResearchExecution,ResearchManifest,ResearchLineage} from '../../packages/retrofit/research-execution'
import {config} from './config'
export const researchHash=(value:unknown)=>createHash('sha256').update(canonical(JSON.parse(JSON.stringify(value)))).digest('hex')
type NodeRow={status:string;fencing_token:number;attempt:number;output:unknown;lease_until:string}
export async function initializeResearchExecution(store:Store){
  await store.db.exec(`CREATE TABLE IF NOT EXISTS research_node_receipts (
    owner_id TEXT NOT NULL,project_id TEXT NOT NULL,round_id TEXT NOT NULL,node_key TEXT NOT NULL,input_hash TEXT NOT NULL,
    status TEXT NOT NULL,attempt INTEGER NOT NULL DEFAULT 1,fencing_token INTEGER NOT NULL DEFAULT 1,lease_until TIMESTAMPTZ,
    output JSONB,lineage JSONB,error_code TEXT,started_at TIMESTAMPTZ NOT NULL DEFAULT now(),finished_at TIMESTAMPTZ,
    duration_ms INTEGER,reused INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(owner_id,round_id,node_key,input_hash));
    CREATE TABLE IF NOT EXISTS research_round_events(id BIGSERIAL PRIMARY KEY,owner_id TEXT NOT NULL,project_id TEXT NOT NULL,round_id TEXT NOT NULL,payload JSONB NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now());
    CREATE INDEX IF NOT EXISTS research_round_event_cursor ON research_round_events(owner_id,round_id,id);
    CREATE TABLE IF NOT EXISTS research_manifest_versions(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,project_id TEXT NOT NULL,round_id TEXT NOT NULL,payload JSONB NOT NULL,UNIQUE(owner_id,round_id,id));
    CREATE TABLE IF NOT EXISTS research_call_receipts(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,project_id TEXT NOT NULL,round_id TEXT NOT NULL,operation_id TEXT NOT NULL,provider TEXT NOT NULL,request_hash TEXT NOT NULL,
    outcome TEXT NOT NULL,billing_state TEXT NOT NULL,usage JSONB,started_at TIMESTAMPTZ NOT NULL DEFAULT now(),finished_at TIMESTAMPTZ,duration_ms INTEGER,error_code TEXT);`)
}
/** One Store owner; short DB leases surround network work, never an open network transaction. */
export class StoredResearchExecution implements ResearchExecution {
  constructor(private store:Store,private project:ProjectRecord,private roundId:string,readonly deadlineAt:number,readonly resumed:boolean,private signal:AbortSignal,readonly provider:'legacy'|'deepseek_tools'|'deepseek_content'=config.RESEARCH_WEB_PROVIDER){}
  private async allowed(db:Database){
    const row=(await db.query<{payload:{status:string;execution?:{cancelled?:boolean}}}>('SELECT payload FROM renewal_research_rounds WHERE id=$1 AND owner_id=$2 AND project_id=$3',[this.roundId,this.project.owner_id,this.project.id])).rows[0]
    if(!row||row.payload.execution?.cancelled||!['running','draft'].includes(row.payload.status))throw new Error('RESEARCH_CANCELLED_OR_OBSOLETE')
    this.signal.throwIfAborted()
  }
  async event(value:unknown){await this.store.db.query('INSERT INTO research_round_events(owner_id,project_id,round_id,payload) VALUES($1,$2,$3,$4)',[this.project.owner_id,this.project.id,this.roundId,JSON.stringify(value)])}
  async checkAccess(sourceIds:readonly string[]){const current=await this.store.project(this.project.id,this.project.owner_id);if(!current)throw new Error('RESEARCH_ACCESS_REVOKED');for(const id of sourceIds){const original=this.project.input.sources.find(source=>source.id===id);if(original&&(original.visibility==='internal'||original.data_class==='internal')){const now=current.input.sources.find(source=>source.id===id);if(config.ALLOW_INTERNAL_MODEL!=='true'||!now||now.hash!==original.hash)throw new Error('RESEARCH_ACCESS_REVOKED')}}}
  async completed(prefix:string){return (await this.store.db.query<{node_key:string;output:unknown}>('SELECT node_key,output FROM research_node_receipts WHERE owner_id=$1 AND project_id=$2 AND round_id=$3 AND status=\'completed\' AND node_key LIKE $4 ORDER BY node_key',[this.project.owner_id,this.project.id,this.roundId,prefix+'%'])).rows.map(row=>({key:row.node_key,output:row.output}))}
  async timings(){const rows=(await this.store.db.query<{node_key:string;duration_ms:number}>("SELECT node_key,duration_ms FROM research_node_receipts WHERE owner_id=$1 AND status='completed' AND duration_ms>0 AND (node_key LIKE 'expert:%' OR node_key='synthesize') ORDER BY finished_at DESC LIMIT 100",[this.project.owner_id])).rows;const quantile=(kind:string)=>{const values=rows.filter(row=>row.node_key.startsWith(kind)).map(row=>row.duration_ms).sort((a,b)=>a-b);return values.length>=5?values[Math.ceil(values.length*.95)-1]:undefined};return {expert_p95_ms:quantile('expert:'),synthesis_p95_ms:quantile('synthesize'),sample_count:rows.length}}
  async beginCall(provider:string,operation:string,request:unknown){const id=randomUUID();await this.store.db.query("INSERT INTO research_call_receipts(id,owner_id,project_id,round_id,operation_id,provider,request_hash,outcome,billing_state) VALUES($1,$2,$3,$4,$5,$6,$7,'in_flight','unknown')",[id,this.project.owner_id,this.project.id,this.roundId,operation,provider,researchHash(request)]);return id}
  async finishCall(id:string,usage:unknown,outcome:'received'|'failed'|'unknown_outcome'='received',billing:'expected_charge'|'expected_free'|'unknown'='expected_charge'){await this.store.db.query('UPDATE research_call_receipts SET outcome=$2,billing_state=$3,usage=$4,finished_at=now(),duration_ms=(EXTRACT(EPOCH FROM (now()-started_at))*1000)::integer WHERE id=$1 AND owner_id=$5 AND round_id=$6',[id,outcome,billing,JSON.stringify(usage||null),this.project.owner_id,this.roundId])}
  async recordWebCall(value:{id:string;provider:string;operation:string;request_hash:string;outcome:string;billing_state:string;duration_ms:number;[key:string]:unknown}){await this.store.db.query('INSERT INTO research_call_receipts(id,owner_id,project_id,round_id,operation_id,provider,request_hash,outcome,billing_state,usage,duration_ms) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(id) DO UPDATE SET outcome=EXCLUDED.outcome,billing_state=EXCLUDED.billing_state,usage=EXCLUDED.usage,duration_ms=EXCLUDED.duration_ms,finished_at=now()',[value.id,this.project.owner_id,this.project.id,this.roundId,value.operation,value.provider,value.request_hash,value.outcome,value.billing_state,JSON.stringify(value),value.duration_ms])}
  async run<T>(key:string,input:unknown,execute:()=>Promise<T>,options:{lineage?:ResearchLineage;retry?:boolean}={}):Promise<T>{
    await this.checkAccess(options.lineage?.source_ids||[])
    const hash=researchHash(input),params=[this.project.owner_id,this.project.id,this.roundId,key,hash],started=Date.now()
    const lease=await this.store.db.transaction(async db=>{
      await this.allowed(db)
      const row=(await db.query<NodeRow>('SELECT * FROM research_node_receipts WHERE owner_id=$1 AND project_id=$2 AND round_id=$3 AND node_key=$4 AND input_hash=$5 FOR UPDATE',params)).rows[0]
      if(row?.status==='completed'){
        await db.query('UPDATE research_node_receipts SET reused=reused+1 WHERE owner_id=$1 AND project_id=$2 AND round_id=$3 AND node_key=$4 AND input_hash=$5',params)
        return {reuse:true,output:row.output,token:row.fencing_token}
      }
      if(row?.status==='running'&&Date.parse(row.lease_until)>Date.now())throw new Error('RESEARCH_NODE_BUSY')
      const token=(row?.fencing_token||0)+1
      await db.query(`INSERT INTO research_node_receipts(owner_id,project_id,round_id,node_key,input_hash,status,attempt,fencing_token,lease_until,lineage)
        VALUES($1,$2,$3,$4,$5,'running',1,$6,$7,$8) ON CONFLICT(owner_id,round_id,node_key,input_hash) DO UPDATE SET status='running',attempt=research_node_receipts.attempt+1,fencing_token=$6,lease_until=$7,lineage=$8,error_code=NULL,started_at=now(),finished_at=NULL`,[...params,token,new Date(Math.min(this.deadlineAt,Date.now()+90000)).toISOString(),JSON.stringify(options.lineage||null)])
      return {reuse:false,output:null,token}
    })
    if(lease.reuse){await this.event({type:'node',node_key:key,status:'reused'});return lease.output as T}
    await this.event({type:'node',node_key:key,status:'running'})
    const heartbeat=setInterval(()=>{void this.store.db.query('UPDATE research_node_receipts SET lease_until=$7 WHERE owner_id=$1 AND project_id=$2 AND round_id=$3 AND node_key=$4 AND input_hash=$5 AND fencing_token=$6 AND status=\'running\'',[...params,lease.token,new Date(Math.min(this.deadlineAt,Date.now()+90000)).toISOString()]).catch(()=>undefined)},25000)
    try{
      const output=await execute()
      await this.checkAccess(options.lineage?.source_ids||[])
      await this.store.db.transaction(async db=>{
        await this.allowed(db)
        const result=await db.query(`UPDATE research_node_receipts SET status='completed',output=$7,finished_at=now(),duration_ms=$8 WHERE owner_id=$1 AND project_id=$2 AND round_id=$3 AND node_key=$4 AND input_hash=$5 AND fencing_token=$6 AND status='running' RETURNING node_key`,[...params,lease.token,JSON.stringify(output),Date.now()-started])
        if(!result.rows.length)throw new Error('RESEARCH_NODE_STALE_LEASE')
      })
      await this.event({type:'node',node_key:key,status:'completed',duration_ms:Date.now()-started});return output
    }catch(error){
      const code=error instanceof Error&&/^[A-Z_]+$/.test(error.message)?error.message:'RESEARCH_NODE_FAILED'
      await this.store.db.query(`UPDATE research_node_receipts SET status=$7,error_code=$8,finished_at=now(),duration_ms=$9 WHERE owner_id=$1 AND project_id=$2 AND round_id=$3 AND node_key=$4 AND input_hash=$5 AND fencing_token=$6 AND status='running'`,[...params,lease.token,this.signal.aborted?'interrupted':'failed',code,Date.now()-started])
      await this.event({type:'node',node_key:key,status:'failed',error_code:code});throw error
    }finally{clearInterval(heartbeat)}
  }
  async manifest(sources:{id:string;text:string;document_version?:string;visibility?:string;data_class?:string}[],questionIds:string[]=[]):Promise<ResearchManifest>{
    const versions=Object.fromEntries(sources.map(source=>[source.id,researchHash({text:source.text,document_version:source.document_version,visibility:source.visibility,data_class:source.data_class})]))
    const id='MANIFEST-'+researchHash({round:this.roundId,versions,questionIds})
    const existing=(await this.store.db.query<{payload:ResearchManifest}>('SELECT payload FROM research_manifest_versions WHERE id=$1 AND owner_id=$2 AND project_id=$3',[id,this.project.owner_id,this.project.id])).rows[0]
    if(existing)return existing.payload
    const previous=(await this.store.db.query<{payload:ResearchManifest}>('SELECT payload FROM research_manifest_versions WHERE owner_id=$1 AND round_id=$2 ORDER BY (payload->>\'version\')::integer DESC LIMIT 1',[this.project.owner_id,this.roundId])).rows[0]?.payload
    const payload:ResearchManifest={id,parent_id:previous?.id||null,version:(previous?.version||0)+1,source_versions:versions,created_at:new Date().toISOString(),question_ids:questionIds}
    await this.store.db.query('INSERT INTO research_manifest_versions(id,owner_id,project_id,round_id,payload) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING',[id,this.project.owner_id,this.project.id,this.roundId,JSON.stringify(payload)])
    return payload
  }
  async call<T>(provider:string,operation:string,request:unknown,execute:()=>Promise<T>,usage?:(result:T)=>unknown):Promise<T>{
    const id=randomUUID(),hash=researchHash(request),started=Date.now()
    await this.store.db.query("INSERT INTO research_call_receipts(id,owner_id,project_id,round_id,operation_id,provider,request_hash,outcome,billing_state) VALUES($1,$2,$3,$4,$5,$6,$7,'in_flight','unknown')",[id,this.project.owner_id,this.project.id,this.roundId,operation,provider,hash])
    try{const result=await execute();await this.store.db.query("UPDATE research_call_receipts SET outcome='received',billing_state='expected_charge',usage=$2,finished_at=now(),duration_ms=$3 WHERE id=$1",[id,JSON.stringify(usage?.(result)||null),Date.now()-started]);return result}
    catch(error){await this.store.db.query("UPDATE research_call_receipts SET outcome=$2,billing_state=$3,error_code=$4,finished_at=now(),duration_ms=$5 WHERE id=$1",[id,this.signal.aborted?'unknown_outcome':'failed','unknown',error instanceof Error?error.name:'Error',Date.now()-started]);throw error}
  }
}
