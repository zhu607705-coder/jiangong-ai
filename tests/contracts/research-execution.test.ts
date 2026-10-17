import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import express from 'express'
import type {Server} from 'node:http'
import {beforeEach,afterEach,expect,it} from 'vitest'
import {Store,type ProjectRecord} from '../../apps/host/store'
import {StoredResearchExecution,initializeResearchExecution} from '../../apps/host/research-execution'
import {ResearchRoundsService,registerResearchRoundRoutes} from '../../apps/host/research-rounds'
import {backgroundWork} from '../../apps/host/background-work'
import {config} from '../../apps/host/config'
import {conditionalReport} from '../../packages/retrofit/conditional-report'
import {guideProject,guidePacket} from './project-decision-fixture'
let directory:string,store:Store,project:ProjectRecord,server:Server|undefined
const prior={model:config.modelConfigured,internal:config.ALLOW_INTERNAL_MODEL}
const pause=()=>{let resolve!:(value?:unknown)=>void;const promise=new Promise(resolve0=>{resolve=resolve0});return {promise,resolve}}
beforeEach(async()=>{
 directory=await mkdtemp(join(tmpdir(),'research-execution-'));store=await Store.open(directory);project=structuredClone(guideProject)
 await store.db.query('INSERT INTO projects(id,owner_id,name,input,context_version) VALUES($1,$2,$3,$4,$5)',[project.id,project.owner_id,project.name,JSON.stringify(project.input),project.context_version])
 await store.db.exec('CREATE TABLE renewal_research_rounds(id TEXT PRIMARY KEY,owner_id TEXT,project_id TEXT,round_number INTEGER,payload JSONB,input_snapshot JSONB,created_at TIMESTAMPTZ DEFAULT now(),UNIQUE(owner_id,project_id,round_number))')
 await store.db.exec('CREATE TABLE renewal_strategy_assessments(owner_id TEXT,project_id TEXT,input_hash TEXT,payload JSONB,created_at TIMESTAMPTZ DEFAULT now())')
 await initializeResearchExecution(store)
 await store.db.query('INSERT INTO renewal_research_rounds(id,owner_id,project_id,round_number,payload,input_snapshot) VALUES($1,$2,$3,1,$4,$5)',['R',project.owner_id,project.id,JSON.stringify({status:'running'}),JSON.stringify(project.input)])
})
afterEach(async()=>{await backgroundWork.stop();if(server)await new Promise<void>(resolve=>server!.close(()=>resolve()));server=undefined;await store.db.close();await rm(directory,{recursive:true,force:true});Object.assign(config,{modelConfigured:prior.model,ALLOW_INTERNAL_MODEL:prior.internal})})
const journal=(signal=new AbortController().signal,resumed=false)=>new StoredResearchExecution(store,project,'R',Date.now()+60000,resumed,signal,'legacy')
it('reopens the real Store and reuses completed independent expert output after interruption',async()=>{
 let calls=0;await journal().run('expert:A',{sources:['public-v1']},async()=>{calls++;return {note:'已完成A'}})
 await store.db.close();store=await Store.open(directory)
 expect(await journal(new AbortController().signal,true).run('expert:A',{sources:['public-v1']},async()=>{calls++;return {note:'不应重复'}})).toEqual({note:'已完成A'})
 expect(calls).toBe(1);expect((await store.db.query<{reused:number}>('SELECT reused FROM research_node_receipts')).rows[0].reused).toBe(1)
})
it('fences a late old attempt and keeps the newer node output',async()=>{
 const began=pause(),finish=pause();const old=journal().run('expert:A',{version:1},async()=>{began.resolve();await finish.promise;return 'old'})
 await began.promise;await store.db.query("UPDATE research_node_receipts SET status='interrupted',lease_until=now()")
 expect(await journal().run('expert:A',{version:1},async()=>'new')).toBe('new')
 finish.resolve();await expect(old).rejects.toThrow('RESEARCH_NODE_STALE_LEASE')
 expect((await journal().completed('expert:'))[0].output).toBe('new')
})
it('does not commit output after explicit cancellation or private-source revocation',async()=>{
 const began=pause(),finish=pause();const job=journal().run('expert:A',{},async()=>{began.resolve();await finish.promise;return 'late'})
 await began.promise;await store.db.query("UPDATE renewal_research_rounds SET payload='{\"status\":\"failed\",\"execution\":{\"cancelled\":true}}' WHERE id='R'")
 finish.resolve();await expect(job).rejects.toThrow('RESEARCH_CANCELLED_OR_OBSOLETE')
 expect(await journal().completed('expert:')).toEqual([])
})
it('keeps append-only manifests and distinguishes unknown provider outcome from zero cost',async()=>{
 const run=journal(),first=await run.manifest([{id:'S',text:'预算100万元，尚未到账。'}],['cost'])
 const next=await run.manifest([{id:'S',text:'预算100万元，尚未到账。'},{id:'NEW',text:'成交95万元。'}],['cost'])
 expect(next.parent_id).toBe(first.id);expect(next.version).toBe(2);expect(await run.manifest([{id:'S',text:'预算100万元，尚未到账。'}],['cost'])).toEqual(first)
 const id=await run.beginCall('deepseek','expert',{});await run.finishCall(id,null,'unknown_outcome','unknown')
 expect((await store.db.query('SELECT outcome,billing_state FROM research_call_receipts WHERE id=$1',[id])).rows[0]).toEqual({outcome:'unknown_outcome',billing_state:'unknown'})
})
it('checks private lineage again before committing a node after permissions change',async()=>{
 config.ALLOW_INTERNAL_MODEL='true';project.input.sources.push({id:'PRIVATE',title:'内部材料',visibility:'internal',data_class:'internal',synthetic:false,hash:'v1',untrusted_text:'PRIVATE_CANARY'})
 await store.db.query('UPDATE projects SET input=$1 WHERE id=$2',[JSON.stringify(project.input),project.id])
 const began=pause(),finish=pause(),pending=journal().run('expert:private',{},async()=>{began.resolve();await finish.promise;return 'PRIVATE_CANARY'},{lineage:{source_ids:['PRIVATE'],source_versions:{PRIVATE:'v1'},contains_internal:true,authorized_view_hash:'view'}})
 await began.promise;const next=structuredClone(project.input);next.sources=next.sources.filter(source=>source.id!=='PRIVATE');await store.db.query('UPDATE projects SET input=$1 WHERE id=$2',[JSON.stringify(next),project.id]);finish.resolve()
 await expect(pending).rejects.toThrow('RESEARCH_ACCESS_REVOKED');expect(await journal().completed('expert:private')).toEqual([])
})
it('returns 202 after persistence and a disconnected subscriber cannot cancel the background round',async()=>{
 await store.db.query("DELETE FROM renewal_research_rounds WHERE id='R'")
 const began=pause(),finish=pause()
 const service=new ResearchRoundsService(store,async()=>project,async(_p,hash,_signal,context)=>{await context.execution!.run('expert:A',{},async()=>{began.resolve();await finish.promise;return {summary:'已完成'}});return conditionalReport(project.input,{...guidePacket(),input_hash:hash},[],'隔离合同检查')})
 await service.initialize()
 const round=await service.create(project,{expected_context_version:project.context_version,material_intake:'none',document_ids:[],allow_internal_ai:false})
 const app=express();app.use(express.json());registerResearchRoundRoutes(app,service,async()=>project,()=>new AbortController().signal)
 await new Promise<void>(resolve=>{server=app.listen(0,'127.0.0.1',()=>resolve())})
 const base=`http://127.0.0.1:${(server!.address() as {port:number}).port}/api/projects/${project.id}/research-rounds/${round.id}`
 const start=await fetch(base+'/start',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})
 expect(start.status).toBe(202);expect((await start.json() as any).round.execution.deadline_at).toBeTruthy();await began.promise
 const controller=new AbortController(),subscription=await fetch(base+'/events',{headers:{Accept:'application/x-ndjson'},signal:controller.signal});await subscription.body!.getReader().read();controller.abort()
 expect(backgroundWork.has('research:'+round.id)).toBe(true);expect((await service.get(project,round.id)).status).toBe('running')
 finish.resolve();await backgroundWork.wait('research:'+round.id)
 expect((await service.get(project,round.id)).result?.delivery?.report_status).toBe('conditional')
})
it('resumes an interrupted real round and skips the previously completed expert',async()=>{
 await store.db.query("DELETE FROM renewal_research_rounds WHERE id='R'");config.modelConfigured=true
 const began=pause();let callsA=0,callsB=0
 const runner=async(_p:ProjectRecord,hash:string,signal:AbortSignal,context:any)=>{
  await context.execution.run('expert:A',{v:1},async()=>{callsA++;return {note:'A成功'}})
  await context.execution.run('expert:B',{v:1},async()=>{callsB++;if(callsB===1){began.resolve();await new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}))}return {note:'B成功'}})
  return conditionalReport(project.input,{...guidePacket(),input_hash:hash},[],'已复用专家成果')
 }
 const first=new ResearchRoundsService(store,async()=>project,runner);await first.initialize();const round=await first.create(project,{expected_context_version:project.context_version,material_intake:'none',document_ids:[],allow_internal_ai:false})
 await first.start(project,round.id);await began.promise;await backgroundWork.stop()
 expect((await first.get(project,round.id)).execution?.state).toBe('interrupted')
 const second=new ResearchRoundsService(store,async()=>project,runner);await second.initialize();await new Promise(resolve=>setTimeout(resolve,50));await backgroundWork.wait('research:'+round.id)
 expect((await second.get(project,round.id)).status).toBe('completed');expect(callsA).toBe(1);expect(callsB).toBe(2)
})
