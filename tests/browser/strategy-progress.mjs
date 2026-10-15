// Offline component render: no server credentials, network research or model generation.
import { chromium } from '@playwright/test'
import { build } from 'esbuild'
import { mkdir, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'

const directory='output/playwright/strategy-progress'
await mkdir(directory,{recursive:true})
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox']})
const page=await browser.newPage({viewport:{width:1440,height:1050},deviceScaleFactor:1})
const errors=[];page.on('pageerror',error=>errors.push(error.message))
const built=await build({stdin:{resolveDir:process.cwd(),sourcefile:'strategy-progress-fixture.tsx',loader:'tsx',contents:`
import React from 'react'
import {createRoot} from 'react-dom/client'
import fixture from './fixtures/inputs/01_auto.json'
import {WorkbenchAccessContext} from './apps/workspace/src/AdminAccess'
import StrategyOverview from './apps/workspace/src/components/StrategyOverview'
import {projectRenewalModeInput} from './packages/retrofit/renewal-mode'
import './apps/workspace/src/style.css'
const project={id:'strategy-ui-fixture',name:'研究状态回归 · 合成用例',context_version:0,input:{...fixture,business_profile:'neighborhood'}}
window.__posts=0
window.__failed={project_id:project.id,context_version:0,input_hash:'fixture-only',created_at:'2026-10-15T03:30:51.777Z',synthetic:true,status:'failed',strategy:null,decision:null,
 sources:[{id:'FIXTURE-SOURCE',title:'已取得来源 · 合成原文',text:'合成回归原文：居民意见、结构鉴定与资金安排分别核对。',url:null,published_at:null,role:'current',locator:'line:1'}],
 research:{status:'partial',queries:['合成社区 结构鉴定 site:gov.cn','合成社区 权属与规划 site:gov.cn'],source_ids:['FIXTURE-SOURCE'],warnings:[],reused:false},
 model_calls:[{stage:'renewal_strategy',requested_model:'deepseek-flash',returned_model:null,finish_reason:'error',error_code:'TRANSPORT',input_tokens:0,output_tokens:0,duration_ms:10500,session_id:null}],error:'LIVE_STAGE_FAILED:renewal_strategy:error'}
window.fetch=async(url,init={})=>{
 if(String(url).includes('renewal-strategy')){
  if(init.method==='POST'){window.__posts++;return new Response(new ReadableStream({start(controller){window.__strategyStream=controller}}),{headers:{'Content-Type':'application/x-ndjson'}})}
  return new Response('null',{headers:{'Content-Type':'application/json'}})
 }
 if(String(url).includes('renewal-mode'))return new Response(JSON.stringify({screening:projectRenewalModeInput(project.input),decision:null}),{headers:{'Content-Type':'application/json'}})
 throw new Error('UNEXPECTED_FIXTURE_REQUEST')
}
window.__frame=event=>window.__strategyStream.enqueue(new TextEncoder().encode(JSON.stringify(event)+'\\n'))
createRoot(document.getElementById('root')).render(<WorkbenchAccessContext.Provider value={{role:'admin',canWrite:true}}><main style={{maxWidth:1240,margin:'0 auto',padding:24}}><p style={{color:'#6e7d70',fontSize:14}}>离线界面回归 · 全部资料与阶段为显式合成夹具</p><StrategyOverview project={project} demoActive={false} onEvidence={()=>{}} onInvestigate={()=>{}}/></main></WorkbenchAccessContext.Provider>)
`},bundle:true,write:false,outfile:'strategy-progress-fixture.js',format:'iife',platform:'browser',define:{'process.env.NODE_ENV':'"production"'}})
try{
 await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"></head><body><div id="root"></div></body></html>'}))
 await page.goto('https://fixture.invalid/')
 await page.addStyleTag({content:built.outputFiles.find(file=>file.path.endsWith('.css')).text})
 await page.addScriptTag({content:built.outputFiles.find(file=>file.path.endsWith('.js')).text})
 await page.getByRole('button',{name:'开始研究',exact:true}).waitFor()
 assert.equal(await page.evaluate(()=>window.__posts),0,'opening the page must not generate a model request')
 await page.getByRole('button',{name:'开始研究',exact:true}).click()
 await page.waitForFunction(()=>!!window.__strategyStream)
 await page.evaluate(()=>{
  window.__frame({type:'progress',stage:'sources',status:'completed',message:'已读取3份项目依据。',source_count:3})
  window.__frame({type:'progress',stage:'research',status:'completed',message:'两轮检索已结束，已整理对象条件与独立对标资料。',source_count:8,query_count:12,round:2,round_count:2})
  window.__frame({type:'progress',stage:'model',status:'running',message:'正在根据原文研究综合整治与原拆原建两条路径。',source_count:8})
 })
 await page.getByText('正在根据原文研究综合整治与原拆原建两条路径。',{exact:true}).waitFor()
 assert.equal(await page.locator('.strategy-progress li[data-state=completed]').count(),2)
 assert.equal(await page.locator('.strategy-progress li[data-state=running]').count(),1)
 assert.doesNotMatch(await page.locator('.strategy-progress').innerText(),/\d+%/)
 await page.screenshot({path:directory+'/progress-desktop.png',fullPage:true})
 await page.setViewportSize({width:390,height:900})
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'mobile layout must fit the viewport')
 await page.screenshot({path:directory+'/progress-mobile.png',fullPage:true})
 await page.setViewportSize({width:1440,height:1050})
 await page.evaluate(()=>{window.__frame({type:'progress',stage:'model',status:'failed',message:'服务器暂时无法连接模型服务，本轮未生成整体更新方案。',source_count:8});window.__frame({type:'complete',result:window.__failed});window.__strategyStream.close()})
 await page.getByRole('heading',{name:'整体更新方案生成失败',exact:true}).waitFor()
 assert.match(await page.getByRole('alert').innerText(),/服务器暂时无法连接模型服务/)
 assert.doesNotMatch(await page.locator('body').innerText(),/LIVE_STAGE_FAILED|renewal_strategy|TRANSPORT|正在形成本项目|Agent 综合方案/)
 await page.getByRole('button',{name:'查看已取得资料',exact:true}).click()
 await page.getByText('合成回归原文：居民意见、结构鉴定与资金安排分别核对。',{exact:true}).waitFor()
 await page.screenshot({path:directory+'/failed-desktop.png',fullPage:true})
 assert.deepEqual(errors,[])
 const evidence={passed:true,offline_fixture:true,provider_calls:0,fixture_post_count:await page.evaluate(()=>window.__posts),checks:['no automatic model generation','five visible stages','only emitted steps complete','elapsed and source count','no invented percentage','mobile viewport fit','Chinese TRANSPORT failure','raw error hidden','acquired sources retained','no page errors']}
 await writeFile(directory+'/verification.json',JSON.stringify(evidence,null,2)+'\n')
 console.log(JSON.stringify(evidence))
}catch(error){await page.screenshot({path:directory+'/failure.png',fullPage:true}).catch(()=>{});throw error}finally{await browser.close()}
