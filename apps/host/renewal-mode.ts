import type { Express, Request, Response } from 'express'
import { z } from 'zod'
import { createHash } from 'node:crypto'
import type { Store, ProjectRecord } from './store'
import { config } from './config'
import type { ConstructionCostLibrary } from '../../packages/construction-costs/library'
import { projectDecisionInput, type DecisionInput } from '../../packages/decision/structured-route'
import type { DecisionSupport } from './generated/contracts'
import type { RenewalModePacket, ModeHistory } from '../../packages/retrofit/renewal-mode'
import { evaluateDecision, decisionCacheDescriptor } from '../../services/capabilities/decision-model'
import { renewalHistory } from '../../services/map-screening/renewal-history'
import { validate } from '../../packages/contracts/validate'
import { researchRenewalStrategy } from '../../services/map-screening/renewal-strategy'
import { STRATEGY_POLICY, type StrategyPacket, type StrategyStreamEvent, type StrategySource } from '../../packages/retrofit/strategy'
import { listPublishedStrategies, readPublishedStrategy } from './strategy-publication'
import { ResearchRoundsService, ResearchRoundError, registerResearchRoundRoutes } from './research-rounds'

export type ModeContextLoader = (id: string, signal: AbortSignal) => Promise<DecisionInput>
const bodySchema = z.object({ expected_context_version: z.number().int().nonnegative().optional(), refresh: z.boolean().optional() }).strict()
function requestSignal(req: Request, res: Response) {
  const controller = new AbortController()
  req.once('aborted', () => controller.abort())
  res.once('close', () => { if (!res.writableEnded) controller.abort() })
  return AbortSignal.any([controller.signal, AbortSignal.timeout(240000)])
}

async function prepareMode(input: DecisionInput, library: ConstructionCostLibrary, history?: ModeHistory) {
  if (!input.renewalMode) throw new Error('MODE_INPUT_MISSING')
  delete input.dashboard
  const previous = input.state as { scope?: unknown; target?: unknown; as_of?: string; synthetic?: boolean }
  input.state = { purpose: '先判定老旧小区更新模式，再安排六维方案与调查', scope: previous.scope || previous.target,
    as_of: previous.as_of, synthetic: previous.synthetic || false, verified_conditions: input.factors }
  input.renewalMode.history = history ?? await renewalHistory(library)
  const hash = createHash('sha256').update(JSON.stringify(decisionCacheDescriptor(input, { model: config.QWEN_DECISION_MODEL, endpoint: config.QWEN_DECISION_ENDPOINT }))).digest('hex')
  return { input, hash }
}
function strategyHash(modeHash: string, version: number, demo: 'true' | 'false') {
  return createHash('sha256').update(JSON.stringify({modeHash,version,policy:STRATEGY_POLICY+(demo==='true'?'-readable-demo-v2':''),model:config.DEEPSEEK_MODEL,demo})).digest('hex')
}
async function workPlanReferences(library: ConstructionCostLibrary, asOf: string): Promise<StrategySource[]> {
  if (typeof library.search !== 'function') return []
  const results = await Promise.allSettled(['浙江省','上海市','广东省'].map(province=>library.search({province,work_type:'construction'})))
  const selected: StrategySource[] = []
  for (const [index,result] of results.entries()) {
    if (result.status !== 'fulfilled') continue
    const seen = new Set<string>()
    for (const item of result.value.items) {
      const scope = item.scope_quote || item.scale_quote
      const date = item.source.published_at || item.notice_date
      if (!scope || !/道路|排水|供水|管网|立面|屋面|电梯|消防|适老|绿化/.test(scope) || date && date.slice(0,10)>asOf.slice(0,10) || seen.has(item.project_name)) continue
      seen.add(item.project_name)
      selected.push({id:`COST-REF-${item.id}`,title:`${item.province} · ${item.project_name} · 工程内容参考`,role:'reference',visibility:'public',data_class:'public',url:item.source.url,published_at:date||null,locator:`cost:${item.id}:scope_quote`,
        text:`项目：${item.project_name}\n来源范围原文：\n${scope}\n金额阶段：${item.amount_kind}\n金额原文：\n${item.amount_quote}\n案例数量与金额按该历史项目使用。`})
      if (seen.size >= (index===0?2:1)) break
    }
  }
  return selected.slice(0,4)
}

