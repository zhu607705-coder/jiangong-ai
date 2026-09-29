import {test,expect,vi} from 'vitest'
import {config} from '../../apps/host/config'
import {LiveSession} from '../../runtime/dsh/live-session'
import * as qwen from '../../services/capabilities/intelligence-decision'
import {intelligenceJudge,intelligenceRoutes} from '../../runtime/intelligence/judge'
test('intake judgement goes through DSH ToolRuntime to existing Qwen adapter',async()=>{
  const saved={modelConfigured:config.modelConfigured,decisionConfigured:config.decisionConfigured,decisionEnabled:config.decisionEnabled}
  Object.assign(config,{modelConfigured:true,decisionConfigured:true,decisionEnabled:true})
  const result={value:{label:'PASS'},model:'decision-model-preview',usage:{}}
  const adapter=vi.spyOn(qwen,'judgeIntelligenceDecision').mockResolvedValue(result as any)
  const capability=vi.fn(async(_name:string,execute:(s:AbortSignal)=>Promise<unknown>)=>execute(new AbortController().signal)),close=vi.fn()
  const opened=vi.spyOn(LiveSession,'open').mockResolvedValue({runReadCapability:capability,close} as unknown as LiveSession)
  try{const output=await intelligenceJudge('prefilter',{title:'fixture'}, {},'test policy',new AbortController().signal,intelligenceRoutes().prefilter);expect(output).toEqual(result);expect(capability).toHaveBeenCalledWith('intelligence_prefilter',expect.any(Function));expect(adapter).toHaveBeenCalledOnce();expect(close).toHaveBeenCalledOnce()}finally{opened.mockRestore();adapter.mockRestore();Object.assign(config,saved)}
})
