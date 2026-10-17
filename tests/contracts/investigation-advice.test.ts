import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {config} from '../../apps/host/config'
import express from 'express'
import type {Server} from 'node:http'
import {assertObjectJsonSchema} from '@deepseek-ai/dsh-tools'
import {modelSchema} from '../../packages/contracts/validate'
import {investigationAdviceInput,type InvestigationAdviceResult} from '../../packages/retrofit/investigation-advice'
import {registerProjectAdvice} from '../../apps/host/project-advice'
import type {Store} from '../../apps/host/store'
import {guideProject,guidePacket} from './project-decision-fixture'
import {generateInvestigationAdvice} from '../../services/map-screening/investigation-advice'
const port=vi.hoisted(()=>({open:vi.fn()}))
vi.mock('../../runtime/dsh/live-session',()=>({LiveSession:{open:port.open}}))
let server:Server|undefined
const configured=config.modelConfigured
beforeEach(()=>{config.modelConfigured=true})
afterEach(async()=>{config.modelConfigured=configured;if(server)await new Promise<void>(resolve=>server!.close(()=>resolve()));server=undefined;vi.restoreAllMocks()})
function scope(){const project=structuredClone(guideProject),packet=guidePacket();project.input.scope={...project.input.scope,name:'建工新村',city:'天津市'};packet.sources[0].url='https://www.hangzhou.gov.cn/case';packet.sources[0].text='杭州案例原文，仅供方法对标。';packet.content_review!.issues=[{code:'OBJECT_LOCATION_CONFLICT',path:'sources.PUBLIC',message:'异地对象'}];packet.content_review!.follow_up={search_queries:['天津市 建工新村 项目地址 工程范围'],reading_focus:['核对同名资料中的项目地址和研究范围。'],internal_data:['项目位置、边界及对应资料的对象登记。']};return {project,packet}}
const step=(id='t1')=>({task_id:id,action:'先核对地址与楼栋清册',reason:'先区分天津登记与杭州案例，避免沿用异地工程量',material:'标准地址、楼栋清册及来源原件',channel:'属地街道或住房管理部门',completion_check:'逐项对照地址、楼栋编号与原文发布对象',evidence_refs:['s1']})

