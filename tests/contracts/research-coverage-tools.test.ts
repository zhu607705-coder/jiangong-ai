import {expect,it,vi} from 'vitest'
import {answerSlots,resolveAnswerSlots,moneyObservations} from '../../packages/retrofit/research-coverage'
import {preserveCriticalWindows} from '../../packages/retrofit/evidence-compression'
import {DeepSeekWebTools,compileSearchQueries} from '../../runtime/dsh/deepseek-web-tools'
import {requestDecisionBatches} from '../../services/capabilities/decision-model'
import {decisionMetrics,fitTemperature,investigationSensitivity,latencySummary} from '../../packages/decision/evaluation'
import {collectSelectedEvidence} from '../../services/capabilities/research'
import type {Source} from '../../apps/host/generated/contracts'
import type {StrategySource} from '../../packages/retrofit/strategy'
import {modelSchema,validate} from '../../packages/contracts/validate'
import {conditionalReport} from '../../packages/retrofit/conditional-report'
import {bindStrategySource} from '../../packages/retrofit/object-binding'
import {buildProjectTasks} from '../../packages/retrofit/project-tasks'
import {guidePacket,guideProject} from './project-decision-fixture'
import {assertObjectJsonSchema} from '@deepseek-ai/dsh-tools'
const source=(id:string,text:string):StrategySource=>({id,title:id+'工程',text,role:'current',locator:'line:1',url:null,published_at:'2026-10-16'})
it('reads preceding currency units and column-aligned award rows without inferring funds received',()=>{
 const text='项目预算（万元）\n106.642500\n资金来源\n区财政。报价\n（万元）\n工期要求（天）\n质量\n1\n杭州测试工程有限公司\n王工\n101.523700\n45\n合格'
 const rows=moneyObservations([source('雨棚',text)])
 expect(rows.find(row=>row.stage==='budget')).toMatchObject({amount_yuan:'1066425',funding_source:'区财政',funding_status:'unknown',price_year:null})
 expect(rows.find(row=>row.stage==='award')).toMatchObject({amount_yuan:'1015237',amount_decimal:'101.523700'})
 expect(rows.every(row=>text.includes(row.quote))).toBe(true)
})
it('renders a six-dimensional zero-source conditional report with a satisfiable empty-citation schema',()=>{
 const packet=guidePacket(),project=structuredClone(guideProject.input);project.sources=[]
 const result=conditionalReport(project,{...packet,sources:[]},[],'isolated fixture')
 expect(()=>validate('RenewalStrategy',result.strategy)).not.toThrow()
 expect(result.strategy?.reasoning_dimensions).toHaveLength(6)
 expect(JSON.stringify(modelSchema('RenewalStrategy',undefined,{evidenceIds:[]}))).not.toContain('"enum":[]')
 for(const type of ['RenewalStrategy','RenewalResearchNote','RenewalResearchPlan'])expect(()=>assertObjectJsonSchema(modelSchema(type,undefined,{evidenceIds:[]}))).not.toThrow()
 const work={id:'scenario',target:'拟更新管网',target_basis:'scenario',source_id:null,quote:'',locator:'scenario:project-scope',intervention:'分段更换管网',scope:'假设既有建筑保留',quantity:null,unit:null,quantity_basis:'unknown',delivery:'分段检修管网',priority:'first',preconditions:['先核实实际设施范围'],evidence_refs:[]}
 expect(()=>validate('RenewalWorkPackage',work)).not.toThrow()
})
it('keeps explicit foreign object references out and accepts dated scoped fact links',()=>{
 const project=structuredClone(guideProject.input);project.as_of='2026-10-17';project.sources[0].object_refs=['project:OTHER'];const item={...guidePacket().sources[0]}
 expect(bindStrategySource(item,project).object_binding?.relation).toBe('different_object')
 project.scope.boundary_source='project:OTHER'
 expect(bindStrategySource(item,project).object_binding?.relation).not.toBe('different_object')
 project.sources[0].object_refs=[];project.facts=[{source_id:'PUBLIC',epistemic_status:'fact',observed_at:'2026-10-01',locator:'line:1',object_ref:'project:'+project.project_id} as any]
 expect(bindStrategySource(item,project).object_binding).toMatchObject({relation:'same_object',basis:'reviewed_evidence'})
})
it('moves review and compression follow-ups into the actual material/task list',()=>{
 const packet=guidePacket();packet.content_review!.follow_up={search_queries:['本对象 竣工结算'],reading_focus:['补读S1字符100—300的否定条件'],internal_data:['社区食堂实际去重就餐人数']}
 const tasks=buildProjectTasks(packet,'comprehensive')
 expect(tasks.some(row=>row.request.includes('字符100—300'))).toBe(true)
 expect(tasks.some(row=>row.request.includes('去重就餐人数'))).toBe(true)
})
it('covers all nine compound fields, with decimal money and separated budget, award and settlement',()=>{
 const sources=[source('机电','机电配套项目预算80.8744万元。资金来源区级国有投资，尚未到账。'),source('雨棚','雨棚预算106.6425万元。资金来源区财政。雨棚成交金额101.5237万元。'),source('消防通道','消防通道成交金额137.4878万元。资金来源区财政。')]
 const result=resolveAnswerSlots('机电配套、雨棚、消防通道的费用和资金来源是什么，预算还是结算？',sources)
 expect(answerSlots('机电、雨棚、消防通道的金额、阶段和资金来源')).toHaveLength(9)
 expect(result.slots).toHaveLength(9);expect(result.missing).toBe(0)
 expect(result.money.find(row=>row.amount_decimal==='80.8744')).toMatchObject({amount_yuan:'808744',stage:'budget',price_year:null,funding_status:'not_received'})
 expect(result.money.find(row=>row.amount_decimal==='101.5237')?.stage).toBe('award')
 expect(result.money.some(row=>row.stage==='settlement')).toBe(false)
 expect(result.money.every(row=>sources.find(source=>source.id===row.source_id)!.text.includes(row.quote))).toBe(true)
})
it('does not fill missing funding and retains conflicting same-stage amounts',()=>{
 const result=resolveAnswerSlots('雨棚费用及资金来源、阶段',[source('雨棚','雨棚预算100万元。雨棚预算120万元。')])
 expect(result.missing).toBe(1);expect(result.conflicting).toBeGreaterThan(0);expect(result.requests.find(row=>row.missing_fields.includes('funding'))?.suggested_queries.join(' ')).toContain('资金')
})
it('preserves a distant negated premise and both money stages in the actual source ranges',()=>{
 const text='未经结构鉴定不得开工，'+'本期条件说明'.repeat(80)+'采用分段施工。预算100万元；中标95万元；资金尚未到账。',row=source('S',text),start=text.indexOf('采用分段施工')
 const before={source_id:'S',start_char:start,end_char:start+6,text:text.slice(start,start+6)}
 const result=preserveCriticalWindows([row],[{source_id:'S',start_char:0,end_char:text.length,text}], [before],[{source_id:'S',quote:'采用分段施工'}])
 const retained=result.windows.map(window=>window.text).join('\n')
 expect(retained).toContain('未经结构鉴定不得开工');expect(retained).toContain('预算100万元');expect(retained).toContain('中标95万元');expect(retained).toContain('尚未到账')
 expect(result.audit.retention_ratio).toBe(1);expect(preserveCriticalWindows([row],[],[before],[{source_id:'S',quote:'采用分段施工'}],6).audit.omitted.length).toBeGreaterThan(0)
})
it('partitions 38 Decision questions, preserves good answers and rejects invalid rubric shapes',async()=>{
 const model=vi.fn(async(_state,questions:any)=>({model:'decision-model-preview',request_id:'request-'+Object.keys(questions)[0],usage:{input_tokens:100},answers:Object.fromEntries(Object.keys(questions).map(id=>[id,{type:'score',score:1,confidence:.7,probabilities:{0:0,1:1,2:0}}]))}))
 const questions=Object.fromEntries(Array.from({length:38},(_,i)=>['q'+i,{type:'score',criteria:['低','中','高']}]))
 const result=await requestDecisionBatches({},questions,new AbortController().signal,model)
 expect(model.mock.calls.map(row=>Object.keys(row[1]).length)).toEqual([16,16,6]);expect(Object.keys(result.answers)).toHaveLength(38)
 await expect(requestDecisionBatches({},{bad:{type:'score',criteria:['唯一等级']}},new AbortController().signal,model)).rejects.toThrow('DECISION_CRITERIA_INVALID')
})
it('does not treat provider confidence as labels or fit calibration on test objects',()=>{
 const rows=[{object_id:'A',split:'test' as const,label:1,probabilities:[.1,.9],confidence:.1}]
 expect(decisionMetrics(rows).accuracy).toBe(1);expect(decisionMetrics(rows).brier).toBeCloseTo(.02)
 expect(()=>fitTemperature(rows)).toThrow('CALIBRATION_SPLIT_LEAKAGE');expect(fitTemperature([{...rows[0],split:'calibration'}]).status).toBe('insufficient_labels')
 expect(latencySummary([100,500,200,300])).toEqual({n:4,p50_ms:200,p95_ms:500})
 expect(investigationSensitivity([{id:'high',baseline_utility:10,possible_utilities:[1,30],acquisition_days:1},{id:'low',baseline_utility:10,possible_utilities:[9,11],acquisition_days:2}])[0].id).toBe('high')
})
it('uses standalone API contracts, records empty requests as free, and reuses Search content',async()=>{
 const transport=vi.fn(async(url:string,options:any)=>new Response(JSON.stringify(url.endsWith('/search')?{results:[{url:'https://www.zj.gov.cn/public-case',title:'工程公告',content:'公开预算原文。'.repeat(60),snippet:'公开预算',date:'2026-10-16T00:00:00Z'}]}:{title:'工程公告',content:'抓取正文。'.repeat(60)}),{headers:{'Content-Type':'application/json'}}))
 const tool=new DeepSeekWebTools({key:()=>'unit-key',includeContent:true,maxSearchRequests:4},undefined,transport as typeof fetch)
 const found=await tool.search({query:'杭州 小区 预算',maxResults:8}),fetched=await tool.fetch({url:found.sources[0].url})
 expect(transport).toHaveBeenCalledTimes(1);expect(fetched.representation?.kind).toBe('search_content');expect(fetched.representation?.origin_hash).toBeNull()
 expect(JSON.parse(transport.mock.calls[0][1].body)).toMatchObject({count:8,need_content:true})
 const empty=new DeepSeekWebTools({key:()=>'unit-key',includeContent:false,maxSearchRequests:4},undefined,(async()=>new Response('{"results":[]}')) as typeof fetch)
 await empty.search({query:'没有匹配'});expect(empty.receipts[0].billing_state).toBe('expected_free')
 const queries=compileSearchQueries('天津 建工新村 '+'预算 '.repeat(80));expect(queries.length).toBeGreaterThan(1);expect(queries.every(query=>[...query].length<=128&&query.startsWith('天津 建工新村'))).toBe(true)
})
it('does not bypass Fetch security denials with the HTTP fallback',async()=>{
 const legacy={search:vi.fn(),fetch:vi.fn()},tool=new DeepSeekWebTools({key:()=>'unit-key',includeContent:false,maxSearchRequests:2},legacy,(async()=>new Response('{}',{status:403})) as typeof fetch)
 await expect(tool.fetch({url:'https://www.zj.gov.cn/public-case'})).rejects.toThrow('HTTP_403');expect(legacy.fetch).not.toHaveBeenCalled()
})
it('fetches new evidence even with ten cached originals and binds offsets to retained representation',async()=>{
 const seed=Array.from({length:10},(_,i)=>({id:'old'+i,title:'旧资料',url:'https://www.zj.gov.cn/old'+i,visibility:'public',data_class:'public',synthetic:false,untrusted_text:'已保存的原文。',published_at:'2026-10-01',content_status:'excerpt'} as Source))
 const fetcher=vi.fn(async()=>({statusCode:200,body:{kind:'html',content:'<html><body><h1>改造公告</h1><p>项目预算100万元，资金来源财政。</p>'+('本对象公开工程说明。'.repeat(40))+'</body></html>'}}))
 const result=await collectSelectedEvidence({name:'本小区',purpose:'改造',asOf:'2026-10-17',seedSources:seed,intelligence:false,budget:{newEvidence:2,refresh:0}},new AbortController().signal,undefined,{search:async()=>({sources:[{url:'https://www.zj.gov.cn/new-a',title:'新公告'},{url:'https://www.zj.gov.cn/new-b',title:'新公告'}]}),fetch:fetcher},['新公告'])
 expect(fetcher).toHaveBeenCalledTimes(2);expect(result.sources).toHaveLength(12);expect(result.trace.acquisition?.new_sources).toBe(2)
 expect(result.sources.at(-1)?.representations?.find(row=>row.id===result.sources.at(-1)?.representation_id)?.sha256).toBe(result.sources.at(-1)?.hash)
})
it('reserves acquisition slots for every subquestion before filling the global source quota',async()=>{
 const selected:string[]=[],web={search:async({query}:{query:string})=>({sources:Array.from({length:4},(_,i)=>({url:`https://www.zj.gov.cn/${query}-${i}`,title:query+'原文'}))}),fetch:async({url}:{url:string})=>{selected.push(url);return {statusCode:200,body:{kind:'text' as const,content:'本对象工程预算100万元。'.repeat(30)}}}}
 await collectSelectedEvidence({name:'某小区',purpose:'复合问题',asOf:'2026-10-17',intelligence:false,budget:{newEvidence:3,refresh:0}},new AbortController().signal,undefined,web,['机电','雨棚','消防'])
 expect(selected).toHaveLength(3);expect(['机电','雨棚','消防'].every(topic=>selected.some(url=>decodeURIComponent(url).includes(topic)))).toBe(true)
})
