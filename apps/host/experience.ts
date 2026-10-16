import type {IntelligenceService} from '../../packages/intelligence/service'
import type { Express, Request, Response } from 'express'
import { z } from 'zod'
import type { ProjectRecord, Store } from './store'
import { ContractError } from '../../packages/contracts/validate'
import { ExperienceError } from '../../packages/experience/domain'
import { ExperienceService } from '../../packages/experience/service'
import { KnowledgePipelineService } from '../../packages/experience/pipeline'
import { registerRagRetrieval } from './rag-retrieval'
import { ExperienceLearningService } from '../../packages/experience/learning'

const revision = z.number().int().min(1)
const version = z.number().int().min(0)
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}, '资料时点必须是有效日期')

/** Mounted after the host's session/CSRF checks, using its project ownership gate. */
export async function registerExperience(app: Express, store: Store, requireProject: (id: string) => Promise<ProjectRecord>, background?:IntelligenceService): Promise<ExperienceService & {queueRagIndex:(project:ProjectRecord)=>Promise<void>}> {
  const service = new ExperienceService(store)
  await service.initialize()
  const pipeline = new KnowledgePipelineService(store, service)
  await pipeline.initialize()
  const learning=new ExperienceLearningService(service,pipeline)
  const rag=registerRagRetrieval(app, store, requireProject, { pipeline, background })
  const route = (operation: (request: Request, response: Response) => Promise<unknown>) => async (request: Request, response: Response) => {
    try { await operation(request, response) }
    catch (error) {
      if (response.headersSent) return
      if (error instanceof z.ZodError || error instanceof ContractError) return response.status(422).json({ code: 'VALIDATION_ERROR', detail: error.message })
      const apiError = error as { status?: number; code?: string; message?: string }
      if (error instanceof ExperienceError || Number.isInteger(apiError.status) && typeof apiError.code === 'string') return response.status(apiError.status!).json({ code: apiError.code, detail: apiError.message })
      console.warn('EXPERIENCE_REQUEST_FAILED')
      return response.status(500).json({ code: 'EXPERIENCE_REQUEST_FAILED', detail: '经验整理未完成，请检查本地运行记录。' })
    }
  }
  app.get('/api/projects/:id/experiences', route(async (request, response) => {
    const project = await requireProject(String(request.params.id))
    const query = z.object({ q: z.string().max(300).optional(), status: z.enum(['draft', 'approved', 'rejected']).optional(), kind: z.enum(['case', 'rule']).optional() }).strict().parse(request.query)
    response.json({ cards: await service.repository.list(project.id, query.q, query.status, query.kind) })
  }))
  app.get('/api/experiences/search', route(async (request, response) => {
    const query = z.object({ q: z.string().max(300).optional(), project_type: z.string().max(80).optional(), development_mode: z.string().max(80).optional(), stage: z.string().max(80).optional(), as_of: date.optional(), exclude_project: z.string().min(1).optional(), synthetic: z.enum(['true', 'false']).optional(), limit: z.coerce.number().int().min(1).max(100).optional(), kind: z.enum(['case', 'rule']).optional() }).strict().parse(request.query)
    const target = query.exclude_project ? await requireProject(query.exclude_project) : undefined
    const synthetic = query.synthetic === undefined ? target?.input.synthetic || false : query.synthetic === 'true'
    if (target && synthetic !== target.input.synthetic) throw new ExperienceError(422, 'SYNTHETIC_SCOPE', '检索资料类别必须与当前项目一致。')
    response.json(await service.search({ ...query, synthetic }))
  }))
  app.post('/api/projects/:id/experiences/extract', route(async (request, response) => {
    const project = await requireProject(String(request.params.id))
    const body = z.object({ document_ids: z.array(z.string().min(1)).min(1).max(10), use_model: z.boolean().default(false) }).strict().parse(request.body)
    response.status(201).json(await service.extract(project, body.document_ids, body.use_model))
  }))
  app.post('/api/projects/:id/experiences', route(async (request, response) => {
    const project = await requireProject(String(request.params.id))
    const body = z.object({ draft: z.unknown() }).strict().parse(request.body)
    response.status(201).json(await service.create(project, body.draft))
  }))
  app.post('/api/projects/:id/experiences/knowledge-match', route(async (request, response) => {
    const project = await requireProject(String(request.params.id))
    const body = z.object({ query: z.object({ measure_key: z.string().max(80).regex(/^[A-Za-z0-9_.-]*$/), question: z.string().max(1000) }).strict() }).strict().parse(request.body)
    // This explicit owner-scoped preview includes reviewed internal knowledge without changing the project or calling a model.
    response.json(await service.resolveKnowledge({ ...project, input: { ...project.input, mode: 'enterprise' } }, body.query))
  }))
  app.post('/api/projects/:id/experiences/:cardId/update', route(async (request, response) => {
    const project = await requireProject(String(request.params.id))
    const body = z.object({ draft: z.unknown(), expected_revision: revision }).strict().parse(request.body)
    response.json(await service.update(project, String(request.params.cardId), body.draft, body.expected_revision))
  }))
  app.post('/api/projects/:id/experiences/:cardId/review', route(async (request, response) => {
    const project = await requireProject(String(request.params.id))
    const body = z.object({ expected_revision: revision, status: z.enum(['approved', 'rejected']), note: z.string().trim().min(1).max(2000) }).strict().parse(request.body)
    response.json(await service.review(project, String(request.params.cardId), body.expected_revision, body.status, body.note))
  }))
  app.post('/api/projects/:id/experiences/reuse', route(async (request, response) => {
    const project = await requireProject(String(request.params.id))
    const body = z.object({ card_id: z.string().min(1), expected_card_revision: revision, expected_version: version }).strict().parse(request.body)
    response.json(await service.reuse(project, body.card_id, body.expected_version, body.expected_card_revision))
  }))
  app.get('/api/projects/:id/knowledge/pipeline', route(async (request, response) => {
    response.json(await pipeline.state(await requireProject(String(request.params.id))))
  }))
  app.post('/api/projects/:id/knowledge/learn', route(async(request,response)=>{
    const project=await requireProject(String(request.params.id))
    const body=z.object({document_ids:z.array(z.string().min(1)).min(1).max(10),use_model:z.boolean().default(true),allow_internal_ai:z.boolean().default(false)}).strict().parse(request.body)
    const controller=new AbortController(),signal=AbortSignal.any([controller.signal,AbortSignal.timeout(600000)])
    request.once('aborted',()=>controller.abort());response.once('close',()=>{if(!response.writableEnded)controller.abort()})
    const stream=request.headers.accept?.includes('application/x-ndjson')
    if(stream){response.type('application/x-ndjson');response.setHeader('Cache-Control','no-store');response.setHeader('X-Accel-Buffering','no');response.flushHeaders()}
    const emit=(event:import('../../packages/experience/learning').ExperienceLearningEvent)=>{if(stream&&!response.destroyed&&!response.writableEnded)response.write(JSON.stringify(event)+'\n')}
    try {
      const result=await learning.learn(project,[...new Set(body.document_ids)],body.use_model,body.allow_internal_ai,signal,emit)
      if(!response.destroyed){if(stream){emit({type:'complete',result});response.end()}else response.status(201).json(result)}
    } catch(error) {
      if(!stream)throw error
      emit({type:'error',message:error instanceof ExperienceError?error.message:'原件已保存，本轮自动整理未完成，可以继续处理。'});response.end()
    }
  }))
  app.post('/api/projects/:id/knowledge/rule-updates/apply',route(async(request,response)=>{
    const project=await requireProject(String(request.params.id))
    const body=z.object({candidate_id:z.string().min(1),expected_candidate_revision:revision,target_id:z.string().min(1).optional(),expected_target_revision:revision.optional()}).strict().parse(request.body)
    response.json(await learning.applyRule(project,body.candidate_id,body.expected_candidate_revision,body.target_id,body.expected_target_revision))
  }))
  app.post('/api/projects/:id/knowledge/chunks', route(async (request, response) => {
    const project = await requireProject(String(request.params.id))
    const body = z.object({ document_id: z.string().min(1) }).strict().parse(request.body)
    response.json(await pipeline.chunks(project, body.document_id))
  }))
  app.post('/api/projects/:id/knowledge/public-document', route(async (request, response) => {
    const project = await requireProject(String(request.params.id))
    const body = z.object({ source_id: z.string().min(1) }).strict().parse(request.body)
    response.status(201).json(await pipeline.importPublicDocument(project, body.source_id))
    void requireProject(project.id).then(rag.queueIndex).catch(()=>console.warn('RAG_BACKGROUND_INDEX_QUEUE_FAILED'))
  }))
  app.post('/api/projects/:id/knowledge/extract', route(async (request, response) => {
    const project = await requireProject(String(request.params.id))
    const body = z.object({ document_ids: z.array(z.string().min(1)).min(1).max(10), use_model: z.boolean().default(false) }).strict().parse(request.body)
    response.status(201).json(await pipeline.extract(project, body.document_ids, body.use_model))
  }))
  app.post('/api/projects/:id/knowledge/policies', route(async (request, response) => {
    const project = await requireProject(String(request.params.id))
    const body = z.object({ policy: z.object({ definitions: z.array(z.unknown()).max(100), min_coverage: z.number().min(0).max(1), max_distance: z.number().min(0).max(1), note: z.string().max(2000) }).strict(), id: z.string().min(1).optional(), expected_revision: revision.optional() }).strict().parse(request.body)
    response.status(201).json(await pipeline.savePolicy(project, body.policy as Parameters<typeof pipeline.savePolicy>[1], body.id, body.expected_revision))
  }))
  app.post('/api/projects/:id/knowledge/policies/:policyId/review', route(async (request, response) => {
    const project = await requireProject(String(request.params.id))
    const body = z.object({ expected_revision: revision, status: z.enum(['approved', 'rejected']), note: z.string().trim().min(1).max(2000) }).strict().parse(request.body)
    response.json(await pipeline.reviewPolicy(project, String(request.params.policyId), body.expected_revision, body.status, body.note))
  }))
  app.post('/api/projects/:id/knowledge/groups', route(async (request, response) => {
    const project = await requireProject(String(request.params.id))
    const body = z.object({ policy_id: z.string().min(1).optional(), policy_revision: revision.optional(), query: z.object({ measure_key: z.string().max(80), question: z.string().max(1000) }).strict().optional() }).strict().parse(request.body)
    response.json(await pipeline.groups(project, body.policy_id, body.policy_revision, body.query))
  }))
  app.post('/api/projects/:id/knowledge/skills/distill', route(async (request, response) => {
    const project = await requireProject(String(request.params.id))
    const body = z.object({ card_ids: z.array(z.string().min(1)).min(1).max(20) }).strict().parse(request.body)
    response.status(201).json(await pipeline.distill(project, body.card_ids))
  }))
  app.post('/api/projects/:id/knowledge/skills/:skillId/activate',route(async(request,response)=>{
    const project=await requireProject(String(request.params.id))
    const body=z.object({expected_revision:revision}).strict().parse(request.body)
    response.json(await learning.applySkill(project,String(request.params.skillId),body.expected_revision))
  }))
  app.post('/api/projects/:id/knowledge/skills/:skillId/review', route(async (request, response) => {
    const project = await requireProject(String(request.params.id))
    const body = z.object({ expected_revision: revision, status: z.enum(['approved', 'rejected']), note: z.string().trim().min(1).max(2000) }).strict().parse(request.body)
    response.json(await pipeline.reviewSkill(project, String(request.params.skillId), body.expected_revision, body.status, body.note))
  }))
  app.get('/api/projects/:id/knowledge/skills/:skillId/export', route(async (request, response) => {
    const query=z.object({preview:z.enum(['true','false']).optional()}).strict().parse(request.query)
    response.json(await pipeline.exportSkill(await requireProject(String(request.params.id)), String(request.params.skillId),query.preview==='true'))
  }))
  app.get('/api/projects/:id/knowledge/:kind/:recordId/history', route(async (request, response) => {
    const project = await requireProject(String(request.params.id))
    const kind = z.enum(['policies', 'skills']).parse(request.params.kind)
    response.json(await pipeline.repository.history(kind === 'policies' ? 'policy' : 'skill', project.id, String(request.params.recordId)))
  }))
  return Object.assign(service,{queueRagIndex:rag.queueIndex})
}
