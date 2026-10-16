import {validate} from '../../packages/contracts/validate'
import {expect,it,vi} from 'vitest'
import {installIntelligenceHooks} from '../../packages/intelligence/research-bridge'
import {collectSelectedEvidence} from '../../services/capabilities/research'
import type {StreamChunk} from '@deepseek-ai/dsh-llm'
import type {ModelCall} from '../../apps/host/generated/contracts'
import {observeModelStream} from '../../runtime/dsh/model-call-trace'
import {captureCurrentAssessment,currentAssessment} from '../../packages/retrofit/strategy-assessment'
import {readRetrievalContext,passageQueryMatches,queryObjectCompatible,type RetrievalCandidate} from '../../packages/experience/retrieval'

it('retains stream failure metadata when the provider throws before reporting any usage',async()=>{
  const calls:ModelCall[]=[]
  const stream=observeModelStream('provider-model','expert-cost',new AbortController().signal,async function*(){throw new Error('private transport message')},call=>calls.push(call))
  await expect(async()=>{for await(const _ of stream){}}).rejects.toThrow('private transport message')
  expect(calls).toHaveLength(1)
  expect(calls[0]).toMatchObject({stage:'expert-cost',finish_reason:'error',error_code:'TRANSPORT',usage_status:'unknown'})
  expect(JSON.stringify(calls)).not.toContain('private transport message')
})

it('preserves already reported usage when the consumer cancels a partial stream',async()=>{
  const calls:ModelCall[]=[]
  const stream=observeModelStream('provider-model','expert',new AbortController().signal,async function*(){
    yield {type:'usage',usage:{inputTokens:42,outputTokens:9}} as StreamChunk
    throw new Error('This must not be consumed after breaking')
  },call=>calls.push(call))
  for await(const _ of stream)break
  expect(calls).toHaveLength(1);expect(calls[0]).toMatchObject({input_tokens:42,output_tokens:9,usage_status:'reported',finish_reason:'incomplete'})
})

it('validates dimensions independently and binds the artifact to the same input snapshot',()=>{
  const packet={input_hash:'snapshot-one',context_version:3,created_at:'2026-10-16T13:00:00Z'}
  const artifact=captureCurrentAssessment({paths:'invalid',dimensions:[{key:'demand',current:'调查记录支持需求。',current_level:'high',evidence_refs:['UNKNOWN']},{key:'resources',current:'资金金额未取得。',current_level:'unknown',evidence_refs:[]}]},packet,[])
  expect(artifact?.dimensions).toHaveLength(2)
  expect(artifact?.issues).toContainEqual({key:'demand',reason:'现况等级缺少本对象依据，保留分析文字并列入资料补充'})
  expect(currentAssessment({...packet,current_assessment:artifact,input_hash:'other'} as any)).toBeNull()
})

it('reads separate headings, table headers and neighboring data without concatenating original quotes',()=>{
  const item=(id:string,locator:string,text:string)=>({id,document_id:'same-document',version:'v1',file_name:'75幢1单元加装电梯方案',locator,text} as RetrievalCandidate)
  const header=item('H','line:1','# 75幢1单元加装电梯方案'),table=item('T','table:1/row:1','预计总额（万元）'),amount=item('A','table:1/row:2','80')
  const context=readRetrievalContext(amount,[header,table,amount,item('OTHER','table:1/row:1','其他资料')].map((row,index)=>index===3?{...row,version:'v2'}:row))
  expect(context.map(row=>row.id)).toEqual(['H','T'])
  expect(context.every(row=>row.version==='v1'&&row.document_id==='same-document')).toBe(true)
  expect(amount.text).toBe('80')
  expect(passageQueryMatches('75幢1单元加电梯要多少钱',amount.file_name,[amount.text,...context.map(row=>row.text)].join('\n'))).toBe(true)
  expect(queryObjectCompatible('75幢1单元加梯预算','75幢2单元电梯预算80万元')).toBe(false)
})

it('controls intelligence reading and persistence separately under the frozen research cutoff',async()=>{
 const lookup=vi.fn(async(_request:unknown,_signal:AbortSignal)=>[]),remember=vi.fn(async()=>{}),remove=installIntelligenceHooks({lookup,remember})
 const web={search:vi.fn(async()=>({sources:[]})),fetch:vi.fn()}
 try{
  await collectSelectedEvidence({name:'求是村',purpose:'供水改造',asOf:'2026-10-16',intelligence:false,intelligencePolicy:{readExisting:true,rememberNew:false,checkFreshness:false}},new AbortController().signal,()=>{},web,['求是村供水'])
  expect(lookup).toHaveBeenCalledTimes(1);expect(remember).not.toHaveBeenCalled()
  expect(lookup.mock.calls[0][0]).toMatchObject({name:'求是村',asOf:'2026-10-16'})
  await collectSelectedEvidence({name:'求是村',purpose:'供水改造',asOf:'2026-10-16',intelligencePolicy:{readExisting:false,rememberNew:true,checkFreshness:false}},new AbortController().signal,()=>{},web,['求是村供水'])
  expect(lookup).toHaveBeenCalledTimes(1);expect(remember).toHaveBeenCalledTimes(1)
 }finally{remove()}
})

it('does not reject otherwise readable strategy prose for a card length while retaining field types',()=>{
 const value={headline:'具体分析内容'.repeat(100),summary:'原文和解释保留。'.repeat(100),preferred_mode:'compare',rationale:[],paths:[],dimensions:[],next_checks:[]}
 expect(validate('RenewalStrategy',value)).toBe(value)
 expect(()=>validate('RenewalStrategy',{...value,headline:42})).toThrow()
})
