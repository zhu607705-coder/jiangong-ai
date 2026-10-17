import {readFileSync} from 'node:fs'
import {PGlite} from '@electric-sql/pglite'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {Store,type Database,type ProjectRecord} from '../../apps/host/store'
import {TaskMaterialService} from '../../apps/host/task-materials'
import {ResearchRoundsService} from '../../apps/host/research-rounds'
import {extractTaskObservations,type TaskMaterialLink} from '../../packages/retrofit/task-materials'
import {buildProjectTasks} from '../../packages/retrofit/project-tasks'
import {guideProject,guidePacket} from './project-decision-fixture'
import {ExperienceError} from '../../packages/experience/domain'
let store:Store,project:ProjectRecord,service:TaskMaterialService,link:TaskMaterialLink
const extract=vi.fn(),version='1'.repeat(64)
beforeEach(async()=>{
 const db=new PGlite();await db.exec(readFileSync('packages/contracts/migrations/001_initial.sql','utf8'));store=new Store(db as unknown as Database,'test');await store.initializeAnalysisContext()
 await db.exec('CREATE TABLE renewal_strategy_assessments(owner_id TEXT,project_id TEXT,input_hash TEXT,payload JSONB,created_at TIMESTAMPTZ DEFAULT now());CREATE TABLE renewal_research_rounds(owner_id TEXT,project_id TEXT,round_number INTEGER,payload JSONB,input_snapshot JSONB);')
 project=structuredClone(guideProject);project.input.sources.push({id:'DOC-TASK',title:'满意度.csv',hash:version,visibility:'internal',data_class:'internal',synthetic:false,untrusted_text:'有效问卷 | 满意人数\n100 | 75'})
 await db.query('INSERT INTO projects(id,owner_id,name,input,context_version) VALUES($1,$2,$3,$4,$5)',[project.id,project.owner_id,project.name,JSON.stringify(project.input),project.context_version])
 await db.query('INSERT INTO renewal_strategy_assessments VALUES($1,$2,$3,$4,now())',[project.owner_id,project.id,'guide-plan',JSON.stringify(guidePacket())])
 await db.query('INSERT INTO documents(id,project_id,file_name,blob_name,sha256,parser_result) VALUES($1,$2,$3,$4,$5,$6)',['DOC-TASK',project.id,'满意度.csv','task.csv',version,JSON.stringify({status:'extracted',parser:'CRE generic table parser',text:'有效问卷 | 满意人数\n100 | 75',profile:{tables:[{rows:[{rowNumber:2,values:{有效问卷:100,满意人数:75}}]}]}})])
 extract.mockReset();extract.mockResolvedValue({cards:[],warnings:[],model_calls:1});service=new TaskMaterialService(store,{extract},async()=>project);await service.initialize()
 const task=buildProjectTasks(guidePacket(),'comprehensive')[0];link={task_id:task.id,input_hash:'guide-plan',direction:'comprehensive'}
})
afterEach(async()=>{await store.db.close()})
it('links the original file to the real task and records executed parser/field tools without claiming an AI call',async()=>{
 const receipt=await service.link(project,'DOC-TASK',link)
 expect(receipt.observations.map(row=>row.value)).toEqual(['100','75']);expect(receipt.tools.map(row=>row.status)).toEqual(['completed','completed','completed','not_requested']);expect(receipt.extraction.model_calls).toBe(0);expect(extract).not.toHaveBeenCalled()
 expect((await service.list(project,'guide-plan'))[0].version).toBe(version)
 expect(receipt.observations.some(row=>row.value.includes('%'))).toBe(false)
})
it('rejects another task or project document and preserves the original report',async()=>{
 const before=(await store.db.query('SELECT payload FROM renewal_strategy_assessments')).rows
 await expect(service.link(project,'DOC-TASK',{...link,task_id:'foreign-task'})).rejects.toMatchObject({code:'TASK_NOT_FOUND'})
 await expect(service.link(project,'FOREIGN-DOC',link)).rejects.toMatchObject({code:'TASK_DOCUMENT_SCOPE'})
 expect((await store.db.query('SELECT payload FROM renewal_strategy_assessments')).rows).toEqual(before)
})
it('uses the existing extractor only on explicit request, caches completed extraction and retains fields on failure',async()=>{
 await service.link(project,'DOC-TASK',link);const local=await service.extract(project,'DOC-TASK',link,false);expect(extract).not.toHaveBeenCalled();expect(local.extraction.status).toBe('not_requested')
 const result=await service.extract(project,'DOC-TASK',link,true);expect(result.extraction).toMatchObject({status:'completed',model_calls:1});await service.extract(project,'DOC-TASK',link,true);expect(extract).toHaveBeenCalledOnce()
 const other=buildProjectTasks(guidePacket(),'comprehensive')[1];extract.mockRejectedValue(new Error('provider failed'))
 const failed=await service.extract(project,'DOC-TASK',{...link,task_id:other.id},true)
 expect(failed.extraction).toMatchObject({status:'failed',model_calls:null});expect(failed.observations).toHaveLength(2)
})
it('preserves task associations when ordinary material metadata is later edited',async()=>{
 await service.link(project,'DOC-TASK',link)
 const rounds=new ResearchRoundsService(store,async()=>project,async()=>guidePacket())
 await rounds.recordMaterialMetadata(project,'DOC-TASK',{material_category:'resident_satisfaction',source_date:'2026-10-17'})
 expect(await service.list(project,'guide-plan')).toHaveLength(1)
})
it('reads key-value table cells and literal numbers without making new aggregates',()=>{
 const observations=extractTaskObservations({tables:[{rows:[{rowNumber:2,values:{指标:'就餐人次',数值:180}}]}]},'电梯使用次数：250次；满意度：4.3分')
 expect(observations.map(row=>row.value)).toEqual(['180','250次','4.3分']);expect(observations.find(row=>row.field==='满意度')?.quote).toBe('满意度：4.3分')
})
