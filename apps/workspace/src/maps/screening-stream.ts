import type { ResearchEvent } from '../../../../packages/research/events'
import type { MapRegionGeometry, MapScreenBounds, MapScreenCell, MapScreenProfile, MapScreenResult, MapScreenTheme } from '../../../host/generated/contracts'

export type ScreenEvent = {type:'progress';message:string} | { type: 'start'; id: string; cells: MapScreenCell[] } | { type: 'cell'; cell: MapScreenCell; completed: number; total: number } | { type: 'complete'; result: MapScreenResult } | { type: 'error'; message: string; code?:string;request_id?:string }
export async function scanMap(bounds: MapScreenBounds, profile: MapScreenProfile, theme: MapScreenTheme, signal: AbortSignal, receive: (event: ScreenEvent) => void, geometry?:MapRegionGeometry) {
  const response = await fetch('/api/maps/screening/scan', { method: 'POST', credentials: 'same-origin', signal,
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'haizhizi' }, body: JSON.stringify({ bounds, profile, theme,...(geometry?{geometry}:{}) }) })
  if (!response.ok || !response.body) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error.detail || '区域筛选未启动。')
  }
  await consumeStream<ScreenEvent>(response,signal,receive)
}
export async function analyzeSelection(contextId:string,profile:MapScreenProfile,signal:AbortSignal,receive:(event:ResearchEvent)=>void){
  const response=await fetch('/api/maps/screening/analysis',{method:'POST',credentials:'same-origin',signal,headers:{'Content-Type':'application/json','Accept':'application/x-ndjson','X-Requested-With':'haizhizi'},body:JSON.stringify({context_id:contextId,profile})})
  if(!response.ok||!response.body){const e=await response.json().catch(()=>({}));throw Error(e.detail||'研究未启动。')}
  // Compatibility with older hosts is explicit; no simulated streaming.
  if(response.headers.get('content-type')?.includes('application/json')){receive({type:'complete',result:await response.json()});return}
  await consumeStream<ResearchEvent>(response,signal,receive)
}
export async function consumeStream<T extends {type:string}>(response:Response,signal:AbortSignal,receive:(event:T)=>void){
  const reader=response.body!.getReader(),decoder=new TextDecoder();let pending='',terminal=false
  const abort=()=>{void reader.cancel(signal.reason).catch(()=>undefined)}
  signal.addEventListener('abort',abort,{once:true})
  const consume=(line:string)=>{if(!line.trim()||signal.aborted)return;const event=JSON.parse(line) as T;if(terminal)return;if(event.type==='complete'||event.type==='error')terminal=true;receive(event)}
  try{
    while(true){const {done,value}=await reader.read();signal.throwIfAborted();pending+=decoder.decode(value,{stream:!done});if(pending.length>2000000)throw Error('研究响应过大。');const lines=pending.split('\n');pending=lines.pop()!;lines.forEach(consume);if(done)break}
    if(pending.trim())consume(pending)
    if(!terminal&&!signal.aborted)throw Error('研究连接中断，已取得的进度保留。')
  }finally{signal.removeEventListener('abort',abort);await reader.cancel().catch(()=>undefined)}
}
