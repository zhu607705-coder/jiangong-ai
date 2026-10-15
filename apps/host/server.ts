import express from 'express'
import helmet from 'helmet'
import multer from 'multer'
import { randomUUID, createHash } from 'node:crypto'
import { readFile, mkdir, writeFile, unlink } from 'node:fs/promises'
import { join, extname } from 'node:path'
import { z } from 'zod'
import { config } from './config'
import { Store, type RunRecord, type ProjectRecord } from './store'
import { ContractError, projectInput } from '../../packages/contracts/validate'
import { compileContext, applyContextPatch } from '../../packages/context/compiler'
import { compileModelContext } from '../../packages/context/model-compiler'
import { revisionDiff } from '../../packages/decision/evaluate'
import { executeRun, digest } from '../../runtime/workflows/run'
import { researchSnapshot, resolveRunKnowledge } from '../../runtime/workflows/knowledge'
import { renderReport } from './reports'
import { parseDocument, tableFacts, uploadFileName, DocumentParseError } from './ingest'
import { AmapSettings, registerAmap } from './amap'
import { registerMapScreening } from './map-screening'
import { registerIntelligence } from './intelligence'
import { registerExperience } from './experience'
import { registerCommunityOperations } from './community-operations'
import { registerConstructionCosts } from './construction-costs'
import { registerRenewalMode } from './renewal-mode'
import { parseResearchMaterialMetadata } from './research-rounds'
import { ExperienceError } from '../../packages/experience/domain'
import { AdminAccess, registerAdminRoutes } from './admin-auth'
import { renderAdminLoginPage } from './admin-login-page'
import { describeWorkbenchDatabase } from './database-schema'
import { publicProjectInput } from './public-project'

class ApiError extends Error { constructor(readonly status: number, readonly code: string, message: string) { super(message) } }
const store = await Store.open(config.dataDir, config.DATABASE_URL)
// A crashed run stays visible and retryable; never silently publish a partial result as completed.
await store.db.query("UPDATE runs SET status='failed',error_code='INTERRUPTED_RESTART' WHERE status='running'")
const app = express()
const amapSettings = new AmapSettings(config.dataDir)
await amapSettings.load()
const adminAccess = new AdminAccess(config.ADMIN_USERNAME, config.ADMIN_PASSWORD_HASH, config.ADMIN_SESSION_TTL_SECONDS, config.PUBLIC_READ_ONLY === 'true', config.collaborativeWorkspace)
const controllers = new Map<string, AbortController>()
const active = new Set<Promise<void>>()
const { allowedHosts, allowedOrigins } = config.requestOrigins
app.disable('x-powered-by')
app.use(helmet({ contentSecurityPolicy: false }))
app.use((req, res, next) => {
  const requestId = randomUUID(); res.setHeader('X-Request-ID', requestId)
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store')
  res.on('finish', () => { console.log(JSON.stringify({ event: 'http', request_id: requestId, method: req.method, status: res.statusCode, path: req.path.replace(/[a-f0-9-]{36}/g, ':id') })) })
  if (!allowedHosts.has(req.headers.host || '')) return next(new ApiError(403, 'INVALID_HOST', '访问地址不在授权范围内'))
  if (req.headers.origin && !allowedOrigins.has(req.headers.origin)) return next(new ApiError(403, 'INVALID_ORIGIN', '来源不在授权范围内'))
  next()
})
app.use(express.json({ limit: '4mb' }))
app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'haizhizi-host' }))
registerAdminRoutes(app, adminAccess, () => ({ user: { id: config.ownerId, label: config.collaborativeWorkspace ? '校园协作用户' : adminAccess.enabled ? `管理员 ${config.ADMIN_USERNAME}` : '本地项目负责人' }, deployment: config.collaborativeWorkspace ? 'campus_collaborative' : adminAccess.enabled ? 'single_admin_server' : 'single_operator_local', model_configured: config.modelConfigured, search_configured: config.searchConfigured, database: store.kind,
  decision_model:{enabled:config.decisionEnabled,configured:config.decisionConfigured,model:config.QWEN_DECISION_MODEL} }), renderAdminLoginPage)
