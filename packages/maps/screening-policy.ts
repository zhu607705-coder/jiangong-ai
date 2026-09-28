import type { MapScreenBounds, MapScreenCell, MapScreenContext, MapScreenProfile, MapScreenTheme, MapScreenEvidence } from '../../apps/host/generated/contracts'
import { decisionFactors, factorTier, decisionSignals } from './decision-factors'
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
}
export const SCREEN_THEMES: Record<MapScreenTheme,{label:string}> = {
  overall:{label:'综合研判'},implementation:{label:'实施条件'},adaptation:{label:'空间适配'},
  demand:{label:'使用需求'},operations:{label:'运营组织'},resources:{label:'资源安排'},access:{label:'交通衔接'},
}
export const SCREEN_TIERS = {
  pending:{label:'读取中',color:'#b2bcc6'},strong:{label:'进入研究',color:'#258b73'},
  moderate:{label:'核查条件',color:'#547db0'},sparse:{label:'存在阻点',color:'#b87b43'},
  empty:{label:'待研判',color:'#a3acb7'},incomplete:{label:'待研判',color:'#a3acb7'},
} as const
export const INVESTIGATION_GAPS: string[] = []
export const SCREEN_METHOD = 'object-boundaries_source-factors-v1'
export function assertScreenBounds(b:MapScreenBounds):void {
  if (![b.west,b.east,b.south,b.north].every(Number.isFinite) || b.west < -180 || b.east > 180 || b.south < -90 || b.north > 90 || b.east <= b.west || b.north <= b.south || b.east-b.west>.060001 || b.north-b.south>.060001) throw new Error('请放大到街区范围。')
}
export function contextComparable(context:MapScreenContext|null):boolean {
  return !!context && decisionFactors(context).some(f => f.state !== 'unknown')
}
export function classifyCells(input:MapScreenCell[],theme:MapScreenTheme):MapScreenCell[] {
  return input.map(c => {
    const factors = c.factors || (c.context ? decisionFactors(c.context) : [])
    return {...c,factors,tier:c.context ? factorTier(factors,theme) : 'pending',rank:null,metric_value:null}
  })
}
export function contextHeadline(context:MapScreenContext):string {
  return decisionSignals(context)[0]?.implication || '选择研究方向，查看这处空间的参与路径。'
}
