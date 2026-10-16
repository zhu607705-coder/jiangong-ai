import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import fixture from '../../fixtures/inputs/01_auto.json'
import type { ProjectInput, RenewalStrategy } from '../../apps/host/generated/contracts'
import { config } from '../../apps/host/config'
import { projectDecisionInput } from '../../packages/decision/structured-route'
import { validateStrategy, strategyPromptSources, strategyModelReferences, STRATEGY_PROMPT_SOURCE_CHARS, type StrategySource, type StrategyPacket, type StrategyProgress } from '../../packages/retrofit/strategy'
import { withConcreteWorkPlan, withReasoningDimensions } from './fixtures/strategy-work-plan'
import type { ResearchRoundContext } from '../../apps/host/research-rounds'

const ports=vi.hoisted(()=>({open:vi.fn(),workflow:vi.fn()}))
vi.mock('../../runtime/dsh/live-session',()=>({LiveSession:{open:ports.open}}))
vi.mock('../../runtime/workflows/renewal-research',()=>({runRenewalResearch:ports.workflow}))
import { researchRenewalStrategy } from '../../services/map-screening/renewal-strategy'
const source:StrategySource={id:'OBJECT',title:'本对象供水范围',text:'本小区29、30、31、48幢供水设施已开展方案核查，涉及252户。',url:null,published_at:'2023-08-18',role:'current',locator:'原文第1段'}
function strategy():RenewalStrategy {
  return withConcreteWorkPlan({headline:'更换给水立管并改善计量设施',summary:'针对既有供水设施形成候选改造组合，实施条件分别核查。',preferred_mode:'comprehensive',
    decision_brief:{renewal:{conclusion:'优先研究给水立管和计量设施更新。',reason:'对象原文支持明确供水服务范围。',evidence_refs:[source.id]},investment:{conclusion:'开展前期技术准备，并保留具体建设方案。',reason:'结构和资金条件待核。',stage:'preliminary',evidence_refs:[source.id]},returns:{financial:'分别核对建设与持续维护支出。',social:'改善对象供水可靠性。',evidence_refs:[source.id]}},
    rationale:[{point:'已有明确服务对象。',source_id:source.id,quote:source.text}],
    paths:(['comprehensive','rebuild'] as const).map(mode=>({mode,title:mode==='comprehensive'?'管网与计量更新':'新建给水系统',description:'按对象与设施组织候选方案。',actions:[{title:'形成给水系统更新组合',detail:'结合管网与计量设施安排实施顺序。',evidence_refs:[source.id]}],requirements:['核实技术与资金前提。']})),
    dimensions:(['demand','supply','adaptation','implementation','operations','resources'] as const).map(key=>({key,current:'已有对象资料，专项条件待核。',current_level:'unknown',comprehensive:'按设施更新改善服务。',comprehensive_level:'medium',rebuild:'按新建方案配置设施。',rebuild_level:'medium',evidence_refs:[source.id]})),next_checks:[],
  },source)
}
const check=(value:RenewalStrategy,sources=[source])=>validateStrategy(value,sources,[],true,false,true)
const original={modelConfigured:config.modelConfigured,searchConfigured:config.searchConfigured,decisionEnabled:config.decisionEnabled}
beforeEach(()=>{vi.clearAllMocks();Object.assign(config,{modelConfigured:true,searchConfigured:false,decisionEnabled:false});vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('NO_EXTERNAL_CALLS'))})
afterEach(()=>{Object.assign(config,original);vi.restoreAllMocks()})

