import express from 'express'
import type { Server } from 'node:http'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import fixture from '../../fixtures/inputs/01_auto.json'
import replay from '../../data/demos/qiushi-validated-replay.json'
import type { ProjectRecord, Store } from '../../apps/host/store'
import type { ProjectInput } from '../../apps/host/generated/contracts'
import type { ConstructionCostLibrary } from '../../packages/construction-costs/library'
const evaluate=vi.hoisted(()=>vi.fn())
vi.mock('../../services/capabilities/decision-model',async original=>({...await original<typeof import('../../services/capabilities/decision-model')>(),evaluateDecision:evaluate}))
vi.mock('../../services/map-screening/renewal-history',()=>({renewalHistory:async()=>({records:[],official_costs:[]})}))
vi.mock('../../apps/host/config',async original=>{const actual=await original<typeof import('../../apps/host/config')>();return {config:{...actual.config,decisionEnabled:true}}})
import { registerRenewalMode } from '../../apps/host/renewal-mode'
let server:Server,origin:string,changed:boolean,inserts:number,cacheOrigin:'legacy'|'strategy'|'explicit_mode'|null
beforeEach(async()=>{
  changed=false;inserts=0;cacheOrigin=null;evaluate.mockReset().mockResolvedValue(structuredClone(replay.packet.decision))
  const project:ProjectRecord={id:'P-MODE-STREAM',name:'离线模式协议',owner_id:'fixture-owner',created_at:'2026-10-16T00:00:00Z',updated_at:'2026-10-16T00:00:00Z',context_version:1,input:{...structuredClone(fixture) as ProjectInput,project_id:'P-MODE-STREAM',business_profile:'neighborhood',sources:[],facts:[]}}
  const store={db:{exec:vi.fn(),query:vi.fn(async(sql:string)=>{if(sql.startsWith('INSERT'))inserts++;return {rows:sql.startsWith('SELECT payload,origin')&&cacheOrigin?[{payload:structuredClone(replay.packet.decision),origin:cacheOrigin}]:[]}})}} as unknown as Store
  const app=express();app.use(express.json());await registerRenewalMode(app,store,async()=>({...project,context_version:changed?2:1}),{} as ConstructionCostLibrary,vi.fn())
  await new Promise<void>(resolve=>{server=app.listen(0,'127.0.0.1',()=>resolve())});origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`
})
afterEach(async()=>{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()))})
const request=()=>fetch(origin+'/api/projects/P-MODE-STREAM/renewal-mode',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/x-ndjson'},body:JSON.stringify({expected_context_version:1})})
test('emits actual input, Decision and validation milestones, then one saved terminal packet',async()=>{
  const response=await request(),events=(await response.text()).trim().split('\n').map(line=>JSON.parse(line))
  expect(response.headers.get('content-type')).toContain('application/x-ndjson')
  expect(events.filter(event=>event.type==='progress').map(event=>`${event.phase}:${event.state}`)).toEqual(['inputs:completed','decision:running','decision:completed','validation:running','validation:completed'])
  expect(events.filter(event=>event.type==='complete')).toHaveLength(1)
  expect(events.at(-1).result.origin).toBe('explicit_mode')
  expect(evaluate).toHaveBeenCalledTimes(1);expect(inserts).toBe(1)
})

test.each(['legacy','strategy'] as const)('a %s cache is retained internally but not displayed as an explicit mode judgement',async source=>{
  cacheOrigin=source
  const response=await fetch(origin+'/api/projects/P-MODE-STREAM/renewal-mode'),packet=await response.json()
  expect(packet.decision).toBeNull();expect(packet.origin).toBe(source);expect(evaluate).not.toHaveBeenCalled()
  await request();expect(evaluate).toHaveBeenCalledTimes(1)
})

test('an explicitly requested saved judgement remains available after reopening the page',async()=>{
  cacheOrigin='explicit_mode'
  const response=await fetch(origin+'/api/projects/P-MODE-STREAM/renewal-mode'),packet=await response.json()
  expect(packet.decision.status).toBe('completed');expect(packet.origin).toBe('explicit_mode');expect(evaluate).not.toHaveBeenCalled()
})
test('a changed project snapshot ends the stream with an error and never publishes the stale result',async()=>{
  evaluate.mockImplementation(async()=>{changed=true;return structuredClone(replay.packet.decision)})
  const response=await request(),events=(await response.text()).trim().split('\n').map(line=>JSON.parse(line))
  expect(events.at(-1)).toEqual({type:'error',message:'判定期间项目资料已变化，请刷新后重新判定。'})
  expect(events.some(event=>event.type==='complete')).toBe(false);expect(inserts).toBe(0)
})
