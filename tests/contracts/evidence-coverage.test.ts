import { describe, expect, it } from 'vitest'
import { buildImportGraph } from '../../apps/workspace/src/imports/graph-model'
import { buildEvidenceCoverage } from '../../apps/workspace/src/imports/evidence-coverage'
import type { Fact, Source } from '../../apps/host/generated/contracts'
const source = (id = 'S1', extras: Partial<Source> = {}): Source => ({ id, title: id, data_class: 'public', visibility: 'public', synthetic: false, content_status: 'excerpt', hash: 'v1', untrusted_text: '显式测试原文', locator: 'page:1', published_at: '2026-01-01', ...extras })
const fact = (id: string, extras: Partial<Fact> = {}): Fact => ({ id, kind: 'retrofit.resident_needs_confirmed', value: true, unit: null, source_id: 'S1', locator: 'page:1', observed_at: '2026-09-01', object_ref: 'project:P1', scope_kind: 'project', epistemic_status: 'fact', ...extras })
function coverage(facts: Fact[], sources: Source[] = [source()], documents: Parameters<typeof buildImportGraph>[0]['documents'] = []) {
  return buildEvidenceCoverage({ ...buildImportGraph({ projectId: 'P1', projectName: '项目', projectSources: sources, facts, documents, depth: 'read', scope: 'all' }), projectId: 'P1', projectName: '项目', profile: 'neighborhood', asOf: '2026-10-03' })
}
describe('explicit object and dimension evidence coverage', () => {
  it('shares registered research fact semantics and rejects unresolved original locators', () => {
    const result = coverage([fact('SURVEY', { kind: 'resident_survey', value: '显式测试原文', observed_at: '2026-10-03T20:00:00Z' }),
      fact('WRONG', { kind: 'public_service_capacity', value: '显式测试原文', locator: 'page:999' })])
    expect(result.cells.find(cell => cell.dimension === 'demand')?.state).toBe('locatable')
    expect(result.cells.find(cell => cell.dimension === 'supply')?.state).toBe('clue')
    expect(result.cells.find(cell => cell.dimension === 'supply')?.evidence[0].reason).toBe('原文定位尚未匹配保存内容')
  })
  it('does not turn table rows or unbound documents into confirmed building coverage', () => {
    const result = coverage([fact('RAW', { kind: 'table_row', value: '{"楼栋":"B1","居民需求":"已确认"}', object_ref: undefined })])
    expect(result.rawRows[0]).toMatchObject({ sourceId: 'S1', count: 1 })
    expect(result.objects.map(row => row.ref)).toEqual(['project:P1'])
    expect(result.cells.every(cell => cell.state === 'empty')).toBe(true)
  })
  it('keeps project evidence at project level and shared scope at explicit objects only', () => {
    const result = coverage([fact('P'), fact('B', { kind: 'retrofit.engineering_review_passed', scope_kind: 'object', object_ref: 'building:B1' }),
      fact('SHARED', { kind: 'retrofit.maintenance_confirmed', scope_kind: 'shared', object_ref: 'project:P1', applies_to: ['building:B1', 'building:B2'] })])
    expect(result.cells.find(cell => cell.objectRef === 'building:B1' && cell.dimension === 'demand')?.state).toBe('empty')
    expect(result.cells.find(cell => cell.objectRef === 'project:P1' && cell.dimension === 'demand')?.state).toBe('locatable')
    expect(result.cells.find(cell => cell.objectRef === 'building:B2' && cell.dimension === 'operations')?.state).toBe('locatable')
  })
  it('separates assumptions, missing values, locatable negative evidence and unregistered semantics', () => {
    const result = coverage([fact('ASSUME', { epistemic_status: 'assumption' }), fact('MISSING', { value: null }),
      fact('NEGATIVE', { kind: 'retrofit.engineering_review_passed', value: false }), fact('UNKNOWN', { kind: 'resident_count', scope_kind: 'object', object_ref: 'building:UNREGISTERED' }),
      fact('UNBOUND', { object_ref: undefined }), fact('FOREIGN', { source_id: 'OTHER' })])
    expect(result.cells.find(cell => cell.dimension === 'demand')?.state).toBe('clue')
    expect(result.cells.find(cell => cell.dimension === 'adaptation')?.state).toBe('locatable')
    expect(result.cells.filter(cell => cell.objectRef === 'building:UNREGISTERED').every(cell => cell.state === 'empty')).toBe(true)
    expect(result.unmatched.map(row => row.factId)).toEqual(['UNKNOWN', 'UNBOUND', 'FOREIGN'])
    expect(result.dimensions.map(row => row.label)).toEqual(['居民需求', '公共服务', '居住工程', '实施协同', '长效维护', '资金交付'])
  })
  it('keeps bad temporal and version provenance as clues rather than a completed condition', () => {
    for (const extra of [{ observed_at: '2027-01-01' }, { locator: undefined }, { observed_at: undefined }]) expect(coverage([fact('F', extra)]).cells[0].state).toBe('clue')
    expect(coverage([fact('F')], [source('S1', { expires_at: '2026-02-01' })]).cells[0].state).toBe('clue')
    const docs = [{ id: 'S1', file_name: 'report.pdf', parser_result: { status: 'extracted', source_hash: 'v2', profile: { tables: [] } } }]
    expect(coverage([fact('F')], [source()], docs).cells[0].evidence[0].reason).toBe('文档与来源版本不一致')
  })
  it('keeps explicit historical quantity fields as clues and publication dates out of statistics', () => {
    const fields = [{ key: 'object_ref', value: 'project:P1', label: '对象', unit: '', raw: 'project:P1', locator: 'paragraph:1' },
      { key: 'residential_buildings', value: 54, label: '住宅楼', unit: '栋', raw: '54栋', locator: 'paragraph:1' },
      { key: 'statistical_as_of', value: null, label: '统计时点', unit: '', raw: '', locator: 'paragraph:1' }]
    const records = [{ id: 'HISTORY', adapter: 'construction' as const, source_id: 'S1', scope: 'object' as const, period: '2022-10-26', subject: '2022报道工程口径', fields }]
    const cell = coverage([], [source('S1', { public_records: records })]).cells.find(cell => cell.dimension === 'adaptation')!
    expect(cell.state).toBe('clue')
    expect(cell.evidence[0]).toMatchObject({ observedAt: null, publishedAt: '2026-01-01', value: 54, unit: '栋' })
  })
  it('uses current input sources and records precise object binding without inferring from subjects', () => {
    const fields = [{ key: 'object_ref', value: 'project:P1', label: '对象', unit: '', raw: 'project:P1', locator: 'row:1' },
      { key: 'budget', value: 100, label: '预算', unit: '万元', raw: '100', locator: 'row:2' }]
    const records = [{ id: 'R1', adapter: 'procurement' as const, source_id: 'S1', scope: 'object' as const, period: '2026-01-01', subject: '同名建筑不会自动归并', fields }]
    const result = coverage([], [source('S1', { public_records: records })])
    expect(result.cells.find(cell => cell.dimension === 'resources')?.state).toBe('clue')
    records[0].fields = fields.slice(1)
    expect(coverage([], [source('S1', { public_records: records })]).unmatched[0].reason).toBe('记录对象尚未匹配')
    const graph = buildImportGraph({ projectId: 'P1', projectName: '项目', projectSources: [source('S1', { hash: 'CURRENT' })], researchSources: [source('S1', { hash: 'OLD' })], facts: [fact('F')], documents: [], depth: 'read', scope: 'all' })
    expect(buildEvidenceCoverage({ ...graph, projectId: 'P1', projectName: '项目', profile: 'neighborhood' }).cells[0].evidence[0].version).toBe('CURRENT')
  })
})
