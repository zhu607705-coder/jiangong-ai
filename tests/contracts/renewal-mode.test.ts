import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { projectRenewalModeInput, modeAssessment, renewalQuestions, evaluateRenewalModeGate } from '../../packages/retrofit/renewal-mode'
import { projectDecisionInput } from '../../packages/decision/structured-route'
import { evaluateDecision, decisionRequestBody } from '../../services/capabilities/decision-model'
import type { DecisionChoice, ProjectInput, Fact } from '../../apps/host/generated/contracts'

function project(): ProjectInput {
  const input = JSON.parse(readFileSync('fixtures/inputs/01_auto.json', 'utf8')) as ProjectInput
  return { ...input, project_id: 'MODE-TEST', synthetic: false, business_profile: 'neighborhood', as_of: '2026-10-08',
    scope: { name: '测试求是村', geometry: null, legal_parcel_confirmed: false, coordinate_encoding: 'WGS84' }, facts: [],
    sources: [{ id: 'CURRENT', title: '测试求是村供水与加梯记录', visibility: 'public', data_class: 'public', synthetic: false, content_status: 'full_text',
      published_at: '2026-09-01T00:00:00Z', untrusted_text: '测试求是村开展供水及加装电梯工作。部分楼栋曾标记为C级危房，需逐栋专业鉴定。' }] }
}
const choice = (keys: string[], selected: string): DecisionChoice => ({ choice: selected, confidence: .95, probabilities: Object.fromEntries(keys.map(key => [key, key === selected ? .9 : .1 / (keys.length - 1)])) })
function assess(input: ReturnType<typeof projectRenewalModeInput>, direction = 'comprehensive') {
  const questions = renewalQuestions(input)
  return modeAssessment(input, choice(Object.keys(questions.renewal_mode.criteria), direction), choice(Object.keys(questions.renewal_priority.criteria), 'safety'), choice(Object.keys(questions.renewal_evidence.criteria), 'object_source_1'))
}
function fact(kind: string, value: boolean, extra: Partial<Fact> = {}): Fact {
  return { id: kind, kind, value, unit: null, source_id: 'CURRENT', scope_kind: 'project', epistemic_status: 'fact', observed_at: '2026-09-01', locator: 'line:1', ...extra }
}

