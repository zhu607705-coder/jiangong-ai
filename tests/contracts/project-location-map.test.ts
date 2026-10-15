import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { parseHTML } from 'linkedom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import fixture from '../../fixtures/inputs/01_auto.json'
import { api, type Project } from '../../apps/workspace/src/api'
import { loadAmap } from '../../apps/workspace/src/maps/amap-client'
import ProjectLocationMap from '../../apps/workspace/src/components/ProjectLocationMap'

vi.mock('../../apps/workspace/src/api', () => ({ api: vi.fn() }))
vi.mock('../../apps/workspace/src/maps/amap-client', async importOriginal => ({
  ...await importOriginal<typeof import('../../apps/workspace/src/maps/amap-client')>(), loadAmap: vi.fn(),
}))

let root: Root, container: HTMLElement, size: { width: number; height: number }
let observeSize: () => void
const maps: FakeMap[] = [], overlays: { kind: string; options: any }[] = []
class FakeMap {
  handlers = new Map<string, () => void>()
  add = vi.fn()
  setFitView = vi.fn()
  setZoomAndCenter = vi.fn()
  destroy = vi.fn()
  constructor(public element: HTMLElement, public options: any) { maps.push(this) }
  on(event: string, callback: () => void) { this.handlers.set(event, callback) }
}
const sdk = {
  Map: FakeMap,
  Marker: class { constructor(public options: any) { overlays.push({ kind: 'point', options }) } },
  Polygon: class { constructor(public options: any) { overlays.push({ kind: 'polygon', options }) } },
  convertFrom: vi.fn((points: number[][], _type: string, done: Function) => done('complete', { locations: points.map(([lng, lat]) => ({ lng: lng + .005, lat: lat + .003 })) })),
}
function project(id = 'P-ANCHOR'): Project {
  const input = structuredClone(fixture) as unknown as Project['input']
  input.synthetic = false
  input.scope.geometry = null
  delete input.scope.centroid
  input.scope.map_anchor = { provider: 'amap', coordinate_encoding: 'GCJ-02', longitude: 120.129195, latitude: 30.26275, name: '实际登记选点' }
  return { id, name: '当前研究对象', context_version: 1, input }
}
const config = { provider: 'amap', configured: true, js_key: 'not-a-real-key', revision: 'fixture', service_path: '/_AMapService', sdk_version: '2.0' }
beforeEach(() => {
  const { window } = parseHTML('<html><body><div id="root"></div></body></html>')
  vi.stubGlobal('window', window); vi.stubGlobal('document', window.document)
  vi.stubGlobal('Event', window.Event); vi.stubGlobal('MutationObserver', window.MutationObserver)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { observeSize = callback }
    observe() {}
    disconnect() {}
  })
  size = { width: 360, height: 220 }
  window.HTMLElement.prototype.getBoundingClientRect = () => ({ ...size, top: 0, left: 0, right: size.width, bottom: size.height, x: 0, y: 0, toJSON() {} })
  window.getComputedStyle = (element: Element) => ({ display: element.getAttribute('style')?.includes('display: none') ? 'none' : 'block', visibility: 'visible' }) as CSSStyleDeclaration
  container = window.document.getElementById('root') as unknown as HTMLElement
  root = createRoot(container)
  maps.length = 0; overlays.length = 0; sdk.convertFrom.mockClear()
  vi.mocked(api).mockReset().mockResolvedValue(config)
  vi.mocked(loadAmap).mockReset().mockResolvedValue(sdk as any)
})
afterEach(async () => { await act(async () => root.unmount()); vi.useRealTimers(); vi.unstubAllGlobals() })
async function render(value = project()) { await act(async () => { root.render(createElement(ProjectLocationMap, { project: value })) }) }
async function resized() { await act(async () => observeSize()) }
async function complete() { await act(async () => maps.at(-1)!.handlers.get('complete')!()) }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }

test('locates a geometry-null project at its GCJ-02 map anchor using a read-only 2D map', async () => {
  const value = project(), before = JSON.stringify(value)
  await render(value)
  expect(api).toHaveBeenCalledWith('/maps/config', undefined, expect.any(AbortSignal))
  expect(maps).toHaveLength(1)
  expect(maps[0].options).toMatchObject({ center: [120.129195, 30.26275], viewMode: '2D', resizeEnable: true, scrollWheel: false, dragEnable: false, doubleClickZoom: false, touchZoom: false })
  expect(overlays[0]).toMatchObject({ kind: 'point', options: { position: [120.129195, 30.26275] } })
  expect(sdk.convertFrom).not.toHaveBeenCalled()
  expect(container.textContent).toContain('正在加载')
  await complete()
  expect(container.textContent).toContain('已定位')
  expect(container.textContent).toContain('地图选点')
  expect(container.querySelector('a[href="https://www.amap.com/"]')?.textContent).toContain('高德地图')
  expect(container.textContent).not.toContain(config.js_key)
  expect(JSON.stringify(value)).toBe(before)
})

