import { createHash } from 'node:crypto'
import { describe, expect, test } from 'vitest'
import type { ActionChunk, MeasureFactor } from '../../apps/host/generated/contracts'
import { buildActionChunks, draftsFromActionChunks } from '../../packages/experience/chunking'
import { deriveMeasureFactors, extractMeasureFactors } from '../../packages/experience/measure-factors'
import { documentSlices, type ParsedDocument } from '../../packages/experience/document-slices'
import { normalizeDraft, validateEvidence } from '../../packages/experience/domain'
import { validate } from '../../packages/contracts/validate'

// These deliberately synthetic materials test engineering contracts. They do
// not measure extraction accuracy or real enterprise decision quality.
const document = (text: string, extra: Partial<ParsedDocument> = {}): ParsedDocument => {
  const sha256 = createHash('sha256').update(text).digest('hex')
  return { id: 'SYNTHETIC-ACTION-DOC', project_id: 'SYNTHETIC-P1', file_name: 'synthetic-actions.txt', sha256, created_at: '2026-10-10T00:00:00Z', parser_result: { status: 'extracted', source_hash: sha256, text }, ...extra }
}
function assertReferences(doc: ParsedDocument, chunks: ActionChunk[], requireFullCoverage = true) {
  const original = new Map(documentSlices(doc).map(slice => [slice.locator, slice.text]))
  for (const chunk of chunks) {
    validate('ActionChunk', chunk)
    expect(chunk.text).toBe(chunk.spans.map(span => span.quote).join('\n'))
    for (const span of chunk.spans) {
      expect(span.document_id).toBe(doc.id); expect(span.version).toBe(doc.sha256)
      expect(original.get(span.locator)).toContain(span.quote)
    }
  }
  // Every original non-whitespace character is covered by at least one exact
  // span, including headings, punctuation and otherwise unclassified context.
  for (const [locator, text] of requireFullCoverage ? original : []) {
    const covered = Array<boolean>(text.length).fill(false)
    for (const quote of chunks.flatMap(chunk => chunk.spans).filter(span => span.locator === locator).map(span => span.quote)) {
      for (let index = text.indexOf(quote); index >= 0; index = text.indexOf(quote, index + 1)) {
        for (let offset = 0; offset < quote.length; offset++) covered[index + offset] = true
      }
    }
    expect([...text].every((character, index) => /\s/.test(character) || covered[index]), locator).toBe(true)
  }
}
const extracted = (doc: ParsedDocument) => {
  const { chunks } = buildActionChunks(doc)
  return chunks.filter(chunk => chunk.kind === 'action').flatMap(chunk => extractMeasureFactors(chunk, chunks))
}
const byKey = (factors: MeasureFactor[], key: string) => factors.find(factor => factor.key === key || factor.key.startsWith(key + '.'))!

