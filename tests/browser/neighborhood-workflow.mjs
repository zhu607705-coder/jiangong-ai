// Integrated App navigation contract with explicit synthetic projects and a tiny map stub.
// No server, provider credentials, real records or model calls are used.
import { chromium } from '@playwright/test'
import { build } from 'esbuild'
import { mkdir, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'

const source = (id, title, text) => ({ id, title, data_class: 'synthetic', visibility: 'public', synthetic: true,
  version: `synthetic-${id}`, content_status: 'full_text', untrusted_text: text })
const currentSource = source('S-SHARED', '甲项目当前居民材料', '合成当前居民记录，不能覆盖已冻结的历史报告依据。')
const frozenSource = source('S-SHARED', '甲项目报告冻结居民材料', '合成历史居民依据：原文属于甲项目被冻结的研判版本。')
const historicalSource = source('HIST-ONLY', '甲项目仅报告保留的服务材料', '合成历史服务依据：仅存于本次报告来源，不在当前项目资料列表。')
const foreignSource = source('OTHER-ONLY', '乙项目专用资料', '合成乙项目原文，甲项目不能定位这一来源。')
function project(id, name, sources, runs = []) {
  return { id, name, context_version: 1, input: { schema_version: '2.0', project_id: id, mode: 'automatic',
    business_profile: 'neighborhood', synthetic: true, as_of: '2026-10-02', scope: { name, geometry: null,
      scope_type: 'neighborhood', resolution_note: '合成界面测试范围，无真实宗地判断。' }, sources, facts: [],
    context_rules: [], candidate_ids: ['retain_and_reuse', 'defer_and_investigate'], experience_cards: [] }, runs }
}
const packet = { schema_version: '2.0', project_id: 'P-A', run_id: 'RUN-A', revision: 1, snapshot_hash: 'synthetic-only',
  context_version: 1, mode: 'automatic', execution_mode: 'offline', synthetic: true, status: 'partial',
  summary: '合成报告，仅用于来源与会话草稿导航测试。', as_of: '2026-10-02', created_at: '2026-10-02T00:00:00Z',
  findings: [], metrics: [], scenarios: [], reviews: [], followups: [], sources: [frozenSource, historicalSource],
  context_rules: [], impact: { reused: [], invalidated: [] }, warnings: [], missing_fields: [], artifact_refs: [],
  runtime: 'synthetic-ui-fixture', model: null, model_calls: [],
  decision_support: { status: 'partial', answers: null, action: null, priority: null, dashboard: {
    policy_version: 'neighborhood-renovation-fit-v1', purpose: '合成老旧小区测试', model: 'synthetic-only',
    request_id: 'fixture', status: 'partial', dimensions: [
      { key: 'demand', value: 3, basis: '甲项目居民原文，带项目前缀引用。', evidence_refs: ['P-A:S-SHARED'] },
      { key: 'supply', value: 3, basis: '甲项目报告历史服务原文。', evidence_refs: ['HIST-ONLY'] },
      { key: 'resources', value: null, basis: '合成异常引用测试：乙项目资料不属于甲项目。', evidence_refs: ['P-B:OTHER-ONLY'] },
    ] } } }
const projects = [project('P-A', '甲小区 · 合成测试', [currentSource], [
  { id: 'RUN-A', revision: 1, context_version: 1, status: 'completed', decision: packet, error_code: null },
]), project('P-B', '乙小区 · 合成测试', [source('S-SHARED', '乙项目同 ID 资料', '合成乙项目同名 ID 原文。'), foreignSource])]

const mapStub = `import React from 'react';export default function Map({project,onOpenProject}){return <section className="atlas-map" aria-label="合成地图导航">
  <button style={{position:'absolute',top:110,left:140}} onClick={()=>onOpenProject(project?.id)}>打开当前测试项目详情</button></section>}`
const built = await build({ entryPoints: ['apps/workspace/src/main.tsx'], bundle: true, write: false,
  outfile: 'neighborhood-workflow-ui.js', format: 'iife', platform: 'browser', define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [{ name: 'bounded-map-navigation-stub', setup(builder) {
    builder.onResolve({ filter: /^\.\/maps\/MapWorkspace$/ }, () => ({ path: 'map-stub', namespace: 'fixture' }))
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: mapStub, loader: 'tsx', resolveDir: process.cwd() }))
  } }] })
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const requests = [], errors = [], networkRequests = [], checks = []
page.on('pageerror', error => errors.push(String(error)))
await page.route('**/*', route => { networkRequests.push(route.request().url()); return route.abort() })
await page.exposeFunction('__fixtureRequest', (path, method) => {
  requests.push({ path, method })
  assert.equal(method, 'GET', 'Navigation and scheme calculations must not request a model or mutate project data')
  if (path === '/api/session') return { model_configured: false }
  if (path === '/api/projects') return projects
  const route = /^\/api\/projects\/(P-[AB])(?:\/(.*))?$/.exec(path)
  if (!route) throw Error(`Unexpected synthetic request ${path}`)
  const value = projects.find(item => item.id === route[1])
  if (!route[2]) return value
  if (route[2] === 'revision-diff') return { available: false, from_revision: null, to_revision: null, changes: [] }
  if (['followups', 'documents'].includes(route[2])) return []
  if (route[2] === 'experiences') return { cards: [] }
  throw Error(`Unexpected synthetic request ${path}`)
})