app.use(['/api', '/_AMapService'], (req, res, next) => {
  if (!adminAccess.identity(req.headers.cookie) && res.locals.workbenchRole !== 'viewer') return next(new ApiError(401, 'SESSION_REQUIRED', '会话已更新，请刷新页面'))
  if (!['GET', 'HEAD'].includes(req.method) && req.headers['x-requested-with'] !== 'haizhizi') return next(new ApiError(403, 'CSRF_GUARD', '缺少工作台请求标识'))
  next()
})
const intelligence = registerIntelligence(app,store)
const experience = await registerExperience(app,store,requireProject)
await registerCommunityOperations(app,store,requireProject)
const costLibrary = await registerConstructionCosts(app,store,requireProject)
registerAmap(app, amapSettings)
const mapScreening = registerMapScreening(app, amapSettings, store)
const researchRounds = await registerRenewalMode(app,store,requireProject,costLibrary,(id,signal)=>mapScreening.modeInput(id,signal))
app.get('/api/ready', async (_req, res) => {
  let capability = false
  try { capability = (await fetch(`${config.capabilityUrl}/health`, { signal: AbortSignal.timeout(1500) })).ok } catch { /* explicit unavailable status below */ }
  res.status(capability ? 200 : 503).json({ status: capability ? 'ok' : 'degraded', database: store.kind, capabilities: capability, live_model: config.modelConfigured ? 'configured_not_verified' : 'blocked_external', live_search: config.searchConfigured ? 'configured_not_verified' : 'blocked_external' })
})
app.get('/api/admin/database-schema', async (req,res,next) => {
  try {
    const format = z.enum(['json','sql']).parse(req.query.format || 'json')
    const schema = await describeWorkbenchDatabase(store.db)
    res.setHeader('Content-Disposition', `attachment; filename="workbench-database-schema.${format}"`)
    if (format === 'sql') res.type('text/plain').send(schema.sql)
    else res.json(schema)
  } catch (error) { next(error) }
})
async function requireProject(id: string): Promise<ProjectRecord> {
  const record = await store.project(id, config.ownerId)
  if (!record) throw new ApiError(404, 'PROJECT_NOT_FOUND', '项目不存在或无权访问')
  return record
}
async function requireRun(id: string) {
  const run = await store.run(id, config.ownerId)
  if (!run) throw new ApiError(404, 'RUN_NOT_FOUND', '运行不存在或无权访问')
  return run
}
function launchRun(run: RunRecord) {
  if (run.status !== 'running' || controllers.has(run.id)) return
  const controller = new AbortController(); controllers.set(run.id, controller)
  const timeout = setTimeout(() => controller.abort(), run.execution_mode === 'live' ? 240_000 : 90_000)
  const task = executeRun(store, run, controller.signal).finally(() => { clearTimeout(timeout); controllers.delete(run.id); active.delete(task) })
  active.add(task)
}
app.get('/api/projects', async (_req, res) => {
  const projects = await store.projects(config.ownerId)
  res.json(res.locals.workbenchRole === 'viewer' ? projects.map(project => ({ ...project, input: publicProjectInput(project.input) })) : projects)
})
app.post('/api/projects', async (req, res) => {
  const body = z.object({ fixture: z.enum(['01_auto', '02_enterprise', '03_missing', '04_conflict', '05_injection']).optional(), input: z.unknown().optional(), name: z.string().trim().min(1).max(120).optional() }).strict().parse(req.body)
  if (Boolean(body.fixture) === Boolean(body.input)) throw new ApiError(422, 'INPUT_REQUIRED', '请选择样例或提供项目输入')
  const value = body.fixture ? JSON.parse(await readFile(join('fixtures/inputs', `${body.fixture}.json`), 'utf8')) : body.input
  const input = projectInput(value)
  // Every imported fixture becomes an isolated project; source fixture IDs are not global storage IDs.
  if (body.fixture) input.project_id = `P-${randomUUID()}`
  for (const rule of input.context_rules) rule.project_id = input.project_id
  await store.db.query('INSERT INTO projects(id,owner_id,name,input) VALUES($1,$2,$3,$4)', [input.project_id, config.ownerId, body.name || input.scope.name, JSON.stringify(input)])
  res.status(201).json(await requireProject(input.project_id))
})
app.get('/api/projects/:id', async (req, res) => {
  const project = await requireProject(req.params.id)
  if (res.locals.workbenchRole === 'viewer') return res.json({ ...project, input: publicProjectInput(project.input), runs: [] })
  res.json({ ...project, runs: (await store.runs(req.params.id)).map(({ snapshot, ...run }) => run) })
})
app.post('/api/projects/:id/map-anchor', async(req,res)=>{
  const project=await requireProject(String(req.params.id))
  const body=z.object({anchor:z.unknown(),expected_version:z.number().int().min(0)}).strict().parse(req.body)
  if(project.input.synthetic)throw new ApiError(422,'SYNTHETIC_MAP','合成项目不关联真实地图位置')
  const input=structuredClone(project.input);input.scope.map_anchor=body.anchor as ProjectRecord['input']['scope']['map_anchor']
  projectInput(input)
  const update=await store.db.query('UPDATE projects SET input=$1,context_version=context_version+1,updated_at=NOW() WHERE id=$2 AND context_version=$3 RETURNING id',[JSON.stringify(input),project.id,body.expected_version])
  if(!update.rows.length)throw new ApiError(409,'CONTEXT_VERSION_CONFLICT','项目资料已变化，请刷新后重新关联')
  res.json(await requireProject(project.id))
})

