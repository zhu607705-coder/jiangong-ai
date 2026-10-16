import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {PGlite} from '@electric-sql/pglite'
import type {Database,ProjectRecord} from '../../apps/host/store'
import type {ProjectInput,Source} from '../../apps/host/generated/contracts'
import fixture from '../../fixtures/inputs/01_auto.json'
import {buildRagExport} from '../../packages/experience/rag-export'
import {HybridRetrievalService,type RagModelPort} from '../../packages/experience/hybrid-retrieval'
import {SemanticIndexRepository,semanticWindows} from '../../packages/experience/semantic-index'
import {prepareRetrievalCandidates,type RetrievalRanker} from '../../packages/experience/retrieval'
import {normalizeImportDocument} from '../../apps/workspace/src/imports/graph-model'
import type {ParsedDocument} from '../../packages/experience/document-slices'
import express from 'express'
import {Store} from '../../apps/host/store'
import {registerRagRetrieval} from '../../apps/host/rag-retrieval'
import type {KnowledgePipelineService} from '../../packages/experience/pipeline'
import {ExperienceError} from '../../packages/experience/errors'
import {validate} from '../../packages/contracts/validate'

let db:PGlite,repository:SemanticIndexRepository
beforeEach(()=>{db=new PGlite();repository=new SemanticIndexRepository(db as unknown as Database)})
afterEach(async()=>{await db.close()})
const source=(id:string,text:string,patch:Partial<Source>={}):Source=>({id,title:id+'原件',visibility:'public',data_class:'public',synthetic:false,untrusted_text:text,content_status:'full_text',hash:'version-'+id,locator:'line:1',...patch})
const project=(sources:Source[],owner='owner'):ProjectRecord=>({id:'HYBRID-A',owner_id:owner,name:'测试社区',context_version:1,created_at:'',updated_at:'',input:{...structuredClone(fixture),project_id:'HYBRID-A',synthetic:false,sources,facts:[],context_rules:[],events:[]} as ProjectInput})
const bundle=(p:ProjectRecord)=>buildRagExport({projectId:p.id,documents:[],rawDocuments:[],cards:[],sources:p.input.sources})
const options=()=>({signal:new AbortController().signal})
it('keeps a valid index summary above 240 characters instead of losing an entire batch',()=>{
  const summary='原文包含分期改造范围、资金承担和维护安排，索引保留范围及否定。'.repeat(12)
  const result={entries:[{source_id:'W-PUBLIC',summary,concepts:['资金承担'],questions:['谁承担改造资金']} ]}
  expect(summary.length).toBeGreaterThan(240)
  expect(validate('RagSemanticIndex',result)).toEqual(result)
})
const keyword:RetrievalRanker=async(p,q)=>({matches:p.sources.filter(row=>q.includes('助餐')&&row.untrusted_text?.includes('助餐')).map(row=>({source_id:row.id,score:1}))})
function model(patch:{badQuote?:boolean;fail?:string}={}) {
  const prompts:string[]=[],types:string[]=[]
  const port:RagModelPort={name:'test-api',calls:()=>types.length,close:vi.fn(async()=>{}),call:async<T>(type:string,prompt:string):Promise<T>=>{
    prompts.push(prompt);types.push(type)
    if(type===patch.fail)throw new Error('FIXTURE_PROVIDER_DOWN')
    if(type==='RagQueryPlan')return {queries:[],concepts:['助餐'],subquestions:['在哪里就餐']} as T
    if(type==='RagSemanticIndex') {
      const windows=JSON.parse(prompt.match(/<untrusted_windows>(.*?)<\/untrusted_windows>/s)![1])
      return {entries:windows.map((row:{source_id:string;text:string})=>({source_id:row.source_id,summary:row.text,concepts:['助餐'],questions:['晚餐去哪里']}))} as T
    }
    const data=JSON.parse(prompt.slice(prompt.indexOf('{"question"')))
    if(type==='RagSemanticSelection')return {matches:data.untrusted_index.filter((row:{summary:string})=>row.summary.includes('助餐')).map((row:{source_id:string})=>({source_id:row.source_id,reason:'晚餐与助餐设施语义相关'}))} as T
    const first=data.untrusted_passages[0]
    return {claims:[{text:'原文记录了长者助餐服务。',citations:[{source_id:first.source_id,quote:patch.badQuote?'虚构的补贴金额999万元':first.text}]}],missing:[],public_queries:[],internal_requests:[]} as T
  }}
  return {port,prompts,types}
}

