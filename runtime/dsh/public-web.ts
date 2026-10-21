import { Context } from '@deepseek-ai/cordis'
import WebRuntime from '@deepseek-ai/dsh-web'
import * as Http from '@deepseek-ai/dsh-web-fetch-http'
import * as Search from '@deepseek-ai/dsh-web-search-deepseek'
import { installProxyFromEnvironment } from '@deepseek-ai/dsh-http-proxy'
import { config } from '../../apps/host/config'
import {DeepSeekWebTools} from './deepseek-web-tools'
import {TencentWebSearch} from './tencent-web-search'
import {recordProviderWebCall} from '../../packages/intelligence/research-bridge'
import type {WebCallReceipt} from './deepseek-web-tools'

export type PublicWebProvider='legacy'|'deepseek_tools'|'deepseek_content'|'tencent_wsa'
/** Same provider factory for project research, RAG supplements and corpus collection. */
export function createPublicWebTools(policy:{provider?:PublicWebProvider;maxSearchUses?:number;onReceipt?:(receipt:WebCallReceipt)=>Promise<void>}={},legacy?:ConstructorParameters<typeof DeepSeekWebTools>[1],transport:typeof fetch=fetch){
  const provider=policy.provider||config.RESEARCH_WEB_PROVIDER,receipts:WebCallReceipt[]=[]
  const record=async(value:WebCallReceipt)=>{const i=receipts.findIndex(r=>r.id===value.id);if(i<0)receipts.push(value);else receipts[i]=value;await policy.onReceipt?.(value)}
  const tools=new DeepSeekWebTools({key:()=>process.env.DEEPSEEK_SEARCH_API_KEY||process.env.DEEPSEEK_API_KEY||'',includeContent:provider!=='deepseek_tools',maxSearchRequests:Math.min(12,Math.max(1,policy.maxSearchUses||6)),onReceipt:record},legacy,transport)
  const search=provider==='tencent_wsa'?new TencentWebSearch({key:()=>process.env.TENCENTCLOUD_WSA_APIKEY||'',maxSearchRequests:Math.min(12,Math.max(1,policy.maxSearchUses||6)),timeoutMs:config.TENCENT_WSA_TIMEOUT_MS,edition:config.TENCENT_WSA_EDITION,industry:config.TENCENT_WSA_INDUSTRY,record:recordProviderWebCall,onReceipt:record},tools,transport):tools
  return {searchProvider:search,fetchProvider:tools,receipts,search:search.search.bind(search),fetch:tools.fetch.bind(tools)}
}

let installed: Promise<void> | undefined
/** Use DSH's own process-wide transport policy, including mandatory loopback bypass. */
export function ensureHarnessNetwork(): Promise<void> {
  installed ??= installProxyFromEnvironment({ get: name => process.env[name] === undefined ? undefined : { value: process.env[name]! } }, () => {
    console.warn('DSH rejected an unsupported local proxy setting; check the launch environment.')
  }).then(() => undefined)
  return installed
}

export async function mountPublicWeb(ctx: Context, policy: {maxRedirects?: 0 | 1 | 2; maxSearchUses?: number;provider?:PublicWebProvider;onReceipt?:(receipt:WebCallReceipt)=>Promise<void>} = {}):Promise<{provider:string;receipts:WebCallReceipt[]}> {
  await ensureHarnessNetwork()
  const provider=policy.provider||config.RESEARCH_WEB_PROVIDER
  if(provider!=='legacy'){
    await ctx.plugin(WebRuntime,{searchProvider:provider==='tencent_wsa'?'tencent-wsa':'deepseek-tools',fetchProvider:'deepseek-tools'})
    const fallback=new Context();await mountPublicWeb(fallback,{...policy,provider:'legacy'})
    ctx.effect(()=>()=>fallback.fiber.dispose())
    const tools=createPublicWebTools(policy,fallback.web)
    ctx.web.registerSearchProvider(tools.searchProvider);ctx.web.registerFetchProvider(tools.fetchProvider)
    return {provider,receipts:tools.receipts}
  }
  await ctx.plugin(WebRuntime)
  await ctx.plugin(Http, { maxResponseBytes: 2_000_000, maxBodyChars: 80000, timeoutMs: 15000, maxRedirects: policy.maxRedirects ?? 2, userAgent: 'haizhizi-research/0.2 (local research workbench)' })
  await ctx.plugin(Search, { apiKeyEnv: process.env.DEEPSEEK_SEARCH_API_KEY ? 'DEEPSEEK_SEARCH_API_KEY' : 'DEEPSEEK_API_KEY', model: config.DEEPSEEK_MODEL, maxUses: Math.min(6, Math.max(1, policy.maxSearchUses ?? 2)), maxTokens: 1800 })
  return {provider:'legacy',receipts:[]}
}
