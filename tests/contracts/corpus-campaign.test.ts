import {afterAll,beforeAll,expect,it} from 'vitest'
import {PGlite} from '@electric-sql/pglite'
import {mkdtemp,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {IntelRepository,type IntelDatabase} from '../../packages/intelligence/repository'
import {CorpusCampaign} from '../../packages/intelligence/campaign'
import {campaignPlan,beijingDay,dailyPace} from '../../packages/intelligence/campaign-plan'
import {CorpusDisk} from '../../packages/intelligence/corpus-disk'
import {hash} from '../../packages/intelligence/domain'
import {materialFromSource} from '../../packages/intelligence/material'
import {DeepSeekWebTools,type WebCallReceipt} from '../../runtime/dsh/deepseek-web-tools'
import {collectChannel} from '../../packages/intelligence/collectors'
import type {ResearchWeb} from '../../services/capabilities/research'

const db=new PGlite(),repo=new IntelRepository(db as unknown as IntelDatabase)
let dir:string,campaign:CorpusCampaign,approved=false
const now=new Date('2026-10-18T04:00:00Z')
beforeAll(async()=>{dir=await mkdtemp(join(tmpdir(),'haizhizi-corpus-'));await repo.initialize();campaign=new CorpusCampaign(repo,dir,()=>approved,0);await campaign.initialize()})
afterAll(async()=>{await db.close();await rm(dir,{recursive:true,force:true})})
const receipt=(id:string,operation:'search'|'fetch'='search'):WebCallReceipt=>({id,operation,provider:'test-only',request_hash:hash(id),status:null,outcome:'in_flight',billing_state:'unknown',duration_ms:0,attempt:1,result_count:0,estimated_cny:null})
const source=(url='https://example.org/old-community',text='甲小区二次供水改造预算30万元。\n28幢共200户。')=>({id:'PUBLIC',title:'公开资料契约样本',url,synthetic:false,data_class:'public',visibility:'public',untrusted_text:text,hash:hash(text),retrieved_at:now.toISOString(),content_status:'full_text'})

it('uses a finite diverse plan with single-request queries and Beijing daily pacing',()=>{
 const plan=campaignPlan(2026);expect(plan.length).toBe(8640);expect(new Set(plan.map(r=>r.query)).size).toBe(plan.length)
 expect(plan.every(r=>[...r.query].length<=128)).toBe(true)
 expect(new Set(plan.slice(0,54).map(r=>r.city)).size).toBe(18)
 expect(beijingDay(new Date('2026-10-17T16:00:00Z'))).toBe('2026-10-18')
 expect(dailyPace(1000,new Date('2026-10-17T16:00:00Z'))).toBe(1)
})
it('does not start paid recurring work on an unconfirmed free premise',async()=>{
 await expect(campaign.configure({enabled:true,daily_search_limit:1000,daily_fetch_limit:200,daily_cny_limit:6})).rejects.toThrow('COST_APPROVAL')
 await campaign.schedule(now);expect(await repo.claim()).toBeUndefined()
 await expect(campaign.record(receipt('off'),now)).rejects.toThrow('CAMPAIGN_PAUSED')
})
it('reserves each actual wire attempt before dispatch and keeps unknown outcomes in the cost ceiling',async()=>{
 approved=true;await expect(campaign.configure({enabled:true,daily_search_limit:1000,daily_fetch_limit:200,daily_cny_limit:7})).rejects.toThrow('COST_APPROVAL');await campaign.configure({enabled:true,daily_search_limit:2,daily_fetch_limit:1,daily_cny_limit:0.01})
 await campaign.record(receipt('s1'),now);await campaign.record(receipt('s2'),now)
 await expect(campaign.record(receipt('s3'),now)).rejects.toThrow('DAILY_LIMIT')
 await expect(campaign.record(receipt('f1','fetch'),now)).rejects.toThrow('DAILY_LIMIT')
 await campaign.record({...receipt('s1'),outcome:'failed',status:429,billing_state:'expected_free',estimated_cny:0},now)
 await campaign.record(receipt('f1','fetch'),now)
 await expect(campaign.record(receipt('f2','fetch'),now)).rejects.toThrow('DAILY_LIMIT')
 expect((await campaign.status(now)).usage).toMatchObject({search_attempts:2,fetch_attempts:1,unknown:2,estimated_cny:0.01})
 await campaign.initialize();expect((await campaign.status(now)).usage.unknown).toBe(2)
 await campaign.record(receipt('new-day'),new Date('2026-10-18T16:00:00Z'))
 expect((await campaign.status(new Date('2026-10-18T16:00:00Z'))).usage.search_attempts).toBe(1)
})
it('quota callback failure prevents an HTTP call instead of recording a fictitious success',async()=>{
 let calls=0
 const web=new DeepSeekWebTools({key:()=> 'fixture',includeContent:true,maxSearchRequests:3,onReceipt:()=>{throw Error('CAMPAIGN_DAILY_LIMIT')}},undefined,async()=>{calls++;return new Response('{}')})
 await expect(web.search({query:'杭州 老旧小区预算'},new AbortController().signal)).rejects.toThrow('DAILY_LIMIT');expect(calls).toBe(0)
})
it('schedules at most one paced job, avoids repeat topics, and yields to foreground work',async()=>{
 await db.exec('DELETE FROM intel_corpus_calls');await campaign.configure({enabled:true,daily_search_limit:1000,daily_fetch_limit:200,daily_cny_limit:6})
 await db.exec("UPDATE intel_corpus_campaign SET next_at='2020-01-01'")
 await campaign.schedule(now);await campaign.schedule(now)
 expect((await db.query("SELECT * FROM intel_jobs WHERE kind='corpus_collect'")).rows).toHaveLength(1)
 const foreground=await repo.enqueue('archive','foreground');expect((await repo.claim())?.id).toBe(foreground.id);await repo.endJob(foreground.id,'completed')
 const first=await repo.claim();expect(first?.kind).toBe('corpus_collect');await repo.endJob(first!.id,'completed')
 await db.exec("UPDATE intel_corpus_campaign SET next_at='2020-01-01'");await campaign.schedule(new Date(now.getTime()+90000))
 const second=await repo.claim();expect(second?.subject).not.toBe(first?.subject);await repo.endJob(second!.id,'completed')
})
it('keeps original text, raw representation, line/window offsets and aliases stable on disk',async()=>{
 const m=materialFromSource(source()),saved=await repo.put(m);expect(saved).toBe(true)
 const r=await campaign.persist(m,'<article>原始采集表示</article>')
 const base=join(campaign.disk.root,r.path)
 expect(await readFile(join(base,'original.md'),'utf8')).toBe(m.text)
 const chunks=(await readFile(join(base,'chunks.jsonl'),'utf8')).trim().split('\n').map(s=>JSON.parse(s))
 expect(chunks.map(c=>c.text)).toEqual(m.text.split('\n'));expect(chunks[1].locator).toBe('line:2')
 expect(chunks[1].text.slice(chunks[1].start,chunks[1].end)).toBe(chunks[1].text)
 expect((await readFile(join(base,'source.json'),'utf8'))).toContain(m.version)
 await expect(campaign.persist({...m,source:{...m.source,id:'ANOTHER_ALIAS',retrieved_at:new Date().toISOString()}})).resolves.toBeDefined()
 expect(await campaign.shouldFetch(m.url)).toBe(false)
 await db.exec("UPDATE intel_corpus_archives SET fetched_at=now()-interval '8 days'")
 expect(await campaign.shouldFetch(m.url)).toBe(true)
 await campaign.persist({...m,source:{...m.source,retrieved_at:'2020-01-01T00:00:00Z'}})
 expect(await campaign.shouldFetch(m.url)).toBe(true)
 const big=materialFromSource(source('https://example.org/long','原文😀'.repeat(3000)))
 const large=await campaign.disk.persist(big)
 const windows=(await readFile(join(campaign.disk.root,large.path,'chunks.jsonl'),'utf8')).trim().split('\n').map(s=>JSON.parse(s))
 expect(windows.length).toBeGreaterThan(1)
 for(const w of windows)expect(big.text.slice(w.start,w.end)).toBe(w.text)
})
it('rejects internal, synthetic and metadata records without writing them as originals',async()=>{
 const disk=new CorpusDisk(dir,0),m=materialFromSource(source())
 for(const change of [{data_class:'internal',visibility:'project_internal'},{synthetic:true},{content_status:'metadata_only'}])await expect(disk.persist({...m,source:{...m.source,...change}})).rejects.toThrow('PUBLIC_ORIGINAL_REQUIRED')
 await expect(new CorpusDisk(dir,Number.MAX_SAFE_INTEGER).capacity()).rejects.toThrow('CORPUS_DISK_LOW')
})
it('reuses Search body without Fetch, scopes domains, and skips an already archived URL',async()=>{
 const q=campaign.plan[0],body=source().untrusted_text;let calls=0,received=0
 const web=new DeepSeekWebTools({key:()=> 'fixture',includeContent:true,maxSearchRequests:1},undefined,async()=>{calls++;return new Response(JSON.stringify({results:[{url:'https://www.hangzhou.gov.cn/a',title:'杭州改造',content:body},{url:'https://evil.example/a',title:'不可用域'}]}))})
 const collected=await collectChannel(q.channel,new AbortController().signal,async(s,raw)=>{received++;expect(s.untrusted_text).toBe(body);expect(raw).toBe(body)},web as unknown as ResearchWeb,{query:q.query,maxResults:20,shouldFetch:async()=>true})
 expect(collected).toEqual({saved:1,failed:0,skipped:0});expect(received).toBe(1);expect(calls).toBe(1)
 const skipped=await collectChannel(q.channel,new AbortController().signal,async()=>{throw Error('SHOULD_SKIP')},{search:async()=>({sources:[{url:'https://www.hangzhou.gov.cn/a'}],truncated:false}),fetch:async()=>{throw Error('SHOULD_NOT_FETCH')}} as unknown as ResearchWeb,{shouldFetch:async()=>false})
 expect(skipped).toEqual({saved:0,failed:0,skipped:1})
})
it('snapshots existing originals without model calls and pausing cancels queued collection',async()=>{
 const snapshot=await campaign.queueSnapshot();expect((await campaign.queueSnapshot()).id).toBe(snapshot.id)
 const counts=await campaign.snapshot();expect(counts.versions).toBe(1)
 await repo.endJob(snapshot.id,'completed')
 await db.exec("UPDATE intel_corpus_campaign SET next_at='2020-01-01'");await campaign.schedule(new Date(now.getTime()+180000))
 await campaign.configure({enabled:false,daily_search_limit:1000,daily_fetch_limit:200,daily_cny_limit:6})
 expect(await repo.claim()).toBeUndefined()
 const stored=await repo.get(materialFromSource(source()).id);expect(stored?.text).toBe(source().untrusted_text)
})
