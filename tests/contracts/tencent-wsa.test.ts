import {afterEach,expect,it,vi} from 'vitest'
import {TencentWebSearch,tencentSearchPayload,tencentSearchSources,TENCENT_SEARCH_ENDPOINT} from '../../runtime/dsh/tencent-web-search'
import {createPublicWebTools} from '../../runtime/dsh/public-web'
import {installIntelligenceHooks} from '../../packages/intelligence/research-bridge'
import type {WebCallReceipt} from '../../runtime/dsh/deepseek-web-tools'
const req={query:'杭州 老旧小区 消防 site:hangzhou.gov.cn',maxResults:12}
const page=(url='https://www.hangzhou.gov.cn/fixture')=>JSON.stringify({title:'<em>消防</em>改造',url,passage:'标准摘要',content:'动态摘要，不是原文',date:'2026-10-10 09:00:00'})
afterEach(()=>vi.unstubAllEnvs())

it('uses the documented API-Key payload and only sends extended fields for supported editions',()=>{
 expect(tencentSearchPayload(req)).toEqual({Query:'杭州 老旧小区 消防',Site:'hangzhou.gov.cn'})
 expect(tencentSearchPayload(req,'standard','gov')).toMatchObject({Cnt:20,Industry:'gov'})
 expect(tencentSearchPayload(req,'lite','gov')).not.toHaveProperty('Industry')
 expect(tencentSearchPayload({query:'消防 site:a.gov.cn OR site:b.gov.cn'})).not.toHaveProperty('Site')
 expect(()=>tencentSearchPayload({query:'   '})).toThrow('EMPTY')
})
it('parses string pages, drops invalid/unsafe/duplicate URLs, and keeps dynamic content as a snippet',()=>{
 const result=tencentSearchSources(['not-json',page(),page(),page('http://127.0.0.1/a'),page('https://www.shanghai.gov.cn/fixture')],1)
 expect(result.sources).toHaveLength(1);expect(result.truncated).toBe(true)
 expect(result.sources[0]).toMatchObject({title:'消防改造',snippet:'动态摘要，不是原文'})
 expect(result.sources[0]).not.toHaveProperty('content')
 expect(()=>tencentSearchSources({Pages:[]})).toThrow('SCHEMA')
})
it('reserves quota before dispatch, records native request identity and never logs key/error bodies',async()=>{
 const order:string[]=[],saved:WebCallReceipt[]=[],fallback=vi.fn()
 const client=new TencentWebSearch({key:()=> 'fixture-secret',maxSearchRequests:1,record:async r=>{order.push(r.outcome);saved.push({...r})}},{search:fallback},async(url,init)=>{
  expect(order).toEqual(['in_flight']);expect(url).toBe(TENCENT_SEARCH_ENDPOINT)
  expect((init?.headers as any).Authorization).toBe('Bearer fixture-secret');expect(init?.redirect).toBe('error')
  expect(JSON.parse(init?.body as string)).toMatchObject({Site:'hangzhou.gov.cn'})
  return new Response(JSON.stringify({Response:{Pages:[page()],Version:'standard',RequestId:'native-id'}}))
 })
 const result=await client.search(req);expect(result.sources).toHaveLength(1);expect(fallback).not.toHaveBeenCalled()
 expect(saved.at(-1)).toMatchObject({outcome:'received',request_id:'native-id',service_version:'standard',billing_state:'unknown',estimated_cny:0.020})
 expect(JSON.stringify(saved)).not.toContain('fixture-secret')
})
it.each(['missing','quota','empty','api_error','http_error','network','schema'] as const)('falls back once for %s without inventing evidence or Tencent success',async kind=>{
 const saved:WebCallReceipt[]=[],transport=vi.fn(async()=>{
  if(kind==='network')throw new Error('contains fixture-secret')
  return new Response(JSON.stringify(kind==='api_error'?{Response:{Error:{Code:'UnauthorizedOperation',Message:'fixture-secret'},RequestId:'err-native'}}:kind==='schema'?{Response:{}}:{Response:{Pages:kind==='empty'?[]:[page()]}}),{status:kind==='http_error'?429:200})
 }),fallback=vi.fn(async()=>({sources:[{url:'https://example.org/fallback',title:'DS fallback'}],truncated:false}))
 const client=new TencentWebSearch({key:()=>kind==='missing'?'':'fixture-secret',maxSearchRequests:1,record:async()=>{if(kind==='quota')throw Error('TENCENT_WSA_MONTHLY_LIMIT')},onReceipt:async r=>{saved.push({...r})}},{search:fallback},transport)
 expect((await client.search(req)).sources[0].title).toBe('DS fallback');expect(fallback).toHaveBeenCalledTimes(1)
 expect(transport).toHaveBeenCalledTimes(kind==='missing'||kind==='quota'?0:1)
 expect(saved.at(-1)?.fallback).toBe('deepseek-tools');expect(JSON.stringify(saved)).not.toContain('fixture-secret')
})
it('propagates cancellation instead of starting a fallback call',async()=>{
 const controller=new AbortController(),fallback=vi.fn()
 const client=new TencentWebSearch({key:()=> 'fixture',maxSearchRequests:1,record:async()=>{}},{search:fallback},async()=>{controller.abort();controller.signal.throwIfAborted();throw Error('unreachable')})
 await expect(client.search(req,controller.signal)).rejects.toThrow();expect(fallback).not.toHaveBeenCalled()
})
it('does not repeat a failed provider timeout for every query in the same round',async()=>{
 const wire=vi.fn(async()=>{throw Error('socket-timeout')}),fallback=vi.fn(async()=>({sources:[],truncated:false}))
 const client=new TencentWebSearch({key:()=> 'fixture',maxSearchRequests:6,record:async()=>{}},{search:fallback},wire)
 await client.search(req);await client.search({...req,query:'下一个问题'})
 expect(wire).toHaveBeenCalledTimes(1);expect(fallback).toHaveBeenCalledTimes(2)
})
it('does not retain arbitrary provider error codes that could contain sensitive reflected input',async()=>{
 const saved:WebCallReceipt[]=[]
 const client=new TencentWebSearch({key:()=> 'fixture-secret',maxSearchRequests:1,record:async r=>{saved.push({...r})}},{search:async()=>({sources:[],truncated:false})},async()=>new Response(JSON.stringify({Response:{Error:{Code:'fixture-secret',Message:'fixture-secret'}}})))
 await client.search(req);expect(saved.at(-1)?.error_code).toBe('TENCENT_WSA_API_ERROR');expect(JSON.stringify(saved)).not.toContain('fixture-secret')
})
it('factory routes Tencent search plus existing Fetch and aggregates both real provider receipts',async()=>{
 vi.stubEnv('TENCENTCLOUD_WSA_APIKEY','fixture');vi.stubEnv('DEEPSEEK_API_KEY','fixture')
 const record=vi.fn(async()=>{}),uninstall=installIntelligenceHooks({lookup:async()=>[],remember:async()=>{},webCall:record})
 const paths:string[]=[]
 try{
  const web=createPublicWebTools({provider:'tencent_wsa'},undefined,async(url)=>{
   paths.push(String(url));return new Response(JSON.stringify(String(url).includes('SearchPro')?{Response:{Pages:[page()]}}:{content:'真正抓取的网页正文'}))
  })
  const result=await web.search(req);await web.fetch({url:result.sources[0].url})
  expect(paths).toEqual([TENCENT_SEARCH_ENDPOINT,'https://api.deepseek.com/v1/tools/fetch'])
  expect(web.receipts.map(r=>r.provider)).toEqual(['tencent-wsa','deepseek-tools']);expect(record).toHaveBeenCalledTimes(2)
 }finally{uninstall()}
})
it('factory degrades to existing independent Search when the persistent quota hook is unavailable',async()=>{
 vi.stubEnv('TENCENTCLOUD_WSA_APIKEY','fixture');vi.stubEnv('DEEPSEEK_API_KEY','fixture')
 const paths:string[]=[]
 const web=createPublicWebTools({provider:'tencent_wsa'},undefined,async(url)=>{paths.push(String(url));return new Response(JSON.stringify({results:[{url:'https://example.org/fixture',title:'Fallback'}]}))})
 expect((await web.search(req)).sources[0].title).toBe('Fallback')
 expect(paths).toEqual(['https://api.deepseek.com/v1/tools/search'])
 expect(web.receipts[0]).toMatchObject({provider:'tencent-wsa',error_code:'TENCENT_WSA_QUOTA_UNAVAILABLE',estimated_cny:0})
})