it('requires concrete tables only for new research while keeping legacy records and preliminary construction candidates',()=>{
  const legacy=strategy();for(const path of legacy.paths)delete path.work_packages;delete legacy.internal_data_requests
  expect(validateStrategy(legacy,[source],[],true)).toBe(legacy)
  expect(()=>check(legacy)).toThrow('STRATEGY_WORK_PACKAGES_REQUIRED')
  const candidate=strategy(),frozen=JSON.stringify(candidate)
  expect(check(candidate)).toBe(candidate)
  expect(candidate.decision_brief?.investment.stage).toBe('preliminary')
  expect(candidate.paths[0].work_packages?.[0].intervention).toBe('更换老化给水立管')
  expect(JSON.stringify(candidate)).toBe(frozen)
})
it('requires six separate reasoning dimensions only for the workflow and allows explicit inference without retrieved evidence',()=>{
  const legacy=strategy()
  expect(check(legacy)).toBe(legacy)
  expect(()=>validateStrategy(legacy,[source],[],true,false,true,true)).toThrow('STRATEGY_REASONING_DIMENSIONS_REQUIRED')
  const value=withReasoningDimensions(strategy()),before=JSON.stringify(value)
  expect(validateStrategy(value,[source],[],true,false,true,true)).toBe(value)
  expect(value.dimensions.every(row=>row.current_level==='unknown')).toBe(true)
  expect(JSON.stringify(value)).toBe(before)
  value.reasoning_dimensions![1].key=value.reasoning_dimensions![0].key
  expect(()=>check(value)).toThrow('STRATEGY_REASONING_DIMENSIONS_INCOMPLETE')
})
it('requires declared scenario assumptions and scoped reasoning references while preserving construction and mode gates',()=>{
  const value=withReasoningDimensions(strategy()),row=value.reasoning_dimensions![0]
  row.basis='scenario_assumption'
  expect(()=>check(value)).toThrow('STRATEGY_REASONING_ASSUMPTIONS_REQUIRED')
  row.assumptions=['假设居民参与分项服务。'];row.evidence_refs=['OTHER-PROJECT']
  expect(()=>check(value)).toThrow('STRATEGY_SOURCE_MISMATCH')
  row.evidence_refs=[source.id];expect(check(value)).toBe(value)
  value.decision_brief!.investment.stage='construction'
  expect(()=>check(value)).toThrow('STRATEGY_CONSTRUCTION_GATE_UNMET')
  value.decision_brief!.investment.stage='preliminary';value.preferred_mode='rebuild'
  expect(()=>check(value)).toThrow('STRATEGY_REBUILD_GATE_UNMET')
})
it('rejects survey-only pseudo works even when they mention a construction keyword',()=>{
  for(const intervention of ['登记管网问题','开展加装电梯可行性调查','编制更换管网方案','对给水管网开展调查并登记问题']) {
    const value=strategy();value.paths[0].work_packages![0].intervention=intervention
    expect(()=>check(value)).toThrow('STRATEGY_WORK_PACKAGE_TASK_ONLY')
  }
})
it('binds each work package to its actual source locator and a literal continuous quote',()=>{
  let value=strategy();value.paths[0].work_packages![0].quote=source.text.replace('涉及','涉 及')
  expect(()=>check(value)).toThrow('STRATEGY_WORK_PACKAGE_QUOTE_MISMATCH')
  value=strategy();value.paths[0].work_packages![0].locator='另一个段落'
  expect(()=>check(value)).toThrow('STRATEGY_WORK_PACKAGE_LOCATOR_MISMATCH')
  value=strategy();value.paths[0].work_packages![0].source_id='OTHER-PROJECT'
  expect(()=>check(value)).toThrow('STRATEGY_SOURCE_MISMATCH')
  value=strategy();const row=value.paths[0].work_packages![0];row.target_basis='object_source'
  expect(()=>check(value,[{...source,role:'reference'}])).toThrow('STRATEGY_OBJECT_EVIDENCE_MISSING')
  const reference={...source,id:'REFERENCE',role:'reference' as const}
  row.source_id=reference.id;row.evidence_refs=[reference.id]
  expect(()=>check(value,[source,reference])).toThrow('STRATEGY_WORK_PACKAGE_TARGET_SCOPE')
})
it('keeps source quantities, unknowns and explicit scenarios distinct and never transfers a reference project quantity',()=>{
  const value=strategy(),row=value.paths[0].work_packages![0]
  Object.assign(row,{quantity:252,unit:'户',quantity_basis:'source'})
  expect(check(value)).toBe(value)
  row.unit='台';expect(()=>check(value)).toThrow('STRATEGY_WORK_PACKAGE_QUANTITY_MISMATCH')
  Object.assign(row,{quantity:12,unit:'米',quantity_basis:'scenario'})
  // The structured basis already labels the scenario; prose needs no password words.
  expect(check(value)).toBe(value)
  row.quantity=null;expect(()=>check(value)).toThrow('STRATEGY_WORK_PACKAGE_QUANTITY_MISMATCH')
  row.quantity=12;row.unit='';expect(()=>check(value)).toThrow('STRATEGY_WORK_PACKAGE_QUANTITY_MISMATCH')
  row.unit='米';row.target_basis='scenario';row.scope='本小区对象与户数未定，须由社区名册核定后确定改造规模。'
  expect(check(value)).toBe(value)
  const archive:StrategySource={...source,id:'ARCHIVE',title:'浙江另一案例道路排水改造',text:'该案例道路、排水与绿化改造，道路总面积32545平方米。',locator:'案例ZJ-001/改造内容',role:'reference'}
  Object.assign(row,{source_id:archive.id,quote:archive.text,locator:archive.locator,quantity:32545,unit:'㎡',quantity_basis:'source',evidence_refs:[archive.id]})
  expect(()=>check(value,[source,archive])).toThrow('STRATEGY_WORK_PACKAGE_QUANTITY_MISMATCH')
  Object.assign(row,{quantity:null,unit:null,quantity_basis:'unknown'})
  expect(check(value,[source,archive])).toBe(value)
  const addressed=strategy(),addressSource={...source,text:'求是村75幢1单元拟加装电梯，当前为征求意见草案。'}
  addressed.rationale[0].quote=addressSource.text
  for(const path of addressed.paths)for(const work of path.work_packages!)work.quote=addressSource.text
  Object.assign(addressed.paths[0].work_packages![0],{quantity:75,unit:'幢',quantity_basis:'source'})
  expect(()=>check(addressed,[addressSource])).toThrow('STRATEGY_WORK_PACKAGE_QUANTITY_MISMATCH')
  addressSource.text+='本批另有75幢住宅采用同一维修方案。'
  addressed.rationale[0].quote=addressSource.text
  for(const path of addressed.paths)for(const work of path.work_packages!)work.quote=addressSource.text
  expect(check(addressed,[addressSource])).toBe(addressed)
})
it('requires three separate internal-data definitions with usable collection denominators and actual package links',()=>{
  const value=strategy()
  value.internal_data_requests=value.internal_data_requests!.filter(row=>row.key!=='meal_attendance')
  expect(()=>check(value)).toThrow('STRATEGY_INTERNAL_DATA_REQUESTS_REQUIRED')
  let complete=strategy();complete.internal_data_requests![0].denominator=' '
  expect(()=>check(complete)).toThrow('STRATEGY_INTERNAL_DATA_REQUEST_INCOMPLETE')
  complete=strategy();complete.internal_data_requests![0].related_package_ids=['INVENTED-WORK']
  expect(()=>check(complete)).toThrow('STRATEGY_INTERNAL_DATA_PACKAGE_MISMATCH')
  expect(check(strategy()).internal_data_requests?.map(row=>row.key)).toEqual(['resident_wellbeing','elevator_usage','meal_attendance'])
})
it('returns incomplete work packages with a follow-up list and preserves reference scope',async()=>{
  const project={...structuredClone(fixture),business_profile:'neighborhood'} as ProjectInput,input=projectDecisionInput(project)
  input.renewalMode!.evidence=[{source_id:source.id,title:source.title,quote:source.text,url:null,published_at:source.published_at!,locator:source.locator}]
  const incomplete=strategy();for(const path of incomplete.paths)delete path.work_packages;delete incomplete.internal_data_requests
  const completed=strategy(),archive:StrategySource={id:'ARCHIVE-ZJ-003',title:'浙江归档措施参考',text:'该案例道路修复、雨污分流、给水管改造及泵站。',url:null,published_at:'2024-01-01',locator:'ZJ-003/改造内容',role:'reference'}
  const call=vi.fn().mockResolvedValueOnce({value:incomplete}).mockResolvedValueOnce({value:completed})
  ports.open.mockResolvedValue({calls:[],call,close:vi.fn(async()=>{})})
  const result=await researchRenewalStrategy(project,0,input,'v6-fixture',false,new AbortController().signal,null,{referenceSources:[archive]})
  expect(result.status).toBe('completed');expect(call).toHaveBeenCalledTimes(1)
  expect(result.content_review?.issues).toContainEqual(expect.objectContaining({code:'STRATEGY_WORK_PACKAGES_REQUIRED'}))
  expect(call.mock.calls[0][1]).toContain('雨污分流、给水管改造及泵站')
  expect(call.mock.calls[0][1]).toContain('不将这些采集任务代替工程和服务措施')
  expect(result.sources.find(row=>row.id===archive.id)?.role).toBe('reference')
  expect(result.strategy?.paths[0].work_packages).toBeUndefined()
  expect(fetch).not.toHaveBeenCalled()
})
it('reserves a bounded prompt excerpt for concrete archive references without enlarging the existing source budget',()=>{
  const archive={...source,id:'ARCHIVE',role:'reference' as const,text:'给水管改造及泵站。'.repeat(600)}
  const sources=[...Array.from({length:20},(_,i)=>({...source,id:`OBJECT-${i}`,text:source.text.repeat(150)})),archive]
  const selected=strategyPromptSources(sources,[archive.id])
  expect(selected.some(row=>row.id===archive.id)).toBe(true)
  expect(selected.some(row=>row.role==='current')).toBe(true)
  expect(selected.find(row=>row.id===archive.id)!.text.length).toBeLessThanOrEqual(2000)
  expect(selected.reduce((sum,row)=>sum+row.text.length,0)).toBeLessThanOrEqual(STRATEGY_PROMPT_SOURCE_CHARS)
})
it('reuses saved public research and its trace without web calls, deduplicating sources and excluding internal material',async()=>{
  Object.assign(config,{searchConfigured:true})
  const project={...structuredClone(fixture),synthetic:false,business_profile:'neighborhood'} as ProjectInput,input=projectDecisionInput(project)
  input.renewalMode!.evidence=[{source_id:source.id,title:source.title,quote:source.text,url:null,published_at:source.published_at!,locator:source.locator}]
  const acquired:StrategySource={...source,id:'ACQUIRED',text:'本小区给水管网更新方案已公开征求意见，涉及252户。',url:'https://example.org/saved-public',visibility:'public',data_class:'public',locator:'public:excerpt'}
  const archive:StrategySource={...source,id:'ARCHIVE',role:'reference',text:'归档案例采用雨污分流与给水管改造。'}
  const internal:StrategySource={...source,id:'INTERNAL',text:'PRIVATE-SENTINEL-731内部正文',visibility:'internal',data_class:'internal',document_id:'DOC-PRIVATE'}
  const registryInternal:StrategySource={...source,id:'REGISTRY-INTERNAL',text:'PRIVATE-SENTINEL-992未带metadata的内部正文'}
  project.sources.push({id:registryInternal.id,title:'内部原文件',visibility:'internal',data_class:'internal',synthetic:false,untrusted_text:registryInternal.text})
  const saved:Pick<StrategyPacket,'sources'|'research'>={sources:[source,acquired,archive,internal,registryInternal],research:{status:'partial',queries:['本小区供水方案'],source_ids:[acquired.id,internal.id,registryInternal.id],warnings:['原轮次部分网页未取得全文'],reused:false}}
  const completed=withConcreteWorkPlan(strategy(),acquired);completed.rationale=[{point:'复用本对象公开原文。',source_id:acquired.id,quote:acquired.text}]
  const call=vi.fn().mockResolvedValue({value:completed}),runReadCapability=vi.fn().mockRejectedValue(new Error('Retry must not call web tools'))
  ports.open.mockResolvedValue({calls:[],call,runReadCapability,close:vi.fn(async()=>{})})
  const progress:StrategyProgress[]=[],before=JSON.stringify(saved)
  const result=await researchRenewalStrategy(project,0,input,'same-hash-retry',false,new AbortController().signal,null,{savedResearch:saved,referenceSources:[archive],onProgress:event=>progress.push(event)})
  expect(result.status).toBe('completed');expect(call).toHaveBeenCalledOnce();expect(runReadCapability).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled()
  expect(result.sources.filter(row=>row.id===acquired.id)).toHaveLength(1)
  expect(result.sources.filter(row=>row.id===archive.id)).toHaveLength(1)
  expect(result.research).toEqual({...saved.research,source_ids:[acquired.id],reused:true})
  expect(call.mock.calls[0][1]).toContain(acquired.text);expect(call.mock.calls[0][1]).not.toMatch(/PRIVATE-SENTINEL/)
  expect(result.strategy?.paths[0].work_packages?.[0].source_id).toBe(acquired.id)
  expect(progress.some(event=>event.stage==='research'&&event.status==='completed'&&event.message.includes('复用同资料版本'))).toBe(true)
  expect(JSON.stringify(saved)).toBe(before)
})
it('projects unrequested round history away and repairs the actual failed JSON using literal source choices',async()=>{
  const project={...structuredClone(fixture),business_profile:'neighborhood'} as ProjectInput,input=projectDecisionInput(project)
  input.renewalMode!.evidence=[{source_id:source.id,title:source.title,quote:source.text,url:null,published_at:source.published_at!,locator:source.locator}]
  const mistaken=strategy(),corrected=strategy()
  mistaken.paths[0].work_packages![0].quote='原文中不存在的改造引句。'
  const unrequested={summary:'模型虚构的业务轮次',changes:[{topic:'虚构变化',before:'不存在的业务前版',after:'本轮结果',reason:'不能由普通刷新编造',evidence_refs:['OTHER-PROJECT']}],missing_materials:[]}
  mistaken.round_review=unrequested;corrected.round_review=unrequested
  const original=JSON.stringify(mistaken),call=vi.fn().mockResolvedValueOnce({value:mistaken}).mockResolvedValueOnce({value:corrected})
  ports.open.mockResolvedValue({calls:[],call,close:vi.fn(async()=>{})})
  const result=await researchRenewalStrategy(project,0,input,'projection-fixture',false,new AbortController().signal,null)
  expect(result.status).toBe('completed');expect(call).toHaveBeenCalledTimes(1)
  expect(result.strategy?.round_review).toBeUndefined()
  expect(result.strategy?.paths[0].work_packages![0].quote).toBe(mistaken.paths[0].work_packages![0].quote)
  expect(result.content_review?.issues).toContainEqual(expect.objectContaining({code:'STRATEGY_WORK_PACKAGE_QUOTE_MISMATCH'}))
  expect(result.content_review?.follow_up.reading_focus.join('')).toContain('全文')
  expect(JSON.stringify(mistaken)).toBe(original);expect(fetch).not.toHaveBeenCalled()
})

