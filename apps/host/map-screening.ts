import type { Express, Request, Response } from 'express'
import { join } from 'node:path'
import { z } from 'zod'
import { config } from './config'
import type { AmapSettings } from './amap'
import type { Store } from './store'
import { dataCatalog, loadProjectEvidence } from '../../services/map-screening/project-evidence'
import { AmapEvidenceProvider } from '../../services/map-screening/provider'
import { MapScreeningService } from '../../services/map-screening/service'
import { analyzeMapContext } from '../../services/map-screening/analyst'
import { assertScreenBounds, SCREEN_PROFILES } from '../../packages/maps/screening-policy'

const profileSchema = z.enum(['balanced', 'commercial', 'enterprise'])
const boundsSchema = z.object({ west: z.number().finite(), south: z.number().finite(), east: z.number().finite(), north: z.number().finite() }).strict()
function requestSignal(req: Request, res: Response, timeout: number) {
  const controller = new AbortController()
  req.once('aborted', () => controller.abort())
  res.once('close', () => { if (!res.writableEnded) controller.abort() })
  return AbortSignal.any([controller.signal, AbortSignal.timeout(timeout)])
}
function failure(res: Response, error: unknown) {
  const message = error instanceof Error ? error.message : ''
  const detail = message === 'CONTEXT_EXPIRED' ? '资料快照已过期，请刷新初筛信息。' : message === 'CONTEXT_NOT_FOUND' ? '初筛资料不存在，请重新选择区域。' : '初筛请求未完成，请检查范围或稍后重试。'
  if (!res.destroyed) res.status(message.startsWith('CONTEXT_') ? 409 : 422).json({ code: 'MAP_SCREENING_FAILED', detail })
}
export function registerMapScreening(app: Express, settings: AmapSettings, store: Store) {
  const loadEvidence = () => loadProjectEvidence(store, config.ownerId)
  const service = new MapScreeningService(new AmapEvidenceProvider(settings), join(config.dataDir, 'map-screening'), analyzeMapContext, loadEvidence)
  let activeScreens = 0
  app.get('/api/maps/data', async (_req, res) => res.json(dataCatalog(await loadEvidence())))
  app.get('/api/maps/screening/profiles', (_req, res) => res.json(SCREEN_PROFILES))
  app.post('/api/maps/screening/context', async (req, res) => {
    if (!settings.publicConfiguration().configured) return res.status(424).json({ code: 'MAP_NOT_CONFIGURED', detail: '请先连接高德地图。' })
    try {
      const body = z.object({ target: z.unknown() }).strict().parse(req.body)
      const context = await service.context(body.target, requestSignal(req, res, 30000))
      if (!res.destroyed) res.json(context)
    } catch (error) { failure(res, error) }
  })
  app.post('/api/maps/screening/analysis', async (req, res) => {
    try {
      const body = z.object({ context_id: z.string().max(100), profile: profileSchema }).strict().parse(req.body)
      const result = await service.analyze(body.context_id, body.profile, requestSignal(req, res, 40000))
      if (!res.destroyed) res.json(result)
    } catch (error) { failure(res, error) }
  })
  app.post('/api/maps/screening/scan', async (req, res) => {
    if (!settings.publicConfiguration().configured) return res.status(424).json({ code: 'MAP_NOT_CONFIGURED', detail: '请先连接高德地图。' })
    if (activeScreens >= 1) return res.status(409).json({ code: 'MAP_SCAN_ACTIVE', detail: '已有区域筛选正在进行，请等待完成或先停止。' })
    const bodySchema = z.object({ bounds: boundsSchema, profile: profileSchema, theme: z.enum(['transit', 'activity', 'work_live', 'civic', 'projects']) }).strict()
    let body: z.infer<typeof bodySchema>
    try { body = bodySchema.parse(req.body); assertScreenBounds(body.bounds) }
    catch { return res.status(422).json({ code: 'MAP_SCAN_RANGE', detail: '请在街区范围内筛选，或放大地图后重试。' }) }
    const signal = requestSignal(req, res, 60000)
    res.type('application/x-ndjson'); res.setHeader('Cache-Control', 'no-store'); res.flushHeaders()
    const emit = (event: unknown) => { if (!res.destroyed && !res.writableEnded) res.write(JSON.stringify(event) + '\n') }
    activeScreens++
    try { await service.screen(body.bounds, body.profile, body.theme, signal, emit) }
    catch { emit({ type: 'error', message: signal.aborted ? '本轮筛选已停止或超过时间预算。已显示资料仅代表已完成的网格。' : '本轮区域筛选未完成，可稍后重试。' }) }
    finally { activeScreens--; if (!res.destroyed) res.end() }
  })
}
