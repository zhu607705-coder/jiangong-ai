import type { DimensionEvidence, MapScreenContext, PublicRecord, Source } from '../../apps/host/generated/contracts'
import { publicSourceClass, sourceCurrentAt } from './public-sources'
import provinces from '@province-city-china/province'
import cities from '@province-city-china/city'
import areas from '@province-city-china/area'

export const normalizedName=(text:string)=>text.normalize('NFKC').replace(/[\s\p{P}\p{S}]/gu,'').toLowerCase()
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
  const subject=normalizedName(name)
  const withoutName=subject?location.normalize('NFKC').replace(new RegExp([...subject].join('[\\s\\p{P}\\p{S}]*'),'giu'),'\uFFFC'):location
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
export function objectQuoteMatches(source:Source,context:MapScreenContext,name:string,quote:string,records:PublicRecord[]=[],recordId?:string):boolean {
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
    if(!nativeIds.includes(context.target.object_ref||'')&&!normalizedName(record.subject).includes(subject))return false
    return record.fields.some(f=>f.value!==null&&f.raw.includes(quote)&&(['buyer','supplier','owner','assignee'].includes(f.key)||!wrongLocation(quote,context,name)))
  }
  if(wrongLocation(quote,context,name))return false
  const bound=source.object_refs?.length===1&&source.object_refs[0]===context.target.object_ref
  return source.untrusted_text!.includes(quote)&&(bound||normalizedName(quote).includes(subject))
}
export function eligibleDimension(source:Source,context:MapScreenContext,name:string,evidence:DimensionEvidence,records:PublicRecord[]):boolean {
  if(!primaryObjectSource(source,context))return false
  if(!objectQuoteMatches(source,context,name,evidence.quote,records,evidence.record_id))return false
  return dimensionCurrentAt(source,name,evidence,records,context.created_at)
}
function deadlineTime(value:unknown):number {
  const raw=String(value??''),date=raw.match(/(\d{4})[年/.-](\d{1,2})[月/.-](\d{1,2})/),time=raw.match(/(\d{1,2})[时点:](\d{1,2})?(?:[分:](\d{1,2})秒?)?/)
  if(!date)return NaN
  const calendar=new Date(Date.UTC(Number(date[1]),Number(date[2])-1,Number(date[3])))
  if(calendar.getUTCFullYear()!==Number(date[1])||calendar.getUTCMonth()!==Number(date[2])-1||calendar.getUTCDate()!==Number(date[3]))return NaN
  if(/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(raw))return Date.parse(raw)
  return Date.parse(`${date[1]}-${date[2].padStart(2,'0')}-${date[3].padStart(2,'0')}T${time?time[1].padStart(2,'0'):'23'}:${time?(time[2]||'0').padStart(2,'0'):'59'}:${time?(time[3]||'0').padStart(2,'0'):'59'}+08:00`)
}
function recordFamily(record:PublicRecord,records:PublicRecord[]):PublicRecord[]{
  const identity=(r:PublicRecord)=>r.fields.find(f=>['project_id','parcel_id'].includes(f.key)&&f.value!==null)
  const lot=(r:PublicRecord)=>r.fields.find(f=>f.key==='lot_id')?.value
  const key=identity(record),selectedLot=lot(record)
  return records.filter(other=>{
    if(other.source_id!==record.source_id||other.adapter!==record.adapter||other.scope!=='object')return false
    const otherKey=identity(other),otherLot=lot(other)
    if(selectedLot&&otherLot&&selectedLot!==otherLot)return false
    return key?!!otherKey&&key.key===otherKey.key&&key.value===otherKey.value:!otherKey&&normalizedName(record.subject)===normalizedName(other.subject)
  })
}
/** Resolve only explicit before/after relationships, never table order or latest date. */
function currentWindow(records:PublicRecord[],asOf:string):boolean {
  const deadlines:number[]=[],replacements=new Map<number,number>()
  for(const record of records){
    const originals=record.fields.filter(f=>f.key==='deadline')
    const before=record.fields.filter(f=>f.key==='deadline_previous'),after=record.fields.filter(f=>f.key==='deadline_corrected')
    if(before.length||after.length){
      if(before.length!==1||after.length!==1)return false
      const from=deadlineTime(before[0].value),to=deadlineTime(after[0].value)
      if(!Number.isFinite(from)||!Number.isFinite(to)||replacements.has(from)&&replacements.get(from)!==to)return false
      if(from!==to)replacements.set(from,to)
      deadlines.push(from,to)
    }
    for(const field of originals){const value=deadlineTime(field.value);if(!Number.isFinite(value))return false;deadlines.push(value)}
  }
  if(!deadlines.length)return !records.some(record=>record.fields.some(field=>field.key==='opening_at'))
  const effective=new Set<number>()
  for(let deadline of deadlines){
    const seen=new Set<number>()
    while(replacements.has(deadline)){
      if(seen.has(deadline))return false
      seen.add(deadline);deadline=replacements.get(deadline)!
    }
    effective.add(deadline)
  }
  return effective.size===1&&[...effective][0]>Date.parse(asOf)
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
    const selected=records.filter(r=>r.source_id===source.id&&(evidence.record_id?r.id===evidence.record_id:normalizedName(r.subject).includes(normalizedName(name))))
    const applicable=[...new Map(selected.flatMap(record=>recordFamily(record,records)).map(record=>[record.id,record])).values()]
    if(!currentWindow(applicable,asOf))return false
  }
  return true
}
