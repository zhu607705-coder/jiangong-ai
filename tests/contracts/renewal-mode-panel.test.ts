import { expect, test } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { parseHTML } from 'linkedom'
import fixture from '../../fixtures/inputs/01_auto.json'
import RenewalModePanel from '../../apps/workspace/src/maps/RenewalModePanel'
import RenewalResearchEvidence from '../../apps/workspace/src/maps/RenewalResearchEvidence'
import { projectRenewalModeInput } from '../../packages/retrofit/renewal-mode'
import type { DecisionSupport, ProjectInput } from '../../apps/host/generated/contracts'

const input = () => projectRenewalModeInput({ ...fixture, business_profile: 'neighborhood' } as ProjectInput)
const oldRebuild = { status: 'completed', renewal_mode: { direction: 'rebuild', status: 'preliminary', summary: '原拆原建优先开展前期论证。',
  model_choice: { choice: 'rebuild', confidence: .99, probabilities: { rebuild: .99 } }, priority_constraint: { choice: 'safety' }, reasons: [], source_ids: [], next_step: '既有模型任务' } } as unknown as DecisionSupport

test('the program applies the same satisfied gate even when the saved model suggests another direction', () => {
  const screening = input()
  for (const condition of screening.conditions) Object.assign(condition, {
    value: condition.kind !== 'structure_repairable', state: condition.kind === 'structure_repairable' ? 'restricted' : 'supported',
    source_ids: ['CONFIRMED-OBJECT-REPORT'], locators: ['条件确认表第3页'],
  })
  const model = structuredClone(oldRebuild)
  model.renewal_mode!.direction = 'comprehensive'
  const { document } = parseHTML(renderToStaticMarkup(createElement(RenewalModePanel, { endpoint: '/projects/test/renewal-mode', input: screening, decision: model })))
  expect(document.querySelector('.renewal-direction>strong')?.textContent).toBe('原拆原建优先论证')
  expect(document.querySelector('.renewal-gate>summary')?.textContent).toContain('已满足 9/9')
})

test('a cached model demolition preference cannot replace the current evidence gate in the headline', () => {
  const screening = input()
  const { document } = parseHTML(renderToStaticMarkup(createElement(RenewalModePanel, { endpoint: '/projects/test/renewal-mode', input: screening, decision: oldRebuild })))
  expect(document.querySelector('.renewal-direction>strong')?.textContent).toBe('综合整治优先研究')
  expect(document.querySelector('.renewal-main-reason')?.textContent).toContain('逐栋核实结构')
  expect(document.querySelector('.renewal-next')?.textContent).toContain('逐栋安全鉴定')
  expect(document.querySelector('.renewal-gate')?.tagName).toBe('DETAILS')
  expect(document.querySelector('.renewal-gate')?.hasAttribute('open')).toBe(false)
  expect(document.querySelector('.renewal-gate>summary')?.textContent).toContain('已满足 0/9')
  expect(document.querySelector('.renewal-gate>summary')?.textContent).toContain('待核 9')
  expect(document.querySelectorAll('.renewal-gate li[data-state="unknown"]').length).toBe(9)
  const audit = document.querySelector('.renewal-model-audit')!
  expect(audit.hasAttribute('open')).toBe(false)
  expect(audit.textContent).toContain('原始模型偏好：原拆原建')
  expect(document.querySelector('.renewal-baseline-note')).toBeNull()
})

test('confirmed unsafe-to-repair conditions show investigation and retain source references, rather than recommending renovation', () => {
  const screening = input()
  screening.conditions.find(row => row.kind === 'structure_repairable')!.value = false
  screening.conditions.find(row => row.kind === 'structure_repairable')!.state = 'restricted'
  screening.conditions.find(row => row.kind === 'structure_repairable')!.source_ids = ['SAFETY-REPORT']
  screening.conditions.find(row => row.kind === 'structure_repairable')!.locators = ['专业鉴定第 4 页']
  const { document } = parseHTML(renderToStaticMarkup(createElement(RenewalModePanel, { endpoint: '/projects/test/renewal-mode', input: screening, decision: oldRebuild })))
  expect(document.querySelector('.renewal-direction>strong')?.textContent).toBe('先核查模式关键条件')
  expect(document.querySelector('.renewal-gate li[data-state="met"]')?.textContent).toContain('已触发')
  expect(document.querySelector('.renewal-gate')?.textContent).toContain('SAFETY-REPORT')
  expect(document.querySelector('.renewal-gate')?.textContent).toContain('专业鉴定第 4 页')
  expect(document.querySelector('.renewal-main-reason')?.textContent).toContain('修缮不可行')
})

