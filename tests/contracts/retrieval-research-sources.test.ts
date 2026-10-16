import {expect,it} from 'vitest'
import {PGlite} from '@electric-sql/pglite'
import {Store,type Database,type ProjectRecord} from '../../apps/host/store'
import fixture from '../../fixtures/inputs/01_auto.json'
import type {ProjectInput} from '../../apps/host/generated/contracts'
import {withResearchOriginals} from '../../packages/experience/retrieval-sources'

it('adds this version of acquired public originals without importing other projects, owners or private material',async()=>{
  const db=new PGlite(),store=new Store(db as unknown as Database,'PGlite')
  const project:ProjectRecord={id:'P-SCOPE',owner_id:'OWNER',name:'测试',context_version:2,created_at:'',updated_at:'',input:{...structuredClone(fixture),project_id:'P-SCOPE',synthetic:false,sources:[]} as ProjectInput}
  try {
    await db.exec('CREATE TABLE renewal_research_rounds(owner_id TEXT,project_id TEXT,round_number INT,payload JSONB);CREATE TABLE renewal_strategy_assessments(owner_id TEXT,project_id TEXT,created_at TIMESTAMPTZ DEFAULT now(),payload JSONB)')
    const source=(id:string)=>({id,title:id,text:'原文记载长者助餐安排。',role:'reference',locator:'line:1',url:'https://example.org/'+id,published_at:null})
    const packet=(id:string,version=2)=>({project_id:id,context_version:version,synthetic:false,sources:[source(id)]})
    for(const [owner,id,version] of [['OWNER','P-SCOPE',2],['OTHER','P-SCOPE',2],['OWNER','OTHER-PROJECT',2],['OWNER','P-SCOPE',1]] as const) {
      const p=packet(id,version)
      if(owner==='OTHER')p.sources[0].id='OTHER-OWNER'
      if(version===1)p.sources[0].id='OLD-VERSION'
      await db.query('INSERT INTO renewal_strategy_assessments(owner_id,project_id,payload) VALUES($1,$2,$3)',[owner,id,JSON.stringify(p)])
    }
    const round={context_version:2,result:{...packet('P-SCOPE'),sources:[source('ROUND-PUBLIC'),{...source('PRIVATE'),visibility:'internal',data_class:'internal'},{...source('CROSS'),project_id:'OTHER-PROJECT'}]}}
    await db.query('INSERT INTO renewal_research_rounds(owner_id,project_id,round_number,payload) VALUES($1,$2,1,$3)',['OWNER','P-SCOPE',JSON.stringify(round)])
    const before=JSON.stringify(project),extended=await withResearchOriginals(store,project)
    expect(extended.input.sources.map(source=>source.id).sort()).toEqual(['P-SCOPE','ROUND-PUBLIC'])
    expect(extended.input.sources.every(source=>source.content_status==='excerpt'&&source.evidence_scope==='background'&&source.object_refs?.length===0)).toBe(true)
    expect(JSON.stringify(project)).toBe(before)
  } finally {await db.close()}
})
