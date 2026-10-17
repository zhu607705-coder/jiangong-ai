import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { parseHTML } from 'linkedom'
import { beforeEach, afterEach, expect, test, vi } from 'vitest'
import fixture from '../../fixtures/inputs/01_auto.json'
import type { Project } from '../../apps/workspace/src/api'
import type { StrategyPacket } from '../../packages/retrofit/strategy'
import type { ResearchRound } from '../../packages/retrofit/research-rounds'
const locationMap=vi.hoisted(()=>({render:vi.fn()}))
vi.mock('../../apps/workspace/src/components/ProjectLocationMap',async()=>{
  const {createElement}=await import('react')
  return {default:({project}:{project:Project})=>{
    locationMap.render(project)
    return createElement('div',{'data-project-location-id':project.id,'data-map-anchor':JSON.stringify(project.input.scope.map_anchor??null)})
  }}
})
import ProjectOverview, { projectOverviewState, type ProjectOverviewProps } from '../../apps/workspace/src/components/ProjectOverview'

let root:Root,container:HTMLElement
const onNavigate=vi.fn(),onEvidence=vi.fn()
function project():Project {
  const input={...structuredClone(fixture),project_id:'P-OVERVIEW',synthetic:false,business_profile:'neighborhood',as_of:'2026-10-15',facts:[],sources:[{id:'SOURCE',title:'本对象原文',data_class:'public',visibility:'public',synthetic:false,published_at:'2026-10-01',untrusted_text:'本小区有供水改善和居民安排的原文记录。',hash:'source-version',locator:'line:8'}]} as Project['input']
  return {id:input.project_id,name:'当前研究对象',context_version:4,input}
}
function packet():StrategyPacket {
  return {project_id:'P-OVERVIEW',context_version:4,input_hash:'saved-v4',created_at:'2026-10-15T08:00:00Z',synthetic:false,status:'completed',error:null,model_calls:[],research:null,decision:null,
    sources:[{id:'SOURCE',title:'本对象原文',text:'本小区有供水改善和居民安排的原文记录。',url:null,published_at:'2026-10-01',role:'current',locator:'line:8'}],
    strategy:{headline:'模型原始标题：以四幢供水改善为优先研究对象',summary:'保留模型根据本对象资料生成的具体理由。',preferred_mode:'comprehensive',
      decision_brief:{renewal:{conclusion:'优先研究四幢供水改善与居民停水安排',reason:'四幢供水范围有对象原文，先核查管线和维护责任。',evidence_refs:['SOURCE']},investment:{conclusion:'先投入四幢管线核查与居民协商。',reason:'分项范围已有记录，施工与资金尚待核对。',stage:'preliminary',evidence_refs:['SOURCE']},returns:{financial:'核对分项建设与持续维护费用。',social:'改善供水可靠性并安排施工影响。',evidence_refs:['SOURCE']}},
      rationale:[{point:'供水对象有具体原文。',source_id:'SOURCE',quote:'本小区有供水改善和居民安排的原文记录。'}],
      paths:(['comprehensive','rebuild'] as const).map(mode=>({mode,title:mode,description:'按对象核查实施条件。',actions:[],requirements:[]})),
      dimensions:(['demand','supply','adaptation','implementation','operations','resources'] as const).map(key=>({key,current:'已有研究线索。',current_level:'unknown',comprehensive:'改善目标待核。',comprehensive_level:'medium',rebuild:'更新目标待核。',rebuild_level:'unknown',evidence_refs:['SOURCE']})),
      next_checks:[{title:'核查四幢管线',detail:'确认计量、维护与施工范围。',evidence_refs:['SOURCE']},{title:'核实居民安排',detail:'核对施工组织与停水安排。',evidence_refs:['SOURCE']},{title:'核实资金来源',detail:'登记预算阶段和承担主体。',evidence_refs:['SOURCE']},{title:'第四项详细调查',detail:'在调查工作页查看。',evidence_refs:['SOURCE']}],}}
}
function round(result=packet()):ResearchRound {
  return {id:'ROUND-1',project_id:result.project_id,round_number:1,context_version:result.context_version,input_hash:result.input_hash,parent_round_id:null,parent_input_hash:null,parent_context_version:null,first_round_id:'ROUND-1',first_input_hash:result.input_hash,first_context_version:result.context_version,origin:'generated',status:'completed',material_intake:'none',allow_internal_ai:false,materials:[],missing_materials:[],result,error:null,created_at:result.created_at,updated_at:result.created_at}
}
beforeEach(()=>{
  const {window}=parseHTML('<html><body><div id="root"></div></body></html>')
  vi.stubGlobal('window',window);vi.stubGlobal('document',window.document);vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true)
  vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new Error('Overview must not fetch or run models')))
  container=window.document.getElementById('root') as unknown as HTMLElement;root=createRoot(container)
  onNavigate.mockReset();onEvidence.mockReset();locationMap.render.mockReset()
})
afterEach(async()=>{await act(async()=>root.unmount());expect(fetch).not.toHaveBeenCalled();vi.unstubAllGlobals()})
async function render(overrides:Partial<ProjectOverviewProps>={}) {await act(async()=>root.render(createElement(ProjectOverview,{project:project(),currentStrategyPacket:packet(),currentDirection:'rebuild',onNavigate,onEvidence,...overrides})))}
async function click(text:string) {const button=[...container.querySelectorAll('button')].find(button=>button.textContent?.includes(text));expect(button).toBeTruthy();await act(async()=>button!.click())}

