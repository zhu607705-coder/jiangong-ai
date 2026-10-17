import type {IntelligenceService} from '../../packages/intelligence/service'
import {hash,canonical} from '../../packages/intelligence/domain'
import type { Express, Request, Response } from 'express'
import { z } from 'zod'
import type { ProjectRecord, Store } from './store'
import { config } from './config'
import { ExperienceError } from '../../packages/experience/errors'
import type { KnowledgePipelineService } from '../../packages/experience/pipeline'
import { buildRagExport } from '../../packages/experience/rag-export'
import { retrieveProjectEvidence, type RetrievalRanker } from '../../packages/experience/retrieval'
import { normalizeImportDocument } from '../workspace/src/imports/graph-model'
import { randomUUID } from 'node:crypto'
import { LiveSession } from '../../runtime/dsh/live-session'
import { HybridRetrievalService, type RagModelPort } from '../../packages/experience/hybrid-retrieval'
import { SemanticIndexRepository } from '../../packages/experience/semantic-index'
import {withResearchOriginals} from '../../packages/experience/retrieval-sources'
import {collectSelectedEvidence} from '../../services/capabilities/research'
import {projectObjectLocation} from '../../packages/retrofit/object-binding'
import {answerSlots} from '../../packages/retrofit/research-coverage'

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}, '研判时点必须为有效日期')
export const retrievalRequest = z.object({ question: z.string().trim().min(1).max(500),
  measure_key: z.string().trim().min(1).max(80).regex(/^[A-Za-z0-9_.-]+$/).optional(),
  object_ref: z.string().trim().min(1).max(160).optional(), stage: z.string().trim().min(1).max(100).optional(),
  source_kind: z.enum(['public_original', 'ai_draft', 'synthetic', 'internal_material', 'unknown']).optional(),
  include_ai: z.boolean().default(false), review_status: z.enum(['draft', 'approved', 'rejected']).optional(),
  as_of: date.optional(), limit: z.number().int().min(1).max(5).default(5),
  use_ai:z.boolean().default(false), allow_internal_ai:z.boolean().default(false),
}).strict()

/** The existing local capability remains the lexical ranker; API use is handled separately after consent filtering. */
export const capabilityRetrievalRanker: RetrievalRanker = async (project, query,limit=5) => {
  let response: globalThis.Response
  try {
    response = await fetch(`${config.capabilityUrl}/capabilities/retrieval.query`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Capability-Token': config.capabilityToken },
      body: JSON.stringify({ project, query, include_internal: true,retrieval_limit:limit }), signal: AbortSignal.timeout(20000) })
  } catch { throw new ExperienceError(502, 'RAG_RETRIEVAL_UNAVAILABLE', '现有本地检索能力未响应，请检查能力服务。') }
  if (!response.ok) throw new ExperienceError(502, 'RAG_RETRIEVAL_FAILED', `现有本地检索能力返回HTTP ${response.status}，本次检索未完成。`)
  let payload: unknown
  try { payload = await response.json() } catch { throw new ExperienceError(502, 'RAG_RETRIEVAL_INVALID', '本地检索能力未返回有效JSON。') }
  const checked = z.object({ matches: z.array(z.object({ source_id: z.string().min(1), score: z.number().finite() }).passthrough()).max(50) }).passthrough().safeParse(payload)
  if (!checked.success) throw new ExperienceError(502, 'RAG_RETRIEVAL_INVALID', '本地检索能力返回的命中结构无效。')
  return { matches: checked.data.matches }
}

/** Mounted under the existing session/CSRF middleware; ownership is obtained solely through requireProject. */
async function openRagModel(signal:AbortSignal):Promise<RagModelPort> {
  const live=await LiveSession.open('RAG-'+randomUUID(),signal)
  return {name:config.DEEPSEEK_MODEL,calls:()=>live.calls.length,close:()=>live.close(),
    call:async<T>(type:string,prompt:string,callSignal:AbortSignal)=>(await live.call<T>('rag_'+type,prompt,type,[],undefined,undefined,undefined,{signal:callSignal,maxOutputTokens:type==='RagSemanticIndex'?4500:2500})).value}
}

