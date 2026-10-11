// Isolated synthetic component regression. No real decision labels, enterprise materials or model calls.
import { chromium } from '@playwright/test'
import { build } from 'esbuild'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'

const publicQuote = '合成协商程序已完成。', internalQuote = '内部合成维护计划已列明。', finalQuote = '合成原文支持保留出资核查。'
const unsafeQuote = '<img src=x onerror="window.__scriptExecuted=true">合成未核实记录。'
const original = (document_id, version, quote, url, visibility = 'public') => ({ document_id, version, locator: 'line:1', quote,
  original_source: { id: `ORIGINAL-${document_id}`, url, visibility, hash: `raw-hash-${document_id}` } })
const root = (id, title, citations, visibility = 'public', url) => ({ id, title, synthetic: true, data_class: 'synthetic', visibility,
  hash: `kb-envelope-${id}`, locator: `experience:${id}/revision:2`, url, untrusted_text: JSON.stringify({ citations }) })
const sources = [
  root('S-KB-CASE-R2', '案例：合成管网分段实施', [original('D-ONE', 'document-version-one', publicQuote, 'https://example.org/public-case'), original('D-TWO', 'document-version-two', publicQuote, 'https://example.org/another-document'), { ...original('D-FINAL', 'document-version-final', finalQuote, 'https://example.org/final-evidence'), locator: 'page:2' }]),
  root('S-KB-RULE-R3', '规则：合成维护计划', [original('D-INTERNAL', 'document-version-internal', internalQuote, undefined, 'internal')], 'internal'),
  root('S-KB-BAD-R1', '合成脚本地址来源', [original('D-UNSAFE', 'document-version-unsafe', unsafeQuote, 'javascript:window.__scriptExecuted=true')], 'public', 'javascript:window.__scriptExecuted=true'),
  { id: 'S-GUARD', title: '合成出资核查记录', synthetic: true, data_class: 'synthetic', visibility: 'internal', locator: 'section:funding', untrusted_text: '合成核查：未见出资书面承诺。' },
]
const condition = (key, label, quote, document, state = 'matched', value = true) => ({ condition: { fact_kind: key, label, operator: 'eq', value, unit: null, evidence: [{ document_id: document, version: `document-version-${document}`, locator: 'line:1', quote }] }, state, fact_refs: ['F-SYNTHETIC'], evidence_refs: [document === 'D-INTERNAL' ? 'S-KB-RULE-R3' : document === 'D-UNSAFE' ? 'S-KB-BAD-R1' : 'S-KB-CASE-R2'], reason: state === 'matched' ? '合成条件与本次事实一致。' : '合成资料不足，保留待核。' })
const card = (id, title, kind, measure_key, measure_name, conditions, state = 'transferable') => ({ card_id: id, card_revision: id === 'RULE' ? 3 : 2, title, source_project_id: 'P-HISTORICAL-SYNTHETIC', kind, origin: kind === 'case' ? 'project_case' : 'research_paper', measure_key, measure_name, similarity: 0.7, related: true, transferability: state,
  conditions, exclusions: [], similar_conditions: [], important_differences: [], reuse_premises: [], unknowns: [], recommendation: null, evidence_refs: [] })
