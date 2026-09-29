import { mkdir,writeFile } from 'node:fs/promises'
import path from 'node:path'

// Talks to the running host; never opens a second PGlite process.
const [command='status',argument]=process.argv.slice(2)
if(!['status','search','evaluate','export'].includes(command))throw new Error('Use status | search <query> | evaluate | export')
const base='http://127.0.0.1:'+String(Number(process.env.PORT||4310))
const session=await fetch(base+'/api/session',{signal:AbortSignal.timeout(5000)})
if(!session.ok)throw new Error('HOST_SESSION_UNAVAILABLE')
const cookie=session.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ')
const endpoint=command==='search'?'/search?q='+encodeURIComponent(argument||''):command==='evaluate'?'/evaluation?split=development':command==='export'?'/dataset/export':'/status'
const response=await fetch(base+'/api/intelligence'+endpoint,{method:command==='export'?'POST':'GET',headers:{Cookie:cookie,'X-Requested-With':'haizhizi','Content-Type':'application/json'},...(command==='export'?{body:JSON.stringify({purpose:'local_eval'})}:{}),signal:AbortSignal.timeout(15000)})
if(!response.ok)throw new Error('INTELLIGENCE_REQUEST_'+response.status)
const result=await response.json() as {rows?:unknown[]}
if(command==='export'){
  const directory=path.resolve(import.meta.dirname,'../data/local/intelligence/exports')
  await mkdir(directory,{recursive:true})
  const file=path.join(directory,'reviewed-'+Date.now()+'.jsonl')
  await writeFile(file,(result.rows||[]).map(r=>JSON.stringify(r)).join('\n')+'\n',{mode:0o600})
  console.log(JSON.stringify({file,rows:result.rows?.length??0,weight_training_started:false}))
}else console.log(JSON.stringify(result,null,2))
