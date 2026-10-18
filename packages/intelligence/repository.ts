import { randomUUID } from 'node:crypto'
import type { Channel, Material, Analysis, Entry } from './domain'
import { unscored, hash, canonical, searchTokens, searchExpression } from './domain'
import type { Relation } from '../../vendor/aihot/algorithms'

/** Uses the existing host Database, including its single PGlite connection. */
export interface IntelDatabase {
  query<T=Record<string,unknown>>(sql:string,params?:unknown[]):Promise<{rows:T[]}>
  exec(sql:string):Promise<unknown>
  transaction<T>(body:(db:IntelDatabase)=>Promise<T>):Promise<T>
}
export type Job={id:string;kind:'collect'|'analyze'|'rag_index'|'archive';subject:string;status:string;payload:Record<string,unknown>;error:string|null;created_at:string;result?:unknown}
export type ReceiptResult={value:unknown;model:string;usage?:unknown}
export type Review={document_id:string;version:string;family_id:string;split:'development'|'holdout'|'train';selected:boolean|null;category:string|null;note:string;allowed_use:'local_eval'|'local_sft';permission:string;reviewer:string;reviewed_at:string}
export const MIGRATION=`
CREATE TABLE IF NOT EXISTS intel_channels(id TEXT PRIMARY KEY,payload JSONB NOT NULL,enabled BOOLEAN NOT NULL DEFAULT false,last_ok TIMESTAMPTZ,next_at TIMESTAMPTZ NOT NULL DEFAULT now(),error TEXT);
CREATE TABLE IF NOT EXISTS intel_documents(id TEXT PRIMARY KEY,url TEXT UNIQUE NOT NULL,channel_id TEXT NOT NULL,latest_version TEXT NOT NULL,title TEXT NOT NULL,city TEXT NOT NULL DEFAULT '',published_at TIMESTAMPTZ,updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS intel_versions(document_id TEXT NOT NULL REFERENCES intel_documents(id),version TEXT NOT NULL,payload JSONB NOT NULL,sequence BIGSERIAL,observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),PRIMARY KEY(document_id,version));
ALTER TABLE intel_versions ADD COLUMN IF NOT EXISTS search_vector TSVECTOR;
CREATE INDEX IF NOT EXISTS intel_versions_search ON intel_versions USING gin(search_vector);
CREATE INDEX IF NOT EXISTS intel_versions_clock ON intel_versions(document_id,observed_at DESC,sequence DESC);
CREATE TABLE IF NOT EXISTS intel_revision_log(document_id TEXT NOT NULL,version TEXT NOT NULL,sequence BIGSERIAL PRIMARY KEY,observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),FOREIGN KEY(document_id,version) REFERENCES intel_versions(document_id,version));
CREATE INDEX IF NOT EXISTS intel_revision_clock ON intel_revision_log(document_id,observed_at DESC,sequence DESC);
CREATE TABLE IF NOT EXISTS intel_analysis_history(sequence BIGSERIAL PRIMARY KEY,document_id TEXT NOT NULL,version TEXT NOT NULL,payload JSONB NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),FOREIGN KEY(document_id,version) REFERENCES intel_versions(document_id,version));
CREATE TABLE IF NOT EXISTS intel_observations(document_id TEXT NOT NULL,version TEXT NOT NULL,channel_id TEXT NOT NULL,seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),PRIMARY KEY(document_id,version,channel_id),FOREIGN KEY(document_id,version) REFERENCES intel_versions(document_id,version));
CREATE TABLE IF NOT EXISTS intel_analyses(document_id TEXT NOT NULL,version TEXT NOT NULL,payload JSONB NOT NULL,PRIMARY KEY(document_id,version),FOREIGN KEY(document_id,version) REFERENCES intel_versions(document_id,version));
CREATE TABLE IF NOT EXISTS intel_memberships(document_id TEXT NOT NULL,version TEXT NOT NULL,event_id TEXT NOT NULL,story_id TEXT NOT NULL,relation TEXT NOT NULL,manual BOOLEAN NOT NULL DEFAULT false,PRIMARY KEY(document_id,version),FOREIGN KEY(document_id,version) REFERENCES intel_versions(document_id,version));
CREATE TABLE IF NOT EXISTS intel_jobs(id TEXT PRIMARY KEY,kind TEXT NOT NULL,subject TEXT NOT NULL,status TEXT NOT NULL,payload JSONB NOT NULL,error TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
ALTER TABLE intel_jobs ADD COLUMN IF NOT EXISTS result JSONB;
ALTER TABLE intel_jobs ADD COLUMN IF NOT EXISTS not_before TIMESTAMPTZ NOT NULL DEFAULT now();
CREATE UNIQUE INDEX IF NOT EXISTS intel_jobs_active ON intel_jobs(kind,subject) WHERE status IN ('queued','running');
CREATE INDEX IF NOT EXISTS intel_jobs_status ON intel_jobs(status,created_at);
CREATE INDEX IF NOT EXISTS intel_documents_scope ON intel_documents(city,published_at DESC);
CREATE TABLE IF NOT EXISTS intel_receipts(key TEXT PRIMARY KEY,payload JSONB NOT NULL,status TEXT NOT NULL,response JSONB,created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS intel_reviews(document_id TEXT NOT NULL,version TEXT NOT NULL,payload JSONB NOT NULL,PRIMARY KEY(document_id,version),FOREIGN KEY(document_id,version) REFERENCES intel_versions(document_id,version));
CREATE TABLE IF NOT EXISTS intel_project_links(owner_id TEXT NOT NULL,project_id TEXT NOT NULL,context_version INTEGER NOT NULL,source_id TEXT NOT NULL,document_id TEXT NOT NULL,version TEXT NOT NULL,origin TEXT NOT NULL,origin_id TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),PRIMARY KEY(owner_id,project_id,context_version,source_id,document_id,version,origin,origin_id),FOREIGN KEY(document_id,version) REFERENCES intel_versions(document_id,version));
CREATE INDEX IF NOT EXISTS intel_project_links_document ON intel_project_links(document_id,version,owner_id);
`
export class IntelRepository {
  constructor(readonly db:IntelDatabase){}
  async initialize(){await this.db.exec(MIGRATION)
    await this.db.query(`INSERT INTO intel_revision_log(document_id,version,observed_at)
      SELECT v.document_id,v.version,v.observed_at FROM intel_versions v
      WHERE NOT EXISTS(SELECT 1 FROM intel_revision_log l WHERE l.document_id=v.document_id)
      ORDER BY v.observed_at,v.sequence`)
    // Additive migration: previously ingested materials must remain searchable.
    const missing=(await this.db.query<{document_id:string;version:string;payload:Material}>('SELECT document_id,version,payload FROM intel_versions WHERE search_vector IS NULL')).rows
    for(const row of missing)await this.db.query("UPDATE intel_versions SET search_vector=setweight(to_tsvector('simple',$3),'A')||setweight(to_tsvector('simple',$4),'D') WHERE document_id=$1 AND version=$2",[row.document_id,row.version,searchTokens(row.payload.title).join(' '),searchTokens(row.payload.text).join(' ')])
    // Never blindly retry a possibly paid, interrupted operation.
    await this.db.query("UPDATE intel_jobs SET status='interrupted',error='HOST_RESTART' WHERE status='running'")
    await this.db.query("UPDATE intel_receipts SET status='ambiguous' WHERE status='started'")
  }
  async channels(){return (await this.db.query<{payload:Channel;last_ok:string|null;next_at:string;error:string|null}>('SELECT payload,last_ok,next_at,error FROM intel_channels ORDER BY id')).rows}
  async channel(id:string){return (await this.db.query<{payload:Channel}>('SELECT payload FROM intel_channels WHERE id=$1',[id])).rows[0]?.payload}
  async saveChannel(c:Channel){await this.db.query('INSERT INTO intel_channels(id,payload,enabled) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET payload=EXCLUDED.payload,enabled=EXCLUDED.enabled',[c.id,JSON.stringify(c),c.enabled])}
  async channelResult(c:Channel,ok:boolean,error:string|null){await this.db.query(`UPDATE intel_channels SET last_ok=CASE WHEN $2 THEN now() ELSE last_ok END,next_at=now()+($3 * interval '1 minute'),error=$4 WHERE id=$1 AND payload=$5::jsonb`,[c.id,ok,c.interval_minutes,error,JSON.stringify(c)])}
  async due(){return (await this.db.query<{payload:Channel}>('SELECT payload FROM intel_channels WHERE enabled AND next_at<=now() ORDER BY next_at LIMIT 4')).rows.map(r=>r.payload)}
  async put(m:Material,advance=true):Promise<boolean>{return this.db.transaction(async db=>{
    const old=(await db.query<{latest_version:string}>('SELECT latest_version FROM intel_documents WHERE id=$1',[m.id])).rows[0]
    if(old?.latest_version===m.version){await db.query('INSERT INTO intel_observations(document_id,version,channel_id) VALUES($1,$2,$3) ON CONFLICT(document_id,version,channel_id) DO UPDATE SET seen_at=now()',[m.id,m.version,m.channel_id]);return false}
    const exists=(await db.query('SELECT version FROM intel_versions WHERE document_id=$1 AND version=$2',[m.id,m.version])).rows.length>0
    await db.query('INSERT INTO intel_documents(id,url,channel_id,latest_version,title,city,published_at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO UPDATE SET latest_version=EXCLUDED.latest_version,title=EXCLUDED.title,city=EXCLUDED.city,published_at=EXCLUDED.published_at,updated_at=now() WHERE $8::boolean',
      [m.id,m.url,m.channel_id,m.version,m.title,m.city,m.published_at,advance])
    await db.query("INSERT INTO intel_versions(document_id,version,payload,search_vector) VALUES($1,$2,$3,setweight(to_tsvector('simple',$4),'A')||setweight(to_tsvector('simple',$5),'D')) ON CONFLICT DO NOTHING",[m.id,m.version,JSON.stringify(m),searchTokens(m.title).join(' '),searchTokens(m.text).join(' ')])
    await db.query('INSERT INTO intel_observations(document_id,version,channel_id) VALUES($1,$2,$3) ON CONFLICT(document_id,version,channel_id) DO UPDATE SET seen_at=now()',[m.id,m.version,m.channel_id])
    if(advance||!old)await db.query('INSERT INTO intel_revision_log(document_id,version) VALUES($1,$2)',[m.id,m.version])
    return advance||!exists
  })}
  async get(id:string,version?:string):Promise<Entry|null>{const rows=await this.db.query<{payload:Material;analysis:Analysis|null;event_id:string|null;story_id:string|null;relation:Relation|null;observed_at:string;channel_policy:Channel|null}>(`
    SELECT v.payload,a.payload AS analysis,g.event_id,g.story_id,g.relation,v.observed_at,c.payload AS channel_policy FROM intel_documents d
    JOIN intel_versions v ON v.document_id=d.id AND v.version=COALESCE($2,d.latest_version)
    LEFT JOIN intel_analyses a ON a.document_id=v.document_id AND a.version=v.version
    LEFT JOIN intel_memberships g ON g.document_id=v.document_id AND g.version=v.version
    LEFT JOIN intel_channels c ON c.id=v.payload->>'channel_id' WHERE d.id=$1`,[id,version??null])
    const r=rows.rows[0];if(!r)return null
    return {...r.payload,participation:r.channel_policy?.participation??r.payload.participation,publisher_group:r.channel_policy?.publisher_group??r.payload.publisher_group,analysis:r.analysis??unscored(r.payload.title),event_id:r.event_id??r.payload.id,story_id:r.story_id??r.payload.id,relation:r.relation??'UNRELATED',ingested_at:new Date(r.observed_at).toISOString()}
  }
  async entries(city?:string,limit=400,asOf?:string,textQuery='',publishedAsOf?:string):Promise<{entries:Entry[];truncated:boolean}>{
    const cap=Math.min(Math.max(limit,1),2000)
    const cutoff=asOf?(asOf.length===10?asOf+'T23:59:59.999Z':asOf):null
    const rows=(await this.db.query<{payload:Material;analysis:Analysis|null;event_id:string|null;story_id:string|null;relation:Relation|null;observed_at:string;channel_policy:Channel|null}>(`
      SELECT v.payload,a.payload AS analysis,g.event_id,g.story_id,g.relation,v.observed_at,c.payload AS channel_policy
      FROM intel_documents d JOIN LATERAL (
        SELECT chosen.payload,chosen.search_vector,chosen.document_id,chosen.version,chosen.observed_at FROM (
          SELECT v0.payload,v0.search_vector,v0.document_id,v0.version,l.observed_at,l.sequence FROM intel_revision_log l JOIN intel_versions v0 ON v0.document_id=l.document_id AND v0.version=l.version WHERE $5::timestamptz IS NULL AND l.document_id=d.id AND ($1::timestamptz IS NULL OR l.observed_at <= $1)
          UNION ALL
          SELECT v0.payload,v0.search_vector,v0.document_id,v0.version,v0.observed_at,v0.sequence FROM intel_versions v0 WHERE $5::timestamptz IS NOT NULL AND v0.document_id=d.id AND (v0.payload->>'published_at')::timestamptz <= $5 AND ($1::timestamptz IS NULL OR v0.observed_at <= $1)
        ) chosen ORDER BY CASE WHEN $5::timestamptz IS NULL THEN chosen.observed_at ELSE (chosen.payload->>'published_at')::timestamptz END DESC,chosen.sequence DESC LIMIT 1
      ) v ON true
      LEFT JOIN intel_analyses a ON a.document_id=v.document_id AND a.version=v.version
      LEFT JOIN intel_memberships g ON g.document_id=v.document_id AND g.version=v.version
      LEFT JOIN intel_channels c ON c.id=v.payload->>'channel_id'
      WHERE ($2::text IS NULL OR regexp_replace(v.payload->>'city','市$','')=regexp_replace($2,'市$','') OR regexp_replace(a.payload->'structure'->>'city','市$','')=regexp_replace($2,'市$','') OR (v.payload->>'city'='' AND strpos(v.payload->>'text',regexp_replace($2,'市$',''))>0))
      AND ($4::text='' OR v.search_vector @@ to_tsquery('simple',$4))
      AND ($5::timestamptz IS NULL OR (v.payload->>'published_at')::timestamptz <= $5)
      ORDER BY CASE WHEN $4::text='' THEN 0 ELSE ts_rank_cd(v.search_vector,to_tsquery('simple',$4)) END DESC,v.observed_at DESC,d.id LIMIT $3`,[cutoff,city||null,cap+1,searchExpression(textQuery),publishedAsOf?(publishedAsOf.length===10?publishedAsOf+'T23:59:59.999Z':publishedAsOf):null])).rows
    return {entries:rows.slice(0,cap).map(r=>({...r.payload,participation:r.channel_policy?.participation??r.payload.participation,publisher_group:r.channel_policy?.publisher_group??r.payload.publisher_group,analysis:r.analysis??unscored(r.payload.title),event_id:r.event_id??r.payload.id,story_id:r.story_id??r.payload.id,relation:r.relation??'UNRELATED',ingested_at:new Date(r.observed_at).toISOString()})),truncated:rows.length>cap}
  }
  async analyze(id:string,version:string,value:Analysis){await this.db.transaction(async db=>{
    await db.query('INSERT INTO intel_analysis_history(document_id,version,payload) VALUES($1,$2,$3)',[id,version,JSON.stringify(value)])
    await db.query('INSERT INTO intel_analyses(document_id,version,payload) VALUES($1,$2,$3) ON CONFLICT(document_id,version) DO UPDATE SET payload=EXCLUDED.payload',[id,version,JSON.stringify(value)])
  })}
  /** Do not overwrite paid/manual analysis if another request completed meanwhile. */
  async saveLocalAnalysis(id:string,version:string,value:Analysis){return this.db.transaction(async db=>{
    const changed=await db.query(`INSERT INTO intel_analyses(document_id,version,payload) VALUES($1,$2,$3)
      ON CONFLICT(document_id,version) DO UPDATE SET payload=EXCLUDED.payload
      WHERE intel_analyses.payload->>'model' IS NULL
      AND intel_analyses.payload->>'score' IS NULL
      AND COALESCE(jsonb_array_length(intel_analyses.payload->'scores'),0)=0
      AND COALESCE((intel_analyses.payload->>'selected')::boolean,false)=false
      AND intel_analyses.payload->>'status' IN ('unscored','needs_review')
      AND intel_analyses.payload IS DISTINCT FROM EXCLUDED.payload RETURNING document_id`,[id,version,JSON.stringify(value)])
    if(changed.rows.length)await db.query('INSERT INTO intel_analysis_history(document_id,version,payload) VALUES($1,$2,$3)',[id,version,JSON.stringify(value)])
    return changed.rows.length>0
  })}
  async membership(id:string,version:string,event:string,story:string,relation:Relation,manual=false){await this.db.query(`INSERT INTO intel_memberships(document_id,version,event_id,story_id,relation,manual) VALUES($1,$2,$3,$4,$5,$6)
    ON CONFLICT(document_id,version) DO UPDATE SET event_id=EXCLUDED.event_id,story_id=EXCLUDED.story_id,relation=EXCLUDED.relation,manual=EXCLUDED.manual WHERE NOT intel_memberships.manual OR EXCLUDED.manual`,[id,version,event,story,relation,manual])}
  async enqueue(kind:Job['kind'],subject:string,payload:Record<string,unknown>={}):Promise<Job>{return this.db.transaction(async db=>{
    const active=(await db.query<Job>("SELECT * FROM intel_jobs WHERE kind=$1 AND subject=$2 AND status IN ('queued','running')",[kind,subject])).rows[0]
    if(active)return active
    const id='IJ-'+randomUUID()
    await db.query("INSERT INTO intel_jobs(id,kind,subject,status,payload) VALUES($1,$2,$3,'queued',$4) ON CONFLICT DO NOTHING",[id,kind,subject,JSON.stringify(payload)])
    return (await db.query<Job>("SELECT * FROM intel_jobs WHERE kind=$1 AND subject=$2 AND status IN ('queued','running')",[kind,subject])).rows[0]
  })}
  async claim():Promise<Job|undefined>{return this.db.transaction(async db=>{
    const j=(await db.query<Job>("SELECT * FROM intel_jobs WHERE status='queued' AND not_before<=now() ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1")).rows[0]
    if(!j)return undefined
    await db.query("UPDATE intel_jobs SET status='running',updated_at=now() WHERE id=$1",[j.id]);return {...j,status:'running'}
  })}
  async endJob(id:string,status:string,error:string|null=null){await this.db.query("UPDATE intel_jobs SET status=$2,error=$3,updated_at=now() WHERE id=$1 AND status <> 'cancelled'",[id,status,error])}
  async jobResult(id:string,result:unknown){await this.db.query('UPDATE intel_jobs SET result=$2,updated_at=now() WHERE id=$1',[id,JSON.stringify(result)])}
  async deferBudget(id:string){await this.db.query("UPDATE intel_jobs SET status='queued',error='DAILY_BUDGET_WAIT',not_before=date_trunc('day',now())+interval '1 day',updated_at=now() WHERE id=$1 AND status<>'cancelled'",[id])}
  async linkProject(link:{owner_id:string;project_id:string;context_version:number;source_id:string;document_id:string;version:string;origin:string;origin_id:string}){return (await this.db.query('INSERT INTO intel_project_links(owner_id,project_id,context_version,source_id,document_id,version,origin,origin_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING RETURNING document_id',[link.owner_id,link.project_id,link.context_version,link.source_id,link.document_id,link.version,link.origin,link.origin_id])).rows.length>0}
  async projectLinks(id:string,version:string,owner:string){return (await this.db.query('SELECT project_id,context_version,source_id,origin,origin_id FROM intel_project_links WHERE document_id=$1 AND version=$2 AND owner_id=$3 ORDER BY created_at DESC LIMIT 50',[id,version,owner])).rows}
  async knowledgeStats(owner:string){return (await this.db.query(`SELECT (SELECT count(*)::int FROM intel_receipts WHERE created_at>=date_trunc('day',now())) AS model_calls_today,(SELECT count(*)::int FROM intel_analyses WHERE payload->>'status'='ready') AS analyzed,(SELECT count(*)::int FROM intel_analyses WHERE payload->>'status'='needs_review') AS needs_review,(SELECT count(*)::int FROM intel_analyses WHERE payload->>'issue'='CODE_STRUCTURED') AS structured,(SELECT count(DISTINCT event_id)::int FROM intel_memberships) AS events,(SELECT count(DISTINCT story_id)::int FROM intel_memberships) AS stories,(SELECT count(*)::int FROM intel_project_links WHERE owner_id=$1) AS project_links,(SELECT count(DISTINCT project_id)::int FROM intel_project_links WHERE owner_id=$1) AS linked_projects`,[owner])).rows[0]}
  async jobs(){return (await this.db.query<Job>('SELECT * FROM intel_jobs ORDER BY created_at DESC LIMIT 30')).rows}
  async cancel(id:string){await this.db.query("UPDATE intel_jobs SET status='cancelled',error='USER_CANCELLED' WHERE id=$1 AND status IN ('queued','running')",[id])}
  async receipt(stage:string,subject:string,input:unknown,model:string,run:()=>Promise<ReceiptResult>,dailyLimit=40):Promise<ReceiptResult>{
    if(!Number.isSafeInteger(dailyLimit)||dailyLimit<0||dailyLimit>1000)throw new Error('INVALID_MODEL_BUDGET')
    const key=hash(canonical({stage,subject,input,model}));let cached:ReceiptResult|undefined
    await this.db.transaction(async db=>{
      const old=(await db.query<{status:string;response:ReceiptResult|null}>('SELECT status,response FROM intel_receipts WHERE key=$1',[key])).rows[0]
      if(old?.status==='completed'&&old.response){cached=old.response;return}
      if(old)throw new Error(old.status==='started'?'RECEIPT_BUSY':'RECEIPT_REVIEW_REQUIRED')
      const count=(await db.query<{n:number}>("SELECT count(*)::int AS n FROM intel_receipts WHERE created_at>=date_trunc('day',now())")).rows[0].n
      if(count>=dailyLimit)throw new Error('INTELLIGENCE_BUDGET_EXHAUSTED')
      await db.query("INSERT INTO intel_receipts(key,payload,status) VALUES($1,$2,'started')",[key,JSON.stringify({stage,subject,input_hash:hash(canonical(input)),model})])
    })
    if(cached)return cached
    try{const response=await run();await this.db.query("UPDATE intel_receipts SET status='completed',response=$2 WHERE key=$1",[key,JSON.stringify(response)]);return response}
    catch(error){await this.db.query("UPDATE intel_receipts SET status='ambiguous' WHERE key=$1",[key]);throw error}
  }
  async stats(){return (await this.db.query<{documents:number;versions:number;pending:number}>(`SELECT (SELECT count(*)::int FROM intel_documents) AS documents,(SELECT count(*)::int FROM intel_versions) AS versions,(SELECT count(*)::int FROM intel_jobs WHERE status IN ('queued','running')) AS pending`)).rows[0]}
  async versions(id:string){return (await this.db.query<{version:string;observed_at:string;title:string}>("SELECT version,observed_at,payload->>'title' AS title FROM intel_versions WHERE document_id=$1 ORDER BY sequence DESC LIMIT 50",[id])).rows}
  async saveReview(r:Review){await this.db.query('INSERT INTO intel_reviews(document_id,version,payload) VALUES($1,$2,$3) ON CONFLICT(document_id,version) DO UPDATE SET payload=EXCLUDED.payload',[r.document_id,r.version,JSON.stringify(r)])}
  async reviews(){return (await this.db.query<{payload:Review}>('SELECT payload FROM intel_reviews ORDER BY document_id,version')).rows.map(r=>r.payload)}
}
