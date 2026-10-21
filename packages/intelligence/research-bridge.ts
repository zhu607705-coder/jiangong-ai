import type { Source } from '../../apps/host/generated/contracts'
export type IntelligenceOrigin={project_id:string;context_version:number}
/** Host installs these once. Standalone capability/tests keep the original behavior. */
export interface IntelligenceHooks {
  webCall?(receipt:import('../../runtime/dsh/deepseek-web-tools').WebCallReceipt):Promise<void>
  lookup(request:{name:string;city?:string;purpose:string;asOf:string},signal:AbortSignal):Promise<Source[]>
  revision?(request:{name:string;city?:string;purpose:string;asOf:string}):Promise<string>
  remember(sources:Source[],city?:string,origin?:IntelligenceOrigin):Promise<void>
}
let hooks:IntelligenceHooks|undefined
/** A missing quota ledger falls back to the existing provider, never unmetered Tencent calls. */
export async function recordProviderWebCall(receipt:import('../../runtime/dsh/deepseek-web-tools').WebCallReceipt){if(!hooks?.webCall)throw Error('TENCENT_WSA_QUOTA_UNAVAILABLE');await hooks.webCall(receipt)}
export function installIntelligenceHooks(value:IntelligenceHooks){hooks=value;return ()=>{if(hooks===value)hooks=undefined}}
export async function recallIntelligence(request:{name:string;city?:string;purpose:string;asOf:string},signal:AbortSignal):Promise<Source[]>{
  if(!hooks)return []
  try{return await hooks.lookup(request,AbortSignal.any([signal,AbortSignal.timeout(3000)]))}catch{signal.throwIfAborted();return []}
}
export async function rememberIntelligence(sources:Source[],city?:string,origin?:IntelligenceOrigin){
  if(!hooks)return
  try{await hooks.remember(sources,city,origin)}catch{console.warn('INTELLIGENCE_PERSIST_FAILED: original research artifacts remain available')}
}

export async function intelligenceScopeRevision(request:{name:string;city?:string;purpose:string;asOf:string}):Promise<string>{
  if(!hooks?.revision)return 'not_installed'
  let timer:ReturnType<typeof setTimeout>|undefined
  try{return await Promise.race([hooks.revision(request),new Promise<string>(resolve=>{timer=setTimeout(()=>resolve('unavailable'),2500)})])}catch{return 'unavailable'}finally{if(timer)clearTimeout(timer)}
}
