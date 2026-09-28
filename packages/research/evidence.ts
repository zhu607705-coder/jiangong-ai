import type { DimensionEvidence, MapScreenContext, PublicRecord, Source } from '../../apps/host/generated/contracts'
import { publicSourceClass, sourceCurrentAt } from './public-sources'
import provinces from '@province-city-china/province'
import cities from '@province-city-china/city'
import areas from '@province-city-china/area'

import { normalizedName } from '../maps/object-identity'
import { currentWindow, recordFamily } from './record-window'
import { markObjectName, ownObjectClaim } from './claim-object'
export { normalizedName } from '../maps/object-identity'
// A versioned lexical reference, not a geocoder or proof of an object's identity.
// Prefixes must be actual administrative names: arbitrary prose ending in 区/市
// (e.g. “校区” or “按照杭州市…”) must not become an address.
const names=(rows:{name:string}[])=>[...new Set(rows.map(row=>row.name))].sort((a,b)=>b.length-a.length)
const provinceNames=names(provinces),cityNames=names(cities),areaNames=names(areas)
const municipalities=new Set(['北京市','上海市','天津市','重庆市'])
function administrativeAddress(text:string){
  let rest=text.trim()
  const province=provinceNames.find(name=>rest.startsWith(name))
  if(province)rest=rest.slice(province.length).trimStart()
  const city=province&&municipalities.has(province)?province:cityNames.find(name=>rest.startsWith(name))
  if(city&&city!==province)rest=rest.slice(city.length).trimStart()
  const district=areaNames.find(name=>rest.startsWith(name))
  return {province,city,district}
}
function wrongLocation(location:string,context:MapScreenContext,name:string):boolean {
  const expected=administrativeAddress(context.address||'')
  expected.city=context.city||expected.city
  // Names may contain administrative-looking suffixes and provider punctuation.
  // Mask the exact selected name without turning its suffix into an address:
  // “紫金港校区东区学生宿舍” describes a campus section, not 攀枝花市东区.
  // Still inspect explicit address clauses, including parentheses and suffixes.
  const withoutName=markObjectName(location,name)
  // Supplier/owner/agency contact data is not the project's physical address.
  // Stop masking at an explicit project-location label, even in the same clause.
  const projectLabel='(?:项目所在地|项目位置|建设地址|建设地点|项目地址|工程地点)'
  const actorLabel='(?:供应商|中标人|成交供应商|采购人|采购单位|代理机构|采购代理机构|建设单位|投标人|承包商|联系人)'
  const projectText=withoutName.replace(new RegExp(actorLabel+'(?:名称|地址|所在地|联系地址)[为在：:\\s]*[^。；;，,\\n]*?(?='+projectLabel+'|[。；;，,\\n]|$)','g'),'\uFFFC')
  const clauses=projectText.replace(/(?:位于|坐落[于在]?|项目所在地|所在地|项目位置|建设地址|建设地点|项目地址|工程地点|地址)[为在：:\s]*/g,'\n').split(/[。；;，,()\[\]\n：:]/)
  return clauses.some(clause=>{
    const actual=administrativeAddress(clause)
    return (['province','city','district'] as const).some(level=>{
      const canonical=(value:string)=>level==='city'?normalizedName(value).replace(/市$/,''):normalizedName(value)
      return expected[level]&&actual[level]&&canonical(expected[level]!)!==canonical(actual[level]!)
    })
  })
}
export function primaryObjectSource(source:Source,context:MapScreenContext):boolean {
  if(source.synthetic||source.data_class!=='public'||source.visibility!=='public'||source.content_status==='metadata_only'||!source.untrusted_text)return false
  if(source.evidence_scope==='area'||source.evidence_scope==='background')return false
  if(source.object_refs&&!source.object_refs.includes(context.target.object_ref||''))return false
  return publicSourceClass(source.url||'')!=='supplementary'||(!source.url&&source.content_status==='uploaded'&&!!source.object_refs?.includes(context.target.object_ref||''))
}
/** A title alone cannot bind a quote taken from another object in the document. */
export function objectQuoteMatches(source:Source,context:MapScreenContext,name:string,quote:string,records:PublicRecord[]=[],recordId?:string,allowVenue=false):boolean {
  const subject=normalizedName(name)
  if(!subject||subject===normalizedName(context.city||''))return false
  if(recordId){
    const record=records.find(r=>r.id===recordId&&r.source_id===source.id)
    if(!record||record.scope!=='object'||!source.raw_hash||record.source_hash!==source.raw_hash)return false
    if(wrongLocation(record.subject,context,name))return false
    const location=record.fields.find(f=>f.key==='location')?.value
    if(typeof location==='string'&&wrongLocation(location,context,name))return false
    const nativeIds=record.fields.filter(f=>f.key==='project_id'||f.key==='parcel_id').map(f=>`${record.adapter}:${f.value}`)
    if(context.target.object_ref?.startsWith(record.adapter+':')&&!nativeIds.includes(context.target.object_ref))return false
    if(!ownObjectClaim(record.subject,name,true,allowVenue))return false
    return record.fields.some(f=>f.value!==null&&f.raw.includes(quote)&&(['buyer','supplier','owner','assignee'].includes(f.key)||!wrongLocation(quote,context,name)))
  }
  if(wrongLocation(quote,context,name))return false
  return source.untrusted_text!.includes(quote)&&ownObjectClaim(quote,name,false,allowVenue)
}
export function eligibleDimension(source:Source,context:MapScreenContext,name:string,evidence:DimensionEvidence,records:PublicRecord[],purpose=''):boolean {
  if(!primaryObjectSource(source,context))return false
  // Event location establishes a use of this venue, not maintenance demand,
  // a procurement right, funding or an operating contract for this building.
  const venueService=/(?:会务|会议|会场)(?:服务|运营)|场地(?:租赁|运营|服务)/.test(purpose)
  const venueBasis=/(?:会务|会议|会场|场地).*(?:使用|需求|服务|运营)|(?:开标|评标).*(?:活动|会场|场地)/.test(evidence.basis)
  const allowVenue=evidence.key==='demand'&&venueService&&venueBasis
  if(!objectQuoteMatches(source,context,name,evidence.quote,records,evidence.record_id,allowVenue))return false
  return dimensionCurrentAt(source,name,evidence,records,context.created_at)
}
/** Reused for scoring and cache reads; the observation clock is not the cache clock. */
export function dimensionCurrentAt(source:Source,name:string,evidence:Pick<DimensionEvidence,'key'|'record_id'>,records:PublicRecord[],asOf:string):boolean {
  if(!sourceCurrentAt(source,asOf))return false
  // Long-lived physical archives can inform adaptation. Other current business
  // conditions need a current observation or an explicit still-active validity.
  const age=Date.parse(asOf)-Date.parse(source.published_at!)
  if(evidence.key!=='adaptation'&&age>180*86400000&&!source.expires_at)return false
  if(evidence.key==='implementation'&&/中标|成交|废标|终止|结果公告/.test(source.title))return false
  if(evidence.key==='implementation'){
    if(source.body_truncated)return false
    const selected=records.filter(r=>r.source_id===source.id&&(evidence.record_id?r.id===evidence.record_id:normalizedName(r.subject).includes(normalizedName(name))))
    // An omitted structured record is not evidence that no business deadline
    // exists. Other dimensions may still use the retained public original.
    if(source.records_truncated&&!selected.length)return false
    const applicable=[...new Map(selected.flatMap(record=>recordFamily(record,records)).map(record=>[record.id,record])).values()]
    if(!currentWindow(applicable,asOf))return false
  }
  return true
}