describe('verbatim action chunks (synthetic engineering fixtures)', () => {
  test('keeps background and independent actions with complete source coverage and deterministic IDs', () => {
    const doc = document('项目名称：甲小区\n背景：共有200户居民，周边公交便利。\n拟加装电梯，增设坡道和扶手；更新排水管网；完善消防设施；建立长效维护；新建社区食堂。')
    const first = buildActionChunks(doc)
    expect(first.chunks.filter(chunk => chunk.kind === 'action').map(chunk => chunk.measure_key)).toEqual(['elevator', 'accessibility_ramp', 'accessibility_handrail', 'pipe_network', 'fire_safety', 'maintenance', 'public_service'])
    expect(first.chunks.filter(chunk => chunk.kind === 'action').every(chunk => chunk.context_chunk_ids.length > 0)).toBe(true)
    expect(buildActionChunks(doc)).toEqual(first)
    expect(first.chunks.every(chunk => chunk.id.includes(doc.sha256))).toBe(true)
    assertReferences(doc, first.chunks)
  })

  test('same-sentence coordinated actions retain shared negation and future qualifiers', () => {
    const doc = document('项目名称：甲小区\n尚未增设坡道和扶手；计划加装电梯、改造排水管网。')
    const { chunks } = buildActionChunks(doc), drafts = draftsFromActionChunks(doc, chunks)
    const handrail = chunks.find(chunk => chunk.measure_key === 'accessibility_handrail')!
    expect(handrail.text).toContain('尚未')
    expect(handrail.stage).toBe('尚未')
    for (const draft of drafts) {
      expect(draft.fields.find(field => field.key === 'implementation')!.value).toBeNull()
      expect(draft.fields.find(field => field.key === 'outcome')!.value).toBeNull()
    }
    expect(chunks.find(chunk => chunk.measure_key === 'pipe_network')!.stage).toBe('计划')
    assertReferences(doc, chunks)
  })

  test('explicit different project objects and sections cannot share context or a card', () => {
    const doc = document('项目名称：甲小区\n背景：住户100户。\n已加装2台电梯。\n项目名称：乙小区\n背景：住户300户。\n拟加装3台电梯。')
    const { chunks } = buildActionChunks(doc), actions = chunks.filter(chunk => chunk.kind === 'action')
    expect(actions.map(chunk => chunk.object_ref)).toEqual(['object:甲小区', 'object:乙小区'])
    expect(draftsFromActionChunks(doc, chunks)).toHaveLength(2)
    expect(extractMeasureFactors(actions[0], chunks).filter(factor => factor.key.startsWith('household_count')).map(factor => factor.value)).toEqual([100])
    expect(extractMeasureFactors(actions[1], chunks).filter(factor => factor.key.startsWith('household_count')).map(factor => factor.value)).toEqual([300])
    assertReferences(doc, chunks)
  })

  test('changes named project scope within a paragraph and retains that scope in later paragraphs', () => {
    const doc = document('甲小区已加装2台电梯。乙小区拟加装3台电梯。\n背景：住户300户。\n乙小区计划增设坡道。')
    const { chunks } = buildActionChunks(doc), actions = chunks.filter(chunk => chunk.kind === 'action')
    expect(actions.map(chunk => chunk.object_ref)).toEqual(['object:甲小区', 'object:乙小区', 'object:乙小区'])
    expect(extractMeasureFactors(actions[0], chunks).some(factor => factor.value === 300)).toBe(false)
    expect(extractMeasureFactors(actions[1], chunks).some(factor => factor.value === 300)).toBe(true)
    assertReferences(doc, chunks)
  })

  test('explicit project background can stay shared beside a building action without becoming building quantities', () => {
    const doc = document('项目名称：甲小区\n背景：住户200户。\n75幢1单元已加装2台电梯。')
    const { chunks } = buildActionChunks(doc), action = chunks.find(chunk => chunk.kind === 'action')!
    expect(action.object_ref).toBe('building:75幢1单元')
    expect(byKey(extractMeasureFactors(action, chunks), 'household_count')).toMatchObject({ value: 200, object_ref: 'object:甲小区', association: 'shared' })
    expect(action.spans.some(span => span.quote === '项目名称：甲小区')).toBe(true)
    assertReferences(doc, chunks)
  })

  test('retains table header units, objects and literal row locators without interpreting numbered units as population', () => {
    const doc = document('', { file_name: 'synthetic-actions.xlsx', parser_result: { status: 'extracted', source_hash: createHash('sha256').update('').digest('hex'), profile: { tables: [{ rows: [{ rowNumber: 2, values: {
      楼栋: '75幢', 单元: '1', 措施: '加装电梯', '统计时点': '2024年5月1日', '阶段': '已完成', '电梯台数（台）': 3, '合同金额（万元）': 180, '建筑面积（m²）': 1200, '受益人数（人）': 80,
    } }] }] } } })
    const { chunks } = buildActionChunks(doc), factors = extractMeasureFactors(chunks.find(chunk => chunk.kind === 'action')!, chunks)
    expect(byKey(factors, 'elevator_count')).toMatchObject({ value: 3, unit: '台' })
    expect(byKey(factors, 'building_area')).toMatchObject({ value: 1200, unit: 'm²' })
    expect(byKey(factors, 'amount_contract')).toMatchObject({ value: 180, unit: '万元' })
    expect(byKey(factors, 'beneficiary_count')).toMatchObject({ value: 80, unit: '人' })
    expect(byKey(factors, 'building_identifier').value).toBe('75幢')
    expect(byKey(factors, 'unit_identifier').value).toBe('1')
    expect(factors.some(factor => ['resident_count', 'household_count'].includes(factor.key) && factor.value === 75)).toBe(false)
    expect(factors.every(factor => factor.evidence.some(span => span.locator === 'table:1/row:2'))).toBe(true)
    assertReferences(doc, chunks)
  })

  test('a multi-measure table row preserves its whole row and keeps unallocated amounts unresolved', () => {
    const base = document(''), doc = { ...base, file_name: 'synthetic-actions.csv', parser_result: { status: 'extracted', source_hash: base.sha256, profile: { tables: [{ rows: [{ rowNumber: 1, values: { 对象: '甲小区', 措施: '电梯、坡道', '预算（万元）': 600 } }] }] } } }
    const { chunks } = buildActionChunks(doc)
    const actions = chunks.filter(chunk => chunk.kind === 'action')
    expect(actions).toHaveLength(2)
    for (const action of actions) {
      expect(byKey(extractMeasureFactors(action, chunks), 'amount_budget')).toMatchObject({ value: 600, association: 'unresolved' })
      expect(deriveMeasureFactors(extractMeasureFactors(action, chunks)).some(factor => factor.association === 'derived')).toBe(false)
    }
    assertReferences(doc, chunks)
  })

  test('long original source quotes split into legal spans without losing source text', () => {
    const doc = document('项目名称：甲小区\n背景：' + '原始材料'.repeat(1800))
    const { chunks } = buildActionChunks(doc)
    expect(chunks.some(chunk => chunk.spans.length > 1)).toBe(true)
    expect(chunks.flatMap(chunk => chunk.spans).every(span => span.quote.length <= 3000)).toBe(true)
    assertReferences(doc, chunks)
  })

  test('canonical chunk, span and text limits fail explicitly instead of truncating', () => {
    expect(() => buildActionChunks(document(Array.from({ length: 101 }, (_, index) => `独立背景资料${index}。`).join('\n')))).toThrow('超过100个')
    expect(() => buildActionChunks(document('未识别背景'.repeat(6000)))).toThrow('超过30000字符')
    expect(() => buildActionChunks(document('未识别背景'.repeat(60001)))).toThrow('超过100条原文span')
  })
})

