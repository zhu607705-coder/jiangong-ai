// Synthetic browser contract for the imported-data graph; no provider or model calls.
import { chromium } from '@playwright/test'
import { build } from 'esbuild'
import assert from 'node:assert/strict'

const fixture = {
  'P-A': {
    name: '甲项目 · 合成导入',
    sources: [
      { id: 'DOC-A1', title: 'asset-a.csv', data_class: 'synthetic', visibility: 'internal', synthetic: true, content_status: 'uploaded' },
      { id: 'PUB-A', title: '甲项目公开规范资料', data_class: 'synthetic', visibility: 'public', synthetic: true, content_status: 'excerpt', locator: 'fixture:public-a' },
    ],
    facts: [{ id: 'ROW-A', kind: 'table_row', value: '{"建筑编号":"A1"}', unit: null, source_id: 'DOC-A1', locator: 'table:1/row:2' }],
  },
  'P-EMPTY': {
    name: '空项目 · 仅关联来源',
    sources: [{ id: 'PUB-EMPTY', title: '空项目公开规划资料', data_class: 'synthetic', visibility: 'public', synthetic: true, content_status: 'excerpt', locator: 'fixture:empty' }],
    facts: [],
  },
  'P-B': {
    name: '乙项目 · 合成导入',
    sources: [{ id: 'DOC-B1', title: 'old-b.csv', data_class: 'synthetic', visibility: 'internal', synthetic: true, content_status: 'uploaded' }],
    facts: [],
  },
}

const document = (id, name, table, rows, columns) => ({
  id, file_name: name, parser_result: {
    status: 'extracted', parser: 'synthetic browser parser', source_hash: 'synthetic-test-hash',
    profile: { tables: [{ tableId: `${id}-T1`, label: table, rowCount: rows.length, columnCount: columns.length,
      truncated: false, columns: columns.map(column => ({ name: column, valueType: column === '面积' ? 'number' : 'text',
        fillRate: column === '面积' ? .5 : 1, missingCount: column === '面积' ? 1 : 0, uniqueCount: rows.length, examples: rows.map(row => row.values[column]).filter(Boolean) })), rows }] },
  },
})
const multiTableDocument = document('DOC-B2', 'new-b.docx', '第1工作表',
  [{ rowNumber: 2, values: { 建筑编号: 'B2' } }], ['建筑编号'])
multiTableDocument.parser_result.profile.tables = Array.from({ length: 7 }, (_, index) => ({
  ...multiTableDocument.parser_result.profile.tables[0], tableId: `DOC-B2-T${index + 1}`,
  label: `第${index + 1}工作表`,
}))
multiTableDocument.parser_result.segments = [{ locator: 'paragraph:1', text: '乙项目合成正文段落' }]
const documents = {
  a1: [document('DOC-A1', 'asset-a.csv', '楼宇清单', [
    { rowNumber: 2, values: { 建筑编号: 'A1', 面积: '120' } },
    { rowNumber: 3, values: { 建筑编号: 'A2', 面积: '' } },
  ], ['建筑编号', '面积'])],
  a2: [document('DOC-A2', 'new-a.csv', '更新楼宇清单', [{ rowNumber: 2, values: { 建筑编号: 'A3' } }], ['建筑编号'])],
  b1: [document('DOC-B1', 'old-b.csv', '旧版乙项目表', [{ rowNumber: 2, values: { 建筑编号: 'B1' } }], ['建筑编号'])],
  b2: [multiTableDocument],
}

