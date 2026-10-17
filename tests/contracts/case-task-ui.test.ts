import {act,createElement} from 'react'
import {createRoot,type Root} from 'react-dom/client'
import {Simulate} from 'react-dom/test-utils'
import {parseHTML} from 'linkedom'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {WorkbenchAccessContext} from '../../apps/workspace/src/AdminAccess'
import RenewalCaseExplorer from '../../apps/workspace/src/components/RenewalCaseExplorer'
import TaskMaterialImport from '../../apps/workspace/src/components/TaskMaterialImport'
import ProjectTasksPage from '../../apps/workspace/src/components/ProjectTasksPage'
import {projectRenewalModeInput} from '../../packages/retrofit/renewal-mode'
import {buildProjectTasks} from '../../packages/retrofit/project-tasks'
import {guideProject,guidePacket} from './project-decision-fixture'
import type {TaskMaterialReceipt} from '../../packages/retrofit/task-materials'
const read=vi.hoisted(()=>vi.fn())
vi.mock('../../apps/workspace/src/api',()=>({api:read,ADMIN_LOGIN_REQUIRED_EVENT:'login',ADMIN_LOGIN_REQUESTED_EVENT:'request-login'}))
let root:Root,container:HTMLElement
beforeEach(()=>{const {window}=parseHTML('<html><body><div id="root"></div></body></html>');for(const [key,value] of Object.entries({window,document:window.document,IS_REACT_ACT_ENVIRONMENT:true,localStorage:{getItem:()=>null,setItem:()=>{}},requestAnimationFrame:(f:()=>void)=>{f();return 0},cancelAnimationFrame:()=>{}}))vi.stubGlobal(key,value);container=window.document.getElementById('root')! as unknown as HTMLElement;root=createRoot(container);read.mockResolvedValue({items:[]})})
afterEach(async()=>{await act(async()=>root.unmount());vi.unstubAllGlobals();vi.clearAllMocks()})
const mount=(component:React.ReactElement)=>act(async()=>root.render(createElement(WorkbenchAccessContext.Provider,{value:{role:'admin',canWrite:true}},component)))
it('switches the actual two-column case view by the decision problem and keeps the chosen direction',async()=>{
 const input=projectRenewalModeInput({...guideProject.input,scope:{...guideProject.input.scope,city:'杭州'}});input.matching_context!.topics=['elevator']
 await mount(createElement(RenewalCaseExplorer,{input,direction:'comprehensive'}))
 expect(container.querySelector('.case-decision-detail h4')?.textContent).toContain('翠苑一区')
 await act(async()=>Simulate.change(container.querySelector('[aria-label="案例匹配重点"]')!,{target:{value:'meals'} as unknown as EventTarget}))
 expect(container.querySelector('.case-decision-detail h4')?.textContent).toContain('荔湾区')
 expect(container.querySelector('.case-decision-use')?.textContent).toContain('堂食与配送容量')
 expect(container.querySelector('.case-two-columns')).not.toBeNull();expect(container.textContent).not.toContain('凤南一村')
})
it('shows real saved fields and calls extraction only after selecting this file consent',async()=>{
 const task=buildProjectTasks(guidePacket(),'comprehensive')[0],link={task_id:task.id,input_hash:'guide-plan',direction:'comprehensive' as const}
 const receipt:TaskMaterialReceipt={...link,document_id:'DOC',file_name:'问卷.csv',version:'v1',context_version:3,task_title:task.title,parse_status:'extracted',observations:[{field:'有效问卷',value:'100',locator:'table:1/row:2',quote:'{"有效问卷":100}',representation:'parsed_table'}],tools:[{tool:'ParserPort',status:'completed',detail:'已保存的解析结果',count:25},{tool:'任务指标提取',status:'completed',detail:'来源行绑定',count:1}],created_at:'2026-10-17',updated_at:'2026-10-17',extraction:{status:'not_requested',model_calls:0,card_ids:[],warnings:[]}}
 read.mockResolvedValue({items:[receipt]});const extract=vi.fn(async()=>({...receipt,extraction:{status:'completed' as const,model_calls:1,card_ids:['DRAFT'],warnings:[]}})),reassess=vi.fn()
 await mount(createElement(TaskMaterialImport,{projectId:guideProject.id,revision:3,task,link,synthetic:false,onUpload:vi.fn(),onExtract:extract,onReassess:reassess,onReceived:vi.fn()}))
 const button=[...container.querySelectorAll('button')].find(row=>row.textContent==='调用原文提取工具')!
 expect(button.disabled).toBe(true);expect(extract).not.toHaveBeenCalled();expect(container.textContent).toContain('有效问卷');expect(container.textContent).toContain('table:1/row:2')
 const consent=container.querySelector('.task-model-extraction input')!
 await act(async()=>Simulate.change(consent,{target:{checked:true} as unknown as EventTarget}));await act(async()=>button.click())
 expect(extract).toHaveBeenCalledWith('DOC',link)
 await act(async()=>[...container.querySelectorAll('button')].find(row=>row.textContent?.includes('带入下一轮'))!.click());expect(reassess).toHaveBeenCalledOnce()
})
it('retains the task baseline while a successful upload advances the project version',async()=>{
 const props={project:guideProject,packet:guidePacket(),onEvidence:vi.fn(),onSupplement:vi.fn(),onUploadTask:vi.fn()}
 await mount(createElement(ProjectTasksPage,props));await act(async()=>container.querySelector<HTMLButtonElement>('[data-task-id]')!.click())
 expect(document.querySelector('[role="dialog"]')).not.toBeNull()
 await mount(createElement(ProjectTasksPage,{...props,project:{...guideProject,context_version:3},packet:null}))
 expect(document.querySelector('[role="dialog"]')).not.toBeNull();expect(document.body.textContent).toContain('在这项任务中导入新数据')
 const fresh=guidePacket();fresh.input_hash='next-round';fresh.context_version=3
 await mount(createElement(ProjectTasksPage,{...props,project:{...guideProject,context_version:3},packet:fresh}))
 expect(document.querySelector('[role="dialog"]')).toBeNull()
})
