import type {Express} from 'express'
import {z} from 'zod'
import {createHash} from 'node:crypto'
import type {Store,ProjectRecord} from './store'
import {readPublishedStrategy} from './strategy-publication'
import {config} from './config'
import {backgroundWork} from './background-work'
import {investigationAdviceInput,type AdviceDirection,type InvestigationAdviceResult} from '../../packages/retrofit/investigation-advice'
import {generateInvestigationAdvice} from '../../services/map-screening/investigation-advice'

/** Reuse the existing owner/project/hash guidance cache and shared host work registry. */
export async function registerProjectAdvice(app:Express,store:Store,requireProject:(id:string)=>Promise<ProjectRecord>,generate=generateInvestigationAdvice){
 await store.db.exec('CREATE TABLE IF NOT EXISTS project_decision_guidance(owner_id TEXT NOT NULL,project_id TEXT NOT NULL REFERENCES projects(id),input_hash TEXT NOT NULL,payload JSONB NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),PRIMARY KEY(owner_id,project_id,input_hash));')
 const selection={direction:z.enum(['comprehensive','rebuild']).nullable().default(null)}
 const post=z.object({...selection,expected_context_version:z.number().int().nonnegative(),expected_strategy_hash:z.string().min(1),refresh:z.boolean().default(false)}).strict()
 const get=z.object({direction:z.enum(['comprehensive','rebuild','unselected']).default('unselected')}).strict()
 async function prepare(project:ProjectRecord,direction:AdviceDirection){
  const packet=await readPublishedStrategy(store,project,'',project.input.synthetic)
  if(!packet?.strategy)return null
  const input=investigationAdviceInput(project.input,project.context_version,packet,direction)
  const hash='advice:'+createHash('sha256').update(JSON.stringify({input,model:config.DEEPSEEK_MODEL})).digest('hex')
  return {input,hash}
 }
 for(const method of ['get','post'] as const)app[method]('/api/projects/:id/investigation-advice',async(req,res,next)=>{
  try{
   const project=await requireProject(String(req.params.id)),options=method==='get'?get.parse(req.query):post.parse(req.body),direction=options.direction==='unselected'?null:options.direction
   if('expected_context_version' in options&&options.expected_context_version!==project.context_version)return res.status(409).json({detail:'资料已更新，请重新读取调查建议。'})
   const prepared=await prepare(project,direction)
   if(!prepared)return method==='get'?res.json(null):res.status(409).json({detail:'先形成一轮方案，再生成对应调查建议。'})
   if('expected_strategy_hash' in options&&options.expected_strategy_hash!==prepared.input.strategy_hash)return res.status(409).json({detail:'方案已变化，请重新读取当前调查任务。'})
   const cached=(await store.db.query<{payload:InvestigationAdviceResult}>('SELECT payload FROM project_decision_guidance WHERE owner_id=$1 AND project_id=$2 AND input_hash=$3',[project.owner_id,project.id,prepared.hash])).rows[0]?.payload
   if(cached&&(method==='get'||!('refresh' in options&&options.refresh)))return res.json({...cached,reused:true})
   if(method==='get')return res.json(null)
   if(!prepared.input.candidates.length)return res.status(422).json({detail:'当前没有可关联的调查任务，可先补充项目资料。'})
   const result=await backgroundWork.launch('project-advice:'+project.owner_id+':'+project.id+':'+prepared.hash,Date.now()+60000,async signal=>{
    const result=await generate(prepared.input,prepared.hash,signal),fresh=await prepare(await requireProject(project.id),direction)
    if(fresh?.hash!==prepared.hash)throw new Error('ADVICE_CONTEXT_CHANGED')
    await store.db.query('INSERT INTO project_decision_guidance(owner_id,project_id,input_hash,payload) VALUES($1,$2,$3,$4) ON CONFLICT(owner_id,project_id,input_hash) DO UPDATE SET payload=EXCLUDED.payload,created_at=now()',[project.owner_id,project.id,prepared.hash,JSON.stringify(result)])
    return result
   })
   if(!res.destroyed)res.json(result)
  }catch(error){if(res.destroyed)return;if(error&&typeof error==='object'&&'status' in error&&typeof error.status==='number')return next(error);if(error instanceof z.ZodError)return res.status(422).json({detail:'调查建议请求格式不正确。'});if(error instanceof Error&&error.message==='ADVICE_CONTEXT_CHANGED')return res.status(409).json({detail:'资料或方案已更新，本次建议未替换当前结果。'});console.warn(JSON.stringify({event:'investigation_advice_unavailable',code:error instanceof Error&&/^ADVICE_[A-Z_]+$/.test(error.message)?error.message:'MODEL_UNAVAILABLE'}));res.status(503).json({detail:'本次智能建议暂未生成，可继续核对资料或稍后重试。'})}
 })
}
