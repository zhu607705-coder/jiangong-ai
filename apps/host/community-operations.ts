import type { Express, Request, Response } from 'express'
import { z } from 'zod'
import type { ProjectRecord, Store } from './store'
import { ContractError } from '../../packages/contracts/validate'
import { OperationsService, OperationsError, type OperationsCalculator } from '../../packages/operations/service'
import { renderOperationsReport } from '../../packages/operations/report'

/** Inherits the host session, CSRF and owner-scoped project access gates. */
export async function registerCommunityOperations(app: Express, store: Store, requireProject: (id: string) => Promise<ProjectRecord>, calculator?: OperationsCalculator) {
  const service = new OperationsService(store, calculator)
  await service.initialize()
  const route = (operation: (req: Request, res: Response) => Promise<unknown>) => async (req: Request, res: Response) => {
    try { await operation(req, res) } catch (error) {
      if (error instanceof ContractError || error instanceof z.ZodError) return res.status(422).json({ code: 'VALIDATION_ERROR', detail: error.message })
      const typed = error as { status?: number; code?: string; message?: string }
      if (error instanceof OperationsError || Number.isInteger(typed.status) && typeof typed.code === 'string') return res.status(typed.status!).json({ code: typed.code, detail: typed.message })
      console.warn('OPERATIONS_REQUEST_FAILED', error instanceof Error ? error.name : 'unknown')
      return res.status(500).json({ code: 'OPERATIONS_REQUEST_FAILED', detail: '运营记录未保存，请核对本地服务后重试。' })
    }
  }
  const base = '/api/projects/:id/community-operations'
  app.get(base, route(async (req, res) => res.json(await service.workspace(await requireProject(String(req.params.id))))))
  app.post(`${base}/preview`, route(async (req, res) => {
    await requireProject(String(req.params.id))
    const body = z.object({ input: z.unknown() }).strict().parse(req.body)
    res.json(await service.preview(body.input))
  }))
  app.post(`${base}/scenarios`, route(async (req, res) => {
    const project = await requireProject(String(req.params.id))
    const body = z.object({ input: z.unknown(), expected_context_version: z.number().int().min(0) }).strict().parse(req.body)
    res.status(201).json(await service.freeze(project, body.input, body.expected_context_version))
  }))
  app.get(`${base}/scenarios/:snapshotId/report`, route(async (req, res) => {
    const project = await requireProject(String(req.params.id)), snapshot = await service.snapshot(project, String(req.params.snapshotId))
    res.setHeader('Content-Disposition', `attachment; filename="operations-${snapshot.id}.md"`)
    res.type('text/markdown').send(renderOperationsReport(snapshot, await service.workspace(project)))
  }))
  app.post(`${base}/observations`, route(async (req, res) => {
    const project = await requireProject(String(req.params.id))
    const body = z.object({ snapshot_id: z.string().min(1).max(100), observation: z.unknown() }).strict().parse(req.body)
    res.status(201).json(await service.observe(project, body.snapshot_id, body.observation))
  }))
  return service
}
