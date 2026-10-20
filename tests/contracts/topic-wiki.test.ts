import {afterAll,beforeAll,expect,it,vi} from 'vitest'
import {PGlite} from '@electric-sql/pglite'
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {compileTopicPage,topicInput,topicMarkdown,publicWikiSource} from '../../packages/intelligence/topic-wiki'
import {hash,unscored,type Entry} from '../../packages/intelligence/domain'
import {IntelRepository,type IntelDatabase,type Job} from '../../packages/intelligence/repository'
import {TopicWikiService} from '../../packages/intelligence/topic-wiki-service'
import type {IntelligenceService} from '../../packages/intelligence/service'
import {config} from '../../apps/host/config'
import {topicPilotLimit} from '../../packages/intelligence/topic-wiki-pilot'

vi.mock('../../runtime/intelligence/judge',()=>({intelligenceJudge:vi.fn(async(_stage,input)=>({model:'fixture-not-live',value:{claims:[{kind:'finding',text:'资料分别记载了供水改造的对象和阶段。',refs:[{source_id:input.sources[0].id,version:input.sources[0].version,quote:input.sources[0].windows[0].text}]}],questions:['调查居民的实际供水体验与满意度。']}}))}))
const entry=(id='one',text='甲小区开展二次供水改造，涉及29幢与30幢。\n项目当前处于施工准备阶段。'):Entry=>({id:'ID-'+hash(id).slice(0,24),version:hash(text),title:id+'二次供水改造公告',url:'https://example.org/'+id,text,city:'杭州',published_at:'2026-09-01T00:00:00Z',channel_id:'public',publisher_group:'example.org',participation:'research',source:{visibility:'public',data_class:'public',synthetic:false,content_status:'full_text'},analysis:unscored(),event_id:id,story_id:id,relation:'UNRELATED',ingested_at:'2026-10-20T00:00:00Z'})
const ref=(e:Entry,quote=e.text.split('\n')[0])=>({source_id:e.id,version:e.version,quote})
it('compiles only public originals and excludes private, synthetic and signal-only material',()=>{
 const good=entry(),bad=[{...entry('private'),source:{visibility:'internal',data_class:'internal'}},{...entry('synthetic'),source:{...good.source,synthetic:true}},{...entry('signal'),participation:'signal_only' as const}]
 expect(topicInput('water',[good,...bad],'model').sources.map(s=>s.id)).toEqual([good.id]);expect(bad.every(e=>!publicWikiSource(e))).toBe(true)
})
it('does not collapse a shared topic into one case or event',()=>{const a=entry(),b=entry('two','乙小区二次供水改造正在验收。');const input=topicInput('water',[a,b],'model');expect(input.sources).toHaveLength(2);expect(new Set(input.sources.map(s=>s.id)).size).toBe(2)})
it('binds the compiled revision to source versions, body, model and original topic',()=>{const a=entry(),first=topicInput('water',[a],'model');expect(topicInput('water',[a],'model').input_hash).toBe(first.input_hash);expect(topicInput('water',[{...a,text:a.text+'新增进展'}],'model').input_hash).not.toBe(first.input_hash);expect(topicInput('water',[a],'other-model').input_hash).not.toBe(first.input_hash)})
it('retains independently supported claims when another citation is invented',()=>{
 const a=entry(),input=topicInput('water',[a],'model'),page=compileTopicPage(input,{claims:[{kind:'finding',text:'目前处于施工准备。',refs:[ref(a)]},{kind:'finding',text:'已经全部完工。',refs:[ref(a,'该小区已经全部改造完工')]}],questions:[]},[a],'fixture')
 expect(page.claims).toHaveLength(1);expect(page.review_items).toBe(1);expect(page.questions.join('')).toContain('已经全部完工');expect(page.claims[0].refs[0].locator).toBe('line:1')
})
it('requires distinct originals for a case comparison or claimed disagreement',()=>{const a=entry(),input=topicInput('water',[a],'model');const p=compileTopicPage(input,{claims:[{kind:'comparison',text:'甲乙两地不同。',refs:[ref(a),ref(a)]}]},[a],'fixture');expect(p.claims).toHaveLength(0);expect(p.questions).toHaveLength(1)})
it('keeps genuine multi-source comparison and hypotheses distinct',()=>{const a=entry(),b=entry('two','乙小区二次供水改造正在验收。'),input=topicInput('water',[a,b],'model');const p=compileTopicPage(input,{claims:[{kind:'comparison',text:'两个小区处于不同阶段。',refs:[ref(a),ref(b)]},{kind:'hypothesis',text:'后续应核实供水体验。',refs:[ref(a)]}]},[a,b],'fixture');expect(p.claims.map(c=>c.kind)).toEqual(['comparison','hypothesis']);expect(topicMarkdown(p)).toContain('## 案例差异');expect(topicMarkdown(p)).toContain('## 推理线索')})
it('exports verified original identity, line and quote rather than promoting wiki text to original',()=>{const a=entry(),p=compileTopicPage(topicInput('water',[a],'m'),{claims:[{kind:'finding',text:'需要按楼栋组织改造。',refs:[ref(a)]}]},[a],'fixture');const md=topicMarkdown(p);expect(md).toContain(a.url);expect(md).toContain(a.version);expect(md).toContain('line:1');expect(p.sources[0]).not.toHaveProperty('windows')})

