// Full application UI regression using explicit synthetic provider fixtures.
// Offline browser render: node tests/browser/map-workspace.mjs (no service or keys).
import { chromium } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { localSession } from './fixtures/local-session.mjs'
const handoffCase=process.env.HZZ_UI_HANDOFF||(process.env.HZZ_UI_EARLY_CREATE==='1'?'normal-pending':'')
const earlyCreate=!!handoffCase
const pointHandoff=handoffCase==='point-ready',switchHandoff=handoffCase==='expanded-switch'
let releaseContext;const contextBarrier=new Promise(resolve=>releaseContext=resolve)
let contextFinished=false,secondContextFinished=false,conversionCalls=0
async function waitUntil(check){for(let i=0;i<200;i++){if(check())return;await new Promise(r=>setTimeout(r,10))}throw Error('Expected context transition did not occur')}
const areaSelection=process.env.HZZ_UI_AREA==='1'
let areaTarget=null,requestedGeometry=null
const cancelScan=process.env.HZZ_UI_SCAN_CANCEL==='1'
const scanRace=process.env.HZZ_UI_SCAN_RACE==='1'||cancelScan
const testOrigin=process.env.HZZ_TEST_ORIGIN||'https://fixture.invalid/'
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox']})
const page=await browser.newPage({viewport:{width:1440,height:960},deviceScaleFactor:1})
const errors=[];page.on('pageerror',e=>errors.push(String(e)))
let modelCalls=0,scanCalls=0,contextCalls=0,studyReads=0;let requestedBounds=null
const studies=new Map();let created=null,createdInput=null;const converted={type:"Polygon",coordinates:[]}
const sdk=`const no=()=>{};const point=p=>({getLng:()=>p[0],getLat:()=>p[1]});
class Base{constructor(o={}){this.o=o;this.handlers={}}on(n,f){this.handlers[n]=f}setMap(m){if(!m)this.el?.remove()}show(){}hide(){}}
const xy=p=>[(p[0]-120.144)/.019*1440,(30.295-p[1])/.016*960];
class Marker extends Base{mount(map){this.el=document.createElement('div');this.el.style.cssText='position:absolute;z-index:8;transform:translate(-50%,-50%)';const [x,y]=xy(this.o.position);this.el.style.left=x/1440*100+'%';this.el.style.top=y/960*100+'%';if(this.o.content instanceof Node)this.el.append(this.o.content);map.el.append(this.el)}}
class Polygon extends Base{mount(map){const el=document.createElementNS('http://www.w3.org/2000/svg','path');const rings=typeof this.o.path[0][0]==='number'?[this.o.path]:this.o.path;el.setAttribute('d',rings.map(r=>'M'+r.map(p=>xy(p).join(',')).join('L')+'Z').join(''));el.setAttribute('fill',this.o.fillColor||'#a0b5c1');el.setAttribute('fill-opacity',this.o.fillOpacity||.25);el.setAttribute('stroke',this.o.strokeColor||'#638ca7');el.setAttribute('stroke-width','2');el.setAttribute('fill-rule','evenodd');el.style.cursor='pointer';el.addEventListener('click',e=>{e.stopPropagation();this.handlers.click?.(e)});map.svg.append(el);this.el=el}}
class Map extends Base{constructor(el,o){super(o);this.el=el;this.svg=document.createElementNS('http://www.w3.org/2000/svg','svg');this.svg.setAttribute('viewBox','0 0 1440 960');this.svg.setAttribute('preserveAspectRatio','none');this.svg.style.cssText='position:absolute;inset:0;width:100%;height:100%;background:#eef1ed';this.svg.innerHTML='<defs><pattern id="b" width="118" height="97" patternTransform="rotate(-9)" patternUnits="userSpaceOnUse"><rect x="15" y="14" width="32" height="58" rx="2" fill="#d8dfdc"/><rect x="58" y="14" width="43" height="23" rx="2" fill="#dee3df"/><rect x="58" y="47" width="43" height="25" rx="2" fill="#d8dfdc"/></pattern></defs><rect width="1440" height="960" fill="url(#b)"/><path d="M 1080 -100 Q 650 250 900 590 T 720 1050" stroke="#c1d9e1" stroke-width="85" fill="none"/><path d="M-20 230L1500 460 M0 690L1500 640 M460 -100L590 1050 M1010 0L900 960" stroke="#fff" stroke-width="25" fill="none"/><path d="M-20 230L1500 460 M0 690L1500 640 M460 -100L590 1050 M1010 0L900 960" stroke="#d5d7ca" stroke-width="2" fill="none"/><text x="720" y="918" fill="#71808c" font-size="14">交互测试样本 · 非真实地块</text>';el.append(this.svg);el.addEventListener('click',e=>{const r=el.getBoundingClientRect();this.handlers.click?.({lnglat:point([120.144+(e.clientX-r.left)/r.width*.019,30.295-(e.clientY-r.top)/r.height*.016])})});setTimeout(()=>this.handlers.complete?.(),100)}
add(items){for(const item of Array.isArray(items)?items:[items])item.mount?.(this)}remove(items){for(const item of Array.isArray(items)?items:[items])item.el?.remove()}destroy(){this.el.innerHTML=''}addControl(){}getStatus(){return {dragEnable:true,zoomEnable:true}}setStatus(s){this.status=s}containerToLngLat(p){return point([120.144+p.x/1440*.019,30.295-p.y/960*.016])}getLayers(){return []}getZoom(){return 17.2}getPitch(){return 55}getRotation(){return 0}getCenter(){return point([120.153576,30.287459])}getBounds(){return {getSouthWest:()=>point([120.145,30.281]),getNorthEast:()=>point([120.162,30.294])}}setZoomAndCenter(){}setFitView(){}setRotation(){}setPitch(){}zoomIn(){}zoomOut(){}}
class Pixel{constructor(x,y){this.x=x;this.y=y}}
class Geocoder{getAddress(_point,done){done('complete',{regeocode:{formattedAddress:'浙江省杭州市西湖区公开测试位置',addressComponent:{city:'杭州市',district:'西湖区'}}})}}
export default {reset:no,load:async()=>({Map,Marker,Polygon,Scale:Base,TileLayer:{Satellite:Base},PlaceSearch:Base,Geocoder,Pixel,convertFrom:(points,type,done)=>done('complete',{locations:points.map(([lng,lat])=>({lng:lng+.005,lat:lat+.003}))})})};`

