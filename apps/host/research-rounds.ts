import { createHash, randomUUID } from 'node:crypto'
import type { Express, Request, Response } from 'express'
import { z } from 'zod'
import type { ProjectInput, RenewalStrategy } from './generated/contracts'
import type { Store, ProjectRecord, Database } from './store'
import { config } from './config'
import { validate } from '../../packages/contracts/validate'
import { projectRenewalModeInput } from '../../packages/retrofit/renewal-mode'
import { STRATEGY_POLICY, validateStrategy, strategyFailureMessage, type StrategyPacket, type StrategyProgress, type StrategySource } from '../../packages/retrofit/strategy'
import { RESEARCH_MATERIAL_CATEGORIES, type ResearchMaterial, type ResearchMaterialMetadata, type ResearchRound, type ResearchRoundsResponse, type ResearchRoundStreamEvent } from '../../packages/retrofit/research-rounds'

const sourceDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value)
const metadataSchema = z.object({ material_category: z.enum(RESEARCH_MATERIAL_CATEGORIES).default('other'), source_date: sourceDate.nullable().default(null) })
export function parseResearchMaterialMetadata(value: unknown): ResearchMaterialMetadata {
  const raw = value && typeof value === 'object' ? value as Record<string,unknown> : {}
  return metadataSchema.parse({ material_category: raw.material_category, source_date: raw.source_date === '' ? null : raw.source_date })
}
const createSchema = z.object({ expected_context_version:z.number().int().nonnegative(), parent_round_id:z.string().min(1).optional(), material_intake:z.enum(['none','provided']), document_ids:z.array(z.string().min(1)).max(12), allow_internal_ai:z.boolean() }).strict()
const adoptSchema = z.object({ expected_context_version:z.number().int().nonnegative(), input_hash:z.string().min(1).max(200) }).strict()
type StoredRound = { payload:ResearchRound; input_snapshot:ProjectInput|null }
type DocumentRow = { id:string; file_name:string; sha256:string; parser_result:{status:string;text?:string}; metadata?:ResearchMaterialMetadata|null }
export type ResearchRoundContext = { round_id:string; round_number:number; allow_internal_ai:boolean; materials:ResearchMaterial[]; sources:StrategySource[]; parent:Pick<ResearchRound,'id'|'context_version'|'input_hash'|'result'>|null; first_round_id:string; first_input_hash:string; first_context_version:number }
type Runner = (project:ProjectRecord, hash:string, signal:AbortSignal, context:ResearchRoundContext, onProgress:(event:StrategyProgress)=>void) => Promise<StrategyPacket>
export class ResearchRoundError extends Error { constructor(readonly status:number, readonly code:string, readonly detail:string) { super(detail) } }
const fail = (status:number, code:string, detail:string):never => { throw new ResearchRoundError(status,code,detail) }
const copy = <T>(value:T):T => structuredClone(value)

