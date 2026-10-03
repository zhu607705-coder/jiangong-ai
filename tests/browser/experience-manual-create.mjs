// Isolated synthetic browser + existing domain validation. No live model, database or business approval.
import { chromium, expect } from '@playwright/test'
import { build } from 'esbuild'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const domainBuild = await build({ entryPoints: ['packages/experience/domain.ts'], bundle: true, platform: 'node', format: 'cjs', write: false })
const domainModule = { exports: {} }
new Function('require', 'module', 'exports', domainBuild.outputFiles[0].text)(createRequire(import.meta.url), domainModule, domainModule.exports)
const { extractLocal, normalizeDraft, validateEvidence } = domainModule.exports
const document = (id, project, file, parser) => ({ id, project_id: project, file_name: file,
  sha256: `synthetic-hash-${id}`, created_at: '2026-10-03T01:00:00Z', parser_result: { source_hash: `synthetic-hash-${id}`, ...parser } })
const firstLine = '居民在意见收集会上提出希望改善雨污管网。'
const implementation = '2024年小区完成24栋楼的外墙与雨污管网整治。'
const documents = {
  'P-A': [document('D-A', 'P-A', '合成公开短摘录.md', { status: 'extracted', text: `${firstLine}\n${implementation}` }),
    document('D-PDF', 'P-A', '合成调查.pdf', { status: 'extracted', segments: [{ locator: 'page:2', text: '拟为西侧入口设置无障碍坡道。' }] }),
    document('D-TABLE', 'P-A', '合成测算.xlsx', { status: 'extracted', profile: { tables: [{ rows: [{ rowNumber: 4, values: { 项目: '管网更新', 金额: '120万元' } }] }] } })],
  'P-B': [document('D-B', 'P-B', '乙项目合成纪要.txt', { status: 'extracted', text: '先核查乙项目地下管线。' })],
  'P-OCR': [document('D-OCR', 'P-OCR', '扫描合成材料.pdf', { status: 'ocr_required', text: '' })],
  'P-EMPTY': [],
}
assert.equal(extractLocal(documents['P-A'][0]).drafts.length, 0)
const cards = { 'P-A': [], 'P-B': [], 'P-OCR': [], 'P-EMPTY': [] }
let delayCreate = false
const calls = [], errors = []
const built = await build({ stdin: { contents: `import React,{useState}from'react';import{createRoot}from'react-dom/client';
  import Library from './apps/workspace/src/components/ExperienceLibrary';import './apps/workspace/src/style.css';
  function Harness(){const[project,setProject]=useState('P-A'),[opened,setOpened]=useState(0);return <>
    <nav>{[['P-A','甲项目'],['P-B','乙项目'],['P-OCR','扫描项目'],['P-EMPTY','空项目']].map(([id,label])=><button key={id} onClick={()=>setProject(id)}>{label}</button>)}</nav>
    <output aria-label="资料导航次数">{opened}</output><main><Library projectId={project} revision={3} synthetic={true} asOf="2026-10-03"
      onProjectUpdated={()=>{throw Error('手动整理不应重评项目')}} onOpenMaterials={()=>setOpened(value=>value+1)}/></main></>}
  createRoot(document.getElementById('root')).render(<Harness/>);`, loader: 'tsx', resolveDir: process.cwd() }, bundle: true,
  write: false, outfile: 'experience-manual-ui.js', format: 'iife', platform: 'browser', define: { 'process.env.NODE_ENV': '"production"' } })
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 960 } })
page.on('pageerror', error => errors.push(String(error)))
await page.exposeFunction('__request', async (path, body) => {
  calls.push({ path, body })
  const match = path.match(/^\/api\/projects\/(P-[A-Z]+)\/(documents|experiences)(\/extract)?$/)
  assert.ok(match, `Unexpected synthetic request ${path}`)
  const [, project, resource, extracting] = match
  if (resource === 'documents') return documents[project]
  if (!body) return { cards: cards[project] }
  if (extracting) {
    assert.equal(body.use_model, false)
    const results = documents[project].filter(document => body.document_ids.includes(document.id)).map(extractLocal)
    return { cards: [], warnings: results.flatMap(result => result.warnings), model_calls: 0 }
  }
  assert.deepEqual(Object.keys(body), ['draft'])
  const draft = normalizeDraft(body.draft)
  validateEvidence(draft, documents[project], project)
  assert.ok(draft.fields.some(field => field.value !== null))
  if (delayCreate) await new Promise(resolve => setTimeout(resolve, 350))
  else await new Promise(resolve => setTimeout(resolve, 80))
  const card = { ...draft, id: `E-${project}-${cards[project].length + 1}`, project_id: project, status: 'draft', revision: 1,
    review_note: null, created_at: '2026-10-03T01:00:00Z', updated_at: '2026-10-03T01:00:00Z' }
  cards[project].push(card)
  return card
})

