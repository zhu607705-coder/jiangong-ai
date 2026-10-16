import { mkdtemp,rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import fixture from '../fixtures/inputs/01_auto.json'
import { Store } from '../apps/host/store'
import { config } from '../apps/host/config'
import { projectInput } from '../packages/contracts/validate'
import { hash } from '../packages/intelligence/domain'
import { ExperienceService } from '../packages/experience/service'
import { KnowledgePipelineService } from '../packages/experience/pipeline'
import { ExperienceLearningService } from '../packages/experience/learning'

// A real provider check with synthetic source text in a separate temporary database.
const directory=await mkdtemp(join(tmpdir(),'haizhizi-learning-protocol-'))
const store=await Store.open(directory)
const text='材料类型：完全合成的接口样例，不是实际项目。\n举措：给水立管更新\n决策问题：如何安排给水立管更新顺序。\n提议方案：先处理爆管频发楼栋，再安排其他楼栋。\n实际决策：先更新一号楼给水立管。\n实施：一号楼已更换老化给水立管。\n结果：一个观察月内未记录爆管。\n实践规则：给水立管更新先核对爆管台账，再按楼栋安排分期施工。'
try {
  const input=projectInput({...structuredClone(fixture),project_id:'TEST-LEARNING-PROTOCOL',synthetic:true,mode:'enterprise',as_of:new Date().toISOString().slice(0,10),sources:[{id:'TEST-LEARNING-DOC',title:'合成接口原件',visibility:'internal',data_class:'synthetic',synthetic:true,hash:hash(text),untrusted_text:text,content_status:'uploaded'}]})
  await store.db.query('INSERT INTO projects(id,name,owner_id,input) VALUES($1,$2,$3,$4)',[input.project_id,'隔离学习协议样例',config.ownerId,JSON.stringify(input)])
  await store.db.query('INSERT INTO documents(id,project_id,file_name,blob_name,sha256,parser_result) VALUES($1,$2,$3,$4,$5,$6)',['TEST-LEARNING-DOC',input.project_id,'合成学习样例.txt','protocol-only',hash(text),JSON.stringify({status:'extracted',source_hash:hash(text),text})])
  const experience=new ExperienceService(store);await experience.initialize()
  const pipeline=new KnowledgePipelineService(store,experience);await pipeline.initialize()
  const learning=new ExperienceLearningService(experience,pipeline),project=(await store.project(input.project_id,config.ownerId))!
  const result=await learning.learn(project,['TEST-LEARNING-DOC'],true,true,AbortSignal.timeout(90000))
  const repeated=await learning.learn(project,['TEST-LEARNING-DOC'],true,true,AbortSignal.timeout(10000))
  const receipt={status:result.cards.length&&result.skills.length?'passed':'partial',database:'isolated_temporary_pglite',production_project_writes:0,synthetic_source:true,model_calls:result.model_calls,cards:result.cards.length,skills:result.skills.length,rule_candidates:result.rule_updates.length,coverage:result.coverage,repeat_model_calls:repeated.model_calls,reused_windows:repeated.coverage.reused_windows,warnings:result.warnings,checked_at:new Date().toISOString()}
  console.log(JSON.stringify(receipt))
  if(receipt.status!=='passed')process.exitCode=1
} finally {await store.db.close();await rm(directory,{recursive:true,force:true})}
