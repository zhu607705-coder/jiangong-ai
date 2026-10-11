import { describe, expect, it } from 'vitest'
import type { ActionReviewBatch } from '../../apps/host/generated/contracts'
import { draftsFromActionReview, validateActionReviewBatch } from '../../packages/experience/action-review'
import { buildActionChunks } from '../../packages/experience/chunking'
import { hash } from '../../packages/intelligence/domain'
import type { ParsedDocument } from '../../packages/experience/domain'

// Protocol regressions using synthetic source text. No model request or business evaluation.
const text = '1号楼已完成排水管网更新，合同金额40万元。\n2号楼拟加装电梯。'
const document: ParsedDocument = { id: 'REVIEW-DOC', project_id: 'REVIEW-PROJECT', file_name: 'review.txt', sha256: hash(text),
  created_at: '2026-10-11', parser_result: { status: 'extracted', source_hash: hash(text), text } }
const index = buildActionChunks(document).chunks
const action = index.find(chunk => chunk.measure_key === 'pipe_network')!
const review = (): ActionReviewBatch => ({ measures: [{ measure_key: 'pipe_network', measure_name: '排水管网更新', kind: 'case', origin: 'project_case',
  action_chunk_ids: [action.id], context_chunk_ids: [], fields: [{ key: 'implementation', value: action.spans.at(-1)!.quote, chunk_ids: [action.id] }],
  conditions: [], exclusions: [], transfer_notes: [] }], warnings: [] })

describe('compact action model handoff', () => {
  it('attaches immutable source spans, calculated factors and complete null fields without model repetition', () => {
    const before = structuredClone(index), draft = draftsFromActionReview(document, index, review())[0]
    expect(draft.fields).toHaveLength(10); expect(draft.knowledge!.chunks![0]).toMatchObject({ classification: 'model', document_version: document.sha256, spans: action.spans })
    expect(draft.knowledge!.factors!.some(factor => factor.value === 40 && factor.unit === '万元' && factor.amount_kind === 'contract')).toBe(true)
    expect(draft.fields.find(field => field.key === 'outcome')!.value).toBeNull(); expect(index).toEqual(before)
  })
  it('rejects fabricated field content', () => {
    const value = review(); value.measures[0].fields[0].value = '取得了从未记载的批准'
    expect(() => draftsFromActionReview(document, index, value)).toThrow(/逐字来自/)
  })
  it('rejects unknown IDs and stale source versions', () => {
    const value = review(); value.measures[0].action_chunk_ids = ['fabricated-id']
    expect(() => draftsFromActionReview(document, index, value)).toThrow(/本轮原件/)
    expect(() => draftsFromActionReview({ ...document, sha256: hash('changed') }, index, review())).toThrow(/本轮原件/)
  })
  it('rejects an unrelated building field even if it exists elsewhere in this document', () => {
    const value = review(), other = index.find(chunk => chunk.measure_key === 'elevator')!
    value.measures[0].fields[0] = { key: 'proposal', value: '2号楼拟加装电梯。', chunk_ids: [other.id] }
    expect(() => draftsFromActionReview(document, index, value)).toThrow(/逐字来自/)
  })
  it('rejects double-using a chunk as both action and background', () => {
    const value = review(); value.measures[0].context_chunk_ids = [action.id]
    expect(() => draftsFromActionReview(document, index, value)).toThrow(/重复或交叉/)
  })
  it('requires condition evidence from the selected measure rather than another building', () => {
    const value = review(), other = index.find(chunk => chunk.measure_key === 'elevator')!
    value.measures[0].conditions = [{ fact_kind: 'building', label: '楼栋', operator: 'eq', value: '2号楼', unit: null, evidence: other.spans }]
    expect(() => draftsFromActionReview(document, index, value)).toThrow(/条件引文/)
  })
  it('keeps independent valid measures while rejecting an invalid field without changing its facts', () => {
    const value = review(), bad = structuredClone(value.measures[0]); bad.fields[0].value = '没有这段实施记载'
    value.measures.push(bad)
    const result = validateActionReviewBatch(document, index, value)
    expect(result.drafts).toHaveLength(1); expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain('未入库措施'); expect(result.warnings[0]).toContain('MODEL_FIELD_NOT_QUOTED')
    expect(bad.fields[0].value).toBe('没有这段实施记载')
  })
})