/** Explicit, project-scoped research snapshots; no background scheduler or public-cache writes. */
export class ResearchRoundsService {
  constructor(private readonly store:Store, private readonly requireProject:(id:string)=>Promise<ProjectRecord>, private readonly runner:Runner) {}
  async initialize() {
    await this.store.db.exec(`CREATE TABLE IF NOT EXISTS research_material_metadata (
      owner_id TEXT NOT NULL,project_id TEXT NOT NULL REFERENCES projects(id),document_id TEXT NOT NULL REFERENCES documents(id),metadata JSONB NOT NULL,
      PRIMARY KEY(owner_id,project_id,document_id));
      CREATE TABLE IF NOT EXISTS renewal_research_rounds (
      id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,project_id TEXT NOT NULL REFERENCES projects(id),round_number INTEGER NOT NULL,
      payload JSONB NOT NULL,input_snapshot JSONB,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(owner_id,project_id,round_number));`)
    // A process restart must not leave a non-resumable HTTP request labelled as still running.
    await this.store.db.query(`UPDATE renewal_research_rounds SET payload=jsonb_set(jsonb_set(payload,'{status}','"failed"'),'{error}',to_jsonb($1::text)) WHERE payload->>'status'='running'`,['研究服务已重启，本轮未完成；已保存的上一轮结果仍保留。'])
  }
  async recordMaterialMetadata(project:ProjectRecord, documentId:string, value:ResearchMaterialMetadata) {
    const metadata = metadataSchema.parse(value)
    const row = (await this.store.db.query('SELECT d.id FROM documents d JOIN projects p ON p.id=d.project_id WHERE d.id=$1 AND d.project_id=$2 AND p.owner_id=$3',[documentId,project.id,project.owner_id])).rows[0]
    if (!row) fail(404,'ROUND_DOCUMENT_NOT_FOUND','此资料不属于当前项目。')
    await this.store.db.query('INSERT INTO research_material_metadata(owner_id,project_id,document_id,metadata) VALUES($1,$2,$3,$4) ON CONFLICT(owner_id,project_id,document_id) DO UPDATE SET metadata=EXCLUDED.metadata',[project.owner_id,project.id,documentId,JSON.stringify(metadata)])
  }
  private async documents(project:ProjectRecord):Promise<ResearchMaterial[]> {
    const rows = (await this.store.db.query<DocumentRow>(`SELECT d.id,d.file_name,d.sha256,d.parser_result,m.metadata FROM documents d
      LEFT JOIN research_material_metadata m ON m.document_id=d.id AND m.project_id=d.project_id AND m.owner_id=$2
      WHERE d.project_id=$1 ORDER BY d.created_at,d.id`,[project.id,project.owner_id])).rows
    return rows.flatMap(row=>{
      const source = project.input.sources.find(source=>source.id===row.id&&source.hash===row.sha256)
      if (!source) return []
      const metadata = metadataSchema.parse(row.metadata||{})
      return [{...metadata,document_id:row.id,project_id:project.id,file_name:row.file_name,source_id:source.id,version:row.sha256,
        data_class:source.data_class,visibility:source.visibility,parse_status:row.parser_result.status,locator:source.locator||`document:${row.id}`,
        source_date_origin:metadata.source_date?'user_declared' as const:'unrecorded' as const,added_in_round:false}]
    })
  }
  private async stored(project:ProjectRecord,id:string,db:Database=this.store.db) {
    const row = (await db.query<StoredRound>('SELECT payload,input_snapshot FROM renewal_research_rounds WHERE id=$1 AND project_id=$2 AND owner_id=$3',[id,project.id,project.owner_id])).rows[0]
    if (!row) fail(404,'ROUND_NOT_FOUND','当前项目中没有这轮研究。')
    return row
  }
  private async candidate(project:ProjectRecord,hash?:string):Promise<StrategyPacket|null> {
    const rows = (await this.store.db.query<{payload:StrategyPacket}>(`SELECT a.payload FROM renewal_strategy_assessments a JOIN projects p ON p.id=a.project_id AND p.owner_id=a.owner_id
      WHERE a.owner_id=$1 AND a.project_id=$2 AND a.payload->>'status'='completed' AND a.payload->>'project_id'=$2
      AND (a.payload->>'context_version')::integer<=$3 AND a.payload->>'synthetic'=$4 AND a.payload->>'input_hash'=a.input_hash
      ${hash?'AND a.input_hash=$5':''} ORDER BY a.created_at DESC LIMIT 20`,[project.owner_id,project.id,project.context_version,String(project.input.synthetic),...(hash?[hash]:[])])).rows
    for (const {payload} of rows) {
      try {
        if (!payload.strategy||payload.sources.some(source=>source.visibility==='internal'||source.data_class==='internal')) continue
        validate<RenewalStrategy>('RenewalStrategy',payload.strategy)
        if(payload.content_review?.policy!=='advisory-v1') validateStrategy(payload.strategy,payload.sources,projectRenewalModeInput(project.input).conditions,!!payload.strategy.decision_brief)
        const result=copy(payload); delete result.publication
        return result
      } catch { /* Invalid historical output is never promoted to a baseline. */ }
    }
    return null
  }
  async list(project:ProjectRecord):Promise<ResearchRoundsResponse> {
    const rounds=(await this.store.db.query<{payload:ResearchRound}>('SELECT payload FROM renewal_research_rounds WHERE owner_id=$1 AND project_id=$2 ORDER BY round_number',[project.owner_id,project.id])).rows.map(row=>row.payload)
    return {rounds,materials:await this.documents(project),baseline_candidate:rounds.some(round=>['draft','running','completed'].includes(round.status))?null:await this.candidate(project)}
  }
  private checkVersion(project:ProjectRecord,expected:number) { if(project.context_version!==expected) fail(409,'ROUND_CONTEXT_CHANGED','项目资料已变化，请刷新后创建研究轮次。') }
  private async insert(project:ProjectRecord,make:(number:number,requiresParent:boolean)=>ResearchRound,snapshot:ProjectInput|null) {
    return this.store.db.transaction(async db=>{
      const locked=(await db.query<ProjectRecord>('SELECT * FROM projects WHERE id=$1 AND owner_id=$2 FOR UPDATE',[project.id,project.owner_id])).rows[0]
      if(!locked) fail(404,'ROUND_PROJECT_NOT_FOUND','项目不存在。')
      this.checkVersion(locked,project.context_version)
      const count=(await db.query<{number:number;requires_parent:boolean}>("SELECT COALESCE(MAX(round_number),0)+1 AS number,COALESCE(BOOL_OR(payload->>'status' IN ('draft','running','completed')),false) AS requires_parent FROM renewal_research_rounds WHERE owner_id=$1 AND project_id=$2",[project.owner_id,project.id])).rows[0]
      const round=make(Number(count.number),count.requires_parent)
      await db.query('INSERT INTO renewal_research_rounds(id,owner_id,project_id,round_number,payload,input_snapshot) VALUES($1,$2,$3,$4,$5,$6)',[round.id,project.owner_id,project.id,round.round_number,JSON.stringify(round),snapshot?JSON.stringify(snapshot):null])
      return round
    })
  }
  async adopt(project:ProjectRecord,raw:unknown):Promise<ResearchRound> {
    const body=adoptSchema.parse(raw); this.checkVersion(project,body.expected_context_version)
    const existing=(await this.list(project)).rounds
    const same=existing.find(round=>round.origin==='adopted_history'&&round.input_hash===body.input_hash)
    if(same) return same
    if(existing.some(round=>['draft','running','completed'].includes(round.status))) fail(409,'ROUND_BASELINE_EXISTS','本项目已有研究轮次，请选择已保存轮次继续。')
    const candidate=await this.candidate(project,body.input_hash)
    if(!candidate) return fail(422,'ROUND_BASELINE_UNAVAILABLE','没有找到当前项目可采纳的完整历史方案。')
    const result=candidate
    const id=`ROUND-${randomUUID()}`,now=new Date().toISOString()
    return this.insert(project,(number,requiresParent)=>{
      if(requiresParent) fail(409,'ROUND_BASELINE_EXISTS','本项目已有研究轮次，请刷新。')
      return {id,project_id:project.id,round_number:number,context_version:result.context_version,input_hash:result.input_hash,parent_round_id:null,parent_input_hash:null,parent_context_version:null,
        first_round_id:id,first_input_hash:result.input_hash,first_context_version:result.context_version,origin:'adopted_history',status:'completed',material_intake:'not_recorded',allow_internal_ai:false,
        materials:[],missing_materials:result.strategy?.round_review?.missing_materials||result.strategy?.next_checks.map(row=>({topic:row.title,request:row.detail,reason:'历史研究列出的待核事项。',evidence_refs:row.evidence_refs}))||[],result,error:null,created_at:now,updated_at:now}
    },null)
  }
  async create(project:ProjectRecord,raw:unknown):Promise<ResearchRound> {
    const body=createSchema.parse(raw); this.checkVersion(project,body.expected_context_version)
    const ids=[...new Set(body.document_ids)]
    if((body.material_intake==='provided')!==!!ids.length) fail(422,'ROUND_INTAKE_MISMATCH','已提供资料时请选择本轮文件；暂无资料时请清空文件选择。')
    const all=await this.documents(project),materials=ids.map(id=>all.find(material=>material.document_id===id)||fail(422,'ROUND_DOCUMENT_SCOPE','所选资料不存在、版本不符或不属于本项目。'))
    if(materials.some(material=>material.parse_status!=='extracted'||!project.input.sources.find(source=>source.id===material.source_id)?.untrusted_text?.trim())) fail(422,'ROUND_DOCUMENT_UNREADABLE','所选资料尚无可读正文，请完成解析后再研究。')
    if(materials.some(material=>material.visibility==='internal')&&!body.allow_internal_ai) fail(422,'ROUND_INTERNAL_CONSENT_REQUIRED','请明确同意将所选内部资料用于本轮 AI 分析。')
    if(materials.some(material=>material.visibility==='internal')&&config.ALLOW_INTERNAL_MODEL!=='true') fail(424,'ROUND_INTERNAL_MODEL_DISABLED','当前服务未允许内部材料用于模型分析，请启用 ALLOW_INTERNAL_MODEL 后重试。')
    const parent=body.parent_round_id?(await this.stored(project,body.parent_round_id)).payload:null
    if(parent&&(parent.status!=='completed'||!parent.result?.strategy)) fail(422,'ROUND_PARENT_INCOMPLETE','请选择一轮已完成的研究作为对照。')
    if(parent?.materials.some(material=>material.visibility==='internal')&&(!body.allow_internal_ai||parent.materials.some(material=>material.visibility==='internal'&&!materials.some(selected=>selected.document_id===material.document_id&&selected.version===material.version)))) fail(422,'ROUND_PARENT_MATERIAL_CONSENT','上一轮分析含内部资料，请同时选择继续使用的上轮文件并同意本轮 AI 分析。')
    const existing=(await this.list(project)).rounds
    if(existing.some(round=>['draft','running','completed'].includes(round.status))&&!parent) fail(422,'ROUND_PARENT_REQUIRED','请明确选择已保存的首轮或上一轮分析。')
    for(const material of materials) material.added_in_round=!parent?.materials.some(prior=>prior.document_id===material.document_id&&prior.version===material.version)
    const id=`ROUND-${randomUUID()}`,now=new Date().toISOString()
    const hash=createHash('sha256').update(JSON.stringify({policy:STRATEGY_POLICY,round_policy:'research-round-v1',project:project.input,version:project.context_version,parent:parent?{id:parent.id,hash:parent.input_hash}:null,materials,allow_internal_ai:body.allow_internal_ai,model:config.DEEPSEEK_MODEL})).digest('hex')
    return this.insert(project,(number,requiresParent)=>{if(requiresParent&&!parent)return fail(409,'ROUND_PARENT_REQUIRED','项目已新增研究轮次，请刷新并选择上一轮。');return ({id,project_id:project.id,round_number:number,context_version:project.context_version,input_hash:hash,parent_round_id:parent?.id||null,parent_input_hash:parent?.input_hash||null,parent_context_version:parent?.context_version??null,
      first_round_id:parent?.first_round_id||id,first_input_hash:parent?.first_input_hash||hash,first_context_version:parent?.first_context_version??project.context_version,
      origin:'generated',status:'draft',material_intake:body.material_intake,allow_internal_ai:body.allow_internal_ai,materials,missing_materials:[],result:null,error:null,created_at:now,updated_at:now})},copy(project.input))
  }
  private async save(project:ProjectRecord,round:ResearchRound) { round.updated_at=new Date().toISOString(); await this.store.db.query('UPDATE renewal_research_rounds SET payload=$1 WHERE id=$2 AND owner_id=$3 AND project_id=$4',[JSON.stringify(round),round.id,project.owner_id,project.id]); return round }
  async run(project:ProjectRecord,id:string,signal:AbortSignal,onProgress:(event:StrategyProgress)=>void):Promise<ResearchRound> {
    const stored=await this.stored(project,id),round=stored.payload
    if(round.status==='completed') return round
    if(round.status!=='draft') fail(409,'ROUND_ALREADY_ATTEMPTED','本轮已运行或结束；请保留本轮记录并新建下一轮。')
    this.checkVersion(project,round.context_version)
    if(!stored.input_snapshot) return fail(422,'ROUND_SNAPSHOT_MISSING','历史采纳结果仅供对照，请创建新轮次研究。')
    const snapshot=stored.input_snapshot
    if(round.materials.some(material=>material.visibility==='internal')&&(!round.allow_internal_ai||config.ALLOW_INTERNAL_MODEL!=='true')) fail(424,'ROUND_INTERNAL_MODEL_DISABLED','所选内部材料需要本轮明确同意并启用 ALLOW_INTERNAL_MODEL。')
    const claimed=(await this.store.db.query<{payload:ResearchRound}>(`UPDATE renewal_research_rounds SET payload=jsonb_set(payload,'{status}','"running"') WHERE id=$1 AND owner_id=$2 AND project_id=$3 AND payload->>'status'='draft' RETURNING payload`,[id,project.owner_id,project.id])).rows[0]
    if(!claimed) fail(409,'ROUND_RUNNING','本轮正在研究，请等待结果。')
    round.status='running'
    try {
      const parent=round.parent_round_id?(await this.stored(project,round.parent_round_id)).payload:null
      const sources:StrategySource[]=round.materials.map(material=>{
        const source=snapshot.sources.find(source=>source.id===material.source_id&&source.hash===material.version)
        if(!source?.untrusted_text) return fail(422,'ROUND_DOCUMENT_VERSION','研究快照中的资料版本不可用。')
        return {id:source.id,title:source.title,text:source.untrusted_text,url:null,published_at:material.source_date,role:'current',locator:material.locator,
          visibility:material.visibility,data_class:material.data_class,document_id:material.document_id,document_version:material.version,project_id:project.id,material_category:material.material_category,source_date:material.source_date}
      })
      const result=await this.runner({...project,input:snapshot},round.input_hash,signal,{round_id:round.id,round_number:round.round_number,allow_internal_ai:round.allow_internal_ai,materials:round.materials,sources,parent:parent?{id:parent.id,input_hash:parent.input_hash,context_version:parent.context_version,result:parent.result}:null,first_round_id:round.first_round_id,first_input_hash:round.first_input_hash,first_context_version:round.first_context_version},onProgress)
      // Preserve the actual output for audit even when a later upload makes it obsolete.
      round.result=result; round.missing_materials=result.strategy?.round_review?.missing_materials||[]
      const current=await this.requireProject(project.id)
      if(current.context_version!==round.context_version) {round.status='obsolete';round.error='研究期间项目资料已变化，本轮结果保留为历史，请按当前资料创建新轮次。'}
      else {round.status=result.status==='completed'?'completed':'failed';round.error=result.status==='completed'?null:strategyFailureMessage(result)}
      return await this.save(project,round)
    } catch(error) {
      round.status='failed';round.error=signal.aborted?'本轮研究已停止，上一轮结果仍保留。':'本轮研究未完成，上一轮结果仍保留；请查看资料后新建研究轮次。'
      await this.save(project,round)
      if(error instanceof ResearchRoundError) throw error
      return round
    }
  }
}

