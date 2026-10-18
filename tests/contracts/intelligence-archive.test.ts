import {expect,it,vi} from 'vitest'
import {PGlite} from '@electric-sql/pglite'
import {readFileSync} from 'node:fs'
import {Store,type Database,type ProjectRecord} from '../../apps/host/store'
import {IntelligenceService} from '../../packages/intelligence/service'
import {recallIntelligence,rememberIntelligence} from '../../packages/intelligence/research-bridge'
import {config} from '../../apps/host/config'
import fixture from '../../fixtures/inputs/01_auto.json'

it('archives real public originals with project lineage and preserves current and historical versions',async()=>{
 const db=new PGlite();await db.exec(readFileSync('packages/contracts/migrations/001_initial.sql','utf8'))
 const store=new Store(db as unknown as Database,'test'),intel=new IntelligenceService(store)
 const original={id:'ORIGINAL',title:'甲园区公开供水预算',url:'https://example.org/water',untrusted_text:'甲园区供水预算10万元。',published_at:'2024-01-01',date_status:'verified',content_status:'full_text',visibility:'public',data_class:'public',synthetic:false}
 const input={...structuredClone(fixture),project_id:'P-ARCHIVE',synthetic:false,scope:{...fixture.scope,name:'甲园区',city:'杭州'},sources:[original,{...original,id:'PRIVATE',url:'https://example.org/private',visibility:'internal',data_class:'internal',untrusted_text:'PRIVATE-NEVER-GLOBAL'}],facts:[],context_rules:[]}
 try{
  await intel.ready
  await db.query('INSERT INTO projects(id,owner_id,name,input,context_version) VALUES($1,$2,$3,$4,2)',[input.project_id,config.ownerId,'甲园区',JSON.stringify(input)])
  await db.exec('CREATE TABLE renewal_research_rounds(owner_id TEXT,project_id TEXT,round_number INT,payload JSONB)')
  const packet={project_id:input.project_id,context_version:1,input_hash:'old-snapshot',synthetic:false,sources:[{id:'OLD',title:original.title,url:original.url,text:'甲园区供水预算8万元。',published_at:'2023-01-01',role:'current',locator:'line:1',visibility:'public',data_class:'public'}]}
  await db.query('INSERT INTO renewal_research_rounds VALUES($1,$2,1,$3)',[config.ownerId,input.project_id,JSON.stringify({id:'ROUND-1',result:packet})])
  const before=JSON.stringify(await store.project(input.project_id,config.ownerId))
  const first=await intel.syncExisting()
  expect(first).toMatchObject({created:2,linked:2,queued:0,skipped:0})
  const second=await intel.syncExisting();expect(second.created).toBe(0);expect(second.linked).toBe(0)
  const current=(await intel.repo.entries()).entries
  expect(current).toHaveLength(1);expect(current[0].text).toContain('10万元')
  expect(await intel.repo.versions(current[0].id)).toHaveLength(2)
  expect((await intel.repo.entries(undefined,20,undefined,'甲园区','2023-12-31')).entries[0].text).toContain('8万元')
  expect((await intel.repo.entries(undefined,20,'2023-12-31','甲园区')).entries).toEqual([])
  expect(JSON.stringify(await intel.repo.entries())).not.toContain('PRIVATE-NEVER-GLOBAL')
  expect(await intel.repo.projectLinks(current[0].id,current[0].version,'OTHER-OWNER')).toEqual([])
  expect(await intel.repo.knowledgeStats(config.ownerId)).toMatchObject({project_links:2,linked_projects:1})
  expect(JSON.stringify(await store.project(input.project_id,config.ownerId))).toBe(before)
  vi.stubGlobal('fetch',vi.fn(async(_url:string,init:RequestInit)=>{const p=JSON.parse(String(init.body));return new Response(JSON.stringify({matches:p.project.sources.map((s:{id:string})=>({source_id:s.id,score:1}))}))}))
  const recalled=await recallIntelligence({name:'甲园区',city:'杭州',purpose:'供水预算',asOf:'2024-12-31'},new AbortController().signal)
  expect(recalled.some(source=>source.untrusted_text?.includes('10万元'))).toBe(true)
  await rememberIntelligence(recalled,'杭州',{project_id:input.project_id,context_version:2})
  expect((await intel.repo.projectLinks(current[0].id,current[0].version,config.ownerId)).some(row=>row.origin==='research_discovery')).toBe(true)
  const more=Array.from({length:14},(_,i)=>({...original,id:'MORE-'+i,url:'https://example.org/more/'+i}))
  await rememberIntelligence(more as Parameters<typeof rememberIntelligence>[0],'杭州')
  expect((await intel.repo.stats()).documents).toBe(15)
 }finally{vi.unstubAllGlobals();await intel.stop();await db.close()}
})

it('defers budget-bound model work without blocking other jobs or reviving cancellation',async()=>{
 const db=new PGlite(),store=new Store(db as unknown as Database,'test'),intel=new IntelligenceService(store)
 try{
  await intel.ready
  const first=await intel.repo.enqueue('analyze','one'),second=await intel.repo.enqueue('archive','two')
  expect((await intel.repo.claim())?.id).toBe(first.id)
  await intel.repo.deferBudget(first.id)
  expect((await intel.repo.claim())?.id).toBe(second.id)
  await intel.repo.cancel(first.id);await intel.repo.deferBudget(first.id)
  expect((await intel.repo.jobs()).find(row=>row.id===first.id)?.status).toBe('cancelled')
 }finally{await intel.stop();await db.close()}
})
