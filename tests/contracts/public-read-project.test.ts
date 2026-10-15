import { afterEach, describe, expect, it } from 'vitest'
import express from 'express'
import type { Server } from 'node:http'
import fixture from '../../fixtures/inputs/02_enterprise.json'
import type { ProjectInput, Source } from '../../apps/host/generated/contracts'
import { AdminAccess, registerAdminRoutes } from '../../apps/host/admin-auth'
import { publicProjectInput } from '../../apps/host/public-project'

const servers: Server[] = [], accesses: AdminAccess[] = []
afterEach(async () => {
  for (const access of accesses.splice(0)) access.close()
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections() })))
})
const source = (id: string, visibility: Source['visibility'], data_class: Source['data_class']): Source => ({
  id, title: id, visibility, data_class, synthetic: false, untrusted_text: visibility === 'internal' || data_class === 'internal' ? 'PRIVATE_SOURCE' : '公开原文',
})
function project(): ProjectInput {
  const value = structuredClone(fixture) as ProjectInput
  value.synthetic = false
  value.sources = [source('public', 'public', 'public'), source('internal', 'internal', 'internal'), source('mislabelled', 'public', 'internal')]
  value.facts = value.sources.map(source => ({ id: `fact-${source.id}`, kind: 'table_row', source_id: source.id,
    value: source.id === 'public' ? '公开记录' : 'PRIVATE_FACT', unit: null }))
  value.context_rules = [{ id: 'rule', kind: 'unknown', scope: 'project', project_id: value.project_id,
    source_id: 'internal', predicate: 'private', value: 'PRIVATE_RULE', authority_status: 'unverified',
    supersedes: null, note: '', original_text: 'PRIVATE_RULE', active: true }]
  value.events = [{ kind: 'PRIVATE_EVENT' }]
  value.knowledge_query = { measure_key: 'funding', question: 'PRIVATE_QUESTION' }
  return value
}

describe('legacy public project projection', () => {
  it('returns only public-source facts and removes internal context and questions without mutating the stored input', () => {
    const current = project(), before = JSON.stringify(current), visible = publicProjectInput(current)
    expect(visible.sources.map(source => source.id)).toEqual(['public'])
    expect(visible.facts.map(fact => fact.source_id)).toEqual(['public'])
    expect(visible.context_rules).toEqual([])
    expect(visible.events).toEqual([])
    expect(visible.knowledge_query).toBeUndefined()
    expect(JSON.stringify(visible)).not.toContain('PRIVATE_')
    expect(visible.scope).toEqual(current.scope)
    expect(JSON.stringify(current)).toBe(before)
    visible.sources[0].title = 'visible copy changed'
    expect(current.sources[0].title).toBe('public')
  })
  it('preserves explicit public simulation labels while excluding privately stored simulation material', () => {
    const current = project(); current.synthetic = true
    current.sources = [{ ...source('demo-public', 'public', 'synthetic'), synthetic: true },
      { ...source('demo-private', 'internal', 'synthetic'), synthetic: true }]
    current.facts = []
    const visible = publicProjectInput(current)
    expect(visible.synthetic).toBe(true)
    expect(visible.sources).toEqual([current.sources[0]])
    expect(visible.sources[0].data_class).toBe('synthetic')
  })
})

async function service(collaborative: boolean) {
  const app = express(), access = new AdminAccess('fixture-admin', `scrypt$${'11'.repeat(16)}$${'22'.repeat(64)}`, 300, true, collaborative)
  accesses.push(access)
  registerAdminRoutes(app, access, () => ({}), () => '<html>login</html>')
  const current = project()
  app.get('/api/projects/P-one', (_request, response) => response.json({ input: response.locals.workbenchRole === 'viewer' ? publicProjectInput(current) : current }))
  for (const path of ['/api/projects/P-one/documents', '/api/projects/P-one/knowledge/pipeline', '/api/projects/P-one/research-rounds', '/api/runs/R-one/decision-packet']) {
    app.get(path, (_request, response) => response.json({ text: 'PRIVATE_RESULT' }))
  }
  app.post('/api/projects/P-one/knowledge/retrieve', (_request, response) => response.json({ text: 'PRIVATE_RESULT' }))
  const server = app.listen(0, '127.0.0.1'); servers.push(server)
  await new Promise<void>(resolve => server.once('listening', resolve))
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const session = await fetch(`${base}/api/session`), cookie = session.headers.get('set-cookie')?.split(';')[0]
  return { request: (path: string, method = 'GET') => fetch(`${base}${path}`, { method,
    headers: { 'X-Requested-With': 'haizhizi', ...(cookie ? { Cookie: cookie } : {}) } }) }
}
it('blocks legacy viewers from raw documents, private results and internal RAG while retaining the projected project', async () => {
  const { request } = await service(false)
  const current = await request('/api/projects/P-one')
  expect(current.status).toBe(200)
  expect(await current.text()).not.toContain('PRIVATE_')
  for (const path of ['/api/projects/P-one/documents', '/api/projects/P-one/knowledge/pipeline', '/api/projects/P-one/research-rounds', '/api/runs/R-one/decision-packet']) {
    const response = await request(path)
    expect(response.status).toBe(403)
    expect(await response.text()).not.toContain('PRIVATE_RESULT')
  }
  expect((await request('/api/projects/P-one/knowledge/retrieve', 'POST')).status).toBe(403)
})
it('preserves shared collaboration access independently of the legacy viewer policy', async () => {
  const { request } = await service(true)
  expect(await (await request('/api/projects/P-one')).text()).toContain('PRIVATE_SOURCE')
  for (const path of ['/api/projects/P-one/documents', '/api/projects/P-one/knowledge/pipeline', '/api/projects/P-one/research-rounds', '/api/runs/R-one/decision-packet']) expect((await request(path)).status).toBe(200)
  expect((await request('/api/projects/P-one/knowledge/retrieve', 'POST')).status).toBe(200)
})
