import { createHash } from 'node:crypto'
import { isIP } from 'node:net'
import { getPath, renderTemplate, lexicalSimilarity, selection, type Relation } from '../../vendor/aihot/algorithms'

export const VERSION = 'jiangong-intelligence-v1'
export const CATEGORIES = ['planning','land','procurement','construction','operations','market','enterprise','risk','other'] as const
export type Category = typeof CATEGORIES[number]
export const DIMENSIONS = ['implementation','adaptation','demand','supply','operations','resources'] as const
export const KINDS = ['rss','web_list','json_list','native_search','external'] as const
export type Kind = typeof KINDS[number]
export type Channel = {
  id: string; name: string; kind: Kind; url: string; domains: string[]; publisher_group: string;
  city: string; config: Record<string, string>; enabled: boolean; interval_minutes: number;
  participation: 'research'|'signal_only'; first_party: boolean;
}
export interface Material { id: string; version: string; title: string; url: string; text: string; published_at: string | null; channel_id: string; city: string; publisher_group: string; source: Record<string, unknown>; participation?: 'research'|'signal_only' }
export interface Structure {
  category: Category; dimensions: string[]; subject: string | null; action: string | null; object: string | null;
  object_id: string | null; occurred_at: string | null; effective_at: string | null; city: string | null;
  locator_quote: string | null; summary: string; tags: string[];
}
export interface Analysis {
  status: 'unscored'|'ready'|'needs_review'|'irrelevant'|'failed'; prefilter: 'PASS'|'BLOCK'|'UNKNOWN';
  structure: Structure; scores: number[]; selected: boolean; score: number | null; disagreement: number | null;
  threshold?: number; prompt_version: string; model: string | null; issue: string | null;
}
export type Entry = Material & { analysis: Analysis; event_id: string; story_id: string; relation: Relation; ingested_at: string }
export type Query = { q?: string; city?: string; category?: string; as_of?: string; limit?: number; offset?: number }
export const hash = (v: string): string => createHash('sha256').update(v).digest('hex')
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']'
  if (v && typeof v === 'object') return '{' + Object.entries(v).sort(([a],[b])=>a.localeCompare(b,'en')).map(([k,x])=>JSON.stringify(k)+':'+canonical(x)).join(',') + '}'
  return JSON.stringify(v) ?? 'null'
}
export function safeUrl(value: string, domains?: string[]): string {
  const u = new URL(value)
  const h = u.hostname.toLowerCase().replace(/\.$/,'')
  if (!['https:','http:'].includes(u.protocol) || u.username || u.password || u.port || isIP(h) || h.includes(':') || !h.includes('.') || /(^|\.)(localhost|local|internal|test|invalid)$/.test(h)) throw new Error('UNSAFE_SOURCE_URL')
  if ([...u.searchParams.keys()].some(k=>/^(token|key|api_key|password|secret|authorization)$/i.test(k))) throw new Error('CREDENTIAL_IN_SOURCE_URL')
  if (domains && !domains.some(d=>h===d || h.endsWith('.'+d))) throw new Error('SOURCE_DOMAIN_MISMATCH')
  u.hash=''; for (const k of [...u.searchParams.keys()]) if (/^utm_|^(fbclid|gclid)$/i.test(k)) u.searchParams.delete(k)
  return u.href
}
const allowedConfig: Record<Kind,string[]> = {
  rss: [], web_list:['itemSelector','linkSelector','titleSelector','dateSelector'],
  json_list:['itemsPath','titlePath','urlTemplate','datePath'], native_search:['query'], external:[],
}
export function channelOf(value: unknown): Channel {
  if (!value || typeof value!=='object' || Array.isArray(value)) throw new Error('INVALID_CHANNEL')
  const x=value as Record<string,unknown>
  const kind=x.kind as Kind
  if (!KINDS.includes(kind)) throw new Error('INVALID_CHANNEL_KIND')
  const str=(key:string,max:number,fallback='')=>{const s=x[key]??fallback;if(typeof s!=='string'||s.length>max)throw new Error('INVALID_CHANNEL_'+key);return s.trim()}
  const name=str('name',100),url=safeUrl(str('url',2000)),id=str('id',80,'CH-'+hash(url).slice(0,20))
  if(!name||!/^[\w-]{3,80}$/.test(id))throw new Error('INVALID_CHANNEL_ID')
  const domains=Array.isArray(x.domains)?x.domains:[new URL(url).hostname]
  if(!domains.length||domains.length>5||domains.some(d=>typeof d!=='string'||!/^([a-z0-9-]+\.)+[a-z]{2,}$/i.test(d)))throw new Error('INVALID_DOMAINS')
  safeUrl(url,domains as string[])
  const config=x.config??{};if(!config||typeof config!=='object'||Array.isArray(config))throw new Error('INVALID_CHANNEL_CONFIG')
  for(const [k,v]of Object.entries(config))if(!allowedConfig[kind].includes(k)||typeof v!=='string'||v.length>500)throw new Error('UNSUPPORTED_CHANNEL_CONFIG')
  const c=config as Record<string,string>
  if(kind==='web_list'&&!c.itemSelector)throw new Error('ITEM_SELECTOR_REQUIRED')
  if(kind==='json_list'&&(!c.titlePath||!c.urlTemplate))throw new Error('JSON_MAPPING_REQUIRED')
  if(kind==='native_search'&&(!c.query||/[\r\n<>]/.test(c.query)))throw new Error('SEARCH_QUERY_REQUIRED')
  const interval=x.interval_minutes??120
  if(typeof interval!=='number'||!Number.isInteger(interval)||interval<30||interval>10080)throw new Error('INVALID_INTERVAL')
  if(x.participation!==undefined&&!['research','signal_only'].includes(String(x.participation)))throw new Error('INVALID_PARTICIPATION')
  return {id,name,kind,url,domains:(domains as string[]).map(d=>d.toLowerCase()),publisher_group:str('publisher_group',120,new URL(url).hostname),city:str('city',80),config:c,
    enabled:x.enabled===true,interval_minutes:interval,participation:x.participation==='signal_only'?'signal_only':'research',first_party:x.first_party===true}
}
export function dateOrNull(value: unknown): string|null {
  if(typeof value!=='string'||!value.trim())return null
  const normalized=value.trim().replace(/年|月/g,'-').replace(/日/g,'')
  const calendar=normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:T|\s|$)/)
  if(calendar){const y=Number(calendar[1]),m=Number(calendar[2]),d=Number(calendar[3]),check=new Date(Date.UTC(y,m-1,d));if(check.getUTCFullYear()!==y||check.getUTCMonth()!==m-1||check.getUTCDate()!==d)return null}
  const t=Date.parse(normalized);return Number.isFinite(t)?new Date(t).toISOString():null
}
export function emptyStructure(title=''): Structure {return {category:'other',dimensions:[],subject:null,action:null,object:null,object_id:null,occurred_at:null,effective_at:null,city:null,locator_quote:null,summary:title,tags:[]}}
export function unscored(title=''): Analysis {return {status:'unscored',prefilter:'UNKNOWN',structure:emptyStructure(title),scores:[],selected:false,score:null,disagreement:null,prompt_version:VERSION,model:null,issue:null}}
export function structureOf(value: unknown, original: string): Structure {
  if(!value||typeof value!=='object')throw new Error('INVALID_STRUCTURE')
  const x=value as Record<string,unknown>,out=emptyStructure()
  if(!CATEGORIES.includes(x.category as Category))throw new Error('INVALID_CATEGORY')
  out.category=x.category as Category
  for(const k of ['subject','action','object','object_id','city','locator_quote'] as const){const v=x[k];if(v!==null&&v!==undefined&&(typeof v!=='string'||v.length>500))throw new Error('INVALID_STRUCTURE_FIELD');out[k]=typeof v==='string'&&v.trim()?v.trim():null}
  if(out.locator_quote&&!original.includes(out.locator_quote))throw new Error('QUOTE_NOT_IN_SOURCE')
  if(out.object_id&&(!out.locator_quote||!out.locator_quote.includes(out.object_id)))throw new Error('OBJECT_ID_NOT_IN_QUOTE')
  if(out.city&&(!out.locator_quote||!out.locator_quote.includes(out.city)))throw new Error('CITY_NOT_IN_QUOTE')
  // Extracted identities require a source quote; the model never assigns a map coordinate.
  if(!out.locator_quote){out.object_id=null;out.city=null}
  for(const k of ['occurred_at','effective_at'] as const){
    const date=dateOrNull(x[k]);out[k]=null
    if(date){const [y,m,d]=date.slice(0,10).split('-');const pattern=new RegExp(`${y}[年/.-]0?${Number(m)}[月/.-]0?${Number(d)}(?:日|\\b)`);if(pattern.test(original))out[k]=date}
  }
  if(typeof x.summary!=='string'||x.summary.length>500)throw new Error('INVALID_SUMMARY')
  out.summary=x.summary
  out.dimensions=Array.isArray(x.dimensions)?[...new Set(x.dimensions.filter((v):v is string=>typeof v==='string'&&DIMENSIONS.includes(v as typeof DIMENSIONS[number])))].slice(0,6):[]
  out.tags=Array.isArray(x.tags)?x.tags.filter((v):v is string=>typeof v==='string'&&v.length<50).slice(0,8):[]
  return out
}
export function finishAnalysis(label: Analysis['prefilter'], structure: Structure, scores: number[], model: string, threshold=65): Analysis {
  if(label==='BLOCK')return {...unscored(),status:'irrelevant',prefilter:label,structure,model}
  const s=selection(scores,threshold)
  return {status:label==='UNKNOWN'||s.disagreement>20?'needs_review':'ready',prefilter:label,structure,scores,threshold,selected:label==='PASS'&&s.selected&&s.disagreement<=20,score:s.score,disagreement:s.disagreement,prompt_version:VERSION,model,issue:s.disagreement>20?'SCORER_DISAGREEMENT':null}
}
export function isCurrent(m: Material, at: string, requireVerified=true): boolean {
  const cutoff=Date.parse(at.length===10?at+'T23:59:59.999Z':at),published=Date.parse(m.published_at??''),expires=Date.parse(String(m.source.expires_at??''))
  return Number.isFinite(cutoff)&&Number.isFinite(published)&&published<=cutoff&&(!requireVerified||m.source.date_status==='verified')&&(!m.source.expires_at||(Number.isFinite(expires)&&expires>cutoff))
}
/** Bounded Chinese/English index tokens. Retrieval quality is evaluated separately from model judgement. */
export function searchTokens(text:string):string[] {
  const words=Array.from(new Intl.Segmenter('zh-CN',{granularity:'word'}).segment(text.toLowerCase())).filter(p=>p.isWordLike).map(p=>p.segment)
  const out=new Set<string>()
  for(const word of words){if(!/^[\p{L}\p{N}]+$/u.test(word))continue;out.add(word)
    if(/^[\p{Script=Han}]+$/u.test(word)&&word.length>2)for(let i=0;i<word.length-1;i++)out.add(word.slice(i,i+2))}
  return [...out].slice(0,16000)
}
export function searchExpression(text:string):string { return searchTokens(text).slice(0,32).join(' | ') }
export function queryScore(m: Material, q: string): number {
  const terms=searchTokens(q).slice(0,32),title=m.title.toLowerCase(),body=m.text.toLowerCase()
  if(!terms.length)return 0
  // AIHOT pool.ts field-weighted lexical baseline. This is deliberately not advertised as vector search.
  return terms.reduce((s,t)=>s+(title.includes(t)?6:0)+(body.includes(t)?1:0),0)+lexicalSimilarity(q,m.title)
}
export function rankEntries(entries: Entry[], query: Query): Entry[] {
  const at=query.as_of?(query.as_of.length===10?query.as_of+'T23:59:59.999Z':query.as_of):new Date().toISOString(),q=query.q?.trim()??''
  return entries.filter(e=>e.analysis.status!=='irrelevant'&&(!query.category||e.analysis.structure.category===query.category)&&
    (!query.city||e.city===query.city||e.analysis.structure.city===query.city||(!e.city&&!e.analysis.structure.city&&e.text.includes(query.city)))&&(!e.published_at||Date.parse(e.published_at)<=Date.parse(at))&&
    (!q||queryScore(e,q)>0.5)).sort((a,b)=>queryScore(b,q)-queryScore(a,q)||(b.published_at??b.ingested_at).localeCompare(a.published_at??a.ingested_at)||a.id.localeCompare(b.id))
}
export function pairCompatible(a: Structure,b: Structure): boolean {
  if(a.city&&b.city&&a.city!==b.city)return false
  if(a.object_id&&b.object_id&&a.object_id!==b.object_id)return false
  return true
}
export function mappedJson(data: unknown, channel: Channel): {title:string;url:string;published_at:string|null}[] {
  const rows=getPath(data,channel.config.itemsPath??'')
  if(!Array.isArray(rows))throw new Error('SOURCE_SCHEMA_CHANGED')
  const out=[]
  for(const row of rows.slice(0,100)){const title=getPath(row,channel.config.titlePath),url=renderTemplate(channel.config.urlTemplate,row)
    if(typeof title!=='string'||!title.trim()||!url)continue
    try{out.push({title:title.trim().slice(0,240),url:safeUrl(new URL(url,channel.url).href,channel.domains),published_at:dateOrNull(getPath(row,channel.config.datePath??''))})}catch{continue}}
  if(rows.length&&!out.length)throw new Error('SOURCE_SCHEMA_CHANGED')
  return out
}
