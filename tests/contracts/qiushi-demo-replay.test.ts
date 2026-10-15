import { afterEach, expect, test } from 'vitest'
import express from 'express'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, dirname, basename } from 'node:path'
import type { Server } from 'node:http'
import { Store } from '../../apps/host/store'
import { installQiushiDemoReplay, qiushiDemoReadOnly, validateQiushiDemoBundle, type QiushiDemoBundle } from '../../apps/host/qiushi-demo'
import { readPublishedStrategy } from '../../apps/host/strategy-publication'
import { QIUSHI_DEMO_PROJECT_ID, QIUSHI_SOURCE_PROJECT_ID } from '../../packages/retrofit/qiushi-demo'

const bundle = () => readFile('data/demos/qiushi-validated-replay.json', 'utf8').then(text => JSON.parse(text) as QiushiDemoBundle)
const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose() })

test('the actual validated model replay seeds once, survives readback, and preserves the original project and failure', async () => {
  const fixture = await bundle(), directory = await mkdtemp(join(tmpdir(), 'qiushi-replay-'))
  cleanup.push(() => {
    const target = resolve(directory)
    if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith('qiushi-replay-')) throw new Error('UNEXPECTED_TEST_CLEANUP_PATH')
    return rm(target, { recursive: true, force: true })
  })
  const store = await Store.open(directory); cleanup.push(() => store.db.close())
  await store.db.exec(`CREATE TABLE renewal_strategy_assessments(owner_id TEXT NOT NULL,project_id TEXT NOT NULL,input_hash TEXT NOT NULL,payload JSONB NOT NULL,created_at TIMESTAMPTZ DEFAULT now(),PRIMARY KEY(owner_id,project_id,input_hash)); CREATE TABLE replay_preserved_failure(id TEXT PRIMARY KEY,payload JSONB NOT NULL)`)
  const original = { ...structuredClone(fixture.project_input), project_id: QIUSHI_SOURCE_PROJECT_ID }
  await store.db.query('INSERT INTO projects(id,owner_id,name,input) VALUES($1,$2,$3,$4)', [QIUSHI_SOURCE_PROJECT_ID, 'test-owner', '原求是村项目', JSON.stringify(original)])
  const failed = { id: fixture.packet.demo_replay!.source_round_id, status: 'failed', result: null }
  await store.db.query('INSERT INTO replay_preserved_failure(id,payload) VALUES($1,$2)', [failed.id, JSON.stringify(failed)])
  expect(await installQiushiDemoReplay(store, 'test-owner', fixture)).toMatchObject({ inserted: true, source_count: 31 })
  expect(await installQiushiDemoReplay(store, 'test-owner', fixture)).toMatchObject({ inserted: false })
  const demo = await store.project(QIUSHI_DEMO_PROJECT_ID, 'test-owner')
  expect(demo?.input).toEqual(fixture.project_input)
  const saved = await readPublishedStrategy(store, demo!, 'independent-live-calculation-key', false)
  expect(saved).toMatchObject({ status: 'completed', publication: { kind: 'saved_snapshot' }, demo_replay: { kind: 'validated_model_replay' } })
  expect(saved?.strategy?.reasoning_dimensions).toHaveLength(6)
  expect(saved?.strategy?.paths.every(path => (path.work_packages?.length || 0) >= 2)).toBe(true)
  expect(saved?.model_calls).toEqual(fixture.packet.model_calls)
  expect((await store.project(QIUSHI_SOURCE_PROJECT_ID, 'test-owner'))?.input).toEqual(original)
  expect((await store.db.query<{ payload: unknown }>('SELECT payload FROM replay_preserved_failure WHERE id=$1', [failed.id])).rows[0].payload).toEqual(failed)
  await store.db.query('UPDATE projects SET context_version=1 WHERE id=$1', [QIUSHI_DEMO_PROJECT_ID])
  await expect(installQiushiDemoReplay(store, 'test-owner', fixture)).rejects.toThrow('QIUSHI_REPLAY_EXISTING_PROJECT_CHANGED')
})

test('a replay cannot substitute source bodies or invent a source quotation', async () => {
  const fixture = await bundle()
  expect(validateQiushiDemoBundle(fixture).packet.status).toBe('completed')
  const bodyMismatch = structuredClone(fixture); bodyMismatch.packet.sources[0].text += '虚构正文'
  expect(() => validateQiushiDemoBundle(bodyMismatch)).toThrow('QIUSHI_REPLAY_SOURCE_BODY_MISMATCH')
  const forged = structuredClone(fixture); forged.packet.strategy!.rationale[0].quote = '这是一条不存在于实际正文的引文'
  expect(() => validateQiushiDemoBundle(forged)).toThrow()
})

test('fixed replay allows evidence lookup and calculations while ordinary projects keep their write actions', async () => {
  const app = express(); app.use(qiushiDemoReadOnly)
  let writes = 0
  app.post('/api/projects/:id/renewal-strategy', (_req, res) => { writes++; res.json({ status: 'normal-live-route' }) })
  app.post('/api/projects/:id/knowledge/retrieve', (_req, res) => res.json({ matches: [] }))
  app.post('/api/projects/:id/community-operations/preview', (_req, res) => res.json({ status: 'calculated' }))
  let server!: Server; await new Promise<void>(resolve => { server = app.listen(0, '127.0.0.1', () => resolve()) })
  cleanup.push(() => new Promise<void>(resolve => server.close(() => resolve())))
  const address = server.address() as { port: number }, base = `http://127.0.0.1:${address.port}/api/projects/`
  expect((await fetch(base + QIUSHI_DEMO_PROJECT_ID + '/renewal-strategy', { method: 'POST' })).status).toBe(409)
  expect(writes).toBe(0)
  expect((await fetch(base + QIUSHI_DEMO_PROJECT_ID + '/knowledge/retrieve', { method: 'POST' })).status).toBe(200)
  expect((await fetch(base + QIUSHI_DEMO_PROJECT_ID + '/community-operations/preview', { method: 'POST' })).status).toBe(200)
  expect((await fetch(base + QIUSHI_SOURCE_PROJECT_ID + '/renewal-strategy', { method: 'POST' })).status).toBe(200)
  expect(writes).toBe(1)
})
