import type {Express} from 'express'
import {z} from 'zod'
import {createHash} from 'node:crypto'
import type {Store,ProjectRecord} from './store'
import {config} from './config'
import {readPublishedStrategy} from './strategy-publication'
import type {ResearchRound} from '../../packages/retrofit/research-rounds'
import {projectGuidanceInput,projectGuidanceQuestions,type ProjectGuidance} from '../../packages/decision/project-guidance'
import {evaluateProjectGuidance} from '../../services/capabilities/project-decision'

const selection=z.object({direction:z.enum(['comprehensive','rebuild']).nullable().default(null),preference:z.enum(['balanced','residents','funding']).default('balanced')})
const query=selection.extend({direction:z.enum(['comprehensive','rebuild','unselected']).default('unselected')}).strict()
const body=selection.extend({expected_context_version:z.number().int().nonnegative(),refresh:z.boolean().default(false)}).strict()
export async function registerProjectDecision(app:Express,store:Store,requireProject:(id:string)=>Promise<ProjectRecord>,evaluate:typeof evaluateProjectGuidance=evaluateProjectGuidance){
 await store.db.exec(`CREATE TABLE IF NOT EXISTS project_decision_guidance(owner_id TEXT NOT NULL,project_id TEXT NOT NULL REFERENCES projects(id),input_hash TEXT NOT NULL,payload JSONB NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),PRIMARY KEY(owner_id,project_id,input_hash));`)
 const active=new Set<string>()
 async function prepare(project:ProjectRecord,direction:'comprehensive'|'rebuild'|null,preference:'balanced'|'residents'|'funding'){
  const [published,rows]=await Promise.all([readPublishedStrategy(store,project,'',project.input.synthetic),store.db.query<{payload:ResearchRound}>('SELECT payload FROM renewal_research_rounds WHERE owner_id=$1 AND project_id=$2 ORDER BY round_number DESC LIMIT 8',[project.owner_id,project.id])])
  const rounds=rows.rows.map(row=>row.payload)
  const latest=rounds.filter(round=>round.project_id===project.id&&round.status==='completed'&&round.context_version===project.context_version&&round.result?.project_id===project.id&&round.result.context_version===project.context_version&&round.input_hash===round.result.input_hash&&round.result.status==='completed'&&round.result.synthetic===project.input.synthetic&&!!round.result.strategy).sort((a,b)=>b.round_number-a.round_number)[0]?.result||null
  const packet=latest||published
  const input=projectGuidanceInput(project.input,project.context_version,packet,rounds,direction,preference)
  const hash=createHash('sha256').update(JSON.stringify({state:input.state,questions:projectGuidanceQuestions(input),model:config.QWEN_DECISION_MODEL,endpoint:config.QWEN_DECISION_ENDPOINT})).digest('hex')
  return {input,hash}
 }
 for(const method of ['get','post'] as const)app[method]('/api/projects/:id/decision-guidance',async(req,res,next)=>{
  let key:string|undefined
  const abort=new AbortController();req.once('aborted',()=>abort.abort());res.once('close',()=>{if(!res.writableEnded)abort.abort()})
  const signal=AbortSignal.any([abort.signal,AbortSignal.timeout(35000)])
  try{
   const project=await requireProject(String(req.params.id)),options=method==='get'?query.parse(req.query):body.parse(req.body)
   if(project.input.business_profile!=='neighborhood')return res.status(422).json({detail:'请在老旧小区项目中使用快速工作判断。'})
   if('expected_context_version' in options&&options.expected_context_version!==project.context_version)return res.status(409).json({detail:'资料已更新，请刷新后判断。'})
   const direction=options.direction==='unselected'?null:options.direction
   const {input,hash}=await prepare(project,direction,options.preference)
   const cached=(await store.db.query<{payload:ProjectGuidance}>('SELECT payload FROM project_decision_guidance WHERE owner_id=$1 AND project_id=$2 AND input_hash=$3',[project.owner_id,project.id,hash])).rows[0]?.payload
   if(cached&&(method==='get'||!('refresh' in options&&options.refresh)))return res.json({...cached,reused:true})
   if(method==='get')return res.json(null)
   key=project.id+':'+hash
   if(active.has(key)){key=undefined;return res.status(409).json({detail:'本项目快速判断正在进行，请稍后查看。'})}
   active.add(key)
   if(!config.decisionEnabled)return res.status(424).json({detail:'Decision 暂未启用，已有项目功能仍可使用。'})
   const result=await evaluate(input,hash,signal)
   const latest=await requireProject(project.id),fresh=await prepare(latest,direction,options.preference)
   if(fresh.hash!==hash)return res.status(409).json({detail:'判断期间资料或方案已更新，请重新读取当前版本。'})
   if(result.status!=='failed')await store.db.query('INSERT INTO project_decision_guidance(owner_id,project_id,input_hash,payload) VALUES($1,$2,$3,$4) ON CONFLICT(owner_id,project_id,input_hash) DO UPDATE SET payload=EXCLUDED.payload,created_at=now()',[project.owner_id,project.id,hash,JSON.stringify(result)])
   res.json(result)
  }catch(error){if(!res.destroyed){if(error instanceof z.ZodError)res.status(422).json({detail:'快速判断请求格式不正确。'});else next(error)}}finally{if(key)active.delete(key)}
 })
}
