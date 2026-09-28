import type { Source } from '../../apps/host/generated/contracts'

export const RESEARCH_POLICY = 'public-adapters-v8'
/** Publication age alone is not expiry; old, still-applicable archives survive. */
export function sourceCurrentAt(source:Source,asOf:string):boolean {
  const cutoff=Date.parse(asOf),published=Date.parse(source.published_at||'')
  if(!Number.isFinite(cutoff)||!Number.isFinite(published)||published>cutoff)return false
  if(source.date_status&&source.date_status!=='verified')return false
  if(source.expires_at!==undefined){const expires=Date.parse(source.expires_at);if(!Number.isFinite(expires)||expires<=cutoff)return false}
  return true
}
export const PUBLIC_SOURCES = [
  {id:'landchina',name:'中国土地市场网',domain:'landchina.com',use:'宗地、供地、用途与成交'},
  {id:'construction',name:'四库一平台',domain:'jzsc.mohurd.gov.cn',use:'工程身份、施工许可与参建单位'},
  {id:'statistics',name:'国家统计局',domain:'data.stats.gov.cn',use:'地区、指标、统计期和单位'},
  {id:'procurement',name:'中国政府采购网',domain:'ccgp.gov.cn',use:'采购需求、预算、成交及履约期限'},
] as const
export function publicSourceClass(url:string):'database'|'official'|'primary'|'supplementary' {
  let host:string
  try { const parsed=new URL(url);if(!['https:','http:'].includes(parsed.protocol)||parsed.username||parsed.password)return 'supplementary';host=parsed.hostname.toLowerCase() } catch {return 'supplementary'}
  if(PUBLIC_SOURCES.some(s=>host===s.domain||host.endsWith('.'+s.domain)))return 'database'
  if(host==='gov.cn'||host.endsWith('.gov.cn'))return 'official'
  if(host.endsWith('.edu.cn'))return 'primary'
  return 'supplementary'
}
export function safePublicUrl(value:string):string|null {
  try {const u=new URL(value);if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.port||!u.hostname.includes('.')||/^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(u.hostname)||u.hostname.includes(':'))return null;u.hash='';return u.href} catch{return null}
}
export function publicSearchPlan(place:string,purpose:string):string[] {
  const name=place.replace(/[\r\n<>]/g,' ').trim().slice(0,180)
  return [
    `${name} 工程 改造 采购 成交 site:ccgp.gov.cn`,
    `${name} 土地 用途 供地 site:landchina.com`,
    `${name} 工程项目 施工许可 site:jzsc.mohurd.gov.cn`,
    `${name} ${purpose} 运营 招商 服务`,
  ]
}
