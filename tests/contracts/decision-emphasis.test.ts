import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { parseHTML } from 'linkedom'
import { expect, test } from 'vitest'
import { renewalCheckEmphasis, dimensionEmphasis } from '../../apps/workspace/src/components/decision-emphasis'
import DecisionDashboard from '../../apps/workspace/src/components/DecisionDashboard'
import type { RenewalModeGateCheck } from '../../packages/retrofit/renewal-mode'
import type { DecisionDashboard as Dashboard } from '../../apps/host/generated/contracts'
import { NEIGHBORHOOD_DASHBOARD_POLICY } from '../../packages/decision/dashboard'

const check = (group: RenewalModeGateCheck['group'], state: RenewalModeGateCheck['state']): RenewalModeGateCheck => ({
  kind: 'test', label: '条件', group, state, detail: '依据', source_ids: [], locators: [],
})

test('unknown evidence is amber and conflicts are red, independently of the gate direction', () => {
  expect(renewalCheckEmphasis(check('feasibility', 'unknown')).tone).toBe('warning')
  expect(renewalCheckEmphasis(check('necessity', 'unknown')).tone).toBe('warning')
  expect(renewalCheckEmphasis(check('feasibility', 'conflict')).tone).toBe('danger')
  expect(renewalCheckEmphasis(check('feasibility', 'unmet')).tone).toBe('danger')
  expect(renewalCheckEmphasis(check('feasibility', 'met')).tone).toBe('success')
})

test('a triggered structural necessity is red, while no necessity is not presented as a blocker', () => {
  expect(renewalCheckEmphasis(check('necessity', 'met'))).toEqual({ tone: 'danger', label: '拆建必要性已触发' })
  expect(renewalCheckEmphasis(check('necessity', 'unmet'))).toEqual({ tone: 'success', label: '未触发拆建必要性' })
})

test('the five existing dashboard levels use weak, middle and strong emphasis without scoring unknown as zero', () => {
  expect([1, 2, 3, 4, 5].map(value => dimensionEmphasis(value).tone)).toEqual(['danger', 'danger', 'warning', 'success', 'success'])
  expect(dimensionEmphasis(null)).toEqual({ tone: 'neutral', label: '待评价' })
})

test('the real dashboard renders matching labels, meters and radar marks and preserves its input', () => {
  const dashboard: Dashboard = { policy_version: NEIGHBORHOOD_DASHBOARD_POLICY, purpose: '呈现', model: 'saved', request_id: 'test', status: 'partial', dimensions:
    (['demand', 'supply', 'adaptation', 'implementation', 'operations', 'resources'] as const).map((key, index) => ({ key, value: [1, 2, 3, 4, 5, null][index], confidence: null, basis: '本对象依据', evidence_refs: [] })) }
  const original = JSON.stringify(dashboard)
  const { document } = parseHTML(renderToStaticMarkup(createElement(DecisionDashboard, { value: dashboard, onEvidence: () => {} })))
  const cards = [...document.querySelectorAll('.dimension-readout>button')]
  expect(cards.map(card => card.getAttribute('data-tone'))).toEqual(['danger', 'danger', 'warning', 'success', 'success', 'neutral'])
  expect(cards.at(-1)?.textContent).toContain('—待评价')
  expect(cards.at(-1)?.querySelectorAll('.filled')).toHaveLength(0)
  expect(document.querySelectorAll('.radar-point[data-tone=danger]')).toHaveLength(2)
  expect(document.querySelectorAll('.radar-point')).toHaveLength(5)
  expect(JSON.stringify(dashboard)).toBe(original)
})
