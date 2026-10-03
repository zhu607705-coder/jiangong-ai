// Isolated UI contract with explicitly synthetic facts and parser output.
// No provider calls, model calls, source uploads or project mutations.
import { chromium } from '@playwright/test'
import { build } from 'esbuild'
import assert from 'node:assert/strict'
const source = { id: 'DOC-1', title: '合成居民调查.md', data_class: 'synthetic', visibility: 'internal', synthetic: true, content_status: 'uploaded', hash: 'fixture-v1', published_at: '2026-09-01' }
const facts = [
  { id: 'NEEDS', kind: 'retrofit.resident_needs_confirmed', value: false, unit: null, source_id: 'DOC-1', object_ref: 'project:P1', scope_kind: 'project', locator: 'line:1', observed_at: '2026-09-01', epistemic_status: 'fact' },
  { id: 'ENGINEERING', kind: 'retrofit.engineering_review_passed', value: null, unit: null, source_id: 'DOC-1', object_ref: 'building:B1', scope_kind: 'object', locator: 'line:2', observed_at: '2026-09-01', epistemic_status: 'missing' },
  { id: 'ROW-1', kind: 'table_row', value: '{"楼栋":"B2","调查":"已有"}', unit: null, source_id: 'DOC-1', locator: 'table:1/row:2' },
]
const documents = [{ id: 'DOC-1', file_name: '合成居民调查.md', parser_result: { status: 'extracted', parser: 'fixture', source_hash: 'fixture-v1', segments: [{ locator: 'line:1', text: '合成居民需求原文；结论仍由人工复核。' }], profile: { tables: [{ label: '合成调查', rowCount: 1, columns: ['楼栋', '调查'], rows: [{ rowNumber: 2, values: { 楼栋: 'B2', 调查: '已有' } }] }] } } }]
const context = { id: 'CTX-1', created_at: '2026-10-03T00:00:00Z', expires_at: '2099-01-01T00:00:00Z', address: '合成范围', city: '合成市', target: { kind: 'point', longitude: 120, latitude: 30, radius_m: 800, bounds: null, label: '合成地图对象', object_ref: 'project:P1' }, groups: [], local_projects: [{ project_id: 'P1', name: '合成项目', relation: 'within_scope', scope_label: '合成工程范围', business_profile: 'neighborhood', as_of: '2026-10-03', source_count: 1, fact_count: 2, document_count: 1, context_version: 1, updated_at: '2026-09-01', rules: [], sources: [{ ...source, id: 'PUBLIC', title: '合成公开工程摘要', visibility: 'public', data_class: 'synthetic', public_records: [{ id: 'HISTORY', adapter: 'construction', scope: 'object', subject: '2022报道工程口径', period: '2022-10-26', source_id: 'PUBLIC', source_hash: 'fixture-v1', fields: [
  { key: 'object_ref', value: 'project:P1', label: '对象', raw: 'project:P1', unit: '', locator: 'paragraph:1' },
  { key: 'project_stage', value: 'historical', label: '阶段', raw: 'historical', unit: '', locator: 'paragraph:1' },
  { key: 'residential_buildings', value: 54, label: '住宅楼', raw: '54栋', unit: '栋', locator: 'paragraph:1' },
  { key: 'statistical_as_of', value: null, label: '统计时点', raw: '', unit: '', locator: 'paragraph:1' },
] }] }], facts: [] }], status: 'complete', gaps: [], metric_note: 'synthetic', project_revision: 'v1' }
const built = await build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';
  import Explorer from './apps/workspace/src/imports/ImportedDataExplorer';
  import Card from './apps/workspace/src/maps/PreliminaryCard';import './apps/workspace/src/style.css';import './apps/workspace/src/maps/map.css';
  const d=window.__fixture;createRoot(document.getElementById('root')).render(<main style={{maxWidth:'1200px',margin:'12px auto'}}>
    <div style={{maxWidth:'400px'}}><Card selection={{id:'selected',name:'合成对象',longitude:120,latitude:30,poi_id:'FIXTURE'}} profile='neighborhood' theme='overall' cell={null} onContext={()=>{}} onProfile={()=>{}} onOpenProject={id=>window.__events.push('project:'+id)}/></div>
    <Explorer projectId='P1' projectName='合成项目' revision={1} profile='neighborhood' asOf='2026-10-03' sources={[d.source]} researchSources={[]} facts={d.facts} onEvidence={refs=>window.__events.push('evidence:'+refs.join(','))}/>
  </main>);`, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, outfile: 'preliminary-ui.js', format: 'iife', platform: 'browser', define: { 'process.env.NODE_ENV': '"production"' } })
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
const errors = [], calls = []
page.on('pageerror', error => errors.push(String(error)))
try {
  await page.setContent(`<html lang="zh-CN"><head><style>${built.outputFiles.find(file => file.path.endsWith('.css')).text}</style></head><body><div id="root"></div></body></html>`)
  await page.evaluate(({ source, facts, documents, context }) => {
    window.__fixture = { source, facts }; window.__events = []; window.__calls = []
    window.fetch = async (path, options = {}) => {
      window.__calls.push({ path: String(path), method: options.method || 'GET' })
      if (String(path).includes('/screening/context')) return new Response(JSON.stringify(context), { headers: { 'content-type': 'application/json' } })
      if (String(path).includes('/screening/analysis/')) return new Response('null', { headers: { 'content-type': 'application/json' } })
      if (String(path) === '/api/projects/P1/documents') return new Response(JSON.stringify(documents), { headers: { 'content-type': 'application/json' } })
      throw Error('Unexpected request ' + path)
    }
  }, { source, facts, documents, context })
  await page.addScriptTag({ content: built.outputFiles.find(file => file.path.endsWith('.js')).text })
  const preview = page.getByLabel('对象初步调研')
  await preview.getByText('历史案例', { exact: false }).waitFor()
  assert.match(await preview.innerText(), /住宅楼 54 栋[\s\S]*统计时点未提供/)
  assert.match(await preview.innerText(), /参与窗口：未提供/)
  await preview.getByRole('button', { name: '依据', exact: true }).first().click()
  assert.match(await page.locator('.assessment-sources').innerText(), /2022报道工程口径[\s\S]*统计 \/ 观察时点[\s\S]*未提供[\s\S]*原文定位/)
  await preview.getByRole('button', { name: '调研清单', exact: true }).click()
  await page.getByRole('button', { name: '进入项目调研 · 合成项目' }).click()
  assert.deepEqual(await page.evaluate(() => window.__events), ['project:P1'])

  await page.getByRole('button', { name: '调研覆盖', exact: true }).click()
  const coverage = page.getByLabel('对象与六维资料覆盖')
  await coverage.getByRole('button', { name: '合成项目（项目范围） · 居民需求 · 有可定位依据' }).click()
  const inspector = page.getByLabel('调研依据')
  assert.match(await inspector.innerText(), /false[\s\S]*不是方案适配分或完成确认|不是方案适配分或完成确认[\s\S]*false/)
  assert.match(await inspector.innerText(), /来源版本：fixture-v1/)
  await inspector.getByRole('button', { name: '定位证据卡' }).click()
  assert.deepEqual(await page.evaluate(() => window.__events), ['project:P1', 'evidence:DOC-1'])
  await coverage.getByRole('button', { name: 'building:B1 · 居住工程 · 待核线索' }).click()
  assert.match(await inspector.innerText(), /值尚未提供/)
  assert.equal(await coverage.getByRole('button', { name: 'building:B1 · 居民需求 · 尚无依据' }).count(), 1)
  assert.equal(await coverage.getByRole('button', { name: /building:B2/ }).count(), 0)
  await coverage.getByRole('button', { name: '查看文件与原始行' }).click()
  assert.match(await page.getByLabel('节点分析').innerText(), /合成居民调查.md[\s\S]*fixture-v1/)
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '节点分析')
  await page.getByRole('button', { name: '调研覆盖', exact: true }).click()
  await coverage.getByRole('button', { name: '合成项目（项目范围） · 居民需求 · 有可定位依据' }).click()
  await inspector.getByRole('button', { name: '原文与资料' }).click()
  assert.match(await page.getByLabel('节点分析').innerText(), /retrofit.resident_needs_confirmed[\s\S]*line:1[\s\S]*false/)
  await page.getByRole('button', { name: '调研覆盖', exact: true }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  await coverage.getByRole('button', { name: 'building:B1 · 居住工程 · 待核线索' }).click()
  assert.match(await inspector.innerText(), /building:B1 · 居住工程/)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false)
  calls.push(...await page.evaluate(() => window.__calls))
  assert.equal(calls.filter(call => call.path === '/api/maps/screening/analysis').length, 0)
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ status: 'passed', checks: 14, model_calls: 0, calls, viewport: [1440, 390] }))
} finally { await browser.close() }
