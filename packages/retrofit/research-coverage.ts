import type {StrategySource} from './strategy'
export type AnswerSlot={id:string;question_id:string;topic:string;field:'amount'|'stage'|'funding'|'question';question:string;status:'supported'|'conditional'|'missing'|'conflicting'|'not_applicable';source_ids:string[];quotes:{source_id:string;locator:string;quote:string}[];answer:string;assumptions:string[];follow_up:string[]}
export type InvestigationRequest={task_id:string;question_ids:string[];missing_fields:string[];suggested_queries:string[];domain_hints:string[];affected_decisions:string[];visibility:'public'|'internal'}
export type MoneyObservation={source_id:string;locator:string;quote:string;funding_quote?:string|null;topic:string;amount_decimal:string;amount_yuan:string;currency:'CNY';original_unit:'元'|'万元'|'亿元';stage:'estimate'|'budget'|'control_price'|'award'|'contract'|'settlement'|'payment'|'unknown';price_year:number|null;funding_source:string|null;funding_status:'planned'|'approved'|'secured'|'received'|'not_received'|'unknown';scope:string;representation_hash?:string}
const topics=[{name:'机电配套',pattern:/机电|电力|强弱电/},{name:'雨棚',pattern:/雨棚|遮雨棚/},{name:'消防通道',pattern:/消防通道|消防车道/},{name:'二次供水',pattern:/二次供水|供水改造|给水管网/},{name:'电梯',pattern:/电梯|加梯/},{name:'社区食堂',pattern:/食堂|助餐|用餐/}]
const stagePatterns:[MoneyObservation['stage'],RegExp][]=[['settlement',/结算|决算/],['award',/中标|成交|报价/],['control_price',/控制价|最高限价/],['budget',/预算/],['estimate',/估算|概算|投资估计/],['contract',/合同(?:金额|价款|价)/],['payment',/支付|实付|拨付/]]
function decimalYuan(value:string,unit:string){const [whole,decimal='']=value.replaceAll(',','').split('.'),power=unit==='亿元'?8:unit==='万元'?4:0,digits=BigInt(whole+decimal),scale=decimal.length-power;if(scale<=0)return String(digits*10n**BigInt(-scale));const text=digits.toString().padStart(scale+1,'0');return (text.slice(0,-scale)+'.'+text.slice(-scale)).replace(/\.?0+$/,'')}
export function moneyObservations(sources:readonly StrategySource[]):MoneyObservation[]{
  return sources.flatMap(source=>{
    const out:MoneyObservation[]=[]
    const labelled=[...source.text.matchAll(/(项目预算|预算|最高限价|控制价|报价|成交(?:金额|价(?:格)?)|中标(?:金额|价)|合同金额|结算金额)\s*[（(]\s*(亿元|万元|元)\s*[)）][\s|:：]*([\d,]+(?:\.\d+)?)/g)].map(match=>({0:match[0],1:match[3],2:match[2],index:match.index!,label:match[1]}))
    const native=[...source.text.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(亿元|万元|元)(?!\s*(?:\/|每))/g)].map(match=>({0:match[0],1:match[1],2:match[2],index:match.index!,label:''}))
    // Readability preserves these award tables as separate lines. Recognize the
    // actual column order, rather than assigning an arbitrary nearby number.
    const awardRows:typeof labelled=[]
    for(const header of source.text.matchAll(/报价\s*[（(]\s*(亿元|万元|元)\s*[)）]\s*工期要求\s*[（(]天[)）]\s*质量\s*/g)){
      const offset=header.index!+header[0].length,body=source.text.slice(offset,offset+600)
      const cells=[...body.matchAll(/[^\n]+/g)].map(match=>({text:match[0].trim(),index:match.index!})).filter(cell=>cell.text)
      for(let i=0;i+5<cells.length;i++)if(/^\d+$/.test(cells[i].text)&&/公司|工程局/.test(cells[i+1].text)&&/^[\d,]+\.\d+$/.test(cells[i+3].text)&&/^\d+$/.test(cells[i+4].text)&&/合格|优良|标准/.test(cells[i+5].text)){
        const end=offset+cells[i+3].index+cells[i+3].text.length
        awardRows.push({0:source.text.slice(header.index,end),1:cells[i+3].text,2:header[1],index:header.index!,label:'成交金额'})
      }
    }
    const documentTopics=topics.filter(row=>row.pattern.test(source.title+'\n'+source.text))
    const fundingIn=(text:string)=>text.match(/(?:资金来源|出资来源|经费来源)[为是：:\s|]*([^。；;\n|]{2,45})/)
    for(const match of [...native,...labelled,...awardRows]){
      const prefix=source.text.slice(0,match.index),start=Math.max(prefix.lastIndexOf('\n'),prefix.lastIndexOf('。'),prefix.lastIndexOf('；'))+1
      const stops=['\n','。','；'].map(mark=>source.text.indexOf(mark,match.index+match[0].length)).filter(index=>index>=0)
      let end=stops.length?Math.min(...stops)+1:source.text.length
      const nextStop=['\n','。','；'].map(mark=>source.text.indexOf(mark,end)).filter(index=>index>=0),next=source.text.slice(end,nextStop.length?Math.min(...nextStop)+1:source.text.length)
      if(/^(?:本项目)?(?:资金来源|出资来源|经费来源)/.test(next.trim()))end+=next.length
      const quote=source.text.slice(Math.max(start,match.index-220),Math.min(end,match.index+match[0].length+360))
      const before=source.text.slice(Math.max(start,match.index-60),match.index)
      const stage=stagePatterns.map(([stage,pattern])=>({stage,hit:[...before.matchAll(new RegExp(pattern.source,'g'))].at(-1)?.index??-1})).sort((a,b)=>b.hit-a.hit)[0]
      const titleStage=stagePatterns.find(([,pattern])=>pattern.test(source.title))?.[0]
      const fundingMatch=fundingIn(quote)||(documentTopics.length===1?fundingIn(source.text):null),funding=fundingMatch?.[1]?.split(/工期|项目规模|交易内容|资格要求|招标内容|建设内容/)[0]||null
      const topic=topics.find(row=>row.pattern.test(source.text.slice(start,match.index)))?.name||topics.find(row=>row.pattern.test(source.title))?.name||topics.find(row=>row.pattern.test(quote))?.name||(documentTopics.length===1?documentTopics[0].name:'工程费用')
      const labelStage=match.label?stagePatterns.find(([,pattern])=>pattern.test(match.label))?.[0]:undefined
      out.push({source_id:source.id,locator:source.locator,quote,topic,amount_decimal:match[1].replaceAll(',',''),amount_yuan:decimalYuan(match[1],match[2]),currency:'CNY',original_unit:match[2] as MoneyObservation['original_unit'],stage:labelStage||(stage?.hit>=0?stage.stage:titleStage||'unknown'),price_year:Number(quote.match(/(?:价格基期|价格年|计价基期)[为是：:\s]*(\d{4})/)?.[1])||null,
        funding_source:funding,funding_quote:fundingMatch?.[0]||null,funding_status:/(?:未|尚未|没有).{0,8}(?:到账|落实|到位)/.test(quote)?'not_received':/(?:已到账|资金已到位)/.test(quote)?'received':/已落实/.test(quote)?'secured':/计划|拟筹|拟出资/.test(quote)?'planned':/批复|批准/.test(quote)?'approved':'unknown',scope:[source.title,topic,quote.match(/(?:[一二三四五六七八九十\d]+期|第[一二三四五六七八九十\d]+标段)/)?.[0]||'范围未分拆'].join(' · ')})
    }return out
  })
}
export function answerSlots(question:string):AnswerSlot[]{
  const selected=topics.filter(topic=>topic.pattern.test(question)),financial=/费用|金额|预算|造价|资金|结算|支出|出资|投入/.test(question)
  const fields:AnswerSlot['field'][]=financial?['amount','stage',...(/资金|出资|来源|财政|谁出|谁承担/.test(question)?['funding' as const]:[])]:['question']
  const subjects=selected.length?selected.map(topic=>topic.name):[question]
  return subjects.flatMap((topic,index)=>fields.map(field=>({id:`q${index+1}:${field}`,question_id:`q${index+1}`,topic,field,question:field==='question'?question:`${topic}的${{amount:'金额',stage:'金额阶段与口径',funding:'资金来源'}[field]}是什么？`,status:'missing',source_ids:[],quotes:[],answer:'',assumptions:[],follow_up:[]})))
}
export function resolveAnswerSlots(question:string,sources:readonly StrategySource[],answerText=''): {slots:AnswerSlot[];money:MoneyObservation[];supported:number;conditional:number;missing:number;conflicting:number;coverage:number;requests:InvestigationRequest[]}{
  const money=moneyObservations(sources),slots=answerSlots(question)
  for(const slot of slots){
    const pattern=topics.find(row=>row.name===slot.topic)?.pattern
    const candidates=sources.filter(source=>pattern?pattern.test(source.title+'\n'+source.text):source.text.includes(slot.topic))
    const rows=money.filter(row=>row.topic===slot.topic||!pattern&&candidates.some(source=>source.id===row.source_id))
    const matching=slot.field==='funding'?rows.filter(row=>row.funding_source):slot.field==='stage'?rows.filter(row=>row.stage!=='unknown'):slot.field==='amount'?rows:[]
    if(slot.field==='question'){
      const source=candidates.find(source=>source.text.trim()&&answerText&&source.text.includes(answerText))
      if(source){slot.status='conditional';slot.answer=answerText;slot.source_ids=[source.id];slot.quotes=[{source_id:source.id,locator:source.locator,quote:answerText}]}
    }else if(matching.length){
      const used=[...new Set(matching.map(row=>row.source_id))],originals=sources.filter(source=>used.includes(source.id))
      slot.status=originals.every(source=>source.role==='current'&&source.object_binding?.relation==='same_object')?'supported':'conditional'
      slot.source_ids=used;slot.quotes=matching.map(row=>({source_id:row.source_id,locator:row.locator,quote:slot.field==='funding'?row.funding_quote||row.quote:row.quote}))
      const values=[...new Set(matching.map(row=>slot.field==='funding'?`${row.funding_source}（${row.funding_status==='received'?'原文记载到位':row.funding_status==='not_received'?'原文记载未到位':'到账时点待核'}）`:`${row.amount_decimal}${row.original_unit}（${{budget:'预算',award:'成交/中标',estimate:'估概算',contract:'合同',control_price:'控制价',settlement:'结算',payment:'支付',unknown:'阶段待核'}[row.stage]}）`))]
      slot.answer=values.slice(0,12).join('；')+(values.length>12?`；共${values.length}条不同口径记录，完整数值保留在原文与JSON。`:'')
      if(slot.status==='conditional')slot.assumptions=['引用金额属于所列来源的对象、范围和阶段；作为当前项目参数前需确认适用范围。']
      const sameStage=new Map<string,Set<string>>()
      for(const row of matching){const key=row.stage+':'+row.scope;const values=sameStage.get(key)||new Set();values.add(row.amount_yuan);sameStage.set(key,values)}
      if([...sameStage.values()].some(values=>values.size>1)){slot.status='conflicting';slot.assumptions.push('同一范围与阶段存在不同金额，保留并列原文，需对照公告及附件。')}
    }
    if(slot.status==='missing'){slot.answer='现有资料尚未明确。';slot.follow_up=[`${slot.topic} ${slot.field==='funding'?'资金来源 财政 业主出资':slot.field==='stage'?'预算 中标 合同 结算 口径':'工程量 金额 原始资料'}`]}
  }
  const count=(status:AnswerSlot['status'])=>slots.filter(slot=>slot.status===status).length
  return {slots,money,supported:count('supported'),conditional:count('conditional'),missing:count('missing'),conflicting:count('conflicting'),coverage:slots.length?(count('supported')+count('conditional'))/slots.length:0,
    requests:slots.filter(slot=>slot.status==='missing'||slot.status==='conflicting').map(slot=>({task_id:'coverage',question_ids:[slot.question_id],missing_fields:[slot.field],suggested_queries:slot.follow_up.length?slot.follow_up:[`${slot.topic} ${slot.field} 原文核对`],domain_hints:[],affected_decisions:[slot.question],visibility:'public'}))}
}
export function coverageText(slots:readonly AnswerSlot[]){return slots.map(slot=>`${slot.topic} · ${{amount:'金额',stage:'阶段',funding:'资金来源',question:'问题'}[slot.field]}：${slot.answer}${slot.status==='conditional'?'〔原文参考，适用条件待核〕':slot.status==='conflicting'?'〔存在冲突〕':''}`).join('\n')}
export function costReferenceGroups(rows:readonly MoneyObservation[]){const groups=new Map<string,MoneyObservation[]>();for(const row of rows){const key=JSON.stringify([row.scope,row.stage,row.price_year,row.currency]);groups.set(key,[...(groups.get(key)||[]),row])}return [...groups.values()].map(rows=>{const first=rows[0],values=[...new Set(rows.map(row=>Number(row.amount_yuan)))].filter(value=>Number.isSafeInteger(value));return {scope:first.scope,stage:first.stage,price_year:first.price_year,record_count:rows.length,min_yuan:values.length?Math.min(...values):null,max_yuan:values.length?Math.max(...values):null,source_ids:[...new Set(rows.map(row=>row.source_id))]}})}
/** Project coverage follows the actual measures in the current source set. */
export function projectFinancialQuestion(sources:readonly StrategySource[]){const present=topics.filter(topic=>sources.some(source=>topic.pattern.test(source.title+'\n'+source.text))).map(topic=>topic.name);return `${present.length?present.join('、'):'当前项目工程'}的金额、阶段与资金来源`}
export const DEFAULT_RESEARCH_QUESTIONS=[{id:'direction',role:'building_delivery',question:'更新必要性、保留修缮与拆建条件及对象范围'},{id:'engineering',role:'building_delivery',question:'具体楼栋、管网、电梯与附属工程的改造内容、工程量和实施顺序'},{id:'cost',role:'cost_value',question:'分阶段同口径造价、出资主体、资金缺口及现金流'},{id:'value',role:'cost_value',question:'财务收益、公共服务效果与目标权重变化'},{id:'residents',role:'residents_operations',question:'居民需求、幸福度、决议与施工影响的内部调查'},{id:'operations',role:'residents_operations',question:'电梯利用率、社区食堂用餐人数、设施容量与后续维护'}] as const