export function registerResearchRoundRoutes(app:Express,service:ResearchRoundsService,requireProject:(id:string)=>Promise<ProjectRecord>,requestSignal:(req:Request,res:Response)=>AbortSignal) {
  const path='/api/projects/:id/research-rounds'
  const route=(action:(req:Request,res:Response,project:ProjectRecord)=>Promise<unknown>)=>async(req:Request,res:Response,next:(error?:unknown)=>void)=>{
    try {const project=await requireProject(String(req.params.id));if(project.input.business_profile!=='neighborhood') return res.status(422).json({detail:'请在老旧小区项目中管理研究轮次。'});await action(req,res,project)}
    catch(error) {if(res.destroyed||res.writableEnded)return;if(res.headersSent){res.write(JSON.stringify({type:'error',message:error instanceof ResearchRoundError?error.detail:'本轮研究未完成，已保存的历史结果保留。'})+'\n');res.end()}else if(error instanceof ResearchRoundError)res.status(error.status).json({code:error.code,detail:error.detail});else if(error instanceof z.ZodError)res.status(422).json({code:'ROUND_REQUEST_INVALID',detail:'研究轮次请求或资料日期格式不正确。'});else next(error)}
  }
  app.get(path,route(async(_req,res,project)=>res.json(await service.list(project))))
  app.post(path+'/adopt',route(async(req,res,project)=>res.status(201).json({round:await service.adopt(project,req.body)})))
  app.post(path,route(async(req,res,project)=>res.status(201).json({round:await service.create(project,req.body)})))
  app.post(path+'/:roundId/run',route(async(req,res,project)=>{
    z.object({}).strict().parse(req.body||{})
    const stream=req.headers.accept?.includes('application/x-ndjson')||false
    if(stream){res.type('application/x-ndjson');res.setHeader('Cache-Control','no-store');res.setHeader('X-Accel-Buffering','no');res.flushHeaders()}
    const emit=(event:ResearchRoundStreamEvent)=>{if(stream&&!res.destroyed&&!res.writableEnded)res.write(JSON.stringify(event)+'\n')}
    const round=await service.run(project,String(req.params.roundId),requestSignal(req,res),emit)
    if(!res.destroyed){if(stream){if(round.result&&round.status!=='obsolete')emit({type:'complete',result:round.result,round});else emit({type:'error',message:round.error||'本轮研究未形成完整结果。',round});res.end()}else res.json({round,result:round.result})}
  }))
}
