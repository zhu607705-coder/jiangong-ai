import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'

const root=path.resolve(import.meta.dirname,'..')
const lock=JSON.parse(await readFile(path.join(root,'research/aihot.upstream.lock.json'),'utf8')) as {upstream:{ref:string};targets:{path:string;sha256:string}[];runtime_edges:{caller:string;contains:string}[]}
let failed=false
for(const target of lock.targets){
  const actual=createHash('sha256').update(await readFile(path.join(root,target.path))).digest('hex')
  const ok=actual===target.sha256;failed ||= !ok
  console.log(JSON.stringify({path:target.path,sha256:actual,status:ok?'hash_matches':'changed_since_review'}))
}
for(const edge of lock.runtime_edges){
  const present=(await readFile(path.join(root,edge.caller),'utf8')).includes(edge.contains)
  failed ||= !present;console.log(JSON.stringify({...edge,status:present?'static_reference_present':'missing_reference'}))
}
console.log(JSON.stringify({upstream:lock.upstream.ref,scope:'static_source_and_import_audit_only',live_execution_verified:false}))
process.exitCode=failed?1:0
