import {GUIDANCE_PAGES,GUIDANCE_OPTIONS,GUIDANCE_POLICY,projectGuidanceQuestions,type ProjectGuidance,type GuidanceRank,type projectGuidanceInput} from '../../packages/decision/project-guidance'
import {parseDecisionChoice,requestDecisionQuestions} from './decision-model'
import {completeProbabilityMap,compatibleExpectedScore} from '../../packages/decision/probabilities'

export type GuidanceInput=ReturnType<typeof projectGuidanceInput>
export type GuidanceModel=(state:unknown,questions:Record<string,unknown>,signal:AbortSignal)=>Promise<any>
/** Existing System One transport; independent invalid answers become follow-ups, not a project gate. */
export async function evaluateProjectGuidance(input:GuidanceInput,inputHash:string,signal:AbortSignal,model:GuidanceModel=requestDecisionQuestions):Promise<ProjectGuidance>{
 const started=Date.now(),questions=projectGuidanceQuestions(input),issues:string[]=[]
 const base:ProjectGuidance={policy:GUIDANCE_POLICY,project_id:input.state.project.id,context_version:input.state.project.version,input_hash:inputHash,created_at:new Date().toISOString(),direction:input.state.selected_direction,preference:input.state.goal.preset,status:'failed',stale:false,reused:false,request_id:null,duration_ms:0,input_tokens:null,stages:{},measures:[],materials:[],issues,source_count:input.source_count,strategy_hash:input.strategy_hash,error:null}
 try{
  const raw=await model(input.state,questions,signal);signal.throwIfAborted()
  if(!raw||raw.model!=='decision-model-preview'||typeof raw.request_id!=='string'||!Number.isSafeInteger(raw.usage?.input_tokens))throw new Error('GUIDANCE_RESPONSE_INVALID')
  for(const page of GUIDANCE_PAGES)try{
   const options=(questions['stage_'+page] as {criteria:Record<string,string>}).criteria
   const answer=parseDecisionChoice(raw.answers?.['stage_'+page],Object.keys(options))
   const option=GUIDANCE_OPTIONS[page][answer.choice]
   const target=option.target.page==='scenarios'&&!input.state.has_current_strategy?{page:'assessment' as const,section:'direction'}:option.target.page==='scenarios'&&!input.state.selected_direction?{page:'scenarios' as const,section:'compare'}:option.target
   base.stages[page]={choice:answer.choice,label:option.target.page==='scenarios'&&!input.state.has_current_strategy?'形成方案后再进行测算':option.label,reason:option.reason,confidence:answer.confidence,target}
  }catch{issues.push(page)}
  function rank(kind:'measure'|'material',rows:GuidanceInput['measures']):GuidanceRank[]{return rows.flatMap((row,index)=>{
   const answer=raw.answers?.[kind+'_'+index],dist=completeProbabilityMap(answer?.probabilities,['0','1','2','3','4'])
   if(answer?.type!=='score'||!Number.isFinite(answer.score)||answer.score<0||answer.score>4||!Number.isFinite(answer.confidence)||answer.confidence<0||answer.confidence>1||!dist||!compatibleExpectedScore(answer.score,Object.values(dist))){issues.push(kind+':'+row.id);return []}
   return [{...row,score:Math.round(answer.score*25),confidence:answer.confidence}]
  }).sort((a,b)=>b.score-a.score)}
  base.measures=rank('measure',input.measures);base.materials=rank('material',input.materials)
  return {...base,status:issues.length?'partial':'completed',request_id:raw.request_id,input_tokens:raw.usage.input_tokens,duration_ms:Date.now()-started}
 }catch(error){signal.throwIfAborted();const message=error instanceof Error?error.message:'';const code=/^DECISION_(TIMEOUT|INPUT_LIMIT|HTTP_\d{3}|INVALID_RESPONSE|REQUEST_FAILED|NOT_CONFIGURED)$/.test(message)?message:'GUIDANCE_REQUEST_FAILED';console.warn(JSON.stringify({event:'project_guidance_failed',code,input_hash:inputHash,duration_ms:Date.now()-started,input_bytes:Buffer.byteLength(JSON.stringify(input.state)),question_count:Object.keys(questions).length}));return {...base,duration_ms:Date.now()-started,error:'本次快速工作判断未更新，已有方案和资料可继续使用；稍后可重试。'}}
}