const built = await build({ stdin: {
  contents: `import React,{useState} from 'react';import{createRoot}from'react-dom/client';
    import Explorer from './apps/workspace/src/imports/ImportedDataExplorer';
    import './apps/workspace/src/style.css';
    function Harness(){const [project,setProject]=useState('P-A'),[revision,setRevision]=useState(1);
      const data=window.__fixtureProjects[project];
      const sources=project==='P-B'&&revision===2
        ?[{id:'DOC-B2',title:'new-b.docx',data_class:'synthetic',visibility:'internal',synthetic:true,content_status:'uploaded'}]
        :project==='P-A'&&revision===2
          ?[{id:'DOC-A2',title:'new-a.csv',data_class:'synthetic',visibility:'internal',synthetic:true,content_status:'uploaded'}]
          :data.sources;
      return <><nav aria-label='合成项目切换'><button onClick={()=>{setProject('P-A');setRevision(1)}}>甲项目</button>
        <button onClick={()=>{setProject('P-EMPTY');setRevision(1)}}>空项目</button>
        <button onClick={()=>{setProject('P-B');setRevision(1)}}>乙项目</button>
        <button onClick={()=>setRevision(2)}>更新当前版本</button>
        <button onClick={()=>{setProject('P-A');setRevision(2)}}>甲项目延迟更新</button>
        <button onClick={()=>{setProject('P-B');setRevision(2)}}>返回乙项目新版</button></nav>
        <main><Explorer projectId={project} projectName={data.name} revision={revision}
          sources={sources} researchSources={[]} facts={revision===1?data.facts:[]}/></main></>}
    createRoot(document.getElementById('root')).render(<Harness/>);`,
  resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false,
  outfile: 'import-graph-ui.js', format: 'iife', platform: 'browser', define: { 'process.env.NODE_ENV': '"production"' } })

const browser = await chromium.launch({ headless: true,
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
const errors = [], calls = []
page.on('pageerror', error => errors.push(String(error)))
const waitUntil = async (predicate, timeout = 3000) => {
  const end = Date.now() + timeout
  while (!predicate()) { if (Date.now() > end) throw Error('Timed out waiting for fixture request'); await new Promise(resolve => setTimeout(resolve, 20)) }
}

await page.exposeFunction('__documents', async path => {
  const match = /^\/api\/projects\/(P-A|P-B|P-EMPTY)\/documents$/.exec(path)
  if (!match) throw Error(`Unexpected fixture request ${path}`)
  const project = match[1], prior = calls.filter(value => value === project).length
  calls.push(project)
  if (project === 'P-A' && prior > 0) {
    // Deliberately return despite the browser's aborted signal: the component
    // must reject this superseded version after a project switch.
    await new Promise(resolve => setTimeout(resolve, 450))
    return documents.a2
  }
  if (project === 'P-A') return documents.a1
  if (project === 'P-B') return prior === 0 ? documents.b1 : documents.b2
  return []
})

try {
  await page.setContent(`<html lang="zh-CN"><head><style>${built.outputFiles.find(file => file.path.endsWith('.css')).text}</style></head><body><div id="root"></div></body></html>`)
  await page.evaluate(projects => {
    window.__fixtureProjects = projects
    window.fetch = async path => new Response(JSON.stringify(await window.__documents(String(path))),
      { headers: { 'content-type': 'application/json' } })
  }, fixture)
  await page.addScriptTag({ content: built.outputFiles.find(file => file.path.endsWith('.js')).text })

  const graph = page.getByRole('region', { name: '可交互的数据关系图' })
  const inspector = page.getByRole('complementary', { name: '节点分析' })
  await graph.locator('.kind-document').waitFor()
  assert.equal(await graph.locator('.kind-document').count(), 1)
  assert.equal(await graph.locator('.kind-table').count(), 1)
  assert.match(await page.getByLabel('导入数据概况').innerText(), /1\s*导入文件[\s\S]*1\s*解析表[\s\S]*2\s*解析行数/)
  await graph.getByRole('button', { name: '解析表：楼宇清单' }).click()
  assert.equal(await inspector.getByText('字段完整度').count(), 1)
  await inspector.locator('.import-column-list button').filter({ hasText: '面积' }).click()
  assert.match(await inspector.locator('.import-focused-column').innerText(), /面积 · 字段分析[\s\S]*填充率 50%[\s\S]*缺失 1/)
  await page.getByRole('button', { name: '字段', exact: true }).click()
  await graph.getByRole('button', { name: '字段：面积' }).click()
  assert.match(await inspector.innerText(), /字段类型[\s\S]*number[\s\S]*填充率[\s\S]*50%/)
  await page.getByRole('button', { name: '放大关系图' }).click()
  assert.equal(await page.getByRole('button', { name: '重置关系图缩放' }).innerText(), '115%')
  await page.getByRole('button', { name: '重置关系图缩放' }).click()
  assert.equal(await page.getByRole('button', { name: '重置关系图缩放' }).innerText(), '100%')
  await page.getByRole('textbox', { name: '筛选节点' }).fill('没有匹配的文件')
  assert.equal(await graph.locator('.kind-document').count(), 0)
  await page.getByRole('textbox', { name: '筛选节点' }).fill('asset-a')
  await graph.locator('.kind-document').waitFor()
  assert.equal(await graph.locator('.kind-document').count(), 1)

  await page.getByRole('textbox', { name: '筛选节点' }).fill('')
  await page.getByRole('button', { name: '空项目', exact: true }).click()
  await page.getByText('本项目尚无上传文件。', { exact: false }).waitFor()
  assert.equal(await graph.locator('.kind-document').count(), 0)
  assert.equal(await page.getByRole('button', { name: '导入文件', exact: true }).isDisabled(), true)
  await graph.getByRole('button', { name: '关联来源：空项目公开规划资料' }).click()
  assert.match(await inspector.innerText(), /空项目公开规划资料[\s\S]*可见性[\s\S]*公开/)
  assert.equal((await graph.locator('svg').getAttribute('aria-label')).includes('2 个有来源的节点，1 条显式关系'), true)

  await page.getByRole('button', { name: '乙项目', exact: true }).click()
  await graph.getByRole('button', { name: '导入文件：old-b.csv' }).waitFor()
  await page.getByRole('button', { name: '更新当前版本' }).click()
  await graph.getByRole('button', { name: '导入文件：new-b.docx' }).waitFor()
  assert.equal(await graph.getByRole('button', { name: '导入文件：old-b.csv' }).count(), 0)
  assert.equal(await graph.locator('.kind-table').count(), 3)
  await page.getByRole('button', { name: '结构', exact: true }).click()
  assert.equal(await graph.locator('.kind-table').count(), 6)
  assert.equal(await graph.locator('.kind-segment').count(), 1)
  await graph.getByRole('button', { name: '导入文件：new-b.docx' }).click()
  await inspector.getByRole('button', { name: '第7工作表 · 1 行' }).click()
  assert.match(await inspector.innerText(), /第7工作表[\s\S]*原始行预览/)
  await inspector.getByRole('button', { name: '返回文件' }).click()
  await inspector.getByLabel('查找定位或内容').fill('合成正文')
  await inspector.getByRole('button', { name: /paragraph:1/ }).click()
  assert.match(await inspector.innerText(), /paragraph:1[\s\S]*乙项目合成正文段落/)
  await inspector.getByRole('button', { name: '返回文件' }).click()
  await page.getByRole('button', { name: '甲项目延迟更新' }).click()
  await waitUntil(() => calls.filter(project => project === 'P-A').length === 2)
  await page.getByRole('button', { name: '返回乙项目新版' }).click()
  await graph.getByRole('button', { name: '导入文件：new-b.docx' }).waitFor()
  await page.waitForTimeout(550)
  assert.equal(await graph.getByRole('button', { name: '导入文件：new-a.csv' }).count(), 0)
  assert.equal(await graph.getByRole('button', { name: '导入文件：new-b.docx' }).count(), 1)
  assert.match(await inspector.innerText(), /乙项目 · 合成导入/)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByLabel('快速定位节点').selectOption('document:DOC-B2')
  assert.match(await inspector.innerText(), /new-b.docx[\s\S]*解析状态/)
  assert.deepEqual(errors, [])
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  console.log('PASS imported-data graph: field analysis, hidden table and paragraph access, zoom, empty/source state, revision and stale-response isolation')
} finally { await browser.close() }
