import type { MapScreenContext, PublicRecord, Source } from '../../apps/host/generated/contracts'
import { normalizedName, objectQuoteMatches, primaryObjectSource } from './evidence'
import { sourceCurrentAt } from './public-sources'
import { amountOwnerCore, completeAmountScope, ownObjectClaim } from './claim-object'

const money=/(\d[\d,，]*(?:\.\d+)?)\s*(亿元|万元|元|%)/g
const fields=[
  {key:'budget',label:/预算(?:金额)?/g},
  {key:'ceiling',label:/最高限价/g},
  {key:'award',label:/中标(?:[（(]成交[）)])?(?:金额)?|成交(?:金额|价)?/g},
  {key:'contract',label:/合同金额/g},
]
const number=(text:string)=>Number(text.replace(/[,，]/g,''))
function matchingOwner(owner:string,claim:NonNullable<ReturnType<typeof claimBefore>>,name:string,lot?:string):boolean {
  if(!ownObjectClaim(owner,name,true))return false
  let scopedOwner=owner.normalize('NFKC').toLowerCase().replace(/\s/g,''),scopedClaim=claim.ownerText.normalize('NFKC').toLowerCase().replace(/\s/g,'')
  if(lot){
    const value=normalizedName(lot),labels=/标段|包/.test(value)?[value]:[`${value}标段`,`标段${value}`,`${value}包`,`包${value}`]
    if(!labels.some(label=>(claim.shorthand?normalizedName(name):claim.subject).includes(label)))return false
    for(const label of labels){scopedOwner=scopedOwner.replaceAll(label,'');scopedClaim=scopedClaim.replaceAll(label,'')}
  }
  const original=normalizedName(scopedOwner),proposed=normalizedName(scopedClaim).replace(/的$/,'')
  if(completeAmountScope(scopedOwner,name))return !claim.shorthand&&amountOwnerCore(scopedOwner,name)===amountOwnerCore(scopedClaim,name)
  return claim.shorthand||original.includes(proposed)
}
function claimBefore(text:string,index:number){
  const before=text.slice(0,index),clause=before.split(/[。；;\n，,]/).at(-1)!.trim()
  const match=fields.flatMap(field=>[...clause.matchAll(field.label)].map(m=>({field,index:m.index,end:m.index+m[0].length}))).sort((a,b)=>b.index-a.index)[0]
  if(!match)return null
  const ownerText=clause.slice(0,match.index),subject=normalizedName(ownerText).replace(/的$/,'')
  const shorthand=/^(?:本项目|该项目|本处|所选对象)$/.test(subject)||!subject&&!before.slice(0,before.length-clause.length).trim()
  const qualifier=clause.slice(match.end)
  // “各/分别/每栋” changes ownership or cardinality; it is not the same amount.
  if(!/^[\s:：为约￥¥人民币]*$/.test(qualifier))return null
  return {field:match.field,subject,ownerText,shorthand}
}
export function groundedAmounts(text:string,context:MapScreenContext,name:string,sources:Source[],records:PublicRecord[]):boolean {
  const amounts=[...text.matchAll(money)]
  if(!amounts.length)return true
  if(/收益|回报|IRR|ROI|利润/i.test(text))return false
  return amounts.every(amount=>{
    if(!name)return false
    const claim=claimBefore(text,amount.index)
    return sources.some(source=>{
      if(!primaryObjectSource(source,context)||!sourceCurrentAt(source,context.created_at))return false
      if(Date.parse(context.created_at)-Date.parse(source.published_at!)>180*86400000&&!/历史|档案|当年|20\d\d年/.test(text))return false
      // Literal suffixes can cut away the first member of a joint owner. Known
      // monetary fields always use complete record/sentence ownership below.
      // Other literal numeric facts are retained only as complete statements.
      if(!claim||amount[2]==='%')return source.untrusted_text!.split(/[。；;\n]/).some(sentence=>
        sentence.trim()===text.replace(/[。；;\n]+$/,'').trim()&&objectQuoteMatches(source,context,name,sentence))
      if(!claim.shorthand&&!claim.subject.includes(normalizedName(name)))return false
      const value=number(amount[1])
      // The claim's complete subject phrase must be supported by the same
      // record, not merely contain the selected name somewhere in a paragraph.
      const structured=records.filter(r=>r.source_id===source.id&&r.fields.some(field=>field.key===claim.field.key))
      if(structured.length)return structured.some(r=>matchingOwner(r.subject,claim,name,String(r.fields.find(f=>f.key==='lot_id')?.value||''))&&r.fields.some(f=>f.key===claim.field.key&&f.value===value&&f.unit===amount[2]&&objectQuoteMatches(source,context,name,f.raw,records,r.id)))
      return source.untrusted_text!.split(/[。；;\n]/).some(sentence=>{
        if(!objectQuoteMatches(source,context,name,sentence))return false
        return [...sentence.matchAll(money)].some(m=>{
          const original=claimBefore(sentence,m.index)
          return !!original&&original.field.key===claim.field.key&&original.subject.includes(normalizedName(name))
            &&matchingOwner(original.ownerText,claim,name)&&number(m[1])===value&&m[2]===amount[2]
        })
      })
    })
  })
}
