import type { CostItem } from './library'

const priceKinds = new Set(['winning_bid', 'contract_price', 'settlement', 'budget', 'tender_ceiling', 'estimate'])
const overallScopes = new Set(['construction_lot', 'overall_project', 'overall_project_investment', 'epc_package'])
const areaBases = new Set(['building_floor_area', 'renovation_site_area'])
const partialScope = /(?:^|[_\s-])(?:telecom(?:munications?)?|subproject|sub_project|partial)(?:$|[_\s-])|通信|分项|局部/i
const clean = (value: string | null | undefined) => value?.normalize('NFKC').trim() || ''
const identityText = (value: string) => clean(value).replace(/\s+/g, '').toLowerCase()

export type CostBenchmarkEligibility = {
  eligible: boolean
  reasons: string[]
  price_date: string | null
  price_year: number | null
  intensity_yuan_per_m2: number | null
}
export type CostBenchmarkDimensions = {
  province: string
  city: string
  work_type: CostItem['work_type']
  amount_kind: CostItem['amount_kind']
  scope_family: string
  scope_level: string
  scale_basis: string
  price_year: number
  amount_basis: string
}
export type CostBenchmarkGroup = {
  id: string
  key: string
  dimensions: CostBenchmarkDimensions
  n_records: number
  n_projects: number
  min_yuan_per_m2: number
  median_yuan_per_m2: number
  max_yuan_per_m2: number
  status: 'single_reference' | 'descriptive_group'
  item_ids: string[]
  note: string
}
export type CostBenchmarkResult = { groups: CostBenchmarkGroup[]; excluded: { id: string; reasons: string[] }[] }
export type CostBenchmark = CostBenchmarkResult
export type CostEligibility = CostBenchmarkEligibility

function validDate(value: string | null | undefined): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const parsed = new Date(value + 'T00:00:00Z')
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null
}

/** Dates have already been checked against source text by the library importer. */
export function costBenchmarkEligibility(item: CostItem): CostBenchmarkEligibility {
  const reasons: string[] = []
  const priceDate = (item.amount_kind === 'contract_price' ? validDate(item.contract_date)
    : item.amount_kind === 'winning_bid' ? validDate(item.award_date) : null) || validDate(item.price_date)
  if (!priceKinds.has(item.amount_kind)) reasons.push(item.amount_kind === 'candidate_bid'
    ? '候选中标报价尚未确认为中标价。' : '该价格阶段不参与造价基准。')
  if (item.work_type !== 'construction' && item.work_type !== 'epc') reasons.push('仅施工或 EPC 工程金额参与本组造价基准。')
  if (!clean(item.province) || !clean(item.city)) reasons.push('缺少明确省份或城市。')
  if (!clean(item.amount_basis)) reasons.push('缺少明确金额口径。')
  if (!overallScopes.has(clean(item.scope_level))) reasons.push('工程范围并非已明确的整体项目或施工标段。')
  if (partialScope.test(clean(item.scope_family))) reasons.push('通信分项或其他局部工程不参与整体改造面积造价基准。')
  if (!areaBases.has(clean(item.scale_basis))) reasons.push('缺少建筑面积或改造场地面积口径。')
  if (!/^(?:m2|sqm|平方米)$/.test(clean(item.scale_unit).toLowerCase())) reasons.push('规模单位须为平方米。')
  if (item.scale_value === null || !Number.isFinite(item.scale_value) || item.scale_value <= 0) reasons.push('缺少有效的正数面积。')
  if (!Number.isFinite(item.amount_yuan) || item.amount_yuan <= 0) reasons.push('缺少有效的正数金额。')
  if (!priceDate) reasons.push('缺少与价格阶段对应的已核验日期。')
  const intensity = item.scale_value && item.amount_yuan / item.scale_value
  if (reasons.length === 0 && (!Number.isFinite(intensity) || intensity! <= 0)) reasons.push('面积造价计算结果无效。')
  return {
    eligible: reasons.length === 0, reasons, price_date: priceDate,
    price_year: priceDate ? Number(priceDate.slice(0, 4)) : null,
    intensity_yuan_per_m2: reasons.length === 0 ? intensity! : null,
  }
}

function dimensions(item: CostItem, priceYear: number): CostBenchmarkDimensions {
  return {
    province: clean(item.province), city: clean(item.city), work_type: item.work_type, amount_kind: item.amount_kind,
    scope_family: clean(item.scope_family) || clean(item.scope_level), scope_level: clean(item.scope_level),
    scale_basis: clean(item.scale_basis), price_year: priceYear, amount_basis: clean(item.amount_basis),
  }
}
function projectCount(items: CostItem[]): number {
  const namesWithCode = new Set<string>(), projects = new Set<string>()
  const nameKey = (item: CostItem) => JSON.stringify([identityText(item.province), identityText(item.city || ''), identityText(item.project_name)])
  for (const item of items) {
    if (!clean(item.project_code)) continue
    projects.add(JSON.stringify([identityText(item.province), identityText(item.city || ''), 'code', identityText(item.project_code!)]))
    namesWithCode.add(nameKey(item))
  }
  for (const item of items) {
    // A notice missing its code cannot establish an extra independent project when
    // the same normalized name already has a code. Distinct explicit codes remain distinct.
    if (!clean(item.project_code) && !namesWithCode.has(nameKey(item))) projects.add('name:' + nameKey(item))
  }
  return projects.size
}

/** Descriptive record-level statistics only; this does not estimate a population interval. */
export function benchmarkCosts(items: CostItem[]): CostBenchmarkResult {
  const excluded: CostBenchmarkResult['excluded'] = []
  const bins = new Map<string, { dimensions: CostBenchmarkDimensions; rows: { item: CostItem; value: number }[] }>()
  for (const item of items) {
    const eligible = costBenchmarkEligibility(item)
    if (!eligible.eligible) { excluded.push({ id: item.id, reasons: eligible.reasons }); continue }
    const dimension = dimensions(item, eligible.price_year!), key = JSON.stringify(dimension)
    const bin = bins.get(key) || { dimensions: dimension, rows: [] }
    bin.rows.push({ item, value: eligible.intensity_yuan_per_m2! })
    bins.set(key, bin)
  }
  const groups = [...bins.entries()].map(([key, bin]): CostBenchmarkGroup => {
    const values = bin.rows.map(row => row.value).sort((a, b) => a - b)
    const midpoint = Math.floor(values.length / 2)
    const nProjects = projectCount(bin.rows.map(row => row.item))
    return {
      id: 'cost-benchmark:' + encodeURIComponent(key), key, dimensions: bin.dimensions,
      n_records: values.length, n_projects: nProjects,
      min_yuan_per_m2: values[0],
      median_yuan_per_m2: values.length % 2 ? values[midpoint] : values[midpoint - 1] + (values[midpoint] - values[midpoint - 1]) / 2,
      max_yuan_per_m2: values[values.length - 1],
      status: nProjects < 2 ? 'single_reference' : 'descriptive_group',
      item_ids: bin.rows.map(row => row.item.id).sort(),
      note: '按本组记录计算描述性统计；同一项目的多条记录不视为独立项目样本。',
    }
  })
  // Stable grouping order is lexical, never a ranking of costs across cities.
  groups.sort((a, b) => a.key.localeCompare(b.key))
  excluded.sort((a, b) => a.id.localeCompare(b.id))
  return { groups, excluded }
}
