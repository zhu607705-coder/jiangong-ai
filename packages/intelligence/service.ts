import type {ProjectRecord} from '../../apps/host/store'
import { randomUUID } from 'node:crypto'
import type { Store } from '../../apps/host/store'
import { config } from '../../apps/host/config'
import { projectInput } from '../contracts/validate'
import type { Source } from '../../apps/host/generated/contracts'
import { IntelRepository,type Review,type Job } from './repository'
import { channelOf,rankEntries,hash,canonical,type Channel,type Query,type Entry } from './domain'
import { materialFromSource,evidenceSource,summaryOf } from './material'
import { collectChannel } from './collectors'
import { analyzeMaterial } from './pipeline'
import { intelligenceJudge,intelligenceRoutes } from '../../runtime/intelligence/judge'
import { installIntelligenceHooks,type IntelligenceOrigin } from './research-bridge'
import { datasetRows,evaluateSelection } from './evaluation'
import { momentum } from '../../vendor/aihot/algorithms'
import { PUBLIC_SOURCES } from '../research/public-sources'
import {localOfficialStructure,localAnalysis} from './local-structure'
import {projectArchiveOriginals} from './project-archive'
import {projectObjectLocation} from '../retrofit/object-binding'
import {administrativeAddress} from '../research/evidence'
import {retrievalScopeNames,queryObjectLocated} from '../experience/retrieval'
import {CorpusCampaign} from './campaign'
import {createPublicWebTools,ensureHarnessNetwork} from '../../runtime/dsh/public-web'
import type {ResearchWeb} from '../../services/capabilities/research'
import {intelligenceDailyModelBudget} from './model-budget'

