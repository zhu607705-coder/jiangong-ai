import type { Express } from 'express'
import { z } from 'zod'
import type { ProjectRecord, Store } from './store'
import { AMOUNT_KINDS, WORK_TYPES, ConstructionCostLibrary, constructionCostsCsv } from '../../packages/construction-costs/library'

const querySchema = z.object({ q: z.string().max(300).optional(), province: z.string().max(20).optional(), amount_kind: z.enum(AMOUNT_KINDS).optional(), work_type: z.enum(WORK_TYPES).optional(), scale_basis: z.string().max(100).optional(), year: z.coerce.number().int().min(1900).max(2200).optional() }).strict()

/** One library serves global reads; project aliases also enforce project ownership. */
export async function registerConstructionCosts(app: Express, store: Store, requireProject: (id: string) => Promise<ProjectRecord>, options: { root?: string } = {}): Promise<ConstructionCostLibrary> {
  const library = new ConstructionCostLibrary(store.db, options.root)
  await library.initialize()
  for (const projectScoped of [false, true]) for (const exportCsv of [false, true]) app.get<{ id?: string }>(`${projectScoped ? '/api/projects/:id' : '/api'}/construction-costs${exportCsv ? '/export' : ''}`, async (request, response, next) => {
    try {
      if (projectScoped) await requireProject(String(request.params.id))
      const result = await library.search(querySchema.parse(request.query))
      if (!exportCsv) { response.json(result); return }
      response.setHeader('Content-Type', 'text/csv; charset=utf-8')
      response.setHeader('Content-Disposition', 'attachment; filename="construction-costs.csv"')
      response.send(constructionCostsCsv(result.items))
    } catch (error) {
      if (error instanceof z.ZodError) response.status(422).json({ code: 'INVALID_COST_QUERY', detail: '造价筛选条件格式不正确。' })
      else next(error)
    }
  })
  return library
}
