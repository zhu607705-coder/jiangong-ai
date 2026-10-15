import express from 'express'
import type { Server } from 'node:http'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ProjectRecord, Store } from '../../apps/host/store'
import type { ConstructionCostLibrary } from '../../packages/construction-costs/library'
import type { StrategyPacket, StrategyProgress } from '../../packages/retrofit/strategy'

const research = vi.hoisted(() => vi.fn())
vi.mock('../../services/map-screening/renewal-strategy', () => ({ researchRenewalStrategy: research }))
vi.mock('../../services/map-screening/renewal-history', () => ({ renewalHistory: async () => ({ records: [], official_costs: [] }) }))
import { registerRenewalMode } from '../../apps/host/renewal-mode'

let server: Server | undefined
let origin = ''
let changed = false
let cache: StrategyPacket | null = null
let inserted = 0
const result: StrategyPacket = { project_id: 'P-STREAM', context_version: 1, input_hash: 'fixture', created_at: '2026-10-15T00:00:00Z', synthetic: false,
  status: 'failed', strategy: null, sources: [], decision: null, model_calls: [], research: null, error: '连接模型服务失败，本轮未生成整体更新方案。' }

beforeEach(async () => {
  changed = false; cache = null; inserted = 0
  const input = { ...JSON.parse(readFileSync('fixtures/inputs/01_auto.json', 'utf8')), project_id: 'P-STREAM', business_profile: 'neighborhood', sources: [], facts: [] }
  const project = { id: 'P-STREAM', name: '离线协议样本', context_version: 1, input } as ProjectRecord
  const store = { db: { exec: vi.fn(), query: vi.fn(async (sql: string) => {
    if (sql.startsWith('INSERT')) { inserted++; return { rows: [] } }
    return { rows: sql.includes('renewal_strategy_assessments') && cache ? [{ payload: cache }] : [] }
  }) } } as unknown as Store
  research.mockReset().mockImplementation(async (...args: unknown[]) => {
    const options = args[7] as { onProgress?: (event: StrategyProgress) => void }
    options.onProgress?.({ type: 'progress', stage: 'sources', status: 'completed', message: '已整理对象原文', source_count: 2 })
    options.onProgress?.({ type: 'progress', stage: 'model', status: 'failed', message: result.error! })
    return result
  })
  const app = express(); app.use(express.json())
  let reads = 0
  await registerRenewalMode(app, store, async () => ({ ...project, context_version: changed && ++reads > 1 ? 2 : 1 }), {} as ConstructionCostLibrary, vi.fn())
  await new Promise<void>(resolve => { server = app.listen(0, '127.0.0.1', () => resolve()) })
  origin = `http://127.0.0.1:${(server!.address() as { port: number }).port}`
})
afterEach(async () => { await new Promise<void>((resolve, reject) => server?.close(error => error ? reject(error) : resolve())) })

it('streams actual progress and one terminal packet, preserving the normal JSON API', async () => {
  const response = await fetch(origin + '/api/projects/P-STREAM/renewal-strategy', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' }, body: JSON.stringify({ refresh: true }) })
  expect(response.headers.get('content-type')).toContain('application/x-ndjson')
  expect(response.headers.get('x-accel-buffering')).toBe('no')
  const events = (await response.text()).trim().split('\n').map(line => JSON.parse(line))
  expect(events.map(event => event.type)).toEqual(['progress', 'progress', 'complete'])
  expect(events[0].source_count).toBe(2)
  expect(events[2].result.status).toBe('failed')
  expect(inserted).toBe(1)
})

it('returns a cached read without starting research, including clients that prefer streams', async () => {
  cache = result
  const response = await fetch(origin + '/api/projects/P-STREAM/renewal-strategy', { headers: { Accept: 'application/x-ndjson' } })
  expect(response.headers.get('content-type')).toContain('application/json')
  expect(await response.json()).toEqual(result)
  expect(research).not.toHaveBeenCalled()
  expect(inserted).toBe(0)
})

it('ends an obsolete streamed run with a Chinese error and does not save it', async () => {
  changed = true
  const response = await fetch(origin + '/api/projects/P-STREAM/renewal-strategy', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' }, body: '{}' })
  const events = (await response.text()).trim().split('\n').map(line => JSON.parse(line))
  expect(events.at(-1)).toEqual({ type: 'error', message: '研究期间资料已变化，请刷新后重新研究。' })
  expect(events.some(event => event.type === 'complete')).toBe(false)
  expect(inserted).toBe(0)
})

it('reports a failed refresh without replacing a completed cached result', async () => {
  const quote = '已保存的本对象原文仍可用于核查。'
  cache = { ...result, status: 'completed', error: null,
    sources: [{ id: 'OBJECT', title: '本对象原文', text: quote, url: null, published_at: null, role: 'current', locator: 'line:1' }],
    strategy: { headline: '已保存的分项更新研究', summary: '保留完整方案及对应原文。', preferred_mode: 'comprehensive',
      rationale: [{ point: '保留对象材料', source_id: 'OBJECT', quote }],
      paths: (['comprehensive','rebuild'] as const).map(mode => ({ mode, title: '研究路径', description: '按对象核查条件。', actions: [], requirements: [] })),
      dimensions: (['demand','supply','adaptation','implementation','operations','resources'] as const).map(key => ({ key, current: '原文现况', current_level: 'unknown', comprehensive: '分项目标', comprehensive_level: 'unknown', rebuild: '条件化目标', rebuild_level: 'unknown', evidence_refs: ['OBJECT'] })),
      next_checks: [] } }
  const response = await fetch(origin + '/api/projects/P-STREAM/renewal-strategy', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' }, body: JSON.stringify({ refresh: true }) })
  const events = (await response.text()).trim().split('\n').map(line => JSON.parse(line))
  expect(events.at(-1).result.status).toBe('failed')
  expect(inserted).toBe(0)
  const saved = await fetch(origin + '/api/projects/P-STREAM/renewal-strategy').then(response => response.json())
  expect(saved.status).toBe('completed')
})
