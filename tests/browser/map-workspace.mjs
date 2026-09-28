// Full application UI regression using explicit synthetic provider fixtures.
// Offline browser render: node tests/browser/map-workspace.mjs (no service or keys).
import { chromium } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox']})
const page=await browser.newPage({viewport:{width:1440,height:960},deviceScaleFactor:1})
const errors=[];page.on('pageerror',e=>errors.push(String(e)))
let modelCalls=0,scanCalls=0,contextCalls=0
const sdk=`const no=()=>{};const point=p=>({getLng:()=>p[0],getLat:()=>p[1]});
class Base{constructor(o={}){this.o=o;this.handlers={}}on(n,f){this.handlers[n]=f}setMap(m){if(!m)this.el?.remove()}show(){}hide(){}}
const xy=p=>[(p[0]-120.144)/.019*1440,(30.295-p[1])/.016*960];
class Marker extends Base{mount(map){this.el=document.createElement('div');this.el.style.cssText='position:absolute;z-index:8;transform:translate(-50%,-50%)';const [x,y]=xy(this.o.position);this.el.style.left=x/1440*100+'%';this.el.style.top=y/960*100+'%';if(this.o.content instanceof Node)this.el.append(this.o.content);map.el.append(this.el)}}
class Polygon extends Base{mount(map){const el=document.createElementNS('http://www.w3.org/2000/svg','path');const rings=typeof this.o.path[0][0]==='number'?[this.o.path]:this.o.path;el.setAttribute('d',rings.map(r=>'M'+r.map(p=>xy(p).join(',')).join('L')+'Z').join(''));el.setAttribute('fill',this.o.fillColor||'#a0b5c1');el.setAttribute('fill-opacity',this.o.fillOpacity||.25);el.setAttribute('stroke',this.o.strokeColor||'#638ca7');el.setAttribute('stroke-width','2');el.setAttribute('fill-rule','evenodd');el.style.cursor='pointer';el.addEventListener('click',e=>{e.stopPropagation();this.handlers.click?.(e)});map.svg.append(el);this.el=el}}
class Map extends Base{constructor(el,o){super(o);this.el=el;this.svg=document.createElementNS('http://www.w3.org/2000/svg','svg');this.svg.setAttribute('viewBox','0 0 1440 960');this.svg.setAttribute('preserveAspectRatio','none');this.svg.style.cssText='position:absolute;inset:0;width:100%;height:100%;background:#eef1ed';this.svg.innerHTML='<defs><pattern id="b" width="118" height="97" patternTransform="rotate(-9)" patternUnits="userSpaceOnUse"><rect x="15" y="14" width="32" height="58" rx="2" fill="#d8dfdc"/><rect x="58" y="14" width="43" height="23" rx="2" fill="#dee3df"/><rect x="58" y="47" width="43" height="25" rx="2" fill="#d8dfdc"/></pattern></defs><rect width="1440" height="960" fill="url(#b)"/><path d="M 1080 -100 Q 650 250 900 590 T 720 1050" stroke="#c1d9e1" stroke-width="85" fill="none"/><path d="M-20 230L1500 460 M0 690L1500 640 M460 -100L590 1050 M1010 0L900 960" stroke="#fff" stroke-width="25" fill="none"/><path d="M-20 230L1500 460 M0 690L1500 640 M460 -100L590 1050 M1010 0L900 960" stroke="#d5d7ca" stroke-width="2" fill="none"/><text x="720" y="918" fill="#71808c" font-size="14">交互测试样本 · 非真实地块</text>';el.append(this.svg);setTimeout(()=>this.handlers.complete?.(),100)}
add(items){for(const item of Array.isArray(items)?items:[items])item.mount?.(this)}remove(items){for(const item of Array.isArray(items)?items:[items])item.el?.remove()}destroy(){this.el.innerHTML=''}addControl(){}getLayers(){return []}getZoom(){return 17.2}getPitch(){return 55}getRotation(){return 0}getCenter(){return point([120.153576,30.287459])}getBounds(){return {getSouthWest:()=>point([120.145,30.281]),getNorthEast:()=>point([120.162,30.294])}}setZoomAndCenter(){}setFitView(){}setRotation(){}setPitch(){}zoomIn(){}zoomOut(){}}
export default {reset:no,load:async()=>({Map,Marker,Polygon,Scale:Base,TileLayer:{Satellite:Base},PlaceSearch:Base,Geocoder:Base,Pixel:Base})};`