const caseCard = card('CASE', '合成管网分段实施', 'case', 'pipe_network', '管网改造', [condition('consultation_completed', '居民协商完成', publicQuote, 'D-ONE')])
const ruleCard = card('RULE', '合成维护计划', 'rule', 'maintenance', '长效维护', [condition('maintenance_plan_present', '已具备维护计划', internalQuote, 'D-INTERNAL')])
const candidate = card('BAD', '合成出资待核规则', 'rule', 'funding', '资金核实', [condition('funding_confirmed', '书面出资承诺', unsafeQuote, 'D-UNSAFE', 'unknown')], 'conditional')
const trace = { policy_version: 'knowledge-routing-v2', evaluated_as_of: '2026-10-08', query: { measure_key: 'pipe_network', question: '合成管网改造如何推进？' }, route: 'combined_hit', case_hits: [caseCard], rule_hits: [ruleCard], candidates: [caseCard, ruleCard, candidate], reasons: ['合成案例与规则条件已匹配。'], fallback_status: 'not_needed', agent_status: 'executed' }
const cite = (source_id, quote) => ({ source_id, locator: 'line:1', quote })
const advice = (measure_key, text, cardId, key, citations) => ({ measure_key, advice: text, reasoning: '合成材料支持这一调查顺序，实施边界仍需核对。', matched_card_ids: [cardId], matched_condition_keys: [key], citations, unknowns: ['范围边界待核'], next_steps: ['核对原文与当前事实'] })
const value = { policy_version: 'knowledge-agent-v1', final_action: 'supplement', decision_evidence_refs: ['S-GUARD', 'S-KB-CASE-R2'], final_citations: [{ source_id: 'S-KB-CASE-R2', locator: 'page:2', quote: finalQuote }], guard_reasons: ['出资书面承诺尚未核实，先补齐资料。'], assessed_card_ids: ['CASE', 'RULE', 'BAD'], assessment: {
  summary: '合成案例与规则均有可参考条件，资金资料缺项需先补齐。', decision: { action: 'proceed', reasoning: '初判可进入进一步尽调；资料缺项交由约束检查保留。', citations: [cite('S-KB-CASE-R2', publicQuote), cite('S-KB-RULE-R3', internalQuote)] },
  recommendations: [advice('pipe_network', '分段核对管网施工范围。', 'CASE', 'consultation_completed', [cite('S-KB-CASE-R2', publicQuote)]), advice('maintenance', '先核对维护责任边界。', 'RULE', 'maintenance_plan_present', [cite('S-KB-RULE-R3', internalQuote)]), advice('funding', '先获取书面出资承诺。', 'BAD', 'funding_confirmed', [cite('S-KB-BAD-R1', unsafeQuote), cite('S-NOT-RETURNED', '合成缺失来源引文')])], disagreements: ['合成材料对维护范围的记载尚不一致。'] } }
