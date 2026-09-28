import type { MapScreenContext, PublicRecord, Source } from '../../apps/host/generated/contracts'
import { normalizedName, objectQuoteMatches, primaryObjectSource } from './evidence'
import { sourceCurrentAt } from './public-sources'

const money=/(\d[\d,，]*(?:\.\d+)?)\s*(亿元|万元|元|%)/g
const fields=[
  {key:'budget',label:/预算(?:金额)?/g},
  {key:'ceiling',label:/最高限价/g},
  {key:'award',label:/中标(?:[（(]成交[）)])?(?:金额)?|成交(?:金额|价)?/g},
  {key:'contract',label:/合同金额/g},
]
const number=(text:string)=>Number(text.replace(/[,，]/g,''))
function claimBefore(text:string,index:number){
  const before=text.slice(0,index),clause=before.split(/[。；;\n，,]/).at(-1)!.trim()
  const match=fields.flatMap(field=>[...clause.matchAll(field.label)].map(m=>({field,index:m.index,end:m.index+m[0].length}))).sort((a,b)=>b.index-a.index)[0]
  if(!match)return null
  const subject=normalizedName(clause.slice(0,match.index)).replace(/的$/,'')
  const shorthand=/^(?:本项目|该项目|本处|所选对象)$/.test(subject)||!subject&&!before.slice(0,before.length-clause.length).trim()
  const qualifier=clause.slice(match.end)
  // “各/分别/每栋” changes ownership or cardinality; it is not the same amount.
  if(!/^[\s:：为约￥¥人民币]*$/.test(qualifier))return null
  return {field:match.field,subject,shorthand}
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
      if(source.untrusted_text!.includes(text)&&objectQuoteMatches(source,context,name,text))return true
      if(!claim||!claim.shorthand&&!claim.subject.includes(normalizedName(name))||amount[2]==='%')return false
      const value=number(amount[1])
      // The claim's complete subject phrase must be supported by the same
      // record, not merely contain the selected name somewhere in a paragraph.
      if(records.some(r=>r.source_id===source.id&&(claim.shorthand||normalizedName(r.subject).includes(claim.subject))&&r.fields.some(f=>f.key===claim.field.key&&f.value===value&&f.unit===amount[2]&&objectQuoteMatches(source,context,name,f.raw,records,r.id))))return true
      return source.untrusted_text!.split(/[。；;\n]/).some(sentence=>{
        if(!objectQuoteMatches(source,context,name,sentence))return false
        return [...sentence.matchAll(money)].some(m=>{
          const original=claimBefore(sentence,m.index)
          return !!original&&original.field.key===claim.field.key&&original.subject.includes(normalizedName(name))
            &&(claim.shorthand||original.subject.includes(claim.subject))&&number(m[1])===value&&m[2]===amount[2]
        })
      })
    })
  })
}