it('recalls a semantic-only passage and answers with its exact original locator; repeats reuse the versioned index',async()=>{
  const p=project([source('MEAL','长者助餐服务覆盖36人。')]),before=JSON.stringify(p),fake=model()
  const service=new HybridRetrievalService(repository,async()=>({matches:[]}),async()=>fake.port)
  await service.index(p,bundle(p),[],{question:''},options())
  const result=await service.retrieve(p,bundle(p),[],{question:'晚餐去哪里'},options())
  expect(result.method).toBe('api_semantic_bm25');expect(result.question).toBe('晚餐去哪里')
  expect(result.hits).toHaveLength(1);expect(result.hits[0].source.id).toBe('MEAL')
  expect(result.assistance?.answer[0].citations[0]).toEqual({hit_id:result.hits[0].id,quote:'长者助餐服务覆盖36人。'})
  const callsBefore=fake.types.filter(type=>type==='RagSemanticIndex').length
  const repeated=await service.retrieve(p,bundle(p),[],{question:'晚餐去哪里'},options())
  expect(fake.types.filter(type=>type==='RagSemanticIndex')).toHaveLength(callsBefore)
  expect(repeated.assistance?.index).toMatchObject({indexed:1,reused:1,pending:0})
  expect(JSON.stringify(p)).toBe(before);expect(result.fact_writes).toBe(0)
})

it('keeps keyword results and guidance when the API cannot open',async()=>{
  const p=project([source('MEAL','长者助餐服务覆盖36人。')])
  const service=new HybridRetrievalService(repository,keyword,async()=>{throw new Error('OFFLINE')})
  const result=await service.retrieve(p,bundle(p),[],{question:'助餐'},options())
  expect(result.method).toBe('keyword_fallback');expect(result.hits[0].source.id).toBe('MEAL')
  expect(result.assistance?.public_queries.length).toBeGreaterThan(0)
  expect(result.assistance?.warnings.join()).toContain('API')
})

it('uses topic words as a preference instead of discarding a relevant title and differently worded body',async()=>{
  const p=project([source('MEAL','每日供应午餐，服务60人次。',{title:'社区食堂运行记录'})])
  const service=new HybridRetrievalService(repository,async input=>({matches:input.sources.map(row=>({source_id:row.id,score:1}))}),null)
  const result=await service.retrieve(p,bundle(p),[],{question:'老人吃饭'},options())
  expect(result.hits[0].source.id).toBe('MEAL')
  expect(result.hits[0].text).toBe('每日供应午餐，服务60人次。')
})

it('returns public-search and internal-collection guidance when no original material is present',async()=>{
  const p=project([]),ranker=vi.fn(async()=>({matches:[]}))
  const result=await new HybridRetrievalService(repository,ranker,null).retrieve(p,bundle(p),[],{question:'居民满意度如何'},options())
  expect(result.hits).toEqual([]);expect(result.assistance?.public_queries.length).toBeGreaterThan(0)
  expect(result.assistance?.internal_requests.length).toBeGreaterThan(0);expect(ranker).not.toHaveBeenCalled()
})

it('retains internal local hits while withholding their content from API indexing and answers without current consent',async()=>{
  const p=project([source('PRIVATE','机密助餐调查：SECRET-RESIDENT',{visibility:'internal',data_class:'internal',locator:'document:PRIVATE',hash:'private-hash'})]),fake=model()
  const document:ParsedDocument={id:'PRIVATE',project_id:p.id,file_name:'内部台账.txt',sha256:'private-hash',created_at:'2026-10-16',parser_result:{status:'extracted',source_hash:'private-hash',segments:[{locator:'line:1',text:'机密助餐调查：SECRET-RESIDENT'}]}}
  const exported=buildRagExport({projectId:p.id,documents:[{...normalizeImportDocument(document),hash:document.sha256}],rawDocuments:[document],cards:[],sources:p.input.sources})
  const service=new HybridRetrievalService(repository,keyword,async()=>fake.port)
  const result=await service.retrieve(p,exported,[document],{question:'助餐'},options())
  expect(result.hits[0].source.id).toBe('PRIVATE');expect(fake.prompts.join()).not.toContain('SECRET-RESIDENT')
  expect(fake.types).not.toContain('RagSemanticIndex');expect(fake.types).not.toContain('RagAnswer')
})

