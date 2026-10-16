import { describe, expect, it } from 'vitest'
import { repairStructuredToolJson, normalizeResearchNoteLayout } from '../../runtime/dsh/json-format-repair'

describe('format-only structured tool recovery', () => {
  it('escapes paired quotes inside a value while preserving the text and numbers', () => {
    const result=repairStructuredToolJson('{"inference":"将"市区补助"与"自筹"分列。","amount":54}')
    expect(result?.value).toEqual({inference:'将"市区补助"与"自筹"分列。',amount:54})
    expect(result?.edits).toEqual(['escaped_inner_quotes'])
  })
  it('repairs control characters and trailing commas only outside quoted content', () => {
    expect(repairStructuredToolJson('{"text":"甲\n乙,}","values":[1,2,],}')?.value)
      .toEqual({text:'甲\n乙,}',values:[1,2]})
  })
  it('may remove an outer JSON fence, but never extracts JSON from analysis prose', () => {
    expect(repairStructuredToolJson('```json\n{"value":54}\n```')?.value).toEqual({value:54})
    expect(repairStructuredToolJson('分析如下：{"value":54}')).toBeNull()
  })
  it('does not fill truncated objects, missing values, missing separators or unpaired quotes', () => {
    for(const raw of ['{"value":54','{"value":}','{"values":["甲" "乙"]}','{"text":"尺寸10"英寸"}'])
      expect(repairStructuredToolJson(raw)).toBeNull()
  })
  it('leaves valid JSON alone and rejects non-object tool roots', () => {
    expect(repairStructuredToolJson('{"value":54}')).toBeNull()
    expect(repairStructuredToolJson('[1,2,]')).toBeNull()
  })
  it('groups excess narrative items without dropping text or changing references, numbers or the original', () => {
    const value={reasoned_proposals:[{premises:['一','二','三','四'],assumptions:['甲','乙','丙','丁'],evidence_refs:['a','b','c','d'],parameters:[{value:54,unit:'万元'}]}]}
    const before=structuredClone(value),result=normalizeResearchNoteLayout('RenewalResearchNote',value)
    const rows=(result.value as typeof value).reasoned_proposals[0]
    expect(rows.premises.join('；')).toBe('一；二；三；四');expect(rows.assumptions.join('；')).toBe('甲；乙；丙；丁')
    expect(rows.premises).toHaveLength(3);expect(rows.assumptions).toHaveLength(3)
    expect(rows.evidence_refs).toEqual(value.reasoned_proposals[0].evidence_refs);expect(rows.parameters).toEqual(value.reasoned_proposals[0].parameters)
    expect(value).toEqual(before)
  })
  it('does not truncate narrative items that cannot fit the schema layout', () => {
    const value={reasoned_proposals:[{assumptions:Array(4).fill('甲'.repeat(200))}]}
    expect(normalizeResearchNoteLayout('RenewalResearchNote',value)).toEqual({value,edits:[]})
  })
})
