import { screeningError } from '../../packages/maps/screening-errors'
import type { MapRegionGeometry } from './generated/contracts'
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
import { resolveMapRegions } from '../../services/map-screening/regions'
import { assertScreenBounds, SCREEN_PROFILES } from '../../packages/maps/screening-policy'
import { validate } from '../../packages/contracts/validate'

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
  const service = new MapScreeningService(new AmapEvidenceProvider(settings), join(config.dataDir, 'map-screening'), analyzeMapContext, loadEvidence, resolveMapRegions)
  let activeScreens = 0
  app.get('/api/maps/data', async (_req, res) => res.json(dataCatalog(await loadEvidence())))
  app.get('/api/maps/screening/profiles', (_req, res) => res.json(SCREEN_PROFILES))
  app.get('/api/maps/screening/analysis/:id',async(req,res)=>{
    try{const profile=profileSchema.parse(req.query.profile);res.json(await service.savedAnalysis(String(req.params.id),profile,requestSignal(req,res,10000)))}
    catch(error){failure(res,error)}
  })
  app.post('/api/maps/geometry/wgs84',async(req,res)=>{
    try{
      const body=z.object({geometry:z.unknown()}).strict().parse(req.body)
      const geometry=validate('MapRegionGeometry',body.geometry)
      const response=await fetch(config.capabilityUrl+'/spatial/selected-geometry',{method:'POST',signal:requestSignal(req,res,12000),headers:{'Content-Type':'application/json','X-Capability-Token':config.capabilityToken},body:JSON.stringify({geometry})})
      if(!response.ok)throw new Error('GEOMETRY_CONVERSION_FAILED')
      const result=await response.json() as {geometry:unknown;coordinate_encoding:string}
      if(result.coordinate_encoding!=='WGS84')throw new Error('GEOMETRY_CONVERSION_FAILED')
      res.json({geometry:validate('Geometry',result.geometry),coordinate_encoding:'WGS84'})
    }catch{if(!res.destroyed)res.status(422).json({code:'GEOMETRY_CONVERSION_FAILED',detail:'所选边界转换未完成，请保留当前选区并重试。'})}
  })
  app.post('/api/maps/screening/context', async (req, res) => {
    if (!settings.publicConfiguration().configured) return res.status(424).json({ code: 'MAP_NOT_CONFIGURED', detail: '请先连接高德地图。' })
    try {
      const body = z.object({ target: z.unknown() }).strict().parse(req.body)
      const context = await service.context(body.target, requestSignal(req, res, 30000))
      if (!res.destroyed) res.json(context)
    } catch (error) { failure(res, error) }
  })
  app.post('/api/maps/screening/analysis', async (req, res) => {
    let streaming=false
    try {
      const body=z.object({context_id:z.string().max(100),profile:profileSchema}).strict().parse(req.body)
      streaming=req.headers.accept?.includes('application/x-ndjson')||false
      const signal=requestSignal(req,res,115000)
      if(streaming){res.type('application/x-ndjson');res.setHeader('Cache-Control','no-store');res.setHeader('X-Accel-Buffering','no');res.flushHeaders()}
      const emit=(event:unknown)=>{if(streaming&&!res.destroyed&&!res.writableEnded)res.write(JSON.stringify(event)+'\n')}
      const result=await service.analyze(body.context_id,body.profile,signal,emit)
      if(!res.destroyed){if(streaming){emit({type:'complete',result});res.end()}else res.json(result)}
    } catch(error){
      if(streaming){if(!res.destroyed){res.write(JSON.stringify({type:'error',message:'本轮研究已结束，请刷新资料后重试。'})+'\n');res.end()}}
      else failure(res,error)
    }
  })
  app.post('/api/maps/screening/scan', async (req, res) => {
    if (!settings.publicConfiguration().configured) return res.status(424).json({ code: 'MAP_NOT_CONFIGURED', detail: '请先连接高德地图。' })
    if (activeScreens >= 1) return res.status(409).json({ code: 'MAP_SCAN_ACTIVE', detail: '已有区域标色正在进行，可先停止。' })
    const bodySchema = z.object({ bounds: boundsSchema, profile: profileSchema, theme: z.enum(['overall','implementation','adaptation','demand','supply','operations','resources','access']), geometry:z.unknown().optional() }).strict()
    let body: z.infer<typeof bodySchema>
    try { body = bodySchema.parse(req.body); assertScreenBounds(body.bounds) }
    catch { return res.status(422).json({ code: 'MAP_SCAN_RANGE', detail: '请在街区范围内筛选，或放大地图后重试。' }) }
    const signal = requestSignal(req, res, 60000)
    res.type('application/x-ndjson'); res.setHeader('Cache-Control', 'no-store'); res.flushHeaders()
    const emit = (event: unknown) => { if (!res.destroyed && !res.writableEnded) res.write(JSON.stringify(event) + '\n') }
    activeScreens++
    try { await service.screen(body.bounds, body.profile, body.theme, signal, emit,body.geometry?validate<MapRegionGeometry>('MapRegionGeometry',body.geometry):undefined) }
    catch(error) {
      const failure=screeningError(error,signal),requestId=String(res.getHeader('X-Request-ID')||'')
      console.warn(JSON.stringify({event:'map_scan_failed',request_id:requestId,code:failure.code}))
      emit({type:'error',...failure,request_id:requestId})
    }
    finally { activeScreens--; if (!res.destroyed) res.end() }
  })
}
