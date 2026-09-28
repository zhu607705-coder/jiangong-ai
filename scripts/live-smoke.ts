import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import * as DeepSeek from '@deepseek-ai/dsh-llm-deepseek-api-key'
import WebRuntime from '@deepseek-ai/dsh-web'
import * as Search from '@deepseek-ai/dsh-web-search-deepseek'
import { mkdir, writeFile } from 'node:fs/promises'
import { config } from '../apps/host/config'

const ctx = new Context()
const result = { checked_at: new Date().toISOString(), model: { status: 'blocked_external', reason: 'DEEPSEEK_API_KEY is not configured', requested_model: config.DEEPSEEK_MODEL }, search: { status: 'blocked_external', reason: 'DeepSeek search credential is not configured' } }
try {
  await ctx.plugin(LlmRuntime)
  if (config.modelConfigured) {
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
  if (config.searchConfigured) {
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
  await writeFile('research/live_smoke/status.json', JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify(result, null, 2))
}
