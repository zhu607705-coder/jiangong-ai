import { afterEach, describe, expect, it, vi } from 'vitest'
import { requestDecisionQuestions, decisionCacheDescriptor, decisionRequestBody } from '../../services/capabilities/decision-model'
import { decisionErrorMessage } from '../../packages/decision/route-labels'
const settings={apiKey:'test-only',endpoint:'https://maas.qianwenaiapi.com',model:'decision-model-preview',timeoutMs:50}
const questions={check:{type:'noul'}}
afterEach(()=>vi.restoreAllMocks())
describe('bounded decision response lifecycle',()=>{
  it('keys reuse by actual Qwen question meaning and source state without credential or unrelated text-model data',()=>{
    const input={state:{as_of:'2026-10-04',facts:[]},factors:[],sourceIds:['S1'],profile:'neighborhood' as const}
    const descriptor=decisionCacheDescriptor(input,settings)
    expect(typeof descriptor.policy).toBe('string')
    expect(descriptor.request).toEqual(decisionRequestBody(input,settings.model))
    expect(JSON.stringify(descriptor)).not.toContain(settings.apiKey)
    expect(JSON.stringify(descriptor)).not.toContain('deepseek')
    expect(decisionCacheDescriptor({...input,state:{...input.state,as_of:'2026-10-05'}},settings)).not.toEqual(descriptor)
    expect(decisionCacheDescriptor({...input,profile:'balanced'},settings).request.questions).not.toEqual(descriptor.request.questions)
  })
  it('times out a stalled body and releases its reader',async()=>{
    const cancel=vi.fn(),transport=vi.fn(async()=>new Response(new ReadableStream({cancel})))
    await expect(requestDecisionQuestions({},questions,new AbortController().signal,{...settings,timeoutMs:10},transport)).rejects.toThrow('DECISION_TIMEOUT')
    expect(transport).toHaveBeenCalledTimes(1);expect(cancel).toHaveBeenCalledTimes(1)
  })
  it('preserves explicit caller cancellation and discards late response bodies',async()=>{
    const controller=new AbortController(),reason=new Error('user stopped'),cancel=vi.fn()
    const transport=async()=>{controller.abort(reason);return new Response(new ReadableStream({cancel}))}
    await expect(requestDecisionQuestions({},questions,controller.signal,settings,transport)).rejects.toBe(reason)
    expect(cancel).toHaveBeenCalledTimes(1)
  })
  it('does not start a request for invalid model or deadline settings',async()=>{
    const transport=vi.fn()
    await expect(requestDecisionQuestions({},questions,new AbortController().signal,{...settings,model:'different-model'},transport)).rejects.toThrow('DECISION_MODEL_INVALID')
    await expect(requestDecisionQuestions({},questions,new AbortController().signal,{...settings,timeoutMs:0},transport)).rejects.toThrow('DECISION_TIMEOUT_INVALID')
    expect(transport).not.toHaveBeenCalled()
  })
  it('reports malformed JSON without a substituted answer or transport details',async()=>{
    await expect(requestDecisionQuestions({},questions,new AbortController().signal,settings,async()=>new Response('{'))).rejects.toThrow('DECISION_INVALID_RESPONSE')
  })
  it('keeps typed HTTP errors and actionable safe presentation',async()=>{
    for(const status of [401,403,404,429]){
      await expect(requestDecisionQuestions({},questions,new AbortController().signal,settings,async()=>new Response('private upstream details',{status}))).rejects.toThrow('DECISION_HTTP_'+status)
    }
    expect(decisionErrorMessage('DECISION_TIMEOUT')).toContain('超时')
    expect(decisionErrorMessage('DECISION_HTTP_429')).toContain('限流')
    expect(decisionErrorMessage('private-upstream-secret')).not.toContain('secret')
  })
})
