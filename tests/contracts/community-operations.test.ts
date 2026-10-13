import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import express from 'express'
import { mkdtemp, rm } from 'node:fs/promises'
import type { Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import fixture from '../../fixtures/inputs/01_auto.json'
import { Store } from '../../apps/host/store'
import { registerCommunityOperations } from '../../apps/host/community-operations'
import { OperationsError, shanghaiDate, type OperationsCalculator } from '../../packages/operations/service'
import { isOperationsOriginal } from '../../packages/operations/sources'
import type {
  OperationsComparison, OperationsInput, OperationsObservation, OperationsObservationInput,
  OperationsResult, OperationsSnapshot, OperationsValue, OperationsWorkspace, ProjectInput, Source,
} from '../../apps/host/generated/contracts'

// These are HTTP engineering fixtures, not collected community operations data.
// synthetic:false is used only to exercise the accepted source contract. All
// calculation outputs are explicit stubs; formula correctness belongs to Python tests.
const owner = 'operations-http-owner'
it('keeps synthetic lineages and explicitly AI-authored drafts out of actual records', () => {
  expect(isOperationsOriginal(source())).toBe(true)
  expect(isOperationsOriginal({ ...source(), data_class: 'semi_synthetic' })).toBe(false)
  expect(isOperationsOriginal({ ...source(), title: '求是村_公开资料研究_AI研究草稿_已校验版.pdf' })).toBe(false)
  expect(isOperationsOriginal({ ...source(), synthetic: true, data_class: 'synthetic' })).toBe(false)
})
const source = (): Source => ({
  id: 'HTTP-FIXTURE-SOURCE', title: 'HTTP工程fixture月度台账（非真实运营资料）',
  synthetic: false, data_class: 'internal', visibility: 'internal', content_status: 'uploaded',
  url: 'https://example.invalid/http-engineering-fixture-original',
  published_at: '2020-02-02', untrusted_text: 'HTTP工程fixture，非真实运营资料。2020年1月：服务0人次，去重0人。',
})
const value = (number: number, unit: string): OperationsValue => ({
  value: number, unit, status: 'assumption', source_kind: 'demo',
  source: 'HTTP工程fixture参数，仅验证接口持久化', as_of: '2020-01-01',
})
const scenario = (): OperationsInput => ({
  name: 'HTTP工程fixture情景', facility_id: 'HTTP-FIXTURE-CENTER', facility_name: 'HTTP工程fixture中心',
  period: '2020-01', scope_note: 'HTTP工程fixture：独立服务室，月度排班，非真实运营预测。',
  target_population: value(200, '人'), unique_users: value(40, '人'), cost_scope_complete: true,
  services: [{
    id: 'HTTP-FIXTURE-SERVICE', name: 'HTTP工程fixture活动', resource_id: 'HTTP-FIXTURE-ROOM',
    schedule_note: 'HTTP工程fixture：单独使用时段', capacity_per_slot: value(10, '人次/时段'),
    available_slots: value(20, '时段/月'), demand_visits: value(100, '人次/月'),
    paid_share: value(0.5, '比例'), fee_per_visit: value(2.4, '元/人次'), variable_cost_per_visit: value(1, '元/人次'),
  }],
  cash_items: [{ economic_item_id: 'HTTP-FIXTURE-RENT', description: 'HTTP工程fixture固定支出', kind: 'fixed_cost', amount: value(500, '元/月') }],
})
const result: OperationsResult = {
  model_version: 'http-contract-stub-v1', result_kind: 'scenario_prediction', status: 'complete',
  metrics: {
    capacity_visits: 200, served_visits: 100, unmet_visits: 0, utilization: 0.5, unique_users: 40, coverage: 0.2,
    fee_income: 120, earned_income: 120, operating_cost: 600, government_purchase: 0, operating_subsidy: 0,
    other_support: 0, balance_before_support: -480, balance_after_support: -480, unfunded_gap: 480,
    required_subsidy: 480, government_outlay: 0, government_cost_per_visit: 0, commercial_cost_coverage: 0.2,
    government_direct_cost: 0, total_service_cost: 600,
  }, services: [], missing: [], warnings: ['HTTP工程fixture计算替身输出，不代表公式或真实业务效果验证。'],
}
const observation = (patch: Partial<OperationsObservationInput> = {}): OperationsObservationInput => ({
  facility_id: 'HTTP-FIXTURE-CENTER', period: '2020-01', source_id: 'HTTP-FIXTURE-SOURCE',
  locator: 'HTTP工程fixture：第1页第1行', collected_at: '2020-02-03', split: 'calibration',
  note: 'HTTP工程fixture，非真实运营数据。',
  metrics: { served_visits: 0, unique_users: 0, fee_income: null, operating_cost: null, government_purchase: null, operating_subsidy: null },
  ...patch,
})

describe('community operations HTTP and durable storage engineering contracts', () => {
  let directory: string, store: Store, server: Server | undefined, base: string, sequence = 0
  const evaluate = vi.fn<OperationsCalculator['evaluate']>(async () => structuredClone(result))
  const compare = vi.fn<OperationsCalculator['compare']>(async (snapshot, actual): Promise<OperationsComparison> => ({
    snapshot_id: snapshot.id, observation_id: actual.id, split: actual.input.split, timing: 'retrospective',
    differences: [{ metric: 'served_visits', predicted: 100, observed: 0, error: -100, absolute_error: 100, percentage_error: null }],
  }))
  const calculator: OperationsCalculator = { evaluate, compare }
  const route = (id: string) => `/api/projects/${id}/community-operations`
  async function api<T = { code: string; detail: string }>(path: string, body?: unknown) {
    const response = await fetch(base + path, {
      method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    return { status: response.status, value: await response.json() as T }
  }
  async function createProject(patch: Partial<ProjectInput> = {}, projectOwner = owner) {
    const id = `OPS-HTTP-${++sequence}`
    const input: ProjectInput = {
      ...structuredClone(fixture) as ProjectInput, project_id: id,
      synthetic: false, as_of: '2020-02-03', facts: [], context_rules: [], sources: [source()], ...patch,
    }
    await store.db.query('INSERT INTO projects(id,name,owner_id,input) VALUES($1,$2,$3,$4)', [id, 'HTTP工程fixture项目', projectOwner, JSON.stringify(input)])
    return id
  }
  async function startServer() {
    const app = express()
    app.use(express.json())
    await registerCommunityOperations(app, store, async id => {
      const project = await store.project(id, owner)
      if (!project) throw new OperationsError(404, 'PROJECT_NOT_FOUND', '工程fixture项目不存在')
      return project
    }, calculator)
    server = app.listen(0, '127.0.0.1')
    await new Promise<void>((resolve, reject) => { server!.once('listening', resolve); server!.once('error', reject) })
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  }
  async function stopServer() {
    if (!server) return
    const active = server
    server = undefined
    await new Promise<void>((resolve, reject) => active.close(error => error ? reject(error) : resolve()))
  }
  async function freeze(id: string, input = scenario(), version = 0) {
    const response = await api<OperationsSnapshot>(`${route(id)}/scenarios`, { input, expected_context_version: version })
    expect(response.status, JSON.stringify(response.value)).toBe(201)
    return response.value
  }
  const workspace = (id: string) => api<OperationsWorkspace>(route(id))
  const observe = (id: string, snapshot: OperationsSnapshot, input = observation()) => api<OperationsObservation>(`${route(id)}/observations`, { snapshot_id: snapshot.id, observation: input })
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'community-operations-http-'))
    store = await Store.open(directory)
    await startServer()
  }, 30000)
  afterAll(async () => {
    await stopServer()
    await store?.db.close()
    if (directory) {
      const target = resolve(directory), allowed = resolve(tmpdir()) + sep
      if (!target.startsWith(allowed) || !target.split(sep).at(-1)?.startsWith('community-operations-http-')) throw new Error('Unexpected test cleanup target')
      await rm(target, { recursive: true, force: true })
    }
  })

  it('previews through the injected calculator without writing a snapshot', async () => {
    const id = await createProject(), input = scenario()
    const preview = await api<OperationsResult>(`${route(id)}/preview`, { input })
    expect(preview).toEqual({ status: 200, value: result })
    expect(evaluate).toHaveBeenLastCalledWith(input)
    expect((await workspace(id)).value).toEqual({ scenarios: [], observations: [], comparisons: [] })
  })

  it('freezes once and preserves the ID and timestamp when JSONB reorders input keys', async () => {
    const id = await createProject(), input = scenario(), first = await freeze(id, input)
    const readback = (await workspace(id)).value.scenarios[0]
    expect(readback).toEqual(first)
    // PostgreSQL JSONB canonicalizes object order, unlike the original request.
    expect(JSON.stringify(readback.input)).not.toBe(JSON.stringify(input))
    const repeated = await freeze(id, readback.input)
    expect(repeated.id).toBe(first.id)
    expect(repeated.created_at).toBe(first.created_at)
    expect(repeated.input_hash).toBe(first.input_hash)
    expect((await workspace(id)).value.scenarios).toHaveLength(1)
  })

  it('isolates every project route by owner and rejects a snapshot from another accessible project', async () => {
    const mine = await createProject(), other = await createProject({}, 'another-http-owner'), sibling = await createProject()
    const frozen = await freeze(mine)
    const calls = evaluate.mock.calls.length
    for (const [path, body] of [
      [route(other), undefined], [`${route(other)}/preview`, { input: scenario() }],
      [`${route(other)}/scenarios`, { input: scenario(), expected_context_version: 0 }],
      [`${route(other)}/observations`, { snapshot_id: frozen.id, observation: observation() }],
      [`${route(other)}/scenarios/${frozen.id}/report`, undefined],
    ] as const) expect((await api(path, body)).status).toBe(404)
    expect(evaluate.mock.calls).toHaveLength(calls)
    const cross = await api(`${route(sibling)}/observations`, { snapshot_id: frozen.id, observation: observation() })
    expect(cross).toMatchObject({ status: 404, value: { code: 'OPERATIONS_SNAPSHOT_NOT_FOUND' } })
    expect((await api(`${route(sibling)}/scenarios/${frozen.id}/report`)).status).toBe(404)
    expect((await workspace(sibling)).value).toEqual({ scenarios: [], observations: [], comparisons: [] })
  })

  it('rejects a stale context version and leaves previous snapshots immutable after changes', async () => {
    const id = await createProject(), first = await freeze(id)
    await store.db.query('UPDATE projects SET context_version=context_version+1 WHERE id=$1', [id])
    const stale = await api(`${route(id)}/scenarios`, { input: scenario(), expected_context_version: 0 })
    expect(stale).toMatchObject({ status: 409, value: { code: 'CONTEXT_VERSION_CONFLICT' } })
    expect((await workspace(id)).value.scenarios).toEqual([first])
    const changed = scenario()
    changed.target_population.value = 300
    const next = await freeze(id, changed, 1)
    expect(next.id).not.toBe(first.id)
    expect(next.context_version).toBe(1)
    expect((await workspace(id)).value.scenarios.find(row => row.id === first.id)).toEqual(first)
  })

  it.each(['population', 'service', 'cash'] as const)('rejects future as_of in %s inputs before calculating', async field => {
    const id = await createProject(), input = scenario(), calls = evaluate.mock.calls.length
    const selected = field === 'population' ? input.target_population : field === 'service' ? input.services[0].demand_visits : input.cash_items[0].amount
    selected.as_of = '9999-01-01'
    const response = await api(`${route(id)}/preview`, { input })
    expect(response).toMatchObject({ status: 422, value: { code: 'FUTURE_INPUT_SOURCE' } })
    expect(evaluate.mock.calls).toHaveLength(calls)
  })

  it('rejects unknown fields at request, scenario and observation boundaries', async () => {
    const id = await createProject(), frozen = await freeze(id)
    for (const [path, body] of [
      [`${route(id)}/preview`, { input: scenario(), unexpected: true }],
      [`${route(id)}/preview`, { input: { ...scenario(), unexpected: true } }],
      [`${route(id)}/scenarios`, { input: scenario(), expected_context_version: 0, unexpected: true }],
      [`${route(id)}/observations`, { snapshot_id: frozen.id, observation: { ...observation(), unexpected: true } }],
      [`${route(id)}/observations`, { snapshot_id: frozen.id, observation: observation(), unexpected: true }],
    ] as const) expect(await api(path, body)).toMatchObject({ status: 422, value: { code: 'VALIDATION_ERROR' } })
    expect((await workspace(id)).value.observations).toEqual([])
  })

  it.each([
    ['synthetic project', { synthetic: true }],
    ['missing source', { sources: [] }],
    ['synthetic source flag', { sources: [{ ...source(), synthetic: true }] }],
    ['synthetic data class', { sources: [{ ...source(), data_class: 'synthetic' }] }],
    ['URL-only source', { sources: [{ ...source(), url: 'https://example.invalid/http-fixture', content_status: 'metadata_only', untrusted_text: '' }] }],
    ['excerpt source', { sources: [{ ...source(), content_status: 'excerpt' }] }],
    ['blank original text', { sources: [{ ...source(), untrusted_text: '  ' }] }],
  ] as [string, Partial<ProjectInput>][])('rejects observation from %s', async (_name, patch) => {
    const id = await createProject(patch), frozen = await freeze(id), calls = compare.mock.calls.length
    const response = await api(`${route(id)}/observations`, { snapshot_id: frozen.id, observation: observation() })
    expect(response).toMatchObject({ status: 422, value: { code: 'OBSERVATION_SOURCE' } })
    expect(compare.mock.calls).toHaveLength(calls)
    expect((await workspace(id)).value.observations).toEqual([])
  })

  it('accepts an imported full-text source and stores a source hash independent of later edits', async () => {
    const id = await createProject({ sources: [{ ...source(), content_status: 'full_text' }] }), frozen = await freeze(id)
    const saved = await observe(id, frozen)
    expect(saved.status).toBe(201)
    expect(saved.value.source_hash).toMatch(/^[a-f0-9]{64}$/)
    expect(saved.value.source_title).toBe(source().title)
    expect(saved.value.input.source_id).toBe(source().id)
    expect(saved.value.source_snapshot).toEqual({ ...source(), content_status: 'full_text' })
    const current = (await store.project(id, owner))!
    current.input.sources[0].untrusted_text = 'HTTP工程fixture原文后续修订，旧实绩哈希须保留。'
    current.input.sources[0].title = 'HTTP工程fixture后续标题'
    current.input.sources[0].url = 'https://example.invalid/http-engineering-fixture-revised'
    await store.db.query('UPDATE projects SET input=$2 WHERE id=$1', [id, JSON.stringify(current.input)])
    expect((await workspace(id)).value.observations[0]).toEqual(saved.value)
    expect((await workspace(id)).value.observations[0].source_snapshot).toMatchObject({ untrusted_text: source().untrusted_text, url: source().url })
    expect((await workspace(id)).value.scenarios[0]).toEqual(frozen)
  })

  it('rejects an observation collected before its source publication date', async () => {
    const id = await createProject({ sources: [{ ...source(), published_at: '2020-02-10' }] }), frozen = await freeze(id)
    expect(await api(`${route(id)}/observations`, { snapshot_id: frozen.id, observation: observation() }))
      .toMatchObject({ status: 422, value: { code: 'OBSERVATION_SOURCE_DATE' } })
  })

  it('rejects incomplete current months and collection within the measured month or in the future', async () => {
    const id = await createProject(), currentInput = scenario()
    currentInput.period = shanghaiDate().slice(0, 7)
    const current = await freeze(id, currentInput), old = await freeze(id)
    for (const [frozen, actual] of [
      [current, observation({ period: currentInput.period, collected_at: shanghaiDate() })],
      [old, observation({ collected_at: '2020-01-31' })],
      [old, observation({ collected_at: '9999-02-01' })],
    ] as const) expect(await api(`${route(id)}/observations`, { snapshot_id: frozen.id, observation: actual }))
      .toMatchObject({ status: 422, value: { code: 'OBSERVATION_PERIOD' } })
    expect((await workspace(id)).value.observations).toEqual([])
  })

  it.each([{ facility_id: 'HTTP-OTHER-CENTER' }, { period: '2020-02' }])('rejects a different observation scope %j', async patch => {
    const id = await createProject(), frozen = await freeze(id)
    expect(await api(`${route(id)}/observations`, { snapshot_id: frozen.id, observation: observation(patch) }))
      .toMatchObject({ status: 422, value: { code: 'OBSERVATION_SCOPE' } })
  })

  it('rejects all-missing observations and fractional or inconsistent counts', async () => {
    const id = await createProject(), frozen = await freeze(id)
    for (const [metrics, code] of [
      [{ ...observation().metrics, served_visits: null, unique_users: null }, 'OBSERVATION_EMPTY'],
      [{ ...observation().metrics, served_visits: 1.5 }, 'OBSERVATION_COUNT'],
      [{ ...observation().metrics, unique_users: 0.5 }, 'OBSERVATION_COUNT'],
      [{ ...observation().metrics, served_visits: 1, unique_users: 2 }, 'OBSERVATION_DENOMINATOR'],
    ] as const) expect(await api(`${route(id)}/observations`, { snapshot_id: frozen.id, observation: observation({ metrics }) }))
      .toMatchObject({ status: 422, value: { code } })
  })

  it('prevents duplicate center-month registration and relabeling calibration data as holdout', async () => {
    const id = await createProject(), frozen = await freeze(id), actual = await observe(id, frozen)
    expect(actual.status).toBe(201)
    const changed = scenario()
    changed.name = '同一中心月份的另一HTTP工程fixture情景'
    const another = await freeze(id, changed)
    for (const snapshot of [frozen, another]) {
      expect(await api(`${route(id)}/observations`, { snapshot_id: snapshot.id, observation: observation({ split: 'holdout' }) }))
        .toMatchObject({ status: 409, value: { code: 'OBSERVATION_EXISTS' } })
    }
    const saved = (await workspace(id)).value
    expect(saved.observations).toEqual([actual.value])
    expect(saved.comparisons).toHaveLength(1)
    expect(saved.comparisons[0].split).toBe('calibration')
  })

  it('exports frozen provenance and differences while preserving the calculator null percentage for zero actual', async () => {
    const id = await createProject(), frozen = await freeze(id)
    const before = await fetch(base + `${route(id)}/scenarios/${frozen.id}/report`)
    expect(await before.text()).toContain('当前没有实绩验证结果')
    const saved = await observe(id, frozen)
    expect(saved.status).toBe(201)
    const comparison = (await workspace(id)).value.comparisons[0]
    expect(comparison.differences[0]).toEqual({ metric: 'served_visits', predicted: 100, observed: 0, error: -100, absolute_error: 100, percentage_error: null })
    const response = await fetch(base + `${route(id)}/scenarios/${frozen.id}/report`)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/markdown')
    expect(response.headers.get('content-disposition')).toContain(frozen.id)
    const report = await response.text()
    for (const text of [frozen.id, frozen.input_hash, frozen.created_at, result.model_version, source().title,
      scenario().target_population.source, observation().locator, '2020-02-03', '实际−预测', '历史回放对照', '校准', '不适用']) expect(report).toContain(text)
    expect(report).not.toContain('Infinity')
    expect(report).not.toContain('NaN')
  })

  it('physically reads back snapshots, observations and comparisons after closing and reopening Store', async () => {
    const id = await createProject(), frozen = await freeze(id), actual = await observe(id, frozen)
    expect(actual.status).toBe(201)
    const before = (await workspace(id)).value
    await stopServer()
    await store.db.close()
    store = await Store.open(directory)
    await startServer()
    expect((await workspace(id)).value).toEqual(before)
    const repeated = await freeze(id, (await workspace(id)).value.scenarios[0].input)
    expect(repeated.id).toBe(frozen.id)
    expect(repeated.created_at).toBe(frozen.created_at)
    expect((await workspace(id)).value.observations[0].source_hash).toBe(actual.value.source_hash)
    expect((await workspace(id)).value.scenarios).toHaveLength(1)
  }, 30000)
})
