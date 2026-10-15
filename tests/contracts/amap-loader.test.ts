import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { MapConfiguration } from '../../packages/maps/types'
import type { AmapSdk } from '../../apps/workspace/src/maps/amap-client'

const loader = vi.hoisted(() => ({ load: vi.fn(), reset: vi.fn() }))
vi.mock('@amap/amap-jsapi-loader', () => ({ default: loader }))
const config = (revision = 'same-config'): MapConfiguration => ({ provider: 'amap', configured: true, js_key: 'test-only-key', revision, service_path: '/_AMapService', sdk_version: '2.0' })
const sdk = (name: string) => ({ testIdentity: name }) as unknown as AmapSdk
function deferred<T>() { let resolve!: (value: T) => void, reject!: (reason: Error) => void; const promise = new Promise<T>((done, failed) => { resolve = done; reject = failed }); return { promise, resolve, reject } }
beforeEach(() => { vi.resetModules(); loader.load.mockReset(); loader.reset.mockReset(); vi.stubGlobal('window', { location: { origin: 'http://campus.test' } }) })
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

test('a rejected SDK load can retry with the same configuration revision', async () => {
  const ready = sdk('retried'), { loadAmap } = await import('../../apps/workspace/src/maps/amap-client')
  loader.load.mockRejectedValueOnce(new Error('first attempt failed')).mockResolvedValueOnce(ready)
  await expect(loadAmap(config())).rejects.toThrow('first attempt failed')
  await expect(loadAmap(config())).resolves.toBe(ready)
  expect(loader.load).toHaveBeenCalledTimes(2); expect(loader.reset).toHaveBeenCalledTimes(2)
})

test('concurrent callers for one revision share a single provider SDK load', async () => {
  const pending = deferred<AmapSdk>(), ready = sdk('shared'), { loadAmap } = await import('../../apps/workspace/src/maps/amap-client')
  loader.load.mockReturnValue(pending.promise)
  const first = loadAmap(config()), second = loadAmap(config())
  await vi.waitFor(() => expect(loader.load).toHaveBeenCalledTimes(1))
  pending.resolve(ready)
  expect(await Promise.all([first, second])).toEqual([ready, ready])
  expect(loader.reset).toHaveBeenCalledTimes(1)
  expect((window as unknown as { _AMapSecurityConfig: { serviceHost: string } })._AMapSecurityConfig.serviceHost).toBe('http://campus.test/_AMapService')
})

test('an older configuration rejection cannot clear a newer successful SDK promise', async () => {
  const pending = deferred<AmapSdk>(), ready = sdk('new-config'), { loadAmap } = await import('../../apps/workspace/src/maps/amap-client')
  loader.load.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(ready)
  const first = loadAmap(config('old')), rejected = expect(first).rejects.toThrow('old configuration failed')
  await vi.waitFor(() => expect(loader.load).toHaveBeenCalledTimes(1))
  await expect(loadAmap(config('new'))).resolves.toBe(ready)
  pending.reject(new Error('old configuration failed')); await rejected
  await expect(loadAmap(config('new'))).resolves.toBe(ready)
  expect(loader.load).toHaveBeenCalledTimes(2); expect(loader.reset).toHaveBeenCalledTimes(2)
})
