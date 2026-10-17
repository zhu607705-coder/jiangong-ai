import 'dotenv/config'
import {writeFile,mkdir} from 'node:fs/promises'
import {dirname} from 'node:path'
import {collectSelectedEvidence} from '../services/capabilities/research'
import {latencySummary} from '../packages/decision/evaluation'
import {resolveAnswerSlots} from '../packages/retrofit/research-coverage'
const output=process.argv[2]||'research/test_results/research-api-provider-comparison-20261017.json'
const cases=[{id:'hz-jianggong',name:'杭州 建工新村',city:'杭州市',queries:['杭州 建工新村 机电配套 交易公告','杭州 建工新村 雨棚 改造 交易公告','杭州 建工新村 消防通道 改造 成交公告'],question:'机电配套、雨棚、消防通道的金额、阶段与资金来源'}]
const results:any[]=[]
const selected=(process.env.RESEARCH_BENCHMARK_PROVIDERS||'legacy,deepseek_tools,deepseek_content').split(',') as ('legacy'|'deepseek_tools'|'deepseek_content')[]
for(const provider of selected)for(const item of cases){
 const began=Date.now(),calls:any[]=[]
 try{
  const result=await collectSelectedEvidence({name:item.name,city:item.city,purpose:'公开来源接口对照',asOf:new Date().toISOString(),provider,intelligence:false,forceDiscovery:true,budget:{newEvidence:4,refresh:0},onWebCall:async value=>{const at=calls.findIndex(row=>row.id===value.id);if(at<0)calls.push(value);else calls[at]=value}},AbortSignal.timeout(120000),undefined,undefined,item.queries)
  const sources=result.sources.filter(source=>source.untrusted_text&&source.content_status!=='metadata_only')
  if(process.env.RESEARCH_BENCHMARK_CAPTURE){await mkdir('.cache',{recursive:true});await writeFile('.cache/frozen-public-evidence-20261017.json',JSON.stringify({captured_at:new Date().toISOString(),provider,sources},null,2))}
  const coverage=resolveAnswerSlots(item.question,sources.map(source=>({id:source.id,title:source.title,text:source.untrusted_text!,url:source.url||null,published_at:source.published_at||null,role:'reference',locator:source.locator||'source:captured'})))
  results.push({provider,case_id:item.id,status:sources.length?'completed':'no_evidence',elapsed_ms:Date.now()-began,queries:item.queries,source_count:sources.length,paragraph_characters:sources.reduce((sum,source)=>sum+source.untrusted_text!.length,0),table_like_sources:sources.filter(source=>/\|.*\|/.test(source.untrusted_text!)).length,reference_field_coverage:{slots:coverage.slots.length,covered:coverage.slots.length-coverage.missing,conflicting:coverage.conflicting},sources:sources.map(source=>({id:source.id,url:source.url,title:source.title,version:source.hash,representation_id:source.representation_id,representation_kinds:source.representations?.map(row=>row.kind),date_status:source.date_status})),call_latency:latencySummary(calls.filter(call=>call.outcome!=='in_flight').map(call=>call.duration_ms)),known_expected_tool_cost_cny:calls.reduce((sum,call)=>sum+(call.estimated_cny||0),0),unknown_charge_calls:calls.filter(call=>call.billing_state==='unknown').length,calls,warnings:result.trace.warnings})
 }catch(error){results.push({provider,case_id:item.id,status:'blocked_external',elapsed_ms:Date.now()-began,error:error instanceof Error?error.name:'Error',calls,unknown_charge_calls:calls.filter(call=>call.billing_state==='unknown').length})}
 await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify({checked_at:new Date().toISOString(),scope:'Fixed public queries, same acquisition budget, no project database or model judgement labels. Small protocol/coverage experiment, not non-inferiority evidence.',model_token_cost:'not included; legacy search uses model turns and may have unknown token fees',results},null,2)+'\n')
 console.log(JSON.stringify({provider,status:results.at(-1).status,elapsed_ms:results.at(-1).elapsed_ms,sources:results.at(-1).source_count||0}))
}
