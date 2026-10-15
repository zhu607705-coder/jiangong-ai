import { beforeEach, afterEach, test, expect } from 'vitest'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import express from 'express'
import type { Server } from 'node:http'
import { Store, type ProjectRecord } from '../../apps/host/store'
import { registerConstructionCosts } from '../../apps/host/construction-costs'
import { hash } from '../../packages/corpus/corpus'
import { ConstructionCostLibrary, COST_MANIFEST_PATH, constructionCostsCsv, type CostManifest } from '../../packages/construction-costs/library'

let root: string, store: Store, library: ConstructionCostLibrary, manifest: CostManifest
const text = '测试社区改造工程合同公告\n项目名称：测试社区改造工程\n项目代码：TEST-PROJECT\n标段编号：TEST-LOT\n工程范围：外立面修缮\n预算金额：120万元\n合同价款：100万元\n公告日期：2025-01-01'
async function setSourceText(value: string) {
  const source = manifest.sources[0], raw = `<html><body>${value}</body></html>`
  await writeFile(resolve(root, source.raw_path), raw)
  await writeFile(resolve(root, source.text_path), value)
  source.raw_sha256 = hash(raw); source.text_sha256 = hash(value)
}
async function addSupport(value: string) {
  const source = { ...manifest.sources[0], id: 'support-fixture', title: '测试社区改造工程招标公告', raw_path: 'data/public_cases/renewal-cost-sources/support.html', text_path: 'data/public_cases/renewal-cost-sources/support.txt' }
  const raw = `<html><body>${value}</body></html>`
  await writeFile(resolve(root, source.raw_path), raw); await writeFile(resolve(root, source.text_path), value)
  source.raw_sha256 = hash(raw); source.text_sha256 = hash(value)
  manifest.sources.push(source)
}
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'construction-cost-library-'))
  await mkdir(join(root, 'data/public_cases/renewal-cost-sources'), { recursive: true })
  store = await Store.open(join(root, 'db'))
  manifest = {
    sources: [{ id: 'source-fixture', title: '测试社区改造工程合同公告', province: '浙江', url: 'https://ggzy.zj.gov.cn/jyxxgk/test-fixture.html', published_at: '2025-01-01', raw_path: 'data/public_cases/renewal-cost-sources/fixture.html', text_path: 'data/public_cases/renewal-cost-sources/fixture.txt', raw_sha256: '', text_sha256: '' }],
    records: [{ id: 'contract-fixture', source_id: 'source-fixture', project_name: '测试社区改造工程', project_code: 'TEST-PROJECT', lot_id: 'TEST-LOT', province: '浙江', city: '杭州', work_type: 'construction', amount_kind: 'contract_price', amount_yuan: 1000000, amount_original: '100万元', amount_quote: '合同价款：100万元', scope_quote: '工程范围：外立面修缮', scale_value: null, scale_unit: null, scale_quote: null, notice_date: '2025-01-01', contract_date: null }],
    platforms: [{ name: '浙江省公共资源交易服务平台', url: 'https://ggzy.zj.gov.cn/', status: 'fixture', note: '仅用于契约测试的临时原文' }],
  }
  await setSourceText(text)
  await writeFile(resolve(root, COST_MANIFEST_PATH), JSON.stringify(manifest))
  library = new ConstructionCostLibrary(store.db, root)
  await library.initialize()
})
afterEach(async () => {
  await store.db.close()
  // The only recursive target is the absolute mkdtemp directory created in this test.
  if (!resolve(root).startsWith(resolve(tmpdir()) + '\\') && !resolve(root).startsWith(resolve(tmpdir()) + '/')) throw new Error('UNSAFE_TEST_CLEANUP')
  await rm(root, { recursive: true, force: true })
})

