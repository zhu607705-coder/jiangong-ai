import type {IntelRepository,IntelDatabase} from './repository'
import type {WebCallReceipt} from '../../runtime/dsh/deepseek-web-tools'
import {campaignPlan,beijingDay,dailyPace,CAMPAIGN_POLICY,type CampaignQuery} from './campaign-plan'
import {CorpusDisk} from './corpus-disk'
import type {Material} from './domain'

type Settings={enabled:boolean;daily_search_limit:number;daily_fetch_limit:number;daily_cny_limit:number;cursor:number;next_at:string;error:string|null}
const MIGRATION=`
CREATE TABLE IF NOT EXISTS intel_corpus_campaign(id INT PRIMARY KEY CHECK(id=1),enabled BOOLEAN NOT NULL DEFAULT false,daily_search_limit INT NOT NULL DEFAULT 1000,daily_fetch_limit INT NOT NULL DEFAULT 200,daily_cny_limit NUMERIC NOT NULL DEFAULT 6,cursor INT NOT NULL DEFAULT 0,next_at TIMESTAMPTZ NOT NULL DEFAULT now(),error TEXT);
INSERT INTO intel_corpus_campaign(id) VALUES(1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS intel_corpus_queries(id TEXT PRIMARY KEY,query TEXT NOT NULL,payload JSONB NOT NULL,last_at TIMESTAMPTZ NOT NULL DEFAULT now(),job_id TEXT,result JSONB);
CREATE TABLE IF NOT EXISTS intel_corpus_calls(id TEXT PRIMARY KEY,day TEXT NOT NULL,operation TEXT NOT NULL,payload JSONB NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS intel_corpus_calls_day ON intel_corpus_calls(day,operation);
CREATE TABLE IF NOT EXISTS intel_corpus_archives(document_id TEXT NOT NULL,version TEXT NOT NULL,payload JSONB NOT NULL,archived_at TIMESTAMPTZ NOT NULL DEFAULT now(),fetched_at TIMESTAMPTZ,PRIMARY KEY(document_id,version),FOREIGN KEY(document_id,version) REFERENCES intel_versions(document_id,version));
ALTER TABLE intel_corpus_archives ADD COLUMN IF NOT EXISTS fetched_at TIMESTAMPTZ;
CREATE TABLE IF NOT EXISTS intel_corpus_discoveries(query_id TEXT NOT NULL REFERENCES intel_corpus_queries(id),url TEXT NOT NULL,document_id TEXT,version TEXT,seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),PRIMARY KEY(query_id,url));
`
/** Campaign domain rules share IntelRepository, intel_jobs and the host's existing worker. */
export class CorpusCampaign {
  readonly disk:CorpusDisk
  readonly plan:CampaignQuery[]
  constructor(readonly repo:IntelRepository,dataDir:string,readonly approved=()=>process.env.INTELLIGENCE_CAMPAIGN_SPEND_APPROVED==='true',reserveBytes?:number){this.disk=new CorpusDisk(dataDir,reserveBytes);this.plan=campaignPlan()}
  private approvedLimit(){const value=Number(process.env.INTELLIGENCE_CAMPAIGN_APPROVED_DAILY_CNY||6);return Number.isFinite(value)&&value>=0&&value<=10?value:0}
  async initialize(){await this.repo.db.exec(MIGRATION)
    // Interrupted calls retain their worst-case reservation. Never declare them free.
    await this.repo.db.query(`UPDATE intel_corpus_calls SET payload=jsonb_set(jsonb_set(payload,'{outcome}','"unknown_outcome"'),'{billing_state}','"unknown"') WHERE payload->>'outcome'='in_flight'`)
  }
  async settings(){return (await this.repo.db.query<Settings>('SELECT * FROM intel_corpus_campaign WHERE id=1')).rows[0]}
  async configure(value:{enabled:boolean;daily_search_limit:number;daily_fetch_limit:number;daily_cny_limit:number}){
    if(!Number.isInteger(value.daily_search_limit)||value.daily_search_limit<1||value.daily_search_limit>1000||!Number.isInteger(value.daily_fetch_limit)||value.daily_fetch_limit<0||value.daily_fetch_limit>1000||!Number.isFinite(value.daily_cny_limit)||value.daily_cny_limit<0||value.daily_cny_limit>10)throw Error('INVALID_CAMPAIGN_LIMIT')
    if(value.enabled&&(!this.approved()||value.daily_cny_limit>this.approvedLimit()))throw Error('CAMPAIGN_COST_APPROVAL_REQUIRED')
    await this.repo.db.query('UPDATE intel_corpus_campaign SET enabled=$1,daily_search_limit=$2,daily_fetch_limit=$3,daily_cny_limit=$4,next_at=now(),error=NULL WHERE id=1',[value.enabled,value.daily_search_limit,value.daily_fetch_limit,value.daily_cny_limit])
    if(!value.enabled)await this.repo.db.query("UPDATE intel_jobs SET status='cancelled',error='CAMPAIGN_PAUSED' WHERE kind='corpus_collect' AND status='queued'")
  }
  private async usage(day:string,db:IntelDatabase=this.repo.db){return (await db.query<{search_attempts:number;fetch_attempts:number;successful:number;unknown:number;estimated_cny:number}>(`SELECT count(*) FILTER(WHERE operation='search')::int AS search_attempts,count(*) FILTER(WHERE operation='fetch')::int AS fetch_attempts,count(*) FILTER(WHERE payload->>'outcome'='received')::int AS successful,count(*) FILTER(WHERE payload->>'outcome' IN ('in_flight','unknown_outcome'))::int AS unknown,COALESCE(sum(COALESCE((payload->>'estimated_cny')::numeric,0.005)),0)::float AS estimated_cny FROM intel_corpus_calls WHERE day=$1`,[day])).rows[0]}
  async status(now=new Date()){
    const settings=await this.settings(),usage=await this.usage(beijingDay(now))
    const archive=(await this.repo.db.query<{versions:number;chunks:number}>('SELECT count(*)::int AS versions,COALESCE(sum((payload->>\'chunks\')::int),0)::int AS chunks FROM intel_corpus_archives')).rows[0]
    const recent=(await this.repo.db.query<{query:string;result:unknown}>('SELECT query,result FROM intel_corpus_queries ORDER BY last_at DESC LIMIT 5')).rows
    return {policy:CAMPAIGN_POLICY,...settings,daily_cny_limit:Number(settings.daily_cny_limit),cost_approved:this.approved(),approved_daily_cny:this.approvedLimit(),day:beijingDay(now),timezone:'Asia/Shanghai',usage,archive,query_pool:this.plan.length,recent,
      storage:'corpus-public',search_unit_cny:0.005,fetch_unit_cny:0.005,uses_model_for_search:false,model_daily_budget:Number(process.env.INTELLIGENCE_DAILY_MODEL_CALLS||40),
      pricing_source:'https://api-docs.deepseek.com/zh-cn/guides/search/',schedule:'均匀分布全天；同题至少间隔7天，正文7天复查；无结果也计入本地调用上限'}
  }
  async schedule(now=new Date()){
    if(!this.approved())return
    await this.repo.db.transaction(async db=>{
      const c=(await db.query<Settings>('SELECT * FROM intel_corpus_campaign WHERE id=1 FOR UPDATE')).rows[0]
      if(!c.enabled||Date.parse(c.next_at)>now.getTime())return
      if((await db.query("SELECT id FROM intel_jobs WHERE kind='corpus_collect' AND status IN ('queued','running') LIMIT 1")).rows.length)return
      const usage=await this.usage(beijingDay(now),db)
      if(usage.search_attempts>=Math.min(c.daily_search_limit,dailyPace(c.daily_search_limit,now))||usage.estimated_cny+0.005>Math.min(Number(c.daily_cny_limit),this.approvedLimit()))return
      const recent=new Set((await db.query<{id:string}>("SELECT id FROM intel_corpus_queries WHERE last_at>$1::timestamptz-interval '7 days'",[now.toISOString()])).rows.map(r=>r.id))
      let chosen:CampaignQuery|undefined,index=c.cursor
      for(let n=0;n<this.plan.length;n++){const i=(c.cursor+n)%this.plan.length;if(!recent.has(this.plan[i].id)){chosen=this.plan[i];index=i;break}}
      if(!chosen){await db.query("UPDATE intel_corpus_campaign SET next_at=$1::timestamptz+interval '1 hour',error='QUERY_POOL_COOLDOWN' WHERE id=1",[now.toISOString()]);return}
      const job=await this.repo.enqueue('corpus_collect',chosen.id,{query_id:chosen.id},db)
      await db.query('INSERT INTO intel_corpus_queries(id,query,payload,last_at,job_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO UPDATE SET last_at=EXCLUDED.last_at,job_id=EXCLUDED.job_id,result=NULL',[chosen.id,chosen.query,JSON.stringify(chosen),now.toISOString(),job.id])
      await db.query("UPDATE intel_corpus_campaign SET cursor=$1,next_at=$2::timestamptz+($3*interval '1 millisecond'),error=NULL WHERE id=1",[(index+1)%this.plan.length,now.toISOString(),Math.ceil(86400000/c.daily_search_limit)])
    })
  }
  async query(id:string){return (await this.repo.db.query<{payload:CampaignQuery}>('SELECT payload FROM intel_corpus_queries WHERE id=$1',[id])).rows[0]?.payload}
  async record(receipt:WebCallReceipt,now=new Date()){
    if(receipt.outcome!=='in_flight'){
      await this.repo.db.query('UPDATE intel_corpus_calls SET payload=$2 WHERE id=$1',[receipt.id,JSON.stringify(receipt)]);return
    }
    await this.repo.db.transaction(async db=>{
      const c=(await db.query<Settings>('SELECT * FROM intel_corpus_campaign WHERE id=1 FOR UPDATE')).rows[0]
      if(!c.enabled||!this.approved())throw Error('CAMPAIGN_PAUSED')
      const u=await this.usage(beijingDay(now),db),used=receipt.operation==='search'?u.search_attempts:u.fetch_attempts,limit=receipt.operation==='search'?c.daily_search_limit:c.daily_fetch_limit
      if(used>=limit||u.estimated_cny+0.005>Math.min(Number(c.daily_cny_limit),this.approvedLimit())+1e-9)throw Error('CAMPAIGN_DAILY_LIMIT')
      await db.query('INSERT INTO intel_corpus_calls(id,day,operation,payload) VALUES($1,$2,$3,$4)',[receipt.id,beijingDay(now),receipt.operation,JSON.stringify(receipt)])
    })
  }
  async discovery(queryId:string,url:string,m?:Pick<Material,'id'|'version'>){await this.repo.db.query('INSERT INTO intel_corpus_discoveries(query_id,url,document_id,version) VALUES($1,$2,$3,$4) ON CONFLICT(query_id,url) DO UPDATE SET document_id=COALESCE(EXCLUDED.document_id,intel_corpus_discoveries.document_id),version=COALESCE(EXCLUDED.version,intel_corpus_discoveries.version),seen_at=now()',[queryId,url,m?.id??null,m?.version??null])}
  async shouldFetch(url:string,queryId?:string){const old=(await this.repo.db.query<{id:string;latest_version:string}>(`SELECT d.id,d.latest_version FROM intel_documents d JOIN intel_versions v ON v.document_id=d.id AND v.version=d.latest_version JOIN intel_corpus_archives a ON a.document_id=v.document_id AND a.version=v.version WHERE d.url=$1 AND v.payload->>'text'<>'' AND v.payload->'source'->>'content_status'='full_text' AND a.fetched_at>now()-interval '7 days'`,[url])).rows[0];if(queryId)await this.discovery(queryId,url,old?{id:old.id,version:old.latest_version}:undefined);return !old}
  async persist(m:Material,raw?:string){const result=await this.disk.persist(m,raw);const fetched=raw!==undefined?new Date().toISOString():Number.isFinite(Date.parse(String(m.source.retrieved_at)))?String(m.source.retrieved_at):'1970-01-01T00:00:00Z';const payload={...result} as Record<string,unknown>;if(raw===undefined)delete payload.raw_sha256;await this.repo.db.query('INSERT INTO intel_corpus_archives(document_id,version,payload,fetched_at) VALUES($1,$2,$3,$4) ON CONFLICT(document_id,version) DO UPDATE SET archived_at=now(),fetched_at=GREATEST(intel_corpus_archives.fetched_at,EXCLUDED.fetched_at),payload=intel_corpus_archives.payload||EXCLUDED.payload',[m.id,m.version,JSON.stringify(payload),fetched]);return result}
  async outcome(id:string,result:unknown){await this.repo.db.query('UPDATE intel_corpus_queries SET result=$2 WHERE id=$1',[id,JSON.stringify(result)])}
  async failed(message:string){const code=/^DEEPSEEK_TOOLS_HTTP_(401|402|403)$/.test(message)?message:'COLLECTION_RETRY_LATER';await this.repo.db.query("UPDATE intel_corpus_campaign SET enabled=CASE WHEN $1='COLLECTION_RETRY_LATER' THEN enabled ELSE false END,error=$1,next_at=now()+interval '15 minutes' WHERE id=1",[code])}
  async snapshot(cursor='',signal?:AbortSignal){
    const entries=(await this.repo.db.query<{payload:Material}>(`SELECT v.payload FROM intel_versions v WHERE v.document_id||'@'||v.version>$1 ORDER BY v.document_id||'@'||v.version LIMIT 26`,[cursor])).rows
    let versions=0,chunks=0,skipped=0
    for(const row of entries.slice(0,25)){signal?.throwIfAborted();if(!row.payload.text.trim()||row.payload.source.content_status==='metadata_only'){skipped++;continue}const r=await this.persist(row.payload);versions++;chunks+=r.chunks}
    return {versions,chunks,skipped,has_more:entries.length>25,next_cursor:entries.slice(0,25).at(-1)?entries.slice(0,25).at(-1)!.payload.id+'@'+entries.slice(0,25).at(-1)!.payload.version:cursor}
  }
  async queueSnapshot(){return (await this.repo.db.query<import('./repository').Job>("SELECT * FROM intel_jobs WHERE kind='corpus_snapshot' AND status IN ('queued','running') LIMIT 1")).rows[0]??this.repo.enqueue('corpus_snapshot','public-corpus-snapshot',{cursor:''})}
}