export class IntelligenceService {
  readonly repo:IntelRepository
  readonly ready:Promise<void>
  readonly campaign:CorpusCampaign
  private busy=false
  private stopped=false
  private active:{id:string;controller:AbortController}|undefined
  private timer:ReturnType<typeof setInterval>|undefined
  private uninstall:(()=>void)|undefined
  private jobHandlers=new Map<string,(job:Job,signal:AbortSignal)=>Promise<{pending:boolean;progress:boolean}>>()
  registerJobHandler(kind:'rag_index'|'topic_compile',handler:(job:Job,signal:AbortSignal)=>Promise<{pending:boolean;progress:boolean}>){this.jobHandlers.set(kind,handler)}
  constructor(readonly store:Store){this.repo=new IntelRepository(store.db);this.campaign=new CorpusCampaign(this.repo,config.dataDir);this.ready=this.initialize()}
  private async initialize(){
    await this.repo.initialize()
    await this.campaign.initialize()
    const known=new Set((await this.repo.channels()).map(c=>c.payload.id))
    // Search-backed official catalogue templates, not invented RSS endpoints or live coverage claims.
    for(const s of PUBLIC_SOURCES){const id='catalog-'+s.id;if(!known.has(id))await this.repo.saveChannel(channelOf({id,name:s.name,kind:'native_search',url:'https://'+s.domain,domains:[s.domain],publisher_group:s.domain,city:'',config:{query:'存量建筑 改造 建设 项目'},enabled:false,interval_minutes:180,first_party:true}))}
    if(this.stopped)return
    this.uninstall=installIntelligenceHooks({webCall:r=>this.campaign.recordProvider(r),lookup:(r,s)=>this.lookup(r,s),remember:(s,c,o)=>this.remember(s,c,o),revision:async r=>hash(canonical((await this.repo.entries(r.city,200,undefined,r.name+' '+r.purpose,r.asOf)).entries.map(e=>[e.id,e.version,e.participation]).sort()))})
    this.timer=setInterval(()=>{void this.tick().catch(()=>console.warn('INTELLIGENCE_WORKER_FAILED'))},5000);this.timer.unref()
  }
  async stop(){this.stopped=true;if(this.timer)clearInterval(this.timer);this.active?.controller.abort();this.uninstall?.();await this.ready.catch(()=>undefined);if(this.timer)clearInterval(this.timer);while(this.busy)await new Promise(resolve=>setTimeout(resolve,20))}
  async tick(){
    if(this.busy||this.stopped)return
    this.busy=true
    try{
      await this.campaign.schedule()
      await this.repo.resumeBudget(intelligenceDailyModelBudget())
      if(process.env.INTELLIGENCE_COLLECTION_ENABLED==='true')for(const c of await this.repo.due())await this.repo.enqueue('collect',c.id,{model:process.env.INTELLIGENCE_MODEL_ENABLED==='true',channel:c})
      const job=await this.repo.claim();if(!job)return
      const controller=new AbortController(),signal=AbortSignal.any([controller.signal,AbortSignal.timeout(180000)]);this.active={id:job.id,controller}
      try{
        if(job.kind==='corpus_snapshot'){
          const result=await this.campaign.snapshot(String(job.payload.cursor||''),signal)
          signal.throwIfAborted();await this.repo.jobResult(job.id,result);await this.repo.endJob(job.id,'completed')
          if(result.has_more)await this.repo.enqueue('corpus_snapshot','public-corpus-snapshot:'+result.next_cursor,{cursor:result.next_cursor})
        }else if(job.kind==='corpus_collect'){
          await this.collectCorpus(job,signal)
        }else if(job.kind==='archive'){
          const result=await this.syncExisting(String(job.payload.cursor||''),Number(job.payload.analyze_remaining||0),signal)
          signal.throwIfAborted()
          await this.repo.jobResult(job.id,result);await this.repo.endJob(job.id,'completed')
          if(result.has_more)await this.repo.enqueue('archive',String(job.payload.run_id)+':'+result.next_cursor,{run_id:job.payload.run_id,cursor:result.next_cursor,analyze_remaining:Math.max(0,Number(job.payload.analyze_remaining||0)-result.queued)})
        }else if(job.kind==='rag_index'||job.kind==='topic_compile'){
          const handler=this.jobHandlers.get(job.kind)
          if(!handler)throw new Error('RAG_INDEX_HANDLER_UNAVAILABLE')
          const result=await handler(job,signal)
          signal.throwIfAborted();await this.repo.endJob(job.id,result.pending?'partial':'completed')
          if(result.pending&&result.progress)await this.repo.enqueue(job.kind,job.subject,job.payload)
        }else if(job.kind==='collect'){
          const c=job.payload.channel?channelOf(job.payload.channel):await this.repo.channel(job.subject);if(!c)throw new Error('CHANNEL_NOT_FOUND')
          const result=await collectChannel(c,signal,async source=>{
            await this.ingest(source,c.id,{analyze:job.payload.model===true})
          })
          signal.throwIfAborted();const ok=result.failed===0
          await this.repo.channelResult(c,ok,ok?null:'PARTIAL_SOURCE_FETCH')
          await this.repo.endJob(job.id,ok?'completed':'partial',ok?null:`FAILED_DOCUMENTS:${result.failed}`)
        }else{
          if(!config.modelConfigured)throw new Error('BLOCKED_EXTERNAL_MODEL')
          const m=await this.repo.get(String(job.payload.id),String(job.payload.version));if(!m)throw new Error('DOCUMENT_VERSION_NOT_FOUND')
          await analyzeMaterial(this.repo,m,intelligenceJudge,signal,config.DEEPSEEK_MODEL,process.env.INTELLIGENCE_REVIEW_MODEL,intelligenceDailyModelBudget(),intelligenceRoutes(),Number(process.env.INTELLIGENCE_SELECTION_THRESHOLD||65))
          signal.throwIfAborted();await this.repo.endJob(job.id,'completed')
        }
      }catch(e){const msg=e instanceof Error?e.message:'INTELLIGENCE_JOB_FAILED'
        const code=/^[A-Z][A-Z0-9_:]+$/.test(msg)?msg:'INTELLIGENCE_JOB_FAILED'
        if(code==='INTELLIGENCE_BUDGET_EXHAUSTED')await this.repo.deferBudget(job.id)
        else await this.repo.endJob(job.id,signal.aborted?'cancelled':code.startsWith('BLOCKED')?'blocked_external':'failed',code)
        if(job.kind==='collect'){const c=job.payload.channel?channelOf(job.payload.channel):await this.repo.channel(job.subject);if(c)await this.repo.channelResult(c,false,code)}
        if(job.kind==='corpus_collect'){await this.campaign.outcome(job.subject,{status:'failed',code});if(!['CAMPAIGN_PAUSED','CAMPAIGN_DAILY_LIMIT'].includes(code))await this.campaign.failed(code)}
      }finally{this.active=undefined}
    }finally{this.busy=false}
  }
  private async collectCorpus(job:Job,signal:AbortSignal){
    if(!config.searchConfigured)throw Error('BLOCKED_EXTERNAL_SEARCH')
    await this.campaign.disk.capacity()
    const q=await this.campaign.query(job.subject);if(!q)throw Error('CAMPAIGN_QUERY_NOT_FOUND')
    await this.repo.saveChannel(q.channel)
    await ensureHarnessNetwork()
    const web=createPublicWebTools({maxSearchUses:3,onReceipt:r=>this.campaign.record(r)})
    let created=0,chunks=0,archived=0,metadata=0,queued=0
    const result=await collectChannel(q.channel,signal,async(source,raw)=>{
      signal.throwIfAborted()
      const stored=await this.ingest(source,q.channel.id,{analyze:false});created+=Number(stored.created)
      const m=await this.repo.get(stored.id,stored.version);if(!m)throw Error('DOCUMENT_VERSION_NOT_FOUND')
      if(!m.text.trim()||m.source.content_status==='metadata_only'){metadata++;return}
      const r=await this.campaign.persist(m,raw);chunks+=r.chunks;archived++
      await this.campaign.discovery(q.id,m.url,m)
      // Paid organisation keeps the existing40/day cap; never queue a model turn for every hit.
      if(!queued&&stored.created&&config.modelConfigured&&process.env.INTELLIGENCE_MODEL_ENABLED==='true'&&m.analysis.status==='unscored'){
        const pending=(await this.repo.db.query<{n:number}>("SELECT count(*)::int AS n FROM intel_jobs WHERE kind='analyze' AND status IN ('queued','running')")).rows[0].n
        if(pending<6){await this.repo.enqueue('analyze',m.id+'@'+m.version,{id:m.id,version:m.version});queued++}
      }
    },web as unknown as ResearchWeb,{query:q.query,maxResults:20,validate_network:true,shouldFetch:url=>this.campaign.shouldFetch(url,q.id)})
    signal.throwIfAborted()
    const receipt={...result,created,archived,chunks,metadata,queued,query:q.query,calls:web.receipts}
    await this.campaign.outcome(q.id,receipt);await this.repo.jobResult(job.id,receipt);await this.repo.endJob(job.id,result.failed?'partial':'completed')
    const auth=web.receipts.find(r=>r.provider==='deepseek-tools'&&r.status&&[401,402,403].includes(r.status));if(auth)await this.campaign.failed('DEEPSEEK_TOOLS_HTTP_'+auth.status)
    else if(result.failed&&!result.saved&&!result.skipped)await this.campaign.failed('COLLECTION_RETRY_LATER')
  }
  async configureCampaign(value:Parameters<CorpusCampaign['configure']>[0]){await this.ready;await this.campaign.configure(value);if(!value.enabled&&this.active){const j=(await this.repo.db.query<Job>('SELECT * FROM intel_jobs WHERE id=$1',[this.active.id])).rows[0];if(j?.kind==='corpus_collect')await this.cancel(j.id)}}
  async syncExisting(cursor='',analyzeLimit=0,signal?:AbortSignal) {await this.ready
    const projects=(await this.store.db.query<ProjectRecord>('SELECT * FROM projects WHERE owner_id=$1 AND id>$2 ORDER BY id LIMIT 11',[config.ownerId,cursor])).rows
    let seen=0,created=0,linked=0,queued=0,skipped=0
    const skip_reasons:Record<string,number>={}
    const queuedVersions=new Set<string>()
    for(const p of projects.slice(0,10)){
      signal?.throwIfAborted()
      if(p.input.synthetic)continue
      const sources=await projectArchiveOriginals(this.store,p)
      for(const row of sources){const s=row.source
        signal?.throwIfAborted()
        try{
          if(!s.url||!s.untrusted_text?.trim()||s.content_status==='metadata_only')throw Error('ORIGINAL_BODY_OR_URL_MISSING')
          const location=projectObjectLocation(p.input.scope),m=materialFromSource(s);m.city=administrativeAddress(s.title).city||(s.evidence_scope==='background'?'':location.city||'')
          const added=await this.repo.put(m,row.origin==='project_input');created+=Number(added);seen++
          if(added){const local=localOfficialStructure(m);if(local)await this.repo.saveLocalAnalysis(m.id,m.version,localAnalysis(local))}
          linked+=Number(await this.repo.linkProject({owner_id:p.owner_id,project_id:p.id,context_version:row.context_version,source_id:s.id,document_id:m.id,version:m.version,origin:row.origin,origin_id:row.origin_id}))
          const key=m.id+'@'+m.version
          if(queued<Math.min(8,Math.max(0,analyzeLimit))&&!queuedVersions.has(key)&&config.modelConfigured){const entry=await this.repo.get(m.id,m.version);if(entry&&entry.analysis.status==='unscored'){await this.repo.enqueue('analyze',key,{id:m.id,version:m.version});queuedVersions.add(key);queued++}}
        }catch(error){skipped++;const code=error instanceof Error&&/^[A-Z_]+$/.test(error.message)?error.message:'ARCHIVE_SOURCE_FAILED';skip_reasons[code]=(skip_reasons[code]||0)+1}
      }
    }
    return {seen,created,linked,queued,skipped,skip_reasons,has_more:projects.length>10,next_cursor:projects.slice(0,10).at(-1)?.id||cursor}
  }
  async queueArchive(analyzeLimit=0){await this.ready;const run_id='archive-'+config.ownerId;const active=(await this.repo.db.query<Job>("SELECT * FROM intel_jobs WHERE kind='archive' AND payload->>'run_id'=$1 AND status IN ('queued','running') ORDER BY created_at LIMIT 1",[run_id])).rows[0];if(active)return active;const job=await this.repo.enqueue('archive',run_id,{run_id,cursor:'',analyze_remaining:Math.min(8,Math.max(0,analyzeLimit))});void this.tick().catch(()=>console.warn('INTELLIGENCE_ARCHIVE_JOB_FAILED'));return job}
  async search(q:Query){await this.ready;const loaded=await this.repo.entries(q.city,400,q.as_of,q.q),all=rankEntries(loaded.entries,{...q,city:undefined}).filter(entry=>queryObjectLocated(q.q||'',entry.title+'\n'+entry.text)),limit=Math.min(40,Math.max(1,q.limit??20)),offset=Math.min(380,Math.max(0,q.offset??0))
    if(!q.q?.trim())all.sort((a,b)=>Number(b.analysis.status==='ready')-Number(a.analysis.status==='ready'))
    const groups=new Map<string,Entry[]>()
    for(const e of all){const g=groups.get(e.event_id)||[];g.push(e);groups.set(e.event_id,g)}
    const events=[...groups].map(([id,items])=>({id,story_id:items[0].story_id,representative:summaryOf(items[0]),items:items.map(summaryOf),
      momentum:momentum(items.map(e=>({group:e.publisher_group,at:e.source.date_status==='verified'?e.published_at:null})),Date.now()),
      source_channels:new Set(items.map(e=>e.publisher_group)).size}))
    return {items:events.slice(offset,offset+limit),total_in_window:events.length,truncated:loaded.truncated,scope:q,mode:'postgres_fts_event_grouped',generated_at:new Date().toISOString()}
  }
  async ingest(value:unknown,channelId?:string,options:{analyze?:boolean}={}){await this.ready;const c=channelId?await this.repo.channel(channelId):undefined;if(channelId&&!c)throw new Error('CHANNEL_NOT_FOUND');const m=materialFromSource(value,c),created=await this.repo.put(m)
    if(created){const local=localOfficialStructure(m);if(local)await this.repo.saveLocalAnalysis(m.id,m.version,localAnalysis(local))}
    if(created&&m.text&&config.modelConfigured&&(options.analyze??process.env.INTELLIGENCE_MODEL_ENABLED==='true'))await this.repo.enqueue('analyze',m.id+'@'+m.version,{id:m.id,version:m.version})
    return {id:m.id,version:m.version,created}
  }
  async organize(id:string,version:string){await this.ready
    const entry=await this.repo.get(id,version);if(!entry)throw new Error('DOCUMENT_VERSION_NOT_FOUND')
    if(entry.analysis.model||entry.analysis.selected||entry.analysis.score!==null||entry.analysis.scores.length||!['unscored','needs_review'].includes(entry.analysis.status))return {status:'already_analyzed'}
    const local=localOfficialStructure(entry);if(!local)return {status:'not_supported'}
    const analysis=localAnalysis(local)
    if(canonical(entry.analysis)===canonical(analysis)||await this.repo.saveLocalAnalysis(id,version,analysis))return {status:'organized',issue:analysis.issue}
    return {status:'already_analyzed'}
  }
  async archiveOriginal(id:string,version:string){await this.ready
    const original=await this.repo.get(id,version),current=await this.repo.get(id)
    if(!original||!current)throw Error('DOCUMENT_VERSION_NOT_FOUND')
    if(current.source.visibility!=='public'||current.source.data_class!=='public'||current.source.synthetic)throw Error('PUBLIC_ORIGINAL_REQUIRED')
    return this.campaign.persist(original)
  }
  async cancel(id:string){await this.ready;if(this.active?.id===id)this.active.controller.abort();await this.repo.cancel(id)}
  async attach(id:string,version:string,projectId:string,expected:string){await this.ready
    const entry=await this.repo.get(id,version);if(!entry)throw new Error('DOCUMENT_NOT_FOUND')
    const source=evidenceSource(entry);if(!source)throw new Error('ORIGINAL_BODY_REQUIRED')
    return this.store.db.transaction(async db=>{
      const p=(await db.query<{input:unknown;context_version:number}>('SELECT input,context_version FROM projects WHERE id=$1 AND owner_id=$2 FOR UPDATE',[projectId,config.ownerId])).rows[0]
      if(!p)throw new Error('PROJECT_NOT_FOUND')
      const current=projectInput(p.input)
      if(current.sources.some(s=>s.id===source.id&&s.hash===source.hash))return {status:'already_attached'}
      if(hash(canonical(current))!==expected)throw new Error('PROJECT_VERSION_CONFLICT')
      const next=projectInput({...current,sources:[...current.sources,source]})
      // No Fact or ContextRule is invented and no running snapshot/report is overwritten.
      await db.query('UPDATE projects SET input=$2,context_version=context_version+1,updated_at=now() WHERE id=$1',[projectId,JSON.stringify(next)])
      return {status:'attached',source_id:source.id}
    })
  }
  private async lookup(request:{name:string;city?:string;purpose:string;asOf:string},signal:AbortSignal){await this.ready;signal.throwIfAborted()
    const entries=(await this.repo.entries(request.city,200,undefined,request.name+' '+request.purpose,request.asOf)).entries
    const place=request.name.replace(/(?:研究范围|片区|街区)$/,'').trim()
    const names=retrievalScopeNames([place])
    const eligible=rankEntries(entries,{q:place+' '+request.purpose,as_of:request.asOf})
      .filter(e=>e.analysis.status!=='irrelevant'&&names.some(name=>e.title.includes(name)||e.text.includes(name)))
    const sources=eligible.flatMap(e=>{const s=evidenceSource(e,request.asOf);return s?[s]:[]}).slice(0,20)
    if(!sources.length)return []
    // The existing jieba/BM25/RETQA/STORM capability remains the single research lexical retriever.
    try{
      const project=projectInput({schema_version:'2.0',project_id:'INTELLIGENCE-RETRIEVAL',synthetic:false,purpose:request.purpose,mode:'automatic',role:'investment_manager',as_of:request.asOf.slice(0,10),
        scope:{name:request.name,city:request.city,geometry:null,coordinate_encoding:'WGS84',legal_parcel_confirmed:false},facts:[],sources,context_rules:[],candidate_ids:['defer_and_investigate'],events:[]})
      const r=await fetch(config.capabilityUrl+'/capabilities/retrieval.query',{method:'POST',headers:{'Content-Type':'application/json','X-Capability-Token':config.capabilityToken},body:JSON.stringify({project,query:request.name+' '+request.purpose,include_internal:false}),signal})
      if(!r.ok)throw new Error('BM25_UNAVAILABLE')
      const out=await r.json() as {matches:{source_id:string}[]},byId=new Map(sources.map(s=>[s.id,s]))
      return out.matches.flatMap(m=>{const s=byId.get(m.source_id);return s?[s]:[]}).slice(0,5)
    }catch{signal.throwIfAborted();return sources.slice(0,5)}
  }
  private async remember(sources:Source[],city?:string,origin?:IntelligenceOrigin){await this.ready
    const project=origin?await this.store.project(origin.project_id,config.ownerId):null
    for(const s of sources){if(s.synthetic||s.visibility!=='public'||s.data_class!=='public'||!s.url||!s.untrusted_text?.trim()||s.content_status==='metadata_only')continue
      try{
        const prefix=s.id.match(/^INTEL-([a-f0-9]{12}):/)
        const known=prefix?(await this.repo.db.query<{document_id:string;version:string}>("SELECT v.document_id,v.version FROM intel_versions v JOIN intel_documents d ON d.id=v.document_id WHERE v.version LIKE $1 AND d.url=$2 AND v.payload->>'text'=$3 LIMIT 1",[prefix[1]+'%',s.url,s.untrusted_text])).rows[0]:undefined
        let identity=known
        if(!prefix){const m=materialFromSource(s);m.city=administrativeAddress(s.title).city||(s.evidence_scope==='background'?'':city||'');const created=await this.repo.put(m);identity={document_id:m.id,version:m.version};if(created){const local=localOfficialStructure(m);if(local)await this.repo.saveLocalAnalysis(m.id,m.version,localAnalysis(local));if(config.modelConfigured&&process.env.INTELLIGENCE_MODEL_ENABLED==='true')await this.repo.enqueue('analyze',m.id+'@'+m.version,{id:m.id,version:m.version})}}
        if(identity&&project&&!project.input.synthetic&&origin&&Number.isSafeInteger(origin.context_version)&&origin.context_version>=0)await this.repo.linkProject({owner_id:project.owner_id,project_id:project.id,context_version:origin.context_version,source_id:s.id,...identity,origin:'research_discovery',origin_id:hash(s.url+'|'+s.untrusted_text)})
      }catch{console.warn('INTELLIGENCE_SOURCE_ARCHIVE_SKIPPED')}}
  }
  async review(r:Omit<Review,'reviewer'|'reviewed_at'>){await this.ready
    const e=await this.repo.get(r.document_id,r.version);if(!e)throw new Error('DOCUMENT_VERSION_NOT_FOUND')
    const review={...r,reviewer:config.ownerId,reviewed_at:new Date().toISOString()}
    const existing=(await this.repo.reviews()).filter(x=>!(x.document_id===r.document_id&&x.version===r.version))
    // Validate cross-split family conflicts before saving, including previous versions.
    const versions=await Promise.all([...existing,review].map(x=>this.repo.get(x.document_id,x.version)))
    datasetRows(versions.filter((x):x is Entry=>x!==null),[...existing,review],'local_eval')
    await this.repo.saveReview(review);return {status:'saved'}
  }
  async evaluate(split:Review['split']){const r=await this.repo.reviews(),entries=await Promise.all(r.map(x=>this.repo.get(x.document_id,x.version)));return evaluateSelection(entries.filter((x):x is Entry=>!!x),r,split)}
  async dataset(purpose:'local_eval'|'local_sft'){const r=await this.repo.reviews(),entries=await Promise.all(r.map(x=>this.repo.get(x.document_id,x.version)));return datasetRows(entries.filter((x):x is Entry=>!!x),r,purpose)}
}
