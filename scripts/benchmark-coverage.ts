import { performance } from 'node:perf_hooks'
import { createHash } from 'node:crypto'
import { buildEvidenceCoverage } from '../apps/workspace/src/imports/evidence-coverage'
import type { Fact, Source } from '../apps/host/generated/contracts'

// Synthetic local computation only. No file corpus, database, provider or model calls.
const source:Source={id:'S-PERF',title:'合成分组性能样本',data_class:'synthetic',visibility:'internal',synthetic:true,content_status:'excerpt',hash:'synthetic-v1',locator:'line:1',untrusted_text:'合成测试原文，不是实际工程确认。',published_at:'2026-09-01'}
const kinds=['resident_needs_confirmed','service_gap_confirmed','engineering_review_passed','scope_and_consent_confirmed','maintenance_confirmed','funding_confirmed']
const cases=[{name:'small',facts:24,objects:8},{name:'many_objects',facts:1000,objects:1000},{name:'shared_scope',facts:1000,objects:500,shared:true}]
const results=[]
for(const scenario of cases){
  const facts:Fact[]=Array.from({length:scenario.facts},(_,i)=>({id:`F-${i}`,kind:`retrofit.${kinds[i%6]}`,value:i%11?true:null,unit:null,source_id:source.id,locator:'line:1',observed_at:'2026-09-01',scope_kind:scenario.shared?'shared':'object',object_ref:`building:B${i%scenario.objects}`,epistemic_status:i%7?'fact':'assumption',...(scenario.shared?{applies_to:[`building:B${i%scenario.objects}`,`building:B${(i+1)%scenario.objects}`]}:{})}))
  const input={projectId:'P-PERF',projectName:'合成分组性能样本',profile:'neighborhood' as const,asOf:'2026-10-04',sources:[source],documents:[],facts}
  buildEvidenceCoverage(input)
  const elapsed:number[]=[];let result
  for(let i=0;i<5;i++){const start=performance.now();result=buildEvidenceCoverage(input);elapsed.push(performance.now()-start)}
  results.push({...scenario,cells:result!.cells.length,runs_ms:elapsed,median_ms:[...elapsed].sort((a,b)=>a-b)[2],output_sha256:createHash('sha256').update(JSON.stringify(result)).digest('hex')})
}
console.log(JSON.stringify({scope:'Synthetic local CPU benchmark; not whole-page or GPU latency',results}))
