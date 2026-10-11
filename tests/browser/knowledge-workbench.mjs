// Isolated synthetic browser contract. It verifies UI behavior with mocked data; model calls = 0.
import { chromium } from '@playwright/test'
import { build } from 'esbuild'
import assert from 'node:assert/strict'

const citation = { document_id: 'D-SYNTHETIC', version: 'sha256-synthetic-only', locator: 'line:1', quote: '合成条件：协商已完成。' }
const condition = { fact_kind: 'resident_consultation_status', label: '居民协商状态', operator: 'eq', value: '已完成', unit: null, evidence: [citation] }
const conditionMatch = { condition, state: 'matched', fact_refs: ['F-SYNTHETIC'], evidence_refs: ['S-SYNTHETIC'], reason: '合成事实与协商条件一致。' }
const match = { card_id: 'E-SYNTHETIC', card_revision: 2, title: '合成管网案例', source_project_id: 'P-OLD', kind: 'case', origin: 'project_case', measure_key: 'pipe_network', measure_name: '管网改造', similarity: 0.6, related: true, transferability: 'transferable',
  conditions: [conditionMatch], exclusions: [{ ...conditionMatch, state: 'unmatched', reason: '合成排除条件未触发。' }],
  similar_conditions: ['已核实协商状态'], important_differences: ['当前管线资料范围不同'], reuse_premises: ['核对实施范围'], unknowns: ['维护责任待核实'], recommendation: '进一步核对实施范围后开展尽调。', evidence_refs: ['S-SYNTHETIC'] }