test('imports source-bound amounts, preserves price stages, and never manufactures unit cost', async () => {
  manifest.records.push({ ...manifest.records[0], id: 'budget-fixture', amount_kind: 'budget', amount_yuan: 1200000, amount_original: '120万元', amount_quote: '预算金额：120万元' })
  expect(await library.importManifest(manifest)).toEqual({ accepted: 2, issues: [] })
  const result = await library.search()
  expect(result.summary.by_amount_kind).toEqual({ budget: 1, contract_price: 1 })
  expect(result.items.every(item => item.scale_value === null && !('unit_price' in item))).toBe(true)
  expect(result.items[0].source.source_hash).toBe(manifest.sources[0].raw_sha256)
  expect((await library.search({ amount_kind: 'budget', q: '测试社区 修缮' })).items).toHaveLength(1)
  expect((await library.search({ province: '广东' })).items).toHaveLength(0)
  expect((await library.search({ work_type: 'design' })).items).toHaveLength(0)
})
test('repeat import is idempotent and source revisions retain immutable history', async () => {
  await library.importManifest(manifest)
  expect((await store.db.query('SELECT * FROM cost_library_items')).rows).toHaveLength(1)
  expect((await store.db.query('SELECT * FROM cost_library_sources')).rows).toHaveLength(1)
  manifest.sources[0].fetched_at = '2026-10-13T09:00:00Z'
  await library.importManifest(manifest)
  expect((await store.db.query('SELECT * FROM cost_library_sources')).rows).toHaveLength(1)
  expect((await store.db.query('SELECT * FROM cost_library_items')).rows).toHaveLength(1)
  await setSourceText(text + '\n补充发布时间说明')
  await library.importManifest(manifest)
  expect((await store.db.query('SELECT * FROM cost_library_items')).rows).toHaveLength(2)
  expect((await store.db.query('SELECT * FROM cost_library_sources')).rows).toHaveLength(2)
  expect((await library.search()).items).toHaveLength(1)
})
test('reads the earlier five-record payload shape without inventing scale, dates, or reference groups', async () => {
  const source = (await store.db.query<{ id: string; version: string }>('SELECT id,version FROM cost_library_sources')).rows[0]
  await store.db.query('UPDATE cost_library_items SET current=false')
  const kinds = ['estimate', 'estimate', 'contract_price', 'contract_price', 'contract_price'] as const
  for (const [index, amount_kind] of kinds.entries()) {
    const legacy = { ...manifest.records[0], id: `legacy-${index}`, amount_kind }
    // This is the persisted payload written before evidence_sources/benchmark metadata existed.
    await store.db.query('INSERT INTO cost_library_items(id,version,source_id,source_version,payload,current) VALUES($1,$2,$3,$4,$5,true)', [legacy.id, `legacy-version-${index}`, source.id, source.version, JSON.stringify(legacy)])
  }
  const result = await library.search()
  expect(result.items).toHaveLength(5)
  expect(result.summary.by_amount_kind).toEqual({ estimate: 2, contract_price: 3 })
  expect(result.items.every(item => item.scale_value === null && item.benchmark?.intensity_yuan_per_m2 === null)).toBe(true)
  expect(result.benchmark.groups).toEqual([])
})
test('rejects raw or extracted text hash tampering', async () => {
  await writeFile(resolve(root, manifest.sources[0].text_path), text + '篡改')
  const receipt = await library.importManifest(manifest)
  expect(receipt.accepted).toBe(0)
  expect(receipt.issues.map(issue => issue.code)).toContain('SOURCE_HASH_MISMATCH')
  expect((await library.search()).items).toHaveLength(0)
})
test('rejects absent quote, mismatched original amount, and unit conversion errors', async () => {
  manifest.records[0].amount_quote = '合同价款：100元'
  expect((await library.importManifest(manifest)).issues[0].code).toBe('AMOUNT_QUOTE_MISMATCH')
  manifest.records[0].amount_quote = '合同价款：100万元'
  manifest.records[0].amount_original = '101万元'
  expect((await library.importManifest(manifest)).issues[0].code).toBe('AMOUNT_ORIGINAL_MISMATCH')
  manifest.records[0].amount_original = '100万元'
  manifest.records[0].amount_yuan = 100
  expect((await library.importManifest(manifest)).issues[0].code).toBe('AMOUNT_UNIT_MISMATCH')
})
test('rejects a manifest path escaping the public-source directory', async () => {
  await writeFile(join(root, 'private.txt'), text)
  manifest.sources[0].text_path = 'data/public_cases/renewal-cost-sources/../../../private.txt'
  const receipt = await library.importManifest(manifest)
  expect(receipt.accepted).toBe(0)
  expect(receipt.issues[0].code).toBe('SOURCE_PATH_OUTSIDE')
})
test('rejects prices attached to a different project or lot', async () => {
  manifest.records[0].project_name = '另一个社区'
  expect((await library.importManifest(manifest)).issues[0].code).toBe('PROJECT_MISMATCH')
  manifest.records[0].project_name = '测试社区改造工程'
  await setSourceText(text + '\n项目名称：另一个社区\n合同价款：99万元')
  Object.assign(manifest.records[0], { amount_quote: '合同价款：99万元', amount_original: '99万元', amount_yuan: 990000 })
  expect((await library.importManifest(manifest)).issues[0].code).toBe('PROJECT_AMOUNT_MISMATCH')
  await setSourceText((text + '\n项目名称：另一个社区\n合同价款：99万元').replace(/\n/g, ' '))
  expect((await library.importManifest(manifest)).issues[0].code).toBe('PROJECT_AMOUNT_MISMATCH')
  await setSourceText(text + '\n标段编号：OTHER-LOT\n合同价款：99万元')
  expect((await library.importManifest(manifest)).issues[0].code).toBe('LOT_AMOUNT_MISMATCH')
})
test('keeps contract distinct from settlement and validates known scale against its quote', async () => {
  manifest.records[0].amount_kind = 'settlement'
  expect((await library.importManifest(manifest)).issues[0].code).toBe('AMOUNT_KIND_MISMATCH')
  manifest.records[0].amount_kind = 'contract_price'
  await setSourceText(text + '\n建筑面积6.9405万平方米')
  Object.assign(manifest.records[0], { scale_value: 69405, scale_unit: 'm2', scale_quote: '建筑面积6.9405万平方米' })
  expect((await library.importManifest(manifest)).accepted).toBe(1)
  manifest.records[0].scale_value = 6.9405
  expect((await library.importManifest(manifest)).issues[0].code).toBe('SCALE_UNIT_MISMATCH')
})
test('joins amount and area notices only through matching project code and lot, preserving both originals', async () => {
  await setSourceText(text + '\n合同签署时间：2025-01-02')
  const quote = '总建筑面积10000平方米'
  await addSupport('项目名称：测试社区改造工程\n项目代码：TEST-PROJECT\n标段编号：TEST-LOT\n' + quote + '\n工程范围：屋面及室外整体改造')
  Object.assign(manifest.records[0], { scale_value: 10000, scale_unit: 'm2', scale_basis: 'building_floor_area', scale_quote: quote, scale_source_id: 'support-fixture', scope_source_id: 'support-fixture', scope_quote: '工程范围：屋面及室外整体改造', supporting_source_ids: ['support-fixture'], contract_date: '2025-01-02', amount_basis: 'construction_contract', scope_level: 'construction_lot' })
  expect((await library.importManifest(manifest)).issues).toEqual([])
  const result = await library.search({ year: 2025, scale_basis: 'building_floor_area' })
  expect(result.items).toHaveLength(1)
  expect(result.summary.source_count).toBe(2)
  expect(result.items[0].evidence_sources?.[0]).toMatchObject({ id: 'support-fixture', source_hash: manifest.sources[1].raw_sha256 })
  expect(result.items[0].benchmark).toMatchObject({ eligible: true, intensity_yuan_per_m2: 100, price_year: 2025 })
  expect(result.benchmark.groups[0].n_projects).toBe(1)
  const csv = constructionCostsCsv(result.items)
  expect(csv).toContain(manifest.sources[1].raw_sha256)
  expect(csv).toContain('分母口径')
})
test('same C01 token in another project cannot supply area; the valid main amount remains', async () => {
  await setSourceText(text.replace('标段编号：TEST-LOT', '标段号：C01'))
  Object.assign(manifest.records[0], { lot_id: 'TEST-PROJECT-C01', scale_value: 10000, scale_unit: 'm2', scale_basis: 'building_floor_area', scale_quote: '总建筑面积10000平方米', scale_source_id: 'support-fixture' })
  await addSupport('项目名称：测试社区改造工程\n项目代码：OTHER-PROJECT\n标段号：C01\n总建筑面积10000平方米')
  const receipt = await library.importManifest(manifest)
  expect(receipt.accepted).toBe(1)
  expect(receipt.issues.some(issue => issue.code === 'SUPPORT_IDENTITY_MISMATCH')).toBe(true)
  const item = (await library.search()).items[0]
  expect(item.amount_yuan).toBe(1000000)
  expect(item.scale_value).toBe(null)
  expect(item.evidence_sources).toEqual([])
})
test('a full transaction lot links notices without a separate project code, but a different full lot fails', async () => {
  const lot = 'A3311011160018907001001'
  await setSourceText(text.replace('TEST-LOT', lot))
  await addSupport(`项目名称：测试社区改造工程\n标段编号：${lot}\n总建筑面积10000平方米`)
  Object.assign(manifest.records[0], { project_code: null, lot_id: lot, scale_value: 10000, scale_unit: 'm2', scale_basis: 'building_floor_area', scale_quote: '总建筑面积10000平方米', scale_source_id: 'support-fixture' })
  expect((await library.importManifest(manifest)).issues).toEqual([])
  expect((await library.search()).items[0].scale_value).toBe(10000)
  const support = manifest.sources[1], changed = `项目名称：测试社区改造工程\n标段编号：A3311011160018907001999\n总建筑面积10000平方米`
  await writeFile(resolve(root, support.text_path), changed); support.text_sha256 = hash(changed)
  expect((await library.importManifest(manifest)).issues[0].code).toBe('SUPPORT_IDENTITY_MISMATCH')
  expect((await library.search()).items[0].scale_value).toBe(null)
})
test('rejects support quote from another project block despite matching codes elsewhere in that file', async () => {
  const quote = '总建筑面积10000平方米'
  await addSupport('项目名称：测试社区改造工程\n项目代码：TEST-PROJECT\n标段编号：TEST-LOT\n总建筑面积5000平方米\n项目名称：另一个工程\n项目代码：OTHER\n标段编号：OTHER-LOT\n' + quote)
  Object.assign(manifest.records[0], { scale_value: 10000, scale_unit: 'm2', scale_basis: 'building_floor_area', scale_quote: quote, scale_source_id: 'support-fixture' })
  expect((await library.importManifest(manifest)).issues[0].code).toBe('SUPPORT_QUOTE_IDENTITY_MISMATCH')
  expect((await library.search()).items[0].scale_value).toBe(null)
})
test('keeps total price and total area separate from provisional amounts and road-area figures on the same line', async () => {
  await setSourceText(text + '\n最高投标限价：100万元，其中暂列金5万元\n总建筑面积10000平方米，道路作业面积2000平方米')
  Object.assign(manifest.records[0], { amount_kind: 'tender_ceiling', amount_yuan: 50000, amount_original: '5万元', amount_quote: '最高投标限价：100万元，其中暂列金5万元' })
  expect((await library.importManifest(manifest)).issues[0].code).toBe('AMOUNT_UNIT_MISMATCH')
  Object.assign(manifest.records[0], { amount_yuan: 1000000, amount_original: '100万元', scale_value: 2000, scale_unit: 'm2', scale_basis: 'building_floor_area', scale_quote: '总建筑面积10000平方米，道路作业面积2000平方米' })
  expect((await library.importManifest(manifest)).issues[0].code).toBe('SCALE_BASIS_MISMATCH')
  expect((await library.search()).items[0].scale_value).toBe(null)
})
test('unknown price year is not replaced by the notice date and ambiguous scale keeps its original excerpt', async () => {
  await setSourceText(text + '\n修缮面积10000平方米')
  Object.assign(manifest.records[0], { scale_value: null, scale_unit: null, scale_basis: 'unknown', scale_quote: '修缮面积10000平方米', reported_scale_value: 10000, reported_scale_unit: 'm2', contract_date: '2025-01-01' })
  const receipt = await library.importManifest(manifest)
  expect(receipt.accepted).toBe(1)
  expect(receipt.issues[0].code).toBe('PRICE_DATE_UNVERIFIED')
  const item = (await library.search()).items[0]
  expect(item.scale_quote).toBe('修缮面积10000平方米')
  expect(item.contract_date).toBe(null)
  expect(item.benchmark?.price_year).toBe(null)
  expect((await library.search({ year: 2025 })).items).toHaveLength(0)
})
test('candidate price stays separate from final award, and amount-stage labels cannot be relabelled', async () => {
  await setSourceText(text + '\n预中标价：100万元')
  Object.assign(manifest.records[0], { amount_kind: 'candidate_bid', amount_quote: '预中标价：100万元' })
  expect((await library.importManifest(manifest)).accepted).toBe(1)
  const item = (await library.search()).items[0]
  expect(item.amount_kind).toBe('candidate_bid')
  expect(item.benchmark?.eligible).toBe(false)
  manifest.records[0].amount_kind = 'winning_bid'
  expect((await library.importManifest(manifest)).issues[0].code).toBe('AMOUNT_KIND_MISMATCH')
})
test('does not import a missing manifest as synthetic production data', async () => {
  const emptyRoot = join(root, 'empty'); await mkdir(emptyRoot)
  const empty = new ConstructionCostLibrary(store.db, emptyRoot); await empty.initialize()
  expect((await empty.search()).summary.issues[0].code).toBe('MANIFEST_UNAVAILABLE')
})
test('CSV carries Chinese stage labels, source hash, scope, and neutralizes formula cells', async () => {
  const items = (await library.search()).items
  items[0].project_name = '=HYPERLINK("https://example.org")'
  const csv = constructionCostsCsv(items)
  expect(csv.startsWith('\uFEFF')).toBe(true)
  expect(csv).toContain('合同价')
  expect(csv).toContain('"\'=HYPERLINK(')
  expect(csv).toContain(manifest.sources[0].raw_sha256)
  expect(csv).toContain('https://ggzy.zj.gov.cn/')
  expect(csv).not.toContain('单价')
})
test('HTTP project/global list and CSV share one library while project aliases enforce ownership', async () => {
  const input = JSON.parse(await readFile('fixtures/inputs/01_auto.json', 'utf8'))
  await store.db.query('INSERT INTO projects(id,owner_id,name,input) VALUES($1,$2,$3,$4)', ['COST-OWNED', 'test-owner', '契约测试社区', JSON.stringify(input)])
  const app = express()
  const requiredProjects: string[] = []
  await registerConstructionCosts(app, store, async id => {
    requiredProjects.push(id)
    const record = await store.project(id, 'test-owner')
    if (!record) throw Object.assign(new Error('项目不存在或无权访问'), { status: 404 })
    return record as ProjectRecord
  }, { root })
  app.use((error: Error & { status?: number }, _request: express.Request, response: express.Response, _next: express.NextFunction) => { response.status(error.status || 500).json({ detail: error.message }) })
  const server: Server = app.listen(0, '127.0.0.1')
  await new Promise<void>(done => server.once('listening', done))
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/projects`
  try {
    expect((await fetch(`${base}/OTHER/construction-costs`)).status).toBe(404)
    expect((await fetch(`${base}/OTHER/construction-costs/export`)).status).toBe(404)
    expect((await fetch(`${base}/COST-OWNED/construction-costs?amount_kind=unknown`)).status).toBe(422)
    const result = await (await fetch(`${base}/COST-OWNED/construction-costs?province=${encodeURIComponent('浙江')}&work_type=construction`)).json() as { items: unknown[] }
    expect(result.items).toHaveLength(1)
    const ownershipChecks = requiredProjects.length
    const globalBase = base.replace(/\/projects$/, '')
    const globalResult = await (await fetch(`${globalBase}/construction-costs?province=${encodeURIComponent('浙江')}&work_type=construction`)).json() as { items: unknown[] }
    expect(globalResult.items).toEqual(result.items)
    expect(requiredProjects).toHaveLength(ownershipChecks)
    expect((await fetch(`${globalBase}/construction-costs?amount_kind=unknown`)).status).toBe(422)
    const exported = await fetch(`${base}/COST-OWNED/construction-costs/export?amount_kind=budget`)
    expect(exported.status).toBe(200)
    expect(exported.headers.get('content-type')).toContain('text/csv')
    expect((await exported.text()).trim().split('\r\n')).toHaveLength(1)
    const globalExported = await fetch(`${globalBase}/construction-costs/export?amount_kind=budget`)
    expect(globalExported.status).toBe(200)
    expect(globalExported.headers.get('content-type')).toContain('text/csv')
    expect((await globalExported.text()).trim().split('\r\n')).toHaveLength(1)
    expect((await store.db.query("SELECT to_regclass('intel_jobs') AS table_name")).rows[0].table_name).toBe(null)
  } finally { await new Promise<void>(done => server.close(() => done())) }
})
