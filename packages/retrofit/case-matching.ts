import additions from '../../data/public_cases/renewal-case-cards-20261017.json'
import type {ModeHistory,RenewalModeInput} from './renewal-mode'

export const CASE_MATCH_POLICY='project-case-match-v1'
export type CaseDirection='comprehensive'|'rebuild'
export const CASE_TOPICS=[
  {key:'elevator',label:'电梯',pattern:/电梯|加梯|换梯/},{key:'pipe',label:'供水与管网',pattern:/供水|给排水|管网|排水|漏水|雨污/},
  {key:'safety',label:'结构与消防',pattern:/结构|危房|小梁薄板|消防|加固/},{key:'residents',label:'居民协商',pattern:/居民|协商|签约|幸福|满意|决议/},
  {key:'relocation',label:'安置回搬',pattern:/安置|回搬|腾退|过渡|搬迁/},{key:'meals',label:'食堂助餐',pattern:/食堂|饭堂|就餐|助餐|用餐/},
  {key:'reuse',label:'存量空间再利用',pattern:/闲置|车库|存量|活化|空间再利用/},{key:'services',label:'公共服务',pattern:/公共服务|养老|托育|幼儿|活动中心|服务中心/},
  {key:'operations',label:'运营收支',pattern:/运营|收入|餐价|收费|收缴|就餐|服务利用/},{key:'maintenance',label:'长效维护',pattern:/维护|维保|物业|保养/},
  {key:'funding',label:'筹资与造价',pattern:/资金|投资|造价|预算|出资|财政|补贴/},{key:'heritage',label:'风貌保护',pattern:/风貌|历史街区|历史建筑|古村|保护名录/},
  {key:'rights',label:'权属规划',pattern:/产权|权属|用地|规划|共有/},{key:'accessibility',label:'无障碍适老',pattern:/无障碍|残疾|适老|轮椅/},
] as const
export type CaseTopic=typeof CASE_TOPICS[number]['key']
export type RenewalCase={id:string;name:string;city:string;mode:string;reported_stage:string;published_at:string;source_title:string;publisher:string;url:string;
  metrics:{label:string;value:number;unit:string;scope:string}[];funding_note:string;comparison_note:string;
  related_source?:{title:string;publisher:string;published_at:string;url:string;note:string};
  directions?:string[];topics?:string[];building_form?:string;interventions?:string[];decision_use?:string;transfer_checks?:string[];source_quote?:string;source_locator?:string;
  households?:number|null;reference_scope?:string;source_review?:string;verified_at?:string;kind?:'public_case'|'official_cost'|'workbook';amount_kind?:string}