test('keeps the actual API recommendation independent from the user direction and opens evidence without navigating',async()=>{
  const p=project(),result=packet(),frozen=JSON.stringify({p,result})
  await render({project:p,currentStrategyPacket:result})
  expect(container.querySelector('#project-overview-recommendation')?.textContent).toBe(result.strategy?.decision_brief?.renewal.conclusion)
  expect(container.querySelector('.project-overview-directions')?.textContent).toContain('系统建议：先核查')
  expect(container.querySelector('.project-overview-directions')?.textContent).toContain('当前工作方向：原拆原建')
  expect(container.querySelectorAll('.project-overview-investigations li')).toHaveLength(3)
  expect(container.querySelector('.project-overview-result-meta')?.textContent).toContain('资料 v4')
  expect(container.querySelector('.project-overview-work')).not.toBeNull()
  expect(container.querySelector('[data-project-location-id]')?.getAttribute('data-project-location-id')).toBe(p.id)
  expect(locationMap.render.mock.calls.at(-1)?.[0]).toBe(p)
  await click('查看判断依据')
  expect(onEvidence).toHaveBeenCalledWith(['SOURCE'],result);expect(onNavigate).not.toHaveBeenCalled()
  await render({project:p,currentStrategyPacket:result,currentDirection:'comprehensive'})
  expect(container.querySelector('#project-overview-recommendation')?.textContent).toBe(result.strategy?.decision_brief?.renewal.conclusion)
  expect(JSON.stringify({p,result})).toBe(frozen);expect(fetch).not.toHaveBeenCalled()
})
test('passes the current GCJ-02 map anchor through to the location map when no object geometry is registered',async()=>{
  const p=project()
  p.input.scope.geometry=null
  p.input.scope.map_anchor={provider:'amap',coordinate_encoding:'GCJ-02',longitude:120.113682,latitude:30.260481,name:'本项目地图锚点',poi_id:'POI-CURRENT',address:'当前对象地址'}
  const frozen=JSON.stringify(p)
  await render({project:p})
  const map=container.querySelector('[data-project-location-id]')
  expect(map?.getAttribute('data-project-location-id')).toBe(p.id)
  expect(JSON.parse(map!.getAttribute('data-map-anchor')!)).toEqual(p.input.scope.map_anchor)
  expect(locationMap.render.mock.calls.at(-1)?.[0]).toBe(p)
  expect(locationMap.render.mock.calls.at(-1)?.[0].input.scope.geometry).toBeNull()
  expect(JSON.stringify(p)).toBe(frozen)
})

