import 'dotenv/config'
import {createHash} from 'node:crypto'
import {mkdir,writeFile} from 'node:fs/promises'
import {dirname} from 'node:path'
import {Context} from '@deepseek-ai/cordis'
import {mountPublicWeb} from '../runtime/dsh/public-web'
import cases from '../data/public_cases/renewal-case-cards-20261017.json'
const output=process.argv[2]||'research/test_results/case-source-live-20261017.json',ctx=new Context()
const normalize=(text:string)=>text.normalize('NFKC').replace(/\s+/g,''),receipts:any[]=[],started=Date.now()
try{
 const web=await mountPublicWeb(ctx,{provider:'deepseek_content',maxSearchUses:1})
 const urls=[...new Set(cases.cases.map(row=>row.url))]
 for(let i=0;i<urls.length;i+=2)await Promise.all(urls.slice(i,i+2).map(async url=>{
  const related=cases.cases.filter(row=>row.url===url),began=Date.now()
  try{const response=await ctx.web.fetch({url},AbortSignal.timeout(45000)),body=response.body as {kind:string;content?:string},text=body.content||''
   const result={url,http_status:response.statusCode,representation_kind:body.kind,representation_sha256:createHash('sha256').update(text).digest('hex'),elapsed_ms:Date.now()-began,checks:related.map(row=>({case_id:row.id,quote_found:normalize(text).includes(normalize(row.source_quote))}))}
   receipts.push(result);console.log(JSON.stringify({url,status:result.http_status,matched:result.checks.every(row=>row.quote_found)}))
  }catch(error){receipts.push({url,status:'provider_unavailable',elapsed_ms:Date.now()-began,checked_by:'Primary web excerpts were separately read during curation',error:error instanceof Error?error.name:'Error'})}
 }))
 await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify({checked_at:new Date().toISOString(),elapsed_ms:Date.now()-started,scope:'Read-only public source/quote protocol check; no project writes or business effectiveness labels.',receipts,web_calls:web.receipts},null,2)+'\n')
}finally{await ctx.fiber.dispose()}
