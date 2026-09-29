import type { Source } from '../../apps/host/generated/contracts'
import { validate } from '../contracts/validate'
import { hash,canonical,safeUrl,isCurrent,dateOrNull,type Channel,type Entry,type Material } from './domain'
export function materialFromSource(value:unknown,channel?:Channel):Material{
  const source=structuredClone(validate<Source>('Source',value))
  if(source.visibility!=='public'||source.data_class!=='public'||source.synthetic||!source.url)throw new Error('PUBLIC_ORIGINAL_REQUIRED')
  const url=safeUrl(source.url,channel?.domains),text=source.untrusted_text??''
  if(source.hash&&source.hash!==hash(text))throw new Error('SOURCE_HASH_MISMATCH')
  source.hash=hash(text)
  if(source.published_at){const date=dateOrNull(source.published_at);if(date)source.published_at=date;else{delete source.published_at;source.date_status='undated'}}
  if(text.length>100000)throw new Error('MATERIAL_TOO_LARGE')
  // Observing the same document again is not a content revision or new event.
  source.url=url
  const {retrieved_at:_observed,id:_alias,...stable}=source
  const version=hash(canonical(stable)),id='ID-'+hash(url).slice(0,24)
  return {id,version,title:source.title,url,text,published_at:source.published_at??null,
    channel_id:channel?.id??'project-research',city:channel?.city??'',publisher_group:channel?.publisher_group??new URL(url).hostname,participation:channel?.participation??'research',source:source as unknown as Record<string,unknown>}
}
/** Bridge back to the EXISTING canonical Source; no generated summary becomes source text. */
export function evidenceSource(entry:Material,asOf?:string):Source|null{
  if(entry.participation==='signal_only'||!entry.text||entry.source.content_status==='metadata_only'||(asOf&&!isCurrent(entry,asOf)))return null
  const source=structuredClone(entry.source) as unknown as Source
  // Keep the original source-id suffix so structured record aliases remain resolvable.
  source.id=`INTEL-${entry.version.slice(0,12)}:${source.id}`
  return validate<Source>('Source',source)
}
export function summaryOf(e:Entry){return {id:e.id,version:e.version,title:e.title,url:e.url,published_at:e.published_at,ingested_at:e.ingested_at,
  city:e.analysis.structure.city??e.city,category:e.analysis.structure.category,dimensions:e.analysis.structure.dimensions,
  status:e.analysis.status,selected:e.analysis.selected,event_id:e.event_id,story_id:e.story_id,relation:e.relation,
  publisher_group:e.publisher_group,channel_id:e.channel_id,date_status:e.source.date_status??'undated',content_status:e.source.content_status,
  summary:e.analysis.status==='ready'?e.analysis.structure.summary:null,score:e.analysis.score}}
