import { Context } from '@deepseek-ai/cordis'
import WebRuntime from '@deepseek-ai/dsh-web'
import * as Http from '@deepseek-ai/dsh-web-fetch-http'
import * as Search from '@deepseek-ai/dsh-web-search-deepseek'
import { installProxyFromEnvironment } from '@deepseek-ai/dsh-http-proxy'
import { config } from '../../apps/host/config'

let installed: Promise<void> | undefined
/** Use DSH's own process-wide transport policy, including mandatory loopback bypass. */
export function ensureHarnessNetwork(): Promise<void> {
  installed ??= installProxyFromEnvironment({ get: name => process.env[name] === undefined ? undefined : { value: process.env[name]! } }, () => {
    console.warn('DSH rejected an unsupported local proxy setting; check the launch environment.')
  }).then(() => undefined)
  return installed
}

export async function mountPublicWeb(ctx: Context, policy: {maxRedirects?: 0 | 1 | 2; maxSearchUses?: number} = {}) {
  await ensureHarnessNetwork()
  await ctx.plugin(WebRuntime)
  await ctx.plugin(Http, { maxResponseBytes: 2_000_000, maxBodyChars: 80000, timeoutMs: 15000, maxRedirects: policy.maxRedirects ?? 2, userAgent: 'haizhizi-research/0.2 (local research workbench)' })
  await ctx.plugin(Search, { apiKeyEnv: process.env.DEEPSEEK_SEARCH_API_KEY ? 'DEEPSEEK_SEARCH_API_KEY' : 'DEEPSEEK_API_KEY', model: config.DEEPSEEK_MODEL, maxUses: Math.min(6, Math.max(1, policy.maxSearchUses ?? 2)), maxTokens: 1800 })
}
