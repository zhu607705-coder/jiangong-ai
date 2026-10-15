import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { parseHTML } from 'linkedom'
import ConstructionCostLibrary from '../../apps/workspace/src/components/ConstructionCostLibrary'

afterEach(() => vi.unstubAllGlobals())

describe('global and project construction-cost views', () => {
  it.each([
    [undefined, '/api/construction-costs?'],
    ['P-TARGET', '/api/projects/P-TARGET/construction-costs?'],
  ])('reads the existing cost contract for project %s', async (projectId, expectedPath) => {
    const dom = parseHTML('<html><body><div id="root"></div></body></html>')
    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.document)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const transport = vi.fn().mockImplementation(async () => new Response(JSON.stringify({
      items: [], platforms: [], summary: { matched: 0, total: 0, source_count: 0, issues: [] }, benchmark: { groups: [], excluded: [] },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', transport)
    const root = createRoot(dom.document.getElementById('root')!)
    try {
      await act(async () => root.render(createElement(ConstructionCostLibrary, { projectId })))
      const toggle = dom.document.querySelector<HTMLButtonElement>('.cost-library-toggle')!
      if (toggle.getAttribute('aria-expanded') === 'false') await act(async () => toggle.click())
      await vi.waitFor(() => expect(transport).toHaveBeenCalledWith(expectedPath, expect.objectContaining({ method: 'GET' })))
      await vi.waitFor(() => expect(dom.document.querySelector<HTMLAnchorElement>('.cost-library-toolbar a')?.getAttribute('href')).toBe(expectedPath.replace(/\?$/, '/export')))
      expect(transport.mock.calls.every(([, request]) => request.method === 'GET')).toBe(true)
    } finally { await act(async () => root.unmount()) }
  })
})