export function registerRagRetrieval(app: Express, store: Store, requireProject: (id: string) => Promise<ProjectRecord>, options: { pipeline: Pick<KnowledgePipelineService, 'state'>; ranker?: RetrievalRanker; modelFactory?:((signal:AbortSignal)=>Promise<RagModelPort>)|null; background?:IntelligenceService }) {
  const hybrid=new HybridRetrievalService(new SemanticIndexRepository(store.db),options.ranker||capabilityRetrievalRanker,
    options.modelFactory===undefined?(config.modelConfigured?openRagModel:null):options.modelFactory,config.searchConfigured?async(project,question,signal)=>{
      if(project.input.synthetic)return []
      // Search terms are rebuilt from public object registration and fixed topic/field labels, never private summaries.
      const location=projectObjectLocation(project.input.scope),name=project.input.scope.map_anchor?.name||project.input.scope.name
      const subjects=[...new Set(answerSlots(question).filter(slot=>['机电配套','雨棚','消防通道','二次供水','电梯','社区食堂'].includes(slot.topic)).map(slot=>slot.topic))]
      const queries=(subjects.length?subjects:['改造工程']).slice(0,4).map(topic=>`${location.city||''} ${name} ${topic} 金额 阶段 资金来源 公告`)
      const found=await collectSelectedEvidence({name,city:location.city,purpose:'本对象公开原文补查',asOf:project.input.as_of,seedSources:project.input.sources,forceDiscovery:true,budget:{newEvidence:3,refresh:1}},signal,undefined,undefined,queries)
      const sources=found.sources.filter(source=>source.untrusted_text&&source.content_status!=='metadata_only'&&!project.input.sources.some(old=>old.id===source.id&&old.hash===source.hash))
      await store.db.exec('CREATE TABLE IF NOT EXISTS project_rag_evidence(owner_id TEXT NOT NULL,project_id TEXT NOT NULL REFERENCES projects(id),context_version INTEGER NOT NULL,source_id TEXT NOT NULL,source_hash TEXT NOT NULL,payload JSONB NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),PRIMARY KEY(owner_id,project_id,context_version,source_id,source_hash))')
      for(const source of sources)await store.db.query('INSERT INTO project_rag_evidence(owner_id,project_id,context_version,source_id,source_hash,payload) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',[project.owner_id,project.id,project.context_version,source.id,source.hash,JSON.stringify(source)])
      return sources
    }:undefined)
  const fingerprint=(project:ProjectRecord)=>hash(canonical(project.input.sources.map(source=>[source.id,source.visibility,source.data_class,source.hash,source.untrusted_text])))
  async function indexBundle(project:ProjectRecord){
    const state=await options.pipeline.state(project)
    return {state,bundle:buildRagExport({projectId:project.id,documents:state.documents.map(document=>({...normalizeImportDocument(document),hash:document.sha256})),rawDocuments:state.documents,cards:state.cards,sources:project.input.sources})}
  }
  // Reuse intel_jobs and its existing worker. Queue contains IDs/version hashes, never document text or credentials.
  async function queueIndex(project:ProjectRecord){
    if(!options.background||!config.modelConfigured||project.input.synthetic)return
    await options.background.ready
    const saved=await withResearchOriginals(store,project),version=fingerprint(saved)
    await options.background.repo.enqueue('rag_index',hash(canonical([saved.owner_id,saved.id,version])),{project_id:saved.id,owner_id:saved.owner_id,context_version:saved.context_version,source_fingerprint:version})
  }
  options.background?.registerJobHandler('rag_index',async(job,signal)=>{
    const project=await withResearchOriginals(store,await requireProject(String(job.payload.project_id)))
    if(project.owner_id!==job.payload.owner_id||project.context_version!==job.payload.context_version||fingerprint(project)!==job.payload.source_fingerprint)throw new Error('RAG_INDEX_SNAPSHOT_CHANGED')
    const {state,bundle}=await indexBundle(project)
    const result=await hybrid.index(project,bundle,state.documents,{question:''},{signal,allowInternalAI:false,maxIndexBatches:3})
    return {pending:result.pending>0,progress:result.indexed>result.reused}
  })
  const signalFor=(request:Request,response:Response)=>{
    const controller=new AbortController()
    request.once('aborted',()=>controller.abort())
    response.once('close',()=>{if(!response.writableEnded)controller.abort()})
    return AbortSignal.any([controller.signal,AbortSignal.timeout(100000)])
  }
  app.post('/api/projects/:id/knowledge/retrieve', async (request: Request, response: Response) => {
    try {
      const project = await withResearchOriginals(store,await requireProject(String(request.params.id))), {use_ai,allow_internal_ai,...body} = retrievalRequest.parse(request.body)
      if (project.input.project_id !== project.id) throw new ExperienceError(409, 'PROJECT_INPUT_CONFLICT', '项目资料标识不一致，请核对当前项目。')
      const state = await options.pipeline.state(project)
      const bundle = buildRagExport({ projectId: project.id, documents: state.documents.map(document => ({
        ...normalizeImportDocument(document), hash: document.sha256,
      })), rawDocuments: state.documents, cards: state.cards, sources: project.input.sources })
      const streaming=use_ai&&request.headers.accept?.includes('application/x-ndjson')
      const emit=(event:unknown)=>{if(streaming&&!response.destroyed&&!response.writableEnded)response.write(JSON.stringify(event)+'\n')}
      if(streaming){response.type('application/x-ndjson');response.setHeader('Cache-Control','no-store');response.setHeader('X-Accel-Buffering','no');response.flushHeaders()}
      const result=use_ai?await hybrid.retrieve(project,bundle,state.documents,body,{signal:signalFor(request,response),allowInternalAI:allow_internal_ai&&config.ALLOW_INTERNAL_MODEL==='true',onOriginals:originals=>{emit({type:'originals',result:originals});void queueIndex(project).catch(()=>console.warn('RAG_BACKGROUND_INDEX_QUEUE_FAILED'))}})
        :await retrieveProjectEvidence(project,bundle,state.documents,body,options.ranker||capabilityRetrievalRanker)
      if(!response.destroyed){if(streaming){emit({type:'complete',result});response.end()}else response.json(result)}
    } catch (error) {
      if (response.headersSent) {if(!response.destroyed){response.write(JSON.stringify({type:'error',message:'语义补充未完成，已找到的原文仍可阅读。'})+'\n');response.end()}return}
      if (error instanceof z.ZodError) { response.status(422).json({ code: 'VALIDATION_ERROR', detail: error.message }); return }
      const value = error as { status?: number; code?: string; message?: string }
      if (error instanceof ExperienceError || Number.isInteger(value.status) && typeof value.code === 'string') {
        response.status(value.status!).json({ code: value.code, detail: value.message }); return
      }
      console.warn('RAG_RETRIEVAL_REQUEST_FAILED')
      response.status(500).json({ code: 'RAG_RETRIEVAL_REQUEST_FAILED', detail: '材料检索未完成，请检查本地运行记录。' })
    }
  })
  app.post('/api/projects/:id/knowledge/index',async(request:Request,response:Response)=>{
    try {
      const project=await withResearchOriginals(store,await requireProject(String(request.params.id)))
      const {allow_internal_ai,...body}=retrievalRequest.omit({question:true,use_ai:true}).parse(request.body)
      if(project.input.project_id!==project.id)throw new ExperienceError(409,'PROJECT_INPUT_CONFLICT','项目资料标识不一致，请核对当前项目。')
      const state=await options.pipeline.state(project)
      const bundle=buildRagExport({projectId:project.id,documents:state.documents.map(document=>({...normalizeImportDocument(document),hash:document.sha256})),rawDocuments:state.documents,cards:state.cards,sources:project.input.sources})
      const result=await hybrid.index(project,bundle,state.documents,{...body,question:''},{signal:signalFor(request,response),allowInternalAI:allow_internal_ai&&config.ALLOW_INTERNAL_MODEL==='true'})
      if(!response.destroyed)response.json(result)
    }catch(error){
      if(response.destroyed)return
      const value=error as {status?:number;message?:string}
      response.status(error instanceof z.ZodError?422:value.status||503).json({detail:error instanceof z.ZodError?'索引请求格式不正确。':'语义索引暂未完成，可继续检索原文并稍后重试。'})
    }
  })
  return {queueIndex}
}