test('the condition summary counts actual satisfied, unknown, unmet and conflicting checks independently', () => {
  const screening = input()
  const set = (kind: string, value: boolean | null, state: 'supported' | 'restricted' | 'conflict') => Object.assign(screening.conditions.find(row => row.kind === kind)!, { value, state, source_ids: ['CONDITION-SOURCE'], locators: ['条件记录第3页'] })
  set('structure_repairable', false, 'restricted')
  set('rights_clear', true, 'supported')
  set('funding_secured', false, 'restricted')
  set('demolition_permitted', null, 'conflict')
  const { document } = parseHTML(renderToStaticMarkup(createElement(RenewalModePanel, { endpoint: '/projects/test/renewal-mode', input: screening })))
  const summary = document.querySelector('.renewal-gate>summary')?.textContent
  expect(summary).toContain('已满足 2/9'); expect(summary).toContain('待核 5')
  expect(summary).toContain('未满足 1'); expect(summary).toContain('冲突 1')
  expect(document.querySelectorAll('.renewal-gate li[data-state="unknown"]')).toHaveLength(5)
  expect(document.querySelector('.renewal-gate')?.textContent).toContain('条件记录第3页')
})

test('model restrictions remain auditable while the visible brief leads with the recommendation and next action', () => {
  const reason = '原始模型输出中的限制与待核原因。'
  const decision = structuredClone(oldRebuild)
  decision.renewal_mode!.reasons = [reason]
  const { document } = parseHTML(renderToStaticMarkup(createElement(RenewalModePanel, { endpoint: '/projects/test/renewal-mode', input: input(), decision })))
  expect(document.querySelector('.renewal-decision-brief')?.textContent).not.toContain(reason)
  expect(document.querySelector('.renewal-direction>.renewal-restriction')).toBeNull()
  expect(document.querySelector('.renewal-model-audit')?.hasAttribute('open')).toBe(false)
  expect(document.querySelector('.renewal-model-audit .renewal-restriction')?.textContent).toBe(reason)
  expect(document.querySelector('.renewal-gate')?.textContent).toContain('在同一范围和价格年')
  expect(document.querySelector('.renewal-gate')?.textContent).toContain('形成两方案费用—效果表')
  expect(document.querySelector('.renewal-gate')?.textContent).not.toContain('不构造统一费用比值')
})

test('researched costs distinguish the local elevator draft from subsidy rules and cross-region control prices', () => {
  const screening = input()
  screening.synthetic = false
  screening.object_ref = 'project:P-0529974d-63fe-4ae8-804d-e5efb049f60a'
  const { document } = parseHTML(renderToStaticMarkup(createElement(RenewalResearchEvidence, { input: screening })))
  const groups = [...document.querySelectorAll('.renewal-research-group')]
  expect(groups[0].querySelector('h5')?.textContent).toBe('本项目局部包件原文')
  expect(groups[0].textContent).toContain('75幢1单元')
  expect(groups[0].textContent).toContain('54 万元')
  expect(groups[0].textContent).toContain('2024年 · 单部电梯 · 草案估算')
  expect(groups[1].textContent).toContain('400 元/平方米')
  expect(groups[1].textContent).toContain('50%')
  expect(groups[1].textContent).toContain('520 元/平方米')
  expect(groups[1].textContent).toContain('排除加装电梯、二次供水')
  expect(document.querySelector('.renewal-research-missing')?.textContent).toContain('尚缺同口径修缮、重建两套全周期核算')
  expect(document.querySelectorAll('a[href^="https://"]').length).toBe(4)
  expect(screening.conditions.every(row => row.value === null)).toBe(true)
  screening.object_ref = 'project:OTHER'
  const other = parseHTML(renderToStaticMarkup(createElement(RenewalResearchEvidence, { input: screening }))).document
  expect(other.querySelector('.renewal-research-group h5')?.textContent).toBe('杭州政策与外地费用参考')
  expect(other.querySelector('.renewal-research-evidence')?.textContent).not.toContain('本项目局部包件原文')
})
