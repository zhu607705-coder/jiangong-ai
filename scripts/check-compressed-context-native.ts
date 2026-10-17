/** Isolated synthetic protocol probe; never reads or runs a real project. */
import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import {LiveSession} from '../runtime/dsh/live-session'
import {packEvidenceContext} from '../packages/retrofit/evidence-compression'
import type {RenewalResearchNote} from '../apps/host/generated/contracts'
const snippets=['预算100万元；中标95万元；资金尚未到账。','未经结构鉴定不得开工，方案仅在保留结构前提下适用。'],starts=[200,900],sources=snippets.map((text,i)=>({source_id:'s'+(i+1),start_char:starts[i],end_char:starts[i]+text.length,text}))
const context=packEvidenceContext({evidence_windows:sources,untrusted_expert_notes:[{task_id:'synthetic',summary:'甲专家建议保留；乙专家认为仍应先鉴定。',missing_data:['逐栋鉴定'],reasoned_proposals:[{kind:'scenario',premises:['鉴定未取得'],assumptions:['保留结构'],parameters:[{name:'暂估费用',value:95,low:80,high:110,unit:'万元'}],verification:'取得鉴定与结算后再核'}]}]})
const prompt='隔离合成协议测试。输入按source_id分组，rows按columns为[start_char,text]，end_char=start_char+text的UTF-16长度；不跨行拼接。请以RenewalResearchNote返回task_id=synthetic，observations恰好两条，按s1/s2分别逐字复制各行text为quote，locator使用utf16:起点-终点。summary保留不同意见；inference区分预算、中标、到账与结构前提；reasoned_proposals保留情景假设及参数范围；missing_data保留鉴定。\n'+JSON.stringify(context)
const live=await LiveSession.open('COMPRESSION-PROTOCOL-'+Date.now(),AbortSignal.timeout(120000)),started=Date.now()
try{
 const result=await live.call<RenewalResearchNote>('compressed_context_probe',prompt,'RenewalResearchNote',[],['s1','s2'],{},undefined,{maxOutputTokens:3000})
 assert.equal(result.value.observations.length,2)
 for(const [i,text] of snippets.entries()){const observation=result.value.observations.find(o=>o.source_id==='s'+(i+1));assert.equal(observation?.quote,text);assert(observation?.locator.includes(String(starts[i])))}
 const parameter=result.value.reasoned_proposals?.flatMap(p=>p.parameters||[]).find(p=>p.value===95);assert(parameter);assert.equal(parameter.low,80);assert.equal(parameter.high,110)
 const receipt={checked_at:new Date().toISOString(),scope:'synthetic_protocol_not_decision_quality',status:'passed',duration_ms:Date.now()-started,calls:live.calls,session_id:result.sessionId,output:result.value,real_projects_run:0}
 await mkdir('research/test_results',{recursive:true});await writeFile('research/test_results/context-compression-native-20261017.json',JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify({status:receipt.status,duration_ms:receipt.duration_ms,model_calls:live.calls.length,exact_quotes:2,parameter_bounds_preserved:true,real_projects_run:0}))
}finally{await live.close()}
