import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { parseHTML } from 'linkedom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import fixture from '../../fixtures/inputs/01_auto.json'
import replay from '../../data/demos/qiushi-validated-replay.json'
import type { DecisionSupport, ProjectInput } from '../../apps/host/generated/contracts'
import { projectRenewalModeInput, type RenewalModePacket } from '../../packages/retrofit/renewal-mode'
import { WorkbenchAccessContext } from '../../apps/workspace/src/AdminAccess'
const read=vi.hoisted(()=>vi.fn())
vi.mock('../../apps/workspace/src/api',()=>({api:read,ADMIN_LOGIN_REQUIRED_EVENT:'login',ADMIN_LOGIN_REQUESTED_EVENT:'request-login'}))
import RenewalModePanel from '../../apps/workspace/src/maps/RenewalModePanel'

let root:Root,container:HTMLElement,stream:ReadableStreamDefaultController<Uint8Array>
const input=()=>projectRenewalModeInput({...structuredClone(fixture),business_profile:'neighborhood'} as ProjectInput)
const decision=()=>structuredClone(replay.packet.decision) as DecisionSupport
const emit=(event:unknown)=>stream.enqueue(new TextEncoder().encode(JSON.stringify(event)+'\n'))
async function mount(cached:DecisionSupport|null=null){
  read.mockImplementation(async(path:string)=>path.includes('/experiences')?{cards:[{id:'DRAFT-1',title:'居民意愿调查提取',status:'draft'}]}:{screening:input(),decision:cached,origin:'explicit_mode'})
  await act(async()=>root.render(createElement(WorkbenchAccessContext.Provider,{value:{role:'admin',canWrite:true}},createElement(RenewalModePanel,{endpoint:'/projects/P-MODE/renewal-mode',contextVersion:1,input:input()}))))
}
async function click(text:string){const button=[...container.querySelectorAll('button')].find(row=>row.textContent?.includes(text));expect(button).toBeDefined();await act(async()=>button!.click())}
beforeEach(()=>{
  const {window}=parseHTML('<html><body><div id="root"></div></body></html>')
  vi.stubGlobal('window',window);vi.stubGlobal('document',window.document);vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true)
  container=window.document.getElementById('root') as unknown as HTMLElement;root=createRoot(container);read.mockReset()
  vi.stubGlobal('fetch',vi.fn().mockImplementation(async()=>new Response(new ReadableStream<Uint8Array>({start(controller){stream=controller}}),{headers:{'Content-Type':'application/x-ndjson'}})))
})
afterEach(async()=>{await act(async()=>root.unmount());vi.unstubAllGlobals()})

test('idle, real stream progress, and completed result are distinct; missing and pending review remain explicit',async()=>{
  await mount()
  expect(container.querySelector('.renewal-mode-result')).toBeNull()
  expect(fetch).not.toHaveBeenCalled()
  await click('开始判定改造模式')
  expect(fetch).toHaveBeenCalledTimes(1)
  const reviewRead=read.mock.calls.find(call=>String(call[0]).includes('/experiences'))
  expect((reviewRead?.[2] as AbortSignal).aborted).toBe(false)
  await act(async()=>emit({type:'progress',phase:'inputs',state:'completed',message:'已核对本对象资料',source_count:2,condition_count:9}))
  expect(container.querySelector('.renewal-run-progress')?.textContent).toContain('本对象原文 2 份')
  expect(container.querySelector('.renewal-mode-result')).toBeNull()
  const screening=input();Object.assign(screening.conditions.find(row=>row.kind==='funding_secured')!,{value:false,state:'restricted',source_ids:['FUND'],locators:['资金记录第2页']})
  const result:RenewalModePacket={screening,decision:decision()}
  await act(async()=>{emit({type:'complete',result});stream.close()})
  await vi.waitFor(()=>expect(container.querySelector('.renewal-mode-result')).not.toBeNull())
  const unmet=container.querySelector('.renewal-gate li[data-state=unmet]')
  expect(unmet?.getAttribute('data-tone')).toBe('danger')
  expect(unmet?.textContent).toContain('本项目资金已落实')
  expect(unmet?.textContent).toContain('资金记录第2页')
  expect(container.querySelectorAll('.renewal-gate li[data-state=unknown]')).toHaveLength(8)
  expect(container.querySelector('.renewal-gate')?.hasAttribute('open')).toBe(true)
  expect(container.querySelector('.renewal-review-queue')?.textContent).toContain('1 项待审核')
  expect(container.querySelector('.renewal-review-queue')?.textContent).toContain('居民意愿调查提取')
})

test('retry hides the saved recommendation, and cancellation does not substitute a conservative default result',async()=>{
  const cached=decision(),original=JSON.stringify(cached)
  await mount(cached)
  expect(container.querySelector('.renewal-mode-result')).not.toBeNull()
  await click('更新模式初判')
  expect(container.querySelector('.renewal-mode-result')).toBeNull()
  await click('停止判定')
  expect(container.querySelector('.renewal-mode-result')).toBeNull()
  expect(container.querySelector('.renewal-notice')?.textContent).toContain('已停止')
  expect(JSON.stringify(cached)).toBe(original)
})
