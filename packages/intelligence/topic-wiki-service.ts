import {mkdir,readFile,rename,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import type {IntelligenceService} from './service'
import {TOPICS,compileTopicPage,publicWikiSource,topicInput,topicMarkdown,topicOf,type TopicPage,type TopicDetail} from './topic-wiki'
import type {Job} from './repository'
import {config} from '../../apps/host/config'
import {intelligenceJudge} from '../../runtime/intelligence/judge'
import {OUTPUT_SCHEMAS,PROMPTS,TOPIC_MAX_TOKENS} from './prompts'
import {canonical,hash} from './domain'
import {intelligenceDailyModelBudget} from './model-budget'
import {topicGroup,TOPIC_GROUPS} from './topic-catalog'

/** Same DB, original repository, receipt budget and persistent worker. Public-only pilot. */
export class TopicWikiService{
  readonly ready:Promise<void>
  private inputs=new Map<string,{revision:string;input:ReturnType<typeof topicInput>}>()
  private inventory:{revision:string;counts:Map<string,number>}|undefined
  constructor(private intel:IntelligenceService,private dataDir=config.dataDir){
    this.ready=intel.ready.then(()=>intel.repo.db.exec(`CREATE TABLE IF NOT EXISTS intel_topic_pages(topic_id TEXT NOT NULL,input_hash TEXT NOT NULL,payload JSONB NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),PRIMARY KEY(topic_id,input_hash));`)).then(()=>undefined)
    intel.registerJobHandler('topic_compile',(job,signal)=>this.run(job,signal))
  }
  private async revision(){
    await this.ready
    const clock=(await this.intel.repo.db.query<{revision:string;policies:unknown}>("SELECT (SELECT coalesce(max(sequence),0)::text FROM intel_revision_log) AS revision,(SELECT coalesce(jsonb_agg(payload ORDER BY id),'[]'::jsonb) FROM intel_channels) AS policies")).rows[0]
    return clock.revision+'|'+hash(canonical(clock.policies))
  }
  private async input(id:string){
    const topic=topicOf(id),revision=await this.revision(),cached=this.inputs.get(id)
    if(cached?.revision===revision)return cached.input
    const loaded=await this.intel.repo.entries(undefined,400,undefined,topic.terms.join(' '),undefined,topic.terms),input=topicInput(id,loaded.entries,config.DEEPSEEK_MODEL,loaded.truncated)
    this.inputs.set(id,{revision,input});return input
  }
  async list(){
    const revision=await this.revision(),db=this.intel.repo.db
    if(this.inventory?.revision!==revision)this.inventory={revision,counts:new Map((await this.intel.repo.topicCounts(TOPICS)).map(row=>[row.id,row.count]))}
    // The directory uses counts and metadata; original reading/windows load only on topic entry.
    const pages=(await db.query<{topic_id:string;payload:TopicPage}>('SELECT DISTINCT ON(topic_id) topic_id,payload FROM intel_topic_pages ORDER BY topic_id,created_at DESC')).rows
    const visible=await this.intel.repo.visibleWikiVersions(pages.flatMap(row=>row.payload.sources))
    const jobs=(await db.query<Job>("SELECT DISTINCT ON(payload->>'topic_id') * FROM intel_jobs WHERE kind='topic_compile' ORDER BY payload->>'topic_id',created_at DESC")).rows
    return TOPIC_GROUPS.flatMap(group=>group.topics.map(topicOf)).map(topic=>{
      const saved=pages.find(row=>row.topic_id===topic.id)?.payload
      const page=saved&&saved.sources.every(source=>visible.has(source.id+'@'+source.version))?saved:null
      const cached=this.inputs.get(topic.id),checked=cached?.revision===revision,job=jobs.find(job=>job.payload.topic_id===topic.id)
      return {topic,group:topicGroup(topic.id),matching_sources:this.inventory!.counts.get(topic.id)||0,count_scope:'public_library' as const,selected_sources:page?.sources.length||Math.min(12,this.inventory!.counts.get(topic.id)||0),scan_truncated:false,stale:page&&checked?page.input_hash!==cached!.input.input_hash:null,revision_checked:checked,updated_at:page?.created_at||null,claims:page?.claims.length||0,job:job?{id:job.id,status:job.status,error:job.error}:null}
    })
  }
  async detail(id:string):Promise<TopicDetail>{
    const input=await this.input(id),db=this.intel.repo.db
    const rows=(await db.query<{input_hash:string;payload:TopicPage;created_at:string}>('SELECT input_hash,payload,created_at FROM intel_topic_pages WHERE topic_id=$1 ORDER BY created_at DESC LIMIT 20',[id])).rows
    let page:TopicPage|null=rows.find(r=>r.input_hash===input.input_hash)?.payload||rows[0]?.payload||null
    // A later source policy change must also revoke the compiled public view.
    if(page){for(const source of page.sources){const original=await this.intel.repo.get(source.id,source.version),current=await this.intel.repo.get(source.id);if(!original||!current||!publicWikiSource(original)||!publicWikiSource(current)){page=null;break}}}
    const job=(await db.query<Job>("SELECT * FROM intel_jobs WHERE kind='topic_compile' AND payload->>'topic_id'=$1 ORDER BY created_at DESC LIMIT 1",[id])).rows[0]
    return {topic:input.topic,input_hash:input.input_hash,matching_sources:input.matching_sources,selected_sources:input.sources.length,scan_truncated:input.scan_truncated,page,stale:!!page&&page.input_hash!==input.input_hash,job:job?{id:job.id,status:job.status,error:job.error}:null,history:rows.map(r=>({input_hash:r.input_hash,created_at:r.created_at}))}
  }
  async queue(id:string){
    const input=await this.input(id)
    if(!input.sources.length)throw Error('WIKI_NO_PUBLIC_SOURCES')
    if(!config.modelConfigured)throw Error('BLOCKED_EXTERNAL_MODEL')
    const old=(await this.intel.repo.db.query('SELECT 1 FROM intel_topic_pages WHERE topic_id=$1 AND input_hash=$2',[id,input.input_hash])).rows
    if(old.length)return {status:'current'}
    const job=await this.intel.repo.enqueue('topic_compile',id+'@'+input.input_hash,{topic_id:id,input})
    void this.intel.tick().catch(()=>console.warn('WIKI_WORKER_FAILED'))
    return {status:job.status,job_id:job.id}
  }
  private async run(job:Job,signal:AbortSignal){
    await this.ready
    const frozen=job.payload.input as ReturnType<typeof topicInput>;topicOf(frozen.topic.id)
    const entries=[],archivePending:string[]=[]
    for(const source of frozen.sources){const e=await this.intel.repo.get(source.id,source.version);if(!e||!publicWikiSource(e))throw Error('WIKI_SOURCE_POLICY_CHANGED');entries.push(e)
      try{await this.intel.campaign.persist(e)}catch{archivePending.push(e.id+'@'+e.version)}
    }
    const dailyLimit=intelligenceDailyModelBudget()
    const result=await this.intel.repo.receipt('topic_compile',frozen.topic.id,{...frozen,output_budget:TOPIC_MAX_TOKENS},config.DEEPSEEK_MODEL,()=>intelligenceJudge('topic',frozen,OUTPUT_SCHEMAS.topic,PROMPTS.topic,signal,config.DEEPSEEK_MODEL),dailyLimit)
    signal.throwIfAborted()
    let page=compileTopicPage(frozen,result.value,entries,result.model)
    page=await this.persist(page)
    await this.intel.repo.db.query('INSERT INTO intel_topic_pages(topic_id,input_hash,payload) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[page.topic_id,page.input_hash,JSON.stringify(page)])
    await this.intel.repo.jobResult(job.id,{topic_id:page.topic_id,input_hash:page.input_hash,claims:page.claims.length,review_items:page.review_items,archive_pending:archivePending})
    return {pending:false,progress:true}
  }
  async persist(page:TopicPage){
    topicOf(page.topic_id)
    const root=join(this.dataDir,'corpus-public','wiki','topics',page.topic_id,page.input_hash)
    await mkdir(root,{recursive:true})
    try{
      const stored=JSON.parse(await readFile(join(root,'page.json'),'utf8')) as TopicPage
      if(canonical({...stored,created_at:page.created_at})!==canonical(page))throw Error('WIKI_SNAPSHOT_CONFLICT')
      page=stored
    }catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e}
    for(const [name,body] of [['page.json',JSON.stringify(page,null,2)+'\n'],['page.md',topicMarkdown(page,id=>'../../../index.md#'+id)]] as const){
      const path=join(root,name)
      try{if(await readFile(path,'utf8')!==body)throw Error('WIKI_SNAPSHOT_CONFLICT');continue}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e}
      const tmp=path+'.'+randomUUID()+'.tmp';await writeFile(tmp,body,{mode:0o600});await rename(tmp,path)
    }
    const wikiRoot=join(this.dataDir,'corpus-public','wiki')
    const index=['# 城市更新主题 Wiki','',...TOPICS.flatMap(topic=>[`<a id="${topic.id}"></a>`,`## ${topic.title}`,topic.question,...(topic.id===page.topic_id?[`[本版主题页](topics/${page.topic_id}/${page.input_hash}/page.md)`]:[]),''])].join('\n')
    // The index is a navigation entry; immutable versions remain under topics/id/hash.
    const pages=(await this.intel.repo.db.query<{topic_id:string;input_hash:string}>('SELECT DISTINCT ON(topic_id) topic_id,input_hash FROM intel_topic_pages ORDER BY topic_id,created_at DESC')).rows
    const links=pages.filter(p=>p.topic_id!==page.topic_id).map(p=>`- [${topicOf(p.topic_id).title}](topics/${p.topic_id}/${p.input_hash}/page.md)`)
    for(const [name,body] of [['index.md',index+'\n'+links.join('\n')+'\n'],['AGENTS.md','# 主题Wiki维护规则\n\n原件位于../documents，保持不可变。只维护派生知识页；每项结论保留原文ID、版本、连续引文和定位。不同对象/时间/口径作为案例差异，不能伪造冲突。推理线索单独标记，待核内容进入下一步补充。主题整理复用DSH、intel_jobs与已配置的每日预算；输入快照变化保存新版本，不覆盖历史。私密、模拟、signal_only材料不进入公共Wiki。\n']] as const){
      const tmp=join(wikiRoot,name+'.'+randomUUID()+'.tmp');await writeFile(tmp,body,{mode:0o600});await rename(tmp,join(wikiRoot,name))
    }
    const log=join(wikiRoot,'log.md');const old=await readFile(log,'utf8').catch(e=>{if(e.code==='ENOENT')return '# 主题修订记录\n';throw e})
    const marker='topic '+page.topic_id+' | '+page.input_hash
    if(!old.includes(marker)){const tmp=log+'.'+randomUUID()+'.tmp';await writeFile(tmp,old+`\n## [${page.created_at}] ${marker}\n整理${page.sources.length}份原文，形成${page.claims.length}项知识、${page.questions.length}项后续问题。\n`,{mode:0o600});await rename(tmp,log)}
    return page
  }
}
