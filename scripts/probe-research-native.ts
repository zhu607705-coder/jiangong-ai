import 'dotenv/config'
import {randomUUID} from 'node:crypto'
import {writeFile,mkdir} from 'node:fs/promises'
import {dirname} from 'node:path'
import {LiveSession} from '../runtime/dsh/live-session'
import {runRenewalResearch} from '../runtime/workflows/renewal-research'
const output=process.argv[2]||'research/test_results/research-native-tools-probe-20261017.json',started=Date.now()
let live:LiveSession|undefined
try{
 live=await LiveSession.open('MAP-AI-STRATEGY-PROTOCOL-'+randomUUID(),AbortSignal.timeout(180000))
 const result=await runRenewalResearch(live,[{id:'PROTOCOL-SYNTHETIC',title:'隔离协议样本 · 无真实项目观测',text:'这是合成协议测试材料，本轮没有真实结构鉴定、居民问卷或工程预算。请保留资料缺项，提出可验证的条件建议。',url:null,published_at:null,role:'reference',locator:'synthetic:protocol:1',data_class:'synthetic',visibility:'public'}],{projectName:'隔离协议测试样本',signal:AbortSignal.timeout(180000),deadlineAt:Date.now()+300000,reusePlan:{summary:'仅测试一个专家的原生受限工具与条件推理。',tasks:[{id:'protocol-engineer',role:'building_delivery',question:'先检索不存在的结构鉴定，若无匹配仍形成有假设和核实办法的建议；缺项可请求宿主补查，不能编造事实。',source_ids:['PROTOCOL-SYNTHETIC'],question_ids:['engineering']}]}})
 const receipt={checked_at:new Date().toISOString(),status:result.notes.length?'completed':'provider_or_protocol_failed',scope:'Synthetic protocol probe only; no existing project, no real decision-quality claim.',elapsed_ms:Date.now()-started,native_model_calls:live.calls,notes:result.notes,trace:result.trace,investigation_requests:result.investigation_requests,project_writes:0,tool_cleanup_count:live.ctx.tools.schemas().length}
 await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify({status:receipt.status,elapsed_ms:receipt.elapsed_ms,notes:receipt.notes.length,model_calls:live.calls.length,project_writes:0}))
}catch(error){await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify({checked_at:new Date().toISOString(),status:'blocked_external',error:error instanceof Error?error.name:'Error',calls:live?.calls||[],project_writes:0},null,2)+'\n');console.log(JSON.stringify({status:'blocked_external',project_writes:0}))}
finally{await live?.close()}
