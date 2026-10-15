import { afterEach, expect, test, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { parseHTML } from 'linkedom'
import { readFileSync } from 'node:fs'
import CommunityOperationsPlayground from '../../apps/workspace/src/components/CommunityOperationsPlayground'
import { buildCompleteCommunityDemo } from '../../packages/retrofit/complete-demo'
import { explorationInput } from '../../packages/retrofit/visual-analysis'
import type { Project } from '../../apps/workspace/src/api'

const apiMock = vi.hoisted(() => vi.fn())
vi.mock('../../apps/workspace/src/api', () => ({ api: apiMock }))
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); apiMock.mockReset() })

test('the compact board compares recent plans and restores any retained plan through the full comparison dialog', async () => {
  const demo = buildCompleteCommunityDemo(), dom = parseHTML('<html><body><div id="root"></div></body></html>')
  const result = JSON.parse(readFileSync('research/test_results/complete-community-demo-calculations.json', 'utf8')).scenarios[1].result
  const parameters = [{ demand: 1.5, activitySlots: 15, subsidy: 0 }, { demand: 1, activitySlots: 30, subsidy: 12000 }, { demand: 1.3, activitySlots: 40, subsidy: 6000 }]
  const plans = parameters.map((p, i) => ({ name: `已保留方案${i + 1}`, parameters: p, input: explorationInput(demo, p), result: structuredClone(result) }))
  const storage = new Map([['hzz-synthetic-explorations:P-SCREEN:4:rebuild', JSON.stringify(plans)]])
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.document, IS_REACT_ACT_ENVIRONMENT: true,
    localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) } })) vi.stubGlobal(key, value)
  apiMock.mockResolvedValue(result)
  const project = { id: 'P-SCREEN', context_version: 4 } as Project, onResult = vi.fn()
  const root = createRoot(dom.document.getElementById('root')!)
  try {
    await act(async () => root.render(createElement(CommunityOperationsPlayground, { project, demo, motion: false, onResult, storageScope: '4:rebuild' })))
    await vi.waitFor(() => expect(dom.document.querySelector('.playground-service-detail')?.textContent).toContain('社区活动'))
    const board = dom.document.querySelector('.operations-playground')!
    expect(board.querySelectorAll(':scope > .playground-layout')).toHaveLength(1)
    expect(board.querySelectorAll(':scope > .playground-saved')).toHaveLength(1)
    expect(board.querySelectorAll('.playground-saved-grid > article')).toHaveLength(2)
    expect(board.querySelector('.playground-saved-grid')?.textContent).not.toContain('已保留方案1')
    expect(board.querySelector('.playground-saved-grid')?.textContent).toContain('活动室 40 场/月')
    expect(board.querySelectorAll('.playground-service-bar[role="img"]')).toHaveLength(3)
    expect(board.querySelector('.playground-flow')?.hasAttribute('open')).toBe(false)
    const allButton = Array.from(board.querySelectorAll('button')).find(b => b.textContent?.includes('查看全部 3 个'))!
    await act(async () => allButton.dispatchEvent(new dom.window.Event('click', { bubbles: true })))
    const dialog = dom.document.querySelector('[role="dialog"]')!
    expect(dialog.querySelectorAll('.playground-full-comparison > article')).toHaveLength(3)
    expect(dialog.textContent).toContain('已保留方案1')
    expect(dialog.textContent).toContain('减少活动室开放至15场/月')
    const restoreFirst = dialog.querySelector('.playground-full-comparison > article button')!
    await act(async () => restoreFirst.dispatchEvent(new dom.window.Event('click', { bubbles: true })))
    expect(dom.document.querySelector('[role="dialog"]')).toBeNull()
    await vi.waitFor(() => {
      const input = apiMock.mock.calls.at(-1)?.[1]?.input
      expect(input?.services.find((s: { id: string }) => s.id === 'activity').available_slots.value).toBe(15)
      expect(input?.cash_items.find((s: { kind: string }) => s.kind === 'operating_subsidy').amount.value).toBe(0)
    })
    expect(storage.get('hzz-synthetic-explorations:P-SCREEN:4:rebuild')).toContain('已保留方案1')
  } finally { await act(async () => root.unmount()) }
})
