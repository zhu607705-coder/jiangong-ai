import type { Express,Request,Response } from 'express'
import { z } from 'zod'
import type { Store } from './store'
import { config } from './config'
import { IntelligenceService } from '../../packages/intelligence/service'
import { channelOf,hash,canonical,CATEGORIES } from '../../packages/intelligence/domain'
import { summaryOf } from '../../packages/intelligence/material'
import { pairCompatible } from '../../packages/intelligence/domain'
import {TopicWikiService} from '../../packages/intelligence/topic-wiki-service'
import {topicMarkdown} from '../../packages/intelligence/topic-wiki'
import {intelligenceDailyModelBudget} from '../../packages/intelligence/model-budget'

/** Called from the already-authenticated application router, never mounted publicly. */
export function registerIntelligence(app:Express,store:Store){
  const intel=new IntelligenceService(store)
  const wiki=new TopicWikiService(intel)
  void wiki.ready.catch(()=>console.warn('WIKI_INITIALIZATION_FAILED'))
  void intel.ready.catch(()=>console.warn('INTELLIGENCE_INITIALIZATION_FAILED'))
  const route=(fn:(req:Request,res:Response)=>Promise<unknown>)=>async(req:Request,res:Response)=>{
    try{await intel.ready;await fn(req,res)}catch(e){
      const message=e instanceof Error?e.message:'INTELLIGENCE_UNAVAILABLE'
      const code=/^[A-Z][A-Z0-9_]+$/.test(message)?message:'INTELLIGENCE_REQUEST_FAILED'
      const details:Record<string,string>={WIKI_TOPIC_NOT_FOUND:'未找到这个主题，请返回主题列表。',WIKI_NO_PUBLIC_SOURCES:'该主题尚未归集公开原文，可先查找并补充资料。',WIKI_PAGE_NOT_READY:'这个主题尚未形成知识页，可以先查阅已归集原文。',CAMPAIGN_COST_APPROVAL_REQUIRED:'独立搜索和抓取按成功请求计费，请先确认日预算，再启用持续采集。',CORPUS_DISK_LOW:'磁盘可用空间低于保留值，采集已延后。',CAMPAIGN_DAILY_LIMIT:'今天的采集次数或费用额度已用完，后续任务等待下一日。',PROJECT_VERSION_CONFLICT:'项目资料已变化，请重新选择项目后加入。',PUBLIC_ORIGINAL_REQUIRED:'只接收公开、非合成的原始材料。',ORIGINAL_BODY_REQUIRED:'尚未取得原文，先补取材料再加入项目。',RECEIPT_REVIEW_REQUIRED:'上次付费调用结果不确定；请先核对回执，不能自动重复调用。',DATASET_FAMILY_SPLIT_CONFLICT:'同源或同事件资料不能分到不同数据集。',BLOCKED_EXTERNAL_MODEL:'模型尚未配置，已有资料仍可检索。',SOURCE_SCHEMA_CHANGED:'来源页面结构已变化，请检查映射。'}
      if(!res.headersSent)res.status(code==='PROJECT_VERSION_CONFLICT'?409:422).json({code,detail:details[code]||'操作未完成，请检查输入或任务状态。'})
    }
  }
  app.get('/api/intelligence/status',route(async(_req,res)=>res.json({version:'1.0',storage:store.kind,model_configured:config.modelConfigured,
    decision_configured:config.decisionConfigured,decision_enabled:config.decisionEnabled,
    selection_threshold:Number(process.env.INTELLIGENCE_SELECTION_THRESHOLD||65),daily_model_budget:intelligenceDailyModelBudget(),
    collection_enabled:process.env.INTELLIGENCE_COLLECTION_ENABLED==='true',model_auto_enabled:process.env.INTELLIGENCE_MODEL_ENABLED==='true',
    search_provider:config.RESEARCH_WEB_PROVIDER,additional_search:await intel.campaign.providerStatus(),
    database:await intel.repo.stats(),knowledge:await intel.repo.knowledgeStats(config.ownerId),campaign:await intel.campaign.status(),jobs:await intel.repo.jobs(),channels:await intel.repo.channels(),scope:'local_public_intelligence',weight_training_started:false})))
  app.get('/api/intelligence/campaign',route(async(_req,res)=>res.json(await intel.campaign.status())))
  app.post('/api/intelligence/campaign',route(async(req,res)=>{const b=z.object({enabled:z.boolean(),daily_search_limit:z.number().int().min(1).max(1000).default(1000),daily_fetch_limit:z.number().int().min(0).max(1000).default(200),daily_cny_limit:z.number().min(0).max(10).default(6)}).strict().parse(req.body);await intel.configureCampaign(b);res.json(await intel.campaign.status())}))
  app.post('/api/intelligence/campaign/snapshot',route(async(_req,res)=>{res.status(202).json(await intel.campaign.queueSnapshot());void intel.tick().catch(()=>console.warn('CORPUS_SNAPSHOT_FAILED'))}))
  app.get('/api/intelligence/search',route(async(req,res)=>{
    const q=z.object({q:z.string().max(300).optional(),city:z.string().max(80).optional(),category:z.enum(CATEGORIES).optional(),as_of:z.string().max(40).optional(),limit:z.coerce.number().int().min(1).max(40).optional(),offset:z.coerce.number().int().min(0).max(380).optional()}).strict().parse(req.query)
    if(q.as_of&&!Number.isFinite(Date.parse(q.as_of)))throw new Error('INVALID_DATE')
    res.json(await intel.search(q))
  }))
  app.post('/api/intelligence/channels',route(async(req,res)=>{const c=channelOf(req.body);await intel.repo.saveChannel(c);res.json({status:'saved',channel:c})}))
  app.post('/api/intelligence/channels/:id/collect',route(async(req,res)=>{const body=z.object({model:z.boolean().default(false)}).strict().parse(req.body);const channel=await intel.repo.channel(String(req.params.id));if(!channel)throw new Error('CHANNEL_NOT_FOUND');res.status(202).json(await intel.repo.enqueue('collect',String(req.params.id),{...body,channel}));void intel.tick().catch(()=>console.warn('INTELLIGENCE_WORKER_FAILED'))}))
  app.post('/api/intelligence/sync',route(async(req,res)=>{const b=z.object({cursor:z.string().max(250).default('')}).strict().parse(req.body);res.json(await intel.syncExisting(b.cursor))}))
  app.post('/api/intelligence/archive',route(async(req,res)=>{const body=z.object({analyze_limit:z.number().int().min(0).max(8).default(0)}).strict().parse(req.body);res.status(202).json(await intel.queueArchive(body.analyze_limit))}))
  app.post('/api/intelligence/intake',route(async(req,res)=>{const b=z.object({source:z.unknown(),channel_id:z.string().max(80).optional()}).strict().parse(req.body);res.status(201).json(await intel.ingest(b.source,b.channel_id))}))
  app.get('/api/intelligence/items/:id',route(async(req,res)=>{const version=typeof req.query.version==='string'?req.query.version:undefined;const e=await intel.repo.get(String(req.params.id),version);if(!e){res.status(404).json({detail:'资料不存在。'});return}
    res.json({...summaryOf(e),versions:await intel.repo.versions(e.id),project_links:await intel.repo.projectLinks(e.id,e.version,config.ownerId),excerpt:e.text.slice(0,2500),excerpt_truncated:e.text.length>2500,analysis:e.analysis,source:{id:e.source.id,hash:e.source.hash,raw_hash:e.source.raw_hash,locator:e.source.locator,date_status:e.source.date_status},can_attach:e.participation!=='signal_only'&&!!e.text&&e.source.content_status!=='metadata_only'})}))
  app.post('/api/intelligence/items/:id/analyze',route(async(req,res)=>{const b=z.object({version:z.string().regex(/^[a-f0-9]{64}$/)}).strict().parse(req.body);if(!await intel.repo.get(String(req.params.id),b.version))throw new Error('DOCUMENT_VERSION_NOT_FOUND');res.status(202).json(await intel.repo.enqueue('analyze',req.params.id+'@'+b.version,{id:req.params.id,version:b.version}));void intel.tick().catch(()=>console.warn('INTELLIGENCE_WORKER_FAILED'))}))
  app.post('/api/intelligence/items/:id/organize',route(async(req,res)=>{const b=z.object({version:z.string().regex(/^[a-f0-9]{64}$/)}).strict().parse(req.body);res.json(await intel.organize(String(req.params.id),b.version))}))
  app.post('/api/intelligence/items/:id/archive',route(async(req,res)=>{const b=z.object({version:z.string().regex(/^[a-f0-9]{64}$/)}).strict().parse(req.body);res.json(await intel.archiveOriginal(String(req.params.id),b.version))}))
  app.post('/api/intelligence/jobs/:id/cancel',route(async(req,res)=>{await intel.cancel(String(req.params.id));res.json({status:'cancellation_requested'})}))
  app.get('/api/intelligence/wiki/topics',route(async(_req,res)=>res.json({items:await wiki.list()})))
  app.get('/api/intelligence/wiki/topics/:id',route(async(req,res)=>res.json(await wiki.detail(String(req.params.id)))))
  app.post('/api/intelligence/wiki/topics/:id/compile',route(async(req,res)=>{z.object({}).strict().parse(req.body);res.json(await wiki.queue(String(req.params.id)))}))
  app.get('/api/intelligence/wiki/topics/:id/export',route(async(req,res)=>{const detail=await wiki.detail(String(req.params.id));if(!detail.page)throw Error('WIKI_PAGE_NOT_READY');const format=z.enum(['md','json']).parse(req.query.format||'md');res.setHeader('Content-Disposition',`attachment; filename="${detail.topic.id}.${format}"`);res.type(format==='md'?'text/markdown':'application/json').send(format==='md'?topicMarkdown(detail.page):JSON.stringify(detail.page,null,2))}))
  app.get('/api/intelligence/projects',route(async(_req,res)=>res.json((await store.projects(config.ownerId)).filter(p=>!p.input.synthetic).map(p=>({id:p.id,name:p.name,input_hash:hash(canonical(p.input))})))))
  app.post('/api/intelligence/items/:id/attach',route(async(req,res)=>{const b=z.object({version:z.string().regex(/^[a-f0-9]{64}$/),project_id:z.string().max(120),expected_input_hash:z.string().regex(/^[a-f0-9]{64}$/)}).strict().parse(req.body);res.json(await intel.attach(String(req.params.id),b.version,b.project_id,b.expected_input_hash))}))
  app.post('/api/intelligence/events/link',route(async(req,res)=>{
    const b=z.object({id:z.string(),version:z.string(),target_id:z.string(),target_version:z.string(),relation:z.enum(['SAME_OCCURRENCE','SAME_STORY','UNRELATED'])}).strict().parse(req.body)
    const a=await intel.repo.get(b.id,b.version),target=await intel.repo.get(b.target_id,b.target_version)
    if(!a||!target)throw new Error('DOCUMENT_VERSION_NOT_FOUND')
    if(b.relation!=='UNRELATED'&&!pairCompatible(a.analysis.structure,target.analysis.structure))throw new Error('EVENT_IDENTITY_CONFLICT')
    if(b.relation==='SAME_STORY'&&target.event_id!==target.story_id)throw new Error('STORY_ROOT_REQUIRED')
    const own='EV-'+hash(a.id+'|'+a.version).slice(0,24)
    await intel.repo.membership(a.id,a.version,b.relation==='SAME_OCCURRENCE'?target.event_id:own,b.relation==='UNRELATED'?own:target.story_id,b.relation,true)
    res.json({status:'saved',manual:true})
  }))
  app.post('/api/intelligence/reviews',route(async(req,res)=>{const b=z.object({document_id:z.string(),version:z.string().regex(/^[a-f0-9]{64}$/),family_id:z.string().min(1).max(120),split:z.enum(['development','holdout','train']),selected:z.boolean().nullable(),category:z.enum(CATEGORIES).nullable(),note:z.string().min(1).max(500),allowed_use:z.enum(['local_eval','local_sft']).default('local_eval'),permission:z.string().max(1000).default('')}).strict().parse(req.body);res.json(await intel.review(b))}))
  app.get('/api/intelligence/evaluation',route(async(req,res)=>res.json(await intel.evaluate(z.enum(['development','holdout']).parse(req.query.split||'development')))))
  app.post('/api/intelligence/dataset/export',route(async(req,res)=>{const b=z.object({purpose:z.enum(['local_eval','local_sft']).default('local_eval')}).strict().parse(req.body);res.json(await intel.dataset(b.purpose))}))
  return intel
}
