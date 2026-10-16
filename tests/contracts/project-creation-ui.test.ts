import { act,createElement } from 'react'
import { createRoot,type Root } from 'react-dom/client'
import { parseHTML } from 'linkedom'
import { afterEach,beforeEach,expect,test,vi } from 'vitest'
const apiMock=vi.hoisted(()=>vi.fn())
vi.mock('../../apps/workspace/src/api',()=>({api:apiMock,ADMIN_LOGIN_REQUIRED_EVENT:'login',ADMIN_LOGIN_REQUESTED_EVENT:'request-login'}))
vi.mock('../../apps/workspace/src/maps/MapWorkspace',()=>({default:({onCreateFromPlace}:{onCreateFromPlace:(place:unknown)=>void})=>createElement('button',{onClick:()=>onCreateFromPlace({name:'地图选点',longitude:120.12,latitude:30.26,provider:'amap'})},'地图选点建立项目')}))
import App from '../../apps/workspace/src/App'

let root:Root,document:Document,window:ReturnType<typeof parseHTML>['window'],writes:{input:{project_id:string};name:string}[],submitted:number
beforeEach(async()=>{
  const dom=parseHTML('<html><body><div id="root"></div></body></html>');window=dom.window;document=dom.document as unknown as Document
  const location={href:'http://localhost/?view=map',search:'?view=map',pathname:'/',hash:'',origin:'http://localhost',reload:vi.fn(),assign:vi.fn()}
  Object.assign(window,{location,history:{pushState:vi.fn(),replaceState:vi.fn()}})
  vi.stubGlobal('window',window);vi.stubGlobal('document',document);vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true)
  vi.stubGlobal('requestAnimationFrame',vi.fn(()=>1));vi.stubGlobal('cancelAnimationFrame',vi.fn())
  let entropy=0;vi.stubGlobal('crypto',{getRandomValues:(bytes:Uint8Array)=>bytes.fill(++entropy)})
  vi.stubGlobal('localStorage',{getItem:()=>null,setItem:vi.fn(),removeItem:vi.fn()})
  writes=[];submitted=0
  apiMock.mockReset().mockImplementation(async(path:string,body?:unknown)=>{
    if(path==='/session')return {model_configured:false}
    if(path==='/projects'&&body){writes.push(body as typeof writes[number]);if(++submitted===1)throw new Error('连接中断，请重试');return new Promise(()=>{})}
    if(path==='/projects')return []
    if(path==='/projects/public-decisions')return {items:[]}
    if(path==='/maps/config')return {configured:false}
    throw new Error(`Unexpected creation read ${path}`)
  })
  root=createRoot(document.getElementById('root')!)
  await act(async()=>root.render(createElement(App)))
})
afterEach(async()=>{await act(async()=>root.unmount());vi.unstubAllGlobals()})
async function open(){const button=[...document.querySelectorAll('button')].find(row=>row.textContent==='地图选点建立项目');expect(button).toBeDefined();await act(async()=>button!.click())}
async function submit(){await act(async()=>{document.querySelector('form')!.dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}))})}
test('an unnamed map point still supplies a valid research name, and creation failures are visible inside the modal',async()=>{
  await open();expect((document.querySelector('#region-name') as HTMLInputElement).value).toContain('地图选点')
  await submit()
  expect(writes).toHaveLength(1);expect(document.querySelector('.modal [role=alert]')?.textContent).toContain('连接中断')
})
test('repeated submission after a lost response uses the same stable draft id on HTTP-style crypto',async()=>{
  await open();await submit();await submit()
  expect(writes).toHaveLength(2);expect(writes[0].input.project_id).toBe(writes[1].input.project_id)
  expect(document.querySelector('.modal button[type=submit]')?.hasAttribute('disabled')).toBe(true)
})
