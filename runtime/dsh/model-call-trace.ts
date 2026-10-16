import type {StreamChunk} from '@deepseek-ai/dsh-llm'
import type {ModelCall} from '../../apps/host/generated/contracts'

/** Persist every stream attempt, including throws and consumer cancellation. */
export async function* observeModelStream(model:string,stage:string,signal:AbortSignal,next:()=>AsyncIterable<StreamChunk>,record:(call:ModelCall)=>void,onChunk:(chunk:StreamChunk)=>void=()=>{},onFailure:(message:string)=>void=()=>{}) {
  const start=Date.now(),call:ModelCall={stage,requested_model:model,returned_model:null,finish_reason:'missing',input_tokens:0,output_tokens:0,usage_status:'unknown',duration_ms:0,session_id:null}
  try {
    for await(const chunk of next()) {
      onChunk(chunk)
      if(chunk.type==='usage') {
        call.usage_status='reported'
        call.cache_read_tokens=Math.max(call.cache_read_tokens||0,chunk.usage.cacheReadTokens||0)
        call.cache_write_tokens=Math.max(call.cache_write_tokens||0,chunk.usage.cacheWriteTokens||0)
        call.input_tokens=Math.max(call.input_tokens,(chunk.usage.inputTokens||0)+(chunk.usage.cacheReadTokens||0)+(chunk.usage.cacheWriteTokens||0))
        call.output_tokens=Math.max(call.output_tokens,chunk.usage.outputTokens||0)
      }
      if(chunk.type==='finish') {
        call.finish_reason=chunk.reason.kind
        call.returned_model=(chunk.replayState?.response as {model?:string}|undefined)?.model||null
        if(chunk.reason.kind==='error'){call.error_code=chunk.reason.failure.code||'MODEL_ERROR';onFailure(chunk.reason.failure.message)}
      }
      yield chunk
    }
  } catch(error) {
    call.finish_reason=signal.aborted||error instanceof Error&&error.name==='AbortError'?'aborted':'error'
    call.error_code=call.finish_reason==='aborted'?'CANCELLED':'TRANSPORT'
    throw error
  } finally {
    if(call.finish_reason==='missing')call.finish_reason=signal.aborted?'aborted':'incomplete'
    call.duration_ms=Date.now()-start;record(call)
  }
}