const drawer = page.getByRole('region', { name: '项目研究详情' })
const panel = drawer.getByRole('region', { name: '老旧小区改造工作台' })
const tab = name => drawer.getByRole('navigation', { name: '研判工作区' }).getByRole('button', { name, exact: true })
async function openDetails() {
  await page.getByRole('button', { name: '打开当前测试项目详情', exact: true }).click()
  await panel.waitFor()
}
async function assertResearchPage() {
  assert.equal(await drawer.isVisible(), true, 'Project selection opens research immediately')
  assert.equal(await page.locator('.map-stage').isVisible(), false, 'The map is hidden during research')
  assert.equal(await page.getByLabel('合成地图导航').count(), 1, 'The map remains mounted for returning to exploration')
  const bounds = await drawer.boundingBox(), dock = await page.getByRole('navigation', { name: '主导航' }).boundingBox()
  assert.ok(Math.abs(bounds.x - dock.width) <= 1)
  assert.equal(bounds.y, 0)
  assert.ok(Math.abs(bounds.x + bounds.width - page.viewportSize().width) <= 1, 'Research fills the available viewport')
  assert.equal(await drawer.locator('.research-support').getAttribute('open'), null)
  assert.equal(await drawer.locator('.evidence-rail').isVisible(), false, 'Supporting records are collapsed instead of a permanent sidebar')
}
async function switchProject(name) {
  await page.getByRole('button', { name: '打开项目列表', exact: true }).click()
  await page.getByRole('region', { name: '项目空间列表' }).getByRole('button', { name: new RegExp(name) }).click()
  await page.locator('.workspace-boot-overlay').waitFor({ state: 'hidden' })
  await panel.waitFor()
  await assertResearchPage()
}
async function assertResult(expected) {
  assert.deepEqual(await panel.locator('.retrofit-plan-result dd').allTextContents(), expected)
}
async function assertFocusedSource(id, title, text) {
  const focused = drawer.locator('.source-row.is-focused')
  await focused.waitFor()
  assert.equal(await focused.count(), 1)
  assert.equal(await focused.getAttribute('id'), `project-source-${encodeURIComponent(id)}`)
  assert.equal(await focused.locator('h3').innerText(), title)
  await focused.locator('details[open]').waitFor({ state: 'attached' })
  assert.equal(await focused.locator('details').getAttribute('open'), '')
  assert.equal(await focused.locator('pre').innerText(), text)
  assert.equal(await focused.evaluate(element => document.activeElement === element), true)
}

