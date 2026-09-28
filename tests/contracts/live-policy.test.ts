import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { assertObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import { modelSchema, projectInput, ownedModelValue } from '../../packages/contracts/validate'
import { evaluateScenarios } from '../../packages/decision/evaluate'
import { enforceScenarioPolicy, hasUnqualifiedAssurance, validateFindings, checkSourceRefs } from '../../packages/decision/model-policy'
import type { CapabilityResult, ScenarioProposal, ModelContext } from '../../apps/host/generated/contracts'
import { normalizeModelContext } from '../../packages/context/model-compiler'

const input = () => projectInput(JSON.parse(readFileSync('fixtures/inputs/02_enterprise.json', 'utf8')))
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value) }
  return value
}

describe('live DSH boundary regression', () => {
  it('resolves known fact citations to their source without accepting invented references', () => {
    expect(checkSourceRefs(input(), ['F-RIGHTS', 'F-STRUCTURE', 'S-02'])).toEqual(['S-02'])
    expect(() => checkSourceRefs(input(), ['OTHER-PROJECT-FACT'])).toThrow('获准快照')
  })
  it('keeps an authorized project ban binding even when the model calls it a fact candidate', () => {
    const text = '本项目不整体拆除。'
    const compiled: ModelContext = { rules: [{ kind: 'fact_candidate', predicate: 'no_whole_site_demolition', value: true, original_text: text, note: '模型原始分类为事实候选' }], warnings: [], unclassified: [] }
    const patch = normalizeModelContext(input(), text, true, compiled)
    expect(patch.rules[0].kind).toBe('organizational_constraint')
    expect(patch.rules[0].value).toBe(true)
    expect(normalizeModelContext(input(), text, false, compiled).rules[0].kind).toBe('fact_candidate')
  })
  it('detaches frozen DSH output before enforcing project constraints', () => {
    const p = input(); p.candidate_ids = ['whole_site_rebuild', 'retain_and_reuse', 'defer_and_investigate']
    const scenarios = evaluateScenarios(p).map(s => ({ ...s, status: s.id === 'defer_and_investigate' ? 'investigate' as const : 'conditional' as const, blockers: [], action_specs: [{ kind: s.id === 'whole_site_rebuild' ? 'whole_demolition' as const : s.id === 'defer_and_investigate' ? 'investigate' as const : 'retain' as const, objects: ['project'], condition: '待核' }] }))
    const borrowed = freeze({ scenarios, rationale: 'synthetic test', unresolved: ['权属待核'] })
    const owned = ownedModelValue<ScenarioProposal>('ScenarioProposal', borrowed)
    const result = enforceScenarioPolicy(p, owned)
    expect(result.scenarios.find(s => s.id === 'whole_site_rebuild')?.status).toBe('blocked')
    expect(borrowed.scenarios.find(s => s.id === 'whole_site_rebuild')?.status).toBe('conditional')
  })
  it('presents supported DSH schemas while keeping canonical validation separate', () => {
    for (const name of ['ModelContext', 'CapabilityResult', 'ScenarioProposal', 'ReviewPacket', 'ComparisonPacket']) expect(() => assertObjectJsonSchema(modelSchema(name))).not.toThrow()
  })
  it('limits comparison references to candidates that were actually generated', () => {
    const schema = modelSchema('ComparisonPacket', ['retain_and_reuse', 'defer_and_investigate'])
    expect(JSON.stringify(schema)).not.toContain('selective_rebuild')
    expect(JSON.stringify(schema)).not.toContain('whole_site_rebuild')
    expect(() => assertObjectJsonSchema(schema)).not.toThrow()
  })
  it('constrains deferred baseline actions at the model schema boundary', () => {
    const schema = modelSchema('ScenarioProposal', ['retain_and_reuse', 'defer_and_investigate'])
    expect(() => assertObjectJsonSchema(schema)).not.toThrow()
    const encoded = JSON.stringify(schema)
    expect(encoded).toContain('"const":"defer_and_investigate"')
    expect(encoded).toContain('"enum":["investigate","retain"]')
  })
  it('does not mistake uncertainty language for a safety guarantee', () => {
    expect(hasUnqualifiedAssurance('不能确定结构安全，尚未获得实施批准')).toBe(false)
    expect(hasUnqualifiedAssurance('已确定结构安全，可以马上施工')).toBe(true)
  })
  it('rejects invented references and never accepts model-authored metric values', () => {
    const p = input()
    const computed: CapabilityResult = { status: 'partial', findings: [], metrics: [{ key: 'vacancy_ratio', label: '空置比例', value: .6, unit: 'ratio', status: 'known', source_refs: ['S-01'] }], warnings: [], missing_fields: ['structure'], artifact_refs: [], version: '2.0' }
    const model: CapabilityResult = { ...computed, metrics: [{ ...computed.metrics[0], value: .99 }], findings: [{ id: 'test', dimension: 'building', claim: '结构资料缺失', status: 'unknown', evidence_refs: ['FABRICATED'], opposition_refs: [], unknowns: ['结构'] }] }
    expect(() => validateFindings(p, model, computed)).toThrow('获准快照')
    model.findings[0].evidence_refs = ['S-02']
    expect(validateFindings(p, model, computed).metrics[0].value).toBe(.6)
  })
})
