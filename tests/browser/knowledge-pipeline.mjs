// Engineering synthetic UI contract only. Every API is mocked; no enterprise data,
// external model calls, real remote writes, or business-quality conclusions.
import { chromium, expect } from '@playwright/test'
import { build } from 'esbuild'
import { mkdir } from 'node:fs/promises'
import assert from 'node:assert/strict'

const timestamp = '2026-10-10T08:00:00Z'
const quote = '合成原文：管网改造合同额 18000 元，工程量 30 米；居民协商已完成。'
const evidence = { document_id: 'D-A', version: 'sha256-synthetic-only', locator: 'line:2', quote }
const condition = { fact_kind: 'resident_consultation_status', label: '居民协商完成', operator: 'eq', value: true, unit: null, source_value: '已完成', evidence: [evidence] }
const factor = (key, label, value, unit, association = 'direct', amount_kind = 'not_applicable') => ({ key, label, value, unit, object_ref: '合成管网 A', stage: '实施', observed_at: '2024-05-01', association, amount_kind, epistemic_status: 'fact', evidence: [evidence] })
const chunk = { id: 'CH-A', document_id: 'D-A', document_version: evidence.version, measure_key: 'pipe_network', object_ref: '合成管网 A', stage: '实施', kind: 'action', classification: 'local', spans: [evidence], text: quote, context_chunk_ids: ['CH-CONTEXT'] }
const context = { ...chunk, id: 'CH-CONTEXT', kind: 'context', text: '合成背景：先核对居民影响与维护责任。', context_chunk_ids: [] }
const makeCard = (id, title, measure = 'pipe_network', status = 'approved') => ({ id, title, project_id: 'P-A', revision: 2, status, review_note: status === 'approved' ? '合成卡片复核记录' : null, created_at: timestamp, updated_at: timestamp,
  project_type: '老旧小区改造', development_mode: '整治提升', stage: '实施', fields: ['decision_question', 'background', 'key_conditions', 'alternatives', 'proposal', 'actual_decision', 'decision_basis', 'implementation', 'outcome', 'applicability'].map(key => ({ key, value: key === 'implementation' ? quote : null, evidence: key === 'implementation' ? [evidence] : [] })),
  knowledge: { kind: 'case', origin: 'project_case', measure_key: measure, measure_name: measure === 'pipe_network' ? '管网改造' : '加装电梯', conditions: [condition], exclusions: [], transfer_notes: ['合成范围仍须专项核对'], evidence_level: 'implementation_record', chunks: [], factors: [factor('contract_cost', '合同金额', 18000, '元', 'direct', 'contract'), factor('package_total', '整包金额', 60000, '元', 'shared', 'package_total'), factor('length', '工程量', 30, '米')] } })
const initialCards = [makeCard('E-ONE', '合成管网案例一'), makeCard('E-TWO', '合成管网案例二'), makeCard('E-ELEVATOR', '合成电梯案例', 'elevator'), makeCard('E-DRAFT', '合成未审核卡', 'pipe_network', 'draft')]
const documents = [{ id: 'D-A', file_name: '合成工程记录.txt', visibility: 'internal', parser_result: { status: 'extracted', source_hash: evidence.version, text: `合成历史项目\n${quote}` } }]
const publicSource = { id: 'S-PUBLIC-SYNTHETIC', title: '合成已有公开来源', content_status: 'available', url: `https://example.org/synthetic-public-source-only/${'long-path-'.repeat(20)}` }
const publicDocument = { id: 'D-PUBLIC', file_name: '合成公开来源原件.txt', visibility: 'public', parser_result: { status: 'extracted', source_hash: 'sha256-synthetic-public-original', text: '合成公开原文：按原件定位核对管网举措。' } }
const states = { 'P-A': { documents, cards: structuredClone(initialCards), policies: [], skills: [], public_sources: [publicSource] }, 'P-B': { documents: [{ id: 'D-B', file_name: '乙项目合成材料.txt', parser_result: { status: 'extracted', source_hash: 'sha256-synthetic-b', text: '乙项目合成原文' } }], cards: [], policies: [], skills: [] } }
const definition = { key: 'contract_cost', label: '合同金额', value_type: 'number', role: 'key', weight: 2, unit: '元', scale: 10000, measure_keys: ['pipe_network'], evidence: [evidence] }
const mandatory = { key: 'resident_consultation_status', label: '居民协商完成', value_type: 'boolean', role: 'mandatory', weight: 0, unit: null, scale: null, measure_keys: ['pipe_network'], evidence: [evidence], condition, on_unmet: 'supplement' }
const result = value => ({ status: 200, value: structuredClone(value) })
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const calls = [], errors = []
let failExtract = false, failExport = false, delayChunk = 0, delayPipeline = 0, extractCount = 0, skillCount = 0