test('routes missing conditions, candidate comparison and object location to their actual work pages',async()=>{
  await render();await click('查看关键核查项');expect(onNavigate).toHaveBeenLastCalledWith('actions','current')
  const p=project()
  p.input.facts=(['structure_repairable','funding_secured'] as const).map(kind=>({id:kind,kind,value:true,unit:null,source_id:'SOURCE',object_ref:'project:P-OVERVIEW',locator:'line:8',observed_at:'2026-10-01',epistemic_status:'fact'}))
  await render({project:p})
  expect(container.querySelector('[data-overview-state]')?.getAttribute('data-overview-state')).toBe('candidates')
  await click('比较候选方案');expect(onNavigate).toHaveBeenLastCalledWith('scenarios','compare')
  await click('在地图中定位');expect(onNavigate).toHaveBeenLastCalledWith('map')
})
test('labels a prior-version result and links changed material impacts without passing it off as current',async()=>{
  const historical=packet();historical.context_version=3
  await render({currentStrategyPacket:historical})
  expect(container.querySelector('[data-overview-state]')?.getAttribute('data-overview-state')).toBe('stale')
  expect(container.textContent).toContain('当前资料为 v4，这份建议基于 v3')
  expect(container.querySelector('.project-overview-directions')?.textContent).toContain('上次系统建议')
  await click('查看受影响内容');expect(onNavigate).toHaveBeenLastCalledWith('results','history')
})
test('retains a completed saved round on failure and keeps loading distinct from completion',async()=>{
  await render({currentStrategyPacket:packet(),failed:true,latestSavedRound:round()})
  expect(container.querySelector('[data-overview-state]')?.getAttribute('data-overview-state')).toBe('failed')
  expect(container.textContent).toContain('本轮未完成，以下保留上次已保存的研究建议')
  expect(container.querySelector('#project-overview-recommendation')?.textContent).toContain('四幢供水')
  expect(container.textContent).not.toContain('raw provider failure')
  await click('查看运行详情');expect(onNavigate).toHaveBeenLastCalledWith('results','runs')
  await render({loading:true})
  expect(container.querySelector('[data-overview-state]')?.getAttribute('data-overview-state')).toBe('loading')
  expect(container.querySelector('.project-overview-status')?.textContent).toContain('正在读取研究状态')
})
test('does not borrow another project or simulation and gives a truthful empty-material entry',async()=>{
  const other={...packet(),project_id:'P-OTHER'},p=project();p.input.sources=[];p.input.scope.geometry=null
  await render({project:p,currentStrategyPacket:other,latestSavedRound:round(other)})
  expect(container.querySelector('#project-overview-recommendation')?.textContent).toBe('先补充本项目的研究资料')
  expect(container.textContent).not.toContain('四幢供水')
  expect(container.querySelector('.project-overview-status')).toBeNull()
  expect(container.querySelector('.project-overview-result-meta')).toBeNull()
  expect(container.querySelector('.project-overview-investigations')).toBeNull()
  expect(container.querySelector('.project-overview-work')).toBeNull()
  expect(container.querySelector('[data-project-location-id]')?.getAttribute('data-project-location-id')).toBe(p.id)
  await click('补充项目资料');expect(onNavigate).toHaveBeenLastCalledWith('evidence','materials')
  const simulated={...packet(),synthetic:true}
  expect(projectOverviewState({project:p,currentStrategyPacket:simulated}).packet).toBeNull()
  const current=packet(),historic={...packet(),context_version:3}
  expect(projectOverviewState({project:project(),currentStrategyPacket:historic,latestSavedRound:round(current)}).packet).toBe(historic)
  expect(projectOverviewState({project:project(),currentStrategyPacket:null,latestSavedRound:round(current)}).packet).toBeNull()
})

test('a failed first study keeps one clear recovery notice and its run-details entry without empty result cards',async()=>{
  const failed={...packet(),status:'failed' as const,strategy:null,error:'raw provider failure'}
  await render({currentStrategyPacket:failed,latestSavedRound:null})
  expect(container.querySelector('[data-overview-state]')?.getAttribute('data-overview-state')).toBe('failed')
  const notices=container.querySelectorAll('.project-overview-notice')
  expect(notices).toHaveLength(1)
  expect(notices[0].textContent).toMatch(/本轮.*(?:未完成|未形成完整结论)/)
  expect(container.textContent).not.toContain('raw provider failure')
  expect(container.querySelector('.project-overview-result-meta')).toBeNull()
  expect(container.querySelector('.project-overview-investigations')).toBeNull()
  expect(container.querySelector('.project-overview-work')).toBeNull()
  expect(container.querySelector('[data-project-location-id]')?.getAttribute('data-project-location-id')).toBe('P-OVERVIEW')
  await click('查看运行详情')
  expect(onNavigate).toHaveBeenLastCalledWith('results','runs')
})
