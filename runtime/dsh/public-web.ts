import { Context } from '@deepseek-ai/cordis'
import WebRuntime from '@deepseek-ai/dsh-web'
import * as Http from '@deepseek-ai/dsh-web-fetch-http'
import * as Search from '@deepseek-ai/dsh-web-search-deepseek'
import { installProxyFromEnvironment } from '@deepseek-ai/dsh-http-proxy'
import { config } from '../../apps/host/config'
import {DeepSeekWebTools} from './deepseek-web-tools'

let installed: Promise<void> | undefined
/** Use DSH's own process-wide transport policy, including mandatory loopback bypass. */
export function ensureHarnessNetwork(): Promise<void> {
  installed ??= installProxyFromEnvironment({ get: name => process.env[name] === undefined ? undefined : { value: process.env[name]! } }, () => {
    console.warn('DSH rejected an unsupported local proxy setting; check the launch environment.')
  }).then(() => undefined)
  return installed
}

export async function mountPublicWeb(ctx: Context, policy: {maxRedirects?: 0 | 1 | 2; maxSearchUses?: number;provider?:'legacy'|'deepseek_tools'|'deepseek_content';onReceipt?:(receipt:import('./deepseek-web-tools').WebCallReceipt)=>Promise<void>} = {}):Promise<{provider:string;receipts:import('./deepseek-web-tools').WebCallReceipt[]}> {
  await ensureHarnessNetwork()
  const provider=policy.provider||config.RESEARCH_WEB_PROVIDER
  if(provider!=='legacy'){
    await ctx.plugin(WebRuntime,{searchProvider:'deepseek-tools',fetchProvider:'deepseek-tools'})
    const fallback=new Context();await mountPublicWeb(fallback,{...policy,provider:'legacy'})
    ctx.effect(()=>()=>fallback.fiber.dispose())
    const tools=new DeepSeekWebTools({key:()=>process.env.DEEPSEEK_SEARCH_API_KEY||process.env.DEEPSEEK_API_KEY||'',includeContent:provider==='deepseek_content',maxSearchRequests:Math.min(12,Math.max(1,policy.maxSearchUses||6)),onReceipt:policy.onReceipt},fallback.web)
    ctx.web.registerSearchProvider(tools);ctx.web.registerFetchProvider(tools)
    return {provider,receipts:tools.receipts}
  }
  await ctx.plugin(WebRuntime)
  await ctx.plugin(Http, { maxResponseBytes: 2_000_000, maxBodyChars: 80000, timeoutMs: 15000, maxRedirects: policy.maxRedirects ?? 2, userAgent: 'haizhizi-research/0.2 (local research workbench)' })
  await ctx.plugin(Search, { apiKeyEnv: process.env.DEEPSEEK_SEARCH_API_KEY ? 'DEEPSEEK_SEARCH_API_KEY' : 'DEEPSEEK_API_KEY', model: config.DEEPSEEK_MODEL, maxUses: Math.min(6, Math.max(1, policy.maxSearchUses ?? 2)), maxTokens: 1800 })
  return {provider:'legacy',receipts:[]}
}