describe('mode-first screening', () => {
  it('keeps missing engineering findings unknown while allowing a sourced initial direction; C-grade is not a demolition rule', () => {
    const input = projectRenewalModeInput(project()), result = assess(input)
    expect(input.conditions.every(row => row.value === null && row.state === 'unknown')).toBe(true)
    expect(result.direction).toBe('comprehensive'); expect(result.status).toBe('uncertain')
    expect(result.source_ids).toEqual(['CURRENT']); expect(result.next_step).toContain('逐栋安全鉴定')
  })
  it('excludes private, future, unrelated and synthetic records from a real object and rejects cross-object condition transfer', () => {
    const p = project(), source = p.sources[0]
    p.sources.push({ ...source, id: 'PRIVATE', visibility: 'internal', data_class: 'internal' }, { ...source, id: 'FUTURE', published_at: '2026-10-10' },
      { ...source, id: 'CASE', untrusted_text: '浙工新村已拆建交付。' }, { ...source, id: 'SYN', synthetic: true })
    p.facts = [fact('structure_repairable', false, { scope_kind: 'object', object_ref: 'building:elsewhere' })]
    const input = projectRenewalModeInput(p)
    expect(input.evidence.map(row => row.source_id)).toEqual(['CURRENT'])
    expect(input.conditions.find(row => row.kind === 'structure_repairable')?.value).toBeNull()
  })
  it('enforces confirmed repair and demolition restrictions without turning absent conditions into exclusions', () => {
    const p = project(); p.facts = [fact('structure_repairable', false), fact('demolition_permitted', false)]
    const input = projectRenewalModeInput(p)
    expect(assess(input).status).toBe('constrained'); expect(assess(input).direction).toBe('investigate')
    expect(assess(input, 'rebuild').direction).toBe('investigate')
    p.facts.push(fact('structure_repairable', true, { id: 'conflicting' }))
    expect(assess(projectRenewalModeInput(p), 'compare').reasons.join()).toContain('分歧')
  })
  it('keeps a high-confidence demolition preference behind the current-object evidence gate', () => {
    const input = projectRenewalModeInput(project()), result = assess(input, 'rebuild')
    const gate = evaluateRenewalModeGate(input)
    expect(gate.baseline).toBe('comprehensive')
    expect(gate.direction).toBe('comprehensive'); expect(gate.rebuild_allowed).toBe(false)
    expect(gate.checks.every(row => row.state === 'unknown')).toBe(true)
    expect(result.direction).toBe('comprehensive')
    expect(result.summary).toContain('优先研究')
    expect(result.reasons.join()).toContain('未知')
    expect(input.conditions.every(row => row.value === null)).toBe(true)
  })
  it('requires confirmed necessity and every feasibility condition, retaining the failed item and source', () => {
    const p = project()
    p.facts = ['structure_repairable','demolition_permitted','rights_clear','rebuild_planning_confirmed','resident_resolution_valid','relocation_ready','funding_secured','life_cycle_cost_compared','maintenance_entity_confirmed']
      .map(kind => fact(kind, kind !== 'structure_repairable'))
    const complete = projectRenewalModeInput(p)
    expect(evaluateRenewalModeGate(complete).rebuild_allowed).toBe(true)
    expect(assess(complete, 'rebuild').direction).toBe('rebuild')
    for (const kind of ['demolition_permitted','rights_clear','rebuild_planning_confirmed','resident_resolution_valid','relocation_ready','funding_secured','life_cycle_cost_compared','maintenance_entity_confirmed']) {
      const missing = projectRenewalModeInput({ ...p, facts: p.facts.filter(row => row.kind !== kind) })
      expect(evaluateRenewalModeGate(missing).rebuild_allowed, kind).toBe(false)
      expect(assess(missing, 'rebuild').direction, kind).toBe('investigate')
    }
    p.facts.find(row => row.kind === 'funding_secured')!.value = false
    const unmet = evaluateRenewalModeGate(projectRenewalModeInput(p)).checks.find(row => row.kind === 'funding_secured')!
    expect(unmet.state).toBe('unmet'); expect(unmet.source_ids).toEqual(['CURRENT']); expect(unmet.locators).toEqual(['line:1'])
  })
  it('does not infer demolition necessity from a cost comparison, a missing citation, or model confidence', () => {
    const p = project(); p.facts = [fact('structure_repairable', true), fact('life_cycle_cost_compared', true)]
    const input = projectRenewalModeInput(p), gate = evaluateRenewalModeGate(input)
    expect(gate.checks.find(row => row.kind === 'structure_repairable')?.state).toBe('unmet')
    expect(gate.rebuild_allowed).toBe(false); expect(assess(input, 'rebuild').direction).toBe('comprehensive')
    const unbound = structuredClone(input)
    unbound.conditions.find(row => row.kind === 'structure_repairable')!.value = false
    unbound.conditions.find(row => row.kind === 'structure_repairable')!.state = 'restricted'
    unbound.conditions.find(row => row.kind === 'structure_repairable')!.source_ids = []
    expect(evaluateRenewalModeGate(unbound).checks.find(row => row.kind === 'structure_repairable')?.state).toBe('unknown')
  })
  it('retains expired source text for historical reading but does not admit it as a current hard condition',()=>{
    const p=project();p.sources[0].expires_at='2026-09-30';p.facts=[fact('demolition_permitted',true)]
    const input=projectRenewalModeInput(p)
    expect(input.evidence).toHaveLength(1)
    expect(input.conditions.find(row=>row.kind==='demolition_permitted')?.state).toBe('unknown')
  })
  it('retains separate counts, regions, investment and owner contributions in references', () => {
    const input = projectRenewalModeInput(project()), z = input.cases.find(row => row.name === '浙工新村')!
    expect(z.metrics.find(row => row.label === '项目总投资')?.value).toBe(560000000)
    expect(z.metrics.find(row => row.label === '居民筹资')?.value).toBe(499000000)
    const sh = input.cases.find(row => row.name === '凤南一村')!
    expect(sh.metrics.find(row => row.label === '原住户')?.value).toBe(1813)
    expect(sh.metrics.find(row => row.label === '设计户数')?.value).toBe(2081)
    expect(input.method_reference.use).toContain('不是杭州')
  })
  it('uses the shared decision protocol and validates the optional new assessment with current-object source choices', async () => {
    const input = projectDecisionInput(project()); delete input.dashboard
    const body = decisionRequestBody(input), answers: Record<string, unknown> = {}
    for (const [id, question] of Object.entries(body.questions)) {
      const keys = Object.keys(question.criteria)
      const selected = id === 'renewal_mode' ? 'comprehensive' : id === 'renewal_priority' ? 'safety' : id === 'renewal_evidence' ? 'object_source_1' : id === 'next_action' ? 'investigate' : 'adaptation'
      answers[id] = question.type === 'noul' ? { type: 'noul', noul: .25 } : { type: 'choice', ...choice(keys, selected) }
    }
    const transport = async () => new Response(JSON.stringify({ model: 'decision-model-preview', request_id: 'MODE-TEST-REQUEST', usage: { input_tokens: 150 }, answers }))
    const result = await evaluateDecision(input, new AbortController().signal, { apiKey: 'fixture', model: 'decision-model-preview', endpoint: 'https://maas.qianwenaiapi.com' }, transport)
    expect(result.status).toBe('completed'); expect(result.renewal_mode?.direction).toBe('comprehensive'); expect(result.action).toBe('investigate')
    expect(body.questions.renewal_evidence!.criteria).not.toHaveProperty('MODE-ZHEGONG-20261012')
    expect(body.state).toHaveProperty('renewal_mode_screening')
  })
  it('uses bounded source aliases so long real database IDs do not invalidate a decision choice',()=>{
    const p=project();p.sources[0].id='PUBLIC-'+ 'a'.repeat(130)
    const input=projectRenewalModeInput(p),result=assess(input)
    expect(result.evidence_basis.choice).toBe('object_source_1')
    expect(result.source_ids).toEqual([p.sources[0].id])
  })
  it('keeps a large neighbourhood collection within the existing System One request budget using source metadata and selected object excerpts',()=>{
    const p=project(),source=p.sources[0]
    p.sources=Array.from({length:64},(_,index)=>({...source,id:'PUB-'+index,untrusted_text:`测试求是村材料${index}。`+'历史公开材料。'.repeat(3000)}))
    expect(Buffer.byteLength(JSON.stringify(decisionRequestBody(projectDecisionInput(p))))).toBeLessThan(160000)
  })
})
