import { expect, test } from 'vitest'
import { benchmarkCosts, costBenchmarkEligibility } from '../../packages/construction-costs/benchmark'
import type { CostItem } from '../../packages/construction-costs/library'

const item = (overrides: Partial<CostItem> = {}): CostItem => ({
  id: 'record-a', source_id: 'source-a', project_name: '测试社区改造', project_code: 'PROJECT-A', lot_id: 'LOT-A',
  province: '浙江', city: '杭州', work_type: 'construction', amount_kind: 'contract_price',
  amount_basis: 'construction_contract', amount_yuan: 1000000, amount_original: '100万元', amount_quote: '合同价100万元',
  scope_level: 'construction_lot', scope_family: 'community_renewal', scope_quote: '老旧小区综合改造施工',
  scale_value: 1000, scale_unit: 'm2', scale_basis: 'building_floor_area', scale_quote: '建筑面积1000平方米',
  contract_date: '2024-12-31', award_date: null, price_date: null, price_date_quote: null, notice_date: '2025-01-02',
  version: 'version-a', source: { title: '测试公告', url: 'https://ggzy.zj.gov.cn/test', source_hash: 'a'.repeat(64), text_hash: 'b'.repeat(64), published_at: '2025-01-02' },
  ...overrides,
})

test('one project is a single reference using its price date instead of notice year', () => {
  expect(costBenchmarkEligibility(item())).toEqual({ eligible: true, reasons: [], price_date: '2024-12-31', price_year: 2024, intensity_yuan_per_m2: 1000 })
  const result = benchmarkCosts([item()])
  expect(result.excluded).toEqual([])
  expect(result.groups).toHaveLength(1)
  expect(result.groups[0]).toMatchObject({ n_records: 1, n_projects: 1, min_yuan_per_m2: 1000, median_yuan_per_m2: 1000, max_yuan_per_m2: 1000, status: 'single_reference', item_ids: ['record-a'], dimensions: { price_year: 2024 } })
})

test('area denominator, city, price year, scope, work type, and amount basis each partition the groups', () => {
  const variants: Partial<CostItem>[] = [
    {}, { scale_basis: 'renovation_site_area' }, { city: '宁波' }, { contract_date: '2023-12-31' },
    { scope_family: 'building_renewal' }, { scope_level: 'overall_project' },
    { work_type: 'epc' }, { amount_basis: 'overall_investment' },
  ]
  const result = benchmarkCosts(variants.map((variant, index) => item({ ...variant, id: `record-${index}` })))
  expect(result.groups).toHaveLength(variants.length)
  expect(result.excluded).toEqual([])
  expect(new Set(result.groups.map(group => group.key)).size).toBe(variants.length)
})

test('m2 aliases share a unit while different area bases stay separate', () => {
  const units = ['m2', 'm²', '㎡', '平方米', 'sqm']
  const result = benchmarkCosts(units.map((scale_unit, index) => item({ id: `unit-${index}`, scale_unit })))
  expect(result.excluded).toEqual([])
  expect(result.groups).toHaveLength(1)
  expect(result.groups[0].n_records).toBe(units.length)
  expect(result.groups[0].n_projects).toBe(1)
})

test('candidate bids and unsupported engineering services are excluded with reasons', () => {
  const records = [item({ id: 'candidate', amount_kind: 'candidate_bid' }),
    ...(['design', 'supervision', 'other'] as const).map(work_type => item({ id: work_type, work_type }))]
  const result = benchmarkCosts(records)
  expect(result.groups).toEqual([])
  expect(result.excluded).toHaveLength(4)
  expect(result.excluded.every(excluded => excluded.reasons.length > 0)).toBe(true)
  expect(result.excluded.find(excluded => excluded.id === 'candidate')?.reasons.join('')).toContain('候选')
})

test('price stages select only their corresponding dates and never fall back to announcement dates', () => {
  expect(costBenchmarkEligibility(item({ contract_date: null, award_date: '2024-03-01' })).eligible).toBe(false)
  expect(costBenchmarkEligibility(item({ amount_kind: 'winning_bid', award_date: null })).eligible).toBe(false)
  expect(costBenchmarkEligibility(item({ amount_kind: 'estimate', award_date: '2024-03-01' })).eligible).toBe(false)
  expect(costBenchmarkEligibility(item({ contract_date: null, price_date: '2023-06-07' })).price_year).toBe(2023)
  expect(costBenchmarkEligibility(item({ amount_kind: 'winning_bid', award_date: '2022-04-05', price_date: '2023-06-07' })).price_year).toBe(2022)
  const invalid = benchmarkCosts([item({ contract_date: null }), item({ id: 'bad-date', contract_date: '2024-02-30' })])
  expect(invalid.groups).toEqual([])
  expect(invalid.excluded).toHaveLength(2)
  expect(costBenchmarkEligibility(item({ contract_date: null })).price_year).toBeNull()
})

