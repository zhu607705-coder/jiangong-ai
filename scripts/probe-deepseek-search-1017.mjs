/** Isolated public API smoke check. No project, intelligence index or decision result is written. */
import assert from 'node:assert/strict'
import {Context} from '@deepseek-ai/cordis'
import {config} from '../apps/host/config'
import {mountPublicWeb,ensureHarnessNetwork} from '../runtime/dsh/public-web'
import {DeepSeekWebTools} from '../runtime/dsh/deepseek-web-tools'
import {deepSeekModelDescriptor} from '../runtime/dsh/deepseek-catalog'
import {LiveSession} from '../runtime/dsh/live-session'
const signal=AbortSignal.timeout(95000),ctx=new Context(),started=Date.now()
await ensureHarnessNetwork()
try{
 const mounted=await mountPublicWeb(ctx,{maxSearchUses:3})
 assert.equal(mounted.provider,'deepseek_content','Default provider must actually select standalone Search with content reuse')
 const query='杭州 求是村 二次供水 site:zju.edu.cn'
 const at=Date.now(),search=await ctx.web.search({query,maxResults:3},signal)
 assert(search.sources.length>0,'Official search returned no results')
 const searchMs=Date.now()-at,source=search.sources[0],beforeFetch=mounted.receipts.length
 const body=await ctx.web.fetch({url:source.url},signal)
 assert(body.statusCode===200&&body.body.content.trim().length>0)
 const cacheReused=mounted.receipts.length===beforeFetch
 const fetcher=new DeepSeekWebTools({key:()=>process.env.DEEPSEEK_SEARCH_API_KEY||process.env.DEEPSEEK_API_KEY||'',includeContent:false,maxSearchRequests:1})
 const fetchAt=Date.now();let directFetch
 try{const result=await fetcher.fetch({url:'https://api-docs.deepseek.com/zh-cn/guides/search/'},signal);directFetch={status:result.statusCode===200&&result.body.content?'completed':'empty',duration_ms:Date.now()-fetchAt,characters:result.body.content.length,representation:result.representation?.kind}}
 catch(error){directFetch={status:'blocked_external',duration_ms:Date.now()-fetchAt,error:error instanceof Error?error.message:'FETCH_UNAVAILABLE'}}
 const live=await LiveSession.open('DEEPSEEK-1017-PROBE-'+Date.now(),signal)
 let model
 try{const result=await live.call('model_catalog_protocol','独立连通检查，与真实项目无关。请只使用structured_output返回summary="模型接口连通正常"和tasks=[]。','RenewalResearchPlan',[],undefined,{},undefined,{maxOutputTokens:1000});assert.equal(result.value.tasks.length,0);model={status:'completed',descriptor:deepSeekModelDescriptor(config.DEEPSEEK_MODEL),calls:live.calls}}
 finally{await live.close()}
 const receipts=[...mounted.receipts,...fetcher.receipts]
 assert(receipts.some(row=>row.operation==='search'&&row.status===200&&row.outcome==='received'&&!row.fallback),'Must exercise the standalone endpoint, not legacy model search')
 console.log(JSON.stringify({checked_at:new Date().toISOString(),scope:'isolated_public_api_and_model_protocol',search:{provider:mounted.provider,query,result_count:search.sources.length,search_ms:searchMs,first_source:{title:source.title,url:source.url},body_characters:body.body.content.length,search_content_reused:cacheReused},direct_fetch:directFetch,model,web_calls:receipts,estimated_standard_rate_cny:receipts.reduce((sum,r)=>sum+(r.estimated_cny||0),0),unknown_billing_attempts:receipts.filter(r=>r.billing_state==='unknown').length,duration_ms:Date.now()-started,project_writes:0,real_project_runs:0}))
}finally{await ctx.fiber.dispose()}
