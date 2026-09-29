import {test,expect} from 'vitest'
import express from 'express'
import {mkdtemp,rm,readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {Store} from '../../apps/host/store'
import {registerIntelligence} from '../../apps/host/intelligence'
import {config} from '../../apps/host/config'
import {hash} from '../../packages/intelligence/domain'
import {recallIntelligence} from '../../packages/intelligence/research-bridge'

test('authorized host intake → indexed retrieval → original Source handoff → review/export',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'intel-http-')),store=await Store.open(dir)
  const app=express();app.use(express.json());const intel=registerIntelligence(app,store)
  const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve))
  const address=server.address() as {port:number},base='http://127.0.0.1:'+address.port
  const request=async(path:string,body?:unknown)=>{const res=await fetch(base+'/api/intelligence'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:res.status,data:await res.json() as any}}
  try{
    await intel.ready
    const input=JSON.parse(await readFile('fixtures/inputs/01_auto.json','utf8'));Object.assign(input,{project_id:'INTEL-HTTP-FIXTURE',synthetic:false,sources:[],facts:[],context_rules:[]});input.scope.name='甲园区';input.scope.city='杭州'
    await store.db.query('INSERT INTO projects(id,owner_id,name,input) VALUES($1,$2,$3,$4)',[input.project_id,config.ownerId,'接口夹具，不是真实项目',JSON.stringify(input)])
    const source={id:'SRC-FIXTURE',title:'甲园区采购公告',url:'https://example.org/fixture-not-real',untrusted_text:'甲园区公开采购更新设备，发布时间：2026年9月1日。',data_class:'public',visibility:'public',synthetic:false,content_status:'full_text',published_at:'2026-09-01T00:00:00Z',date_status:'verified'}
    expect((await request('/intake',{source:{...source,visibility:'internal',data_class:'internal'}})).status).toBe(422)
    const inserted=await request('/intake',{source});expect(inserted.status).toBe(201)
    expect((await request('/intake',{source})).data.created).toBe(false)
    const found=await request('/search?q='+encodeURIComponent('甲园区'));expect(found.data.items).toHaveLength(1)
    const {id,version}=inserted.data,projects=(await request('/projects')).data
    expect((await request('/items/'+id+'/attach',{version,project_id:input.project_id,expected_input_hash:'0'.repeat(64)})).status).toBe(409)
    const attached=await request('/items/'+id+'/attach',{version,project_id:input.project_id,expected_input_hash:projects[0].input_hash});expect(attached.status).toBe(200)
    const project=await store.project(input.project_id,config.ownerId);expect(project?.input.sources[0].untrusted_text).toBe(source.untrusted_text);expect(project?.input.facts).toEqual([]);expect(project?.context_version).toBe(1)
    expect((await request('/items/'+id+'/attach',{version,project_id:input.project_id,expected_input_hash:projects[0].input_hash})).data.status).toBe('already_attached')
    const review={document_id:id,version,family_id:'fixture-family',split:'development',selected:true,category:'procurement',note:'人工反馈接口契约样例',allowed_use:'local_eval',permission:''}
    expect((await request('/reviews',review)).status).toBe(200)
    const evaluation=await request('/evaluation?split=development');expect(evaluation.data.summary.evaluated).toBe(0);expect(evaluation.data.summary.errors).toBe(1)
    const dataset=await request('/dataset/export',{purpose:'local_eval'});expect(dataset.data.rows).toHaveLength(1);expect(dataset.data.rows[0].material).not.toHaveProperty('gold')
    expect((await request('/dataset/export',{purpose:'local_sft'})).data.rows).toEqual([])
    expect(hash(project!.input.sources[0].untrusted_text!)).toBe(project!.input.sources[0].hash)
    const status=await request('/status');expect(status.data.database.documents).toBe(1);expect(status.data.model_auto_enabled).toBe(false)
  }finally{await intel.stop();await new Promise<void>(resolve=>server.close(()=>resolve()));await store.db.close();await rm(dir,{recursive:true,force:true})}
},15000)
