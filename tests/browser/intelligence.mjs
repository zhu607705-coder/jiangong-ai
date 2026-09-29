// Desktop/mobile DOM integration with synthetic responses; never calls real providers.
import {chromium} from '@playwright/test'
import {build} from 'esbuild'
import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
const built=await build({stdin:{contents:"import React from 'react';import{createRoot}from'react-dom/client';import Panel from './apps/workspace/src/intelligence/IntelligencePanel';import './apps/workspace/src/style.css';import './apps/workspace/src/maps/map.css';createRoot(document.getElementById('root')).render(<div className='map-shell'><aside className='map-data-panel glass-panel'><h2>项目与数据</h2><Panel onOpenProject={()=>{}}/></aside></div>)",resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,outfile:'intel.js',format:'iife',platform:'browser',define:{'process.env.NODE_ENV':'"production"'}})
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox']})
const page=await browser.newPage({viewport:{width:1440,height:960}}),errors=[],calls=[]
page.on('pageerror',e=>errors.push(String(e)))
let assertions=0
const equal=(a,b)=>{assert.deepEqual(a,b);assertions++}
const displayTitle='合成回归样本：旧厂房消防改造竞争性磋商公告'
const trailer='_中国政府采购网-中华人民共和国财政部唯一指定政府采购信息网络发布媒体'
const item={id:'DOC-fixture',version:'a'.repeat(64),title:displayTitle+trailer,url:'https://www.ccgp.gov.cn/cggg/zygg/jzxcs/202607/t20260714_fixture.htm',category:'procurement',city:'代理机构测试城市',status:'ready',summary:'仅用于界面测试，不代表实际项目。',score:80,published_at:'2026-07-14',event_id:'E1',story_id:'F1',dimensions:['adaptation'],can_attach:true,excerpt:'合成回归样本原文：旧厂房消防改造采购。',analysis:{status:'ready',scores:[78,82],structure:{locator_quote:'合成分类引文：采购范围为旧厂房消防改造。'}}}
const examples=[item,...[
 ['样例：大厅改造成交结果公告','cjgg'],['样例：景观公开招标公告','gkzb'],
 ['样例：宿舍改造更正公告','gzgg'],['样例：设备服务合同公告',''],
 ['样例：维护采购意向公开',''],['样例：中标候选人公示',''],['样例：工程终止公告',''],
].map(([title,code],i)=>({...item,id:'DOC-'+i,event_id:'E'+(i+2),story_id:'F'+(i+2),title:title+trailer,url:code?`https://www.ccgp.gov.cn/cggg/zygg/${code}/202607/fixture-${i}.htm`:`https://www.ccgp.gov.cn/fixture-${i}.htm`,status:'unscored',score:null,analysis:undefined}))]
await page.exposeFunction('__api',async(path,body)=>{calls.push({path,body});
 if(path.includes('/search?'))return {items:examples.map(i=>({id:i.event_id,representative:i,items:[i],source_channels:1,momentum:{participants:1,heat:0}})),truncated:false}
 if(path.endsWith('/status'))return {database:{documents:8,versions:8,pending:7},selection_threshold:65,daily_model_budget:40,model_configured:true,decision_enabled:true,collection_enabled:false,channels:[],jobs:[]}
 if(path.endsWith('/projects'))return [{id:'P1',name:'合成测试项目',input_hash:'hash'}]
 if(path.includes('/items/')&&!path.endsWith('/attach'))return examples.find(i=>path.includes(i.id+'?'))||item
 if(path.endsWith('/reviews')||path.endsWith('/attach'))return {ok:true}
 if(path.includes('/evaluation'))return {summary:{n:1,evaluated:1,errors:0,precision:1,recall:1}}
 throw Error('Unexpected fixture '+path)
})
try{
 await mkdir('output/playwright',{recursive:true})
 await page.setContent('<html lang="zh-CN"><head><style>'+built.outputFiles.find(f=>f.path.endsWith('.css')).text+'</style></head><body><div id="root"></div></body></html>')
 await page.evaluate(()=>{window.fetch=async(path,opts={})=>new Response(JSON.stringify(await window.__api(path,opts.body?JSON.parse(opts.body):null)),{headers:{'content-type':'application/json'}})})
 await page.addScriptTag({content:built.outputFiles.find(f=>f.path.endsWith('.js')).text})
 await page.getByRole('button',{name:displayTitle,exact:true}).waitFor()
 equal(await page.locator('.intel-result').count(),8)
 equal(await page.locator('.intel-reading-title').first().innerText(),displayTitle)
 equal(await page.locator('.intel-reading-title').first().getAttribute('title'),item.title)
 const listText=await page.locator('.intel-panel').innerText()
 equal(listText.includes('唯一指定'),false)
 equal(listText.includes(item.city),false)
 equal(listText.includes('成交结果'),true)
 equal(listText.includes('候选人公示'),true)
 equal(listText.includes('AI 待分类'),true)
 equal(/当前可投|招标中|已竣工/.test(listText),false)
 await page.screenshot({path:'output/playwright/intelligence-reading-list.png'})
 await page.getByRole('button',{name:displayTitle,exact:true}).click()
 await page.getByText(item.excerpt,{exact:true}).waitFor()
 await page.getByText(item.analysis.structure.locator_quote,{exact:true}).waitFor()
 equal(await page.locator('.intel-reading-score>strong').innerText(),'80 / 100')
 equal(await page.locator('.intel-reading-score-runs').innerText(),'两次评分：78 / 82')
 equal((await page.locator('.intel-reading-evidence').innerText()).includes('评分依据'),false)
 equal(await page.getByRole('link',{name:'查看原始来源',exact:true}).getAttribute('href'),item.url)
 await page.getByText('原始标题',{exact:true}).click()
 equal(await page.locator('.intel-original-title p').innerText(),item.title)
 equal(calls.filter(c=>c.path.endsWith('/analyze')||c.path.endsWith('/collect')).length,0)
 await page.getByLabel('加入研究项目',{exact:true}).selectOption('P1');await page.getByRole('button',{name:'加入原文',exact:true}).click()
 await page.getByText('已加入原文；未自动创建事实或启动研判。',{exact:true}).waitFor()
 equal(calls.find(c=>c.path.endsWith('/attach')).body.expected_input_hash,'hash')
 equal(calls.find(c=>c.path.endsWith('/attach')).body.version,item.version)
 await page.getByText('记录分类与入选反馈',{exact:true}).click()
 await page.getByLabel('样本用途',{exact:true}).selectOption('train')
 await page.getByLabel('核对说明',{exact:true}).fill('这是合成回归界面测试。')
 equal(await page.getByRole('button',{name:'值得保留',exact:true}).isDisabled(),true)
 await page.getByLabel('用途授权',{exact:true}).fill('synthetic-test-only')
 await page.getByRole('button',{name:'值得保留',exact:true}).click()
 await page.getByText('人工反馈已保存；没有启动训练。',{exact:true}).waitFor()
 equal(calls.find(c=>c.path.endsWith('/reviews')).body.split,'train')
 equal(calls.find(c=>c.path.endsWith('/reviews')).body.allowed_use,'local_sft')
 await page.locator('.map-data-panel').evaluate(el=>el.scrollTop=0)
 await page.screenshot({path:'output/playwright/intelligence-desktop-detail.png'})
 await page.getByRole('button',{name:'校准',exact:true}).click();await page.getByRole('button',{name:'查看评测',exact:true}).click()
 await page.getByText('100.0% / 100.0%',{exact:true}).waitFor()
 equal(errors,[])
 equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
 await page.getByRole('button',{name:'检索',exact:true}).click()
 await page.setViewportSize({width:390,height:844})
 await page.locator('.map-data-panel').evaluate(el=>el.scrollTop=0)
 equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
 await page.getByRole('button',{name:'样例：大厅改造成交结果公告',exact:true}).click()
 equal(await page.locator('.intel-reading-evidence').count(),0)
 equal(await page.locator('.intel-reading-meta strong').innerText(),'成交结果')
 await page.getByRole('button',{name:'返回检索结果',exact:true}).click()
 await page.screenshot({path:'output/playwright/intelligence-reading-mobile.png'})
 equal(calls.filter(c=>c.path.endsWith('/analyze')||c.path.endsWith('/collect')).length,0)
 equal(errors,[])
 await writeFile('output/playwright/intelligence-desktop-check.json',JSON.stringify({passed:true,scope:'synthetic browser UI; API boundary mocked; no external requests',assertions,errors},null,2))
 console.log(`PASS intelligence desktop/mobile: ${assertions} assertions`)
}finally{await browser.close()}