const built = await build({ stdin: { contents: `import React,{useState}from'react';import{createRoot}from'react-dom/client';
  import Panel from './apps/workspace/src/components/KnowledgePipelinePanel';import Library from './apps/workspace/src/components/ExperienceLibrary';import './apps/workspace/src/style.css';
  function Harness(){const[project,setProject]=useState('P-A'),[revision,setRevision]=useState(1),[changes,setChanges]=useState(0),[library,setLibrary]=useState(false),[visible,setVisible]=useState(true);return <>
  <nav><button onClick={()=>setProject('P-A')}>甲项目</button><button onClick={()=>setProject('P-B')}>乙项目</button><button onClick={()=>setRevision(value=>value+1)}>版本更新</button><button onClick={()=>setLibrary(true)}>经验库接入</button><button onClick={()=>setVisible(value=>!value)}>切换面板挂载</button></nav>
  <output aria-label="项目标识">{project}</output><output aria-label="经验刷新次数">{changes}</output>
  <main>{visible&&(library?<Library projectId={project} revision={revision} synthetic={true} asOf="2026-10-10" onProjectUpdated={()=>setRevision(value=>value+1)}/>:<div className="experience-library"><Panel projectId={project} revision={revision} onChanged={()=>setChanges(value=>value+1)}/></div>)}</main></>}
  createRoot(document.getElementById('root')).render(<Harness/>);`, loader: 'tsx', resolveDir: process.cwd() }, bundle: true, write: false, outfile: 'knowledge-pipeline-ui.js', format: 'iife', platform: 'browser', define: { 'process.env.NODE_ENV': '"production"' } })
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 960 } })
page.on('pageerror', error => errors.push(String(error)))
await page.exposeFunction('__request', async (path, body, method) => {
  calls.push({ path, body, method })
  const match = path.match(/^\/api\/projects\/(P-[AB])\/(.+)$/)
  assert.ok(match, `Unexpected synthetic API ${path}`)
  const [, project, resource] = match, state = states[project]
  if (resource === 'knowledge/pipeline') {
    assert.equal(method, 'GET'); const snapshot = result(state), waiting = delayPipeline; delayPipeline = 0
    if (waiting) { snapshot.value.documents = [{ ...documents[0], file_name: '过期读取材料.txt' }]; await delay(waiting) }
    return snapshot
  }
  if (resource === 'documents' && method === 'GET') return result(state.documents)
  if (resource === 'experiences' && method === 'GET') return result({ cards: state.cards })
  assert.equal(project, 'P-A', 'Synthetic writes must stay in their explicit project')
  if (resource === 'knowledge/public-document') {
    assert.equal(method, 'POST'); assert.deepEqual(body, { source_id: publicSource.id })
    assert.equal(Object.hasOwn(publicSource, 'body'), false)
    await delay(80)
    const reused = state.documents.some(document => document.id === publicDocument.id)
    if (!reused) state.documents.push(structuredClone(publicDocument))
    return result({ ...publicDocument, source_id: publicSource.id, reused })
  }
  const cardReview = resource.match(/^experiences\/(E-EXTRACT-\d+)\/review$/)
  if (cardReview) {
    const index = state.cards.findIndex(card => card.id === cardReview[1]), card = state.cards[index]
    assert.equal(body.expected_revision, card.revision); assert.ok(body.note.trim()); assert.equal(card.status, 'draft')
    state.cards[index] = { ...card, revision: card.revision + 1, status: body.status, review_note: body.note }
    return result(state.cards[index])
  }
  if (resource === 'knowledge/chunks') {
    assert.deepEqual(body, { document_id: 'D-A' }); const waiting = delayChunk; delayChunk = 0; await delay(waiting || 80)
    return result({ chunks: [chunk, context], warnings: waiting ? ['过期切分警告'] : [] })
  }
  if (resource === 'knowledge/extract') {
    assert.deepEqual(body.document_ids, ['D-A']); assert.equal(typeof body.use_model, 'boolean')
    if (failExtract) { failExtract = false; return { status: 409, value: { detail: '合成冲突：原件版本已变化，请重新读取材料。' } } }
    await delay(80)
    const card = makeCard(`E-EXTRACT-${++extractCount}`, `合成提取草稿 ${extractCount}`, 'pipe_network', 'draft'); card.knowledge.chunks = [chunk, context]
    state.cards.unshift(card)
    return result({ cards: [card], warnings: ['合成材料未记载实施效果，结果留空。'], model_calls: 0 })
  }
  if (resource === 'knowledge/policies') {
    assert.deepEqual(Object.keys(body.policy).sort(), ['definitions', 'max_distance', 'min_coverage', 'note'])
    const current = body.id ? state.policies.find(policy => policy.id === body.id) : undefined
    if (current) assert.equal(body.expected_revision, current.revision)
    else assert.equal(body.expected_revision, undefined)
    await delay(80)
    const policy = { ...body.policy, id: current?.id || 'FP-A', project_id: project, revision: current ? current.revision + 1 : 1, status: 'draft', reviewed_by: null, reviewed_at: null, created_at: timestamp, updated_at: timestamp }
    state.policies = [policy, ...state.policies.filter(item => item.id !== policy.id)]
    return result(policy)
  }
  if (resource === 'knowledge/policies/FP-A/review') {
    const current = state.policies[0]; assert.equal(body.expected_revision, current.revision); assert.ok(body.note.trim()); assert.equal(current.status, 'draft')
    await delay(80)
    const policy = { ...current, revision: current.revision + 1, status: body.status, note: `${current.note}\n复核：${body.note}`, reviewed_by: '合成导师', reviewed_at: timestamp }
    state.policies[0] = policy
    return result(policy)
  }
  if (resource === 'knowledge/groups') {
    const policy = state.policies.find(item => item.id === body.policy_id)
    if (policy) assert.equal(body.policy_revision, policy.revision)
    return result({ grouping: { policy_id: policy?.id || null, policy_revision: policy?.revision || null, policy_status: policy?.status || 'none', groups: [{ id: 'GROUP-A', measure_key: 'pipe_network', stage: '实施', kind: 'case', card_refs: [{ card_id: 'E-ONE', revision: 2 }, { card_id: 'E-TWO', revision: 2 }], diameter: 0.1, min_coverage: 1 }], unassigned: [{ card_id: 'E-DRAFT', reason: '合成卡片尚未审核' }], candidate_count: 3, truncated: false, source_fingerprint: 'synthetic-source-fingerprint-only' }, cards: state.cards })
  }
  if (resource === 'knowledge/skills/distill') {
    const selected = state.cards.filter(card => body.card_ids.includes(card.id)); assert.ok(selected.length); assert.equal(selected.every(card => card.status === 'approved'), true); assert.equal(new Set(selected.map(card => card.knowledge.measure_key)).size, 1)
    await delay(80)
    const skill = { id: `SK-A-${++skillCount}`, project_id: project, revision: 1, status: 'draft', title: `合成管网技能 ${skillCount}`, measure_key: 'pipe_network', card_refs: body.card_ids.map(id => ({ card_id: id, revision: state.cards.find(card => card.id === id).revision })), input_keys: ['resident_consultation_status', 'contract_cost'], preconditions: [condition], exclusions: [], procedure: ['核对来源卡片与原文版本。', '核对居民协商状态，记录专项调查需求。'], validation_points: ['金额须归属于当前措施且保留单位。'], counterexamples: ['整包总额不能直接当作单项措施费用。'], allowed_tools: ['knowledge_evidence'], method: 'compiled', review_note: null, reviewed_by: null, reviewed_at: null, created_at: timestamp, updated_at: timestamp }
    state.skills.unshift(skill)
    return result(skill)
  }
  const review = resource.match(/^knowledge\/skills\/(SK-A-\d+)\/review$/)
  if (review) {
    const current = state.skills.find(skill => skill.id === review[1]); assert.equal(body.expected_revision, current.revision); assert.equal(current.status, 'draft'); assert.ok(body.note.trim()); await delay(80)
    const skill = { ...current, status: body.status, revision: current.revision + 1, review_note: body.note, reviewed_by: '合成复核者', reviewed_at: timestamp }
    state.skills = [skill, ...state.skills.filter(item => item.id !== skill.id)]
    return result(skill)
  }
  const exported = resource.match(/^knowledge\/skills\/(SK-A-\d+)\/export$/)
  if (exported) {
    assert.equal(method, 'GET'); assert.equal(state.skills.find(skill => skill.id === exported[1]).status, 'approved')
    if (failExport) { failExport = false; return { status: 409, value: { detail: '合成冲突：来源卡片版本已变化，技能需重新复核。' } } }
    return result({ filename: 'SKILL.md', markdown: '# 合成已审核管网技能\n\n来源 E-ONE v2、E-TWO v2。\n\n边界：整包总额不能直接当作单项措施费用。\n\n这是工程合成数据，未证明业务效果。' })
  }
  throw Error(`Unexpected synthetic API ${path}`)
})

