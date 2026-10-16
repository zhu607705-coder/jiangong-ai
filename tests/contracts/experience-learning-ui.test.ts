import { afterEach,expect,test,vi } from 'vitest'
import { act,createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { Simulate } from 'react-dom/test-utils'
import { parseHTML } from 'linkedom'
import ExperienceLearningIntake from '../../apps/workspace/src/components/ExperienceLearningIntake'

afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals()})
const json=(value:unknown)=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}})
test('one intake sends the whole chat and files through upload, then shows skills and an applicable version update',async()=>{
  const {window,document}=parseHTML('<html><body><div id="root"></div></body></html>')
  for(const [name,value] of Object.entries({window,document,IS_REACT_ACT_ENVIRONMENT:true}))vi.stubGlobal(name,value)
  const root=createRoot(document.getElementById('root')!),container=document.getElementById('root')!
  const quote='建议按楼栋更新给水立管。',fields=[{key:'proposal',value:quote,evidence:[{document_id:'D1',version:'v1',locator:'line:1',quote}]}]
  const card={id:'E1',project_id:'P1',revision:1,status:'draft',title:'供水管网更新',fields,knowledge:{kind:'rule',conditions:[],exclusions:[]}}
  const skill={id:'S1',revision:1,status:'draft',title:'分栋管网更新技能',procedure:[quote],preconditions:[],measure_key:'pipe_network'}
  const learned={cards:[card],skills:[skill],rule_updates:[{candidate:card,previous:null,changes:[{field:'proposal',before:'',after:quote}]}],warnings:[],model_calls:2,coverage:{windows:2,completed_windows:2,characters:24000,completed_characters:24000,complete:true}}
  const uploads:File[]=[],requests:{path:string;body:unknown}[]=[]
  const transport=vi.fn(async(url:unknown,init?:RequestInit)=>{
    const path=String(url)
    if(path.endsWith('/session'))return json({})
    if(path.endsWith('/pipeline'))return json({automation:{model_configured:true,internal_model_enabled:true}})
    if(path.endsWith('/documents')){uploads.push((init!.body as FormData).get('file') as File);return json({id:'D'+uploads.length})}
    const body=init?.body?JSON.parse(String(init.body)):null;requests.push({path,body})
    if(path.endsWith('/learn'))return new Response(JSON.stringify({type:'progress',phase:'skills',message:'正在蒸馏技能'})+'\n'+JSON.stringify({type:'complete',result:learned})+'\n',{headers:{'Content-Type':'application/x-ndjson'}})
    if(path.endsWith('/rule-updates/apply'))return json({rule:{...card,revision:2,status:'approved'},skills:[{...skill,id:'S2',card_refs:[{card_id:'E1',revision:2}]}]})
    throw new Error('Unexpected '+path)
  })
  vi.stubGlobal('fetch',transport)
  const changed=vi.fn(),details=vi.fn()
  try {
    await act(async()=>root.render(createElement(ExperienceLearningIntake,{projectId:'P1',synthetic:true,onChanged:changed,onOpenDetails:details})))
    const long='会议上下文'.repeat(5000)+'\n'+quote
    await act(async()=>{
      Simulate.change(container.querySelector('textarea')!,{target:{value:long}} as never)
      Simulate.change(container.querySelector('input[type=file]')!,{target:{files:[new File(['供水记录'],'调研.txt')]}} as never)
    })
    await act(async()=>{[...container.querySelectorAll('button')].find(button=>button.textContent==='导入并自动构建')!.click()})
    expect(uploads).toHaveLength(2);expect(await uploads[1].text()).toBe(long)
    expect(requests.find(item=>item.path.endsWith('/learn'))?.body).toMatchObject({document_ids:['D1','D2'],use_model:true})
    expect(container.textContent).toContain('已整理 1 条经验')
    await act(async()=>{[...container.querySelectorAll<HTMLButtonElement>('nav button')].find(button=>button.textContent==='技能蒸馏')!.click()})
    expect(container.textContent).toContain('分栋管网更新技能');expect(container.textContent).toContain('采用本版技能')
    await act(async()=>{[...container.querySelectorAll<HTMLButtonElement>('nav button')].find(button=>button.textContent==='规则更新对比')!.click()})
    expect(container.textContent).toContain('原有规则');expect(container.textContent).toContain('本轮拟更新')
    await act(async()=>{[...container.querySelectorAll('button')].find(button=>button.textContent==='采用本版规则')!.click()})
    expect(container.textContent).toContain('已采用本版规则')
    expect(requests.find(item=>item.path.endsWith('/rule-updates/apply'))?.body).toEqual({candidate_id:'E1',expected_candidate_revision:1})
    expect(changed).toHaveBeenCalledTimes(2)
  } finally {await act(async()=>root.unmount())}
})
