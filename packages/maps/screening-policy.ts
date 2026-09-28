import type { MapScreenBounds, MapScreenCell, MapScreenContext, MapScreenProfile, MapScreenTheme } from '../../apps/host/generated/contracts'

export const EVIDENCE_GROUPS = [
  { key: 'transit', label: '公交轨道记录', types: '150500|150700|150200', note: '含站点与出入口，不是线路数' },
  { key: 'activity', label: '商业生活记录', types: '050000|060000|070000', note: '已有供给，不等于客流或需求' },
  { key: 'work_live', label: '居住办公记录', types: '120000|170000', note: '场所记录，不是人口或岗位数' },
  { key: 'civic', label: '文教医体记录', types: '080000|090000|140000', note: '设施线索，不代表服务容量' },
] as const
export const SCREEN_PROFILES: Record<MapScreenProfile, { label: string; premise: string }> = {
  balanced: { label: '片区更新', premise: '结合已有项目证据与区位事实，核查存量利用和实施前提。' },
  commercial: { label: '商业配套', premise: '关注配套供给、潜在竞争和需求证据，已有商店不等于新增需求。' },
  enterprise: { label: '产业办公', premise: '关注居住办公节点和企业适配；企业规模、产业链和实施能力需要项目材料。' },
}
export const SCREEN_THEMES: Record<MapScreenTheme, {label: string; unit: string; breaks: [number, number]; note: string}> = {
  transit: {label: '公交轨道记录', unit: '条', breaks: [5, 20], note: '含站点和出入口；不是线路数或路网可达性。'},
  activity: {label: '商业生活记录', unit: '条', breaks: [20, 100], note: '已有供给；不代表客流、消费需求或商业价值。'},
  work_live: {label: '居住办公记录', unit: '条', breaks: [10, 50], note: '场所记录；不代表人口、岗位或空置率。'},
  civic: {label: '文教医体记录', unit: '条', breaks: [5, 20], note: '设施线索；不代表服务容量。'},
  projects: {label: '已定位真实项目', unit: '个', breaks: [2, 5], note: '本地已接入且定位落入格网的项目；城市背景和合成样例不计入。'},
}
export const SCREEN_TIERS = {
  pending: { label: '采集中', color: '#a6b7c3' },
  strong: { label: '记录较多', color: '#25bfa0' },
  moderate: { label: '记录中等', color: '#4e9bcf' },
  sparse: { label: '记录较少', color: '#cda057' },
  empty: { label: '本次无记录', color: '#81929e' },
  incomplete: { label: '信息不全', color: '#8d879e' },
} as const
export const INVESTIGATION_GAPS = [
  '权属、租约、现行规划及实施边界尚未核实',
  '租金、成交、获取及改造成本缺失，无法测算收益',
  '常住与就业人口、客流及真实需求缺失',
  '结构、消防、用途变更和企业实施能力尚未核实',
]
export const SCREEN_METHOD = 'fixed-count-bands-v1'

export function assertScreenBounds(b: MapScreenBounds): void {
  if (![b.west, b.east, b.south, b.north].every(Number.isFinite) || b.west < -180 || b.east > 180 || b.south < -90 || b.north > 90 || b.east <= b.west || b.north <= b.south || b.east - b.west > .060001 || b.north - b.south > .060001) throw new Error('请放大到街区范围后再进行初筛。')
}
export function screeningGrid(bounds: MapScreenBounds): MapScreenCell[] {
  assertScreenBounds(bounds)
  return Array.from({ length: 9 }, (_, i) => {
    const row = Math.floor(i / 3), col = i % 3
    const x = (bounds.east - bounds.west) / 3, y = (bounds.north - bounds.south) / 3
    return { id: `C${i + 1}`, label: `片区 ${i + 1}`, bounds: { west: bounds.west + col * x, east: bounds.west + (col + 1) * x, north: bounds.north - row * y, south: bounds.north - (row + 1) * y },
      context: null, metric_value: null, tier: 'pending', rank: null }
  })
}
export function contextComparable(context: MapScreenContext | null): boolean {
  return !!context && EVIDENCE_GROUPS.every(g => context.groups.some(e => e.key === g.key && e.status === 'available' && e.reported_count !== null))
}
export function classifyCells(input: MapScreenCell[], theme: MapScreenTheme): MapScreenCell[] {
  const cells = structuredClone(input)
  const [low, high] = SCREEN_THEMES[theme].breaks
  for (const c of cells) {
    const group = c.context?.groups.find(g => g.key === theme)
    c.metric_value = !c.context ? null : theme === 'projects' ? c.context.local_projects.filter(p => p.relation === 'within_scope').length : group?.status === 'available' ? group.reported_count : null
    const value = c.metric_value
    c.tier = value === null ? 'incomplete' : value === 0 ? 'empty' : value >= high ? 'strong' : value >= low ? 'moderate' : 'sparse'
    c.rank = null
  }
  for (const c of cells) if (c.metric_value !== null && c.metric_value > 0) c.rank = 1 + cells.filter(other => other.metric_value !== null && other.metric_value > c.metric_value!).length
  return cells
}

export function contextHeadline(context: MapScreenContext): string {
  if (!contextComparable(context)) return '部分资料待补，暂不作完整比较'
  const active = context.groups.filter(g => (g.reported_count || 0) > 0).length
  return active >= 3 ? '周边区位线索较丰富，可继续核查适配方向' : active ? '已有部分区位线索，仍需补查实际使用和需求' : '本轮未检索到相关记录，需核实覆盖与现状'
}
