import express from 'express'
import type { Server } from 'node:http'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import fixture from '../../fixtures/inputs/01_auto.json'
import type { ProjectInput, RenewalStrategy } from '../../apps/host/generated/contracts'
import { Store, type Database, type ProjectRecord } from '../../apps/host/store'
import { config } from '../../apps/host/config'
import type { StrategyPacket, StrategySource } from '../../packages/retrofit/strategy'
import type { ResearchRound, ResearchRoundsResponse } from '../../packages/retrofit/research-rounds'
import { parseResearchMaterialMetadata, type ResearchRoundsService } from '../../apps/host/research-rounds'
import { withConcreteWorkPlan, withReasoningDimensions } from './fixtures/strategy-work-plan'

const ports=vi.hoisted(()=>({open:vi.fn(),search:vi.fn(),prompts:[] as string[]}))
vi.mock('../../runtime/dsh/live-session',()=>({LiveSession:{open:ports.open}}))
vi.mock('../../services/capabilities/research',()=>({collectSelectedEvidence:ports.search}))
vi.mock('../../services/map-screening/renewal-history',()=>({renewalHistory:async()=>({records:[],official_costs:[]})}))
import { registerRenewalMode } from '../../apps/host/renewal-mode'

let store:Store,service:ResearchRoundsService,server:Server,origin:string
const settings={modelConfigured:config.modelConfigured,searchConfigured:config.searchConfigured,decisionEnabled:config.decisionEnabled,ALLOW_INTERNAL_MODEL:config.ALLOW_INTERNAL_MODEL}
const original='演示小区供水管线需要分栋核查，居民停水安排和持续维护责任尚待确认。'
function proposal(source:StrategySource,parent=false):RenewalStrategy {
  const refs=[source.id]
  return withReasoningDimensions(withConcreteWorkPlan({headline:'按本轮演示材料优先安排管线核查与居民协商',summary:'使用选中材料形成项目候选决策。',preferred_mode:'comprehensive',
    decision_brief:{renewal:{conclusion:'优先研究供水分项改善。',reason:'本轮材料支持按居民影响安排核查。',evidence_refs:refs},investment:{conclusion:'先投入管线核查和预算核实。',reason:'资金与结构条件尚未登记核实。',stage:'preliminary',evidence_refs:refs},returns:{financial:'按实际预算核实建设与持续维护支出。',social:'优先处理演示资料所列停水和居民安排。',evidence_refs:refs}},
    rationale:[{point:'本轮原始材料参与判断。',source_id:source.id,quote:source.text}],
    paths:(['comprehensive','rebuild'] as const).map(mode=>({mode,title:mode==='comprehensive'?'供水分项改善':'建筑更新条件研究',description:'按本对象材料提出动作。',actions:[{title:'核查管线',detail:'按材料核查费用和居民安排。',evidence_refs:refs}],requirements:['核实结构和资金条件。']})),
    dimensions:(['demand','supply','adaptation','implementation','operations','resources'] as const).map(key=>({key,current:'原文提供本轮研究线索。',current_level:'unknown',comprehensive:'完成管线与维护核查后改善服务。',comprehensive_level:'medium',rebuild:'满足实施条件后研究设施更新。',rebuild_level:'medium',evidence_refs:refs})),
    next_checks:[{title:'补充资金依据',detail:'登记专项预算和资金来源。',evidence_refs:refs}],
    round_review:{summary:'已结合本轮选中资料重新研判。',changes:parent?[{topic:'分项投入',before:'按公开材料核查范围。',after:'加入选中资料的预算与居民安排。',reason:'本轮原始文件提供新增线索。',evidence_refs:refs}]:[],missing_materials:[{topic:'资金',request:'上传资金落实与维护安排。',reason:'决定后续投入阶段。',evidence_refs:[]}]}},source))
}
async function project(id='P-ROUND-DEMO',synthetic=false) {
  const input={...structuredClone(fixture),project_id:id,synthetic,business_profile:'neighborhood',as_of:'2026-10-15',scope:{...fixture.scope,name:'演示小区'},facts:[],sources:[{id:'PUBLIC',title:'演示小区公开对象资料',data_class:synthetic?'synthetic':'public',visibility:'public',synthetic,published_at:'2026-10-01',untrusted_text:original,evidence_scope:'object',object_refs:[`project:${id}`],content_status:'full_text',locator:'line:1'}]} as ProjectInput
  await store.db.query('INSERT INTO projects(id,owner_id,name,input,context_version) VALUES($1,$2,$3,$4,1)',[id,config.ownerId,'隔离演示资料项目',JSON.stringify(input)])
  return (await store.project(id,config.ownerId))!
}
async function document(projectId:string,id:string,text:string,category='resident_needs') {
  const p=(await store.project(projectId,config.ownerId))!,sha=createHash('sha256').update(text).digest('hex')
  p.input.sources.push({id,title:id+'.txt',data_class:p.input.synthetic?'synthetic':'internal',visibility:'internal',synthetic:p.input.synthetic,hash:sha,locator:`document:${id}`,untrusted_text:text,content_status:'uploaded',parse_status:'extracted'})
  await store.db.query('INSERT INTO documents(id,project_id,file_name,blob_name,sha256,parser_result) VALUES($1,$2,$3,$4,$5,$6)',[id,projectId,id+'.txt',id+'.txt',sha,JSON.stringify({status:'extracted',text})])
  await store.db.query('UPDATE projects SET input=$1,context_version=context_version+1 WHERE id=$2',[JSON.stringify(p.input),projectId])
  const current=(await store.project(projectId,config.ownerId))!
  await service.recordMaterialMetadata(current,id,parseResearchMaterialMetadata({material_category:category,source_date:'2026-10-10'}))
  return current
}
async function api(path:string,body?:unknown,stream=false) {
  return fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(stream?{Accept:'application/x-ndjson'}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})})
}
async function createRound(p:ProjectRecord,ids:string[],parent?:ResearchRound) {
  const response=await api(`/api/projects/${p.id}/research-rounds`,{expected_context_version:p.context_version,material_intake:ids.length?'provided':'none',document_ids:ids,allow_internal_ai:!!ids.length,...(parent?{parent_round_id:parent.id}:{})})
  expect(response.status).toBe(201)
  return (await response.json() as {round:ResearchRound}).round
}
async function run(round:ResearchRound) {
  const response=await api(`/api/projects/${round.project_id}/research-rounds/${round.id}/run`,{},true)
  const events=(await response.text()).trim().split('\n').map(line=>JSON.parse(line))
  expect(events.at(-1).type).toBe('complete')
  return events.at(-1).round as ResearchRound
}
beforeEach(async()=>{
  vi.clearAllMocks();ports.prompts.length=0
  Object.assign(config,{modelConfigured:true,searchConfigured:false,decisionEnabled:false,ALLOW_INTERNAL_MODEL:'true'})
  const db=new PGlite();await db.exec(readFileSync('packages/contracts/migrations/001_initial.sql','utf8'));store=new Store(db as unknown as Database,'in-memory isolated test')
  ports.search.mockResolvedValue({sources:[],trace:{status:'success',queries:[],source_ids:[],warnings:[],reused:true}})
  ports.open.mockImplementation(async()=>({ctx:{tools:{register:vi.fn(),schemas:()=>[]}},calls:[],close:async()=>{},runReadCapability:async(_stage:string,run:(signal:AbortSignal)=>unknown)=>run(new AbortController().signal),call:async(_stage:string,prompt:string,outputType:string)=>{
    if(outputType==='RenewalResearchPlan')return {value:{summary:'Offline fixture needs no expert decomposition.',tasks:[]}}
    ports.prompts.push(prompt)
    const catalog=JSON.parse(prompt.match(/<untrusted_sources>(.*?)<\/untrusted_sources>/s)![1])
    const context=prompt.match(/<untrusted_research_context>(.*?)<\/untrusted_research_context>/s)
    const windows=context?JSON.parse(context[1]).evidence_windows:[]
    const sources=catalog.map((row:StrategySource&{source_id?:string})=>({...row,id:row.id||row.source_id,text:row.text||windows.find((window:{source_id:string;text:string})=>window.source_id===row.source_id)?.text||''})) as StrategySource[]
    const chosen=sources.find(source=>source.material_category==='cost_funding')||sources.find(source=>source.document_id)||sources.find(source=>source.role==='current')!
    return {value:proposal(chosen,!prompt.includes('<historical_ai_analysis>null</historical_ai_analysis>'))}
  }}))
  const app=express();app.use(express.json())
  const requireProject=async(id:string)=>{const p=await store.project(id,config.ownerId);if(!p)throw new Error('PROJECT_NOT_FOUND');return p}
  service=await registerRenewalMode(app,store,requireProject,{} as never,vi.fn())
  app.use((error:unknown,_req:unknown,res:express.Response,_next:unknown)=>res.status(500).json({error:error instanceof Error?error.message:'error'}))
  await new Promise<void>(resolve=>{server=app.listen(0,'127.0.0.1',()=>resolve())})
  origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`
})
afterEach(async()=>{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));await store.db.close();Object.assign(config,settings)})

it('runs two isolated rounds with frozen selected materials, historical AI comparison and immutable first result',async()=>{
  let p=await project(undefined,true)
  p=await document(p.id,'DOC-NEEDS','演示资料：居民需求初核显示12户希望提前告知停水，尚未登记真实访谈。')
  const first=await run(await createRound(p,['DOC-NEEDS']))
  const frozen=structuredClone(first)
  p=await document(p.id,'DOC-COST','演示资料：管线核查暂估6万元，仅为构造预算，尚无实际资金承诺。','cost_funding')
  const second=await run(await createRound(p,['DOC-NEEDS','DOC-COST'],first))
  expect(second).toMatchObject({status:'completed',parent_round_id:first.id,parent_input_hash:first.input_hash,first_round_id:first.id,first_input_hash:first.input_hash,context_version:p.context_version})
  expect(second.materials.map(row=>[row.document_id,row.added_in_round])).toEqual([['DOC-NEEDS',false],['DOC-COST',true]])
  expect(second.result?.strategy?.round_review?.changes[0].evidence_refs).toEqual(['DOC-COST'])
  expect(second.result?.sources.find(row=>row.id==='DOC-COST')).toMatchObject({data_class:'synthetic',visibility:'internal',project_id:p.id,source_date:'2026-10-10'})
  expect(ports.prompts[1]).toContain('previous_model_analysis');expect(ports.prompts[1]).toContain(first.input_hash)
  expect(ports.prompts[1]).toContain('管线核查暂估6万元');expect(ports.prompts[1]).not.toContain('SIM-STRATEGY-BASE')
  const listed=await api(`/api/projects/${p.id}/research-rounds`).then(res=>res.json()) as ResearchRoundsResponse
  expect(listed.rounds[0]).toEqual(frozen)
  const count=ports.prompts.length;await run(second);expect(ports.prompts).toHaveLength(count)
  expect((await store.db.query('SELECT * FROM renewal_strategy_assessments')).rows).toHaveLength(0)
})
it('uses internal document text in AI while public web queries exclude it and unselected/other-project files',async()=>{
  let p=await project();p=await document(p.id,'DOC-PRIVATE','内部演示标记ZEBRA731：居民需求应优先核查停水安排。')
  p=await document(p.id,'DOC-UNSELECTED','未选中内部标记CLOUD992，不得进入本轮。')
  const other=await project('P-OTHER');await document(other.id,'DOC-OTHER','其他项目内部标记MOON884。')
  Object.assign(config,{searchConfigured:true})
  const result=await run(await createRound(p,['DOC-PRIVATE']))
  expect(result.status).toBe('completed');expect(ports.prompts[0]).toContain('ZEBRA731')
  expect(ports.prompts[0]).not.toContain('CLOUD992');expect(ports.prompts[0]).not.toContain('MOON884')
  expect(JSON.stringify(ports.search.mock.calls)).not.toMatch(/ZEBRA731|CLOUD992|MOON884/)
  expect(ports.search).toHaveBeenCalledTimes(2)
  expect(result.result?.decision).toBeNull()
})
it('requires config plus per-round consent and disallows parent-internal laundering or cross-project documents',async()=>{
  let p=await project();p=await document(p.id,'DOC-PRIVATE','内部演示资料要求核查居民安排与专项预算。')
  const request={expected_context_version:p.context_version,material_intake:'provided',document_ids:['DOC-PRIVATE'],allow_internal_ai:false}
  let response=await api(`/api/projects/${p.id}/research-rounds`,request);expect((await response.json() as {code:string}).code).toBe('ROUND_INTERNAL_CONSENT_REQUIRED')
  Object.assign(config,{ALLOW_INTERNAL_MODEL:'false'})
  response=await api(`/api/projects/${p.id}/research-rounds`,{...request,allow_internal_ai:true});expect((await response.json() as {code:string}).code).toBe('ROUND_INTERNAL_MODEL_DISABLED')
  Object.assign(config,{ALLOW_INTERNAL_MODEL:'true'})
  const first=await run(await createRound(p,['DOC-PRIVATE']))
  response=await api(`/api/projects/${p.id}/research-rounds`,{...request,document_ids:[],material_intake:'none',parent_round_id:first.id})
  expect((await response.json() as {code:string}).code).toBe('ROUND_PARENT_MATERIAL_CONSENT')
  const other=await project('P-OTHER');await document(other.id,'DOC-FOREIGN','其他项目隔离演示材料。')
  response=await api(`/api/projects/${p.id}/research-rounds`,{...request,document_ids:['DOC-FOREIGN'],allow_internal_ai:true,parent_round_id:first.id})
  expect((await response.json() as {code:string}).code).toBe('ROUND_DOCUMENT_SCOPE')
})
it('explicitly adopts a same-project older saved baseline without fabricating its input or prior intake',async()=>{
  let p=await project();const source:StrategySource={id:'PUBLIC',title:'公开对象资料',text:original,url:null,published_at:null,role:'current',locator:'line:1'}
  const saved:StrategyPacket={project_id:p.id,context_version:1,input_hash:'original-history',created_at:'2026-10-01T00:00:00Z',synthetic:false,status:'completed',strategy:proposal(source),sources:[source],decision:null,model_calls:[],research:null,error:null}
  await store.db.query('INSERT INTO renewal_strategy_assessments(owner_id,project_id,input_hash,payload) VALUES($1,$2,$3,$4)',[p.owner_id,p.id,saved.input_hash,JSON.stringify(saved)])
  p=await document(p.id,'DOC-LATER','演示补充资料：本次上传发生在历史成果之后。')
  const list=await service.list(p);expect(list.baseline_candidate?.context_version).toBe(1)
  const adopted=await api(`/api/projects/${p.id}/research-rounds/adopt`,{expected_context_version:p.context_version,input_hash:saved.input_hash}).then(res=>res.json()) as {round:ResearchRound}
  expect(adopted.round).toMatchObject({origin:'adopted_history',context_version:1,material_intake:'not_recorded',materials:[],input_hash:saved.input_hash,status:'completed'})
  expect((await store.db.query<{input_snapshot:unknown}>('SELECT input_snapshot FROM renewal_research_rounds WHERE id=$1',[adopted.round.id])).rows[0].input_snapshot).toBeNull()
  expect(ports.prompts).toHaveLength(0)
  expect(await api(`/api/projects/${p.id}/renewal-strategy`).then(res=>res.json())).toBeNull()
})
it('retains failed and obsolete attempts without changing a completed parent',async()=>{
  let p=await project();p=await document(p.id,'DOC-PRIVATE','演示资料：先核居民需求和管线改善范围。')
  const first=await run(await createRound(p,['DOC-PRIVATE']))
  const next=await createRound(p,['DOC-PRIVATE'],first)
  ports.open.mockRejectedValueOnce(new Error('MODEL_SIMULATED_FAILURE'))
  const failed=await run(next);expect(failed.status).toBe('failed');expect(failed.result?.status).toBe('failed')
  const stale=await createRound(p,['DOC-PRIVATE'],first)
  const originalOpen=ports.open.getMockImplementation()!
  ports.open.mockImplementationOnce(async()=>{const live=await originalOpen();await store.db.query('UPDATE projects SET context_version=context_version+1 WHERE id=$1',[p.id]);return live})
  const response=await api(`/api/projects/${p.id}/research-rounds/${stale.id}/run`,{},true)
  const events=(await response.text()).trim().split('\n').map(line=>JSON.parse(line))
  expect(events.at(-1)).toMatchObject({type:'error',round:{status:'obsolete'}})
  expect((await service.list((await store.project(p.id,p.owner_id))!)).rounds[0]).toEqual(first)
})
it('keeps a failed first attempt and permits a new baseline attempt without inventing a completed parent',async()=>{
  let p=await project();p=await document(p.id,'DOC-PRIVATE','演示资料：居民需求和管线安排仍需进一步核查。')
  const first=await createRound(p,['DOC-PRIVATE'])
  ports.open.mockRejectedValueOnce(new Error('MODEL_SIMULATED_FAILURE'))
  expect((await run(first)).status).toBe('failed')
  const retry=await run(await createRound(p,['DOC-PRIVATE']))
  expect(retry).toMatchObject({round_number:2,status:'completed',parent_round_id:null,first_round_id:retry.id})
  expect((await service.list(p)).rounds.map(round=>round.status)).toEqual(['failed','completed'])
})
it('repairs synthetic second-round survey claims through the existing DSH repair without suppressing the analysis',async()=>{
  let p=await project(undefined,true)
  p=await document(p.id,'DOC-NEEDS','演示资料：模拟问卷中助餐需求比例75%，加梯需求比例62.5%，并非真实问卷数据。')
  const first=await run(await createRound(p,['DOC-NEEDS']))
  const selected=first.result!.sources.find(source=>source.id==='DOC-NEEDS')!
  const mistaken=proposal(selected,true)
  mistaken.decision_brief!.investment.reason='助餐75%与加梯62.5%虽为真实问卷数据，仍需核对分项预算。'
  const repaired=structuredClone(mistaken)
  repaired.decision_brief!.investment.reason='模拟问卷中助餐75%高于加梯62.5%，优先核查助餐运营和供水分项预算。'
  const call=vi.fn().mockResolvedValueOnce({value:mistaken}).mockResolvedValueOnce({value:repaired})
  const withPlanner=vi.fn().mockImplementation((...args:unknown[])=>args[2]==='RenewalResearchPlan'?Promise.resolve({value:{summary:'Offline fixture plan.',tasks:[]}}):call(...args))
  ports.open.mockResolvedValueOnce({ctx:{tools:{register:vi.fn(),schemas:()=>[]}},calls:[],close:async()=>{},call:withPlanner})
  const second=await run(await createRound(p,['DOC-NEEDS'],first))
  expect(second.status).toBe('completed');expect(call).toHaveBeenCalledTimes(2)
  expect(call.mock.calls[0][1]).toContain('居民样本、问卷、访谈和统计比例均为隔离模拟')
  expect(call.mock.calls[1][0]).toBe('renewal_strategy_quote_repair')
  expect(call.mock.calls[1][1]).toContain('STRATEGY_SYNTHETIC_IDENTITY_MISMATCH')
  expect(second.result?.strategy?.decision_brief?.investment.reason).toBe(repaired.decision_brief!.investment.reason)
  expect(second.result?.strategy?.rationale[0].quote).toBe(selected.text)
  expect(second.result?.strategy?.round_review?.changes[0].evidence_refs).toContain('DOC-NEEDS')
})
it('keeps survey denominators and construction-organization uncertainty in the round prompt',async()=>{
  let p=await project(undefined,true)
  p=await document(p.id,'DOC-SURVEY','演示资料：满意选项72人，问卷总数120份，其他选项人数未提供；本文件未提供施工组织或搬迁安排。')
  await run(await createRound(p,['DOC-SURVEY']))
  expect(ports.prompts[0]).toContain('满意选项72人，问卷总数120份')
  expect(ports.prompts[0]).toContain('问卷比例按原选项、人数和分母表达')
  expect(ports.prompts[0]).toContain('剩余比例保持未说明，不推断为不满意或反对')
  expect(ports.prompts[0]).toContain('缺少施工组织材料时，将是否搬迁及干扰控制写成待核条件或明确的方案假设')
})
