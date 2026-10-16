import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {spawn} from 'node:child_process'
import {createInterface} from 'node:readline'
import {createHash} from 'node:crypto'
import {performance} from 'node:perf_hooks'
import {projectPython} from './python-runtime'
import {buildRagExport} from '../packages/experience/rag-export'
import {retrieveProjectEvidence,type RetrievalRanker} from '../packages/experience/retrieval'
import type {ProjectRecord} from '../apps/host/store'
import type {ProjectInput} from '../apps/host/generated/contracts'
import type {StrategyPacket} from '../packages/retrofit/strategy'

/** Archived public originals and actual Chinese questions; target labels stay in this harness. */
const archive=JSON.parse(await readFile('data/demos/qiushi-validated-replay.json','utf8')) as {packet:StrategyPacket}
const fixture=JSON.parse(await readFile('fixtures/inputs/01_auto.json','utf8')) as ProjectInput
const sources=archive.packet.sources.filter(source=>source.url&&/^https?:/.test(source.url)&&!source.locator.startsWith('case:')).map(source=>({
  id:source.id,title:source.title,url:source.url!,locator:source.locator,visibility:'public' as const,data_class:'public' as const,synthetic:false,
  untrusted_text:source.text,content_status:'excerpt' as const,hash:createHash('sha256').update(source.text).digest('hex'),...(source.published_at?{published_at:source.published_at}:{}),
}))
const project:ProjectRecord={id:'EVAL-QIUSHI-READONLY',owner_id:'evaluation-only',name:'浙大求是村',context_version:0,created_at:'',updated_at:'',input:{...fixture,project_id:'EVAL-QIUSHI-READONLY',synthetic:false,sources,facts:[],context_rules:[],events:[],scope:{...fixture.scope,name:'浙大求是村',city:'杭州'}}}
const bundle=buildRagExport({projectId:project.id,documents:[],rawDocuments:[],cards:[],sources})
const cases=[
  {question:'二次供水涉及哪些楼栋和户数，哪些楼栋被排除？',title:/推进二次供水/},
  {question:'留博楼为什么没纳入供水改造？',title:/推进二次供水/},
  {question:'75幢1单元加装电梯的意见征求公告在哪里？',title:/75幢1单元.*意见.*公告|公开征求.*75幢1单元/},
  {question:'75幢1单元加电梯预计要花多少钱？',title:/75幢1单元.*官方附件/},
  {question:'求是村拆六建四是哪年的项目？',title:/450工程/},
  {question:'求是村回迁签协议延期的通知是什么？',title:/回迁住户推迟签订协议/},
  {question:'浙工新村自主更新后的选房安排是什么？',title:/选房啦.*首个自主更新/},
  {question:'上海蕃瓜弄回搬涉及多少证，何时选房？',title:/滚地龙.*1122证/},
]
// Same existing Python BM25 implementation for both candidate protocols; no external API.
const python=spawn(projectPython(),['-u','-c',`import sys,json
from services.capabilities.analysis import retrieval_query
for line in sys.stdin:
 try:
  r=json.loads(line);result=retrieval_query(r['project'],r['query'],True,limit=r['limit'])
  print(json.dumps(result,ensure_ascii=False),flush=True)
 except Exception as error:
  print(json.dumps({'error':type(error).__name__}),flush=True)
`],{stdio:['pipe','pipe','pipe'],env:{...process.env,PYTHONIOENCODING:'utf-8'}})
const waiting:{resolve:(value:any)=>void;reject:(error:Error)=>void}[]=[]
let diagnostics=''
python.stderr.on('data',chunk=>{diagnostics+=String(chunk)})
createInterface({input:python.stdout}).on('line',line=>{
  const next=waiting.shift();if(!next)return
  try{const value=JSON.parse(line);if(value.error)next.reject(new Error(value.error));else next.resolve(value)}catch{next.reject(new Error('Invalid local ranker JSON'))}
})
python.on('error',error=>{for(const item of waiting.splice(0))item.reject(error)})
python.on('exit',()=>{for(const item of waiting.splice(0))item.reject(new Error('Local ranker exited'))})
const ranker:RetrievalRanker=(input,query,limit=5)=>new Promise((resolve,reject)=>{waiting.push({resolve,reject});python.stdin.write(JSON.stringify({project:input,query,limit})+'\n')})
type Variant={protocol:'shared_context_recall'|'strict_body_topics';hit:boolean;latency_ms:number;returned:{source_id:string;title:string;version:string;locator:string}[];fact_writes:0}
const rows:{question:string;expected_source_ids:string[];variants:Variant[]}[]=[]
try{
  for(const example of cases){
    const expected=sources.filter(source=>example.title.test(source.title)).map(source=>source.id)
    if(!expected.length)throw new Error('Missing source label for '+example.question)
    const variants:Variant[]=[]
    for(const relaxTopics of [false,true]){
      const start=performance.now(),result=await retrieveProjectEvidence(project,bundle,[],{question:example.question,limit:5},ranker,{relaxTopics})
      variants.push({protocol:relaxTopics?'shared_context_recall':'strict_body_topics',hit:result.hits.some(hit=>expected.includes(hit.source.id)),latency_ms:Math.round(performance.now()-start),returned:result.hits.map(hit=>({source_id:hit.source.id,title:hit.file_name,version:hit.version,locator:hit.locator})),fact_writes:result.fact_writes})
    }
    rows.push({question:example.question,expected_source_ids:expected,variants})
  }
}finally{python.stdin.end()}
const summary=['strict_body_topics','shared_context_recall'].map(protocol=>({protocol,queries:rows.length,source_hit_at_5:rows.filter(row=>row.variants.find(value=>value.protocol===protocol)?.hit).length}))
const output={checked_at:new Date().toISOString(),input:'data/demos/qiushi-validated-replay.json:packet.sources',source_count:sources.length,model_calls:0,fact_writes:0,summary,rows,
  interpretation:'Eight source-location questions over archived public excerpts, with the same local Python BM25. Labels are source IDs in this harness only. This measures source recall, not answer correctness, citation entailment or live API latency; the first timing includes Python startup.',ranker_diagnostics_present:!!diagnostics}
await mkdir('research/test_results',{recursive:true})
await writeFile('research/test_results/research-recovery-retrieval-evaluation-20261016.json',JSON.stringify(output,null,2)+'\n')
console.log(JSON.stringify({summary,model_calls:0,fact_writes:0}))
