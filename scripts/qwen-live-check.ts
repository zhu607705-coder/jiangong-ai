import 'dotenv/config'
import { randomUUID } from 'node:crypto'
import { mkdir,writeFile } from 'node:fs/promises'
import { LiveSession } from '../runtime/dsh/live-session'
import { evaluateDecision } from '../services/capabilities/decision-model'
import { FACTOR_LABELS } from '../packages/maps/decision-factors'
import type { MapDecisionFactor } from '../apps/host/generated/contracts'
const base=(state:MapDecisionFactor['state'])=>(Object.keys(FACTOR_LABELS) as MapDecisionFactor['key'][]).map(key=>({key,state,summary:FACTOR_LABELS[key]+(state==='supported'?'已有对象和时间对应的核验资料':'缺少对应资料'),evidence_refs:['SYNTHETIC-PROTOCOL-SOURCE'],quote:''}))
const scenarios=[{name:'missing',factors:base('unknown')},{name:'blocked',factors:base('supported').map(f=>f.key==='implementation'?{...f,state:'blocked' as const,summary:'用途条件明确不满足'}:f)},{name:'supported',factors:base('supported')},{name:'conflict',factors:base('supported').map(f=>f.key==='resources'?{...f,state:'conditional' as const,summary:'同一建筑、同一时点的两个资金资料相互矛盾'}:f)}]
const live=await LiveSession.open('QWEN-VERIFY-'+randomUUID(),AbortSignal.timeout(80000)),results=[]
try {
 for(const scenario of scenarios) {
  const result=await live.runReadCapability('decision_'+scenario.name,signal=>evaluateDecision({state:{synthetic:true,as_of:new Date().toISOString(),scope:'同一测试对象，接口与分流行为验收',verified_conditions:scenario.factors},factors:scenario.factors,sourceIds:['SYNTHETIC-PROTOCOL-SOURCE']},signal))
  results.push({case:scenario.name,result});console.log(JSON.stringify({case:scenario.name,status:result.status,model:result.model,raw_action:result.answers?.next_action.choice,action:result.action,confidence:result.answers?.next_action.confidence,error:result.error_code,duration_ms:result.duration_ms}))
 }
 await mkdir('research/test_results',{recursive:true})
 await writeFile('research/test_results/qwen-live-cases.json',JSON.stringify({tested_at:new Date().toISOString(),scope:'synthetic protocol and route behavior, not investment quality evaluation',transport:'DSH ToolRuntime.execute -> Qwen System One',results},null,2)+'\n')
 if(results.some(r=>r.result.status!=='completed')) process.exitCode=1
} finally {await live.close()}
