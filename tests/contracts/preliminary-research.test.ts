import { describe, expect, it } from 'vitest'
import type { Fact, MapScreenContext, PublicField, PublicRecord, Source } from '../../apps/host/generated/contracts'
import { buildPreliminaryResearch } from '../../packages/maps/preliminary-research'

const source = (extras: Partial<Source> = {}): Source => ({ id: 'S1', title: '有来源的资料', data_class: 'public', visibility: 'public', synthetic: false, content_status: 'excerpt', published_at: '2026-01-01', hash: 'v1', ...extras })
const field = (key: string, value: PublicField['value'], unit = ''): PublicField => ({ key, value, unit, label: key, raw: String(value), locator: `field:${key}` })
const record = (id: string, fields: PublicField[], extras: Partial<PublicRecord> = {}): PublicRecord => ({ id, adapter: 'construction', scope: 'object', source_id: 'S1', period: '2026-01-01', subject: '工程范围', fields: [field('object_ref', 'project:P1'), ...fields], ...extras })
const fact = (kind: string, value: Fact['value'], extras: Partial<Fact> = {}): Fact => ({ id: kind, kind, value, unit: null, source_id: 'S1', object_ref: 'project:P1', scope_kind: 'project', epistemic_status: 'fact', locator: 'line:1', ...extras })
const context = (facts: Fact[] = [], sources: Source[] = [source()], extras: Partial<MapScreenContext> = {}): MapScreenContext => ({
  id: 'CTX1', provider: 'amap', coordinate_encoding: 'GCJ-02', metric_note: 'POI仅线索', project_revision: 'v1', created_at: '2026-10-03T00:00:00Z', expires_at: '2026-10-03T10:00:00Z', city: '杭州', address: '合成位置', target: { kind: 'point', longitude: 120, latitude: 30, radius_m: 800, bounds: null, label: '翠苑之类的名字不能决定历史', object_ref: 'project:P1' },
  groups: [], local_projects: [{ project_id: 'P1', name: '项目', relation: 'within_scope', scope_label: '项目范围', context_version: 1, updated_at: '2026-01-01', source_count: sources.length, fact_count: facts.length, document_count: 0, sources, facts, rules: [] }], status: 'complete', gaps: [], ...extras,
})