it('never reuses another owner or a changed document text under the same registered version',async()=>{
  const p=project([source('MEAL','长者助餐服务覆盖36人。')]),fake=model()
  const service=new HybridRetrievalService(repository,keyword,async()=>fake.port)
  await service.index(p,bundle(p),[],{question:''},options())
  const other=project(p.input.sources,'different-owner')
  const otherIndex=await service.index(other,bundle(other),[],{question:''},options())
  expect(otherIndex.reused).toBe(0)
  const changed=project([source('MEAL','长者助餐服务覆盖40人。')])
  const changedIndex=await service.index(changed,bundle(changed),[],{question:''},options())
  expect(changedIndex.reused).toBe(0)
})

it('drops an invented answer quote without losing source results',async()=>{
  const p=project([source('MEAL','长者助餐服务覆盖36人。')]),fake=model({badQuote:true})
  const service=new HybridRetrievalService(repository,keyword,async()=>fake.port)
  const result=await service.retrieve(p,bundle(p),[],{question:'助餐'},options())
  expect(result.hits).toHaveLength(1)
  expect(result.assistance?.answer.flatMap(row=>row.citations).every(row=>!row.quote.includes('999万元'))).toBe(true)
  expect(result.assistance?.warnings.join()).toContain('尚无可定位原句')
})

it('indexes every window of long source bodies and binds each to its exact character range',()=>{
  const p=project([source('LONG','助餐说明'.repeat(2200))])
  const candidates=prepareRetrievalCandidates(p,bundle(p),[],{question:'助餐'}).candidates
  const windows=semanticWindows(candidates)
  expect(windows.length).toBeGreaterThan(1)
  expect(windows.at(-1)?.end).toBe(candidates[0].text.length)
  expect(windows.every(window=>window.text===candidates[0].text.slice(window.start,window.end))).toBe(true)
})

it('keeps query handling independent of missing or failing index construction',async()=>{
  const p=project([source('MEAL','长者助餐服务覆盖36人。')]),fake=model({fail:'RagSemanticIndex'})
  const service=new HybridRetrievalService(repository,keyword,async()=>fake.port)
  const result=await service.retrieve(p,bundle(p),[],{question:'助餐'},options())
  expect(result.hits).toHaveLength(1);expect(result.assistance?.index.pending).toBe(1)
  expect(result.assistance?.warnings.join()).toContain('待后台');expect(fake.types).not.toContain('RagSemanticIndex')
})

