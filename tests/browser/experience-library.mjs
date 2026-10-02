// Isolated synthetic browser contract. No enterprise documents or model calls.
import { chromium } from '@playwright/test'
import { build } from 'esbuild'
import assert from 'node:assert/strict'

const field = (key, value = null, evidence = []) => ({ key, value, evidence })
const evidence = [{ document_id: 'D-A', version: 'sha256-synthetic-a', locator: 'line:1', quote: '居民协商后先开展管网改造。' }]
const card = { id: 'E-A', project_id: 'P-A', title: '合成管网改造经验', project_type: '老旧小区改造',
  development_mode: '整治提升', stage: '前期策划', fields: [field('decision_question', '先改造哪一项设施？', evidence),
    field('background'), field('key_conditions'), field('alternatives'), field('proposal'), field('actual_decision'),
    field('decision_basis'), field('implementation'), field('outcome'), field('applicability')], status: 'draft', revision: 1,
  review_note: null, created_at: '2026-10-02T01:00:00Z', updated_at: '2026-10-02T01:00:00Z' }
const approved = { ...card, id: 'E-OTHER', project_id: 'P-OTHER', title: '合成跨项目经验', status: 'approved', review_note: '合成复核记录',
  fields: [...card.fields.filter(item => item.key !== 'applicability'), field('applicability', '先核实居民协商程序与地下管线资料。', evidence)] }
const built = await build({ stdin: { contents: `import React,{useState}from'react';import{createRoot}from'react-dom/client';
  import Library from './apps/workspace/src/components/ExperienceLibrary';import './apps/workspace/src/style.css';
  function Harness(){const[project,setProject]=useState('P-A'),[revision,setRevision]=useState(3);return <>
  <nav><button onClick={()=>{setProject('P-A');setRevision(3)}}>甲项目</button><button onClick={()=>{setProject('P-B');setRevision(5)}}>乙项目</button></nav>
  <main><Library projectId={project} revision={revision} synthetic={true} asOf="2026-10-02" onProjectUpdated={()=>setRevision(value=>value+1)}/></main></>}
  createRoot(document.getElementById('root')).render(<Harness/>);`, loader: 'tsx', resolveDir: process.cwd() }, bundle: true,
  write: false, outfile: 'experience-library-ui.js', format: 'iife', platform: 'browser', define: { 'process.env.NODE_ENV': '"production"' } })
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 960 } })
const calls = [], errors = []
let currentCard = null, delayedExtract = false
page.on('pageerror', error => errors.push(String(error)))
await page.exposeFunction('__request', async (path, body) => {
  calls.push({ path, body })
  if (path === '/api/projects/P-A/documents') return [{ id: 'D-A', file_name: '合成会议纪要.txt', parser_result: { source_hash: 'sha256-synthetic-a', status: 'extracted' } }]
  if (path === '/api/projects/P-B/documents') return []
  if (path === '/api/projects/P-A/experiences' && !body) return { cards: currentCard ? [currentCard] : [] }
  if (path === '/api/projects/P-B/experiences' && !body) return { cards: [] }
  if (path === '/api/projects/P-A/experiences/extract') {
    assert.deepEqual(body, { document_ids: ['D-A'], use_model: false })
    if (delayedExtract) await new Promise(resolve => setTimeout(resolve, 350))
    currentCard = structuredClone(card)
    return { cards: [currentCard], warnings: [], model_calls: 0 }
  }
  if (path === '/api/projects/P-A/experiences/E-A/update') {
    assert.equal(body.expected_revision, 1)
    assert.equal(body.draft.fields.find(item => item.key === 'background').evidence[0].version, 'sha256-synthetic-a')
    currentCard = { ...currentCard, ...body.draft, revision: 2 }
    return currentCard
  }
  if (path === '/api/projects/P-A/experiences/E-A/review') {
    assert.equal(body.expected_revision, 2)
    assert.equal(body.status, 'approved')
    assert.equal(body.note, '已核对合成会议纪要原文，实施结果未记载。')
    currentCard = { ...currentCard, status: 'approved', revision: 3, review_note: body.note }
    return currentCard
  }
  if (path.startsWith('/api/experiences/search?')) {
    const params = new URL(path, 'http://fixture').searchParams
    assert.equal(params.get('synthetic'), 'true')
    assert.equal(params.get('exclude_project'), 'P-A')
    assert.equal(params.get('as_of'), '2026-10-02')
    assert.equal(params.get('project_type'), '老旧小区改造')
    return { items: [{ card: approved, similar_conditions: ['同为老旧小区管网更新'], important_differences: ['当前小区地下管线资料尚需获取'], reuse_premises: ['先核实居民协商程序与地下管线资料。'] }] }
  }
  if (path === '/api/projects/P-A/experiences/reuse') {
    assert.deepEqual(body, { card_id: 'E-OTHER', expected_version: 3, expected_card_revision: 1 })
    return { project: { id: 'P-A', context_version: 4 }, source_id: 'EXPERIENCE-OTHER', rule_ids: [], card_id: 'E-OTHER', card_revision: 1 }
  }
  throw Error(`Unexpected synthetic request ${path}`)
})

