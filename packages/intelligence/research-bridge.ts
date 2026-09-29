import type { Source } from '../../apps/host/generated/contracts'
/** Host installs these once. Standalone capability/tests keep the original behavior. */
export interface IntelligenceHooks {
  lookup(request:{name:string;city?:string;purpose:string;asOf:string},signal:AbortSignal):Promise<Source[]>
  revision?(request:{name:string;city?:string;purpose:string;asOf:string}):Promise<string>
  remember(sources:Source[],city?:string):Promise<void>
}
let hooks:IntelligenceHooks|undefined
export function installIntelligenceHooks(value:IntelligenceHooks){hooks=value;return ()=>{if(hooks===value)hooks=undefined}}
export async function recallIntelligence(request:{name:string;city?:string;purpose:string;asOf:string},signal:AbortSignal):Promise<Source[]>{
  if(!hooks)return []
  try{return await hooks.lookup(request,AbortSignal.any([signal,AbortSignal.timeout(3000)]))}catch{signal.throwIfAborted();return []}
}
export async function rememberIntelligence(sources:Source[],city?:string){
  if(!hooks)return
  try{await hooks.remember(sources,city)}catch{console.warn('INTELLIGENCE_PERSIST_FAILED: original research artifacts remain available')}
}

export async function intelligenceScopeRevision(request:{name:string;city?:string;purpose:string;asOf:string}):Promise<string>{
  if(!hooks?.revision)return 'not_installed'
  let timer:ReturnType<typeof setTimeout>|undefined
  try{return await Promise.race([hooks.revision(request),new Promise<string>(resolve=>{timer=setTimeout(()=>resolve('unavailable'),2500)})])}catch{return 'unavailable'}finally{if(timer)clearTimeout(timer)}
}