it('serves index creation and hybrid answers through the owner-scoped HTTP API',async()=>{
  const p=project([source('MEAL','长者助餐服务覆盖36人。')]),fake=model(),app=express()
  app.use(express.json())
  registerRagRetrieval(app,new Store(db as unknown as Database,'PGlite'),async id=>{
    if(id!==p.id)throw new ExperienceError(404,'PROJECT_NOT_FOUND','无权访问')
    return p
  },{ranker:async()=>({matches:[]}),modelFactory:async()=>fake.port,pipeline:{state:async()=>({documents:[],cards:[]})} as unknown as Pick<KnowledgePipelineService,'state'>})
  const server=app.listen(0);await new Promise<void>(resolve=>server.once('listening',resolve))
  const url=`http://127.0.0.1:${(server.address() as {port:number}).port}/api/projects/`
  const post=(path:string,body:unknown)=>fetch(url+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
  try {
    const index=await post(p.id+'/knowledge/index',{})
    expect(index.status).toBe(200);expect(await index.json()).toMatchObject({status:'ready',indexed:1})
    const response=await post(p.id+'/knowledge/retrieve',{question:'晚餐去哪里',use_ai:true})
    expect(response.status).toBe(200)
    const result=await response.json();expect(result).toMatchObject({method:'api_semantic_bm25',assistance:{index:{reused:1}}})
    expect(result.hits[0].locator).toBe('line:1')
    const count=fake.types.length
    expect((await post('FOREIGN/knowledge/index',{})).status).toBe(404)
    expect((await post(p.id+'/knowledge/retrieve',{question:'助餐',project_id:'FOREIGN'})).status).toBe(422)
    expect(fake.types).toHaveLength(count)
  } finally {await new Promise<void>(resolve=>server.close(()=>resolve()))}
})

it('publishes original hits before any waiting model stage and does not build an index during the question',async()=>{
  const p=project([source('MEAL','长者助餐服务覆盖36人。')]),fake=model()
  let release!:()=>void
  const gate=new Promise<void>(resolve=>{release=resolve}),originals:unknown[]=[]
  const service=new HybridRetrievalService(repository,keyword,async()=>{await gate;return fake.port})
  const pending=service.retrieve(p,bundle(p),[],{question:'助餐'},{...options(),onOriginals:result=>originals.push(result)})
  await vi.waitFor(()=>expect(originals).toHaveLength(1))
  expect((originals[0] as any).hits[0].source.id).toBe('MEAL')
  expect(fake.types).toEqual([])
  release();await pending
  expect(fake.types).not.toContain('RagSemanticIndex')
})

it('excludes an explicitly different unit from semantic selection',async()=>{
 const p=project([source('UNIT2','该单元加装电梯预算80万元。',{title:'75幢2单元电梯预算'})]),fake=model()
 const result=await new HybridRetrievalService(repository,async input=>({matches:input.sources.map(source=>({source_id:source.id,score:1}))}),async()=>fake.port).retrieve(p,bundle(p),[],{question:'75幢1单元加电梯多少钱'},options())
 expect(result.hits).toEqual([])
 expect(fake.prompts.join()).not.toContain('该单元加装电梯预算80万元')
})

it('streams original HTTP results while the model is still waiting',async()=>{
 const p=project([source('MEAL','长者助餐服务覆盖36人。')]),fake=model(),app=express()
 app.use(express.json())
 let release!:()=>void
 const gate=new Promise<void>(resolve=>{release=resolve})
 registerRagRetrieval(app,new Store(db as unknown as Database,'PGlite'),async()=>p,{ranker:keyword,modelFactory:async()=>{await gate;return fake.port},pipeline:{state:async()=>({documents:[],cards:[]})} as any})
 const server=app.listen(0);await new Promise<void>(resolve=>server.once('listening',resolve))
 try{
  const response=await fetch(`http://127.0.0.1:${(server.address() as {port:number}).port}/api/projects/${p.id}/knowledge/retrieve`,{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/x-ndjson'},body:JSON.stringify({question:'助餐',use_ai:true})})
  expect(response.headers.get('content-type')).toContain('application/x-ndjson')
  const reader=response.body!.getReader(),first=await reader.read(),text=new TextDecoder().decode(first.value)
  expect(text).toContain('"type":"originals"');expect(text).toContain('长者助餐服务覆盖36人')
  expect(fake.types).toEqual([])
  release()
  let tail='';while(true){const next=await reader.read();if(next.done)break;tail+=new TextDecoder().decode(next.value)}
  expect(tail).toContain('"type":"complete"');expect(fake.types).not.toContain('RagSemanticIndex')
 }finally{release();await new Promise<void>(resolve=>server.close(()=>resolve()))}
})

it('keeps readable original results when the local capability ranker is unavailable',async()=>{
 const p=project([source('MEAL','长者助餐服务覆盖36人。')])
 const result=await new HybridRetrievalService(repository,async()=>{throw new Error('CAPABILITY_DOWN')},null).retrieve(p,bundle(p),[],{question:'助餐'},options())
 expect(result.hits[0].source.id).toBe('MEAL')
 expect(result.assistance?.warnings.join()).toContain('本地检索服务本次未响应')
})

it('a rewritten question cannot admit another unit excluded by the original question',async()=>{
 const p=project([source('UNIT1','预算54万元。',{title:'75幢1单元电梯方案'}),source('UNIT2','预算80万元。',{title:'75幢2单元电梯方案'})]),fake=model()
 const original=fake.port.call
 fake.port.call=async<T>(type:string,prompt:string,signal:AbortSignal)=>type==='RagQueryPlan'?{queries:['75幢2单元电梯预算'],concepts:[],subquestions:[]} as T:original<T>(type,prompt,signal)
 const ranker:RetrievalRanker=async(input)=>({matches:input.sources.map(source=>({source_id:source.id,score:1}))})
 const result=await new HybridRetrievalService(repository,ranker,async()=>fake.port).retrieve(p,bundle(p),[],{question:'75幢1单元电梯预算'},options())
 expect(result.hits.map(hit=>hit.source.id)).toEqual(['UNIT1'])
})
