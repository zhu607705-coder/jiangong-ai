import {afterEach,expect,it,vi} from 'vitest'
import {act,createElement} from 'react'
import {createRoot} from 'react-dom/client'
import {parseHTML} from 'linkedom'
import RagEvidenceSearch from '../../apps/workspace/src/imports/RagEvidenceSearch'

const apiMock=vi.hoisted(()=>vi.fn())
vi.mock('../../apps/workspace/src/api',()=>({api:apiMock}))
afterEach(()=>{vi.unstubAllGlobals();apiMock.mockReset()})

it('uses AI retrieval, indexes on request, renders original quotes and locates their material',async()=>{
  const dom=parseHTML('<html><body><div id="root"></div></body></html>')
  vi.stubGlobal('window',dom.window);vi.stubGlobal('document',dom.document);vi.stubGlobal('HTMLElement',dom.window.HTMLElement)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true)
  const hit={id:'HIT',file_name:'助餐公告.txt',locator:'line:2',text:'长者助餐服务覆盖36人。',source:{id:'SOURCE'},source_kind:'public_original',version:'v1',alias_locators:[],measure_links:[],matched_measure_links:[],measure_mentions:[],objects:[],stages:[],review_statuses:[],match_reasons:['语义召回'],score:0.02,source_date:null}
  apiMock.mockImplementation(async(path:string)=>path.endsWith('/index')?{status:'ready',indexed:1,pending:0,model:'test-api',warnings:[]}:{project_id:'P-TEST',question:'晚餐去哪里',hits:[hit],candidate_counts:{documents:1,eligible_chunks:1},method:'api_semantic_bm25',query_expansions:[],skipped:[],rank_query:'晚餐去哪里 助餐',assistance:{model:'test-api',answer:[{text:'可查阅长者助餐服务安排。',citations:[{hit_id:'HIT',quote:hit.text}]}],reading_guidance:[],public_queries:['测试社区 助餐 公告'],internal_requests:['补充去重就餐人数'],warnings:[],index:{eligible:1,indexed:1,pending:0}}})
  const transport=vi.fn(async(url:string,init:RequestInit)=>{
    const value=await apiMock(url.replace('/api',''),JSON.parse(String(init.body)))
    const originals={...value,assistance:undefined}
    return new Response(JSON.stringify({type:'originals',result:originals})+'\n'+JSON.stringify({type:'complete',result:value})+'\n',{headers:{'Content-Type':'application/x-ndjson'}})
  })
  vi.stubGlobal('fetch',transport)
  const root=createRoot(dom.document.getElementById('root')!),locate=vi.fn()
  const click=async(text:string)=>{const button=[...dom.document.querySelectorAll('button')].find(button=>button.textContent?.includes(text))!;expect(button).toBeTruthy();await act(async()=>{button.dispatchEvent(new dom.window.Event('click',{bubbles:true}))})}
  try {
    await act(async()=>root.render(createElement(RagEvidenceSearch,{projectId:'P-TEST',initialQuestion:'晚餐去哪里',variant:'floating',onLocateHit:locate})))
    await act(async()=>{dom.document.querySelector('form')!.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}))})
    await vi.waitFor(()=>expect(dom.document.querySelector('.rag-answer')?.textContent).toContain('可查阅长者助餐服务安排'))
    expect(transport.mock.calls[0][1].headers).toMatchObject({'Accept':'application/x-ndjson','X-Requested-With':'haizhizi'})
    expect(apiMock.mock.calls[0][1]).toMatchObject({question:'晚餐去哪里',use_ai:true,allow_internal_ai:false})
    expect(dom.document.querySelector('.rag-answer blockquote')?.textContent).toBe(hit.text)
    await click('原文依据');expect(locate).toHaveBeenCalledWith(hit)
    await click('建立 / 更新语义索引')
    await vi.waitFor(()=>expect(dom.document.querySelector('.rag-index-controls')?.textContent).toContain('已索引 1'))
    const call=apiMock.mock.calls.find(([path])=>path.endsWith('/index'))!
    expect(call[1]).not.toHaveProperty('question');expect(call[1]).toHaveProperty('allow_internal_ai',false)
  } finally {await act(async()=>root.unmount())}
})
