import { normalizedName } from '../maps/object-identity'

const TARGET='\uFFFC'
export function markObjectName(text:string,name:string):string {
  const subject=normalizedName(name)
  return subject?text.normalize('NFKC').replace(new RegExp([...subject].join('[\\s\\p{P}\\p{S}]*'),'giu'),TARGET):text
}
function ownMention(clause:string):boolean {
  return [...clause.matchAll(/\uFFFC/g)].some(match=>{
    const before=clause.slice(0,match.index).trim(),after=clause.slice(match.index+1).trim()
    if(/^(?:的)?(?:旁(?:边)?|附近|周边|对面|隔壁|以[东南西北](?:侧)?|[东南西北](?:侧|面|边)的|相邻|毗邻|相比|相同|相似)/.test(after))return false
    if(/(?:参考|参照|对比|相比于?|相较于?|毗邻|靠近|邻近|距离)$/.test(before))return false
    return true
  })
}
/** A location/comparison reference does not transfer another object's claim.
 * Nominal record identities may name several participants; amounts separately
 * retain the complete owner. Free quotations may not join unrelated subjects. */
export function ownObjectClaim(text:string,name:string,nominal=false):boolean {
  const marked=markObjectName(text,name)
  if(!marked.includes(TARGET))return false
  if(nominal)return ownMention(marked)
  const clauses=marked.split(/[。；;\n]|(?<!\d)[,，]|[,，](?!\d)/).map(clause=>clause.trim()).filter(Boolean)
  let established=false
  return clauses.every((clause,index)=>{
    if(index===0&&!clause.includes(TARGET)&&/^(?:与|同|相对于).+(?:相比|相较|比较)$/.test(clause)&&clauses[1]?.includes(TARGET))return true
    if(clause.includes(TARGET)){established=ownMention(clause);return established}
    return established&&/^(?:(?:本楼|该楼|本项目|该项目|本工程|该工程|本校区|该校区|本园区|该园区)(?:的)?|(?:本期|目前|本次|现|将|拟|计划|预计|正在|已经|已|同时|并)?(?:采购|更新|改造|维护|维修|建设|运营|施工|覆盖|包含|涉及|包括|详见|没有|暂无|无需|不需要)|(?:供应商(?:名称|地址)|代理机构(?:名称|地址)|采购单位|预算(?:金额)?|最高限价|合同金额|建设地点|项目地址|工期)[：:])/.test(clause)
  })
}

/** A joint/lot/component scope cannot be shortened into a single target. */
export function completeAmountScope(owner:string,name:string):boolean {
  const remainder=markObjectName(owner,name).replaceAll(TARGET,'')
  return /与|和|及|、|暨|联合|共同|标段|分项|分包|包件|分期|首期|[一二三四五六七八九十\d]+期|[两三四五六七八九十\d]+(?:栋|幢|座|个项目)/.test(remainder)
}
export function amountOwnerCore(owner:string,name:string):string {
  const text=normalizedName(owner).replace(/(?:的|合计|总计|总)$/,''),subject=normalizedName(name),index=text.indexOf(subject)
  if(index<0)return text
  const marked=markObjectName(owner,name),prefix=marked.slice(0,marked.indexOf(TARGET)).trim()
  return /(?:与|和|及|、|暨|联合)$/.test(prefix)?text:text.slice(index)
}