it('projects invented comparisons out of a parentless later attempt while retaining the existing work-plan repair',async()=>{
  const project={...structuredClone(fixture),business_profile:'neighborhood'} as ProjectInput,input=projectDecisionInput(project)
  input.renewalMode!.evidence=[{source_id:source.id,title:source.title,quote:source.text,url:null,published_at:source.published_at!,locator:source.locator}]
  const reference:StrategySource={...source,id:'COMMUNITY',role:'reference',title:'演示社区范围运营背景'}
  const repaired=withReasoningDimensions(strategy())
  repaired.round_review={summary:'本次形成对象分项方案与运营待核口径。',changes:[{topic:'社区运营',before:'无历史记录。',after:'按本轮社区资料形成候选措施。',reason:'社区资料用于运营机制参考。',evidence_refs:[reference.id]}],missing_materials:[{topic:'维保',request:'补充本对象维保协议。',reason:'核实责任与实际费用。',evidence_refs:[]}]}
  const initial=structuredClone(repaired);for(const path of initial.paths)delete path.work_packages
  const frozen=JSON.stringify({initial,repaired})
  expect(()=>validateStrategy(repaired,[source,reference],[],true,true,true,true)).toThrow('STRATEGY_ROUND_CHANGE_EVIDENCE_MISSING')
  const call=vi.fn().mockResolvedValueOnce({value:initial}).mockResolvedValueOnce({value:repaired})
  ports.open.mockResolvedValue({calls:[],call,close:vi.fn(async()=>{})})
  const roundContext:ResearchRoundContext={round_id:'ROUND-ATTEMPT-5',round_number:5,parent:null,allow_internal_ai:false,materials:[],sources:[],first_round_id:'ROUND-ATTEMPT-5',first_input_hash:'current',first_context_version:0}
  const result=await researchRenewalStrategy(project,0,input,'current',false,new AbortController().signal,null,{roundContext,referenceSources:[reference]})
  expect(result.status).toBe('completed');expect(call).toHaveBeenCalledTimes(1)
  expect(call.mock.calls[0][1]).toContain('第5次研究尝试')
  expect(result.strategy?.round_review).toEqual({...initial.round_review,changes:[]})
  expect(result.strategy?.paths).toEqual(initial.paths)
  expect(result.content_review?.issues).toContainEqual(expect.objectContaining({code:'STRATEGY_WORK_PACKAGES_REQUIRED'}))
  expect(JSON.stringify({initial,repaired})).toBe(frozen);expect(fetch).not.toHaveBeenCalled()
})

