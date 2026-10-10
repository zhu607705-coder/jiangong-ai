import { describe, expect, it } from 'vitest'
import { hash } from '../../packages/intelligence/domain'
import { buildActionChunks, draftsFromActionChunks } from '../../packages/experience/chunking'
import { normalizeDraft, validateEvidence, type ParsedDocument } from '../../packages/experience/domain'
import { buildTextUploadedDataProfile } from '../../vendor/cre/dashboard/server/parser-service'

// Small engineering regressions for observed extraction boundaries, not a quality benchmark.
const doc = (text: string): ParsedDocument => ({ id: 'boundary-document', project_id: 'boundary-project', file_name: 'boundary.txt',
  sha256: hash(text), created_at: '2026-10-11', parser_result: { status: 'extracted', source_hash: hash(text), text } })
describe('measure taxonomy and source stages', () => {
  it('recognizes second-supply renovation and keeps a named excluded building separate', () => {
    const d = doc('二次供水改造拟进场施工。\n留博楼不纳入本次二供改造。')
    const result = buildActionChunks(d)
    expect(result.chunks.some(chunk => chunk.measure_key === 'pipe_network' && chunk.kind === 'action')).toBe(true)
    expect(result.chunks.some(chunk => chunk.object_ref === 'building:留博楼')).toBe(true)
    for (const draft of draftsFromActionChunks(d, result.chunks)) { expect(() => normalizeDraft(draft)).not.toThrow();validateEvidence(draft, [d], d.project_id) }
    expect(draftsFromActionChunks(d, result.chunks).every(draft => draft.fields.find(field => field.key === 'implementation')?.value === null)).toBe(true)
  })
  it('does not treat elevator replacement as a new-installation measure', () => {
    const d = doc('1号楼已完成老旧电梯更新。')
    const actions = buildActionChunks(d).chunks.filter(chunk => chunk.kind === 'action')
    expect(actions.map(chunk => chunk.measure_key)).toEqual(['elevator_update'])
  })
  it('does not use a stage heading as an implemented action', () => {
    const d = doc('项目阶段：已完成\n1号楼已完成排水管网更新。')
    const drafts = draftsFromActionChunks(d, buildActionChunks(d).chunks)
    expect(drafts[0].fields.find(field => field.key === 'implementation')?.value).toContain('排水管网更新')
  })
  it('does not invent named projects from generic district-wide action phrases', () => {
    const d = doc('浙大求是社区的老小区多，老人占比33%。\n西湖区全面推进小区三方协同治理。\n社区陆续安装47部电梯。')
    expect(buildActionChunks(d).chunks.every(chunk => chunk.object_ref === null)).toBe(true)
  })
  it('processes CRE Line/Text mirrors once while preserving equal lines at distinct positions', () => {
    const text = ['1号楼已完成排水管网更新。', ...Array.from({ length: 60 }, () => '居民背景记录。')].join('\n')
    const d = doc(text)
    d.parser_result.profile = buildTextUploadedDataProfile({ documentId: d.id, fileName: d.file_name, filePath: '/engineering-test-only/boundary.txt', projectRoot: '/', allowedBasePath: '/', mime: 'text/plain', type: 'workspace_material' }, text)
    const chunks = buildActionChunks(d).chunks
    expect(chunks).toHaveLength(61)
    expect(new Set(chunks.flatMap(chunk => chunk.spans.map(span => span.locator))).size).toBe(61)
    expect(chunks.every(chunk => chunk.spans.every(span => span.locator.startsWith('line:')))).toBe(true)
    for (const draft of draftsFromActionChunks(d, chunks)) validateEvidence(draft, [d], d.project_id)
    // The older table location is still valid, even though it is not a second extraction input.
    const draft = draftsFromActionChunks(d, chunks)[0]
    draft.fields.find(field => field.key === 'implementation')!.evidence = [{ document_id: d.id, version: d.sha256, locator: 'table:1/row:1', quote: '1号楼已完成排水管网更新。' }]
    expect(() => validateEvidence(draft, [d], d.project_id)).not.toThrow()
  })
})