const bounds={west:120.145,east:120.162,south:30.281,north:30.294}
const ring=[[120.15,30.292],[120.154,30.2916],[120.1553,30.2878],[120.1511,30.2873],[120.15,30.292]]
const hole=[[120.1517,30.2900],[120.1517,30.2904],[120.1521,30.2904],[120.1521,30.2900],[120.1517,30.2900]]
const ctx={id:'MAPCTX-00000000-0000-4000-8000-000000000001',target:{kind:'cell',bounds,geometry:{type:'Polygon',coordinates:[ring,hole]},longitude:120.1525,latitude:30.2895,radius_m:null},provider:'amap',coordinate_encoding:'GCJ-02',created_at:new Date().toISOString(),expires_at:new Date(Date.now()+600000).toISOString(),address:earlyCreate?null:'示例街区',city:null,groups:[{key:'work_live',source_id:'office',label:'办公与居住',status:'available',reported_count:120,sample:[{id:'p1',name:'科创商务楼',category:'商务住宅;商务写字楼',longitude:120.152,latitude:30.289}],retrieved_at:new Date().toISOString(),types_query:'120000',issue:null},{key:'activity',source_id:'retail',label:'商业配套',status:'available',reported_count:99,sample:[{id:'p2',name:'沿街餐饮与社区商业',category:'餐饮服务',longitude:120.152,latitude:30.289}],retrieved_at:new Date().toISOString(),types_query:'050000',issue:null}],local_projects:[],project_revision:'fixture-v1',status:'complete',gaps:[],metric_note:'fixture'}
ctx.target.boundary_source='fixture:survey'
const cell={id:'R-fixture',label:'沿街建筑群',bounds,geometry:ctx.target.geometry,anchor:[120.1525,30.2895],boundary_source:'fixture:survey',context:ctx,metric_value:null,rank:null,tier:'incomplete',factors:[]}
const secondCell=structuredClone(cell);secondCell.id='R-second';secondCell.label='第二建筑群';secondCell.anchor=[cell.anchor[0]+.004,cell.anchor[1]];secondCell.context.id='MAPCTX-00000000-0000-4000-8000-000000000002';secondCell.geometry={type:'Polygon',coordinates:cell.geometry.coordinates.map(r=>r.map(([x,y])=>[x+.004,y]))};secondCell.context.target={...secondCell.context.target,longitude:ctx.target.longitude+.004,geometry:secondCell.geometry,boundary_source:'fixture:survey:B'};secondCell.boundary_source='fixture:survey:B'
const expectedGeometry=switchHandoff?secondCell.geometry:cell.geometry
const scan={id:'MAPSCAN-fixture',bounds,profile:'balanced',theme:'overall',created_at:new Date().toISOString(),cells:switchHandoff?[cell,secondCell]:[cell],status:'completed',method:'fixture',comparison_count:0,notes:[]}
await page.exposeFunction('__fixtureFrame',event=>{if((event.type==='brief'||event.type==='complete')&&event.result.context_id)studies.set(event.result.profile,event.result)})
await page.exposeFunction('__fixtureRequest',async (route,body,method)=>{
 const url=new URL(route,'https://fixture.invalid'),path=url.pathname
 let data
 if(path==='/api/session')data=localSession({modelConfigured:true})
 else if(path==='/api/projects'&&method==='POST'){createdInput=JSON.parse(body);created={id:createdInput.input.project_id,name:createdInput.name,input:createdInput.input,context_version:0,runs:[]};data=created}
 else if(path==='/api/projects')data=created?[created]:[]
 else if(created&&path==='/api/projects/'+created.id)data=created
 else if(created&&path==='/api/projects/'+created.id+'/knowledge/pipeline')data={documents:[],cards:[],policies:[],skills:[],public_sources:[]}
 else if(created&&path.startsWith('/api/projects/'+created.id+'/'))data=[]
 else if(path==='/api/maps/geometry/wgs84'){conversionCalls++;converted.coordinates=JSON.parse(body).geometry.coordinates.map(r=>r.map(([x,y])=>[x-.005,y-.003]));data={geometry:converted,coordinate_encoding:'WGS84'}}
 else if(path.startsWith('/api/maps/screening/analysis/')){studyReads++;data=studies.get(url.searchParams.get('profile'))||null}
 else if(path==='/api/maps/config')data={provider:'amap',configured:true,js_key:'TEST_ONLY',revision:'ui-fixture',service_path:'/_AMapService',sdk_version:'2.0'}
 else if(path==='/api/maps/screening/scan'){
   scanCalls++;requestedBounds=JSON.parse(body).bounds;requestedGeometry=JSON.parse(body).geometry
   const frames=[{type:'start',id:scan.id,cells:scan.cells.map(c=>({...c,context:null,tier:'pending'}))},...scan.cells.map((c,i)=>({type:'cell',cell:c,completed:i+1,total:scan.cells.length})),{type:'complete',result:scan}].map(x=>JSON.stringify(x)+'\n')
   return {contentType:'application/x-ndjson',...(scanRace?{frames,delays:[180,4500,180]}:{body:frames.join('')})}
 }
 else if(path==='/api/maps/screening/context'){
   contextCalls++;const selected=JSON.parse(body).target
   if(areaSelection){areaTarget=selected;return {contentType:'application/json',body:JSON.stringify({...ctx,target:selected,address:null})}}
   if(switchHandoff&&selected.longitude===secondCell.context.target.longitude){secondContextFinished=true;data={...secondCell.context,address:'第二街区'}}
   else{if(earlyCreate)await contextBarrier;contextFinished=true;if(handoffCase.endsWith('failed'))return {status:503,contentType:'application/json',body:JSON.stringify({detail:'FIXTURE_CONTEXT_FAILURE'})};data={...ctx,...(pointHandoff?{target:selected}:{}),address:'示例街区'}}
 }
 else if(path==='/api/maps/screening/analysis'){
   modelCalls++
   const result={context_id:ctx.id,profile:JSON.parse(body).profile,status:'completed',assessment:{summary:'从楼宇机电更新切入，按单栋分期交付。',opportunities:[{text:'组合提供电力改造与后续维保。',evidence_refs:['PUBLIC-FIXTURE']}],cautions:[],unknowns:[],next_steps:['编制分栋工程量与不停业施工方案，核对采购窗口。'],factors:[]},model_calls:[],reason:null,created_at:new Date().toISOString(),research_sources:[{id:'PUBLIC-FIXTURE',title:'公开采购解析样本',url:'https://example.org/fixtures/procurement',data_class:'synthetic',visibility:'public',synthetic:true,content_status:'excerpt',published_at:'2026-07-01',untrusted_text:'明确的合成测试样本：两栋楼分期更新供配电系统，测试预算为120万元。'}],research_records:[{id:'REC-TEST',adapter:'procurement',subject:'合成测试采购',scope:'object',period:'2026-07-01',source_id:'PUBLIC-FIXTURE',fields:[{key:'budget',label:'预算',value:120,unit:'万元',raw:'120万元',locator:'fixture'}]}],decision_support:{status:'completed',provider:'qwen_systemone',model:'decision-model-preview',answers:null,dashboard:{policy_version:'opportunity-fit-v2',purpose:'测试方案',model:'decision-model-preview',request_id:'FIXTURE-ONLY',status:'partial',dimensions:[{key:'demand',value:4.2},{key:'supply',value:null},{key:'adaptation',value:3.8},{key:'implementation',value:4.1},{key:'operations',value:3.6},{key:'resources',value:3.7}].map(d=>({...d,confidence:d.value===null?null:.9,basis:d.value===null?'供给资料待调查':'该数字仅用于界面回归测试。',evidence_refs:d.value===null?[]:['PUBLIC-FIXTURE']}))}}}
   // Public-shaped protocol fixture exercises the real project handoff, while
   // PUBLIC-FIXTURE above remains synthetic and must be excluded from it.
   const original='接口契约占位样本：楼栋维护采购，响应截止2026年9月28日17时。',raw_hash=createHash('sha256').update(original).digest('hex')
   result.research_sources.push({id:'HANDOFF-PUBLIC',title:'接口契约占位样本',url:'https://example.org/fixtures/handoff',data_class:'public',visibility:'public',synthetic:false,content_status:'full_text',untrusted_text:original,raw_hash,records_truncated:false})
   result.research_records.push({id:'HANDOFF-RECORD',adapter:'procurement',subject:'楼栋维护采购',scope:'object',period:'2026-09-28',source_id:'HANDOFF-PUBLIC',source_hash:raw_hash,fields:[{key:'deadline_resolved',label:'响应截止',value:'2026年9月28日17时',unit:'',raw:'2026年9月28日17时',locator:'fixture:deadline'}]})
   return {contentType:'application/x-ndjson',frames:[{type:'progress',stage:'search',status:'running',message:'检索官方采购与工程记录'},{type:'progress',stage:'fetch',status:'completed',message:'已读取公开采购解析样本'},{type:'brief',result:{...result,status:'partial',decision_support:undefined,reason:'简报已完成，评分尚未完成。'}},{type:'progress',stage:'brief',status:'completed',message:result.assessment.summary},{type:'progress',stage:'decision',status:'running',message:'评估六维方案适配'},{type:'complete',result}].map(x=>JSON.stringify(x)+'\n')}
 }
 else throw Error('Unexpected fixture request '+path)
 return {contentType:'application/json',body:JSON.stringify(data)}
})
try{
 const built=await build({entryPoints:['apps/workspace/src/main.tsx'],bundle:true,write:false,outfile:'map-ui.js',format:'iife',platform:'browser',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'synthetic-amap',setup(b){b.onResolve({filter:/^@amap\/amap-jsapi-loader$/},()=>({path:'sdk',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:sdk,loader:'js'}))}}]})
 const css=built.outputFiles.find(f=>f.path.endsWith('.css')).text;const js=built.outputFiles.find(f=>f.path.endsWith('.js')).text
 if(testOrigin!=='about:blank'){await page.route(testOrigin,route=>route.fulfill({contentType:'text/html',body:'<html><body></body></html>'}));await page.goto(testOrigin)}
 await page.setContent('<html lang="zh-CN"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style></head><body><div id="root"></div></body></html>')
 await page.evaluate(()=>{if(location.href==='about:blank'){const data=new Map();Object.defineProperty(window,'localStorage',{value:{getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,String(v)),removeItem:k=>data.delete(k)}})}if(!crypto.randomUUID)Object.defineProperty(crypto,'randomUUID',{value:()=> '00000000-0000-4000-8000-000000000099'});window.fetch=async(input,options={})=>{if(options.signal?.aborted)throw new DOMException('Aborted','AbortError');const response=await window.__fixtureRequest(new URL(String(input),'https://fixture.invalid').pathname+new URL(String(input),'https://fixture.invalid').search,options.body,options.method||'GET');
 if(response.frames){let ended=false;const stream=new ReadableStream({async start(c){const abort=()=>{if(!ended){ended=true;c.error(new DOMException('Aborted','AbortError'))}};options.signal?.addEventListener('abort',abort,{once:true});for(const [index,frame] of response.frames.entries()){if(ended)break;await window.__fixtureFrame(JSON.parse(frame));c.enqueue(new TextEncoder().encode(frame));await new Promise(r=>setTimeout(r,response.delays?.[index]??180))}if(!ended){ended=true;c.close()}options.signal?.removeEventListener('abort',abort)},cancel(){ended=true}});return new Response(stream,{status:200,headers:{'content-type':response.contentType}})}
 return new Response(response.body,{status:response.status||200,headers:{'content-type':response.contentType}})}})
 await page.addScriptTag({content:js});await page.locator('[data-map-status="ready"]').waitFor();await page.getByLabel('地图研究方向').selectOption('balanced')
 assert.equal(modelCalls,0);assert.equal(contextCalls,0)
 if(areaSelection){
   await page.keyboard.press('r');await page.getByRole('region',{name:'区域框选画布'}).waitFor()
   await page.mouse.move(400,300);await page.mouse.down();await page.mouse.move(700,550,{steps:4});await page.mouse.up()
   assert.equal(contextCalls,0);assert.equal(modelCalls,0)
   await page.screenshot({path:'output/playwright/desktop-area-draft.png'})
   await page.keyboard.press('Enter');await page.getByText('已固定框选范围',{exact:true}).waitFor()
   assert.equal(contextCalls,1);assert.equal(areaTarget.kind,'cell');assert.equal(areaTarget.boundary_source,'user:rectangle');assert.equal(areaTarget.geometry.coordinates[0].length,5);assert.equal(modelCalls,0)
   await page.getByRole('button',{name:'一键标色',exact:true}).click();await waitUntil(()=>scanCalls===1)
   assert.deepEqual(requestedBounds,areaTarget.bounds);assert.deepEqual(requestedGeometry,areaTarget.geometry)
   await page.waitForFunction(()=>!document.querySelector('.screening-start').disabled)
   await page.keyboard.press('r');await page.getByRole('region',{name:'区域框选画布'}).waitFor();await page.keyboard.press('Escape')
   assert.equal(await page.getByRole('region',{name:'区域框选画布'}).count(),0);assert.equal(contextCalls,1);assert.equal(modelCalls,0);assert.deepEqual(errors,[])
   await page.screenshot({path:'output/playwright/desktop-area-fixed.png'})
   console.log('PASS desktop rectangle: draft/Enter/frozen bounds/geometry/Esc/no model (13 assertions)')
 } else {
 if(pointHandoff)await page.locator('.atlas-map').click({position:{x:100,y:700}})
 else{await page.getByRole('button',{name:'一键标色',exact:true}).click();if(scanRace)await page.waitForTimeout(250);await page.getByRole('button',{name:'查看沿街建筑群初筛'}).click()}
 if(earlyCreate){
   await waitUntil(()=>contextCalls===1)
   assert.equal(contextFinished,false)
   if(switchHandoff){await page.getByRole('button',{name:'查看第二建筑群初筛'}).click();await waitUntil(()=>secondContextFinished);await page.getByText('办公线索',{exact:true}).waitFor();releaseContext();await waitUntil(()=>contextFinished);await page.waitForTimeout(80)}
   if(handoffCase.startsWith('expanded')){await page.getByRole('button',{name:'查看地点详情',exact:true}).click();await page.locator('.atlas-detail-fields').waitFor()}
   if(!handoffCase.endsWith('pending')){releaseContext();await waitUntil(()=>contextFinished);await page.getByText(handoffCase.endsWith('failed')?'FIXTURE_CONTEXT_FAILURE':'办公线索',{exact:true}).waitFor({state:'attached'})}
   await page.getByRole('button',{name:'建立项目',exact:true}).click()
   await page.locator('#project-name').fill('即时建项目回归')
   await page.locator('#region-name').fill('公开测试街区')
   await page.locator('.modal button[type="submit"]').click()
   await page.getByRole('dialog').waitFor({state:'hidden',timeout:5000})
   if(pointHandoff){
     assert.equal(createdInput.input.scope.geometry,null);assert.equal(createdInput.input.scope.boundary_source,undefined);assert.equal(conversionCalls,0);assert.ok(createdInput.input.scope.map_anchor)
   }else{
     const expected={type:'Polygon',coordinates:expectedGeometry.coordinates.map(r=>r.map(([x,y])=>[x-.005,y-.003]))}
     assert.deepEqual(createdInput.input.scope.geometry,expected);assert.equal(createdInput.input.scope.geometry.coordinates.length,2)
     assert.equal(createdInput.input.scope.boundary_source,switchHandoff?'fixture:survey:B':'fixture:survey');assert.equal(conversionCalls,1)
   }
   assert.equal(modelCalls,0);assert.deepEqual(errors,[])
   await mkdir('output/playwright',{recursive:true});await writeFile('output/playwright/handoff-'+handoffCase+'.json',JSON.stringify({handoffCase,createdInput,contextFinished,modelCalls,conversionCalls,errors},null,2))
   console.log('PASS project geometry handoff: '+handoffCase+' (6 assertions)')
 }else{
 await page.getByText('办公线索',{exact:true}).waitFor()
 assert.equal(modelCalls,0);assert.equal(contextCalls,0);assert.equal(scanCalls,1);assert.deepEqual(requestedBounds,bounds)
 assert.equal(await page.getByRole('button',{name:'查看依据',exact:true}).getAttribute('aria-expanded'),'false')
 await mkdir('output/playwright',{recursive:true})
 await page.screenshot({path:'output/playwright/minimal-map-selected.png'})
 await page.getByRole('button',{name:'研判此处',exact:true}).click()
 await page.getByText('检索官方采购与工程记录',{exact:true}).first().waitFor()
 await page.locator('.research-wait-row .waiting-motif').waitFor()
 await page.screenshot({path:'output/playwright/minimal-map-progress.png'})
 await page.locator('.decision-dashboard').waitFor()
 await page.getByText('从楼宇机电更新切入，按单栋分期交付。',{exact:true}).first().waitFor()
 assert.equal(await page.locator('.dimension-readout button').count(),6)
 assert.equal(await page.locator('.dimension-readout strong').filter({hasText:'—'}).count(),1)
 assert.equal(modelCalls,1)
 if(scanRace){
   if(cancelScan)await page.locator('.screening-progress button').click()
   await page.waitForFunction(()=>!document.querySelector('.screening-start').disabled)
   assert.equal(await page.locator('.screen-grid-label').evaluate(el=>getComputedStyle(el).borderColor),'rgb(100, 136, 153)','Late scan must retain the newer study color')
   assert.equal(await page.locator('.screening-tier').innerText(),'按项推进')
   assert.equal(await page.locator('.decision-dashboard').count(),1)
   assert.equal(modelCalls,1)
   console.log(`PASS ${cancelScan?'cancelled':'late'} scan cannot overwrite the newer study: 4 checks`)
 }else{
 await page.getByLabel('地图标色专题').selectOption('operations')
 assert.equal(modelCalls,1);assert.equal(scanCalls,1)
 await page.screenshot({path:'output/playwright/minimal-map-assessed.png'})
 await page.getByRole('button',{name:'查看依据',exact:true}).click();await page.getByText('120 万元',{exact:true}).waitFor();await page.getByText('地图线索',{exact:true}).click();await page.getByText('核查入驻企业、实际到岗和楼宇空置。',{exact:true}).waitFor()
 await page.getByRole('button',{name:'查看依据',exact:true}).click()
 await page.setViewportSize({width:390,height:844})
 await page.waitForTimeout(80)
 const mobileTitle=await page.locator('.atlas-inspector h2').boundingBox();const mobilePanel=await page.locator('.atlas-inspector').boundingBox()
 assert.ok(mobileTitle.y>=mobilePanel.y&&mobileTitle.y+mobileTitle.height<=mobilePanel.y+mobilePanel.height)
 assert.equal(await page.locator('.atlas-inspector h2').evaluate(el=>{const r=el.getBoundingClientRect();return !!document.elementFromPoint(r.x+5,r.y+5)?.closest('.atlas-inspector')}),true)
 await page.screenshot({path:'output/playwright/minimal-map-mobile.png'})
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
 await page.setViewportSize({width:1440,height:960})
 await page.emulateMedia({reducedMotion:'reduce'})
 await page.getByLabel('初判研究方向').selectOption('commercial')
 assert.equal(await page.locator('.decision-dashboard').count(),0)
 await page.getByRole('button',{name:'研判此处',exact:true}).click()
 await page.getByText('检索官方采购与工程记录',{exact:true}).first().waitFor()
 assert.equal(await page.locator('.research-current>i').evaluate(el=>getComputedStyle(el).animationName),'none')
 assert.equal(await page.locator('.research-wait-row .waiting-route-cursor').evaluate(el=>getComputedStyle(el).animationName),'none')
 await page.getByRole('button',{name:'停止',exact:true}).click()
 await page.waitForTimeout(1100)
 assert.equal(await page.locator('.decision-dashboard').count(),0)
 assert.equal(modelCalls,2);assert.equal(scanCalls,1)
 await page.getByLabel('初判研究方向').selectOption('balanced')
 await page.locator('.decision-dashboard').waitFor()
 assert.equal(modelCalls,2)
 await page.getByLabel('地图标色专题').selectOption('operations')
 assert.equal(await page.locator('.screening-tier').innerText(),'优先研究')
 await page.getByLabel('初判研究方向').selectOption('commercial')
 await page.getByRole('button',{name:'研判此处',exact:true}).click()
 await page.locator('.assessment-narrative').waitFor()
 await page.getByText('评估六维方案适配',{exact:true}).first().waitFor()
 await page.getByRole('button',{name:'停止',exact:true}).click()
 await page.waitForTimeout(1000)
 assert.equal(await page.locator('.assessment-narrative').count(),1)
 assert.equal(await page.locator('.decision-dashboard').count(),0)
 await page.getByRole('button',{name:'重试评分',exact:true}).click()
 await page.locator('.decision-dashboard').waitFor()
 assert.equal(modelCalls,4)
 // The server revoked/expired the former result. A browser memo must not bypass
 // that authoritative read when the user returns to the same research profile.
 studies.delete('balanced')
 const readsBefore=studyReads
 await page.getByLabel('初判研究方向').selectOption('balanced')
 await page.waitForTimeout(120)
 assert.ok(studyReads>readsBefore,'Profile re-entry must revalidate the saved study')
 assert.equal(await page.locator('.decision-dashboard').count(),0)
 assert.equal(await page.locator('.screening-tier').innerText(),'待研判')
 assert.equal(modelCalls,4)
 await page.getByLabel('初判研究方向').selectOption('commercial')
 await page.locator('.decision-dashboard').waitFor()
 studies.set('balanced',{...studies.get('commercial'),profile:'balanced',status:'partial',refresh_required:true,decision_support:undefined,reason:'此前简报的依据已变化，需重新取证后研判。'})
 await page.getByLabel('初判研究方向').selectOption('balanced')
 await page.getByRole('button',{name:'重新取证',exact:true}).waitFor()
 assert.equal(await page.getByText('此前简报 · 依据已变化',{exact:true}).count(),1)
 assert.equal(await page.locator('.decision-dashboard').count(),0)
 assert.equal(modelCalls,4)
 await page.getByRole('button',{name:'重新取证',exact:true}).click()
 await page.locator('.decision-dashboard').waitFor()
 assert.equal(modelCalls,5)
 assert.equal(await page.getByText('此前简报 · 依据已变化',{exact:true}).count(),0)
 await page.getByRole('button',{name:'建立项目',exact:true}).click()
 await page.locator('#project-name').fill('明确的界面回归项目')
 await page.locator('#region-name').fill('公开测试街区')
 await page.locator('.modal button[type="submit"]').click()
 await page.getByRole('dialog').waitFor({state:'hidden',timeout:5000})
 assert.deepEqual(createdInput.input.scope.geometry,converted)
 assert.equal(createdInput.input.scope.coordinate_encoding,'WGS84')
 assert.ok(createdInput.input.scope.boundary_source)
 assert.deepEqual(created.input.scope.geometry,converted)
 const publicSource=createdInput.input.sources.find(s=>s.id==='HANDOFF-PUBLIC')
 assert.equal(publicSource.public_records[0].fields[0].value,'2026年9月28日17时')
 assert.equal(publicSource.public_records[0].source_hash,publicSource.raw_hash)
 assert.ok(!createdInput.input.sources.some(s=>s.id==='PUBLIC-FIXTURE'))
 assert.deepEqual(errors,[])
 await writeFile('output/playwright/minimal-map-check.json',JSON.stringify({passed:true,modelCalls,scanCalls,contextCalls,fixture:true,checks:['no eager calls','polygon selection','collapsed evidence','explicit analysis','theme cache reuse','source expansion','mobile overflow','mobile title visible','map markers below inspector','no page errors','actual viewport','real progress frames','research motif during long wait','six dimension dashboard','missing dimension stays blank','adapter fields with units','profile isolation','reduced motion','reduced motion for research motif','cancel without late result','profile cache restores parent map','brief survives scoring cancellation','scoring retry stays available','polygon handed off as WGS84','project retains converted geometry','boundary provenance retained','profile cache revalidated by server','expired dashboard removed','expired parent color removed','historical partial explicitly labelled','refresh uses a distinct action','historical data never auto launches a model','successful refresh replaces the historical state','public record cutoff handed to project','record raw hash retained','synthetic source excluded from project']},null,2))
 console.log('PASS map UI: 36 checks including research waiting motion, historical refresh, polygon and structured evidence handoff; synthetic provider fixtures')
 }
}
 }
}catch(error){await page.screenshot({path:'output/playwright/minimal-map-failure.png'}).catch(()=>{});console.error(JSON.stringify({created:!!created,createdInput,errorText:await page.locator('body').innerText(),errors},null,2));throw error}finally{releaseContext();await browser.close()}

if(!earlyCreate&&!scanRace&&!areaSelection){
 for(const mode of ['HZZ_UI_SCAN_RACE','HZZ_UI_SCAN_CANCEL']){const child=await promisify(execFile)(process.execPath,['tests/browser/map-workspace.mjs'],{env:{...process.env,[mode]:'1'},timeout:90000});process.stdout.write(child.stdout)}
 for(const mode of ['normal-pending','normal-ready','normal-failed','expanded-pending','expanded-ready','expanded-failed','expanded-switch','point-ready']){const child=await promisify(execFile)(process.execPath,['tests/browser/map-workspace.mjs'],{env:{...process.env,HZZ_UI_HANDOFF:mode},timeout:90000});process.stdout.write(child.stdout)}
}