it('limits object guidance to current object checks and keeps private source/derived task text out of the actual model prompt',async()=>{
 const {project,packet}=scope();packet.strategy!.summary='PRIVATE_CANARY';packet.strategy!.next_checks.push({title:'PRIVATE_CANARY',detail:'PRIVATE_CANARY',evidence_refs:['PRIVATE']});packet.sources.push({...packet.sources[0],id:'PRIVATE',text:'PRIVATE_CANARY',title:'PRIVATE_CANARY',data_class:'internal',visibility:'internal'})
 const input=investigationAdviceInput(project.input,2,packet,null)
 expect(input.private_context_omitted).toBe(true);expect(input.candidates).toHaveLength(3)
 expect(JSON.stringify(input.model_context)+JSON.stringify(input.sources)).not.toContain('PRIVATE_CANARY')
 const call=vi.fn(async(_stage:string,_prompt:string)=>({value:{summary:'按天津登记核对资料。',steps:[step()]}})),close=vi.fn();port.open.mockResolvedValue({call,close,calls:[]})
 const result=await generateInvestigationAdvice(input,'hash',new AbortController().signal)
 expect(call.mock.calls[0][1]).not.toContain('PRIVATE_CANARY');expect(result.steps[0].task_id).toBe(input.candidates[0].id);expect(result.steps[0].evidence_refs).toEqual(['PUBLIC']);expect(close).toHaveBeenCalledOnce()
})
it('uses the supported DSH schema subset with closed task aliases and empty source support',()=>{
 for(const evidenceIds of [[],['s1']]){const schema=modelSchema('InvestigationAdvice',undefined,{evidenceIds,investigationTaskIds:['t1','t2']});expect(()=>assertObjectJsonSchema(schema)).not.toThrow();expect((schema.properties as any).steps.items.properties.task_id.enum).toEqual(['t1','t2'])}
})
it('does not accept invented task or source references as actionable advice',async()=>{
 const {project,packet}=scope(),input=investigationAdviceInput(project.input,2,packet,null)
 for(const bad of [{...step(),task_id:'OTHER'},{...step(),evidence_refs:['UNKNOWN']}]){
  port.open.mockResolvedValue({call:async()=>({value:{summary:'需核对对象',steps:[bad]}}),close:vi.fn(),calls:[]})
  await expect(generateInvestigationAdvice(input,'hash',new AbortController().signal)).rejects.toThrow('ADVICE_REFERENCE_INVALID')
 }
})
it('reuses the existing owner/project cache, reads without model calls, deduplicates parallel generation and fences changed context',async()=>{
 const {project,packet}=scope(),cache=new Map<string,unknown>();let changed=false,release:()=>void=()=>{}
 const store={db:{exec:vi.fn(),query:vi.fn(async(sql:string,params:unknown[])=>{
  if(sql.startsWith('INSERT INTO project_decision_guidance')){cache.set(String(params[2]),JSON.parse(String(params[3])));return {rows:[]}}
  if(sql.includes('FROM project_decision_guidance'))return {rows:cache.has(String(params[2]))?[{payload:cache.get(String(params[2]))}]:[]}
  if(sql.includes('renewal_strategy_assessments'))return {rows:[{payload:packet,saved_at:packet.created_at}]}
  if(sql.includes('to_regclass'))return {rows:[{present:true}]}
  return {rows:[]}
 })}} as unknown as Store
 const generate=vi.fn(async(input:any,hash:string)=>({policy:'investigation-advice-v1',project_id:project.id,context_version:2,strategy_hash:packet.input_hash,strategy_created_at:packet.created_at,input_hash:hash,direction:null,created_at:new Date().toISOString(),duration_ms:100,reused:false,summary:'精确核对天津对象',steps:[{...step(),task_id:input.candidates[0].id,evidence_refs:['PUBLIC'],title:'地址核查'}],source_count:1,private_context_omitted:false,model_label:'DeepSeek-V4.1-Flash-1017',model_calls:[]} as InvestigationAdviceResult))
 const app=express();app.use(express.json());await registerProjectAdvice(app,store,async()=>({...project,context_version:changed?3:2}),generate)
 await new Promise<void>(resolve=>{server=app.listen(0,'127.0.0.1',()=>resolve())});const url=`http://127.0.0.1:${(server!.address() as any).port}/api/projects/P-GUIDE/investigation-advice`
 const request={expected_context_version:2,expected_strategy_hash:packet.input_hash,direction:null},send=(body=request)=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
 expect(await (await fetch(url)).json()).toBeNull();expect(generate).not.toHaveBeenCalled()
 let enter:()=>void=()=>{};const entered=new Promise<void>(resolve=>{enter=resolve}),barrier=new Promise<void>(resolve=>{release=resolve})
 const original=generate.getMockImplementation()!;generate.mockImplementationOnce(async(...args)=>{enter();await barrier;return original(...args)})
 const first=send();await entered;const second=send();await new Promise(resolve=>setTimeout(resolve,15));release();const results=await Promise.all([first,second]);expect(results.every(r=>r.status===200)).toBe(true);expect(generate).toHaveBeenCalledTimes(1)
 expect((await (await fetch(url)).json()).reused).toBe(true);expect(cache.size).toBe(1)
 changed=true;expect((await send()).status).toBe(409);expect(generate).toHaveBeenCalledTimes(1)
 changed=false;generate.mockImplementationOnce(async(...args)=>{const result=await original(...args);changed=true;return result})
 expect((await send({...request,refresh:true} as any)).status).toBe(409);expect(cache.size).toBe(1)
})
