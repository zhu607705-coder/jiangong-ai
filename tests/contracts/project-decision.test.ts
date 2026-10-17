import {afterEach,expect,it,vi} from 'vitest'
import express from 'express'
import type {Server} from 'node:http'
import type {Store} from '../../apps/host/store'
import {registerProjectDecision} from '../../apps/host/project-decision'
import {config} from '../../apps/host/config'
import {projectGuidanceInput,projectGuidanceQuestions} from '../../packages/decision/project-guidance'
import {evaluateProjectGuidance} from '../../services/capabilities/project-decision'
import {guideInput,guidePacket,guideProject,guideResponse} from './project-decision-fixture'

let server:Server|undefined
const configured=config.decisionEnabled
afterEach(async()=>{config.decisionEnabled=configured;if(server)await new Promise<void>(resolve=>server!.close(()=>resolve()));server=undefined})

it('uses one Decision request for six page actions and ranked tasks, with selected-direction scope',async()=>{
 const input=guideInput(),model=vi.fn(async(state,questions)=>guideResponse(state,questions))
 expect(JSON.stringify(input.state.current)).not.toContain('拆建专用对象')
 expect(input.measures.every(row=>row.mode==='comprehensive')).toBe(true)
 const result=await evaluateProjectGuidance(input,'test-hash',new AbortController().signal,model)
 expect(model).toHaveBeenCalledTimes(1);expect(result.status).toBe('completed')
 expect(Object.keys(result.stages)).toHaveLength(6)
 expect(result.stages.overview?.target).toEqual({page:'evidence',section:'files'})
 expect(result.stages.scenarios?.target).toEqual({page:'scenarios',section:'detail',pane:'funding'})
 expect(result.measures[0].title).toContain('SERVICE')
 expect(result.materials[0].title).toBe('资金落实')
 expect(Object.keys(projectGuidanceQuestions(input)).length).toBeLessThanOrEqual(16)
 expect((projectGuidanceQuestions(input).stage_results as any).criteria).not.toHaveProperty('first_round')
})

it('isolates private sources, facts and derived analysis while retaining the existing-plan status',()=>{
 const project=structuredClone(guideProject.input),packet=guidePacket()
 project.sources.push({...project.sources[0],id:'PRIVATE',visibility:'internal',data_class:'internal',title:'PRIVATE_CANARY',untrusted_text:'PRIVATE_CANARY'})
 project.facts.push({id:'F',kind:'private_fact',value:'PRIVATE_CANARY',unit:null,source_id:'PRIVATE'})
 packet.sources.push({...packet.sources[0],id:'PRIVATE',visibility:'internal',data_class:'internal',text:'PRIVATE_CANARY'})
 packet.strategy!.summary='PRIVATE_CANARY'
 const input=projectGuidanceInput(project,2,packet,[],'comprehensive','balanced')
 expect(JSON.stringify(input)).not.toContain('PRIVATE_CANARY')
 expect(input.state.has_current_strategy).toBe(true);expect(input.state.current).toBeNull()
 expect(input.state.internal_analysis_omitted).toBe(true)
})

it('keeps valid stage results and original task requests when one model answer is malformed',async()=>{
 const result=await evaluateProjectGuidance(guideInput(),'hash',new AbortController().signal,async(state,questions)=>{const raw:any=guideResponse(state,questions);raw.answers.stage_actions={choice:'invented'};raw.answers.material_0.score=9;return raw})
 expect(result.status).toBe('partial');expect(result.stages.overview).toBeTruthy();expect(result.stages.actions).toBeUndefined()
 expect(result.materials.map(row=>row.title)).toEqual(['资金落实']);expect(result.issues).toHaveLength(2)
})

it('does not route missing plans into empty scheme detail pages or manufacture a mode recommendation',async()=>{
 const input=projectGuidanceInput(guideProject.input,2,null,[],null,'balanced')
 const questions:any=projectGuidanceQuestions(input)
 expect(questions.stage_overview.criteria).not.toHaveProperty('compare_plans')
 expect(questions.stage_results.criteria).not.toHaveProperty('compare_versions')
 const result=await evaluateProjectGuidance(input,'empty',new AbortController().signal,async(state,questions)=>guideResponse(state,questions))
 expect(result.stages.scenarios?.target).toEqual({page:'assessment',section:'direction'})
 expect(result.direction).toBeNull()
})