try {
  await page.setContent(`<html lang="zh-CN"><head><style>${built.outputFiles.find(file => file.path.endsWith('.css')).text}</style></head><body><div id="root"></div></body></html>`)
  await page.evaluate(() => { window.fetch = async (path, options) => {
    const body = options?.body ? JSON.parse(options.body) : undefined
    return new Response(JSON.stringify(await window.__request(String(path), body)), { headers: { 'content-type': 'application/json' } })
  } })
  await page.addScriptTag({ content: built.outputFiles.find(file => file.path.endsWith('.js')).text })
  const region = page.getByRole('region', { name: '项目经验沉淀' })
  const manual = region.getByRole('button', { name: '手动整理经验', exact: true })
  const createCalls = () => calls.filter(call => call.body?.draft)
  const editor = region.getByRole('form', { name: '手动整理经验草稿' })
  await expect(manual).toBeEnabled()
  assert.equal(await region.getByRole('button', { name: /待复核草稿/ }).count(), 0)
  // No prior card, selected document or extraction is needed to reach the first editor.
  await manual.click()
  await editor.getByLabel('经验卡标题').fill('合成手工经验')
  await editor.getByRole('button', { name: '保存草稿', exact: true }).click()
  assert.match(await region.getByRole('alert').innerText(), /至少.*原文.*字段/)
  await editor.getByLabel('实施记录内容').fill(implementation)
  await editor.getByRole('button', { name: '保存草稿', exact: true }).click()
  assert.match(await region.getByRole('alert').innerText(), /实施记录.*原文定位.*逐字引文/)
  assert.equal(createCalls().length, 0)
  await editor.getByRole('button', { name: '取消整理', exact: true }).click()
  assert.equal(await editor.count(), 0)

  // The existing local extractor really returns zero for this unlabelled narrative.
  await region.locator('.experience-document-list input[type=checkbox]').first().check()
  await region.getByRole('button', { name: '提取经验草稿', exact: true }).click()
  await expect(region.getByRole('status')).toContainText('手动整理经验')
  await expect(manual).toBeEnabled()
  assert.equal(await region.getByRole('button', { name: /待复核草稿/ }).count(), 0)
  await manual.click()
  await expect(editor.getByLabel('经验卡标题')).toHaveValue('')
  await editor.getByLabel('经验卡标题').fill('合成整治实施记录')
  await editor.getByLabel('项目类型', { exact: true }).fill('老旧小区改造')
  await editor.getByLabel('开发或改造模式').fill('整治提升')
  await editor.getByLabel('项目阶段').fill('竣工复盘')
  await editor.getByRole('button', { name: '为实施记录添加原文引用', exact: true }).click()
  await editor.getByLabel('实施记录来源文档1').selectOption('D-A')
  await editor.getByLabel('实施记录原文片段1').selectOption('line:2')
  await expect(editor.getByLabel('实施记录内容')).toHaveValue(implementation)
  await expect(editor.getByLabel('实施记录原文定位1')).toHaveValue('line:2')
  await expect(editor.getByLabel('实施记录逐字引文1')).toHaveValue(implementation)
  // Two immediate click events must result in one create, even before React paints disabled state.
  await editor.getByRole('button', { name: '保存草稿', exact: true }).evaluate(button => { button.click(); button.click() })
  await expect(region.getByRole('button', { name: /合成整治实施记录/ })).toBeVisible()
  assert.equal(createCalls().length, 1)
  const saved = createCalls()[0].body.draft
  assert.equal(saved.fields.length, 10)
  assert.equal(saved.fields.filter(field => field.value === null && field.evidence.length === 0).length, 9)
  assert.deepEqual(saved.fields.find(field => field.key === 'implementation').evidence,
    [{ document_id: 'D-A', version: 'synthetic-hash-D-A', locator: 'line:2', quote: implementation }])
  assert.equal(cards['P-A'][0].status, 'draft')
  assert.equal(cards['P-A'][0].review_note, null)
  assert.equal(await region.getByText('待补充', { exact: true }).count(), 9)
  assert.equal(await region.getByRole('button', { name: '审核通过', exact: true }).count(), 1)

  // The same picker resolves ParserPort PDF segments and spreadsheet row locators.
  await manual.click()
  await editor.getByRole('button', { name: '为提议方案添加原文引用', exact: true }).click()
  await editor.getByLabel('提议方案来源文档1').selectOption('D-PDF')
  await editor.getByLabel('提议方案原文片段1').selectOption('page:2')
  await expect(editor.getByLabel('提议方案内容')).toHaveValue('拟为西侧入口设置无障碍坡道。')
  await editor.getByLabel('提议方案来源文档1').selectOption('D-TABLE')
  await expect(editor.getByLabel('提议方案原文定位1')).toHaveValue('')
  await expect(editor.getByLabel('提议方案逐字引文1')).toHaveValue('')
  await editor.getByLabel('提议方案内容').fill('')
  await editor.getByLabel('提议方案原文片段1').selectOption('table:1/row:4')
  await expect(editor.getByLabel('提议方案内容')).toHaveValue('项目=管网更新 | 金额=120万元')
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await editor.getByRole('button', { name: '取消整理', exact: true }).click()
  assert.equal(createCalls().length, 1)

  await page.getByRole('button', { name: '扫描项目', exact: true }).click()
  await expect(manual).toBeDisabled()
  await expect(region.getByText('需要可引用的材料正文；请先上传文本材料或补充 OCR。', { exact: true })).toBeVisible()
  await region.getByRole('button', { name: '上传历史材料', exact: true }).click()
  await expect(page.getByLabel('资料导航次数')).toHaveText('1')
  await page.getByRole('button', { name: '空项目', exact: true }).click()
  await expect(manual).toBeDisabled()
  await expect(region.getByRole('button', { name: '上传历史材料', exact: true })).toBeVisible()
  assert.equal(await editor.count(), 0)

  // A successful but late create for A must never populate B or leave its editor/busy state behind.
  await page.getByRole('button', { name: '甲项目', exact: true }).click()
  await expect(manual).toBeEnabled()
  await manual.click()
  await editor.getByLabel('经验卡标题').fill('迟到的甲项目草稿')
  await editor.getByRole('button', { name: '为提议方案添加原文引用', exact: true }).click()
  await editor.getByLabel('提议方案来源文档1').selectOption('D-A')
  await editor.getByLabel('提议方案原文片段1').selectOption('line:1')
  delayCreate = true
  await editor.getByRole('button', { name: '保存草稿', exact: true }).click()
  await page.getByRole('button', { name: '乙项目', exact: true }).click()
  await expect(manual).toBeEnabled()
  await manual.click()
  await editor.getByLabel('经验卡标题').fill('乙项目未保存草稿')
  await page.waitForTimeout(450)
  await expect(editor.getByLabel('经验卡标题')).toHaveValue('乙项目未保存草稿')
  assert.equal(await region.getByText('迟到的甲项目草稿', { exact: true }).count(), 0)
  assert.equal(await region.getByRole('status').count(), 0)
  assert.equal(cards['P-B'].length, 0)
  assert.equal(createCalls().length, 2)
  // Returning to A before its old request completes must not close a newly opened A editor.
  await page.getByRole('button', { name: '甲项目', exact: true }).click()
  await expect(manual).toBeEnabled()
  await manual.click()
  await editor.getByLabel('经验卡标题').fill('往返切换前的甲项目草稿')
  await editor.getByRole('button', { name: '为提议方案添加原文引用', exact: true }).click()
  await editor.getByLabel('提议方案来源文档1').selectOption('D-A')
  await editor.getByLabel('提议方案原文片段1').selectOption('line:1')
  await editor.getByRole('button', { name: '保存草稿', exact: true }).click()
  await page.getByRole('button', { name: '乙项目', exact: true }).click()
  await expect(manual).toBeEnabled()
  await page.getByRole('button', { name: '甲项目', exact: true }).click()
  await expect(manual).toBeEnabled()
  await manual.click()
  await editor.getByLabel('经验卡标题').fill('返回甲项目后未保存的草稿')
  await page.waitForTimeout(450)
  await expect(editor.getByLabel('经验卡标题')).toHaveValue('返回甲项目后未保存的草稿')
  assert.equal(await region.getByRole('status').count(), 0)
  assert.equal(createCalls().length, 3)
  assert.equal(calls.filter(call => /\/(review|reuse|analyze|run)$/.test(call.path)).length, 0)
  assert.equal(calls.filter(call => call.body?.use_model === true).length, 0)
  assert.deepEqual(errors, [])
  console.log('PASS manual experience: first-card entry, real zero local extraction, empty/uncited guards, exact hash/locator/quote, ten fields with nine null, single pending create, expanded draft only, PDF/table picker, cancel/upload/OCR, stale-project and A-B-A isolation, mobile layout; model/approval/re-evaluation calls = 0')
} finally { await browser.close() }
