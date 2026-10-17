import {act,createElement} from 'react'
import {createRoot,type Root} from 'react-dom/client'
import {parseHTML} from 'linkedom'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import InvestigationAdvicePanel from '../../apps/workspace/src/components/InvestigationAdvicePanel'
import {WorkbenchAccessContext} from '../../apps/workspace/src/AdminAccess'
import {guideProject,guidePacket} from './project-decision-fixture'
import type {InvestigationAdviceResult} from '../../packages/retrofit/investigation-advice'
let root:Root
const packet=guidePacket()
const advice=(version=2):InvestigationAdviceResult=>({policy:'investigation-advice-v1',project_id:guideProject.id,context_version:version,strategy_hash:packet.input_hash,strategy_created_at:packet.created_at,input_hash:'advice:hash',direction:null,created_at:'2026-10-17T00:00:00Z',duration_ms:1200,reused:false,summary:'当前登记天津，旧资料为杭州。先核对地址清册与来源对象，再补充本地调查。',steps:[{task_id:'TASK-1',title:'地址核查',action:'向属地核对登记地址',reason:'确保楼栋与研究对象一致',material:'地址清册与边界图',channel:'街道与住房管理部门',completion_check:'核对地址与楼栋编号',evidence_refs:['PUBLIC']},{task_id:'TASK-2',title:'原文核对',action:'对照杭州原文的工程范围',reason:'避免沿用异地工程量',material:'工程范围原文',channel:'已保存的来源页面',completion_check:'原件名称与本地范围逐项对应',evidence_refs:[]}],source_count:1,private_context_omitted:false,model_label:'DeepSeek-V4.1-Flash-1017',model_calls:[]})
beforeEach(()=>{const {window}=parseHTML('<html><body><div id="root"></div></body></html>');for(const [key,value]of Object.entries({window,document:window.document,IS_REACT_ACT_ENVIRONMENT:true}))vi.stubGlobal(key,value);root=createRoot(document.getElementById('root')!)})
afterEach(async()=>{await act(async()=>root.unmount());vi.unstubAllGlobals();vi.restoreAllMocks()})
const render=(props:Parameters<typeof InvestigationAdvicePanel>[0],canWrite=true)=>act(async()=>root.render(createElement(WorkbenchAccessContext.Provider,{value:{canWrite,role:canWrite?'admin':'viewer'},children:createElement(InvestigationAdvicePanel,props)})))
it('generates once after a cache miss, switches concrete suggestions and opens the exact linked task/evidence',async()=>{
 const result=advice(),fetcher=vi.fn(async(_url,init)=>Response.json(init.method==='POST'?result:null));vi.stubGlobal('fetch',fetcher)
 const task=vi.fn(),evidence=vi.fn();await render({project:guideProject,packet,direction:null,onTask:task,onEvidence:evidence})
 expect(fetcher.mock.calls.filter(([,init])=>init.method==='POST')).toHaveLength(1)
 expect(document.body.textContent).toContain('地址清册与边界图')
 await act(async()=>document.querySelector<HTMLButtonElement>('.investigation-advice-actions button')!.click());expect(task).toHaveBeenLastCalledWith('TASK-1')
 await act(async()=>document.querySelectorAll<HTMLButtonElement>('.investigation-advice-actions button')[1].click());expect(evidence).toHaveBeenLastCalledWith(['PUBLIC'])
 await act(async()=>document.querySelectorAll<HTMLButtonElement>('[role=tab]')[1].click());expect(document.body.textContent).toContain('对照杭州原文的工程范围')
 await act(async()=>document.querySelector<HTMLButtonElement>('.investigation-advice-actions button')!.click());expect(task).toHaveBeenLastCalledWith('TASK-2')
})
it('shows cached public guidance to a read-only view without starting a model request',async()=>{
 const fetcher=vi.fn(async()=>Response.json({...advice(),reused:true}));vi.stubGlobal('fetch',fetcher)
 await render({project:guideProject,packet,direction:null,onTask:vi.fn(),onEvidence:vi.fn()},false)
 expect(fetcher).toHaveBeenCalledTimes(1);expect(document.body.textContent).toContain('已保存建议')
 expect(document.querySelector<HTMLButtonElement>('.investigation-advice header button')!.disabled).toBe(true)
})
it('ignores a late result for the previous material version and leaves a usable retry after failure',async()=>{
 let resolveOld:(value:Response)=>void=()=>{};const fetcher=vi.fn().mockImplementationOnce(()=>new Promise<Response>(resolve=>{resolveOld=resolve})).mockResolvedValueOnce(Response.json({detail:'模型暂不可用'},{status:503}));vi.stubGlobal('fetch',fetcher)
 const props={project:guideProject,packet,direction:null,onTask:vi.fn(),onEvidence:vi.fn()}
 await render(props);await render({...props,project:{...guideProject,context_version:3}})
 await act(async()=>resolveOld(Response.json(advice())))
 expect(document.body.textContent).not.toContain('当前登记天津，旧资料为杭州')
 expect(document.body.textContent).toContain('模型暂不可用');expect(document.querySelector<HTMLButtonElement>('.investigation-advice header button')!.disabled).toBe(false)
})
