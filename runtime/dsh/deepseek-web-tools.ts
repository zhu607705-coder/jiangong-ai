import {createHash,randomUUID} from 'node:crypto'
import type {WebSearchRequest,WebSearchResult,WebFetchRequest,WebFetchResult} from '@deepseek-ai/dsh-web'
import {safePublicUrl} from '../../packages/research/public-sources'
import type {SourceRepresentation} from '../../apps/host/generated/contracts'
export type WebCallReceipt={id:string;operation:'search'|'fetch';provider:string;request_hash:string;status:number|null;outcome:'in_flight'|'received'|'empty'|'failed'|'unknown_outcome';billing_state:'expected_charge'|'expected_free'|'unknown';duration_ms:number;attempt:number;result_count:number;estimated_cny:number|null;fallback?:string}
type Legacy={search:(request:WebSearchRequest,signal?:AbortSignal)=>Promise<WebSearchResult>;fetch:(request:WebFetchRequest,signal?:AbortSignal)=>Promise<WebFetchResult>}
export type FetchRepresentation=WebFetchResult&{representation?:SourceRepresentation;quality_warnings?:string[]}
const digest=(text:string)=>createHash('sha256').update(text).digest('hex')
export function deepSeekRetryDelay(value:string|null,attempt:number,now=Date.now()){
  const seconds=value===null?NaN:Number(value),date=value===null?NaN:Date.parse(value)
  const serverDelay=Number.isFinite(seconds)?seconds*1000:Number.isFinite(date)?date-now:0
  return Math.min(60000,Math.max(350*2**(attempt-1),serverDelay))
}
const rateTails=new Map<string,Promise<void>>(),lastStart=new Map<string,number>(),domainTails=new Map<string,Promise<void>>()
function waitFor(promise:Promise<void>,signal?:AbortSignal){return new Promise<void>((resolve,reject)=>{const abort=()=>reject(signal?.reason||new Error('ABORTED'));signal?.addEventListener('abort',abort,{once:true});promise.then(resolve,reject).finally(()=>signal?.removeEventListener('abort',abort));if(signal?.aborted)abort()})}
function delay(ms:number,signal?:AbortSignal){return new Promise<void>((resolve,reject)=>{const done=()=>{signal?.removeEventListener('abort',abort);resolve()},timer=setTimeout(done,ms),abort=()=>{clearTimeout(timer);reject(signal?.reason||new Error('ABORTED'))};signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort()})}
async function rate(kind:string,signal?:AbortSignal){const previous=rateTails.get(kind)||Promise.resolve();let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve});rateTails.set(kind,previous.then(()=>gate));try{await waitFor(previous,signal);await delay(Math.max(0,(lastStart.get(kind)||0)+220-Date.now()),signal);lastStart.set(kind,Date.now())}finally{release()}}
export function compileSearchQueries(query:string):string[]{
  const text=query.replace(/[\r\n<>]/g,' ').trim();if(!text)throw new Error('SEARCH_QUERY_EMPTY')
  const tokens=text.match(/"[^"]*"|\S+/g)||[],result:string[]=[];let part=''
  const anchor=tokens.slice(0,2).join(' '),prefix=[...anchor].length<64?anchor:''
  for(const token of tokens){if([...token].length>128)throw new Error('SEARCH_QUERY_TOKEN_TOO_LONG');const next=[part,token].filter(Boolean).join(' ');if([...next].length>128){result.push(part);part=[prefix,token].filter(Boolean).join(' ');if([...part].length>128)part=token}else part=next}
  if(part)result.push(part);return result
}
export class DeepSeekWebTools {
  readonly id='deepseek-tools';readonly receipts:WebCallReceipt[]=[]
  private contents=new Map<string,{title:string;content:string}>()
  private searchRequests=0
  constructor(private settings:{key:()=>string;includeContent:boolean;maxSearchRequests:number;onReceipt?:(receipt:WebCallReceipt)=>Promise<void>},private legacy?:Legacy,private transport:typeof fetch=fetch){}
  available(){return !!this.settings.key()}
  private async record(value:WebCallReceipt){const index=this.receipts.findIndex(row=>row.id===value.id);if(index<0)this.receipts.push(value);else this.receipts[index]=value;await this.settings.onReceipt?.(value)}
  private async recordFallback(operation:'search'|'fetch',body:unknown,fallback:string){
    const hash=digest(JSON.stringify(body)),receipt=[...this.receipts].reverse().find(row=>row.operation===operation&&row.request_hash===hash)
    if(receipt)await this.record({...receipt,fallback})
  }
  private async request(operation:'search'|'fetch',body:unknown,signal?:AbortSignal):Promise<any>{
    const hash=digest(JSON.stringify(body)),key=this.settings.key();if(!key)throw new Error('DEEPSEEK_TOOLS_NOT_CONFIGURED')
    for(let attempt=1;attempt<=3;attempt++){
      signal?.throwIfAborted();await rate(operation,signal)
      if(operation==='search'){if(this.searchRequests>=this.settings.maxSearchRequests)throw new Error('DEEPSEEK_TOOLS_SEARCH_BUDGET');this.searchRequests++}
      const started=Date.now(),receiptId=randomUUID();let status:number|null=null
      await this.record({id:receiptId,operation,provider:this.id,request_hash:hash,status:null,outcome:'in_flight',billing_state:'unknown',duration_ms:0,attempt,result_count:0,estimated_cny:null})
      try{
        const response=await this.transport(`https://api.deepseek.com/v1/tools/${operation}`,{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json','User-Agent':'haizhizi-research/0.3'},body:JSON.stringify(body),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(25000)]):AbortSignal.timeout(25000)})
        status=response.status
        if(!response.ok){await response.body?.cancel();await this.record({id:receiptId,operation,provider:this.id,request_hash:hash,status,outcome:'failed',billing_state:'expected_free',duration_ms:Date.now()-started,attempt,result_count:0,estimated_cny:0});if((status===408||status===429||status>=500&&status<=599)&&attempt<3){await delay(deepSeekRetryDelay(response.headers.get('Retry-After'),attempt),signal);continue}throw new Error(`DEEPSEEK_TOOLS_HTTP_${status}`)}
        const raw=await response.text();if(raw.length>2_000_000)throw new Error('DEEPSEEK_TOOLS_RESPONSE_TOO_LARGE')
        const data=JSON.parse(raw),count=operation==='search'?(Array.isArray(data.results)?data.results.length:0):typeof data.content==='string'&&data.content.trim()?1:0
        if(operation==='search'&&!Array.isArray(data.results)||operation==='fetch'&&typeof data.content!=='string')throw new Error('DEEPSEEK_TOOLS_SCHEMA')
        await this.record({id:receiptId,operation,provider:this.id,request_hash:hash,status,outcome:count?'received':'empty',billing_state:count?'expected_charge':'expected_free',duration_ms:Date.now()-started,attempt,result_count:count,estimated_cny:count ? 0.005 : 0});return data
      }catch(error){if(status===null||status===200)await this.record({id:receiptId,operation,provider:this.id,request_hash:hash,status,outcome:'unknown_outcome',billing_state:'unknown',duration_ms:Date.now()-started,attempt,result_count:0,estimated_cny:null});throw error}
    }
  }
  async search(request:WebSearchRequest,signal?:AbortSignal):Promise<WebSearchResult>{
    const sources:WebSearchResult['sources'][number][]=[],queries=compileSearchQueries(request.query)
    for(const query of queries){
      if(this.searchRequests>=this.settings.maxSearchRequests){if(sources.length)return {sources:sources.slice(0,request.maxResults||10),truncated:true};throw new Error('DEEPSEEK_TOOLS_SEARCH_BUDGET')}
      const body={query,count:Math.max(1,Math.min(50,request.maxResults||10)),need_content:this.settings.includeContent,...([...request.query].length<=128?{ori_question:request.query}:{})}
      try{
        const data=await this.request('search',body,signal)
        for(const result of data.results){const url=safePublicUrl(result.url);if(!url||sources.some(row=>row.url===url))continue;if(typeof result.content==='string'&&result.content.trim())this.contents.set(url,{title:result.title||'',content:result.content});sources.push({url,title:String(result.title||''),snippet:String(result.snippet||''),...(result.date?{publishedAt:String(result.date)}:{})})}
      }catch(error){
        if(signal?.aborted)throw error
        if(this.legacy&&!/HTTP_4\d\d|SEARCH_BUDGET/.test(String(error))){const result=await this.legacy.search({query,maxResults:request.maxResults},signal);sources.push(...result.sources);await this.recordFallback('search',body,'legacy-search')}else throw error
      }
    }
    return {sources:sources.slice(0,request.maxResults||10),truncated:sources.length>(request.maxResults||10)}
  }
  async fetch(request:WebFetchRequest,signal?:AbortSignal):Promise<FetchRepresentation>{
    const url=safePublicUrl(request.url);if(!url||[...url].length>8192)throw new Error('UNSAFE_SOURCE_URL')
    const host=new URL(url).hostname,previous=domainTails.get(host)||Promise.resolve();let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve});domainTails.set(host,previous.then(()=>gate))
    try{await waitFor(previous,signal)
      signal?.throwIfAborted()
      if(/\.pdf(?:$|[?#])/i.test(url)&&this.legacy)return this.legacy.fetch(request,signal)
      const cached=this.settings.includeContent?this.contents.get(url):null
      let data:any
      try{data=cached||await this.request('fetch',{url},signal)}catch(error){if(this.legacy&&!signal?.aborted&&!/HTTP_403/.test(String(error))){const original=await this.legacy.fetch(request,signal);await this.recordFallback('fetch',{url},'original-http');return {...original,quality_warnings:['FETCH_API_UNAVAILABLE_ORIGINAL_HTTP']}}throw error}
      const raw=String(data.content||''),kind=cached?'search_content':'deepseek_markdown'
      if(!raw.trim())return {url,statusCode:404,body:{kind:'text',content:''},truncated:false}
      const warnings:string[]=[]
      if(raw.length<120)warnings.push('BODY_SHORT')
      if(/\|/.test(raw)&&/金额|预算|中标|结算/.test(raw)&&!/^\s*\|?.*\|.*\|/m.test(raw))warnings.push('TABLE_STRUCTURE_UNCLEAR')
      if(warnings.length&&this.legacy){try{const original=await this.legacy.fetch(request,signal);if(original.statusCode===200&&original.body.content.length>raw.length)return {...original,quality_warnings:[...warnings,'USED_ORIGINAL_HTTP']}}catch{signal?.throwIfAborted()}}
      const sha256=digest(raw),representation:SourceRepresentation={id:'REP-'+sha256,kind,sha256,origin_hash:null,extractor:cached?'deepseek-search-content-v1':'deepseek-fetch-v1',received_at:new Date().toISOString(),offset_encoding:'UTF-16'}
      return {url,statusCode:200,body:{kind:'text',content:raw.slice(0,80000)},truncated:raw.length>80000,representation,quality_warnings:warnings}
    }finally{release()}
  }
}
