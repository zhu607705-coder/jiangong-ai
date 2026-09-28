import type { PublicField, PublicRecord } from '../../apps/host/generated/contracts'
import { normalizedName } from '../maps/object-identity'

const RESOLVED='deadline_resolved'
type WindowResolution={status:'absent'}|{status:'unresolved'}|{status:'resolved';deadline:number;field:PublicField}

function deadlineTime(value:unknown):number {
  const raw=String(value??''),date=raw.match(/(\d{4})[年/.-](\d{1,2})[月/.-](\d{1,2})/),time=raw.match(/(\d{1,2})[时点:](\d{1,2})?(?:[分:](\d{1,2})秒?)?/)
  if(!date)return NaN
  const calendar=new Date(Date.UTC(Number(date[1]),Number(date[2])-1,Number(date[3])))
  if(calendar.getUTCFullYear()!==Number(date[1])||calendar.getUTCMonth()!==Number(date[2])-1||calendar.getUTCDate()!==Number(date[3]))return NaN
  if(/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(raw))return Date.parse(raw)
  return Date.parse(`${date[1]}-${date[2].padStart(2,'0')}-${date[3].padStart(2,'0')}T${time?time[1].padStart(2,'0'):'23'}:${time?(time[2]||'0').padStart(2,'0'):'59'}:${time?(time[3]||'0').padStart(2,'0'):'59'}+08:00`)
}
const identity=(record:PublicRecord)=>record.fields.find(field=>['project_id','parcel_id'].includes(field.key)&&field.value!==null)
const lot=(record:PublicRecord)=>record.fields.find(field=>field.key==='lot_id')?.value
export function recordFamily(record:PublicRecord,records:PublicRecord[]):PublicRecord[]{
  const key=identity(record),selectedLot=lot(record)
  return records.filter(other=>{
    if(other.source_id!==record.source_id||other.adapter!==record.adapter||other.scope!=='object')return false
    const otherKey=identity(other),otherLot=lot(other)
    if(selectedLot&&otherLot&&selectedLot!==otherLot)return false
    return key?!!otherKey&&key.key===otherKey.key&&key.value===otherKey.value:!otherKey&&normalizedName(record.subject)===normalizedName(other.subject)
  })
}
/** Resolve only explicit before/after relationships, never table order or latest date. */
function resolveWindow(records:PublicRecord[]):WindowResolution {
  const deadlines:number[]=[],replacements=new Map<number,number>(),fields:PublicField[]=[]
  for(const record of records){
    const resolved=record.fields.filter(field=>field.key===RESOLVED)
    if(resolved.length){
      if(resolved.length!==1||!Number.isFinite(deadlineTime(resolved[0].value)))return {status:'unresolved'}
      deadlines.push(deadlineTime(resolved[0].value));fields.push(resolved[0]);continue
    }
    const originals=record.fields.filter(field=>field.key==='deadline')
    const before=record.fields.filter(field=>field.key==='deadline_previous'),after=record.fields.filter(field=>field.key==='deadline_corrected')
    if(before.length||after.length){
      if(before.length!==1||after.length!==1)return {status:'unresolved'}
      const from=deadlineTime(before[0].value),to=deadlineTime(after[0].value)
      if(!Number.isFinite(from)||!Number.isFinite(to)||replacements.has(from)&&replacements.get(from)!==to)return {status:'unresolved'}
      if(from!==to)replacements.set(from,to)
      deadlines.push(from,to);fields.push(after[0])
    }
    for(const field of originals){const value=deadlineTime(field.value);if(!Number.isFinite(value))return {status:'unresolved'};deadlines.push(value);fields.push(field)}
  }
  if(!deadlines.length)return {status:records.some(record=>record.fields.some(field=>field.key==='opening_at'))?'unresolved':'absent'}
  const effective=new Set<number>()
  for(let deadline of deadlines){
    const seen=new Set<number>()
    while(replacements.has(deadline)){
      if(seen.has(deadline))return {status:'unresolved'}
      seen.add(deadline);deadline=replacements.get(deadline)!
    }
    effective.add(deadline)
  }
  if(effective.size!==1)return {status:'unresolved'}
  const deadline=[...effective][0],field=fields.find(field=>deadlineTime(field.value)===deadline)
  return field?{status:'resolved',deadline,field}:{status:'unresolved'}
}
export function currentWindow(records:PublicRecord[],asOf:string):boolean {
  const result=resolveWindow(records)
  return result.status==='absent'||result.status==='resolved'&&result.deadline>Date.parse(asOf)
}
/** Carry complete-family validity into each retained record before either cap.
 * Original fields remain untouched; derived fields retain their actual locator. */
export function retainRecordWindows(all:PublicRecord[],retained:PublicRecord[]=all,completeBody=true):PublicRecord[]{
  const cache=new Map<string,PublicField|null>()
  return retained.map(record=>{
    if(record.adapter!=='procurement')return record
    const native=identity(record),key=JSON.stringify([record.source_id,record.adapter,native?[native.key,native.value]:normalizedName(record.subject),lot(record)])
    if(!cache.has(key)){
      const family=recordFamily(record,all),result:WindowResolution=completeBody?resolveWindow(family):{status:'unresolved'}
      let field:PublicField|null=null
      if(result.status==='resolved')field={...result.field,key:RESOLVED,label:'同编号有效响应截止'}
      if(result.status==='unresolved'){
        const originals=family.flatMap(row=>row.fields.filter(field=>['deadline','deadline_previous','deadline_corrected','opening_at',RESOLVED].includes(field.key)))
        field={key:RESOLVED,label:completeBody?'同编号响应截止待核':'正文未完整读取，响应截止待核',value:null,unit:'',raw:[...new Set(originals.map(field=>field.raw))].join(' / ').slice(0,400),locator:[...new Set(originals.map(field=>field.locator))].join(' / ').slice(0,200)}
      }
      cache.set(key,field)
    }
    const field=cache.get(key)
    return field?{...record,fields:[...record.fields.filter(field=>field.key!==RESOLVED),{...field}]}:record
  })
}