try {
  await page.setContent(`<html lang="zh-CN"><head><style>${built.outputFiles.find(file => file.path.endsWith('.css')).text}</style></head><body><div id="root"></div></body></html>`)
  await page.evaluate(() => { window.fetch = async (path, options) => {
    const body = options?.body ? JSON.parse(options.body) : undefined
    return new Response(JSON.stringify(await window.__request(String(path), body)), { headers: { 'content-type': 'application/json' } })
  } })
  await page.addScriptTag({ content: built.outputFiles.find(file => file.path.endsWith('.js')).text })
  const region = page.getByRole('region', { name: '项目经验沉淀' })
  await region.getByText('尚无经验卡。', { exact: false }).waitFor()
  await region.getByRole('checkbox').check()
  await region.getByRole('button', { name: '提取经验草稿', exact: true }).click()
  await region.getByRole('button', { name: /合成管网改造经验/ }).waitFor()
  assert.equal(await region.getByText('待补充', { exact: true }).count(), 9)
  assert.equal(await region.getByText('决策依据', { exact: true }).count(), 1)
  await region.getByText('合成会议纪要.txt · line:1', { exact: true }).click()
  assert.equal(await region.getByText('居民协商后先开展管网改造。', { exact: true }).count(), 1)
  await region.getByRole('button', { name: '审核通过', exact: true }).click()
  assert.match(await region.getByRole('alert').innerText(), /请填写复核备注/)
  assert.equal(calls.filter(call => call.path.endsWith('/review')).length, 0)
  await region.getByRole('button', { name: '编辑草稿与原文引用' }).click()
  await region.getByLabel('背景与目标内容').fill('核实居民共同决策程序。')
  await region.getByRole('button', { name: '保存草稿', exact: true }).click()
  assert.match(await region.getByRole('alert').innerText(), /背景与目标.*选择来源文档/)
  assert.equal(calls.filter(call => call.path.endsWith('/update')).length, 0)
  await region.getByRole('button', { name: '为背景与目标添加原文引用', exact: true }).click()
  await region.getByLabel('背景与目标来源文档1').selectOption('D-A')
  await region.getByLabel('背景与目标原文定位1').fill('line:1')
  await region.getByLabel('背景与目标逐字引文1').fill('居民协商后先开展管网改造。')
  await region.getByRole('button', { name: '保存草稿', exact: true }).click()
  await region.getByRole('button', { name: /待复核草稿 · v2/ }).waitFor()
  await region.getByLabel('复核备注').fill('已核对合成会议纪要原文，实施结果未记载。')
  await region.getByRole('button', { name: '审核通过', exact: true }).click()
  await region.getByRole('button', { name: /已审核 · v3/ }).waitFor()
  assert.equal(await region.getByRole('button', { name: '编辑草稿与原文引用' }).count(), 0)
  await region.getByRole('button', { name: '检索已审核经验', exact: true }).click()
  await region.getByLabel('决策问题或关键条件').fill('管网')
  await region.getByLabel('项目类型', { exact: true }).fill('老旧小区改造')
  await region.getByRole('button', { name: '检索经验', exact: true }).click()
  await region.getByText('同为老旧小区管网更新', { exact: true }).waitFor()
  assert.equal(await region.getByText('当前小区地下管线资料尚需获取', { exact: true }).count(), 1)
  await region.getByRole('button', { name: '加入当前项目参考' }).click()
  await page.waitForTimeout(100)
  assert.equal(calls.filter(call => call.path.endsWith('/reuse')).length, 1)
  await region.getByRole('button', { name: /本项目经验/ }).click()
  await region.getByRole('button', { name: /合成管网改造经验/ }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)

  // A late extraction response from A must not populate the newly selected project B.
  delayedExtract = true
  await region.getByRole('checkbox').check()
  await region.getByRole('button', { name: '提取经验草稿', exact: true }).click()
  await page.getByRole('button', { name: '乙项目', exact: true }).click()
  await region.getByText('先在上方上传历史项目材料', { exact: false }).waitFor()
  await page.waitForTimeout(450)
  assert.equal(await region.getByRole('button', { name: /合成管网改造经验/ }).count(), 0)
  assert.equal(await region.getByText('尚无经验卡。', { exact: false }).count(), 1)
  assert.deepEqual(errors, [])
  console.log('PASS experience library: local extraction, distinct missing fields and citations, edit validation, versioned review, filtered retrieval, reuse and stale-project isolation, mobile layout')
} finally { await browser.close() }