export type CaseContext={target:string;city:string|null;topics:string[];households:number|null;as_of:string;direction?:CaseDirection|null;city_basis?:'registered'|'filter'|'unknown';object_note?:string}
export type CaseWeights={issue:number;direction:number;region:number;evidence:number;scale:number}
export const CASE_PRESETS:{id:string;label:string;weights:CaseWeights}[]=[
  {id:'problem',label:'问题相近优先',weights:{issue:5,direction:3,region:2,evidence:2,scale:1}},
  {id:'local',label:'本地实施优先',weights:{issue:4,direction:3,region:5,evidence:2,scale:1}},
  {id:'evidence',label:'原件依据优先',weights:{issue:4,direction:3,region:1,evidence:5,scale:1}},
]
export const extractCaseTopics=(text:string):string[]=>CASE_TOPICS.filter(row=>row.pattern.test(text)).map(row=>row.key)
const city=(text:string|null|undefined)=>(text||'').replace(/市$/,'')
const sameProvince=(a:string,b:string)=>[['杭州','宁波','温州','绍兴','嘉兴','湖州','金华','衢州','丽水','舟山','台州'],['广州','深圳','佛山','珠海','东莞','惠州','中山']].some(group=>group.includes(a)&&group.includes(b))
const legacyFeatures:Record<string,Partial<RenewalCase>>={
  'MODE-ZHEGONG-20261012':{directions:['rebuild'],topics:['funding','residents','relocation','rights'],households:548,building_form:'危旧多层住宅',interventions:['居民协商筹资与委托实施','拆旧建新并组织回搬'],decision_use:'拆建筹资责任、居民承担与扩面安排',transfer_checks:['区分总投入、EPC合同与居民购置支出','支付能力、扩面价格和产权条件需本地重算']},
  'MODE-SH-FENGNAN-20240628':{directions:['rebuild'],topics:['relocation','safety','rights'],households:1813,building_form:'集中旧住房',interventions:['拆除重建与安置组织'],decision_use:'大规模安置和交付组织',transfer_checks:['原户数与新设计户数分开','按本地规划与居民产权重新测算']},
  'MODE-SH-PENGYI-20250701':{directions:['rebuild'],topics:['relocation','services','residents'],households:2110,building_form:'不成套住宅',interventions:['拆旧建新、分期回搬和服务配套交付'],decision_use:'回搬顺序、养老配套及交付衔接',transfer_checks:['公有租赁住房与房改产权安排分开核对','上海造价和产权政策需按本地重新测算']},
}
export function expandCuratedCases(original:readonly RenewalCase[],asOf:string){return [...original.map(row=>({...row,...legacyFeatures[row.id]})),...additions.cases].filter(row=>row.published_at<=asOf.slice(0,10)).map(row=>({...row,kind:'public_case' as const}))}
export function caseContext(input:Pick<RenewalModeInput,'target'|'as_of'|'evidence'>&{matching_context?:CaseContext}):CaseContext{
  return input.matching_context||{target:input.target,city:null,topics:extractCaseTopics(input.evidence.map(source=>source.title+' '+source.quote).join('\n')),households:null,as_of:input.as_of}
}
export function historyCases(history?:ModeHistory):RenewalCase[]{
 if(!history)return []
 const official=history.official_costs.map(row=>({id:'OFFICIAL-'+row.id,name:row.project_name,city:row.city||'',mode:'工程费用参考',reported_stage:row.amount_kind,published_at:row.date||'',source_title:row.project_name,publisher:'已归档交易原件',url:row.url,metrics:[{label:row.amount_kind,value:row.amount_yuan,unit:'元',scope:row.scope||'原公告工程范围'}],funding_note:'金额阶段按原件使用，资金承担与到账时点另行核对。',comparison_note:row.scope||'先确认对应工程范围。',topics:extractCaseTopics(row.project_name+' '+(row.scope||'')),interventions:row.scope?[row.scope]:[],decision_use:'核对分项工程内容和同阶段造价',transfer_checks:['核对工程范围、金额阶段、工程量和价格年'],source_quote:row.scope||'',source_locator:'cost:'+row.id,kind:'official_cost' as const,amount_kind:row.amount_kind}))
 const imported=history.records.map(row=>({id:'WORKBOOK-'+row.id,name:row.project_name,city:row.city||'',mode:'历史工程线索',reported_stage:row.work_type||'工程类型待核',published_at:'',source_title:row.project_name,publisher:'提供工作簿 · 待复核',url:row.url||'',metrics:Object.entries(row.amounts_yuan).filter((entry):entry is [string,number]=>typeof entry[1]==='number'&&Number.isFinite(entry[1])&&entry[1]>0).map(([label,value])=>({label,value,unit:'元',scope:row.scope||'提供工作簿所列工程范围'})),funding_note:'保留工作簿原始金额，使用前打开交易原件复核。',comparison_note:'原始记录尚未审核，先作为定位现实工程的线索。',topics:extractCaseTopics(row.project_name+' '+(row.scope||'')),interventions:row.scope?[row.scope]:[],decision_use:'定位相似工程并取得原公告及工程量清单',transfer_checks:['复核项目身份、金额阶段与面积分母'],source_locator:row.locator,kind:'workbook' as const}))
 return [...official,...imported.filter(row=>!official.some(item=>city(item.city)===city(row.city)&&item.name===row.name))]
}
export type CaseMatch={item:RenewalCase;score:number;upper_score:number;reasons:string[];matched_topics:string[];differences:string[];known_factors:number;factors:{key:keyof CaseWeights;label:string;value:number|null;weight:number}[]}
/** Weighted retrieval relevance, with visible component values; never an approval or calibrated probability. */
export function rankRenewalCases(candidates:readonly RenewalCase[],context:CaseContext,options:{direction?:CaseDirection|null;topic?:string;query?:string;weights?:CaseWeights}={}):CaseMatch[]{
 const weights=options.weights||CASE_PRESETS[0].weights
 if(Object.values(weights).some(value=>!Number.isFinite(value)||value<0||value>5)||!Object.values(weights).some(value=>value>0))throw new Error('CASE_WEIGHT_INVALID')
 const focus=options.topic?[options.topic]:context.topics,direction=options.direction??context.direction,words=(options.query||'').trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
 const matches=candidates.filter(item=>!words.length||words.every(word=>`${item.name} ${item.city} ${item.mode} ${(item.interventions||[]).join(' ')}`.toLocaleLowerCase().includes(word))).filter(item=>!options.topic||(item.topics||extractCaseTopics(item.name+' '+item.comparison_note)).includes(options.topic)).filter(item=>!direction||!item.directions?.length||item.directions.includes(direction)).map(item=>{
   const topics=item.topics||extractCaseTopics(item.name+' '+item.mode+' '+item.comparison_note),matched=focus.filter(topic=>topics.includes(topic)),a=city(context.city),b=city(item.city)
   const region=a&&b?a===b?1:sameProvince(a,b) ? .65 : [a,b].every(value=>['杭州','上海','宁波','嘉兴','湖州','绍兴'].includes(value)) ? .3 : 0 : null
   const ratio=context.households&&item.households?Math.min(context.households,item.households)/Math.max(context.households,item.households):null
   const factors:CaseMatch['factors']=[{key:'issue',label:'具体问题',value:focus.length?matched.length/Math.sqrt(focus.length*Math.max(1,topics.length)):null,weight:weights.issue},{key:'direction',label:'改造方向',value:direction?item.directions?.length?Number(item.directions.includes(direction)):null:null,weight:weights.direction},{key:'region',label:'地域条件',value:region,weight:weights.region},{key:'evidence',label:'来源类别',value:item.kind==='workbook'?.15:item.kind==='official_cost'?.95:1,weight:weights.evidence},{key:'scale',label:'住户规模',value:ratio,weight:weights.scale}]
   const known=factors.filter(row=>row.value!==null&&row.weight>0),total=factors.reduce((sum,row)=>sum+row.weight,0),contribution=known.reduce((sum,row)=>sum+row.value!*row.weight,0),score=Math.round(100*contribution/total),upper_score=Math.round(100*(contribution+factors.filter(row=>row.value===null).reduce((sum,row)=>sum+row.weight,0))/total)
   const reasons=[...(matched.length?[`对应${matched.map(key=>CASE_TOPICS.find(row=>row.key===key)?.label||key).join('、')}`]:[]),...(a&&a===b?['同城工程与实施环境参考']:[]),...(direction&&item.directions?.includes(direction)?['与当前工作方向一致']:[])]
   if(!reasons.length)reasons.push('当前资料只支持按来源类别和已知地域排序，可选择具体问题缩小范围。')
   const differences=[...(a&&b&&a!==b?[`${item.city}与${context.city}的规划、造价及居民负担按当地重新核对。`]:[]),...((context.households||item.households)&&(!context.households||!item.households)?['住户规模尚未形成同口径对照。']:[]),...(item.transfer_checks||[item.comparison_note])]
   return {item,score,upper_score,reasons,matched_topics:matched,differences,known_factors:known.length,factors}
 })
 return matches.sort((a,b)=>b.score-a.score||a.item.id.localeCompare(b.item.id))
}
export function rankHistory<T extends {project_name:string;city:string|null;scope?:string|null;amount_kind?:string}>(rows:readonly T[],context?:CaseContext,limit=24):T[]{
 const focus=context?.topics||[],home=city(context?.city),rank=(row:T)=>{const tags=extractCaseTopics(row.project_name+' '+(row.scope||''));return (home&&home===city(row.city)?8:0)+focus.filter(tag=>tags.includes(tag)).length*5}
 const seen=new Set<string>();return [...rows].sort((a,b)=>rank(b)-rank(a)||a.project_name.localeCompare(b.project_name)).filter(row=>{const key=city(row.city)+':'+row.project_name+':'+(row.amount_kind||'');if(seen.has(key))return false;seen.add(key);return true}).slice(0,limit)
}
export function selectCaseReferences(input:RenewalModeInput,limit=6){
 const ranked=rankRenewalCases([...input.cases,...historyCases(input.history)],caseContext(input)),seen=new Set<string>(),selected:CaseMatch[]=[]
 for(const row of [...ranked.filter(row=>row.item.kind==='public_case').slice(0,3),...ranked.filter(row=>row.item.kind==='official_cost').slice(0,3),...ranked]){
   if(row.item.kind==='workbook'||!row.item.source_quote||!row.item.url||seen.has(row.item.url))continue
   seen.add(row.item.url);selected.push(row);if(selected.length>=limit)break
 }return selected
}
