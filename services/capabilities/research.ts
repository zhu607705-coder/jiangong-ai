import { Context } from '@deepseek-ai/cordis'
import { Readability } from '@mozilla/readability'
import { parseHTML } from 'linkedom'
import { createHash } from 'node:crypto'
import { mountPublicWeb } from '../../runtime/dsh/public-web'
import type { ProjectInput, ResearchTrace, Source, PublicRecord, AdapterReceipt } from '../../apps/host/generated/contracts'
import type { ProgressSink } from '../../packages/research/events'
import { PUBLIC_SOURCES, publicSourceClass, publicSearchPlan, safePublicUrl } from '../../packages/research/public-sources'
import { recallIntelligence, rememberIntelligence } from '../../packages/intelligence/research-bridge'
import { adaptOfficialSource, officialArticleText, MAX_RESEARCH_RECORDS } from './adapters/public-records'
import { resolveScope } from './scope'
import type {FetchRepresentation,WebCallReceipt} from '../../runtime/dsh/deepseek-web-tools'

export function visibleText(html:string,_url:string):string {
  const official=officialArticleText(html,_url)
  if(official!==null)return official.slice(0,30000)
  const {document}=parseHTML(html)
  document.querySelectorAll('script,style,noscript,iframe,form').forEach(n=>n.remove())
  const article=new Readability(document as unknown as Document,{charThreshold:100}).parse()
  return (article?.textContent||document.body?.textContent||document.documentElement?.textContent||'').replace(/[ \t]+/g,' ').replace(/\n{3,}/g,'\n\n').trim().slice(0,30000)
}
export type ResearchRequest={name:string;city?:string;purpose:string;asOf:string;seedSources?:Source[];intelligence?:boolean;forceDiscovery?:boolean;criticalReview?:boolean;provider?:'legacy'|'deepseek_tools'|'deepseek_content';budget?:{newEvidence?:number;refresh?:number};onWebCall?:(receipt:WebCallReceipt)=>Promise<void>;intelligencePolicy?:{readExisting:boolean;rememberNew:boolean;checkFreshness:boolean}}
export type PublicResearch={sources:Source[];records:PublicRecord[];receipts:AdapterReceipt[];trace:ResearchTrace;web_calls?:WebCallReceipt[]}
type SearchHit={url:string;title?:string;snippet?:string;publishedAt?:string}
// Transport injection keeps contract tests offline; production reuses DSH Web.
export type ResearchWeb={search:(request:{query:string;maxResults:number},signal:AbortSignal)=>Promise<{sources:SearchHit[]}>;fetch:(request:{url:string},signal:AbortSignal)=>Promise<{statusCode:number;body:{kind:string;content:string};truncated?:boolean;representation?:FetchRepresentation['representation'];quality_warnings?:string[]}>}
const rank={database:0,official:1,primary:2,supplementary:3}
function documentDate(raw:string):string|undefined {
  const match=raw.match(/(?:name|property)=["'](?:PubDate|pubdate|publishdate|publish_date|date|article:published_time)["'][^>]*content=["'](\d{4}-\d{2}-\d{2}(?:T[^"']+)?)|(?:发布时间|发布日期|公告时间)[^\d]{0,12}(\d{4}[年/-]\d{1,2}[月/-]\d{1,2})/i)
  if(!match)return undefined
  const value=(match[1]||match[2]).replace(/[年月/]/g,'-').replace(/日/g,'')
  return Number.isFinite(Date.parse(value))?new Date(value).toISOString():undefined
}
export async function collectSelectedEvidence(request:ResearchRequest,signal:AbortSignal,emit:ProgressSink=()=>{},web?:ResearchWeb,plannedQueries?:string[]):Promise<PublicResearch>{
  const ctx=web?null:new Context(),sources:Source[]=[],records:PublicRecord[]=[],receipts:AdapterReceipt[]=[],warnings:string[]=[]
  const name=request.name.replace(/[\r\n<>]/g,' ').trim().slice(0,180)
  let queries=(plannedQueries?.length?plannedQueries:publicSearchPlan(name,request.purpose)).slice(0,6)
  const found=new Map<string,SearchHit>(),queryHits=new Map<string,SearchHit[]>(),seed=(request.seedSources||[]).filter(s=>s.visibility==='public'&&s.data_class==='public'&&!s.synthetic)
  const end=Date.parse(request.asOf.length===10?request.asOf+'T23:59:59.999Z':request.asOf)
  let localCount=0
  const newBudget=Math.max(0,Math.min(12,request.budget?.newEvidence??6)),refreshBudget=Math.max(0,Math.min(4,request.budget?.refresh??2))
  let newCount=0,refreshCount=0,fetchAttempts=0,webMetadata:{provider:string;receipts:WebCallReceipt[]}={provider:'injected',receipts:[]}
  try{
    // Injected transports do not implicitly read a live global corpus in tests/replays.
    const useIntelligence=request.intelligence??!web
    const policy=request.intelligencePolicy||{readExisting:useIntelligence,rememberNew:useIntelligence,checkFreshness:true}
    const local=policy.readExisting?await recallIntelligence(request,signal):[]
    localCount=local.length
    if(local.length){
      emit({type:'progress',stage:'search',status:'running',message:'先读取已沉淀的相关原文'})
      // Skip only a fresh, matching source-domain query. General discovery is retained.
      queries=policy.checkFreshness&&!request.forceDiscovery?queries.filter(q=>{
        const domain=q.match(/site:([\w.-]+)/)?.[1]
        return !domain||!local.some(s=>{const host=s.url?new URL(s.url).hostname:'';return (host===domain||host.endsWith('.'+domain))&&s.untrusted_text&&s.date_status==='verified'&&Date.now()-Date.parse(s.retrieved_at||'')<6*3600000})
      }):queries
    }
    if(ctx){webMetadata=await mountPublicWeb(ctx,{maxSearchUses:queries.length,provider:request.provider,onReceipt:request.onWebCall});web=ctx.web as unknown as ResearchWeb}
    for(const original of [...seed,...local]){
      if(original.published_at&&Date.parse(original.published_at)>end)continue
      if(sources.some(s=>s.id===original.id||(s.url&&s.url===original.url)))continue
      const source=structuredClone(original)
      sources.push(source)
      // Preserve structured records when a Source is handed back from the intelligence store.
      records.push(...(source.public_records||[]).map(r=>({...r,source_id:source.id})))
    }
    emit({type:'progress',stage:'search',status:'running',message:'检索土地、工程与当前运营资料'})
    // Two concurrent native searches; not a second scheduler or a whole-city crawl.
    for(let i=0;i<queries.length;i+=2){
      signal.throwIfAborted()
      await Promise.all(queries.slice(i,i+2).map(async query=>{
        try{const result=await web!.search({query,maxResults:4},signal)
          const hits:SearchHit[]=[]
          for(const hit of result.sources){const url=safePublicUrl(hit.url);if(url&&(!hit.publishedAt||!Number.isFinite(Date.parse(hit.publishedAt))||Date.parse(hit.publishedAt)<=end)){const candidate={...hit,url};found.set(url,candidate);hits.push(candidate)}}
          queryHits.set(query,hits)
        }catch{signal.throwIfAborted();warnings.push('SEARCH_REQUEST_FAILED')}
      }))
    }
    const ranked=[...found.values()].sort((a,b)=>rank[publicSourceClass(a.url)]-rank[publicSourceClass(b.url)])
    const fresh:SearchHit[]=[],domains=new Map<string,number>()
    const eligible=(hit:SearchHit)=>!sources.some(source=>source.url===hit.url)&&!fresh.some(source=>source.url===hit.url)
    const add=(hit:SearchHit)=>{fresh.push(hit);const host=new URL(hit.url).hostname;domains.set(host,(domains.get(host)||0)+1)}
    // Reserve one original per question before filling the global quota. Among
    // equally authoritative remaining hits, prefer a less represented domain.
    for(const query of queries){if(fresh.length>=newBudget)break;const first=(queryHits.get(query)||[]).filter(eligible).sort((a,b)=>rank[publicSourceClass(a.url)]-rank[publicSourceClass(b.url)])[0];if(first)add(first)}
    while(fresh.length<newBudget){const next=ranked.filter(eligible).sort((a,b)=>rank[publicSourceClass(a.url)]-rank[publicSourceClass(b.url)]||(domains.get(new URL(a.url).hostname)||0)-(domains.get(new URL(b.url).hostname)||0)||a.url.localeCompare(b.url))[0];if(!next)break;add(next)}
    const selected=[...fresh,...sources.filter(source=>source.url&&(request.criticalReview||source.content_status==='metadata_only'||source.date_status==='conflict'||Date.now()-Date.parse(source.retrieved_at||'')>6*3600000)).slice(0,refreshBudget).map(source=>({url:source.url!,title:source.title,publishedAt:source.published_at}))]
    // Bounded parallel fetch; source identities are deterministic and retained.
    for(let i=0;i<selected.length;i+=2){
      signal.throwIfAborted()
      const batch=await Promise.all(selected.slice(i,i+2).map(async hit=>{
        const original=sources.find(source=>source.url===hit.url)
        const id=original?.canonical_source_id||original?.id||'PUB-'+createHash('sha256').update(hit.url).digest('hex').slice(0,16)
        const source:Source={id,title:(hit.title||new URL(hit.url).hostname).slice(0,240),url:hit.url,data_class:'public',visibility:'public',synthetic:false,content_status:'metadata_only',untrusted_text:'',retrieved_at:new Date().toISOString(),locator:hit.url,...(hit.publishedAt?{published_at:hit.publishedAt}:{})}
        emit({type:'progress',stage:'fetch',status:'running',message:source.title.slice(0,90),source_id:id})
        try{
          fetchAttempts++
          const response=await web!.fetch({url:hit.url},signal)
          if(response.statusCode<200||response.statusCode>=300)throw Error('SOURCE_HTTP_'+response.statusCode)
          const raw=response.body.content,bodyDate=documentDate(raw)
          source.body_truncated=!!response.truncated
          if(source.body_truncated)warnings.push('SOURCE_BODY_TRUNCATED:'+id)
          if(hit.publishedAt)source.search_published_at=hit.publishedAt.slice(0,100)
          if(bodyDate){
            source.published_at=bodyDate
            source.date_status=hit.publishedAt&&Number.isFinite(Date.parse(hit.publishedAt))&&new Date(hit.publishedAt).toISOString().slice(0,10)!==bodyDate.slice(0,10)?'conflict':'verified'
          }else{
            source.date_status=source.published_at&&Number.isFinite(Date.parse(source.published_at))?'search_only':'undated'
            if(source.date_status==='undated')delete source.published_at
          }
          if(source.date_status==='conflict')warnings.push('SOURCE_DATE_CONFLICT:'+id)
          if(source.published_at&&Date.parse(source.published_at)>end){warnings.push('SOURCE_FUTURE_PUBLICATION:'+id);return null}
          if(response.representation){source.representations=[response.representation];source.representation_id=response.representation.id;if(response.representation.origin_hash)source.raw_hash=response.representation.origin_hash}
          else{source.raw_hash=createHash('sha256').update(raw).digest('hex');const representation={id:'REP-'+source.raw_hash,kind:response.body.kind==='html'?'raw_html' as const:'raw_text' as const,sha256:source.raw_hash,origin_hash:source.raw_hash,extractor:'dsh-http-v1',received_at:source.retrieved_at!,offset_encoding:'UTF-16' as const};source.representations=[representation];source.representation_id=representation.id}
          warnings.push(...(response.quality_warnings||[]).map(warning=>warning+':'+id))
          const adapted=adaptOfficialSource({...source,content_status:'full_text',untrusted_text:raw})
          records.push(...adapted.records);receipts.push(adapted.receipt)
          source.untrusted_text=response.body.kind==='html'?visibleText(raw,hit.url):raw.slice(0,30000)
          if(source.untrusted_text){const usedHash=createHash('sha256').update(source.untrusted_text).digest('hex');const originalRepresentation=source.representations?.[0];const usedRepresentation={id:'REP-'+usedHash,kind:response.representation?.kind||'raw_text' as const,sha256:usedHash,origin_hash:response.representation?.origin_hash||source.raw_hash||null,extractor:response.body.kind==='html'?'readability-public-text-v1':response.representation?.extractor||'dsh-http-text-v1',received_at:source.retrieved_at!,offset_encoding:'UTF-16' as const};source.representations=originalRepresentation&&originalRepresentation.id!==usedRepresentation.id?[originalRepresentation,usedRepresentation]:[usedRepresentation];source.representation_id=usedRepresentation.id}
          // Captcha/login and snippets never masquerade as retrieved factual text.
          source.content_status=adapted.receipt.status==='access_required'?'metadata_only':!source.untrusted_text?'metadata_only':response.truncated||raw.length>30000?'excerpt':'full_text'
          if(source.content_status==='metadata_only')source.untrusted_text=''
          if(source.content_status==='metadata_only')warnings.push('SOURCE_NOT_READ:'+id)
          else if(adapted.receipt.status==='schema_changed')warnings.push('SOURCE_SCHEMA_CHANGED:'+id)
          for(const record of adapted.records)if(!record.period)record.period=source.published_at?.slice(0,10)||''
        }catch{signal.throwIfAborted();warnings.push('SOURCE_FETCH_FAILED:'+id);receipts.push({source_id:id,adapter:PUBLIC_SOURCES.find(s=>hit.url.includes(s.domain))?.id||'none',status:'empty',record_ids:[]})}
        source.hash=createHash('sha256').update(source.untrusted_text||'').digest('hex')
        if(original){if(source.hash===createHash('sha256').update(original.untrusted_text||'').digest('hex'))return null;source.canonical_source_id=id;source.id=id+'-V'+source.hash.slice(0,10);for(const record of records.filter(record=>record.source_id===id&&record.source_hash===source.raw_hash))record.source_id=source.id;refreshCount++}else newCount++
        emit({type:'progress',stage:'fetch',status:source.content_status==='metadata_only'?'partial':'completed',message:source.content_status==='metadata_only'?'原文暂未取得':source.title.slice(0,90),source_id:id})
        return source
      }))
      for(const source of batch)if(source)sources.push(source)
    }
    const ids=new Set(sources.map(s=>s.id)),usable=sources.some(s=>!!s.untrusted_text&&s.content_status!=='metadata_only')
    const finalRecords:PublicRecord[]=[],finalReceipts:AdapterReceipt[]=[]
    for(const source of sources){
      const candidates=source.content_status==='metadata_only'?[]:records.filter(r=>r.source_id===source.id)
      const kept=candidates.slice(0,Math.max(0,MAX_RESEARCH_RECORDS-finalRecords.length))
      finalRecords.push(...kept)
      // The Source is the durable project/document handoff. Its bounded record
      // snapshot survives callers that only retain sources (including projects).
      source.public_records=kept
      if(kept.length<candidates.length){source.records_truncated=true;warnings.push('RECORD_BUDGET_TRUNCATED:'+source.id)}
      const receipt=receipts.find(r=>r.source_id===source.id)
      if(receipt){
        const truncated=receipt.status==='truncated'||kept.length<candidates.length
        source.records_truncated=truncated
        finalReceipts.push({...receipt,status:truncated?'truncated':receipt.status,record_ids:kept.map(r=>r.id)})
        if(truncated)warnings.push('RECORD_BUDGET_TRUNCATED:'+source.id)
      }
    }
    emit({type:'progress',stage:'adapters',status:finalRecords.length&&!warnings.length?'completed':'partial',message:finalRecords.length?'已提取项目、金额与统计口径':'已整理原文依据'})
    if(policy.rememberNew)await rememberIntelligence(sources,request.city)
    return {sources,records:finalRecords,receipts:finalReceipts,web_calls:webMetadata.receipts,trace:{status:usable?(warnings.length?'partial':'success'):'partial',queries,source_ids:[...ids],warnings,reused:localCount>0&&queries.length===0,acquisition:{provider:webMetadata.provider,cached_sources:seed.length+localCount,new_sources:newCount,refreshed_sources:refreshCount,fetch_attempts:fetchAttempts,new_evidence_budget:newBudget,refresh_budget:refreshBudget}}}
  }finally{if(ctx)await ctx.fiber.dispose()}
}

export async function collectPublicEvidence(project:ProjectInput,signal:AbortSignal):Promise<{sources:Source[];trace:ResearchTrace;scope?:ProjectInput['scope']}>{
  if(project.synthetic)return {sources:[],trace:{status:'not_applicable',queries:[],source_ids:[],warnings:[],reused:false}}
  const ctx=new Context()
  try{
    await mountPublicWeb(ctx)
    const resolved=await resolveScope(ctx,project,signal)
    const result=await collectSelectedEvidence({name:project.scope.name,city:project.scope.city,purpose:project.business_profile==='neighborhood'?'老旧小区改造':'存量利用与实施路径',asOf:project.as_of,intelligence:true},signal,undefined,ctx.web as unknown as ResearchWeb)
    if(resolved.source)result.sources.push(resolved.source)
    if(resolved.warning)result.trace.warnings.push(resolved.warning)
    result.trace.source_ids=result.sources.map(s=>s.id)
    return {sources:result.sources,trace:result.trace,scope:resolved.scope}
  }finally{await ctx.fiber.dispose()}
}
