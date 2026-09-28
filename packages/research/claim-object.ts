import { normalizedName } from '../maps/object-identity'

const TARGET='\uFFFC'
export function markObjectName(text:string,name:string):string {
  const subject=normalizedName(name)
  // Canonicalise explicit list operators before identifying members or deciding
  // whether monetary scope may be shortened. Owner order must not change scope.
  const value=text.normalize('NFKC').replace(/[\/+&]/g,'、')
  return subject?value.replace(new RegExp([...subject].join('[\\s\\p{P}\\p{S}]*'),'giu'),TARGET):value
}
function venueMention(before:string,after:string):boolean {
  const event='(?:开标|评标|投标(?:登记|会议)?)',place='(?:地点|地址|场地|会场|场所)'
  return new RegExp(event+place+'(?:为|是|设在|位于|：|:|\\s)*$').test(before)
    ||new RegExp('^(?:内|里|中)?(?:(?:进行|举行|召开|举办|办理)[^。；;]*?)?'+event).test(after)
    ||new RegExp('^(?:仅|只)?(?:是|为|作为|用作|被用作|被作为|充当|承担|提供)[^。；;]*?'+event+'(?:活动)?(?:的)?'+place).test(after)
}
function ownMention(clause:string,allowVenue=false):boolean {
  return [...clause.matchAll(/\uFFFC/g)].some(match=>{
    const before=clause.slice(0,match.index).trim(),after=clause.slice(match.index+1).trim()
    if(/^(?:的)?(?:旁(?:边)?|附近|周边|对面|隔壁|以[东南西北](?:侧)?|[东南西北](?:侧|面|边)的|相邻|毗邻|相比|相同|相似)/.test(after))return false
    if(/(?:参考|参照|对比|相比于?|相较于?|毗邻|紧邻|靠近|邻近|距离)$/.test(before))return false
    // A grammatical subject can still be only an event venue. Such a role may
    // support an explicit venue-service proposal, never the hosted project's work.
    if(venueMention(before,after))return allowVenue
    // Require a nominal subject, an explicit participant/beneficiary, or a
    // recognised leading label/address. Merely appearing elsewhere is not proof.
    if(!before)return true
    if(/(?:为|对|给|针对|面向|服务于|负责|涉及|包括|包含|含|连同|与|和|及|、|暨)$/.test(before))return true
    if(/(?:旁(?:边)?|附近|周边|对面|隔壁|相邻|毗邻|相比|相较)的$/.test(before))return true
    if(/^(?:关于|本次|本期|拟对|计划对|\d{4}年(?:度)?|第[一二三四五六七八九十\dA-Z]+标段|项目名称[：:]?|工程名称[：:]?|采购项目(?:名称)?[：:]?)+$/.test(before))return true
    return /(?:省|市|区|县|镇|街道|路|号|大学|学院|学校|集团|公司|医院|研究院|管理局|管委会)$/.test(before)&&!/(?:采购|维保|开标|评标|参考|相比|邻近|附近|紧邻|靠近)/.test(before)
  })
}
/** A location/comparison reference does not transfer another object's claim.
 * Nominal record identities may name several participants; amounts separately
 * retain the complete owner. Free quotations may not join unrelated subjects. */
export function ownObjectClaim(text:string,name:string,nominal=false,allowVenue=false):boolean {
  const marked=markObjectName(text,name)
  if(!marked.includes(TARGET))return false
  if(nominal)return ownMention(marked,allowVenue)
  const clauses=marked.split(/[。；;\n]|(?<!\d)[,，]|[,，](?!\d)/).map(clause=>clause.trim()).filter(Boolean)
  let established=false
  return clauses.every((clause,index)=>{
    if(index===0&&!clause.includes(TARGET)&&/^(?:与|同|相对于).+(?:相比|相较|比较)$/.test(clause)&&clauses[1]?.includes(TARGET))return true
    if(clause.includes(TARGET)){established=ownMention(clause,allowVenue);return established}
    return established&&/^(?:(?:本楼|该楼|本项目|该项目|本工程|该工程|本校区|该校区|本园区|该园区)(?:的)?|(?:本期|目前|本次|现|将|拟|计划|预计|正在|已经|已|同时|并)?(?:采购|更新|改造|维护|维修|建设|运营|施工|覆盖|包含|涉及|包括|详见|没有|暂无|无需|不需要)|(?:供应商(?:名称|地址)|代理机构(?:名称|地址)|采购单位|预算(?:金额)?|最高限价|合同金额|建设地点|项目地址|工期)[：:])/.test(clause)
  })
}

/** A joint/lot/component scope cannot be shortened into a single target. */
export function completeAmountScope(owner:string,name:string):boolean {
  const remainder=markObjectName(owner,name).replaceAll(TARGET,'')
  // Parenthetical qualifications are part of the monetary owner. We need not
  // guess whether an unfamiliar qualifier can be discarded from a total.
  return /\([^)]*\)|\[[^\]]*\]/.test(remainder)||/与|和|及|、|暨|联合|共同|包含|包括|连同|含|标段|分项|分包|包件|分期|首期|[一二三四五六七八九十\d]+期|[两三四五六七八九十\d]+(?:栋|幢|座|个项目)/.test(remainder)
}
export function amountOwnerCore(owner:string,name:string):string {
  const text=normalizedName(owner).replace(/(?:的|合计|总计|总)$/,''),subject=normalizedName(name),index=text.indexOf(subject)
  if(index<0)return text
  const marked=markObjectName(owner,name),prefix=marked.slice(0,marked.indexOf(TARGET)).trim()
  return /(?:与|和|及|、|暨|联合)$/.test(prefix)?text:text.slice(index)
}