try {
  await page.setContent(`<html lang="zh-CN"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${built.outputFiles.find(file => file.path.endsWith('.css')).text}</style></head><body><div id="root"></div></body></html>`)
  await page.evaluate(() => {
    const data = new Map()
    Object.defineProperty(window, 'localStorage', { value: { getItem: key => data.get(key) || null, setItem: (key, value) => data.set(key, String(value)) } })
    window.EventSource = class { addEventListener() {} close() {} }
    window.fetch = async (path, options = {}) => new Response(JSON.stringify(await window.__fixtureRequest(String(path), options.method || 'GET')),
      { headers: { 'content-type': 'application/json' } })
  })
  await page.addScriptTag({ content: built.outputFiles.find(file => file.path.endsWith('.js')).text })
  await page.locator('.workspace-boot-overlay').waitFor({ state: 'hidden' })
  await openDetails()
  assert.deepEqual(await panel.locator('.dimension-readout button > span:first-child').allTextContents(), ['居民需求', '公共服务', '居住工程', '实施协同', '长效维护', '资金交付'])
  await panel.getByText('调整改造方案与静态资金测算', { exact: true }).click()
  for (const [label, value] of [['基础类工程（万元）', '100'], ['完善类工程（万元）', '20'], ['提升类工程（万元）', '0'], ['计划资金（万元）', '90'], ['涉及户数（户）', '10']]) await panel.getByLabel(label, { exact: true }).fill(value)
  await panel.getByRole('button', { name: '计算并与上次方案比较', exact: true }).click()
  await assertResult(['132', '42', '13.2'])
  checks.push('static assumption calculation: 132 total, 42 gap, 13.2 per household')

  await tab('资料与证据').click()
  await drawer.getByRole('heading', { name: '资料与证据', exact: true }).waitFor()
  await tab('研判总览').click()
  assert.equal(await panel.getByLabel('基础类工程（万元）', { exact: true }).inputValue(), '100')
  assert.equal(await panel.locator('.retrofit-calculator').getAttribute('open'), '')
  await assertResult(['132', '42', '13.2'])
  await panel.getByLabel('基础类工程（万元）', { exact: true }).fill('200')
  await panel.getByRole('button', { name: '计算并与上次方案比较', exact: true }).click()
  await assertResult(['242', '152', '24.2'])
  assert.match(await panel.locator('.retrofit-plan-result').innerText(), /相对上次方案总额变化：110 万元/)
  checks.push('tab remount preserves inputs, open calculator, result and previous comparison')

  await drawer.getByRole('button', { name: '返回地图', exact: true }).click()
  await openDetails()
  await assertResult(['242', '152', '24.2'])
  checks.push('map collapse and reopen preserve scheme draft')
  await switchProject('乙小区')
  await panel.getByText('调整改造方案与静态资金测算', { exact: true }).click()
  assert.equal(await panel.getByLabel('基础类工程（万元）', { exact: true }).inputValue(), '')
  assert.equal(await panel.locator('.retrofit-plan-result').count(), 0)
  await panel.getByLabel('基础类工程（万元）', { exact: true }).fill('7')
  await tab('资料与证据').click()
  assert.equal(await drawer.locator('.source-row.is-focused').count(), 0)
  await switchProject('甲小区')
  assert.equal(await panel.getByLabel('基础类工程（万元）', { exact: true }).inputValue(), '200')
  await assertResult(['242', '152', '24.2'])
  checks.push('project-scoped drafts isolate another project and restore original scheme')

  await panel.getByRole('button', { name: /^居民需求/ }).click()
  await panel.getByRole('button', { name: '查看依据 ↗', exact: true }).click()
  await assertFocusedSource('S-SHARED', frozenSource.title, frozenSource.untrusted_text)
  checks.push('namespaced radar citation selects and opens frozen packet source over current duplicate')
  await tab('研判总览').click()
  await panel.getByRole('button', { name: /^公共服务/ }).click()
  await panel.getByRole('button', { name: '查看依据 ↗', exact: true }).click()
  await assertFocusedSource('HIST-ONLY', historicalSource.title, historicalSource.untrusted_text)
  checks.push('packet-only historical source remains navigable')
  await switchProject('乙小区')
  assert.equal(await panel.getByLabel('基础类工程（万元）', { exact: true }).inputValue(), '7')
  await tab('资料与证据').click()
  assert.equal(await drawer.locator('.source-row.is-focused').count(), 0)
  assert.equal(await drawer.locator('.source-row').filter({ hasText: historicalSource.title }).count(), 0)
  await switchProject('甲小区')
  await assertResult(['242', '152', '24.2'])
  checks.push('source focus and historical material stay isolated after project switch')
  await tab('研判总览').click()
  await panel.getByRole('button', { name: /^资金交付/ }).click()
  await panel.getByRole('button', { name: '查看依据 ↗', exact: true }).click()
  await drawer.getByText('当前版本没有找到所引来源，请核对研判版本与资料记录。', { exact: true }).waitFor()
  assert.equal(await drawer.locator('.source-row.is-focused').count(), 0)
  assert.equal(await drawer.locator('.source-row').filter({ hasText: foreignSource.title }).count(), 0)
  checks.push('foreign-project source cannot be selected or shown')

  await tab('项目经验').click()
  const library = drawer.getByRole('region', { name: '项目经验沉淀' })
  await library.getByRole('button', { name: '上传历史材料', exact: true }).click()
  await drawer.getByRole('heading', { name: '资料与证据', exact: true }).waitFor()
  assert.equal(await tab('资料与证据').getAttribute('aria-current'), 'page')
  assert.equal(await drawer.locator('.source-row.is-focused').count(), 0)
  checks.push('empty experience material action navigates to evidence and clears source focus')
  await mkdir('output/playwright', { recursive: true })
  await tab('研判总览').click()
  await assertResearchPage()
  await page.setViewportSize({ width: 750, height: 1000 })
  await assertResearchPage()
  await page.setViewportSize({ width: 390, height: 844 })
  await assertResearchPage()
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await switchProject('乙小区')
  await drawer.locator('.research-support > summary').click()
  assert.equal(await drawer.locator('.evidence-rail').isVisible(), true)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await drawer.locator('.research-support > summary').click()
  checks.push('desktop and mobile project selection open a full-width research page with the map preserved and supporting records collapsed')
  assert.deepEqual(errors, [])
  assert.deepEqual(networkRequests, [])
  assert.equal(requests.filter(request => request.method !== 'GET').length, 0)
  await writeFile('output/playwright/neighborhood-workflow.json', JSON.stringify({ passed: true, synthetic: true,
    live_provider_verification: false, modelCalls: 0, checks, requests, errors, networkRequests }, null, 2))
  console.log(`PASS neighborhood App workflow: ${checks.length} flow checks; synthetic API, minimal map stub, zero mutation/model/network calls`)
} finally { await browser.close() }
