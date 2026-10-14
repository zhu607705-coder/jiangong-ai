import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import type { RetrievalResponse } from '../packages/experience/retrieval'
const id=process.argv[2]; assert(id,'Supply an existing owner-authorized project ID')
const root='http://127.0.0.1:4310/api'
const session=await fetch(root+'/session');assert.equal(session.status,200)
const cookie=session.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ')
async function read(path:string,body?:unknown){
 const response=await fetch(root+path,{method:body===undefined?'GET':'POST',headers:{Cookie:cookie,'Content-Type':'application/json','X-Requested-With':'haizhizi'},...(body===undefined?{}:{body:JSON.stringify(body)})})
 const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));return result
}
const before=await read(`/projects/${id}`)
const base={question:'二次供水改造涉及哪些楼栋和户数，哪些楼栋被排除？',measure_key:'pipe_network',limit:5}
const publicResult:RetrievalResponse=await read(`/projects/${id}/knowledge/retrieve`,base)
assert(publicResult.hits.length>0,'Expected real primary source text')
assert(publicResult.hits.every(hit=>hit.source_kind==='public_original'))
assert(publicResult.hits.some(hit=>hit.text.includes('252')||hit.text.includes('不纳入')))
assert(publicResult.skipped.some(skip=>skip.code==='GENERATED_SOURCE_EXCLUDED'))
const aiResult:RetrievalResponse=await read(`/projects/${id}/knowledge/retrieve`,{...base,source_kind:'ai_draft',include_ai:true})
assert(aiResult.hits.length>0,'Expected explicitly included AI draft mentions')
assert(aiResult.hits.every(hit=>hit.source_kind==='ai_draft'))
const earlier:RetrievalResponse=await read(`/projects/${id}/knowledge/retrieve`,{...base,as_of:'2020-01-01'})
assert.equal(earlier.hits.length,0)
assert(earlier.skipped.some(skip=>['SOURCE_AFTER_AS_OF','SOURCE_DATE_UNKNOWN'].includes(skip.code)))
const after=await read(`/projects/${id}`)
assert.deepEqual(after.input,before.input);assert.equal(after.context_version,before.context_version)
const receipt={as_of:'2026-10-14',scope:'real local authenticated read-only endpoint with the existing Python BM25; no LLM',project:id,
 queries:[{request:base,result:publicResult},{request:{...base,source_kind:'ai_draft',include_ai:true},result:aiResult},{request:{...base,as_of:'2020-01-01'},result:earlier}],project_input_unchanged:true,fact_writes:0,assertions:'public source separation, exact location/version, AI explicit browsing, prior-date exclusion, no project mutations'}
await writeFile('research/test_results/rag-workspace-live.json',JSON.stringify(receipt,null,2)+'\n')
process.stdout.write(JSON.stringify({public_hits:publicResult.hits.length,public_text:publicResult.hits.map(hit=>hit.text.slice(0,200)),ai_hits:aiResult.hits.length,earlier_hits:earlier.hits.length,unchanged:true})+'\n')