const bounds={west:120.145,east:120.162,south:30.281,north:30.294}
const ring=[[120.15,30.292],[120.154,30.2916],[120.1553,30.2878],[120.1511,30.2873],[120.15,30.292]]
const ctx={id:'MAPCTX-00000000-0000-4000-8000-000000000001',target:{kind:'cell',bounds,geometry:{type:'Polygon',coordinates:[ring]},longitude:120.1525,latitude:30.2895,radius_m:null},provider:'amap',coordinate_encoding:'GCJ-02',created_at:new Date().toISOString(),expires_at:new Date(Date.now()+600000).toISOString(),address:'示例街区',city:null,groups:[{key:'work_live',source_id:'office',label:'办公与居住',status:'available',reported_count:120,sample:[{id:'p1',name:'科创商务楼',category:'商务住宅;商务写字楼',longitude:120.152,latitude:30.289}],retrieved_at:new Date().toISOString(),types_query:'120000',issue:null},{key:'activity',source_id:'retail',label:'商业配套',status:'available',reported_count:99,sample:[{id:'p2',name:'沿街餐饮与社区商业',category:'餐饮服务',longitude:120.152,latitude:30.289}],retrieved_at:new Date().toISOString(),types_query:'050000',issue:null}],local_projects:[],project_revision:'fixture-v1',status:'complete',gaps:[],metric_note:'fixture'}
const cell={id:'R-fixture',label:'沿街建筑群',bounds,geometry:ctx.target.geometry,anchor:[120.1525,30.2895],boundary_source:'fixture:survey',context:ctx,metric_value:null,rank:null,tier:'incomplete',factors:[]}
const scan={id:'MAPSCAN-fixture',bounds,profile:'balanced',theme:'overall',created_at:new Date().toISOString(),cells:[cell],status:'completed',method:'fixture',comparison_count:0,notes:[]}
await page.exposeFunction('__fixtureRequest',async path=>{
 let data
 if(path==='/api/session')data={model_configured:true}
 else if(path==='/api/projects')data=[]
 else if(path==='/api/maps/config')data={provider:'amap',configured:true,js_key:'TEST_ONLY',revision:'ui-fixture',service_path:'/_AMapService',sdk_version:'2.0'}
 else if(path==='/api/maps/screening/scan'){scanCalls++;return {contentType:'application/x-ndjson',body:[{type:'start',id:scan.id,cells:[{...cell,context:null,tier:'pending'}]},{type:'cell',cell,completed:1,total:1},{type:'complete',result:scan}].map(x=>JSON.stringify(x)).join('\n')}}
 else if(path==='/api/maps/screening/context'){contextCalls++;data=ctx}
 else if(path==='/api/maps/screening/analysis'){modelCalls++;data={context_id:ctx.id,profile:'balanced',status:'completed',assessment:{summary:'优先研究面向工作日客群的存量空间改造。',opportunities:[{text:'从小体量餐饮与企业服务切入。',evidence_refs:['office']}],cautions:[{text:'先核查实际到岗与同类空铺。',evidence_refs:['retail']}],unknowns:[],next_steps:['访谈楼宇运营方，核实稳定使用人群。'],factors:[]},model_calls:[],reason:null,created_at:new Date().toISOString()}}
 else throw Error('Unexpected fixture request '+path)
 return {contentType:'application/json',body:JSON.stringify(data)}
})
try{
 const built=await build({entryPoints:['apps/workspace/src/main.tsx'],bundle:true,write:false,outfile:'map-ui.js',format:'iife',platform:'browser',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'synthetic-amap',setup(b){b.onResolve({filter:/^@amap\/amap-jsapi-loader$/},()=>({path:'sdk',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:sdk,loader:'js'}))}}]})
 const css=built.outputFiles.find(f=>f.path.endsWith('.css')).text;const js=built.outputFiles.find(f=>f.path.endsWith('.js')).text
 await page.setContent('<html lang="zh-CN"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style></head><body><div id="root"></div></body></html>')
 await page.evaluate(()=>{window.fetch=async(input,options={})=>{if(options.signal?.aborted)throw new DOMException('Aborted','AbortError');const response=await window.__fixtureRequest(new URL(String(input),'https://fixture.invalid').pathname);return new Response(response.body,{status:200,headers:{'content-type':response.contentType}})}})
 await page.addScriptTag({content:js});await page.locator('[data-map-status="ready"]').waitFor()
 assert.equal(modelCalls,0);assert.equal(contextCalls,0)
 await page.getByRole('button',{name:'一键标色',exact:true}).click()
 await page.getByRole('button',{name:'查看沿街建筑群初筛'}).click()
 await page.getByText('办公线索',{exact:true}).waitFor()
 assert.equal(modelCalls,0);assert.equal(contextCalls,0);assert.equal(scanCalls,1)
 assert.equal(await page.getByRole('button',{name:'查看依据',exact:true}).getAttribute('aria-expanded'),'false')
 await mkdir('output/playwright',{recursive:true})
 await page.screenshot({path:'output/playwright/minimal-map-selected.png'})
 await page.getByRole('button',{name:'研判此处',exact:true}).click()
 await page.getByText('优先研究面向工作日客群的存量空间改造。',{exact:true}).waitFor()
 assert.equal(modelCalls,1)
 await page.getByLabel('地图标色专题').selectOption('operations')
 assert.equal(modelCalls,1);assert.equal(scanCalls,1)
 await page.screenshot({path:'output/playwright/minimal-map-assessed.png'})
 await page.getByRole('button',{name:'查看依据',exact:true}).click();await page.getByText('核查入驻企业、实际到岗和楼宇空置。',{exact:true}).waitFor()
 await page.getByRole('button',{name:'查看依据',exact:true}).click()
 await page.setViewportSize({width:390,height:844})
 await page.screenshot({path:'output/playwright/minimal-map-mobile.png'})
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
 assert.deepEqual(errors,[])
 await writeFile('output/playwright/minimal-map-check.json',JSON.stringify({passed:true,modelCalls,scanCalls,contextCalls,fixture:true,checks:['no eager calls','polygon selection','collapsed evidence','explicit analysis','theme cache reuse','source expansion','mobile overflow','no page errors']},null,2))
 console.log('PASS map UI: 8 checks; model=1, scan=1, context=0; synthetic provider fixtures')
}finally{await browser.close()}
