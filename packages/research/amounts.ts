import type { MapScreenContext, PublicRecord, Source } from '../../apps/host/generated/contracts'
import { normalizedName, objectQuoteMatches, primaryObjectSource } from './evidence'
import { sourceCurrentAt } from './public-sources'

const money=/(\d[\d,，]*(?:\.\d+)?)\s*(亿元|万元|元|%)/g
const fields=[
  {key:'budget',label:/预算(?:金额)?/g,source:'预算(?:金额)?'},
  {key:'ceiling',label:/最高限价/g,source:'最高限价'},
  {key:'award',label:/中标(?:[（(]成交[）)])?(?:金额)?|成交(?:金额|价)?/g,source:'(?:中标(?:[（(]成交[）)])?金额|成交金额|成交价)'},
  {key:'contract',label:/合同金额/g,source:'合同金额'},
]
const number=(text:string)=>Number(text.replace(/[,，]/g,''))
export function groundedAmounts(text:string,context:MapScreenContext,name:string,sources:Source[],records:PublicRecord[]):boolean {
  const amounts=[...text.matchAll(money)]
  if(!amounts.length)return true
  if(/收益|回报|IRR|ROI|利润/i.test(text))return false
  return amounts.every(amount=>{
    const before=text.slice(0,amount.index),kind=fields.flatMap(f=>[...before.matchAll(f.label)].map(m=>({field:f,index:m.index}))).sort((a,b)=>b.index-a.index)[0]?.field
    const clause=before.split(/[。；;\n]/).at(-1)!.trim()
    const explicit=normalizedName(clause).includes(normalizedName(name))
    const shorthand=/^(?:本项目|该项目|本处|所选对象)?(?:的)?(?:预算|最高限价|中标|成交|合同金额)/.test(clause)
    if(!name||!explicit&&!shorthand)return false
    return sources.some(source=>{
      if(!primaryObjectSource(source,context)||!sourceCurrentAt(source,context.created_at))return false
      if(Date.parse(context.created_at)-Date.parse(source.published_at!)>180*86400000&&!/历史|档案|当年|20\d\d年/.test(text))return false
      if(source.untrusted_text!.includes(text)&&objectQuoteMatches(source,context,name,text))return true
      if(!kind||amount[2]==='%')return false
      const value=number(amount[1])
      if(records.some(r=>r.source_id===source.id&&r.fields.some(f=>f.key===kind.key&&f.value===value&&f.unit===amount[2]&&objectQuoteMatches(source,context,name,f.raw,records,r.id))))return true
      const pattern=new RegExp(kind.source+'[\\s:：为￥¥人民币]*([\\d,，]+(?:\\.\\d+)?)[\\s（(]*(亿元|万元|元)','g')
      return source.untrusted_text!.split(/[。\n]/).some(sentence=>normalizedName(sentence).includes(normalizedName(name))&&objectQuoteMatches(source,context,name,sentence)&&[...sentence.matchAll(pattern)].some(m=>number(m[1])===value&&m[2]===amount[2]))
    })
  })
}
