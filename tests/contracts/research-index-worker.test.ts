import {expect,it,vi} from 'vitest'
import {PGlite} from '@electric-sql/pglite'
import {Store,type Database} from '../../apps/host/store'
import {IntelligenceService} from '../../packages/intelligence/service'

it('uses the existing durable worker for incremental index continuation and stops on no progress',async()=>{
  const db=new PGlite(),intel=new IntelligenceService(new Store(db as unknown as Database,'PGlite'))
  try{
    await intel.ready
    const handler=vi.fn().mockResolvedValueOnce({pending:true,progress:true}).mockResolvedValue({pending:true,progress:false})
    intel.registerJobHandler('rag_index',handler)
    await intel.repo.enqueue('rag_index','owner-project-version',{project_id:'P-INDEX',owner_id:'owner',context_version:1,source_fingerprint:'hash'})
    await intel.tick();await intel.tick();await intel.tick()
    expect(handler).toHaveBeenCalledTimes(2)
    const jobs=(await intel.repo.jobs()).filter(job=>job.kind==='rag_index')
    expect(jobs).toHaveLength(2);expect(jobs.every(job=>job.status==='partial')).toBe(true)
    expect(jobs.every(job=>Object.keys(job.payload).every(key=>['project_id','owner_id','context_version','source_fingerprint'].includes(key)))).toBe(true)
  }finally{await intel.stop();await db.close()}
})