const trace = { policy_version: 'knowledge-routing-v1', evaluated_as_of: '2026-10-08', query: { measure_key: 'pipe_network', question: '管网改造应如何推进？' }, route: 'case_hit', case_hits: [match], rule_hits: [], candidates: [match], reasons: ['合成条件符合适用要求。'], fallback_status: 'not_needed' }
const response = { trace, sources: [{ id: 'S-SYNTHETIC', title: '合成原始材料', data_class: 'synthetic', visibility: 'public', synthetic: true, untrusted_text: '合成原文：分段实施管网改造，维护责任须明确。', locator: 'line:1' }] }
const built = await build({ stdin: { contents: `import React,{useState}from'react';import{createRoot}from'react-dom/client';
  import Workbench,{KnowledgeProfileEditor}from'./apps/workspace/src/components/KnowledgeWorkbench';
  import './apps/workspace/src/style.css';
  const base={title:'合成草稿',project_type:'',development_mode:'',stage:'',fields:[]};
  const existing={...base,knowledge:${JSON.stringify({ kind: 'case', origin: 'project_case', measure_key: 'pipe_network', measure_name: '管网改造', conditions: [condition], exclusions: [], transfer_notes: ['维护责任待核实'], evidence_level: 'implementation_record' })}};
  function Harness(){const[project,setProject]=useState('P-A'),[revision,setRevision]=useState(3),[runs,setRuns]=useState([]),[draft,setDraft]=useState(base),[saved,setSaved]=useState([]);return <>
    <nav><button onClick={()=>setProject('P-A')}>甲项目</button><button onClick={()=>setProject('P-B')}>乙项目</button><button onClick={()=>setRevision(value=>value+1)}>版本更新</button></nav>
    <main><Workbench projectId={project} revision={revision} asOf="2026-10-08" currentProject={{synthetic:true}} onRun={query=>setRuns(current=>[...current,query])}/>
    <output aria-label="显式研判次数">{runs.length}</output><output aria-label="最近研判问题">{JSON.stringify(runs.at(-1)||null)}</output>
    <button onClick={()=>setDraft(existing)}>加载已存案例</button><form aria-label="知识草稿表单" onSubmit={event=>{event.preventDefault();setSaved(current=>[...current,structuredClone(draft)])}}>
      <label>草稿标题<input aria-label="草稿标题" value={draft.title} onChange={event=>setDraft(current=>({...current,title:event.target.value}))}/></label>
      <KnowledgeProfileEditor draft={draft} onChange={setDraft} busy={false} documents={[{id:'D-SYNTHETIC',file_name:'合成材料.txt',parser_result:{source_hash:'sha256-synthetic-only'}}]}/>
      <button type="submit">保存合成草稿</button></form><output aria-label="草稿保存次数">{saved.length}</output><output aria-label="最近保存草稿">{JSON.stringify(saved.at(-1)||null)}</output></main></>}
    createRoot(document.getElementById('root')).render(<Harness/>);`, loader: 'tsx', resolveDir: process.cwd() }, bundle: true,
  write: false, outfile: 'knowledge-workbench-ui.js', format: 'iife', platform: 'browser', define: { 'process.env.NODE_ENV': '"production"' } })
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 960 } })
const calls = [], errors = []
let nextRoute = 'case_hit', delay = false
page.on('pageerror', error => errors.push(String(error)))
await page.exposeFunction('__request', async (path, body) => {
  calls.push({ path, body }); assert.match(path, /^\/api\/projects\/P-[AB]\/experiences\/knowledge-match$/)
  const route = nextRoute
  if (delay) await new Promise(resolve => setTimeout(resolve, 350))
  return route === 'agent_fallback' ? { trace: { ...trace, query: body.query, route, case_hits: [], candidates: [{ ...match, transferability: 'conditional', conditions: [{ ...conditionMatch, state: 'unknown', reason: '合成资料缺少协商事实。' }], unknowns: ['居民协商尚未核实'] }], reasons: ['结构化条件尚未全部命中。'], fallback_status: 'pending' }, sources: response.sources }
    : { ...response, trace: { ...trace, query: body.query } }
})
try {
  await page.setContent(`<html lang="zh-CN"><head><style>${built.outputFiles.find(file => file.path.endsWith('.css')).text} output { display:block; overflow-wrap:anywhere; } </style></head><body><div id="root"></div></body></html>`)
  await page.evaluate(() => {
    window.__downloads = []
    const create = URL.createObjectURL.bind(URL)
    URL.createObjectURL = blob => { blob.text().then(text => window.__downloads.push(JSON.parse(text))); return create(blob) }
    window.fetch = async (path, options) => new Response(JSON.stringify(await window.__request(String(path), options?.body ? JSON.parse(options.body) : undefined)), { headers: { 'content-type': 'application/json' } })
  })
  await page.addScriptTag({ content: built.outputFiles.find(file => file.path.endsWith('.js')).text })
  const region = page.getByRole('region', { name: '案例与规则匹配' })
  await region.getByRole('button', { name: '匹配案例与规则', exact: true }).waitFor()
  assert.equal(calls.length, 0)
  await region.getByRole('button', { name: '下载案例提取模板', exact: true }).click()
  await page.waitForFunction(() => window.__downloads.length === 1)
  const downloaded = await page.evaluate(() => window.__downloads[0])
  assert.equal(downloaded.fields.length, 10)
  assert.equal(downloaded.fields.every(field => field.value === null && field.evidence.length === 0), true)
  assert.deepEqual(downloaded.knowledge.conditions, [])
  assert.equal(downloaded.knowledge.evidence_level, 'not_reported')
  const fillQuery = async () => { await region.getByLabel('举措标识', { exact: true }).fill('pipe_network'); await region.getByLabel('本次决策问题').fill('管网改造应如何推进？') }
  await fillQuery()
  await region.getByRole('button', { name: '匹配案例与规则', exact: true }).click()
  await expectText(region.getByRole('status'), '案例适用')
  assert.equal(calls.length, 1); assert.deepEqual(calls[0].body, { query: trace.query })
  assert.equal(await region.getByRole('article').count(), 1)
  await region.getByText('查看适用条件与排除条件', { exact: true }).click()
  await expectText(region.getByText('合成事实与协商条件一致。', { exact: true }), '合成事实与协商条件一致。')
  await region.getByText('查看来源与原文引用 · 1', { exact: true }).click()
  await expectText(region.getByText('合成原文：分段实施管网改造，维护责任须明确。', { exact: true }), '维护责任须明确')
  assert.match(await region.innerText(), /词法相似率 60%/)
  assert.equal(await page.getByLabel('显式研判次数').innerText(), '0')
  await region.getByRole('button', { name: '基于本次问题研判', exact: true }).click()
  assert.equal(await page.getByLabel('显式研判次数').innerText(), '1')
  assert.deepEqual(JSON.parse(await page.getByLabel('最近研判问题').innerText()), trace.query)
  await region.getByRole('button', { name: '下载本次匹配 JSON', exact: true }).click()
  await page.waitForFunction(() => window.__downloads.length === 2)
  assert.equal(await page.evaluate(() => window.__downloads[1].trace.route), 'case_hit')
  nextRoute = 'agent_fallback'
  await region.getByRole('button', { name: '匹配案例与规则', exact: true }).click()
  await expectText(region.getByRole('status'), '两库均未命中')
  assert.equal(await page.getByLabel('显式研判次数').innerText(), '1')
  assert.match(await region.innerText(), /待补充迁移条件/)
  await region.getByText('查看适用条件与排除条件', { exact: true }).click()
  assert.equal(await region.getByText('未知', { exact: true }).count(), 1)
  delay = true
  await region.getByRole('button', { name: '匹配案例与规则', exact: true }).click()
  await page.getByRole('button', { name: '乙项目', exact: true }).click()
  await page.waitForTimeout(400)
  assert.equal(await region.getByRole('status').count(), 0)
  assert.equal(await region.getByLabel('举措标识', { exact: true }).inputValue(), '')
  await fillQuery()
  await region.getByRole('button', { name: '匹配案例与规则', exact: true }).click()
  await page.getByRole('button', { name: '甲项目', exact: true }).click()
  await page.getByRole('button', { name: '乙项目', exact: true }).click()
  await page.waitForTimeout(400)
  assert.equal(await region.getByRole('status').count(), 0)
  delay = false
  await fillQuery()
  await region.getByRole('button', { name: '匹配案例与规则', exact: true }).click()
  await region.getByRole('status').waitFor()
  await page.getByRole('button', { name: '版本更新', exact: true }).click()
  assert.equal(await region.getByRole('status').count(), 0)
  const form = page.getByRole('form', { name: '知识草稿表单' })
  const enable = form.getByLabel('按举措沉淀为案例或规则')
  assert.equal(await enable.isChecked(), false)
  await form.getByRole('button', { name: '保存合成草稿', exact: true }).click()
  assert.equal(await page.getByLabel('草稿保存次数').innerText(), '1')
  assert.equal('knowledge' in JSON.parse(await page.getByLabel('最近保存草稿').innerText()), false)
  await enable.check()
  await form.getByLabel('知识举措标识').fill('pipe_network'); await form.getByLabel('举措名称', { exact: true }).fill('管网改造')
  const applicable = form.getByLabel('结构化适用条件 JSON'), excluded = form.getByLabel('排除条件 JSON')
  await applicable.fill(JSON.stringify([condition]))
  await applicable.fill('[broken')
  assert.match(await form.getByRole('alert').innerText(), /无法保存草稿/)
  await form.getByRole('button', { name: '保存合成草稿', exact: true }).click()
  await form.evaluate(node => node.requestSubmit())
  assert.equal(await page.getByLabel('草稿保存次数').innerText(), '1')
  await applicable.fill('null')
  assert.equal(await applicable.getAttribute('aria-invalid'), 'true')
  await applicable.fill(JSON.stringify([{ ...condition, evidence: [] }]))
  assert.equal(await applicable.getAttribute('aria-invalid'), 'true')
  await applicable.fill(JSON.stringify([condition]))
  await excluded.fill('{}')
  await form.getByRole('button', { name: '保存合成草稿', exact: true }).click()
  assert.equal(await page.getByLabel('草稿保存次数').innerText(), '1')
  await excluded.fill('[]')
  await form.getByRole('button', { name: '保存合成草稿', exact: true }).click()
  assert.equal(await page.getByLabel('草稿保存次数').innerText(), '2')
  assert.deepEqual(JSON.parse(await page.getByLabel('最近保存草稿').innerText()).knowledge.conditions, [condition])
  await applicable.fill('[broken')
  await enable.uncheck()
  await form.getByRole('button', { name: '保存合成草稿', exact: true }).click()
  assert.equal(await page.getByLabel('草稿保存次数').innerText(), '3')
  await enable.check()
  assert.equal(await applicable.getAttribute('aria-invalid'), 'false')
  await form.getByLabel('知识举措标识').fill('pipe_network'); await form.getByLabel('举措名称', { exact: true }).fill('管网改造')
  await applicable.fill('[]'); await excluded.fill('[]')
  await form.getByRole('button', { name: '保存合成草稿', exact: true }).click()
  assert.equal(await page.getByLabel('草稿保存次数').innerText(), '4')
  await page.getByRole('button', { name: '加载已存案例', exact: true }).click()
  await form.getByLabel('草稿标题').fill('只改合成标题')
  await form.getByRole('button', { name: '保存合成草稿', exact: true }).click()
  assert.deepEqual(JSON.parse(await page.getByLabel('最近保存草稿').innerText()).knowledge.conditions, [condition])
  const notes = form.getByLabel('迁移说明', { exact: true })
  await notes.fill(Array.from({ length: 11 }, () => '合成说明').join('\n'))
  await form.getByRole('button', { name: '保存合成草稿', exact: true }).click()
  assert.equal(await page.getByLabel('草稿保存次数').innerText(), '5')
  await notes.fill('维护责任待核实')
  await page.setViewportSize({ width: 390, height: 844 })
  await fillQuery()
  await region.getByRole('button', { name: '匹配案例与规则', exact: true }).click()
  await region.getByRole('status').waitFor()
  await region.getByText('查看适用条件与排除条件', { exact: true }).click()
  await region.getByText('查看来源与原文引用 · 1', { exact: true }).click()
  const viewport = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }))
  assert.ok(viewport.scroll <= viewport.width + 1, `Mobile overflow: ${JSON.stringify(viewport)}`)
  assert.deepEqual(errors, [])
  assert.equal(calls.some(call => call.body?.use_model || /\/(run|review|reuse)$/.test(call.path)), false)
  console.log('PASS knowledge UI synthetic: manual match only, route/candidate conditions, sources, template + trace downloads, explicit run, project/A-B-A/version late response isolation, editor invalid JSON/structure/evidence + requestSubmit guards, correction + disable/reset, saved-profile preservation, mobile layout; model calls = 0')
} finally { await browser.close() }

async function expectText(locator, text) { await locator.waitFor({ state: 'visible' }); assert.ok((await locator.innerText()).includes(text)) }