describe('source factors and guarded arithmetic (synthetic engineering fixtures)', () => {
  test('distinguishes area types, population categories, units and identifiers', () => {
    const factors = extracted(document('项目名称：甲小区\n已加装3台电梯，建筑面积1200m²、用地面积2000平方米、改造面积500㎡，住户40户，居民120人，受益80人，75幢1单元。'))
    expect(byKey(factors, 'building_area')).toMatchObject({ value: 1200, unit: 'm²' })
    expect(byKey(factors, 'site_area')).toMatchObject({ value: 2000, unit: '平方米' })
    expect(byKey(factors, 'renovated_area')).toMatchObject({ value: 500, unit: '㎡' })
    expect(byKey(factors, 'household_count').value).toBe(40)
    expect(byKey(factors, 'resident_count').value).toBe(120)
    expect(byKey(factors, 'beneficiary_count').value).toBe(80)
    expect(byKey(factors, 'building_identifier').value).toBe('75幢')
    expect(byKey(factors, 'unit_identifier').value).toBe('1单元')
    for (const factor of factors) validate('MeasureFactor', factor)
  })

  test('retains original 万元/亿元 and distinguishes budget, contract, paid, committed and maintenance amounts', () => {
    const factors = extracted(document('项目名称：甲小区\n已加装3台电梯，预算180万元，合同金额160万元，已支付100万元，已落实资金150万元，维护费2万元。\n拟更新排水管网，概算1.2亿元。'))
    for (const [key, value] of [['amount_budget', 180], ['amount_contract', 160], ['amount_paid', 100], ['amount_committed', 150], ['amount_maintenance', 2]] as const) expect(byKey(factors, key)).toMatchObject({ value, unit: '万元' })
    expect(factors.find(factor => factor.value === 1.2)).toMatchObject({ unit: '亿元', amount_kind: 'budget', epistemic_status: 'scenario_assumption' })
    expect(factors.every(factor => factor.evidence.some(span => span.quote.includes(String(factor.value))))).toBe(true)
  })

  test.each([
    ['合同单价每台每月300元', '元/台/月'],
    ['合同单价300元/台/月', '元/台/月'],
    ['合同单价300元／台／月', '元/台/月'],
    ['合同单价300元/台（每月）', '元/台/月'],
    ['合同单价每人300元', '元/人'],
    ['合同单价300元/人', '元/人'],
    ['年度维护费300元', '元/年'],
    ['每月维护费300元', '元/月'],
  ])('retains explicit billing basis from %s as %s and does not divide again', (phrase, unit) => {
    const text = `项目名称：甲小区\n截至2024年5月1日，已完成47台电梯维保，${phrase}。`
    const factors = extracted(document(text)), amount = factors.find(factor => factor.value === 300)!
    expect(amount.unit).toBe(unit)
    expect(amount.evidence.some(span => span.quote.includes(phrase))).toBe(true)
    expect(deriveMeasureFactors(factors).some(factor => factor.association === 'derived')).toBe(false)
  })

  test('annual and monthly maintenance amounts of equal value remain different source factors', () => {
    const factors = extracted(document('项目名称：甲小区\n截至2024年5月1日，已完成47台电梯维保，年度10万元运维，每月10万元运维。'))
    const amounts = factors.filter(factor => factor.value === 10)
    expect(amounts).toHaveLength(2)
    expect(amounts.map(factor => factor.unit).sort()).toEqual(['万元/年', '万元/月'])
    expect(amounts.every(factor => factor.amount_kind === 'maintenance')).toBe(true)
    expect(new Set(amounts.map(factor => factor.key)).size).toBe(2)
    expect(deriveMeasureFactors(factors).some(factor => factor.association === 'derived')).toBe(false)
  })

  test('table price headers retain compound billing units without turning a rate into a total', () => {
    const base = document(''), doc = { ...base, file_name: 'synthetic-billing.xlsx', parser_result: { status: 'extracted', source_hash: base.sha256, profile: { tables: [{ rows: [{ rowNumber: 1, values: {
      对象: '甲小区', 措施: '电梯维保', 阶段: '已完成', 统计时点: '2024年5月1日', '电梯台数（台）': 47, '合同单价（元/台/月）': 300,
    } }] }] } } }
    const factors = extracted(doc), rate = factors.find(factor => factor.value === 300)!
    expect(rate).toMatchObject({ unit: '元/台/月', amount_kind: 'contract' })
    expect(rate.evidence[0].quote).toContain('合同单价（元/台/月）=300')
    expect(deriveMeasureFactors(factors).some(factor => factor.association === 'derived')).toBe(false)
    assertReferences(doc, buildActionChunks(doc).chunks)
  })

  test('an unqualified unit price stays unresolved instead of guessing a per-equipment basis', () => {
    const factors = extracted(document('项目名称：甲小区\n截至2024年5月1日，已完成47台电梯维保，合同单价300元。'))
    expect(factors.find(factor => factor.value === 300)).toMatchObject({ unit: '元', association: 'unresolved', label: '单价（计价单位待核）' })
    expect(deriveMeasureFactors(factors).some(factor => factor.association === 'derived')).toBe(false)
  })

  test('a clearly stated maintenance total can still derive a same-scope per-equipment cost', () => {
    const factors = extracted(document('项目名称：甲小区\n截至2024年5月1日，已完成47台电梯维保，维护费总额10万元。'))
    expect(byKey(factors, 'amount_maintenance')).toMatchObject({ value: 10, unit: '万元', amount_kind: 'maintenance' })
    expect(deriveMeasureFactors(factors).find(factor => factor.association === 'derived')).toMatchObject({ value: 10 / 47, unit: '万元/台', amount_kind: 'maintenance' })
  })

  test('does not pull one amount billing words or following contract labels onto another amount', () => {
    const factors = extracted(document('项目名称：甲小区\n已完成电梯维保，合同总额100万元其中每月10万元运维；每月20万元合同总额200万元。'))
    expect(factors.find(factor => factor.value === 100)).toMatchObject({ unit: '万元', amount_kind: 'contract' })
    expect(factors.find(factor => factor.value === 10)).toMatchObject({ unit: '万元/月', amount_kind: 'maintenance' })
    expect(factors.find(factor => factor.value === 20)).toMatchObject({ unit: '万元/月', amount_kind: 'unknown' })
    expect(factors.find(factor => factor.value === 200)).toMatchObject({ unit: '万元', amount_kind: 'contract' })
  })

  test('payment cadence does not turn a stated contract total into a periodic rate', () => {
    const factors = extracted(document('项目名称：甲小区\n截至2024年5月1日，已完成47台电梯维保，合同总额100万元按月支付。'))
    expect(byKey(factors, 'amount_contract')).toMatchObject({ value: 100, unit: '万元', association: 'direct' })
    expect(deriveMeasureFactors(factors).find(factor => factor.association === 'derived')).toMatchObject({ value: 100 / 47, unit: '万元/台' })
    const ambiguous = extracted(document('项目名称：甲小区\n截至2024年5月1日，已完成47台电梯维保，合同金额100万元每月支付。'))
    expect(byKey(ambiguous, 'amount_contract')).toMatchObject({ value: 100, unit: '万元', association: 'unresolved' })
    expect(deriveMeasureFactors(ambiguous).some(factor => factor.association === 'derived')).toBe(false)
  })

  test('multiplication symbols alone do not invent a per-equipment denominator', () => {
    const factors = extracted(document('项目名称：甲小区\n截至2024年5月1日，已完成47台电梯维保，合同单价300元·台。'))
    expect(factors.find(factor => factor.value === 300)).toMatchObject({ unit: '元·台', association: 'unresolved' })
    expect(deriveMeasureFactors(factors).some(factor => factor.association === 'derived')).toBe(false)
  })

  test('project package totals stay shared across measures and are never allocated or averaged', () => {
    const doc = document('项目名称：甲小区\n工程包总投资900万元，涉及200户。\n已加装3台电梯；已增设坡道。')
    const { chunks } = buildActionChunks(doc)
    for (const action of chunks.filter(chunk => chunk.kind === 'action')) {
      const factors = extractMeasureFactors(action, chunks)
      expect(byKey(factors, 'amount_package_total')).toMatchObject({ value: 900, association: 'shared', amount_kind: 'package_total' })
      expect(deriveMeasureFactors(factors).some(factor => factor.association === 'derived')).toBe(false)
    }
  })

  test('separates package background before an action and unallocated budgets after a coordinated action list', () => {
    const doc = document('项目名称：甲小区\n工程包总投资900万元，已加装3台电梯，增设坡道，预算合计100万元。')
    const { chunks } = buildActionChunks(doc)
    for (const action of chunks.filter(chunk => chunk.kind === 'action')) {
      const factors = extractMeasureFactors(action, chunks)
      expect(byKey(factors, 'amount_package_total')).toMatchObject({ value: 900, association: 'shared' })
      expect(factors.find(factor => factor.value === 100)).toMatchObject({ association: 'shared' })
      expect(deriveMeasureFactors(factors).some(factor => factor.association === 'derived')).toBe(false)
    }
    assertReferences(doc, chunks)
  })

  test('Chinese number strings and thousands separators remain original text rather than unrecorded numeric conversions', () => {
    const factors = extracted(document('项目名称：甲小区\n已加装三台电梯，预算1,200万元，建筑面积1,000m²。'))
    expect(byKey(factors, 'elevator_count')).toMatchObject({ value: '三', unit: '台' })
    expect(byKey(factors, 'amount_budget')).toMatchObject({ value: '1,200', unit: '万元' })
    expect(byKey(factors, 'building_area')).toMatchObject({ value: '1,000', unit: 'm²' })
    expect(deriveMeasureFactors(factors).some(factor => factor.association === 'derived')).toBe(false)
  })

  test('missing or negative source records are retained without zeros or claimed payments', () => {
    const doc = document('项目名称：甲小区\n拟加装电梯，预算未披露，尚未支付50万元。\n未实施坡道改造。')
    const factors = extracted(doc)
    expect(byKey(factors, 'amount_budget')).toMatchObject({ value: null, epistemic_status: 'missing' })
    expect(factors.find(factor => factor.value === 50)).toMatchObject({ amount_kind: 'unknown' })
    expect(factors.some(factor => factor.value === 0)).toBe(false)
    expect(factors.some(factor => factor.key === 'elevator_count')).toBe(false)
    expect(factors.filter(factor => factor.key === 'action_status').length).toBeGreaterThan(0)
  })

  test('observation times come from source quantities, with original precision and no ingestion/publication substitution', () => {
    const doc = document('项目名称：甲小区\n发布日期：2026年10月1日\n截至2024年5月1日，已加装3台电梯。\n2027年计划改造排水管网，预算300万元。')
    const factors = extracted(doc)
    expect(byKey(factors, 'elevator_count').observed_at).toBe('2024年5月1日')
    expect(byKey(factors, 'amount_budget')).toMatchObject({ observed_at: '2027年', epistemic_status: 'scenario_assumption' })
    expect(extracted(document('发布日期：2026年10月1日\n已加装电梯，预算180万元。')).every(factor => factor.observed_at === null)).toBe(true)
    const drafts = draftsFromActionChunks(doc, buildActionChunks(doc).chunks)
    expect(drafts.find(draft => draft.knowledge!.measure_key === 'pipe_network')!.fields.find(field => field.key === 'implementation')!.value).toBeNull()
  })

  test('derives an unrounded same-span ratio and carries its fee status and all original citations', () => {
    const factors = extracted(document('项目名称：甲小区\n截至2024年5月1日，已加装3台电梯，合同金额100万元。'))
    const result = deriveMeasureFactors(factors), cost = result.find(factor => factor.association === 'derived')!
    expect(cost).toMatchObject({ value: 100 / 3, unit: '万元/台', amount_kind: 'contract', observed_at: '2024年5月1日', derivation: { formula: 'cost_per_unit', numerator_key: 'amount_contract', denominator_key: 'elevator_count' } })
    expect(cost.evidence).toEqual(byKey(factors, 'amount_contract').evidence)
    expect(deriveMeasureFactors(result)).toEqual(result)
    validate('MeasureFactor', cost)
  })

  test('area and beneficiary denominators retain their respective formula and original unit', () => {
    const factors = extracted(document('项目名称：甲小区\n截至2024年5月1日，已建成社区食堂，建筑面积250m²，受益100人，合同金额60万元。'))
    const costs = deriveMeasureFactors(factors).filter(factor => factor.association === 'derived')
    expect(costs.map(factor => factor.derivation!.formula).sort()).toEqual(['cost_per_area', 'cost_per_person'])
    expect(costs.find(factor => factor.derivation!.formula === 'cost_per_area')).toMatchObject({ value: 60 / 250, unit: '万元/m²' })
  })

  test.each(['scope', 'missing-scope', 'time', 'missing-time', 'stage', 'zero', 'shared', 'package', 'unknown', 'estimate', 'plan', 'unit', 'other-source'])(
    'does not derive with mismatched or unqualified %s', variant => {
      const factors = extracted(document('项目名称：甲小区\n截至2024年5月1日，已加装3台电梯，合同金额100万元。'))
      const numerator = byKey(factors, 'amount_contract'), denominator = byKey(factors, 'elevator_count')
      if (variant === 'scope') denominator.object_ref = 'object:乙小区'
      if (variant === 'missing-scope') numerator.object_ref = null
      if (variant === 'time') denominator.observed_at = '2023年'
      if (variant === 'missing-time') numerator.observed_at = null
      if (variant === 'stage') denominator.stage = '计划'
      if (variant === 'zero') denominator.value = 0
      if (variant === 'shared') numerator.association = 'shared'
      if (variant === 'package') numerator.amount_kind = 'package_total'
      if (variant === 'unknown') numerator.amount_kind = 'unknown'
      if (variant === 'estimate') numerator.epistemic_status = 'estimate'
      if (variant === 'plan') denominator.epistemic_status = 'scenario_assumption'
      if (variant === 'unit') numerator.unit = null
      if (variant === 'other-source') denominator.evidence = denominator.evidence.map(span => ({ ...span, locator: 'line:99' }))
      expect(deriveMeasureFactors(factors).some(factor => factor.association === 'derived')).toBe(false)
    },
  )

  test('unlinked or foreign contexts cannot contribute factors', () => {
    const doc = document('项目名称：甲小区\n已加装3台电梯。'), { chunks } = buildActionChunks(doc), action = chunks.find(chunk => chunk.kind === 'action')!
    const unknown = { ...chunks[0], id: 'UNLINKED', spans: [{ ...chunks[0].spans[0], quote: '工程包总投资900万元' }], text: '工程包总投资900万元' }
    expect(extractMeasureFactors(action, [...chunks, unknown]).some(factor => factor.value === 900)).toBe(false)
    action.context_chunk_ids.push(unknown.id); unknown.document_id = 'FOREIGN-DOC'
    expect(extractMeasureFactors(action, [...chunks, unknown]).some(factor => factor.value === 900)).toBe(false)
  })

  test('model classifications retain the same raw spans and factor extraction semantics', () => {
    const doc = document('项目名称：甲小区\n已加装3台电梯。'), { chunks } = buildActionChunks(doc)
    const action = chunks.find(chunk => chunk.kind === 'action')!, local = extractMeasureFactors(action, chunks)
    action.classification = 'model'
    expect(extractMeasureFactors(action, chunks)).toEqual(local)
    expect(draftsFromActionChunks(doc, chunks)[0].knowledge!.chunks!.find(chunk => chunk.kind === 'action')!.classification).toBe('model')
  })

  test('one draft per measure has all ten fields, all linked contexts and only source-supported values', () => {
    const doc = document('项目名称：甲小区\n背景：住户40户。\n拟增设坡道，预算60万元；已加装2台电梯。')
    const { chunks } = buildActionChunks(doc), drafts = draftsFromActionChunks(doc, chunks)
    expect(drafts).toHaveLength(2)
    for (const draft of drafts) {
      expect(draft.fields).toHaveLength(10)
      expect(new Set(draft.fields.map(field => field.key)).size).toBe(10)
      expect(draft.fields.find(field => field.key === 'actual_decision')!.value).toBeNull()
      expect(draft.fields.find(field => field.key === 'decision_basis')!.value).toBeNull()
      const included = new Set(draft.knowledge!.chunks!.map(chunk => chunk.id))
      expect(draft.knowledge!.chunks!.flatMap(chunk => chunk.context_chunk_ids).every(id => included.has(id))).toBe(true)
      normalizeDraft(draft); validateEvidence(draft, [doc], doc.project_id)
      assertReferences(doc, draft.knowledge!.chunks!, false)
    }
    expect(drafts.find(draft => draft.knowledge!.measure_key === 'accessibility_ramp')!.fields.find(field => field.key === 'implementation')!.value).toBeNull()
    expect(drafts.find(draft => draft.knowledge!.measure_key === 'elevator')!.fields.find(field => field.key === 'outcome')!.value).toBeNull()
  })
})
