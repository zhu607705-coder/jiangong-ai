import {channelOf,hash} from './domain'

export const CAMPAIGN_POLICY='public-corpus-v1'
// A finite, inspectable coverage plan; query count is not a document or sample count.
const cities=['杭州','宁波','温州','嘉兴','湖州','绍兴','金华','衢州','舟山','台州','丽水','上海','广州','深圳','佛山','东莞','珠海','惠州']
const topics=[
  '老旧小区改造 工程预算 招标控制价','老旧小区改造 中标 合同金额','老旧小区改造 竣工结算 审计',
  '老旧小区 综合整治 改造内容 楼栋 户数','老旧小区 自主更新 原拆原建 资金',
  '老旧小区 二次供水 管网改造 投资','老旧小区 雨污分流 管网 工程量',
  '老旧小区 加装电梯 造价 运维','老旧小区 屋面 外立面 修缮',
  '老旧小区 消防 无障碍 适老化','老旧小区 结构安全 鉴定 加固',
  '社区服务中心 面积 开放时间 利用率','社区食堂 用餐人数 补贴 运营',
  '社区养老 服务人次 财政补贴','社区改造 居民满意度 问卷 调查',
  '老旧小区 停车 充电设施 收费','老旧小区 物业 长效维护 费用',
  '自主更新 居民出资 安置 回迁','老旧小区改造 社会效益 绩效评价',
  '老旧小区改造 全生命周期 运维 成本',
]
const families=[
  {label:'政府原件',domains:['gov.cn']},
  {label:'公共交易',domains:['ggzy.zj.gov.cn','ygp.gdzwfw.gov.cn','shggzy.com']},
  {label:'高校研究',domains:['edu.cn']},
]
export type CampaignQuery={id:string;query:string;city:string;topic:string;family:string;channel:ReturnType<typeof channelOf>}
export function campaignPlan(year=new Date().getUTCFullYear()):CampaignQuery[]{
  const rows:CampaignQuery[]=[]
  // Interleave regions/topics/families before moving to the next historical year.
  for(const period of ['',...Array.from({length:7},(_,i)=>String(year-i))])for(const topic of topics)for(const city of cities)for(const family of families){
    const domains=family.label==='公共交易'?[city==='上海'?'shggzy.com':['广州','深圳','佛山','东莞','珠海','惠州'].includes(city)?'ygp.gdzwfw.gov.cn':'ggzy.zj.gov.cn']:family.domains
    const query=`${city} ${topic} site:${domains[0]}${period?` after:${period}-01-01 before:${Number(period)+1}-01-01`:''}`
    const id=hash(CAMPAIGN_POLICY+'|'+query)
    rows.push({id,query,city,topic,family:family.label,channel:channelOf({id:'bulk-'+hash(city+'|'+domains[0]).slice(0,20),name:`${city} · ${family.label}`,url:'https://'+domains[0],domains,kind:'native_search',config:{query:topic},city:'',enabled:false,interval_minutes:10080,first_party:family.label!=='高校研究'})})
  }
  return rows
}
export function beijingDay(now=new Date()){return new Date(now.getTime()+8*3600000).toISOString().slice(0,10)}
export function dailyPace(target:number,now:Date){const start=Date.parse(beijingDay(now)+'T00:00:00+08:00');return Math.floor((now.getTime()-start)/86400000*target)+1}
