import type { Express, Request, Response } from 'express'
import { z } from 'zod'
import type { ProjectRecord, Store } from './store'
import { config } from './config'
import { ExperienceError } from '../../packages/experience/errors'
import type { KnowledgePipelineService } from '../../packages/experience/pipeline'
import { buildRagExport } from '../../packages/experience/rag-export'
import { retrieveProjectEvidence, type RetrievalRanker } from '../../packages/experience/retrieval'
import { normalizeImportDocument } from '../workspace/src/imports/graph-model'

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
}).strict()

/** The capability already owns Jieba/BM25/STORM curation. Local original text never goes to a model or public search. */
export const capabilityRetrievalRanker: RetrievalRanker = async (project, query) => {
  let response: globalThis.Response
  try {
    response = await fetch(`${config.capabilityUrl}/capabilities/retrieval.query`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Capability-Token': config.capabilityToken },
      body: JSON.stringify({ project, query, include_internal: true }), signal: AbortSignal.timeout(20000) })
  } catch { throw new ExperienceError(502, 'RAG_RETRIEVAL_UNAVAILABLE', '现有本地检索能力未响应，请检查能力服务。') }
  if (!response.ok) throw new ExperienceError(502, 'RAG_RETRIEVAL_FAILED', `现有本地检索能力返回HTTP ${response.status}，本次检索未完成。`)
  let payload: unknown
  try { payload = await response.json() } catch { throw new ExperienceError(502, 'RAG_RETRIEVAL_INVALID', '本地检索能力未返回有效JSON。') }
  const checked = z.object({ matches: z.array(z.object({ source_id: z.string().min(1), score: z.number().finite() }).passthrough()).max(5) }).passthrough().safeParse(payload)
  if (!checked.success) throw new ExperienceError(502, 'RAG_RETRIEVAL_INVALID', '本地检索能力返回的命中结构无效。')
  return { matches: checked.data.matches }
}

/** Mounted under the existing session/CSRF middleware; ownership is obtained solely through requireProject. */
export function registerRagRetrieval(app: Express, _store: Store, requireProject: (id: string) => Promise<ProjectRecord>, options: { pipeline: Pick<KnowledgePipelineService, 'state'>; ranker?: RetrievalRanker }) {
  app.post('/api/projects/:id/knowledge/retrieve', async (request: Request, response: Response) => {
    try {
      const project = await requireProject(String(request.params.id)), body = retrievalRequest.parse(request.body)
      if (project.input.project_id !== project.id) throw new ExperienceError(409, 'PROJECT_INPUT_CONFLICT', '项目资料标识不一致，请核对当前项目。')
      const state = await options.pipeline.state(project)
      const bundle = buildRagExport({ projectId: project.id, documents: state.documents.map(document => ({
        ...normalizeImportDocument(document), hash: document.sha256,
      })), rawDocuments: state.documents, cards: state.cards, sources: project.input.sources })
      response.json(await retrieveProjectEvidence(project, bundle, state.documents, body, options.ranker || capabilityRetrievalRanker))
    } catch (error) {
      if (response.headersSent) return
      if (error instanceof z.ZodError) { response.status(422).json({ code: 'VALIDATION_ERROR', detail: error.message }); return }
      const value = error as { status?: number; code?: string; message?: string }
      if (error instanceof ExperienceError || Number.isInteger(value.status) && typeof value.code === 'string') {
        response.status(value.status!).json({ code: value.code, detail: value.message }); return
      }
      console.warn('RAG_RETRIEVAL_REQUEST_FAILED')
      response.status(500).json({ code: 'RAG_RETRIEVAL_REQUEST_FAILED', detail: '材料检索未完成，请检查本地运行记录。' })
    }
  })
}
