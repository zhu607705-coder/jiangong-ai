import { parseHTML } from 'linkedom'
import { createHash } from 'node:crypto'
import type { Source, PublicRecord, PublicField, AdapterReceipt } from '../../../apps/host/generated/contracts'
import { publicSourceClass } from '../../../packages/research/public-sources'

type Adapter=PublicRecord['adapter']
type Spec={key:string;label:string;aliases:string[];unit?:string}
const specifications:Record<Exclude<Adapter,'statistics'>,Spec[]>={
  landchina:[
    {key:'parcel_id',label:'宗地标识',aliases:['电子监管号','宗地编号','地块编号']},
    {key:'project_name',label:'项目名称',aliases:['项目名称']},
    {key:'location',label:'项目位置',aliases:['项目位置','地块位置','宗地坐落']},
    {key:'land_use',label:'土地用途',aliases:['土地用途','用途']},
    {key:'area',label:'土地面积',aliases:['土地面积','出让面积','面积'],unit:'㎡'},
    {key:'supply_method',label:'供地方式',aliases:['供地方式','出让方式']},
    {key:'assignee',label:'受让方',aliases:['土地使用权人','受让人','受让方']},
    {key:'transaction_price',label:'成交价格',aliases:['成交价格','成交价'],unit:'万元'},
    {key:'signed_at',label:'合同签订日期',aliases:['合同签订日期','成交日期']},
  ],
  construction:[
    {key:'project_id',label:'工程项目编码',aliases:['工程项目编码','项目编码','项目编号']},
    {key:'project_name',label:'项目名称',aliases:['工程名称','项目名称']},
    {key:'owner',label:'建设单位',aliases:['建设单位','建设单位名称']},
    {key:'permit_id',label:'施工许可证号',aliases:['施工许可证编号','施工许可证号']},
    {key:'area',label:'建筑面积',aliases:['建筑面积','建设规模'],unit:'㎡'},
    {key:'location',label:'建设地址',aliases:['建设地址','项目地址','工程地点']},
    {key:'start_at',label:'开工日期',aliases:['实际开工日期','开工日期']},
    {key:'accepted_at',label:'竣工验收日期',aliases:['竣工验收日期','竣工验收备案日期']},
  ],
  procurement:[
    {key:'project_id',label:'采购编号',aliases:['项目编号','采购项目编号']},
    {key:'project_name',label:'采购项目',aliases:['采购项目名称','项目名称']},
    {key:'buyer',label:'采购单位',aliases:['采购单位','采购人名称']},
    {key:'budget',label:'预算',aliases:['预算金额'],unit:'万元'},
    {key:'ceiling',label:'最高限价',aliases:['最高限价'],unit:'万元'},
    {key:'award',label:'成交金额',aliases:['总成交金额','总中标金额','中标（成交）金额'],unit:'万元'},
    {key:'deadline',label:'响应截止',aliases:['开标时间','响应文件开启时间','提交投标文件截止时间']},
    {key:'duration',label:'履约期限',aliases:['合同履行期限','施工工期']},
  ],
}
const clean=(v:unknown)=>String(v??'').replace(/\s+/g,' ').trim()
const label=(v:unknown)=>clean(v).replace(/[：:]/g,'').replace(/[（(].*?[）)]/g,'').trim()
const field=(spec:Spec,raw:string,loc:string,originalLabel:string):PublicField=>{
  const units=originalLabel+' '+raw
  const unit=/公顷/.test(units)?'公顷':/亿元/.test(units)?'亿元':/万元/.test(units)?'万元':/万平方米/.test(units)?'万平方米':/平方米|㎡|m²|m2/i.test(units)?'㎡':/元/.test(units)&&spec.unit==='万元'?'元':''
  // A missing or composite value is not silently cast to zero or a number.
  const numeric=raw.replace(/[￥¥,，\s]/g,'').replace(/(万元|亿元|万平方米|平方米|㎡|公顷|元)(（人民币）|\(人民币\))?$/,'')
  const value=/^[-+]?\d+(\.\d+)?$/.test(numeric)&&spec.unit?Number(numeric):/^--?$|^暂无$|^无数据$/.test(raw)?null:raw
  return {key:spec.key,label:spec.label,value,unit,raw:raw.slice(0,400),locator:loc}
}
function tables(content:string):{rows:string[][];locator:string}[]{
  if(!/<(?:table|html|body)\b/i.test(content))return []
  const {document}=parseHTML(content)
  return Array.from(document.querySelectorAll('table')).filter(t=>!t.querySelector('table')).map((t,i)=>({locator:`table[${i+1}]`,rows:Array.from(t.querySelectorAll('tr')).map(r=>Array.from(r.querySelectorAll('th,td')).map(c=>clean(c.textContent)))}))
}
function textPairs(content:string):[string,string,string][]{
  const text=/<[a-z][\s\S]*>/i.test(content)?parseHTML(content).document.documentElement.textContent||'':content
  return text.split(/\n/).flatMap((line,i)=>{const m=line.replace(/^\s*[一二三四五六七八九十0-9]+[、.．]\s*/,'').match(/^\s*([^:：]{2,24})[:：]\s*(.{1,400})$/);return m?[[m[1],m[2],`line[${i+1}]`] as [string,string,string]]:[]})
}
function objectPairs(row:Record<string,unknown>,loc:string):[string,string,string][]{return Object.entries(row).filter(([,v])=>['number','string'].includes(typeof v)||v===null).map(([k,v])=>[k,clean(v),`${loc}.${k}`])}
function parseTableSource(source:Source,kind:Exclude<Adapter,'statistics'>):PublicRecord[]{
  const specs=specifications[kind],content=source.untrusted_text||''
  let groups:[string,string,string][][]=[]
  if(content.trim().startsWith('{')||content.trim().startsWith('[')){
    try{const v=JSON.parse(content),rows=Array.isArray(v)?v:Array.isArray(v.records)?v.records:Array.isArray(v.data)?v.data:[v];groups=rows.slice(0,50).filter((r:any)=>r&&typeof r==='object'&&!Array.isArray(r)).map((r:any,i:number)=>objectPairs(r,`record[${i+1}]`))}catch{return []}
  }else{
    const single:[string,string,string][]=[]
    for(const t of tables(content)){
      const header=t.rows[0]||[],recognized=header.map(h=>specs.find(s=>s.aliases.some(a=>label(a)===label(h))))
      const isHeader=recognized.filter(Boolean).length>=2 && recognized.some(s=>['parcel_id','project_id','project_name'].includes(s?.key||''))
      if(isHeader){for(let r=1;r<t.rows.length;r++){if(t.rows[r].length!==header.length)continue;groups.push(header.flatMap((h,c)=>recognized[c]?[[h,t.rows[r][c],`${t.locator}.row[${r+1}].cell[${c+1}]`] as [string,string,string]]:[]))}}
      else t.rows.forEach((row,r)=>{for(let c=0;c<row.length-1;c++)if(specs.some(s=>s.aliases.some(a=>label(a)===label(row[c]))))single.push([row[c],row[c+1],`${t.locator}.row[${r+1}].cell[${c+2}]`])})
    }
    if(single.length)groups.unshift([...single,...textPairs(content)])
    if(!groups.length)groups=[textPairs(content)]
  }
  return groups.flatMap((pairs,index)=>{
    const fields:PublicField[]=[]
    for(const [key,raw,loc] of pairs){const spec=specs.find(s=>s.aliases.some(a=>label(a)===label(key)));if(spec&&!fields.some(f=>f.key===spec.key))fields.push(field(spec,raw,loc,key))}
    const idField=fields.find(f=>f.key==='parcel_id'||f.key==='project_id'),name=fields.find(f=>f.key==='project_name')
    if(!idField&&!name)return []
    if(fields.length<2)return []
    return [{id:`${kind}-${createHash('sha256').update(source.id+':'+index+':'+String(idField?.value||name?.value)).digest('hex').slice(0,20)}`,adapter:kind,subject:String(name?.value||idField?.value).slice(0,240),scope:'object',period:source.published_at?.slice(0,10)||'',source_id:source.id,fields} as PublicRecord]
  })
}
/** NBS multidimensional exported query response: dimensions supply units and periods. */
export function adaptStatistics(source:Source):PublicRecord[]{
  let value:any;try{value=JSON.parse(source.untrusted_text||'')}catch{return []}
  const data=value.returndata||value
  if(!Array.isArray(data.datanodes)||!Array.isArray(data.wdnodes))return []
  const dimensions=new Map(data.wdnodes.map((d:any)=>[d.wdcode,new Map((d.nodes||[]).map((n:any)=>[n.code,n]))]))
  return data.datanodes.slice(0,100).flatMap((row:any,i:number)=>{
    if(!Array.isArray(row.wds))return []
    const ids=Object.fromEntries(row.wds.map((d:any)=>[d.wdcode,d.value]))
    const metric:any=(dimensions.get('zb') as Map<string,any>)?.get(ids.zb)
    const region:any=(dimensions.get('reg') as Map<string,any>)?.get(ids.reg)
    if(!metric||!ids.sj||!ids.reg)return []
    const raw=row.data?.data,hasData=row.data?.hasdata===true
    if(hasData&&(!['string','number'].includes(typeof raw)||String(raw).trim()===''||!Number.isFinite(Number(raw))))return []
    return [{id:`statistics-${createHash('sha256').update(source.id+JSON.stringify(ids)).digest('hex').slice(0,20)}`,adapter:'statistics',subject:region?.cname||region?.name||ids.reg,scope:'area',period:String(ids.sj),source_id:source.id,fields:[{key:String(ids.zb),label:metric.cname||metric.name||ids.zb,value:hasData?Number(raw):null,raw:hasData?String(raw):'',unit:metric.unit||'',locator:`returndata.datanodes[${i}]`},{key:'region_code',label:'行政区代码',value:ids.reg,unit:'',raw:ids.reg,locator:`returndata.datanodes[${i}].wds[reg]`}]} as PublicRecord]
  })
}
export const adaptLandchina=(s:Source)=>parseTableSource(s,'landchina')
export const adaptConstruction=(s:Source)=>parseTableSource(s,'construction')
export const adaptProcurement=(s:Source)=>parseTableSource(s,'procurement')
export function adaptOfficialSource(source:Source):{records:PublicRecord[];receipt:AdapterReceipt}{
  const host=(()=>{try{return new URL(source.url||'').hostname}catch{return ''}})(),content=source.untrusted_text||''
  let adapter:Adapter|null=host==='landchina.com'||host.endsWith('.landchina.com')?'landchina':host==='jzsc.mohurd.gov.cn'||host.startsWith('jzsc.')&&host.endsWith('.gov.cn')?'construction':host==='data.stats.gov.cn'?'statistics':host==='ccgp.gov.cn'||host.endsWith('.ccgp.gov.cn')?'procurement':null
  // Local government republication of a supply record keeps its actual source URL.
  if(!adapter&&publicSourceClass(source.url||'')==='official'){
    if(/电子监管号|宗地编号/.test(content))adapter='landchina'
    else if(/施工许可证[编]?号|工程项目编码/.test(content))adapter='construction'
  }
  const receipt:AdapterReceipt={source_id:source.id,adapter:adapter||'none',status:'unsupported',record_ids:[]}
  if(!adapter)return {records:[],receipt}
  if(source.content_status==='metadata_only'||!content.trim())return {records:[],receipt:{...receipt,status:'empty'}}
  if(content.length<5000&&/安全验证|验证码|人机验证|访问过于频繁|请先登录/i.test(content))return {records:[],receipt:{...receipt,status:'access_required'}}
  const records=adapter==='statistics'?adaptStatistics(source):parseTableSource(source,adapter)
  return {records,receipt:{...receipt,status:records.length?'success':'schema_changed',record_ids:records.map(r=>r.id)}}
}
