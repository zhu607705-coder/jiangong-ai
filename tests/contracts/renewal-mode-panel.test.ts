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

test('a cached model demolition preference cannot replace the current evidence gate in the headline', () => {
  const screening = input()
  const { document } = parseHTML(renderToStaticMarkup(createElement(RenewalModePanel, { endpoint: '/projects/test/renewal-mode', input: screening, decision: oldRebuild })))
  expect(document.querySelector('.renewal-direction>strong')?.textContent).toBe('综合整治优先研究')
  expect(document.querySelector('.renewal-gate-result')?.textContent).toContain('当前未推荐拆建')
  expect(document.querySelectorAll('.renewal-gate li[data-state="unknown"]').length).toBe(9)
  const audit = document.querySelector('.renewal-model-audit')!
  expect(audit.hasAttribute('open')).toBe(false)
  expect(audit.textContent).toContain('原始模型偏好：原拆原建')
  expect(document.querySelector('.renewal-baseline-note')?.textContent).toContain('逐栋鉴定')
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
  expect(document.querySelector('.renewal-direction>p')?.textContent).toContain('修缮不可行')
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
