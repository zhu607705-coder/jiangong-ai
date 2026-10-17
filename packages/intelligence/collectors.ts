/** AIHOT source-family adapters, with host-owned DSH transport and existing original-page parser. */
import { Context } from '@deepseek-ai/cordis'
import { DOMParser,parseHTML } from 'linkedom'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { mountPublicWeb } from '../../runtime/dsh/public-web'
import { visibleText,type ResearchWeb } from '../../services/capabilities/research'
import { adaptOfficialSource } from '../../services/capabilities/adapters/public-records'
import type { Source } from '../../apps/host/generated/contracts'
import { safeUrl,mappedJson,dateOrNull,hash,type Channel } from './domain'

export function publicAddress(ip:string):boolean{
  if(isIP(ip)===4){const a=ip.split('.').map(Number);return !(a[0]===0||a[0]===10||a[0]===127||a[0]>=224||a[0]===169&&a[1]===254||a[0]===172&&a[1]>=16&&a[1]<=31||a[0]===192&&a[1]===168||a[0]===100&&a[1]>=64&&a[1]<=127||a[0]===198&&[18,19].includes(a[1]))}
  // Fail closed for IPv4-mapped and non-global IPv6; DSH remains the HTTP transport guard.
  return isIP(ip)===6&&/^[23]/i.test(ip)&&!/^2001:db8:/i.test(ip)
}
async function validateNetwork(url:string){const u=new URL(safeUrl(url)),addresses=await lookup(u.hostname,{all:true});if(!addresses.length||addresses.some(a=>!publicAddress(a.address)))throw new Error('NON_PUBLIC_SOURCE_ADDRESS')}
export interface Link {title:string;url:string;published_at:string|null}
export function listLinks(raw:string,channel:Channel):Link[]{
  if(channel.kind==='json_list')return mappedJson(JSON.parse(raw),channel)
  const xml=channel.kind==='rss'
  const doc=xml?new DOMParser().parseFromString(raw,'text/xml'):parseHTML(raw).document
  const selector=xml?'item,entry':channel.config.itemSelector
  let nodes:Element[]
  try{nodes=Array.from(doc.querySelectorAll(selector)) as unknown as Element[]}catch{throw new Error('INVALID_SOURCE_SELECTOR')}
  if(!nodes.length&&raw.trim()&&!(xml&&doc.querySelector('rss,feed')))throw new Error('SOURCE_SCHEMA_CHANGED')
  const out:Link[]=[]
  for(const n of nodes.slice(0,100)){
    const link=n.querySelector(xml?'link':channel.config.linkSelector||'a')
    const href=link?.getAttribute('href')||link?.textContent||''
    const title=(n.querySelector(xml?'title':channel.config.titleSelector||'a')?.textContent||'').trim()
    const date=n.querySelector(xml?'pubDate,published,updated':channel.config.dateSelector||'time')
    if(!title||!href)continue
    try{out.push({title:title.slice(0,240),url:safeUrl(new URL(href.trim(),channel.url).href,channel.domains),published_at:dateOrNull(date?.getAttribute('datetime')||date?.textContent)})}catch{continue}
  }
  if(nodes.length&&!out.length)throw new Error('SOURCE_SCHEMA_CHANGED')
  return [...new Map(out.map(x=>[x.url,x])).values()]
}
export async function collectChannel(channel:Channel,signal:AbortSignal,onSource:(s:Source)=>Promise<void>,injected?:ResearchWeb):Promise<{saved:number;failed:number}>{
  if(channel.kind==='external')return {saved:0,failed:0}
  const ctx=injected?null:new Context();let web=injected,saved=0,failed=0
  try{
    if(ctx){await mountPublicWeb(ctx,{maxRedirects:0,provider:'legacy'});web=ctx.web as unknown as ResearchWeb}
    const get=async(url:string)=>{signal.throwIfAborted();safeUrl(url,channel.domains);if(!injected)await validateNetwork(url);const r=await web!.fetch({url},signal);if(r.statusCode<200||r.statusCode>=300)throw new Error('SOURCE_HTTP_'+r.statusCode);return r}
    let links:Link[]
    if(channel.kind==='native_search'){
      const query=`${channel.city} ${channel.config.query} site:${channel.domains[0]}`.trim()
      const hits=await web!.search({query,maxResults:8},signal)
      links=hits.sources.flatMap(h=>{try{return [{title:(h.title||h.url).slice(0,240),url:safeUrl(h.url,channel.domains),published_at:dateOrNull(h.publishedAt)}]}catch{return []}})
    }else{const page=await get(channel.url);if(page.truncated)throw new Error('SOURCE_LIST_TRUNCATED');links=listLinks(page.body.content,channel)}
    for(const hit of links.slice(0,10)){
      signal.throwIfAborted()
      try{
        const page=await get(hit.url),raw=page.body.content
        // Do not feed a binary PDF to an HTML parser or claim it was successfully read.
        if(raw.startsWith('%PDF'))throw new Error('SOURCE_REQUIRES_EXISTING_FILE_PARSER')
        const rawDate=raw.match(/(?:发布时间|发布日期|公告时间)[^\d]{0,12}(\d{4}[年/-]\d{1,2}[月/-]\d{1,2})|(?:name|property)=["'](?:PubDate|pubdate|publishdate|article:published_time)["'][^>]*content=["']([^"']+)/i)
        const published=dateOrNull(rawDate?.[1]||rawDate?.[2]),text=page.body.kind==='html'?visibleText(raw,hit.url):raw.slice(0,30000)
        const source:Source={id:'INTAKE-'+hash(hit.url).slice(0,20),title:hit.title,url:hit.url,data_class:'public',visibility:'public',synthetic:false,
          retrieved_at:new Date().toISOString(),content_status:page.truncated||raw.length>30000?'excerpt':'full_text',untrusted_text:text,hash:hash(text),raw_hash:hash(raw),body_truncated:!!page.truncated,
          date_status:published?(hit.published_at&&published.slice(0,10)!==hit.published_at.slice(0,10)?'conflict':'verified'):hit.published_at?'search_only':'undated'}
        if(published||hit.published_at)source.published_at=published||hit.published_at!
        if(hit.published_at)source.search_published_at=hit.published_at
        const adapted=adaptOfficialSource({...source,untrusted_text:raw})
        if(adapted.receipt.status==='access_required'||!text){source.content_status='metadata_only';source.untrusted_text='';source.hash=hash('')}
        source.public_records=source.content_status==='metadata_only'?[]:adapted.records.slice(0,50)
        source.records_truncated=adapted.records.length>50||adapted.receipt.status==='truncated'
        await onSource(source);saved++
      }catch{signal.throwIfAborted();failed++}
    }
    return {saved,failed}
  }finally{if(ctx)await ctx.fiber.dispose()}
}
