import type { MapScreenBounds, MapScreenCell, MapScreenContext, MapScreenProfile, MapScreenTheme, MapScreenEvidence } from '../../apps/host/generated/contracts'
import { decisionFactors, factorTier, decisionSignals, neighborhoodMapAdvice } from './decision-factors'
import { dashboardDimensions, dashboardPolicy } from '../decision/dashboard'
export { decisionSignals }
export const EVIDENCE_GROUPS = [
  { key:'transit', label:'交通节点', types:'150500|150700|150200', note:'站点、出入口及位置' },
  { key:'activity', label:'商业配套', types:'050000|060000|070000', note:'餐饮、购物及生活服务' },
  { key:'work_live', label:'居住与办公', types:'120000|170000', note:'楼宇、住宅及场所分类' },
  { key:'civic', label:'公共服务', types:'080000|090000|140000', note:'文教、医疗及体育设施' },
] as const
/** A capped total does not invalidate the provider's individually returned places. */
export const usableMapEvidence = (group: MapScreenEvidence): boolean => group.status === 'available' || group.status === 'capped' && group.sample.length > 0
export const SCREEN_PROFILES: Record<MapScreenProfile,{label:string;premise:string}> = {
  balanced:{label:'片区更新',premise:'比较存量利用、实施条件和分期路径。'},
  commercial:{label:'商业配套',premise:'识别使用人群、竞争供给和运营入口。'},
  enterprise:{label:'产业办公',premise:'识别产业需求、建筑适配和企业参与方式。'},
  neighborhood:{label:'老旧小区改造',premise:'围绕居民家庭需求，比较基础、完善、提升改造与实施资金和维护条件。'},
}
export function screenThemes(profile?:MapScreenProfile):typeof SCREEN_THEMES {
  if(profile!=='neighborhood')return SCREEN_THEMES
  return {...SCREEN_THEMES,...Object.fromEntries(dashboardDimensions(dashboardPolicy(profile)).map(d=>[d.key,{label:d.label}]))}
}
export const SCREEN_THEMES: Record<MapScreenTheme,{label:string}> = {
  overall:{label:'综合研判'},implementation:{label:'实施入口'},adaptation:{label:'空间工程'},
  demand:{label:'需求客群'},supply:{label:'供给竞争'},operations:{label:'运营回款'},resources:{label:'投入交付'},access:{label:'交通衔接'},
}
export const SCREEN_TIERS = {
  pending:{label:'读取中',color:'#b2bcc6'},strong:{label:'优先研究',color:'#418577'},
  moderate:{label:'按项推进',color:'#648899'},sparse:{label:'调整路径',color:'#b18b59'},
  empty:{label:'待研判',color:'#a3acb7'},incomplete:{label:'待研判',color:'#a3acb7'},
} as const
export const INVESTIGATION_GAPS: string[] = []
export const SCREEN_METHOD = 'object-boundaries_six-dimension-v2'
export function assertScreenBounds(b:MapScreenBounds):void {
  if (![b.west,b.east,b.south,b.north].every(Number.isFinite) || b.west < -180 || b.east > 180 || b.south < -90 || b.north > 90 || b.east <= b.west || b.north <= b.south || b.east-b.west>.060001 || b.north-b.south>.060001) throw new Error('请放大到街区范围。')
}
export function contextComparable(context:MapScreenContext|null,profile?:MapScreenProfile):boolean {
  return !!context && decisionFactors(context,context.created_at,profile).some(f => f.state !== 'unknown')
}
export function classifyCells(input:MapScreenCell[],theme:MapScreenTheme,evaluatedAt?:string,profile?:MapScreenProfile):MapScreenCell[] {
  return input.map(c => {
    const factors = profile==='neighborhood'?(c.context?decisionFactors(c.context,evaluatedAt,profile):[]):c.factors || (c.context ? decisionFactors(c.context,evaluatedAt,profile) : [])
    if(profile==='neighborhood'){
      const action=c.context?neighborhoodMapAdvice(c.context):undefined
      const tier=!c.context?'pending':action?.decision==='proceed'?'strong':action?.decision==='defer'?'sparse':action?.decision==='supplement'?'moderate':'incomplete'
      return {...c,factors,tier,rank:null,metric_value:null} as MapScreenCell
    }
    const existing=factorTier(factors,theme)
    // Explicit object-bound blockers take precedence over model fit levels.
    let tier:MapScreenCell['tier']=c.context ? existing : 'pending'
    const conflict=factors.some(f=>f.conflict&&(theme==='overall'||f.key===(theme==='supply'?'demand':theme)))
    if(c.context&&existing!=='sparse'&&!conflict&&c.dashboard&&theme!=='access'){
      const rows=theme==='overall'?c.dashboard.dimensions:c.dashboard.dimensions.filter(d=>d.key===theme)
      const values=rows.flatMap(d=>d.value===null?[]:[d.value])
      if(values.length){
        tier=values.some(v=>v<=2)?'sparse':values.length===(theme==='overall'?6:1)&&values.every(v=>v>=3.5)?'strong':'moderate'
      }
    }
    return {...c,factors,tier,rank:null,metric_value:null}
  })
}
export function contextHeadline(context:MapScreenContext):string {
  return decisionSignals(context)[0]?.implication || '选择研究方向，查看这处空间的参与路径。'
}