const posts = () => calls.filter(call => call.method === 'POST')
const count = resource => calls.filter(call => call.path.endsWith(resource)).length
const region = page.getByRole('region', { name: '知识沉淀操作面板', exact: true })
const tab = name => region.getByRole('button', { name, exact: true }).click()
const noOverflow = async label => {
  const dimensions = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }))
  assert.ok(dimensions.scroll <= dimensions.viewport + 1, `${label} overflow: ${JSON.stringify(dimensions)}`)
}
const doubleClick = locator => locator.evaluate(button => { button.click(); button.click() })
try {
  await page.setContent(`<html lang="zh-CN"><head><style>${built.outputFiles.find(file => file.path.endsWith('.css')).text} output{display:block;overflow-wrap:anywhere} body{margin:0}</style></head><body><div id="root"></div></body></html>`)
  await page.evaluate(() => {
    window.__downloads = []
    const create = URL.createObjectURL.bind(URL)
    URL.createObjectURL = blob => { blob.text().then(text => window.__downloads.push(text)); return create(blob) }
    window.fetch = async (path, options) => {
      const response = await window.__request(String(path), options?.body ? JSON.parse(options.body) : undefined, options?.method || 'GET')
      return new Response(JSON.stringify(response.value), { status: response.status, headers: { 'content-type': 'application/json' } })
    }
  })
  await page.addScriptTag({ content: built.outputFiles.find(file => file.path.endsWith('.js')).text })
  await expect(region.getByRole('button', { name: '切分原文：合成工程记录.txt', exact: true })).toBeVisible()
  assert.equal(count('/knowledge/pipeline'), 1); assert.equal(posts().length, 0)
  for (const label of ['导师因素政策', '分组预览', '技能蒸馏', '原文与措施因素']) await tab(label)
  assert.equal(posts().length, 0); assert.equal(count('/knowledge/pipeline'), 1)
  assert.equal(count('/knowledge/public-document'), 0)
  await page.setViewportSize({ width: 390, height: 844 }); await noOverflow('initial source panel')

  await doubleClick(region.getByRole('button', { name: '切分原文：合成工程记录.txt', exact: true }))
  await expect(region.getByRole('article', { name: '原文片段：CH-A', exact: true })).toBeVisible()
  assert.equal(count('/knowledge/chunks'), 1)
  const original = region.getByRole('article', { name: '原文片段：CH-A', exact: true })
  assert.match(await original.innerText(), /管网改造合同额 18000 元[\s\S]*CH-CONTEXT/)
  await original.getByText('原文定位与引用 · 1', { exact: true }).click()
  assert.match(await original.innerText(), /合成工程记录.txt · line:2[\s\S]*sha256-synthetic-only/)
  const factors = region.getByRole('article', { name: '措施因素：合成管网案例一', exact: true })
  assert.match(await factors.innerText(), /18000 元[\s\S]*直接关联 · 合同额[\s\S]*60000 元[\s\S]*多举措共享 · 整包总额[\s\S]*30 米/)
  await factors.locator('summary').first().click(); assert.match(await factors.innerText(), /line:2/); await noOverflow('chunks and expanded factor citations')
  const model = region.getByRole('checkbox', { name: '允许本次使用模型提取措施与因素', exact: true })
  assert.equal(await model.isChecked(), false)
  await region.locator('.pipeline-documents input[type=checkbox]').check()
  await doubleClick(region.getByRole('button', { name: '提取措施与因素草稿', exact: true }))
  await expect(region.getByRole('status')).toContainText('已生成 1 张措施经验草稿')
  assert.equal(count('/knowledge/extract'), 1); assert.equal(posts().at(-1).body.use_model, false)
  await expect(page.getByLabel('经验刷新次数')).toHaveText('1')
  assert.match(await region.innerText(), /合成材料未记载实施效果/)
  await model.check(); assert.equal(count('/knowledge/extract'), 1)
  await region.locator('.pipeline-documents input[type=checkbox]').check()
  await region.getByRole('button', { name: '提取措施与因素草稿', exact: true }).click()
  await expect(page.getByLabel('经验刷新次数')).toHaveText('2')
  assert.equal(posts().at(-1).body.use_model, true)
  failExtract = true; await region.locator('.pipeline-documents input[type=checkbox]').check()
  await region.getByRole('button', { name: '提取措施与因素草稿', exact: true }).click()
  await expect(region.getByRole('alert')).toContainText('原件版本已变化')

  await tab('导师因素政策')
  await region.getByRole('button', { name: '添加因素', exact: true }).click()
  await region.getByLabel('因素 1 标识').fill('contract_cost'); await region.getByLabel('因素 1 名称').fill('合同金额')
  await region.getByLabel('因素 1 角色').selectOption('key'); await region.getByLabel('因素 1 权重').fill('2')
  await region.getByLabel('因素 1 单位').fill('元'); await region.getByLabel('因素 1 数值尺度').fill('10000'); await region.getByLabel('因素 1 适用举措').fill('pipe_network')
  assert.deepEqual(await region.getByLabel('因素 1 角色').locator('option').evaluateAll(options => options.map(option => option.value)), ['mandatory', 'key', 'background', 'discarded', 'pending'])
  await region.getByText('高级 JSON：条件、原文依据与完整定义', { exact: true }).click()
  await region.getByLabel('完整因素定义 JSON').fill('{bad json')
  await region.getByRole('button', { name: '应用 JSON 定义', exact: true }).click()
  await expect(region.getByRole('alert')).toContainText('不是有效 JSON')
  await region.getByLabel('完整因素定义 JSON').fill(JSON.stringify([definition, mandatory], null, 2))
  await region.getByRole('button', { name: '应用 JSON 定义', exact: true }).click()
  await expect(region.getByLabel('因素 2 角色')).toHaveValue('mandatory')
  await region.getByLabel('覆盖率下限').fill('0.8'); await region.getByLabel('组内距离上限').fill('0.25'); await region.getByLabel('政策依据与适用备注').fill('合成导师参数，仅作 UI 契约验证。')
  await doubleClick(region.getByRole('button', { name: '保存因素政策草稿', exact: true }))
  await expect(region.getByRole('status')).toContainText('已保存为草稿')
  assert.equal(count('/knowledge/policies'), 1); assert.deepEqual(states['P-A'].policies[0].definitions, [definition, mandatory])
  assert.equal(await region.getByRole('button', { name: '政策复核通过', exact: true }).isDisabled(), true)
  await region.getByLabel('导师复核备注').fill('已核对合成原文与量纲；这只是工程测试。')
  await region.getByLabel('因素 1 权重').fill('3')
  assert.equal(await region.getByRole('button', { name: '政策复核通过', exact: true }).isDisabled(), true)
  assert.match(await region.locator('.pipeline-policy-state').innerText(), /未保存修改/)
  await region.getByRole('button', { name: '保存因素政策草稿', exact: true }).click()
  await expect(region.getByRole('status')).toContainText('已保存为草稿')
  assert.equal(states['P-A'].policies[0].revision, 2); assert.equal(await region.getByLabel('导师复核备注').inputValue(), '')
  await region.getByLabel('导师复核备注').fill('核对合成原文、单位与适用举措，不代表企业验证。')
  await doubleClick(region.getByRole('button', { name: '政策复核通过', exact: true }))
  await expect(region.getByRole('status')).toContainText('已记录导师复核')
  assert.equal(count('/policies/FP-A/review'), 1); assert.equal(states['P-A'].policies[0].revision, 3)
  assert.match(await region.locator('.pipeline-policy-state').innerText(), /已审核[\s\S]*保存版本 v3[\s\S]*合成导师/)
  await noOverflow('policy form, JSON and review')
  await page.setViewportSize({ width: 1280, height: 960 }); await mkdir('output/playwright', { recursive: true })
  await page.screenshot({ path: 'output/playwright/knowledge-pipeline-desktop.png', fullPage: true })

  await tab('分组预览'); await region.getByLabel('分组因素政策').selectOption('FP-A')
  await region.getByLabel('分组举措标识').fill('pipe_network'); await region.getByLabel('分组决策问题').fill('合成管网改造如何分段？')
  const beforeGroups = posts().length
  await region.getByRole('button', { name: '预览知识分组', exact: true }).click()
  await expect(region.getByRole('status')).toContainText('已预览 1 组经验')
  assert.equal(posts().length, beforeGroups + 1)
  assert.deepEqual(posts().at(-1).body, { policy_id: 'FP-A', policy_revision: 3, query: { measure_key: 'pipe_network', question: '合成管网改造如何分段？' } })
  assert.match(await region.getByLabel('本次分组结果').innerText(), /FP-A · v3 · 已审核[\s\S]*E-ONE v2[\s\S]*E-TWO v2[\s\S]*尚未审核/)
  await region.getByText('本次来源指纹', { exact: true }).click()
  await page.setViewportSize({ width: 390, height: 844 }); await noOverflow('group references and fingerprint')

  await tab('技能蒸馏')
  assert.equal(await region.getByRole('checkbox', { name: '选择技能来源：合成未审核卡', exact: true }).isDisabled(), true)
  assert.equal(await region.getByRole('checkbox', { name: '选择技能来源：合成提取草稿 1', exact: true }).isDisabled(), true)
  await region.getByRole('checkbox', { name: '选择技能来源：合成管网案例一', exact: true }).check()
  assert.equal(await region.getByRole('checkbox', { name: '选择技能来源：合成电梯案例', exact: true }).isDisabled(), true)
  await region.getByRole('checkbox', { name: '选择技能来源：合成管网案例二', exact: true }).check()
  await doubleClick(region.getByRole('button', { name: '蒸馏技能草稿', exact: true }))
  const skill = region.getByRole('article', { name: '技能：合成管网技能 1', exact: true })
  await expect(skill).toBeVisible(); assert.equal(count('/knowledge/skills/distill'), 1)
  assert.deepEqual(posts().at(-1).body, { card_ids: ['E-ONE', 'E-TWO'] })
  assert.equal(await skill.getByRole('button', { name: '下载已审核 Skill', exact: true }).count(), 0)
  await skill.getByText('来源卡片与版本 · 2', { exact: true }).click(); assert.match(await skill.innerText(), /E-ONE v2[\s\S]*E-TWO v2/)
  await skill.getByText('查看技能流程与适用边界', { exact: true }).click()
  assert.match(await skill.innerText(), /原文取值：已完成[\s\S]*核对来源卡片与原文版本[\s\S]*整包总额不能直接当作单项措施费用/)
  assert.equal(await skill.getByRole('button', { name: '技能复核通过', exact: true }).isDisabled(), true)
  await skill.getByLabel('技能复核备注：合成管网技能 1').fill('已核对合成来源版本、流程和反例；不作业务效果结论。')
  await doubleClick(skill.getByRole('button', { name: '技能复核通过', exact: true }))
  await expect(skill.getByRole('button', { name: '下载已审核 Skill', exact: true })).toBeVisible()
  assert.equal(count('/skills/SK-A-1/review'), 1)
  assert.match(await skill.innerText(), /已审核[\s\S]*v2|v2[\s\S]*已审核/)
  assert.equal(count('/skills/SK-A-1/export'), 0)
  await skill.getByRole('button', { name: '下载已审核 Skill', exact: true }).click()
  await page.waitForFunction(() => window.__downloads.length === 1)
  assert.match(await page.evaluate(() => window.__downloads[0]), /来源 E-ONE v2、E-TWO v2[\s\S]*整包总额[\s\S]*未证明业务效果/)
  await skill.getByText('查看导出内容 · SKILL.md', { exact: true }).click()
  assert.equal(count('/skills/SK-A-1/export'), 1); await noOverflow('skill procedure, source revisions, markdown export')
  await page.screenshot({ path: 'output/playwright/knowledge-pipeline-mobile.png', fullPage: true })
  failExport = true; await skill.getByRole('button', { name: '下载已审核 Skill', exact: true }).click()
  await expect(region.getByRole('alert')).toContainText('来源卡片版本已变化')
  await region.getByRole('checkbox', { name: '选择技能来源：合成管网案例一', exact: true }).check()
  await region.getByRole('button', { name: '蒸馏技能草稿', exact: true }).click()
  const rejected = region.getByRole('article', { name: '技能：合成管网技能 2', exact: true }); await expect(rejected).toBeVisible()
  await rejected.getByLabel('技能复核备注：合成管网技能 2').fill('合成反例不足，暂不通过。')
  await rejected.getByRole('button', { name: '技能复核不通过', exact: true }).click()
  await expect(rejected.locator('.pipeline-badge')).toHaveText('复核未通过')
  assert.equal(await rejected.getByRole('button', { name: '下载已审核 Skill', exact: true }).count(), 0)

  // Draft policy parameters may preview groups, and an approved saved policy edited
  // in the form cannot lend its status to unsaved values.
  await tab('导师因素政策'); await region.getByLabel('因素 1 权重').fill('4')
  assert.match(await region.locator('.pipeline-policy-state').innerText(), /未保存修改/)
  await region.getByRole('button', { name: '保存因素政策草稿', exact: true }).click()
  await expect(region.getByRole('status')).toContainText('已保存为草稿')
  await tab('分组预览'); await region.getByLabel('分组因素政策').selectOption('FP-A')
  assert.match(await region.innerText(), /未通过复核的政策参数，仅用于预览/)
  await region.getByRole('button', { name: '预览知识分组', exact: true }).click()
  await expect(region.getByLabel('本次分组结果')).toContainText('草稿待复核')
  await region.getByLabel('分组因素政策').selectOption('')
  await region.getByRole('button', { name: '预览知识分组', exact: true }).click()
  await expect(region.getByLabel('本次分组结果')).toContainText('未使用因素政策')

  // Old mutation results must be discarded even when the project returns to A.
  await tab('原文与措施因素'); delayChunk = 300
  const chunkBefore = count('/knowledge/chunks')
  await region.getByRole('button', { name: '切分原文：合成工程记录.txt', exact: true }).click()
  await expect.poll(() => count('/knowledge/chunks')).toBe(chunkBefore + 1)
  await page.getByRole('button', { name: '乙项目', exact: true }).click()
  await expect(region.getByRole('button', { name: '切分原文：乙项目合成材料.txt', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '甲项目', exact: true }).click()
  await expect(region.getByRole('button', { name: '切分原文：合成工程记录.txt', exact: true })).toBeVisible()
  await page.waitForTimeout(350)
  assert.doesNotMatch(await region.innerText(), /过期切分警告/)
  assert.equal(await model.isChecked(), false)
  assert.equal(await region.locator('.pipeline-documents input[type=checkbox]').isChecked(), false)
  // Old reads also stay discarded when a revision reload overlaps a project switch.
  delayPipeline = 300; const readsBefore = count('/knowledge/pipeline')
  await page.getByRole('button', { name: '版本更新', exact: true }).click(); await expect.poll(() => count('/knowledge/pipeline')).toBe(readsBefore + 1)
  await page.getByRole('button', { name: '乙项目', exact: true }).click(); await expect(region.getByRole('button', { name: '切分原文：乙项目合成材料.txt', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '甲项目', exact: true }).click(); await expect(region.getByRole('button', { name: '切分原文：合成工程记录.txt', exact: true })).toBeVisible()
  await page.waitForTimeout(350); assert.doesNotMatch(await region.innerText(), /过期读取材料/)
  // Unmount also invalidates an in-flight extraction callback.
  await region.locator('.pipeline-documents input[type=checkbox]').check(); const callbacks = await page.getByLabel('经验刷新次数').innerText()
  await region.getByRole('button', { name: '提取措施与因素草稿', exact: true }).click()
  await page.getByRole('button', { name: '切换面板挂载', exact: true }).click(); await page.waitForTimeout(150)
  assert.equal(await page.getByLabel('经验刷新次数').innerText(), callbacks)
  await page.getByRole('button', { name: '切换面板挂载', exact: true }).click(); await expect(region.getByRole('button', { name: '切分原文：合成工程记录.txt', exact: true })).toBeVisible()

  // ExperienceLibrary remains lazy; successful extraction refreshes only its
  // experience-card list, not the entire project or pipeline snapshot.
  await page.getByRole('button', { name: '经验库接入', exact: true }).click()
  const library = page.getByRole('region', { name: '项目经验沉淀', exact: true })
  await expect(library.getByRole('button', { name: '原文举措、导师因素政策与技能蒸馏', exact: true })).toBeVisible()
  assert.equal(await region.count(), 0)
  const pipelineReads = count('/knowledge/pipeline'), beforeOpenPosts = posts().length
  await library.getByRole('button', { name: '原文举措、导师因素政策与技能蒸馏', exact: true }).click()
  await expect(region.getByRole('button', { name: '切分原文：合成工程记录.txt', exact: true })).toBeVisible()
  assert.equal(count('/knowledge/pipeline'), pipelineReads + 1); assert.equal(posts().length, beforeOpenPosts)
  const experienceReads = count('/experiences'), currentPipelineReads = count('/knowledge/pipeline')
  await region.locator('.pipeline-documents input[type=checkbox]').check()
  await region.getByRole('button', { name: '提取措施与因素草稿', exact: true }).click()
  await expect.poll(() => count('/experiences')).toBe(experienceReads + 1)
  await expect(library.locator('.experience-card-heading').filter({ hasText: `合成提取草稿 ${extractCount}` })).toBeVisible()
  assert.equal(count('/knowledge/pipeline'), currentPipelineReads)
  const reviewedTitle = `合成提取草稿 ${extractCount}`
  await library.locator('.experience-card-heading').filter({ hasText: reviewedTitle }).click()
  await library.locator('.experience-review').getByLabel('复核备注', { exact: true }).fill('合成工程复核：保留原文、单位与未记载结果。')
  await library.locator('.experience-review').getByRole('button', { name: '审核通过', exact: true }).click()
  await expect(library.locator('.experience-status.is-approved').filter({ hasText: 'v3' })).toBeVisible()
  const sourceReads = count('/experiences')
  await tab('技能蒸馏')
  await expect(region.getByRole('checkbox', { name: `选择技能来源：${reviewedTitle}`, exact: true })).toBeEnabled()
  assert.equal(count('/experiences'), sourceReads + 1); assert.equal(count('/knowledge/pipeline'), currentPipelineReads)
  await noOverflow('ExperienceLibrary integration')

  // Only an explicit import creates an original from the already-present source.
  // The callback reloads documents alone, making the original available to the
  // existing ten-field citation editor without a project/card-list refresh.
  await tab('原文与措施因素')
  const publicSources = region.getByLabel('已有公开来源', { exact: true })
  await expect(publicSources).toBeVisible()
  assert.equal(count('/knowledge/public-document'), 0)
  await publicSources.selectOption(publicSource.id)
  assert.equal(count('/knowledge/public-document'), 0)
  assert.match(await region.getByRole('group', { name: '已有公开来源原件导入', exact: true }).innerText(), /S-PUBLIC-SYNTHETIC[\s\S]*example.org/)
  const importReads = { pipeline: count('/knowledge/pipeline'), documents: count('/documents'), cards: count('/experiences') }
  await doubleClick(region.getByRole('button', { name: '从已有公开来源导入原件', exact: true }))
  await expect(region.getByRole('status')).toContainText('已导入公开来源原件并选中')
  const publicChoice = region.locator('.pipeline-documents').getByRole('checkbox', { name: /合成公开来源原件.txt/ })
  await expect(publicChoice).toBeChecked()
  await expect.poll(() => count('/documents')).toBe(importReads.documents + 1)
  await expect(region.getByRole('button', { name: '从已有公开来源导入原件', exact: true })).toBeDisabled()
  assert.equal(count('/knowledge/public-document'), 1)
  assert.equal(count('/knowledge/pipeline'), importReads.pipeline + 1)
  assert.equal(count('/experiences'), importReads.cards)
  assert.equal(states['P-A'].documents.find(document => document.id === 'D-A').visibility, 'internal')
  await library.getByRole('button', { name: '手动整理经验', exact: true }).click()
  const manual = library.getByRole('form', { name: '手动整理经验草稿', exact: true })
  await manual.getByRole('button', { name: '为实施记录添加原文引用', exact: true }).click()
  await expect(manual.getByLabel('实施记录来源文档1').locator('option[value="D-PUBLIC"]')).toHaveText(publicDocument.file_name)
  await manual.getByLabel('实施记录来源文档1').selectOption('D-PUBLIC')
  await manual.getByLabel('实施记录原文片段1').selectOption('line:1')
  await expect(manual.getByLabel('实施记录原文定位1')).toHaveValue('line:1')
  await expect(manual.getByLabel('实施记录逐字引文1')).toHaveValue(publicDocument.parser_result.text)
  await expect(manual).toContainText(publicDocument.parser_result.source_hash)
  await manual.getByRole('button', { name: '取消整理', exact: true }).click()
  // Re-import explicitly reuses the same original and keeps one selectable row.
  await publicSources.selectOption(publicSource.id)
  await region.getByRole('button', { name: '从已有公开来源导入原件', exact: true }).click()
  await expect(region.getByRole('status')).toContainText('已复用公开来源原件并选中')
  await expect(publicChoice).toBeChecked(); assert.equal(await publicChoice.count(), 1)
  assert.equal(count('/knowledge/public-document'), 2)
  await noOverflow('public source metadata, imported original and citation picker')
  assert.deepEqual(errors, [])
  assert.equal(calls.every(call => call.path.startsWith('/api/projects/')), true)
  console.log('PASS knowledge pipeline engineering synthetic: lazy integration, mount/tab read-only, explicit existing-public-source import/reuse + selected original + document-only citation-editor refresh, original chunks and citation versions, factors with units/association/amount kind, explicit local/model intent, duplicate guard, readable conflicts, editable policy JSON + conditions/evidence, save/review revisions and unsaved guard, draft/approved/no-policy group previews, approved same-measure sources, skill draft/review/reject/export, A→B→A stale reads/writes, unmount invalidation, extraction → existing card review → available skill source, related-list refresh and every 390px page; actual external/model calls = 0')
} finally { await browser.close() }
