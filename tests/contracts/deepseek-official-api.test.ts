import {expect,it,vi} from 'vitest'
import {DeepSeekAdapter,resolveAdapterOptions} from '@deepseek-ai/dsh-llm-deepseek'
import {DeepSeekWebTools,deepSeekRetryDelay} from '../../runtime/dsh/deepseek-web-tools'
import {DEEPSEEK_MODELS,canonicalDeepSeekModel,deepSeekModelDescriptor} from '../../runtime/dsh/deepseek-catalog'

it('maps only documented retired Flash aliases and resolves the actual DSH catalog to 1017',async()=>{
 for(const model of ['deepseek-flash','deepseek-v4-flash','deepseek-v4-flash-vision-exp'])expect(canonicalDeepSeekModel(model)).toBe('deepseek-flash')
 expect(canonicalDeepSeekModel('enterprise-custom-model')).toBe('enterprise-custom-model')
 expect(deepSeekModelDescriptor('deepseek-flash')).toMatchObject({documented_release:'DeepSeek-V4.1-Flash-1017',response_version_pinned:false,context_window:1_000_000,max_output_tokens:384_000})
 const adapter=new DeepSeekAdapter({options:()=>resolveAdapterOptions({models:DEEPSEEK_MODELS}),resolveAuth:async()=>({headers:{}}),resolveUserId:()=>{throw new Error('Catalog check must not prepare an HTTP request')},prepareExtensions:async()=>{throw new Error('Catalog check must not prepare an HTTP request')}})
 const model=await adapter.resolveModel('deepseek-official','deepseek-flash')
 expect(model).toMatchObject({id:'deepseek-flash',name:'DeepSeek-V4.1-Flash-1017',context:{contextWindow:1_000_000},defaultMaxTokens:384_000})
})

it('sends independent official endpoints, Bearer auth, Unicode query and body flag; summary is never fetched as original text',async()=>{
 const transport=vi.fn(async(url:string,init:RequestInit)=>{
  expect(init.method).toBe('POST');expect(init.headers).toMatchObject({Authorization:'Bearer isolated-key','Content-Type':'application/json'})
  if(url.endsWith('/search'))return Response.json({results:[{title:'原件',url:'https://www.zju.edu.cn/case',snippet:'短摘要',summary:'摘要不能当原文',content:'',date:null}]})
  expect(JSON.parse(String(init.body))).toEqual({url:'https://www.zju.edu.cn/case'})
  return Response.json({title:'原件',content:'项目预算100万元，尚未验收。'})
 })
 const tool=new DeepSeekWebTools({key:()=>'isolated-key',includeContent:true,maxSearchRequests:3},undefined,transport as typeof fetch)
 const result=await tool.search({query:'求是村 😀 site:zju.edu.cn',maxResults:5}),body=await tool.fetch({url:result.sources[0].url})
 expect(transport.mock.calls.map(call=>call[0])).toEqual(['https://api.deepseek.com/v1/tools/search','https://api.deepseek.com/v1/tools/fetch'])
 expect(JSON.parse(String(transport.mock.calls[0][1].body))).toEqual({query:'求是村 😀 site:zju.edu.cn',count:5,need_content:true,ori_question:'求是村 😀 site:zju.edu.cn'})
 expect(body.body.content).toBe('项目预算100万元，尚未验收。');expect(body.representation?.kind).toBe('deepseek_markdown')
 expect(tool.receipts.map(r=>r.estimated_cny)).toEqual([.005,.005])
})

it.each([400,401,402,403,404,413])('does not retry permanent search error %s or hide it with model search',async status=>{
 const transport=vi.fn(async()=>new Response('{}',{status})),legacy={search:vi.fn(),fetch:vi.fn()}
 const tool=new DeepSeekWebTools({key:()=>'isolated',includeContent:true,maxSearchRequests:4},legacy,transport as typeof fetch)
 await expect(tool.search({query:'测试'})).rejects.toThrow('HTTP_'+status)
 expect(transport).toHaveBeenCalledTimes(1);expect(legacy.search).not.toHaveBeenCalled();expect(tool.receipts[0]).toMatchObject({billing_state:'expected_free',estimated_cny:0})
})

it('does not let retries or concurrent queries silently exceed the search budget',async()=>{
 const transport=vi.fn(async()=>new Response('{}',{status:503})),legacy={search:vi.fn(),fetch:vi.fn()}
 const tool=new DeepSeekWebTools({key:()=>'isolated',includeContent:true,maxSearchRequests:1},legacy,transport as typeof fetch)
 const result=await Promise.allSettled([tool.search({query:'并行甲'}),tool.search({query:'并行乙'})])
 expect(result.every(row=>row.status==='rejected')).toBe(true);expect(transport).toHaveBeenCalledTimes(1)
 expect(tool.receipts).toHaveLength(1);expect(legacy.search).not.toHaveBeenCalled()
 await expect(tool.search({query:'继续查询'})).rejects.toThrow('SEARCH_BUDGET')
})

it('respects Retry-After seconds and dates; retryable failure then success has separate receipts',async()=>{
 const now=Date.parse('2026-10-17T00:00:00Z')
 expect(deepSeekRetryDelay('2',1,now)).toBe(2000)
 expect(deepSeekRetryDelay('Sat, 17 Oct 2026 00:00:05 GMT',1,now)).toBe(5000)
 expect(deepSeekRetryDelay('nonsense',2,now)).toBe(700)
 const transport=vi.fn().mockResolvedValueOnce(new Response('{}',{status:429,headers:{'Retry-After':'0'}})).mockResolvedValueOnce(Response.json({results:[]}))
 const tool=new DeepSeekWebTools({key:()=>'isolated',includeContent:true,maxSearchRequests:3},undefined,transport)
 await tool.search({query:'测试'});expect(transport).toHaveBeenCalledTimes(2)
 expect(tool.receipts.map(row=>[row.status,row.outcome,row.billing_state])).toEqual([[429,'failed','expected_free'],[200,'empty','expected_free']])
})

it('allows original HTTP parsing for unsupported Markdown without bypassing Fetch safety rejection and persists fallback provenance',async()=>{
 const receipts:any[]=[],legacy={search:vi.fn(),fetch:vi.fn(async()=>({url:'https://www.zju.edu.cn/file',statusCode:200,body:{kind:'html' as const,content:'<p>原始页面</p>'},truncated:false}))}
 const tool=new DeepSeekWebTools({key:()=>'isolated',includeContent:false,maxSearchRequests:1,onReceipt:async r=>{receipts.push({...r})}},legacy,(async()=>new Response('{}',{status:404})) as typeof fetch)
 expect((await tool.fetch({url:'https://www.zju.edu.cn/file'})).body.kind).toBe('html')
 expect(receipts.at(-1)).toMatchObject({operation:'fetch',status:404,fallback:'original-http',billing_state:'expected_free'})
 const blocked=new DeepSeekWebTools({key:()=>'isolated',includeContent:false,maxSearchRequests:1},legacy,(async()=>new Response('{}',{status:403})) as typeof fetch)
 await expect(blocked.fetch({url:'https://www.zju.edu.cn/file'})).rejects.toThrow('HTTP_403');expect(legacy.fetch).toHaveBeenCalledTimes(1)
})
