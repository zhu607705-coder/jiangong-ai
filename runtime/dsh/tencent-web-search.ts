import {createHash,randomUUID} from 'node:crypto'
import type {WebSearchRequest,WebSearchResult} from '@deepseek-ai/dsh-web'
import {safePublicUrl} from '../../packages/research/public-sources'
import type {WebCallReceipt} from './deepseek-web-tools'

export const TENCENT_SEARCH_ENDPOINT='https://api.wsa.cloud.tencent.com/SearchPro'
export type TencentSearchSettings={key:()=>string;maxSearchRequests:number;timeoutMs?:number;edition?:'auto'|'lite'|'standard'|'flagship';industry?:''|'gov'|'news'|'acad'|'finance';record:(receipt:WebCallReceipt)=>Promise<void>;onReceipt?:(receipt:WebCallReceipt)=>Promise<void>}
type Search=Pick<{search:(request:WebSearchRequest,signal?:AbortSignal)=>Promise<WebSearchResult>},'search'>
const clean=(value:unknown,max:number)=>typeof value==='string'?value.replace(/<[^>]*>/g,'').slice(0,max):''

export function tencentSearchPayload(request:WebSearchRequest,edition:TencentSearchSettings['edition']='auto',industry:TencentSearchSettings['industry']=''){
  let Query=request.query.replace(/[\r\n<>]/g,' ').trim()
  if(!Query)throw Error('SEARCH_QUERY_EMPTY')
  if([...Query].length>2000)throw Error('SEARCH_QUERY_TOO_LONG')
  const sites=[...Query.matchAll(/(?:^|\s)site:([a-z0-9.-]+)(?=\s|$)/gi)]
  const Site=sites.length===1&&!/\bOR\b|\|/i.test(Query)?sites[0][1].toLowerCase():undefined
  if(Site)Query=Query.replace(sites[0][0],' ').trim()||Site
  const extended=edition==='standard'||edition==='flagship'
  return {Query,...(Site?{Site}:{}),...(extended?{Cnt:Math.max(10,Math.min(50,Math.ceil((request.maxResults||10)/10)*10)),...(industry?{Industry:industry}:{})}:{})}
}

/** SearchPro content is a dynamic snippet, never a fetched original or RAG body. */
export function tencentSearchSources(pages:unknown,maxResults=10):WebSearchResult{
  if(!Array.isArray(pages))throw Error('TENCENT_WSA_SCHEMA')
  const sources:WebSearchResult['sources'][number][]=[]
  for(const item of pages){
    let row:any;try{row=typeof item==='string'?JSON.parse(item):item}catch{continue}
    if(!row||typeof row!=='object')continue
    const url=safePublicUrl(row.url);if(!url||sources.some(s=>s.url===url))continue
    const date=clean(row.date,80)
    sources.push({url,title:clean(row.title,600),snippet:clean(row.content||row.passage,4000),...(date&&Number.isFinite(Date.parse(date))?{publishedAt:date}:{})})
  }
  const count=Math.max(1,Math.min(50,maxResults))
  return {sources:sources.slice(0,count),truncated:sources.length>count}
}

export class TencentWebSearch {
  readonly id='tencent-wsa'
  private uses=0
  private bypass:string|undefined
  constructor(private settings:TencentSearchSettings,private fallback:Search,private transport:typeof fetch=fetch){}
  available(){return true} // Missing key has an explicit fallback; no fake Tencent success.
  private async record(receipt:WebCallReceipt){await this.settings.record(receipt);await this.settings.onReceipt?.(receipt)}
  async search(request:WebSearchRequest,signal?:AbortSignal):Promise<WebSearchResult>{
    signal?.throwIfAborted()
    const body=tencentSearchPayload(request,this.settings.edition,this.settings.industry)
    const key=this.settings.key(),id=randomUUID(),started=Date.now()
    let receipt:WebCallReceipt={id,operation:'search',provider:this.id,request_hash:createHash('sha256').update(JSON.stringify(body)).digest('hex'),status:null,outcome:'in_flight',billing_state:'unknown',duration_ms:0,attempt:1,result_count:0,estimated_cny:0.026}
    let reserved=false,dispatched=false,diagnostic=''
    try{
      if(!key)throw Error('TENCENT_WSA_NOT_CONFIGURED')
      if(this.bypass)throw Error(this.bypass)
      if(this.uses>=this.settings.maxSearchRequests)throw Error('TENCENT_WSA_REQUEST_LIMIT')
      // A persistent shared reservation must succeed BEFORE the actual wire request.
      await this.settings.record(receipt);reserved=true
      await this.settings.onReceipt?.(receipt)
      signal?.throwIfAborted();this.uses++;dispatched=true
      const response=await this.transport(TENCENT_SEARCH_ENDPOINT,{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json; charset=utf-8'},body:JSON.stringify(body),redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(this.settings.timeoutMs??7000)]):AbortSignal.timeout(this.settings.timeoutMs??7000)})
      receipt={...receipt,status:response.status}
      const raw=await response.text();if(raw.length>2_000_000)throw Error('TENCENT_WSA_RESPONSE_TOO_LARGE')
      if(!response.ok)throw Error('TENCENT_WSA_HTTP_'+response.status)
      const data=JSON.parse(raw)?.Response
      if(typeof data?.RequestId==='string')receipt.request_id=data.RequestId.slice(0,100)
      if(data?.Error){const category=String(data.Error.Code||'').split('.')[0];throw Error('TENCENT_WSA_'+(['InternalError','InvalidParameter','RequestLimitExceeded','ResourceNotFound','ResourceUnavailable','UnauthorizedOperation','AuthFailure'].includes(category)?category:'API_ERROR'))}
      const result=tencentSearchSources(data?.Pages,request.maxResults)
      if(typeof data.Version==='string')receipt.service_version=data.Version.slice(0,30)
      receipt.estimated_cny=data.Version==='lite'?0.014:data.Version==='standard'?0.020:0.026
      receipt={...receipt,outcome:result.sources.length?'received':'empty',billing_state:'unknown',duration_ms:Date.now()-started,result_count:result.sources.length}
      await this.record({...receipt,...(!result.sources.length?{fallback:'deepseek-tools',error_code:'TENCENT_WSA_EMPTY'}:{})})
      if(result.sources.length)return result
      return this.fallback.search(request,signal)
    }catch(error){
      // Do not record raw provider error bodies or fetch exceptions (may contain secrets).
      diagnostic=error instanceof Error&&/^(TENCENT_WSA_|SEARCH_)/.test(error.message)?error.message:'TENCENT_WSA_TRANSPORT'
      // One failed provider should not add another timeout to every query in this round.
      if(/TRANSPORT|HTTP_4|Unauthorized|ResourceNot|ResourceUnavailable|RequestLimit|MONTHLY_LIMIT|QUOTA_UNAVAILABLE/.test(diagnostic))this.bypass=diagnostic
      receipt={...receipt,outcome:dispatched&&receipt.status===null?'unknown_outcome':'failed',billing_state:dispatched?'unknown':'expected_free',duration_ms:Date.now()-started,estimated_cny:dispatched?0.026:0,error_code:diagnostic,fallback:signal?.aborted?'cancelled':'deepseek-tools'}
      if(reserved)await this.record(receipt)
      else await this.settings.onReceipt?.(receipt)
      signal?.throwIfAborted()
      return this.fallback.search(request,signal)
    }
  }
}
