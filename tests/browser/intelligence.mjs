// Desktop DOM integration with explicit synthetic responses; never calls real providers.
import {chromium} from '@playwright/test'
import {build} from 'esbuild'
import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
const built=await build({stdin:{contents:"import React from 'react';import{createRoot}from'react-dom/client';import Panel from './apps/workspace/src/intelligence/IntelligencePanel';import './apps/workspace/src/style.css';import './apps/workspace/src/maps/map.css';createRoot(document.getElementById('root')).render(<div className='map-shell'><aside className='map-data-panel glass-panel'><h2>项目与数据</h2><Panel onOpenProject={()=>{}}/></aside></div>)",resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,outfile:'intel.js',format:'iife',platform:'browser',define:{'process.env.NODE_ENV':'"production"'}})
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox']})
const page=await browser.newPage({viewport:{width:1440,height:960}}),errors=[],calls=[]
page.on('pageerror',e=>errors.push(String(e)))
const item={id:'DOC-fixture',version:'a'.repeat(64),title:'合成回归样本：旧厂房消防改造采购',url:'https://example.org/synthetic',category:'procurement',city:'杭州',status:'ready',summary:'仅用于界面测试，不代表实际项目。',score:76,published_at:'2026-09-20',event_id:'E1',story_id:'F1',dimensions:['adaptation'],can_attach:true,excerpt:'合成回归样本原文：旧厂房消防改造采购。'}
await page.exposeFunction('__api',async(path,body)=>{calls.push({path,body});
 if(path.includes('/search?'))return {items:[{id:'E1',representative:item,items:[item],source_channels:1,momentum:{participants:1,heat:0}}],truncated:false}
 if(path.endsWith('/status'))return {database:{documents:1,versions:1,pending:0},selection_threshold:65,daily_model_budget:40,model_configured:true,decision_enabled:true,collection_enabled:false,channels:[],jobs:[]}
 if(path.endsWith('/projects'))return [{id:'P1',name:'合成测试项目',input_hash:'hash'}]
 if(path.includes('/items/')&&!path.endsWith('/attach'))return item
 if(path.endsWith('/reviews')||path.endsWith('/attach'))return {ok:true}
 if(path.includes('/evaluation'))return {summary:{n:1,evaluated:1,errors:0,precision:1,recall:1}}
 throw Error('Unexpected fixture '+path)
})
try{
 await mkdir('output/playwright',{recursive:true})
 await page.setContent('<html lang="zh-CN"><head><style>'+built.outputFiles.find(f=>f.path.endsWith('.css')).text+'</style></head><body><div id="root"></div></body></html>')
 await page.evaluate(()=>{window.fetch=async(path,opts={})=>new Response(JSON.stringify(await window.__api(path,opts.body?JSON.parse(opts.body):null)),{headers:{'content-type':'application/json'}})})
 await page.addScriptTag({content:built.outputFiles.find(f=>f.path.endsWith('.js')).text})
 await page.getByRole('button',{name:item.title,exact:true}).click()
 await page.getByText(item.excerpt,{exact:true}).waitFor()
 assert.equal(calls.filter(c=>c.path.endsWith('/analyze')||c.path.endsWith('/collect')).length,0)
 await page.getByLabel('加入研究项目',{exact:true}).selectOption('P1');await page.getByRole('button',{name:'加入原文',exact:true}).click()
 await page.getByText('已加入原文；未自动创建事实或启动研判。',{exact:true}).waitFor()
 assert.equal(calls.find(c=>c.path.endsWith('/attach')).body.expected_input_hash,'hash')
 await page.getByText('记录分类与入选反馈',{exact:true}).click()
 await page.getByLabel('样本用途',{exact:true}).selectOption('train')
 await page.getByLabel('核对说明',{exact:true}).fill('这是合成回归界面测试。')
 assert.equal(await page.getByRole('button',{name:'值得保留',exact:true}).isDisabled(),true)
 await page.getByLabel('用途授权',{exact:true}).fill('synthetic-test-only')
 await page.getByRole('button',{name:'值得保留',exact:true}).click()
 await page.getByText('人工反馈已保存；没有启动训练。',{exact:true}).waitFor()
 assert.equal(calls.find(c=>c.path.endsWith('/reviews')).body.split,'train')
 assert.equal(calls.find(c=>c.path.endsWith('/reviews')).body.allowed_use,'local_sft')
 await page.locator('.map-data-panel').evaluate(el=>el.scrollTop=0)
 await page.screenshot({path:'output/playwright/intelligence-desktop-detail.png'})
 await page.getByRole('button',{name:'校准',exact:true}).click();await page.getByRole('button',{name:'查看评测',exact:true}).click()
 await page.getByText('100.0% / 100.0%',{exact:true}).waitFor()
 assert.deepEqual(errors,[])
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
 await writeFile('output/playwright/intelligence-desktop-check.json',JSON.stringify({passed:true,scope:'synthetic browser UI; API boundary mocked',assertions:8,errors},null,2))
 console.log('PASS intelligence desktop: source detail, explicit attach, no eager calls, training permission, evaluation (8 assertions)')
}finally{await browser.close()}