test('all allowed amount stages form separate groups even for the same project', () => {
  const stages = ['winning_bid', 'contract_price', 'settlement', 'budget', 'tender_ceiling', 'estimate'] as const
  const result = benchmarkCosts(stages.map(amount_kind => item({ id: amount_kind, amount_kind, price_date: '2024-01-01', award_date: '2024-01-01' })))
  expect(result.groups).toHaveLength(stages.length)
  expect(result.excluded).toEqual([])
  expect(result.groups.every(group => group.n_projects === 1 && group.status === 'single_reference')).toBe(true)
})

test('multiple notices and lots of one project cannot enlarge the independent project count', () => {
  const result = benchmarkCosts([
    item(), item({ id: 'record-b', source_id: 'source-b', lot_id: 'LOT-B', amount_yuan: 2000000 }),
    item({ id: 'record-c', project_name: '项目更名', project_code: ' PROJECT-A ', amount_yuan: 4000000 }),
  ])
  expect(result.groups[0]).toMatchObject({ n_records: 3, n_projects: 1, status: 'single_reference', median_yuan_per_m2: 2000 })
  expect(result.groups[0].note).toContain('不视为独立项目')
})

test('normalized project names identify projects with no code without using notice IDs', () => {
  const result = benchmarkCosts([
    item({ project_code: null }),
    item({ id: 'second-notice', source_id: 'different-source', project_code: null, project_name: ' 测试 社区改造 ' }),
    item({ id: 'other-project', project_code: null, project_name: '另一个社区改造' }),
  ])
  expect(result.groups[0]).toMatchObject({ n_records: 3, n_projects: 2, status: 'descriptive_group' })
})

test('missing project codes do not make duplicate same-name notices independent projects', () => {
  const records = [item(), item({ id: 'missing-code', project_code: null, project_name: ' 测试 社区改造 ' })]
  expect(benchmarkCosts(records).groups[0]).toMatchObject({ n_records: 2, n_projects: 1, status: 'single_reference' })
  // A second explicit project code remains a distinct project; the ambiguous uncoded
  // notice adds a record but supplies no evidence for a third independent project.
  expect(benchmarkCosts([...records, item({ id: 'another-code', project_code: 'PROJECT-B' })]).groups[0]).toMatchObject({ n_records: 3, n_projects: 2 })
})

test('descriptive medians handle odd and even counts without mutating input or ranking cities by cost', () => {
  const records = [item({ id: 'b', amount_yuan: 4000000 }), item({ id: 'a', project_code: 'PROJECT-B', amount_yuan: 1000000 })]
  const before = JSON.stringify(records)
  const result = benchmarkCosts(records)
  expect(result.groups[0]).toMatchObject({ min_yuan_per_m2: 1000, median_yuan_per_m2: 2500, max_yuan_per_m2: 4000, n_projects: 2, item_ids: ['a', 'b'] })
  expect(JSON.stringify(records)).toBe(before)
  expect(benchmarkCosts([...records].reverse())).toEqual(result)
  expect(result).not.toHaveProperty('mean')
  expect(result.groups[0]).not.toHaveProperty('confidence_interval')
})

test('telecom, road work area, subproject, and unknown scopes never create whole-project area costs', () => {
  const records = [item({ id: 'telecom', scope_family: 'telecom' }), item({ id: 'road', scope_family: 'road_renovation', scale_basis: 'road_area' }),
    item({ id: 'subproject', scope_level: 'subproject' }), item({ id: 'unknown', scope_level: undefined })]
  const result = benchmarkCosts(records)
  expect(result.groups).toEqual([])
  expect(result.excluded).toHaveLength(records.length)
  expect(records.every(record => costBenchmarkEligibility(record).intensity_yuan_per_m2 === null)).toBe(true)
})

test('a complete road and drainage construction lot uses its full renovation site area', () => {
  const result = benchmarkCosts([item({ scope_family: 'road_drainage_renewal', scope_level: 'construction_lot', scale_basis: 'renovation_site_area' })])
  expect(result.excluded).toEqual([])
  expect(result.groups[0]).toMatchObject({ n_records: 1, min_yuan_per_m2: 1000, dimensions: { scope_family: 'road_drainage_renewal', scale_basis: 'renovation_site_area' } })
})

test('missing amount or area basis, non-area scale, and invalid arithmetic are explicit exclusions', () => {
  const variants: Partial<CostItem>[] = [
    { amount_basis: undefined }, { scale_basis: undefined }, { city: null }, { scale_value: null },
    { scale_unit: '户' }, { scale_value: 0 }, { scale_value: Number.NaN },
    { amount_yuan: Number.POSITIVE_INFINITY }, { amount_yuan: -1 }, { scale_value: Number.MIN_VALUE },
  ]
  const result = benchmarkCosts(variants.map((variant, index) => item({ ...variant, id: `invalid-${index}` })))
  expect(result.groups).toEqual([])
  expect(result.excluded).toHaveLength(variants.length)
  expect(result.excluded.every(excluded => excluded.reasons.length > 0)).toBe(true)
})

test('missing scope family falls back to an explicit accepted level and empty input is stable', () => {
  expect(benchmarkCosts([item({ scope_family: undefined })]).groups[0].dimensions.scope_family).toBe('construction_lot')
  expect(benchmarkCosts([])).toEqual({ groups: [], excluded: [] })
})