test('waits for positive dimensions and visible ancestors, then resizes without recreating the map', async () => {
  size = { width: 0, height: 0 }
  await render()
  expect(maps).toHaveLength(0); expect(api).not.toHaveBeenCalled()
  container.hidden = true; size = { width: 360, height: 220 }
  await resized()
  expect(maps).toHaveLength(0)
  container.hidden = false
  await resized()
  expect(maps).toHaveLength(1)
  const onResize = vi.fn(); window.addEventListener('resize', onResize)
  container.hidden = true; await resized()
  container.hidden = false; await resized()
  size = { width: 420, height: 220 }; await resized()
  expect(maps).toHaveLength(1); expect(maps[0].destroy).not.toHaveBeenCalled()
  expect(onResize).toHaveBeenCalled()
})

test('does not create a map if the container becomes hidden while the SDK loads', async () => {
  vi.useFakeTimers()
  const pending = deferred<any>(); vi.mocked(loadAmap).mockReturnValueOnce(pending.promise)
  await render()
  container.hidden = true
  await act(async () => pending.resolve(sdk))
  await act(async () => vi.advanceTimersByTime(21000))
  expect(maps).toHaveLength(0)
  expect(container.querySelector('[role="alert"]')).toBeNull()
  container.hidden = false; await resized()
  expect(maps).toHaveLength(1)
})

test('preserves every polygon ring through WGS84 conversion and shows its boundary meaning', async () => {
  const value = project()
  const rings = [[[120, 30], [120.02, 30], [120.02, 30.02], [120, 30.02], [120, 30]], [[120.005, 30.005], [120.005, 30.01], [120.01, 30.01], [120.01, 30.005], [120.005, 30.005]]]
  value.input.scope.geometry = { type: 'Polygon', coordinates: rings }
  value.input.scope.legal_parcel_confirmed = false
  await render(value); await complete()
  expect(overlays[0]).toMatchObject({ kind: 'polygon', options: { path: rings.map(ring => ring.map(([x, y]) => [x + .005, y + .003])) } })
  expect(maps[0].setFitView).toHaveBeenCalled()
  expect(container.textContent).toContain('研究范围'); expect(container.textContent).toContain('权属边界待确认')
  expect(value.input.scope.geometry.coordinates).toEqual(rings)
  value.input.scope.legal_parcel_confirmed = true
  await render({ ...value })
  expect(overlays.at(-1)?.options.strokeStyle).toBe('solid')
  expect(container.textContent).toContain('已登记项目边界')
})

test('does not invent a location or load the SDK for a synthetic or unlocated project', async () => {
  const value = project(); value.input.synthetic = true
  await render(value)
  expect(container.textContent).toContain('模拟项目'); expect(maps).toHaveLength(0)
  value.input.synthetic = false; delete value.input.scope.map_anchor
  await render({ ...value })
  expect(container.textContent).toContain('尚未登记地图位置')
  expect(container.textContent).toContain('选点')
  expect(api).not.toHaveBeenCalled(); expect(loadAmap).not.toHaveBeenCalled()
})

test('offers a clean retry after loading fails without exposing provider configuration', async () => {
  vi.mocked(loadAmap).mockRejectedValueOnce(new Error(`secret ${config.js_key}`))
  await render()
  expect(container.querySelector('[role="alert"]')).not.toBeNull()
  expect(container.textContent).not.toContain(config.js_key)
  const retry = [...container.querySelectorAll('button')].find(button => button.textContent?.includes('重试'))!
  await act(async () => retry.click())
  expect(maps).toHaveLength(1); await complete()
  expect(container.textContent).toContain('已定位')
})

test('discards an expired project load and destroys only the current preview on unmount', async () => {
  const pending = deferred<any>(); vi.mocked(loadAmap).mockReturnValueOnce(pending.promise)
  await render(project('P-OLD'))
  const next = project('P-NEW'); next.input.scope.map_anchor!.longitude = 120.2
  await render(next)
  expect(maps).toHaveLength(1)
  await act(async () => pending.resolve(sdk))
  expect(maps).toHaveLength(1)
  expect(maps[0].options.center).toEqual([120.2, 30.26275])
  await act(async () => root.unmount())
  expect(maps[0].destroy).toHaveBeenCalledTimes(1)
})
