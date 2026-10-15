import type { Express, Request, Response } from 'express'
import { z } from 'zod'
import { createHash } from 'node:crypto'
import type { Store, ProjectRecord } from './store'
import { config } from './config'
import type { ConstructionCostLibrary } from '../../packages/construction-costs/library'
import { projectDecisionInput, type DecisionInput } from '../../packages/decision/structured-route'
import type { DecisionSupport } from './generated/contracts'
import type { RenewalModePacket } from '../../packages/retrofit/renewal-mode'
import { evaluateDecision, decisionCacheDescriptor } from '../../services/capabilities/decision-model'
import { renewalHistory } from '../../services/map-screening/renewal-history'
import { validate } from '../../packages/contracts/validate'
import { researchRenewalStrategy } from '../../services/map-screening/renewal-strategy'
import { STRATEGY_POLICY, type StrategyPacket, type StrategyStreamEvent } from '../../packages/retrofit/strategy'

export type ModeContextLoader = (id: string, signal: AbortSignal) => Promise<DecisionInput>
const bodySchema = z.object({ expected_context_version: z.number().int().nonnegative().optional(), refresh: z.boolean().optional() }).strict()
function requestSignal(req: Request, res: Response) {
  const controller = new AbortController()
  req.once('aborted', () => controller.abort())
  res.once('close', () => { if (!res.writableEnded) controller.abort() })
  return AbortSignal.any([controller.signal, AbortSignal.timeout(145000)])
}

async function prepareMode(input: DecisionInput, library: ConstructionCostLibrary) {
  if (!input.renewalMode) throw new Error('MODE_INPUT_MISSING')
  delete input.dashboard
  const previous = input.state as { scope?: unknown; target?: unknown; as_of?: string; synthetic?: boolean }
  input.state = { purpose: '先判定老旧小区更新模式，再安排六维方案与调查', scope: previous.scope || previous.target,
    as_of: previous.as_of, synthetic: previous.synthetic || false, verified_conditions: input.factors }
  input.renewalMode.history = await renewalHistory(library)
  const hash = createHash('sha256').update(JSON.stringify(decisionCacheDescriptor(input, { model: config.QWEN_DECISION_MODEL, endpoint: config.QWEN_DECISION_ENDPOINT }))).digest('hex')
  return { input, hash }
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
      const hash = createHash('sha256').update(JSON.stringify({modeHash,version:project.context_version,policy:STRATEGY_POLICY+(query.demo==='true'?'-readable-demo-v2':''),model:config.DEEPSEEK_MODEL,demo:query.demo})).digest('hex')
      const cached = (await store.db.query<{payload:StrategyPacket}>('SELECT payload FROM renewal_strategy_assessments WHERE owner_id=$1 AND project_id=$2 AND input_hash=$3',[config.ownerId,project.id,hash])).rows[0]?.payload
      if (method==='get' || cached&&!body.refresh) { res.json(cached||null); return }
      key='strategy:'+project.id+':'+hash
      if (running.has(key)||running.size>=2) {key=undefined;return res.status(409).json({detail:'方案研究正在进行，请稍后查看。'})}
      running.add(key)
      const prior = (await store.db.query<{payload:DecisionSupport}>('SELECT payload FROM renewal_mode_assessments WHERE owner_id=$1 AND target_id=$2 AND input_hash=$3',[config.ownerId,project.id,modeHash])).rows[0]?.payload||null
      streaming = req.headers.accept?.includes('application/x-ndjson') || false
      if (streaming) { res.type('application/x-ndjson'); res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Accel-Buffering', 'no'); res.flushHeaders() }
      const result = await researchRenewalStrategy(project.input,project.context_version,input,hash,query.demo==='true',signal,prior,{onProgress:emit})
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
}
