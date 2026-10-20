import { randomUUID } from 'node:crypto'
import { SessionId } from '@deepseek-ai/dsh-session'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import { LiveSession } from '../dsh/live-session'
import { config } from '../../apps/host/config'
import type { Judge } from '../../packages/intelligence/pipeline'
import { judgeIntelligenceDecision } from '../../services/capabilities/intelligence-decision'
import { hash } from '../../packages/intelligence/domain'
import { presentModelSchema } from '../../packages/contracts/validate'
import { assertIntelligenceOutput } from '../../packages/intelligence/prompts'
export const intelligenceRoutes=()=>config.decisionEnabled?{prefilter:'qwen_systemone:'+config.QWEN_DECISION_MODEL+':'+hash(config.QWEN_DECISION_ENDPOINT).slice(0,12),relate:'qwen_systemone:'+config.QWEN_DECISION_MODEL+':'+hash(config.QWEN_DECISION_ENDPOINT).slice(0,12)}:{}
/** Reuses DSH and the configured model route; no second API client or general Agent loop. */
export const intelligenceJudge:Judge=async(stage,input,schema,prompt,signal,model)=>{
  if(!config.modelConfigured)throw new Error('BLOCKED_EXTERNAL_MODEL')
  const id='INTEL-'+randomUUID(),live=await LiveSession.open(id,signal)
  const accept=(result:Awaited<ReturnType<Judge>>)=>{assertIntelligenceOutput(stage,result.value);return result}
  let handle:Awaited<ReturnType<typeof live.ctx.agents.create>>|undefined
  try{
    if((stage==='prefilter'||stage==='relate')&&model?.startsWith('qwen_systemone:')){
      if(!config.decisionConfigured)throw new Error('BLOCKED_EXTERNAL_DECISION')
      return accept(await live.runReadCapability('intelligence_'+stage,toolSignal=>judgeIntelligenceDecision(stage,input,toolSignal)))
    }
    const maxTokens=stage==='topic'?4200:2200
    handle=await live.ctx.agents.create({sessionId:SessionId(id+'-judge'),agentOptions:{provider:'deepseek-official',model:model||config.DEEPSEEK_MODEL,reasoningEffort:ReasoningEffortId('off'),maxTokens}})
    const child=await live.ctx.subagents.start('spawn',{parent:handle.agent,signal,maxDepth:1,label:'intelligence-'+stage,persona:prompt,toolFilter:{allow:[]},
      outputSchema:presentModelSchema(schema) as unknown as SubagentStartRequest['outputSchema'],prompt:[{type:'text',text:JSON.stringify({untrusted_material:input})}],
      agentOptions:{provider:'deepseek-official',model:model||config.DEEPSEEK_MODEL,reasoningEffort:ReasoningEffortId('off'),maxTokens}})
    try{const result=await child.result;if(result.stopReason!=='completed'||result.structured===undefined){
        console.warn(JSON.stringify({event:'intelligence_model_incomplete',stage,stop_reason:result.stopReason,returned_models:live.calls.map(c=>c.returned_model)}))
        throw new Error('INTELLIGENCE_MODEL_INCOMPLETE')
      }
      return accept({value:result.structured,model:live.calls.at(-1)?.returned_model||model||config.DEEPSEEK_MODEL,usage:live.calls.map(c=>({...c,stage:'intelligence-'+stage}))})
    }finally{await child.dispose()}
  }finally{if(handle)await handle.dispose();await live.close()}
}