const knowledgeQuery = z.object({ measure_key: z.string().max(80), question: z.string().max(1000) }).strict()
const runBody = z.object({ mode: z.enum(['automatic', 'enterprise']).default('automatic'), execution_mode: z.enum(['offline', 'live']).default('offline'), idempotency_key: z.string().min(8).max(100), knowledge_query: knowledgeQuery.optional() }).strict()
app.post('/api/projects/:id/runs', async (req, res) => {
  const body = runBody.parse(req.body)
  const project = await requireProject(req.params.id)
  const existing = (await store.db.query<RunRecord>('SELECT * FROM runs WHERE project_id=$1 AND idempotency_key=$2', [project.id, body.idempotency_key])).rows[0]
  if (existing) {
    launchRun(existing)
    res.status(202).json({ id: existing.id, revision: existing.revision, status: existing.status })
    return
  }
  if (project.input.purpose === 'case_library_archive') throw new ApiError(422, 'KNOWLEDGE_ARCHIVE_ONLY', '资料库用于提取和复核案例规则，请选择具体待研究项目开展研判。')
  if (body.execution_mode === 'live' && !config.modelConfigured) throw new ApiError(424, 'BLOCKED_EXTERNAL', '真实研判需要Agent模型，案例或规则命中也需Agent分析；本地匹配和离线检查仍可使用。')
  const run = await store.db.transaction(async db => {
    await db.query('SELECT id FROM projects WHERE id=$1 FOR UPDATE', [project.id])
    const existing = (await db.query<RunRecord>('SELECT * FROM runs WHERE project_id=$1 AND idempotency_key=$2', [project.id, body.idempotency_key])).rows[0]
    if (existing) return existing
    if ((await db.query("SELECT id FROM runs WHERE project_id=$1 AND status='running'", [project.id])).rows.length) throw new ApiError(409, 'RUN_ACTIVE', '当前项目已有研判正在执行')
    const fresh = (await db.query<ProjectRecord>('SELECT * FROM projects WHERE id=$1', [project.id])).rows[0]
    const snapshot = researchSnapshot(fresh.input, body.mode, body.knowledge_query)
    const revision = Number((await db.query<{ revision: number }>('SELECT COALESCE(MAX(revision),0)+1 AS revision FROM runs WHERE project_id=$1', [project.id])).rows[0].revision)
    return (await db.query<RunRecord>('INSERT INTO runs(id,project_id,revision,context_version,status,execution_mode,snapshot,snapshot_hash,idempotency_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *', [`RUN-${randomUUID()}`, project.id, revision, fresh.context_version, 'running', body.execution_mode, JSON.stringify(snapshot), digest(snapshot), body.idempotency_key])).rows[0]
  })
  launchRun(run)
  res.status(202).json({ id: run.id, revision: run.revision, status: run.status })
})
app.post('/api/runs/:id/cancel', async (req, res) => { await requireRun(req.params.id); controllers.get(req.params.id)?.abort(); res.json({ status: 'cancellation_requested' }) })
app.post('/api/runs/:id/resume', async (req, res) => {
  const original = await requireRun(req.params.id)
  if (original.status !== 'failed' || controllers.has(original.id)) throw new ApiError(409, 'RUN_NOT_RESUMABLE', '只有已经停止的未完成运行可以恢复')
  const knowledge = await resolveRunKnowledge(store, original, AbortSignal.timeout(30000))
  if (original.execution_mode === 'live' && !config.modelConfigured) throw new ApiError(424, 'BLOCKED_EXTERNAL', '恢复真实Agent研判需要已配置的模型凭据，命中路线也需Agent分析')
  const run = await store.db.transaction(async db => {
    await db.query('SELECT id FROM projects WHERE id=$1 FOR UPDATE', [original.project_id])
    if ((await db.query("SELECT id FROM runs WHERE project_id=$1 AND status='running'", [original.project_id])).rows.length) throw new ApiError(409, 'RUN_ACTIVE', '同项目已有运行正在执行')
    return (await db.query<RunRecord>("UPDATE runs SET status='running',error_code=NULL WHERE id=$1 AND status='failed' RETURNING *", [original.id])).rows[0]
  })
  if (!run) throw new ApiError(409, 'RUN_NOT_RESUMABLE', '运行状态已变化，请刷新')
  await store.addEvent(run.id, 'resume', 'running', '从原冻结快照恢复，读取已完成子工件与 DSH 父会话')
  launchRun(run)
  res.status(202).json({ id: run.id, status: run.status, revision: run.revision })
})
app.get('/api/runs/:id', async (req, res) => { const { snapshot, ...run } = await requireRun(req.params.id); res.json(run) })
app.get('/api/runs/:id/trace', async (req, res) => { const run = await requireRun(req.params.id); res.json((await store.db.query('SELECT payload FROM artifacts WHERE project_id=$1 AND kind=$2 AND dependency_hash=$3', [run.project_id, 'model_trace', run.id])).rows[0]?.payload || []) })
app.get('/api/runs/:id/decision-packet', async (req, res) => { const run = await requireRun(req.params.id); if (!run.decision) throw new ApiError(409, 'DECISION_PENDING', '决策包尚未生成'); res.json(run.decision) })
app.get('/api/runs/:id/report', async (req, res) => { const run = await requireRun(req.params.id); if (!run.decision) throw new ApiError(409, 'DECISION_PENDING', '决策包尚未生成'); res.setHeader('Content-Disposition', `attachment; filename="decision-${run.id}.md"`); res.type('text/markdown').send(renderReport(run.decision)) })
app.get('/api/runs/:id/events', async (req, res) => {
  const run = await requireRun(req.params.id)
  res.setHeader('Content-Type', 'text/event-stream'); res.setHeader('Cache-Control', 'no-cache'); res.setHeader('Connection', 'keep-alive'); res.flushHeaders()
  let after = Number(req.headers['last-event-id'] || req.query.after || 0)
  if (!Number.isSafeInteger(after) || after < 0) after = 0
  let closed = false
  req.on('close', () => { closed = true })
  while (!closed) {
    const events = await store.events(run.id, after)
    for (const event of events) { res.write(`id: ${event.id}\nevent: progress\ndata: ${JSON.stringify(event)}\n\n`); after = event.id }
    const current = await store.run(run.id, config.ownerId)
    if (current?.status !== 'running') { res.write(`event: terminal\ndata: ${JSON.stringify({ status: current?.status })}\n\n`); break }
    res.write(': keepalive\n\n')
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  res.end()
})
const contextBody = z.object({ text: z.string().trim().min(1).max(20000), expected_version: z.number().int().min(0), compiler_mode: z.enum(['auto', 'model', 'local']).default('auto') }).strict()
async function compileRequestedContext(project: ProjectRecord, body: z.infer<typeof contextBody>) {
  if (body.expected_version !== project.context_version) throw new ApiError(409, 'CONTEXT_VERSION_CONFLICT', '项目经验已变化，请刷新后重试')
  const permitted = project.input.synthetic || config.ALLOW_INTERNAL_MODEL === 'true'
  if (body.compiler_mode === 'model' && (!config.modelConfigured || !permitted)) throw new ApiError(424, 'MODEL_CONTEXT_NOT_AUTHORIZED', '此项目尚未获准把内部原话发送给当前模型；仍可使用本地解析。')
  return body.compiler_mode !== 'local' && config.modelConfigured && permitted ? compileModelContext(project.input, body.text, true) : compileContext(project.input, body.text, true)
}
app.post('/api/projects/:id/context-proposals', async (req, res) => { const project = await requireProject(req.params.id); const body = contextBody.parse(req.body); res.json(await compileRequestedContext(project, body)) })
app.post('/api/projects/:id/context-updates', async (req, res) => {
  const project = await requireProject(req.params.id), body = contextBody.parse(req.body)
  const patch = await compileRequestedContext(project, body)
  const next = projectInput(applyContextPatch(project.input, patch))
  const updated = await store.db.query('UPDATE projects SET input=$1,context_version=context_version+1,updated_at=NOW() WHERE id=$2 AND context_version=$3 RETURNING id', [JSON.stringify(next), project.id, body.expected_version])
  if (!updated.rows.length) throw new ApiError(409, 'CONTEXT_VERSION_CONFLICT', '项目经验已在其他窗口更新，请刷新后重试')
  res.json({ ...await requireProject(project.id), patch })
})
app.post('/api/projects/:id/context-revoke', async (req, res) => {
  const project = await requireProject(req.params.id)
  const body = z.object({ rule_id: z.string(), expected_version: z.number().int().min(0) }).strict().parse(req.body)
  const input = structuredClone(project.input), rule = input.context_rules.find(r => r.id === body.rule_id)
  if (!rule) throw new ApiError(404, 'RULE_NOT_FOUND', '规则不存在')
  rule.active = false
  const updated = await store.db.query('UPDATE projects SET input=$1,context_version=context_version+1,updated_at=NOW() WHERE id=$2 AND context_version=$3 RETURNING id', [JSON.stringify(input), project.id, body.expected_version])
  if (!updated.rows.length) throw new ApiError(409, 'CONTEXT_VERSION_CONFLICT', '项目经验已变化，请刷新')
  res.json(await requireProject(project.id))
})
app.get('/api/projects/:id/revision-diff', async (req, res) => { await requireProject(req.params.id); const completed = (await store.runs(req.params.id)).filter(r => r.decision); res.json(revisionDiff(completed[1]?.decision || null, completed[0]?.decision || null)) })
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } })
app.post('/api/projects/:id/documents', upload.single('file'), async (req, res) => {
  const project = await requireProject(String(req.params.id)), file = req.file
  if (!file) throw new ApiError(422, 'FILE_REQUIRED', '请选择材料')
  const fileName = uploadFileName(file.originalname, req.body.original_file_name)
  const extension = extname(fileName).toLowerCase()
  if (!['.md', '.txt', '.csv', '.pdf', '.docx', '.xlsx'].includes(extension)) throw new ApiError(415, 'UNSUPPORTED_FORMAT', '支持 TXT、Markdown、CSV、PDF、DOCX、XLSX')
  const materialMetadata = parseResearchMaterialMetadata(req.body)
  const hash = createHash('sha256').update(file.buffer).digest('hex')
  const existing = (await store.db.query('SELECT id,file_name,parser_result FROM documents WHERE project_id=$1 AND sha256=$2', [project.id, hash])).rows[0]
  if (existing) {
    await researchRounds.recordMaterialMetadata(project, String(existing.id), materialMetadata)
    return res.json(existing)
  }
  const directory = join(config.dataDir, 'blobs', project.id); await mkdir(directory, { recursive: true })
  const id = `DOC-${randomUUID()}`, blob = `${id}${extension}`, path = join(directory, blob)
  await writeFile(path, file.buffer, { flag: 'wx' })
  let committed = false
  try {
    const parsed = await parseDocument({ documentId: id, fileName, filePath: path, projectRoot: process.cwd(), allowedBasePath: directory, mime: file.mimetype, type: 'workspace_material' })
    const isSynthetic = req.body.synthetic === 'true'
    const source = { id, title: fileName, data_class: isSynthetic ? 'synthetic' as const : 'internal' as const, visibility: 'internal' as const, synthetic: isSynthetic, untrusted_text: parsed.text.slice(0, 100000), hash, locator: `document:${id}`, content_status: 'uploaded' as const, parse_status: parsed.status as 'extracted' | 'empty' | 'ocr_required', retrieved_at: new Date().toISOString() }
    const updatedInput = structuredClone(project.input)
    if (updatedInput.synthetic !== isSynthetic) {
      // Uploading real material must not silently relabel the synthetic facts as real.
      throw new ApiError(422, 'SYNTHETIC_PROJECT', '资料类别必须与项目一致。合成资料须显式标记 synthetic=true；真实材料请上传到真实项目。')
    }
    updatedInput.sources.push(source)
    updatedInput.facts.push(...tableFacts(parsed.profile, id))
    projectInput(updatedInput)
    await store.db.transaction(async db => {
      const update = await db.query('UPDATE projects SET input=$1,context_version=context_version+1,updated_at=NOW() WHERE id=$2 AND context_version=$3 RETURNING id', [JSON.stringify(updatedInput), project.id, project.context_version])
      if (!update.rows.length) throw new ApiError(409, 'CONTEXT_VERSION_CONFLICT', '项目资料已变化，请刷新并重试')
      await db.query('INSERT INTO documents(id,project_id,file_name,blob_name,sha256,parser_result) VALUES($1,$2,$3,$4,$5,$6)', [id, project.id, fileName, blob, hash, JSON.stringify(parsed)])
    })
    committed = true
    await researchRounds.recordMaterialMetadata(await requireProject(project.id), id, materialMetadata)
    res.status(201).json({ id, file_name: fileName, parser_result: parsed })
  } catch (error) { if (!committed) await unlink(path); throw error }
})
app.get('/api/projects/:id/documents', async (req, res) => { await requireProject(req.params.id); res.json((await store.db.query('SELECT id,file_name,parser_result,created_at FROM documents WHERE project_id=$1', [req.params.id])).rows) })
app.post('/api/projects/:id/followups', async (req, res) => {
  await requireProject(req.params.id)
  const body = z.object({ run_id: z.string(), followup_id: z.string() }).strict().parse(req.body)
  const run = await requireRun(body.run_id)
  if (run.project_id !== req.params.id) throw new ApiError(403, 'PROJECT_SCOPE', '不能引用其他项目的调查项')
  const item = run.decision?.followups.find(f => f.id === body.followup_id)
  if (!item) throw new ApiError(404, 'FOLLOWUP_NOT_FOUND', '调查项不存在')
  const value = (await store.db.query('INSERT INTO followups(id,project_id,run_id,title) VALUES($1,$2,$3,$4) ON CONFLICT(project_id,run_id,title) DO UPDATE SET status=followups.status RETURNING *', [`FU-${randomUUID()}`, req.params.id, run.id, item.title])).rows[0]
  res.status(201).json(value)
})
app.get('/api/projects/:id/followups', async (req, res) => { await requireProject(req.params.id); res.json((await store.db.query('SELECT * FROM followups WHERE project_id=$1 ORDER BY created_at', [req.params.id])).rows) })
app.use(express.static('apps/workspace/dist'))
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (res.headersSent) return res.end()
  if (error instanceof z.ZodError || error instanceof ContractError) return res.status(422).json({ code: 'VALIDATION_ERROR', detail: error.message })
  if (error instanceof ApiError || error instanceof ExperienceError) return res.status(error.status).json({ code: error.code, detail: error.message })
  if (error instanceof DocumentParseError) return res.status(422).json({ code: 'PARSE_FAILED', detail: error.message })
  if (error instanceof multer.MulterError) return res.status(413).json({ code: error.code, detail: '材料超过 10 MB 限制或上传格式不正确' })
  if ((error as { code?: string })?.code === '23505') return res.status(409).json({ code: 'ALREADY_EXISTS', detail: '记录已存在，请刷新后重试' })
  console.error(JSON.stringify({ event: 'api_error', kind: error instanceof Error ? error.name : 'unknown' }))
  res.status(500).json({ code: 'INTERNAL_ERROR', detail: '服务处理失败，请查看本地运行记录' })
})
const server = app.listen(config.PORT, config.HOST, () => console.log(JSON.stringify({ event: 'host_ready', url: `http://${config.HOST}:${config.PORT}` })))
async function shutdown() { server.close(); adminAccess.close(); controllers.forEach(c => c.abort()); await Promise.allSettled([...active]); await intelligence.stop(); await store.db.close(); process.exit(0) }
process.once('SIGINT', () => void shutdown()); process.once('SIGTERM', () => void shutdown())