it('GET only restores a matching snapshot; POST caches once and rejects a changed project without model work',async()=>{
 config.decisionEnabled=true
 const project=structuredClone(guideProject),packet=guidePacket(),cache=new Map<string,any>()
 let changedDuring=false,reads=0,roundOnly=false
 const store={db:{exec:vi.fn(),query:vi.fn(async(sql:string,params:unknown[])=>{
  if(sql.startsWith('INSERT INTO project_decision_guidance')){cache.set(String(params[2]),JSON.parse(String(params[3])));return {rows:[]}}
  if(sql.includes('FROM project_decision_guidance'))return {rows:cache.has(String(params[2]))?[{payload:cache.get(String(params[2]))}]:[]}
  if(sql.includes('renewal_strategy_assessments'))return {rows:roundOnly?[]:[{payload:packet,saved_at:packet.created_at}]}
  if(sql.includes('to_regclass'))return {rows:[{present:true}]}
  if(sql.includes('renewal_research_rounds'))return {rows:roundOnly?[{payload:{project_id:project.id,status:'completed',round_number:1,context_version:2,input_hash:packet.input_hash,result:packet}}]:[]}
  return {rows:[]}
 })}} as unknown as Store
 const evaluate=vi.fn(async(...args:Parameters<typeof evaluateProjectGuidance>)=>evaluateProjectGuidance(args[0],args[1],args[2],async(state,questions)=>guideResponse(state,questions)))
 const app=express();app.use(express.json())
 await registerProjectDecision(app,store,async()=>({...project,context_version:changedDuring&&++reads>1?3:project.context_version}),evaluate)
 await new Promise<void>(resolve=>{server=app.listen(0,'127.0.0.1',()=>resolve())})
 const url=`http://127.0.0.1:${(server!.address() as {port:number}).port}/api/projects/P-GUIDE/decision-guidance`
 expect(await (await fetch(url+'?direction=comprehensive')).json()).toBeNull();expect(evaluate).not.toHaveBeenCalled()
 const send=(body:unknown)=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
 const request={expected_context_version:2,direction:'comprehensive',preference:'balanced'}
 expect((await send(request)).status).toBe(200)
 expect((await (await send(request)).json()).reused).toBe(true);expect(evaluate).toHaveBeenCalledTimes(1)
 expect((await (await fetch(url+'?direction=comprehensive')).json()).stages.overview.target.page).toBe('evidence')
 project.context_version=3
 expect((await send(request)).status).toBe(409);expect(evaluate).toHaveBeenCalledTimes(1)
 expect(await (await fetch(url+'?direction=comprehensive')).json()).toBeNull()
 project.context_version=2;roundOnly=true
 const restored=await (await send({...request,refresh:true})).json()
 expect(restored.measures).toHaveLength(2);expect(restored.strategy_hash).toBe(packet.input_hash)
 changedDuring=true;reads=0
 expect((await send({...request,refresh:true})).status).toBe(409)
 expect(cache.size).toBe(1)
})

it('keeps a full project within the live 16-question limit while retaining six page choices',async()=>{
 const packet=guidePacket();packet.strategy!.paths.forEach(path=>path.work_packages!.push({...path.work_packages![0],id:path.mode+'-EXTRA'}));packet.strategy!.next_checks=Array.from({length:9},(_,i)=>({title:'调查'+i,detail:'核实本对象数据'+i,evidence_refs:['PUBLIC']}))
 const input=projectGuidanceInput(guideProject.input,2,packet,[],null,'balanced')
 const result=await evaluateProjectGuidance(input,'full',new AbortController().signal,async(state,questions)=>{if(Object.keys(questions).length>16)throw new Error('DECISION_HTTP_400');return guideResponse(state,questions)})
 expect(result.status).toBe('completed');expect(Object.keys(result.stages)).toHaveLength(6)
 expect(result.measures).toHaveLength(5);expect(result.materials).toHaveLength(5)
 expect(packet.strategy!.paths.flatMap(path=>path.work_packages!)).toHaveLength(6)
 expect(packet.strategy!.next_checks).toHaveLength(9)
})
