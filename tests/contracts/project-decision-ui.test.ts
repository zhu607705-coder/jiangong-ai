import {act,createElement} from 'react'
import {createRoot} from 'react-dom/client'
import {Simulate} from 'react-dom/test-utils'
import {parseHTML} from 'linkedom'
import {afterEach,expect,it,vi} from 'vitest'
import ProjectDecisionGuidance from '../../apps/workspace/src/components/ProjectDecisionGuidance'
import ConcreteWorkPlan from '../../apps/workspace/src/components/ConcreteWorkPlan'
import ProjectTasksPage from '../../apps/workspace/src/components/ProjectTasksPage'
import {evaluateProjectGuidance} from '../../services/capabilities/project-decision'
import {guideInput,guidePacket,guideProject,guideResponse} from './project-decision-fixture'
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks()})

it('changes real measure/task order, navigates to the suggested pane and shares one result across pages',async()=>{
 const {window}=parseHTML('<html><body><div id="root"></div></body></html>')
 for(const [name,value] of Object.entries({window,document:window.document,IS_REACT_ACT_ENVIRONMENT:true,localStorage:{getItem:()=>null,setItem:()=>{}}}))vi.stubGlobal(name,value)
 const result=await evaluateProjectGuidance(guideInput(),'ui-hash',new AbortController().signal,async(state,questions)=>guideResponse(state,questions))
 const fetchMock=vi.fn(async(_url,init)=>new Response(JSON.stringify(init?.method==='POST'?result:null),{headers:{'Content-Type':'application/json'}}));vi.stubGlobal('fetch',fetchMock)
 const root=createRoot(window.document.getElementById('root')!),navigate=vi.fn(),packet=guidePacket()
 const render=(page:string,direction:'comprehensive'|'rebuild'='comprehensive')=>act(async()=>root.render(createElement(ProjectDecisionGuidance,{project:guideProject,page,direction,packetHash:packet.input_hash,onNavigate:navigate,children:createElement('div',{},createElement(ConcreteWorkPlan,{packet,direction,onEvidence:vi.fn()}),createElement(ProjectTasksPage,{project:guideProject,packet,direction,onEvidence:vi.fn(),onSupplement:vi.fn()}))})))
 try{
  await render('scenarios')
  expect(fetchMock.mock.calls.every(([,init])=>init.method==='GET')).toBe(true)
  expect(document.querySelector('.cwp-work-table tbody tr')?.getAttribute('data-work-package-id')).toBe('comprehensive-WATER')
  await act(async()=>Simulate.click(document.querySelector('.pdg-controls button')!))
  await vi.waitFor(()=>expect(document.querySelector('.pdg-title strong')?.textContent).toBe('先测建设与资金安排'))
  expect(document.querySelector('.cwp-work-table tbody tr')?.getAttribute('data-work-package-id')).toBe('comprehensive-SERVICE')
  expect(document.querySelector('[data-task-id]')?.textContent).toContain('资金落实')
  await act(async()=>Simulate.click(document.querySelector('.pdg-primary')!))
  expect(navigate).toHaveBeenLastCalledWith({page:'scenarios',section:'detail',pane:'funding'})
  const calls=fetchMock.mock.calls.length
  await render('evidence')
  expect(fetchMock).toHaveBeenCalledTimes(calls)
  expect(document.querySelector('.pdg-title strong')?.textContent).toBe('核对冲突与对象范围')
  await render('actions','rebuild')
  expect(document.querySelector('.pdg-primary')).toBeNull()
  expect(document.querySelector('.pdg-title strong')?.textContent).toBe('让现有资料指向下一步')
  expect(fetchMock.mock.calls.filter(([,init])=>init.method==='POST')).toHaveLength(1)
 }finally{await act(async()=>root.unmount())}
})
