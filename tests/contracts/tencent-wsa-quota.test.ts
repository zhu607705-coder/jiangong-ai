import {afterAll,beforeAll,expect,it,vi} from 'vitest'
import {PGlite} from '@electric-sql/pglite'
import {IntelRepository,type IntelDatabase} from '../../packages/intelligence/repository'
import {CorpusCampaign} from '../../packages/intelligence/campaign'
import type {WebCallReceipt} from '../../runtime/dsh/deepseek-web-tools'
const db=new PGlite(),repo=new IntelRepository(db as unknown as IntelDatabase),campaign=new CorpusCampaign(repo,'unused-quota-test',()=>false)
const at=new Date('2026-10-31T15:59:00Z')
const receipt=(id:string):WebCallReceipt=>({id,provider:'tencent-wsa',operation:'search',request_hash:'x',status:null,outcome:'in_flight',billing_state:'unknown',duration_ms:0,attempt:1,result_count:0,estimated_cny:0.026})
beforeAll(async()=>{await repo.initialize();await campaign.initialize()})
afterAll(async()=>{vi.unstubAllEnvs();await db.close()})
it('shares one atomic monthly attempt cap, retains failed/unknown calls and resets on Beijing month boundary',async()=>{
 vi.stubEnv('TENCENT_WSA_MONTHLY_LIMIT','2')
 const results=await Promise.allSettled(['a','b','c'].map(id=>campaign.recordProvider(receipt(id),at)))
 expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(2)
 await campaign.recordProvider({...receipt('a'),outcome:'unknown_outcome'},at)
 await campaign.recordProvider(receipt('a'),at) // duplicate in-flight receipt is not a new wire reservation
 expect(await campaign.providerStatus(at)).toMatchObject({attempts:2,remaining:0,month:'2026-10'})
 await expect(campaign.recordProvider(receipt('d'),at)).rejects.toThrow('MONTHLY_LIMIT')
 await campaign.recordProvider(receipt('nov'),new Date('2026-10-31T16:00:00Z'))
 expect(await campaign.providerStatus(new Date('2026-10-31T16:00:00Z'))).toMatchObject({attempts:1,remaining:1,month:'2026-11'})
 expect((await db.query<{n:number}>('SELECT count(*)::int AS n FROM intel_corpus_calls')).rows[0].n).toBe(0)
})
it('caps configured allowance at 2000 and disables Tencent wires for invalid or zero limits',async()=>{
 vi.stubEnv('TENCENT_WSA_MONTHLY_LIMIT','9000');expect((await campaign.providerStatus(at)).monthly_limit).toBe(2000)
 vi.stubEnv('TENCENT_WSA_MONTHLY_LIMIT','bad');expect((await campaign.providerStatus(at)).monthly_limit).toBe(0)
 await expect(campaign.recordProvider(receipt('bad'),at)).rejects.toThrow('MONTHLY_LIMIT')
})
