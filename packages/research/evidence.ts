import type { DimensionEvidence, MapScreenContext, PublicRecord, Source } from '../../apps/host/generated/contracts'
import { publicSourceClass, sourceCurrentAt } from './public-sources'

export const normalizedName=(text:string)=>text.normalize('NFKC').replace(/[\s\p{P}\p{S}]/gu,'').toLowerCase()
const district=(address:string,city:string)=>{
  const tail=city&&address.includes(city)?address.slice(address.indexOf(city)+city.length):address
  return tail.match(/^([\p{Script=Han}]{1,8}?(?:区|县|旗))/u)?.[1]
}
function wrongLocation(location:string,context:MapScreenContext):boolean {
  const city=context.city||'',selected=district(context.address||'',city)
  const declared=location.replace(/^.*?(?:位于|坐落于?|项目位置[：:]?|建设地址[：:]?|建设地点[：:]?|项目地址[：:]?|工程地点[：:]?)\s*/,'')
  const province=(text:string)=>text.match(/^([\p{Script=Han}]{2,8}?(?:省|自治区))/u)?.[1]
  const expectedProvince=province(context.address||''),actualProvince=province(declared)
  if(expectedProvince&&actualProvince&&expectedProvince!==actualProvince)return true
  const located=district(declared,city)
  if(selected&&located&&selected!==located)return true
  const cityMatch=declared.match(/^(?:[\p{Script=Han}]{2,8}省)?([\p{Script=Han}]{2,8}?市)/u)?.[1]
  return !!(city&&cityMatch&&normalizedName(city)!==normalizedName(cityMatch))
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
  if(wrongLocation(quote,context))return false
  if(recordId){
    const record=records.find(r=>r.id===recordId&&r.source_id===source.id)
    if(!record||record.scope!=='object'||!source.raw_hash||record.source_hash!==source.raw_hash)return false
    const location=record.fields.find(f=>f.key==='location')?.value
    if(typeof location==='string'&&wrongLocation(location,context))return false
    const nativeIds=record.fields.filter(f=>f.key==='project_id'||f.key==='parcel_id').map(f=>`${record.adapter}:${f.value}`)
    if(context.target.object_ref?.startsWith(record.adapter+':')&&!nativeIds.includes(context.target.object_ref))return false
    if(!nativeIds.includes(context.target.object_ref||'')&&!normalizedName(record.subject).includes(subject))return false
    return record.fields.some(f=>f.value!==null&&f.raw.includes(quote))
  }
  const bound=source.object_refs?.length===1&&source.object_refs[0]===context.target.object_ref
  return source.untrusted_text!.includes(quote)&&(bound||normalizedName(quote).includes(subject))
}
export function eligibleDimension(source:Source,context:MapScreenContext,name:string,evidence:DimensionEvidence,records:PublicRecord[]):boolean {
  if(!primaryObjectSource(source,context)||!sourceCurrentAt(source,context.created_at))return false
  if(!objectQuoteMatches(source,context,name,evidence.quote,records,evidence.record_id))return false
  // Long-lived physical archives can inform adaptation. Other current business
  // conditions need a current observation or an explicit still-active validity.
  const age=Date.parse(context.created_at)-Date.parse(source.published_at!)
  if(evidence.key!=='adaptation'&&age>180*86400000&&!source.expires_at)return false
  if(evidence.key==='implementation'&&/中标|成交|废标|终止|结果公告/.test(source.title))return false
  if(evidence.key==='implementation'){
    const applicable=records.filter(r=>r.source_id===source.id&&(evidence.record_id?r.id===evidence.record_id:normalizedName(r.subject).includes(normalizedName(name))))
    const deadlines=applicable.flatMap(r=>r.fields.filter(f=>f.key==='deadline'))
    if(!deadlines.length&&applicable.some(r=>r.fields.some(f=>f.key==='opening_at')))return false
    for(const field of deadlines){
      const raw=String(field.value??''),date=raw.match(/(\d{4})[年/.-](\d{1,2})[月/.-](\d{1,2})/),time=raw.match(/(\d{1,2})[时点:](\d{1,2})?(?:[分:](\d{1,2})秒?)?/)
      if(!date)return false
      const calendar=new Date(Date.UTC(Number(date[1]),Number(date[2])-1,Number(date[3])))
      if(calendar.getUTCFullYear()!==Number(date[1])||calendar.getUTCMonth()!==Number(date[2])-1||calendar.getUTCDate()!==Number(date[3]))return false
      const stamp=`${date[1]}-${date[2].padStart(2,'0')}-${date[3].padStart(2,'0')}T${time?time[1].padStart(2,'0'):'23'}:${time?(time[2]||'0').padStart(2,'0'):'59'}:${time?(time[3]||'0').padStart(2,'0'):'59'}+08:00`
      if(!Number.isFinite(Date.parse(stamp))||Date.parse(stamp)<=Date.parse(context.created_at))return false
    }
  }
  return true
}
