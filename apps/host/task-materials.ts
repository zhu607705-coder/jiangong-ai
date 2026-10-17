import {createHash} from 'node:crypto'
import type {Express} from 'express'
import {z} from 'zod'
import type {Store,ProjectRecord} from './store'
import type {StrategyPacket} from '../../packages/retrofit/strategy'
import {buildProjectTasks} from '../../packages/retrofit/project-tasks'
import {extractTaskObservations,type TaskMaterialLink,type TaskMaterialReceipt} from '../../packages/retrofit/task-materials'
import {readPublishedStrategy} from './strategy-publication'
import {bindPacketContext} from './project-context'
import {ExperienceError,FIELD_LABELS} from '../../packages/experience/domain'
import type {ExperienceService} from '../../packages/experience/service'
import {tableFacts} from './ingest'
import {backgroundWork} from './background-work'

const linkSchema=z.object({task_id:z.string().min(1).max(30000),input_hash:z.string().min(1).max(200),direction:z.enum(['comprehensive','rebuild']).nullable().optional()}).strict()
const keyOf=(link:TaskMaterialLink)=>createHash('sha256').update(JSON.stringify([link.task_id,link.input_hash])).digest('hex')
type DocumentRow={id:string;file_name:string;sha256:string;parser_result:{status:string;parser?:string;text?:string;profile?:unknown};metadata?:Record<string,unknown>}