/** A bounded read capability; source/version keyed results use the existing Store. */
export async function registerRenewalMode(app: Express, store: Store, requireProject: (id: string) => Promise<ProjectRecord>, library: ConstructionCostLibrary,
  loadMap: ModeContextLoader) {
  await store.db.exec(`CREATE TABLE IF NOT EXISTS renewal_mode_assessments (
    owner_id TEXT NOT NULL, target_id TEXT NOT NULL, input_hash TEXT NOT NULL, payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(owner_id,target_id,input_hash));`)
  await store.db.exec(`CREATE TABLE IF NOT EXISTS renewal_strategy_assessments (
    owner_id TEXT NOT NULL, project_id TEXT NOT NULL REFERENCES projects(id), input_hash TEXT NOT NULL,
    payload JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(owner_id,project_id,input_hash));`)
  app.get('/api/projects/public-decisions', async (_req,res,next) => {
    try {
      const history = await renewalHistory(library)
      const items = await listPublishedStrategies(store,config.ownerId,async project => {
        const {hash} = await prepareMode(projectDecisionInput(project.input),library,history)
        return strategyHash(hash,project.context_version,'false')
      })
      res.json({items})
    } catch(error) { next(error) }
  })
  const running = new Set<string>()
  for (const map of [false, true]) for (const method of ['get', 'post'] as const) app[method](map ? '/api/maps/screening/renewal-mode/:id' : '/api/projects/:id/renewal-mode', async (req, res, next) => {
    let key: string | undefined
    try {
      const id = String(req.params.id), signal = requestSignal(req, res), body = method === 'post' ? bodySchema.parse(req.body) : {}
      const project = map ? null : await requireProject(id)
      if (project && project.input.business_profile !== 'neighborhood') return res.status(422).json({ detail: '请在老旧小区项目中进行模式判定。' })
      if (project && body.expected_context_version !== undefined && body.expected_context_version !== project.context_version) return res.status(409).json({ detail: '项目资料已变化，请刷新后判定。' })
      const { input, hash } = await prepareMode(project ? projectDecisionInput(project.input) : await loadMap(id, signal), library)
      const cached = (await store.db.query<{ payload: DecisionSupport }>('SELECT payload FROM renewal_mode_assessments WHERE owner_id=$1 AND target_id=$2 AND input_hash=$3', [config.ownerId, id, hash])).rows[0]?.payload
      let decision = cached ? validate<DecisionSupport>('DecisionSupport', cached) : null
      if (method === 'post' && (body.refresh || !decision)) {
        if (!config.decisionEnabled) return res.status(424).json({ detail: '请先在模型设置中启用 decision。' })
        key = id + ':' + hash
        if (running.has(key) || running.size >= 2) { key = undefined; return res.status(409).json({ detail: '模式判定正在进行，请稍后查看。' }) }
        running.add(key)
        decision = await evaluateDecision(input, signal)
        signal.throwIfAborted()
        // Recheck the exact snapshot before saving or displaying an asynchronous result.
        if (project && (await requireProject(id)).context_version !== project.context_version) return res.status(409).json({ detail: '判定期间项目资料已变化，请刷新后重新判定。' })
        if (map) await loadMap(id, signal)
        if (decision.status === 'completed') await store.db.query('INSERT INTO renewal_mode_assessments(owner_id,target_id,input_hash,payload) VALUES($1,$2,$3,$4) ON CONFLICT(owner_id,target_id,input_hash) DO UPDATE SET payload=EXCLUDED.payload,created_at=now()', [config.ownerId, id, hash, JSON.stringify(decision)])
      }
      if (!res.destroyed) res.json({ screening: input.renewalMode!, decision } satisfies RenewalModePacket)
    } catch (error) {
      if (res.destroyed) return
      if (error instanceof z.ZodError) res.status(422).json({ detail: '模式判定请求格式不正确。' })
      else if (error instanceof Error && error.message.startsWith('CONTEXT_')) res.status(409).json({ detail: '地图资料已变化或过期，请刷新小窗。' })
      else next(error)
    } finally { if (key) running.delete(key) }
  })
  for (const method of ['get','post'] as const) app[method]('/api/projects/:id/renewal-strategy', async (req,res,next) => {
    let key: string | undefined
    let streaming = false
    const emit = (event: StrategyStreamEvent) => { if (streaming && !res.destroyed && !res.writableEnded) res.write(JSON.stringify(event) + '\n') }
    try {
      const project = await requireProject(String(req.params.id)), signal = requestSignal(req,res)
      if (project.input.business_profile !== 'neighborhood') return res.status(422).json({ detail:'请在老旧小区项目中研究更新方案。' })
      const query = z.object({ demo:z.enum(['true','false']).default('false') }).strict().parse(req.query)
      const body = method==='post'?bodySchema.parse(req.body):{}
      if (body.expected_context_version!==undefined && body.expected_context_version!==project.context_version) return res.status(409).json({detail:'项目资料已变化，请刷新方案。'})
      const {input,hash:modeHash} = await prepareMode(projectDecisionInput(project.input),library)
      const hash = strategyHash(modeHash,project.context_version,query.demo)
      const cached = (await store.db.query<{payload:StrategyPacket}>('SELECT payload FROM renewal_strategy_assessments WHERE owner_id=$1 AND project_id=$2 AND input_hash=$3',[config.ownerId,project.id,hash])).rows[0]?.payload
      if (method==='get') { res.json(await readPublishedStrategy(store,project,hash,query.demo==='true')||(cached?.status==='completed'?null:cached)||null); return }
      if (cached&&!body.refresh) { res.json(cached); return }
      key='strategy:'+project.id+':'+hash
      if (running.has(key)||running.size>=2) {key=undefined;return res.status(409).json({detail:'方案研究正在进行，请稍后查看。'})}
      running.add(key)
      const prior = (await store.db.query<{payload:DecisionSupport}>('SELECT payload FROM renewal_mode_assessments WHERE owner_id=$1 AND target_id=$2 AND input_hash=$3',[config.ownerId,project.id,modeHash])).rows[0]?.payload||null
      streaming = req.headers.accept?.includes('application/x-ndjson') || false
      if (streaming) { res.type('application/x-ndjson'); res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Accel-Buffering', 'no'); res.flushHeaders() }
      const savedResearch = cached?.status==='failed' && cached.project_id===project.id && cached.context_version===project.context_version && cached.input_hash===hash && cached.synthetic===(query.demo==='true')
        && Date.now()-Date.parse(cached.created_at)<20*60_000 && cached.model_calls.some(call=>call.finish_reason==='max-tokens') && cached.research?.queries.length
        && cached.sources.length && cached.sources.every(source=>source.visibility!=='internal'&&source.data_class!=='internal') ? {sources:cached.sources,research:cached.research} : undefined
      const result = await researchRenewalStrategy(project.input,project.context_version,input,hash,query.demo==='true',signal,prior,{onProgress:emit,referenceSources:await workPlanReferences(library,project.input.as_of),savedResearch})
      signal.throwIfAborted()
      if ((await requireProject(project.id)).context_version!==project.context_version) {
        if (streaming) { emit({type:'error',message:'研究期间资料已变化，请刷新后重新研究。'}); res.end(); return }
        return res.status(409).json({detail:'研究期间资料已变化，请刷新后重新研究。'})
      }
      if (!cached || cached.status !== 'completed' || result.status === 'completed') {
        await store.db.query('INSERT INTO renewal_strategy_assessments(owner_id,project_id,input_hash,payload) VALUES($1,$2,$3,$4) ON CONFLICT(owner_id,project_id,input_hash) DO UPDATE SET payload=EXCLUDED.payload,created_at=now()',[config.ownerId,project.id,hash,JSON.stringify(result)])
      }
      if (result.decision?.status==='completed' && query.demo==='false') await store.db.query('INSERT INTO renewal_mode_assessments(owner_id,target_id,input_hash,payload) VALUES($1,$2,$3,$4) ON CONFLICT(owner_id,target_id,input_hash) DO UPDATE SET payload=EXCLUDED.payload,created_at=now()',[config.ownerId,project.id,modeHash,JSON.stringify(result.decision)])
      if (!res.destroyed) { if (streaming) { emit({type:'complete',result}); res.end() } else res.json(result) }
    } catch(error) {
      if (!res.destroyed) {
        if (streaming) { emit({type:'error',message:'本轮方案研究已结束，已取得的进度保留。请查看资料或稍后重新研究。'}); res.end() }
        else if(error instanceof z.ZodError) res.status(422).json({detail:'方案研究请求格式不正确。'})
        else next(error)
      }
    }
    finally {if(key)running.delete(key)}
  })
  const researchRounds = new ResearchRoundsService(store,requireProject,async(project,hash,signal,roundContext,onProgress)=>{
    const key='round:'+project.id
    if(running.has(key)||running.size>=2) throw new ResearchRoundError(409,'ROUND_CAPACITY','已有方案研究正在进行，请稍后创建新的研究轮次。')
    running.add(key)
    try {
      // Public projection is deliberately independent from the selected internal material manifest.
      const {input}=await prepareMode(projectDecisionInput(project.input),library)
      return await researchRenewalStrategy(project.input,project.context_version,input,hash,project.input.synthetic,signal,null,{onProgress,roundContext,referenceSources:await workPlanReferences(library,project.input.as_of)})
    } finally {running.delete(key)}
  })
  await researchRounds.initialize()
  registerResearchRoundRoutes(app,researchRounds,requireProject,requestSignal)
  return researchRounds
}