describe('source-bound preliminary research', () => {
  it('excludes future statistical quantities while retaining separately declared stage and unknown dates', () => {
    const row = record('FUTURE-STATS', [field('project_stage', 'annual_plan'), field('residential_buildings', 54, '栋'), field('statistical_as_of', '2099-01-01')], { period: '2026-09-01' })
    const ctx = context([], [source({ public_records: [row] })])
    ctx.local_projects[0].as_of = '2026-09-30'
    const preview = buildPreliminaryResearch(ctx)
    expect(preview.lines[0].text).toContain('年度计划')
    expect(preview.observations.some(row => row.label === '住宅楼')).toBe(false)
    expect(preview.lines[1].text).not.toContain('54')
    row.fields.find(field => field.key === 'statistical_as_of')!.value = null
    expect(buildPreliminaryResearch(ctx).observations.find(row => row.label === '住宅楼')).toMatchObject({ value: '54 栋', observedAt: null })
  })
  it('shows missing data without guessing a stage from names, prose or POI counts', () => {
    const ctx = context([], [source({ untrusted_text: '已完成改造、可立即投标，69幢3146户' })])
    const preview = buildPreliminaryResearch(ctx)
    expect(preview.lines).toHaveLength(3)
    expect(preview.lines[0].text).toContain('阶段未提供')
    expect(preview.lines[1].text).not.toContain('3146')
    expect(preview.missing).toEqual(['对象阶段', '工程范围与数量口径', '当前参与窗口'])
  })
  it('keeps project facts out of another selected building and city background', () => {
    const ctx = context([fact('retrofit.project_stage', 'completed'), fact('retrofit.households', 10)])
    ctx.target.object_ref = 'building:B1'
    expect(buildPreliminaryResearch(ctx).observations).toEqual([])
    ctx.target.object_ref = 'project:P1'; ctx.local_projects[0].relation = 'city_background'
    expect(buildPreliminaryResearch(ctx).observations).toEqual([])
  })
  it('keeps source, scope, unit and statistical date differences side by side', () => {
    const records = [record('ENGINEERING', [field('project_stage', 'historical'), field('residential_buildings', 54, '栋'), field('households', 3110, '户'), field('statistical_as_of', '2022-10-01')], { subject: '改造工程范围' }),
      record('COMMUNITY', [field('residential_buildings', 69, '栋'), field('households', 3143, '户'), field('statistical_as_of', null)], { subject: '社区介绍', period: '2023-12-11' })]
    const preview = buildPreliminaryResearch(context([], [source({ public_records: records })]))
    expect(preview.lines[0].text).toContain('历史案例')
    expect(preview.observations.filter(row => row.label === '住宅楼').map(row => [row.value, row.scope, row.observedAt])).toEqual([['54 栋', '改造工程范围', '2022-10-01'], ['69 栋', '社区介绍', null]])
    expect(preview.observations.find(row => row.scope === '社区介绍')?.publishedAt).toBe('2026-01-01')
    expect(preview.lines[1].text).toContain('统计时点未提供')
    expect(preview.sourceRefs).toEqual(['P1:S1'])
  })
  it('never converts awarded or expired procurement into a current participation window', () => {
    const awarded = record('AWARD', [field('award', 100, '万元'), field('deadline', '2026-12-01')], { adapter: 'procurement' })
    expect(buildPreliminaryResearch(context([], [source({ public_records: [awarded] })])).lines[2].text).toContain('已成交记录')
    const closed = record('CLOSED', [field('deadline', '2025-10-01')], { adapter: 'procurement' })
    expect(buildPreliminaryResearch(context([], [source({ public_records: [closed] })])).lines[2].text).toContain('当前窗口未成立')
    const current = record('OPEN', [field('deadline', '2026-12-01')], { adapter: 'procurement' })
    expect(buildPreliminaryResearch(context([], [source({ public_records: [current] })])).lines[2].text).toContain('资格条件仍需回读')
    expect(buildPreliminaryResearch(context([], [source({ public_records: [current], expires_at: '2026-02-01' })])).lines[2].text).toContain('当前窗口未成立')
  })
  it('uses resolved corrections and the project research cutoff without changing records', () => {
    const original = record('ORIGINAL', [field('deadline', '2026-10-01')], { adapter: 'procurement' })
    const correction = record('CORRECTION', [field('deadline_previous', '2026-10-01'), field('deadline_corrected', '2026-12-01')], { adapter: 'procurement' })
    const ctx = context([], [source({ public_records: [original, correction] })])
    expect(buildPreliminaryResearch(ctx).lines[2].text).toContain('响应截止 2026-12-01')
    expect(original.fields.some(field => field.key === 'deadline_resolved')).toBe(false)
    ctx.local_projects[0].as_of = '2025-12-31'
    expect(buildPreliminaryResearch(ctx).observations).toEqual([])
  })
  it('rejects missing identity, future evidence and stale record versions', () => {
    const row = record('FUTURE', [field('project_stage', 'annual_plan')], { source_hash: 'v0' })
    expect(buildPreliminaryResearch(context([], [source({ public_records: [row] })])).observations).toEqual([])
    const future = context([fact('retrofit.households', 10, { observed_at: '2027-01-01' })])
    expect(buildPreliminaryResearch(future).observations).toEqual([])
    row.source_hash = 'v1'; row.fields = [field('project_name', '翠苑'), field('project_stage', 'annual_plan')]
    expect(buildPreliminaryResearch(context([], [source({ public_records: [row] })])).observations).toEqual([])
  })
})