/** Associations and tool receipts share the existing document metadata; no second source or fact store. */
export class TaskMaterialService{
 constructor(private store:Store,private experience:Pick<ExperienceService,'extract'>,private requireProject:(id:string)=>Promise<ProjectRecord>){}
 async initialize(){await this.store.db.exec(`CREATE TABLE IF NOT EXISTS research_material_metadata(owner_id TEXT NOT NULL,project_id TEXT NOT NULL REFERENCES projects(id),document_id TEXT NOT NULL REFERENCES documents(id),metadata JSONB NOT NULL,PRIMARY KEY(owner_id,project_id,document_id));`)}
 private async document(project:ProjectRecord,id:string){
  const row=(await this.store.db.query<DocumentRow>('SELECT d.id,d.file_name,d.sha256,d.parser_result,m.metadata FROM documents d LEFT JOIN research_material_metadata m ON m.document_id=d.id AND m.project_id=d.project_id AND m.owner_id=$3 WHERE d.project_id=$1 AND d.id=$2',[project.id,id,project.owner_id])).rows[0]
  if(!row||!project.input.sources.some(source=>source.id===id&&source.hash===row.sha256))throw new ExperienceError(404,'TASK_DOCUMENT_SCOPE','资料不属于当前项目或版本已撤回。')
  return row
 }
 private async task(project:ProjectRecord,link:TaskMaterialLink){
  let packet=await readPublishedStrategy(this.store,project,'',project.input.synthetic),missing:any[]=[]
  {const round=(await this.store.db.query<{payload:{result:StrategyPacket;missing_materials:any[]}}>("SELECT payload FROM renewal_research_rounds WHERE owner_id=$1 AND project_id=$2 AND payload->>'input_hash'=$3 ORDER BY round_number DESC LIMIT 1",[project.owner_id,project.id,link.input_hash])).rows[0]?.payload;if(packet?.input_hash!==link.input_hash)packet=round?.result||null;missing=round?.missing_materials||[]}
  if(!packet){packet=(await this.store.db.query<{payload:StrategyPacket}>('SELECT payload FROM renewal_strategy_assessments WHERE owner_id=$1 AND project_id=$2 AND input_hash=$3',[project.owner_id,project.id,link.input_hash])).rows[0]?.payload||null}
  if(!packet||packet.project_id!==project.id||packet.synthetic!==project.input.synthetic)throw new ExperienceError(404,'TASK_BASELINE_SCOPE','当前项目中没有这份调查任务的研判基线。')
  const task=[...buildProjectTasks(packet,link.direction,missing),...buildProjectTasks(bindPacketContext(packet,project),link.direction,missing)].find(task=>task.id===link.task_id)
  if(!task)throw new ExperienceError(404,'TASK_NOT_FOUND','这项调查不属于所选项目、方向与研判基线。')
  return task
 }
 private async save(project:ProjectRecord,receipt:TaskMaterialReceipt){
  const values=JSON.stringify({[keyOf(receipt)]:receipt}),metadata=JSON.stringify({material_category:'other',source_date:null,task_material_imports:JSON.parse(values)})
  await this.store.db.query(`INSERT INTO research_material_metadata(owner_id,project_id,document_id,metadata) VALUES($1,$2,$3,$4) ON CONFLICT(owner_id,project_id,document_id) DO UPDATE SET metadata=jsonb_set(research_material_metadata.metadata,'{task_material_imports}',COALESCE(research_material_metadata.metadata->'task_material_imports','{}'::jsonb)||$5::jsonb,true)`,[project.owner_id,project.id,receipt.document_id,metadata,values])
  return receipt
 }
 async list(project:ProjectRecord,inputHash:string){
  const rows=(await this.store.db.query<{metadata:{task_material_imports?:Record<string,TaskMaterialReceipt>}}>('SELECT metadata FROM research_material_metadata WHERE owner_id=$1 AND project_id=$2',[project.owner_id,project.id])).rows
  return rows.flatMap(row=>Object.values(row.metadata.task_material_imports||{})).filter(item=>item.input_hash===inputHash&&project.input.sources.some(source=>source.id===item.document_id&&source.hash===item.version))
 }
 async link(project:ProjectRecord,id:string,link:TaskMaterialLink){
  const started=Date.now(),task=await this.task(project,link),doc=await this.document(project,id),old=(doc.metadata?.task_material_imports as Record<string,TaskMaterialReceipt>)?.[keyOf(link)]
  if(old?.version===doc.sha256)return old
  const observations=extractTaskObservations(doc.parser_result.profile,doc.parser_result.text||''),now=new Date().toISOString(),rows=tableFacts(doc.parser_result.profile,id)
  const receipt:TaskMaterialReceipt={...link,document_id:id,file_name:doc.file_name,version:doc.sha256,context_version:project.context_version,task_title:task.title,parse_status:doc.parser_result.status,observations,tools:[
   {tool:'ParserPort',status:doc.parser_result.status==='extracted'?'completed':doc.parser_result.status==='ocr_required'?'ocr_required':'empty',detail:doc.parser_result.parser||'已保存的本地解析结果',count:(doc.parser_result.text||'').length},
   {tool:'表格原始行读取',status:rows.length?'completed':'empty',detail:'读取已保存的解析表，不推算未提供的样本或总量。',count:rows.length},
   {tool:'任务指标提取',status:observations.length?'completed':'empty',detail:'保留单元格值、行定位与原文标签数值。',count:observations.length,duration_ms:Date.now()-started},
   {tool:'DSH 原文提取',status:'not_requested',detail:'可明确授权本文件后调用既有知识提取工具，形成待审核草稿。'},
  ],created_at:now,updated_at:now,extraction:{status:'not_requested',model_calls:0,card_ids:[],warnings:[]}}
  return this.save(project,receipt)
 }
 async extract(project:ProjectRecord,id:string,link:TaskMaterialLink,useModel:boolean){
  const initial=await this.link(project,id,link)
  if(!useModel||initial.extraction.status==='completed')return initial
  return backgroundWork.launch('task-extraction:'+project.id+':'+id+':'+keyOf(link),Date.now()+120000,async()=>{
   const started=Date.now(),receipt=structuredClone(initial)
   try{const result=await this.experience.extract(project,[id],true,false)
    receipt.extraction={status:'completed',model_calls:result.model_calls,card_ids:result.cards.map(card=>card.id),warnings:result.warnings}
    for(const card of result.cards)for(const field of card.fields)if(field.value&&receipt.observations.length<36){const evidence=field.evidence.find(row=>row.document_id===id&&row.version===receipt.version);if(evidence)receipt.observations.push({field:FIELD_LABELS[field.key],value:field.value,locator:evidence.locator,quote:evidence.quote,representation:'source_bound_draft'})}
    receipt.tools[3]={tool:'DSH 原文提取',status:result.model_calls?'completed':'empty',detail:`实际模型调用 ${result.model_calls} 次，保存 ${result.cards.length} 份待审核草稿。`,count:result.cards.length,duration_ms:Date.now()-started}
   }catch(error){receipt.extraction.status='failed';receipt.extraction.model_calls=error instanceof ExperienceError&&['BLOCKED_EXTERNAL_MODEL','INTERNAL_MODEL_NOT_PERMITTED'].includes(error.code)?0:null;receipt.extraction.warnings=[error instanceof ExperienceError?error.message:'本次模型提取未完成，本地字段与原文件已保留。'];receipt.tools[3]={tool:'DSH 原文提取',status:'failed',detail:receipt.extraction.warnings[0],duration_ms:Date.now()-started}}
   const current=await this.requireProject(project.id);await this.document(current,id);receipt.updated_at=new Date().toISOString();return this.save(current,receipt)
  })
 }
}
export async function registerTaskMaterials(app:Express,store:Store,requireProject:(id:string)=>Promise<ProjectRecord>,experience:Pick<ExperienceService,'extract'>){
 const service=new TaskMaterialService(store,experience,requireProject);await service.initialize()
 const route=(action:(req:any,project:ProjectRecord)=>Promise<unknown>)=>async(req:any,res:any,next:any)=>{try{res.json(await action(req,await requireProject(String(req.params.id))))}catch(error){if(error instanceof ExperienceError)res.status(error.status).json({code:error.code,detail:error.message});else if(error instanceof z.ZodError)res.status(422).json({code:'TASK_MATERIAL_INPUT',detail:'请选择当前任务、文件和研判基线。'});else next(error)}}
 app.get('/api/projects/:id/investigation-materials',route(async(req,project)=>({items:await service.list(project,z.string().min(1).max(200).parse(req.query.input_hash))})))
 app.post('/api/projects/:id/investigation-materials',route(async(req,project)=>{const body=linkSchema.extend({document_id:z.string().min(1)}).parse(req.body);const {document_id,...link}=body;return service.link(project,document_id,link)}))
 app.post('/api/projects/:id/investigation-materials/:documentId/extract',route(async(req,project)=>{const body=linkSchema.extend({use_model:z.boolean().default(false)}).parse(req.body);const {use_model,...link}=body;return service.extract(project,String(req.params.documentId),link,use_model)}))
 return service
}