const built = await build({ stdin: { contents: `import React,{useState}from'react';import{createRoot}from'react-dom/client';import Report from './apps/workspace/src/components/KnowledgeAgentReport';import './apps/workspace/src/style.css';
  const originalValue=${JSON.stringify(value)};function Harness(){const[refs,setRefs]=useState([]),[value,setValue]=useState(originalValue);return <main><nav><button onClick={()=>{const{final_citations,...legacy}=originalValue;setValue(legacy)}}>旧报告模式</button><button onClick={()=>setValue({...originalValue,final_citations:[]})}>明确无最终引文</button><button onClick={()=>setValue(originalValue)}>新报告模式</button></nav><Report value={value} trace={${JSON.stringify(trace)}} sources={${JSON.stringify(sources)}} onEvidence={value=>setRefs(current=>[...current,value])}/><output aria-label="资料导航记录">{JSON.stringify(refs)}</output></main>}
  createRoot(document.getElementById('root')).render(<Harness/>);`, loader: 'tsx', resolveDir: process.cwd() }, bundle: true,
  write: false, outfile: 'knowledge-agent-report-ui.js', format: 'iife', platform: 'browser', define: { 'process.env.NODE_ENV': '"production"' } })
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 960 } })
const errors = [], requests = []
page.on('pageerror', error => errors.push(String(error))); page.on('request', request => requests.push(request.url()))
try {
  await page.setContent(`<html lang="zh-CN"><head><style>${built.outputFiles.find(file => file.path.endsWith('.css')).text} output{display:block;overflow-wrap:anywhere}</style></head><body><div id="root"></div></body></html>`)
  await page.evaluate(() => { window.__scriptExecuted = false; window.fetch = () => { throw new Error('Report must not request network') } })
  await page.addScriptTag({ content: built.outputFiles.find(file => file.path.endsWith('.js')).text })
  const report = page.getByRole('region', { name: 'Agent 研判与行动依据' })
  await report.waitFor()
  assert.equal(await report.getByRole('article').count(), 4)
  const decision = report.getByRole('article', { name: '决策与行动依据' })
  assert.match(await decision.innerText(), /Agent 初判[\s\S]*建议开展专项调查[\s\S]*最终行动[\s\S]*先补充关键资料再判断/)
  assert.match(await decision.innerText(), /程序约束调整了最终行动/)
  assert.match(await decision.innerText(), /出资书面承诺尚未核实/)
  const initial = decision.getByRole('group', { name: 'Agent 初判依据' }), final = decision.getByRole('group', { name: '最终行动依据' })
  assert.equal(await initial.getByRole('button').count(), 2)
  assert.equal(await final.getByRole('button').count(), 2)
  assert.equal(await final.getByRole('button', { name: /合成维护计划/ }).count(), 0)
  await initial.getByRole('button', { name: '[来源1] 案例：合成管网分段实施', exact: true }).click()
  assert.equal(await initial.getByText(publicQuote, { exact: true }).first().isVisible(), true)
  assert.match(await initial.innerText(), /引用定位 line:1/)
  await initial.getByText('对应原始文档 · 2', { exact: true }).click()
  assert.match(await initial.innerText(), /文档来源 · D-ONE[\s\S]*材料版本 document-version-one/)
  assert.match(await initial.innerText(), /文档来源 · D-TWO[\s\S]*材料版本 document-version-two/)
  assert.match(await initial.innerText(), /来源记录版本 kb-envelope-S-KB-CASE-R2/)
  assert.match(await initial.innerText(), /原始来源哈希 raw-hash-D-ONE/)
  assert.equal(await initial.getByRole('link').count(), 2)
  assert.equal(await initial.getByRole('link').first().getAttribute('href'), 'https://example.org/public-case')
  assert.equal(await initial.getByRole('link').first().getAttribute('rel'), 'noopener noreferrer')
  await initial.getByRole('button', { name: '在资料中查看', exact: true }).click()
  await final.getByRole('button', { name: '[来源1] 案例：合成管网分段实施', exact: true }).click()
  assert.equal(await final.getByText(finalQuote, { exact: true }).first().isVisible(), true)
  assert.match(await final.innerText(), /引用定位 page:2/)
  assert.equal(await final.getByText(publicQuote, { exact: true }).count(), 0)
  await final.getByText('对应原始文档 · 1', { exact: true }).click()
  assert.match(await final.innerText(), /文档来源 · D-FINAL[\s\S]*材料版本 document-version-final/)
  await final.getByRole('button', { name: '[来源2] 合成出资核查记录', exact: true }).click()
  assert.equal(await final.getByText('合成核查：未见出资书面承诺。', { exact: true }).isVisible(), true)
  assert.match(await final.innerText(), /程序条件来源 \/ 正文/)
  assert.doesNotMatch(await final.innerText(), /引用定位|section:funding|experience:/)
  await final.getByRole('button', { name: '查看程序条件来源', exact: true }).click()
  const first = report.getByRole('article', { name: '举措建议 1：管网改造' }), second = report.getByRole('article', { name: '举措建议 2：长效维护' }), third = report.getByRole('article', { name: '举措建议 3：资金核实' })
  for (const [index, region, title, quote] of [[1, first, '案例：合成管网分段实施', publicQuote], [2, second, '规则：合成维护计划', internalQuote], [3, third, '合成脚本地址来源', unsafeQuote]]) {
    const refs = region.getByRole('group', { name: `建议 ${index} 的依据` })
    await refs.getByRole('button', { name: `[来源1] ${title}`, exact: true }).click()
    assert.equal(await refs.getByText(quote, { exact: true }).first().isVisible(), true)
    assert.match(await refs.innerText(), /引用定位 line:1/)
    await refs.getByRole('button', { name: '在资料中查看', exact: true }).click()
  }
  const internal = second.getByRole('group', { name: '建议 2 的依据' })
  await internal.getByText('对应原始文档 · 1', { exact: true }).click()
  assert.match(await internal.innerText(), /内部文档来源 · D-INTERNAL/)
  assert.equal(await internal.getByRole('link').count(), 0)
  const unsafe = third.getByRole('group', { name: '建议 3 的依据' })
  await unsafe.getByText('对应原始文档 · 1', { exact: true }).click()
  assert.equal(await unsafe.getByRole('link').count(), 0)
  assert.equal(await unsafe.locator('img,script').count(), 0)
  assert.equal(await page.evaluate(() => window.__scriptExecuted), false)
  await unsafe.getByRole('button', { name: '[来源2] S-NOT-RETURNED', exact: true }).click()
  assert.match(await unsafe.innerText(), /当前结果未附带该来源/)
  assert.equal(await unsafe.getByRole('button', { name: '在资料中查看', exact: true }).isDisabled(), true)
  await first.getByText('查看引用的案例与条件 · 1', { exact: true }).click()
  assert.match(await first.innerText(), /合成管网分段实施 v2 · 案例 · 适用命中/)
  assert.match(await first.innerText(), /居民协商完成[\s\S]*consultation_completed/)
  await first.getByText('条件原文引用 · 1', { exact: true }).click()
  assert.match(await first.innerText(), /文档来源 · D-ONE/)
  await first.getByRole('button', { name: '查看条件来源', exact: true }).click()
  await third.getByText('查看引用的案例与条件 · 1', { exact: true }).click()
  assert.match(await third.innerText(), /候选待核/)
  assert.equal(await third.getByText('未知', { exact: true }).isVisible(), true)
  await report.getByText('证据与判断分歧 · 1', { exact: true }).click()
  assert.match(await report.innerText(), /合成材料对维护范围的记载尚不一致/)
  const navigations = JSON.parse(await page.getByLabel('资料导航记录').innerText())
  assert.deepEqual(navigations, [['S-KB-CASE-R2'], ['S-GUARD'], ['S-KB-CASE-R2'], ['S-KB-RULE-R3'], ['S-KB-BAD-R1'], ['S-KB-CASE-R2']])
  await page.getByRole('button', { name: '旧报告模式', exact: true }).click()
  await final.getByRole('button', { name: '[来源1] 案例：合成管网分段实施', exact: true }).click()
  assert.equal(await final.getByText(publicQuote, { exact: true }).first().isVisible(), true)
  assert.match(await final.innerText(), /引用定位 line:1/)
  assert.equal(await final.getByRole('button', { name: /合成维护计划/ }).count(), 0)
  await page.getByRole('button', { name: '明确无最终引文', exact: true }).click()
  await final.getByRole('button', { name: '[来源2] 案例：合成管网分段实施', exact: true }).click()
  assert.match(await final.innerText(), /程序条件来源 \/ 正文/)
  assert.doesNotMatch(await final.innerText(), /引用定位|experience:/)
  assert.equal(await final.getByText(publicQuote, { exact: true }).first().isVisible(), false)
  await page.getByRole('button', { name: '新报告模式', exact: true }).click()
  await final.getByRole('button', { name: '[来源1] 案例：合成管网分段实施', exact: true }).click()
  assert.equal(await final.getByText(finalQuote, { exact: true }).first().isVisible(), true)
  await mkdir('output/playwright', { recursive: true })
  await page.screenshot({ path: 'output/playwright/knowledge-agent-report-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  const viewport = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }))
  assert.ok(viewport.scroll <= viewport.width + 1, `Mobile overflow: ${JSON.stringify(viewport)}`)
  assert.deepEqual(errors, []); assert.deepEqual(requests, [])
  assert.equal(await page.evaluate(() => window.__scriptExecuted), false)
  await page.screenshot({ path: 'output/playwright/knowledge-agent-report-mobile.png', fullPage: true })
  console.log('PASS knowledge agent report synthetic: per-advice + decision/final citations, verified final quote/locator and original doc, absent-vs-empty legacy fallback + guard source/body distinction, KB vs original doc/version/hash, multiple original matches, internal without URL, script URL + markup inert, missing source, hit/candidate condition mapping and evidence navigation, program guard, 390px layout; network/model calls = 0')
} finally { await browser.close() }
