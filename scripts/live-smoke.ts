import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import * as DeepSeek from '@deepseek-ai/dsh-llm-deepseek-api-key'
import WebRuntime from '@deepseek-ai/dsh-web'
import * as Search from '@deepseek-ai/dsh-web-search-deepseek'
import { mkdir, writeFile } from 'node:fs/promises'
import { config } from '../apps/host/config'
import { LiveSession } from '../runtime/dsh/live-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { loadRenewalAgentProfile } from '../runtime/agents/renewal/profiles'
import type { RenewalResearchNote } from '../apps/host/generated/contracts'

const ctx = new Context()
const structuredOnly=process.argv.includes('--renewal-structured')
const result = { checked_at: new Date().toISOString(), model: { status: 'blocked_external', reason: 'DEEPSEEK_API_KEY is not configured', requested_model: config.DEEPSEEK_MODEL }, search: { status: 'blocked_external', reason: 'DeepSeek search credential is not configured' } }
try {
  await ctx.plugin(LlmRuntime)
  if(structuredOnly){
    result.search={status:'not_run',reason:'This check only covers the native structured reader; no external search or project operation.'}
    if(config.modelConfigured){
      let live:LiveSession|undefined,reads=0
      const text='此记录仅用于工具调用与结构化输出格式验收。'
      try{
        live=await LiveSession.open(`MAP-AI-STRATEGY-readiness-${Date.now()}`,AbortSignal.timeout(60000))
        live.ctx.tools.register(defineTool({name:'renewal_sources_0_1',description:'读取本次公开协议验收记录，不访问项目资料。',parameters:{},output:{schema:{type:'string'},render:(_args,value)=>[{type:'text',text:value}]},async execute(){reads++;return JSON.stringify({source_id:'readiness-source',locator:'readiness:1',text})}}))
        const value=await live.call<RenewalResearchNote>('renewal_research_expert_readiness','这是协议检查，不形成工程分析或项目方案。先调用renewal_sources_0_1，然后仅调用structured_output，按RenewalResearchNote返回task_id=readiness；summary说明协议检查，observations只列一项，source_id用工具返回标识，quote逐字复制返回原句，locator复制返回定位，inference说明仅验证调用。missing_data=[]，不输出工程判断。','RenewalResearchNote',['renewal_sources_0_1'],undefined,{evidenceIds:['readiness-source']},await loadRenewalAgentProfile('building_delivery'),{maxOutputTokens:1500})
        if(!reads||value.value.task_id!=='readiness'||value.value.observations.length!==1||value.value.observations[0].quote!==text)throw new Error('READINESS_CONTRACT_MISMATCH')
        result.model={...result.model,status:'success',reason:`Native source tool used ${reads} time(s); structured note validated; provider requests=${live.calls.length}; native error records=${live.calls.filter(call=>call.error_code).length}; project writes=0.`}
      }catch{result.model={...result.model,status:'failed',reason:'Native structured-reader check failed; no sample output substituted and no project result published.'}}
      finally{await live?.close()}
    }
  }
  if (config.modelConfigured&&!structuredOnly) {
    await ctx.plugin(DeepSeek, { apiKeyEnv: 'DEEPSEEK_API_KEY' })
    try {
      let chunks = 0, text = '', finish = 'missing'
      for await (const chunk of ctx.llm.stream({ provider: 'deepseek-official', model: config.DEEPSEEK_MODEL, reasoningEffort: ReasoningEffortId('off'), maxTokens: 256, messages: [createUserMessage({ content: [{ type: 'text', text: 'Reply with OK. This is a connectivity test with no private data.' }], source: { kind: 'user' } })], signal: AbortSignal.timeout(30000) })) {
        chunks++
        if (chunk.type === 'block-end' && chunk.block.type === 'text') text += chunk.block.text
        if (chunk.type === 'finish') finish = chunk.reason.kind
      }
      result.model = { ...result.model, status: finish === 'stop' && text.includes('OK') ? 'success' : 'failed', reason: `Terminal=${finish}; chunks=${chunks}; nonempty_text=${Boolean(text)}. Transport-error finishes never count as success.` }
    } catch { result.model = { ...result.model, status: 'failed', reason: 'Live provider rejected or failed the connectivity request; no fixture fallback.' } }
  }
  if (config.searchConfigured&&!structuredOnly) {
    await ctx.plugin(WebRuntime)
    await ctx.plugin(Search, { apiKeyEnv: process.env.DEEPSEEK_SEARCH_API_KEY ? 'DEEPSEEK_SEARCH_API_KEY' : 'DEEPSEEK_API_KEY', model: config.DEEPSEEK_MODEL, maxUses: 1, maxTokens: 512 })
    try {
      const response = await ctx.web.search({ query: '城市更新 住房城乡建设部', maxResults: 2 }, AbortSignal.timeout(30000))
      result.search = { status: 'success', reason: `Native structured search returned ${response.sources.length} source items; relevance not evaluated.` }
    } catch { result.search = { status: 'failed', reason: 'Native structured search failed; no alternative result substituted.' } }
  }
} finally {
  await ctx.fiber.dispose()
  await mkdir('research/live_smoke', { recursive: true })
  await writeFile(`research/live_smoke/${structuredOnly?'renewal-structured-status':'status'}.json`, JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify(result, null, 2))
}
