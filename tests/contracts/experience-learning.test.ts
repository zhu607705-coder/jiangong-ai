import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest'
import { mkdtemp,rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import express from 'express'
import type { Server } from 'node:http'
import fixture from '../../fixtures/inputs/01_auto.json'
import type { ExperienceDraft,ProjectInput } from '../../apps/host/generated/contracts'
import { Store,type ProjectRecord } from '../../apps/host/store'
import { config } from '../../apps/host/config'
import { ExperienceService } from '../../packages/experience/service'
import { KnowledgePipelineService } from '../../packages/experience/pipeline'
import { ExperienceLearningService } from '../../packages/experience/learning'
import { learningWindows } from '../../packages/experience/learning-windows'
import { FIELD_KEYS,ExperienceError } from '../../packages/experience/domain'
import { LiveSession } from '../../runtime/dsh/live-session'
import { hash } from '../../packages/intelligence/domain'
import { registerExperience } from '../../apps/host/experience'

let store:Store,directory:string,project:ProjectRecord,experience:ExperienceService,pipeline:KnowledgePipelineService,learning:ExperienceLearningService
let server:Server|undefined
const original={modelConfigured:config.modelConfigured,allow:config.ALLOW_INTERNAL_MODEL}
const rule='建议分楼栋更换老化给水立管，优先处理爆管频发楼栋。'
const text='背景资料。'.repeat(4500)+'\n规则：'+rule
const document={id:'DOC-LEARN',project_id:'LEARN-A',file_name:'长聊天记录.txt',sha256:hash(text),created_at:'2026-10-16T00:00:00Z',parser_result:{status:'extracted',source_hash:hash(text),text}}
function draft(value=rule,docId=document.id,version=document.sha256,locator='line:2'):ExperienceDraft {
  return {title:'供水更新实践规则',project_type:'',development_mode:'',stage:'',fields:FIELD_KEYS.map(key=>({key,value:key==='proposal'?value:null,evidence:key==='proposal'?[{document_id:docId,version,locator,quote:value}]:[]})),knowledge:{kind:'rule',origin:'practice',measure_key:'pipe_network',measure_name:'给水管网更新',conditions:[],exclusions:[],transfer_notes:[],evidence_level:'not_reported'}}
}
beforeEach(async()=>{
  directory=await mkdtemp(join(tmpdir(),'experience-learning-'));store=await Store.open(directory)
  const input={...structuredClone(fixture),project_id:'LEARN-A',synthetic:true,as_of:'2026-10-16',mode:'enterprise',sources:[{id:document.id,title:document.file_name,synthetic:true,visibility:'internal',data_class:'synthetic',hash:document.sha256,untrusted_text:text,content_status:'uploaded'}]} as ProjectInput
  await store.db.query('INSERT INTO projects(id,name,owner_id,input) VALUES($1,$2,$3,$4)',[input.project_id,'合成经验链路测试',config.ownerId,JSON.stringify(input)])
  await store.db.query('INSERT INTO documents(id,project_id,file_name,blob_name,sha256,parser_result) VALUES($1,$2,$3,$4,$5,$6)',[document.id,input.project_id,document.file_name,'fixture-only',document.sha256,JSON.stringify(document.parser_result)])
  project=(await store.project(input.project_id,config.ownerId))!
  experience=new ExperienceService(store);await experience.initialize();pipeline=new KnowledgePipelineService(store,experience);await pipeline.initialize();learning=new ExperienceLearningService(experience,pipeline)
  Object.assign(config,{modelConfigured:true,ALLOW_INTERNAL_MODEL:'true'})
})
afterEach(async()=>{if(server)await new Promise<void>(resolve=>server!.close(()=>resolve()));server=undefined;vi.restoreAllMocks();Object.assign(config,{modelConfigured:original.modelConfigured,ALLOW_INTERNAL_MODEL:original.allow});await store.db.close();await rm(directory,{recursive:true,force:true})})

describe('file/chat to experience, skill and rule versions',()=>{
  it('covers the entire long source and preserves surrogate pairs and locators',()=>{
    const source='甲😀乙'.repeat(12000),windows=learningWindows([{locator:'line:8',text:source}],18000)
    expect(windows.flat().map(slice=>slice.text).join('')).toBe(source)
    expect(windows.flat().every(slice=>slice.locator==='line:8'&&!/[\uD800-\uDBFF]$/.test(slice.text))).toBe(true)
    expect(windows).toHaveLength(3)
    expect(learningWindows(Array.from({length:150},(_,i)=>({locator:`line:${i+1}`,text:'记录'}))).flat()).toHaveLength(150)
  })
  it('reads beyond the former first 18000 characters and automatically creates draft skills and rule comparisons',async()=>{
    const seen:string[]=[]
    vi.spyOn(LiveSession,'open').mockImplementation(async()=>{const calls:unknown[]=[];return {calls,close:async()=>{},call:async(_stage:string,prompt:string)=>{seen.push(prompt);calls.push({});return {value:{drafts:prompt.includes(rule)?[draft()]:[],warnings:[]}}}} as never})
    const result=await learning.learn(project,[document.id],true,false,new AbortController().signal)
    expect(seen).toHaveLength(2);expect(seen[1]).toContain(rule)
    expect(result.coverage).toMatchObject({windows:2,completed_windows:2,complete:true,characters:text.length-1,completed_characters:text.length-1})
    expect(result.cards).toHaveLength(1);expect(result.skills[0]).toMatchObject({status:'draft',allowed_tools:['knowledge_evidence']})
    expect(result.rule_updates[0].previous).toBeNull()
    const exported=await pipeline.exportSkill(project,result.skills[0].id,true)
    expect(exported.markdown).toContain('status: draft');expect(exported.markdown).toContain(rule)
    const accepted=await learning.applyRule(project,result.cards[0].id,1)
    expect(accepted.rule).toMatchObject({status:'approved',revision:2})
    expect(accepted.skills[0].card_refs[0].revision).toBe(2)
    const activated=await learning.applySkill(project,accepted.skills[0].id,accepted.skills[0].revision)
    expect(activated.skill).toMatchObject({status:'approved',revision:2,allowed_tools:['knowledge_evidence']})
    const resolved=await experience.resolveKnowledge(project,{measure_key:'pipe_network',question:'本项目管网更新如何安排'})
    expect(resolved.skills?.some(skill=>skill.id===activated.skill.id)).toBe(true)
    expect([...resolved.trace.rule_hits,...resolved.trace.candidates].some(item=>item.card_id===accepted.rule.id)).toBe(true)
    expect((await store.db.query<{payload:unknown}>('SELECT payload FROM experience_history WHERE card_id=$1 ORDER BY revision',[accepted.rule.id])).rows).toHaveLength(2)
    expect((await experience.repository.documents(project.id))[0].sha256).toBe(document.sha256)
    const repeated=await learning.learn(project,[document.id],true,false,new AbortController().signal)
    expect(seen).toHaveLength(2);expect(repeated.coverage.reused_windows).toBe(2);expect(repeated.model_calls).toBe(0)
  })
  it('keeps good windows and sources when another window or candidate needs follow-up',async()=>{
    let calls=0
    vi.spyOn(LiveSession,'open').mockImplementation(async()=>({calls:[],close:async()=>{},call:async()=>{if(++calls===1)throw new Error('fixture provider failure');return {value:{drafts:[draft(),draft(rule,'ANOTHER-PROJECT')],warnings:[]}}}} as never))
    const result=await learning.learn(project,[document.id],true,false,new AbortController().signal)
    expect(result.cards).toHaveLength(1);expect(result.coverage.complete).toBe(false)
    expect(result.warnings.join('')).toContain('原文位置或条件需补充')
    expect(result.skills).toHaveLength(1)
    await expect(learning.learn(project,['OTHER-DOC'],true,false,new AbortController().signal)).rejects.toThrow('当前项目')
  })
  it('updates the same rule with version history and rejects stale or cross-project targets',async()=>{
    const old=await experience.create(project,draft());const reviewed=await experience.review(project,old.id,old.revision,'approved','合成测试原句核对')
    const next=await experience.create(project,{...draft(),title:'管网更新的新一版规则'})
    const result=await learning.applyRule(project,next.id,next.revision,reviewed.id,reviewed.revision)
    expect(result.rule).toMatchObject({id:old.id,revision:4,status:'approved',title:next.title})
    expect((await store.db.query('SELECT revision FROM experience_history WHERE card_id=$1',[old.id])).rows).toHaveLength(4)
    await expect(learning.applyRule(project,next.id,1,old.id,2)).rejects.toThrow('经验卡已被更新')
    await expect(learning.applyRule(project,next.id,1,'OTHER-PROJECT-RULE',1)).rejects.toThrow('当前项目同一举措')
  })
  it('returns real progress and a complete result through the existing owned HTTP routes',async()=>{
    vi.spyOn(LiveSession,'open').mockResolvedValue({calls:[],close:async()=>{},call:async()=>({value:{drafts:[draft()],warnings:[]}})} as never)
    const app=express();app.use(express.json());await registerExperience(app,store,async id=>{const value=await store.project(id,config.ownerId);if(!value)throw new ExperienceError(404,'PROJECT_NOT_FOUND','项目不存在');return value})
    server=app.listen(0);await new Promise<void>(resolve=>server!.once('listening',resolve))
    const url=`http://127.0.0.1:${(server.address() as {port:number}).port}/api/projects/${project.id}/knowledge`
    const response=await fetch(url+'/learn',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/x-ndjson'},body:JSON.stringify({document_ids:[document.id],use_model:true})})
    const events=(await response.text()).trim().split('\n').map(line=>JSON.parse(line))
    expect(events.some(event=>event.phase==='skills')).toBe(true);expect(events.at(-1).type).toBe('complete')
    const candidate=events.at(-1).result.cards[0]
    const applied=await fetch(url+'/rule-updates/apply',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({candidate_id:candidate.id,expected_candidate_revision:candidate.revision})})
    expect(applied.status).toBe(200);expect((await applied.json()).rule.status).toBe('approved')
  })
})