const db=new PGlite(),repo=new IntelRepository(db as unknown as IntelDatabase);let dir:string,wiki:TopicWikiService,handler:(job:Job,signal:AbortSignal)=>Promise<unknown>;const originalConfigured=config.modelConfigured
beforeAll(async()=>{await repo.initialize();dir=await mkdtemp(join(tmpdir(),'topic-wiki-'));config.modelConfigured=true;wiki=new TopicWikiService({repo,ready:Promise.resolve(),registerJobHandler:(_kind:string,fn:typeof handler)=>{handler=fn},tick:async()=>{}} as unknown as IntelligenceService,dir);await wiki.ready})
afterAll(async()=>{config.modelConfigured=originalConfigured;await db.close();await rm(dir,{recursive:true,force:true})})
it('reuses the existing queue and receipt, saves a versioned page, Markdown and index',async()=>{const a=entry('persist');await repo.put(a);await wiki.queue('water');const job=(await repo.claim())!;expect(job.kind).toBe('topic_compile');await handler(job,new AbortController().signal);await repo.endJob(job.id,'completed');const detail=await wiki.detail('water');expect(detail.page?.claims).toHaveLength(1);expect(detail.stale).toBe(false);expect(await readFile(join(dir,'corpus-public/wiki/topics/water',detail.input_hash,'page.md'),'utf8')).toContain('line:1');expect(await readFile(join(dir,'corpus-public/wiki/index.md'),'utf8')).toContain(detail.input_hash);expect((await repo.knowledgeStats('local-operator'))?.model_calls_today).toBe(1);expect(await wiki.queue('water')).toEqual({status:'current'})})
it('new material marks a saved page stale and keeps its earlier baseline intact',async()=>{const before=await wiki.detail('water');await repo.put(entry('new'));const after=await wiki.detail('water');expect(after.stale).toBe(true);expect(after.page?.input_hash).toBe(before.page?.input_hash);expect(after.input_hash).not.toBe(before.input_hash)})
it('idempotent disk persistence keeps the first revision timestamp and rejects content conflicts',async()=>{const page=(await wiki.detail('water')).page!;const again=await wiki.persist({...page,created_at:'2026-10-22T00:00:00Z'});expect(again.created_at).toBe(page.created_at);await expect(wiki.persist({...page,questions:['different content']})).rejects.toThrow('WIKI_SNAPSHOT_CONFLICT')})
it('shares the daily receipt budget and keeps prior knowledge while a refresh waits',async()=>{const before=await wiki.detail('water');await wiki.queue('water');const job=(await repo.claim())!;vi.stubEnv('INTELLIGENCE_DAILY_MODEL_CALLS','0');try{await expect(handler(job,new AbortController().signal)).rejects.toThrow('INTELLIGENCE_BUDGET_EXHAUSTED');await repo.deferBudget(job.id);const after=await wiki.detail('water');expect(after.page?.input_hash).toBe(before.page?.input_hash);expect(after.job?.error).toBe('DAILY_BUDGET_WAIT')}finally{vi.unstubAllEnvs()}})
it('revokes a compiled public page when a cited source latest policy becomes internal',async()=>{const a=entry('persist'),revoked={...a,version:hash('revoked'),source:{...a.source,visibility:'internal',data_class:'internal'}};await repo.put(revoked);expect((await wiki.detail('water')).page).toBeNull()})
it('limits an owner ticket to two scoped reservations and never changes ordinary future limits',async()=>{
 const now=new Date('2026-10-20T16:00:00Z'),fake={knowledgeStats:async()=>({model_calls_today:40})} as unknown as IntelRepository
 const path=join(dir,'.topic-wiki-pilot.json');await writeFile(path,JSON.stringify({expires_at:'2026-10-20T17:00:00Z',ordinary_limit:40,extra_calls:2,topics:['water','elevator'],used:[]}),{mode:0o600})
 expect(await topicPilotLimit(fake,dir,'dining','d',40,now)).toBe(40)
 expect(await topicPilotLimit(fake,dir,'water','w',40,now)).toBe(42)
 expect(await topicPilotLimit(fake,dir,'elevator','e',40,now)).toBe(42)
 expect(await topicPilotLimit(fake,dir,'water','new',40,now)).toBe(40)
 expect(await topicPilotLimit(fake,dir,'water','w',40,new Date('2026-10-21T16:00:00Z'))).toBe(40)
 expect(JSON.parse(await readFile(path,'utf8')).used).toHaveLength(2)
})