it('keeps real-parent comparisons subject to their original object evidence gate',async()=>{
  const project={...structuredClone(fixture),business_profile:'neighborhood'} as ProjectInput,input=projectDecisionInput(project)
  input.renewalMode!.evidence=[{source_id:source.id,title:source.title,quote:source.text,url:null,published_at:source.published_at!,locator:source.locator}]
  const reference:StrategySource={...source,id:'COMMUNITY',role:'reference',title:'演示社区范围运营背景'}
  const value=strategy();value.round_review={summary:'对照已有历史分析。',changes:[{topic:'社区运营',before:'已有分项候选。',after:'按社区资料调整运营。',reason:'社区背景不等于本对象新增依据。',evidence_refs:[reference.id]}],missing_materials:[]}
  const call=vi.fn().mockResolvedValue({value});ports.open.mockResolvedValue({calls:[],call,close:vi.fn(async()=>{})})
  const parent:StrategyPacket={project_id:project.project_id,context_version:0,input_hash:'prior',created_at:'2026-10-15T00:00:00Z',synthetic:false,status:'completed',strategy:strategy(),sources:[source],decision:null,model_calls:[],research:null,error:null}
  const roundContext:ResearchRoundContext={round_id:'ROUND-WITH-PARENT',round_number:6,parent:{id:'ROUND-PRIOR',input_hash:'prior',context_version:0,result:parent},allow_internal_ai:false,materials:[],sources:[],first_round_id:'ROUND-PRIOR',first_input_hash:'prior',first_context_version:0}
  const result=await researchRenewalStrategy(project,0,input,'current',false,new AbortController().signal,null,{roundContext,referenceSources:[reference]})
  expect(result.status).toBe('completed');expect(result.content_review?.issues).toContainEqual(expect.objectContaining({code:'STRATEGY_ROUND_CHANGE_EVIDENCE_MISSING'}))
  expect(call).toHaveBeenCalledTimes(1)
  expect(value.round_review.changes).toHaveLength(1);expect(fetch).not.toHaveBeenCalled()
})
it('round-trips scoped reference fields without changing quotes, locators or work identities and rejects unknown IDs',()=>{
  const value=strategy(),refs=strategyModelReferences([source]),before=JSON.stringify(value)
  const short=refs.encodeKnown(value)
  expect(short.rationale[0].source_id).toBe(refs.ids[0])
  expect(short.paths[0].work_packages![0].source_id).toBe(refs.ids[0])
  expect(short.internal_data_requests![0].evidence_refs).toEqual([refs.ids[0]])
  expect(short.paths[0].work_packages![0].id).toBe(value.paths[0].work_packages![0].id)
  expect(short.internal_data_requests![0].related_package_ids).toEqual(value.internal_data_requests![0].related_package_ids)
  expect(short.rationale[0].quote).toBe(source.text);expect(short.paths[0].work_packages![0].locator).toBe(source.locator)
  expect(refs.restore(short)).toEqual(value);expect(JSON.stringify(value)).toBe(before)
  short.decision_brief!.renewal.evidence_refs=['s999']
  expect(()=>refs.restore(short)).toThrow('STRATEGY_SOURCE_MISMATCH')
  short.decision_brief!.renewal.evidence_refs=['OTHER-PROJECT:SOURCE']
  expect(()=>refs.restore(short)).toThrow('STRATEGY_SOURCE_MISMATCH')
  const collision=strategyModelReferences([{...source,id:'s1'}])
  expect(collision.ids).not.toContain('s1');expect(collision.restore({source_id:collision.ids[0]})).toEqual({source_id:'s1'})
})
it('uses short source enums for the model and restores actual IDs before all existing business checks',async()=>{
  const project={...structuredClone(fixture),business_profile:'neighborhood'} as ProjectInput,input=projectDecisionInput(project)
  input.renewalMode!.evidence=[{source_id:source.id,title:source.title,quote:source.text,url:null,published_at:source.published_at!,locator:source.locator}]
  const call=vi.fn().mockImplementation(async(_stage:string,prompt:string,_type:string,_tools:unknown,_ids:unknown,presentation:{evidenceIds:string[]})=>{
    const modelSources=JSON.parse(prompt.match(/<untrusted_sources>(.*?)<\/untrusted_sources>/s)![1]) as StrategySource[]
    expect(presentation.evidenceIds).toEqual(modelSources.map(row=>row.id));expect(presentation.evidenceIds).not.toContain(source.id)
    const value=strategyModelReferences([source]).encodeKnown(strategy())
    expect(value.rationale[0].source_id).toBe(modelSources.find(row=>row.text===source.text)!.id)
    return {value}
  })
  ports.open.mockResolvedValue({calls:[],call,close:vi.fn(async()=>{})})
  const result=await researchRenewalStrategy(project,0,input,'short-id-fixture',false,new AbortController().signal,null)
  expect(result.status).toBe('completed');expect(call).toHaveBeenCalledOnce()
  expect(result.strategy?.rationale[0].source_id).toBe(source.id)
  expect(result.strategy?.paths[0].work_packages?.[0].source_id).toBe(source.id)
  expect(result.sources.some(row=>row.id==='s1')).toBe(false)
  expect(result.strategy?.decision_brief?.investment.stage).toBe('preliminary')
  expect(fetch).not.toHaveBeenCalled()
})
it('uses the production workflow opt-in and replaces synthesis raw bodies with validated windows and scoped notes',async()=>{
  const project={...structuredClone(fixture),business_profile:'neighborhood'} as ProjectInput,input=projectDecisionInput(project)
  const raw='LONG_BODY_SENTINEL'.repeat(1800)+'。'+source.text
  input.renewalMode!.evidence=[{source_id:source.id,title:source.title,quote:raw,url:null,published_at:source.published_at!,locator:source.locator}]
  ports.workflow.mockImplementation(async(_live,allSources:StrategySource[],options:{onProgress:(event:unknown)=>void})=>{
    expect(allSources.find(row=>row.id===source.id)?.text).toBe(raw)
    options.onProgress({stage:'planning',status:'completed',message:'已确定本轮分工',workflow:{phase:'planning',tasks:[]}})
    const catalog=allSources.map(({id,text,...fields})=>({...fields,source_id:id,characters:text.length}))
    const contextValue={source_catalog:catalog,evidence_windows:[{...catalog.find(row=>row.source_id===source.id),source_id:source.id,start_char:raw.length-source.text.length,end_char:raw.length,text:source.text}],untrusted_research_plan:null,untrusted_expert_notes:[],failed_tasks:[]}
    const context=JSON.stringify(contextValue)
    return {notes:[],contextValue,context,trace:{planner_status:'completed',plan:null,tasks:[],input_characters:JSON.stringify(allSources).length,source_characters:allSources.reduce((n,row)=>n+row.text.length,0),retained_source_characters:source.text.length,output_characters:context.length,compression:'reduced',method:'evidence_windows_and_untrusted_notes'}}
  })
  const call=vi.fn().mockResolvedValueOnce({value:strategy()}).mockResolvedValueOnce({value:withReasoningDimensions(strategy())})
  ports.open.mockResolvedValue({calls:[],call,close:vi.fn(async()=>{})})
  const events:StrategyProgress[]=[]
  const result=await researchRenewalStrategy(project,0,input,'workflow-fixture',false,new AbortController().signal,null,{researchWorkflow:true,onProgress:event=>events.push(event)})
  expect(result.status).toBe('completed');expect(ports.workflow).toHaveBeenCalledOnce()
  const prompt=call.mock.calls[0][1] as string,catalog=JSON.parse(prompt.match(/<untrusted_sources>(.*?)<\/untrusted_sources>/s)![1])
  expect(catalog.every((row:object)=>!('text' in row))).toBe(true)
  expect(prompt).not.toContain('LONG_BODY_SENTINEL');expect(prompt).toContain(source.text)
  expect(prompt).toContain('reasoning_dimensions完整六项');expect(result.strategy?.reasoning_dimensions).toBeUndefined()
  expect(call).toHaveBeenCalledTimes(1)
  expect(result.content_review?.issues).toContainEqual(expect.objectContaining({code:'STRATEGY_REASONING_DIMENSIONS_REQUIRED'}))
  expect(result.sources.find(row=>row.id===source.id)?.text).toBe(raw)
  expect(result.workflow?.synthesis_context_chars).toBeLessThan(result.workflow!.input_characters)
  expect(result.workflow?.synthesis_quote_candidate_chars).toBeGreaterThan(0)
  expect(result.workflow?.synthesis_profile?.role).toBe('synthesis')
  expect(call.mock.calls[0][6]).toMatchObject({role:'synthesis'})
  expect(events.some(event=>event.workflow?.phase==='planning')).toBe(true)
  expect(events.some(event=>event.workflow?.phase==='synthesis'&&event.status==='running')).toBe(true)
  expect(fetch).not.toHaveBeenCalled()
})

it('continues direct synthesis from acquired sources when the expert workflow cannot prepare',async()=>{
  const project={...structuredClone(fixture),business_profile:'neighborhood'} as ProjectInput,input=projectDecisionInput(project)
  input.renewalMode!.evidence=[{source_id:source.id,title:source.title,quote:source.text,url:null,published_at:source.published_at!,locator:source.locator}]
  ports.workflow.mockRejectedValueOnce(new Error('RENEWAL_RESEARCH_PREFLIGHT_FAILED'))
  const call=vi.fn().mockResolvedValue({value:strategy()})
  ports.open.mockResolvedValue({calls:[],call,close:vi.fn(async()=>{})})
  const result=await researchRenewalStrategy(project,0,input,'workflow-fallback',false,new AbortController().signal,null,{researchWorkflow:true})
  expect(result.status).toBe('completed');expect(call).toHaveBeenCalledTimes(1)
  expect(result.sources).toContainEqual(expect.objectContaining({id:source.id,text:source.text}))
  expect(result.content_review?.issues).toContainEqual(expect.objectContaining({code:'STRATEGY_RESEARCH_DETAILS_UNAVAILABLE'}))
  expect(fetch).not.toHaveBeenCalled()
})
