import {intelligenceScopeRevision} from '../../packages/intelligence/research-bridge'
import { randomUUID, createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { collectSelectedEvidence, type PublicResearch } from '../capabilities/research'
import { publicSearchPlan, RESEARCH_POLICY, publicSourceClass, sourceCurrentAt } from '../../packages/research/public-sources'
import type { ResearchSink } from '../../packages/research/events'
import type { Source, PublicRecord, DimensionEvidence } from '../../apps/host/generated/contracts'
import { eligibleDimension } from '../../packages/research/evidence'
import { groundedAmounts } from '../../packages/research/amounts'
import { sourceRecords } from '../../packages/research/source-records'
import { LiveSession } from '../../runtime/dsh/live-session'
import { config } from '../../apps/host/config'
import { hasUnqualifiedAssurance } from '../../packages/decision/model-policy'
import { INVESTIGATION_GAPS, SCREEN_PROFILES, usableMapEvidence } from '../../packages/maps/screening-policy'
import type { MapPreliminaryAssessment, MapScreenAnalysis, MapScreenContext, MapScreenProfile, DecisionSupport } from '../../apps/host/generated/contracts'
import { assertBriefProse, selectReferenceCases } from '../../runtime/skills/investment-brief'
import { decisionFactors } from '../../packages/maps/decision-factors'
import { publicMapContext, researchSubject } from '../../packages/maps/public-context'
export { researchSubject } from '../../packages/maps/public-context'
import { evaluateDecision } from '../capabilities/decision-model'
import { decisionErrorMessage } from '../../packages/decision/route-labels'
import { mapDecisionInput, DECISION_ACTIONS } from '../../packages/decision/structured-route'
import { dashboardDimensions, dashboardPolicy } from '../../packages/decision/dashboard'

export function groundMapAssessment(value: MapPreliminaryAssessment, snapshot: MapScreenContext, external: Source[] = [], records:PublicRecord[]=snapshot.research_records||[], asOf=snapshot.created_at,profile?:MapScreenProfile): MapPreliminaryAssessment {
  const context={...snapshot,created_at:asOf}
  assertBriefProse(value)
  const result = structuredClone(value)
  const known = new Map<string, string>()
  for (const group of context.groups.filter(usableMapEvidence)) { known.set(group.key, group.source_id); known.set(group.source_id, group.source_id) }
  let projectSourceIndex=0
  for (const project of publicMapContext(context).local_projects) for (const source of project.sources) {
    if (source.content_status !== 'metadata_only' && source.untrusted_text) {
      const id=`${project.project_id}:${source.id}`
      known.set(id,id);known.set(`project_${++projectSourceIndex}`,id)
    }
  }
  for (const source of external) if(source.content_status!=='metadata_only'&&source.untrusted_text) known.set(source.id,source.id)
  for (const claim of [...result.opportunities, ...result.cautions]) claim.evidence_refs = [...new Set(claim.evidence_refs.map(ref => {
    const source = known.get(ref)
    if (!source) throw new Error('MAP_ASSESSMENT_UNGROUNDED_REFERENCE')
    return source
  }))]
  const prose = [result.summary, ...result.opportunities.map(c => c.text), ...result.cautions.map(c => c.text), ...result.next_steps].join('。')
  if (hasUnqualifiedAssurance(prose) || /稳赚|必然升值|保证收益|保本保收益|投资回报率.{0,8}\d/i.test(prose)) throw new Error('MAP_ASSESSMENT_UNSUPPORTED_ASSURANCE')
  if (/地块为|待拆增量地|文件.{0,8}自述/.test(prose)) throw new Error('MAP_ASSESSMENT_UNSUPPORTED_PARCEL_CLAIM')
  result.unknowns = [...new Set(result.unknowns)].slice(0,1)
  const deterministic = decisionFactors(publicMapContext(context),asOf,profile)
  const seen = new Set<string>()
  for (const factor of result.factors || []) {
    if (seen.has(factor.key)) throw new Error('DUPLICATE_MAP_FACTOR')
    seen.add(factor.key)
    if (factor.state === 'unknown') continue
    factor.evidence_refs=factor.evidence_refs.map(ref=>known.get(ref)||ref)
    if (factor.quote.trim().length < 8 || factor.evidence_refs.length !== 1) throw new Error('FACTOR_QUOTE_REQUIRED')
    const ref = factor.evidence_refs[0]
    const project = publicMapContext(context).local_projects.find(p=>p.relation==='within_scope' && p.sources.some(s=>`${p.project_id}:${s.id}`===ref))
    const source = project?.sources.find(s=>`${project.project_id}:${s.id}`===ref)
    if (!source?.untrusted_text?.includes(factor.quote) || !source.published_at || !Number.isFinite(Date.parse(source.published_at)) || Date.parse(source.published_at) > Date.parse(context.created_at) || Date.parse(context.created_at)-Date.parse(source.published_at)>180*86400000) throw new Error('FACTOR_SOURCE_REQUIRED')
    const base = deterministic.find(f=>f.key===factor.key)!
    // A model-extracted lead is conditional. Verified structured facts retain precedence.
    if(base.state === 'unknown') Object.assign(base,{...factor,state:'conditional',conflict:base.conflict})
  }
  const sourceTexts=new Map<string,Source>(external.map(s=>[s.id,s]))
  const backgroundIds=new Set<string>()
  for(const project of publicMapContext(context).local_projects)for(const source of project.sources){
    const id=`${project.project_id}:${source.id}`
    sourceTexts.set(id,{...source,id})
    if(project.relation==='city_background')backgroundIds.add(id)
  }
  const subject=researchSubject(context)
  const objectSources=[...sourceTexts.values()].filter(s=>!backgroundIds.has(s.id))
  if(!groundedAmounts(result.summary,context,subject,objectSources,records)||result.next_steps.some(text=>!groundedAmounts(text,context,subject,objectSources,records)))throw new Error('MAP_ASSESSMENT_UNGROUNDED_AMOUNT')
  for(const claim of [...result.opportunities,...result.cautions])if(!groundedAmounts(claim.text,context,subject,objectSources.filter(s=>claim.evidence_refs.includes(s.id)),records))throw new Error('MAP_ASSESSMENT_UNGROUNDED_AMOUNT')
  const dimensionSeen=new Set<string>()
  result.dimension_evidence=(result.dimension_evidence||[]).flatMap(e=>{
    const id=known.get(e.source_id)||e.source_id,source=sourceTexts.get(id)
    if(dimensionSeen.has(e.key)||!source||e.quote.trim().length<8||backgroundIds.has(id))return []
    if(!eligibleDimension(source,context,subject,e,records,result.summary))return []
    if(hasUnqualifiedAssurance(e.basis)||!groundedAmounts(e.basis,context,subject,[source],records))return []
    dimensionSeen.add(e.key);return [{...e,source_id:id}]
  })
  result.factors = deterministic
  return result
}

export async function analyzeMapContext(context:MapScreenContext,profile:MapScreenProfile,signal:AbortSignal,emit:ResearchSink=()=>{},previous?:MapScreenAnalysis):Promise<MapScreenAnalysis>{
  const base={context_id:context.id,profile,created_at:new Date().toISOString()}
  const neighborhood=profile==='neighborhood'
  const direction=neighborhood?'按老旧小区改造研究居民家庭、基础/完善/提升类改造、公共服务缺口、鉴定消防与管网、居民协商和实施主体、资金来源与工程成本、物业长效维护。区分居民需求与商业客流；人口统计保留时点和空间范围；提出停车、养老托育或加装电梯等具体内容时写明对应居民与工程条件。':'校园应查实际修缮采购、运营与使用安排，不预设拆迁或用途变更。'
  const dimensions=dashboardDimensions(dashboardPolicy(profile)).map(d=>`${d.key}${d.label}`).join('、')
  if(!config.modelConfigured)return {...base,status:'unavailable',assessment:null,model_calls:[],reason:'请配置模型接口。'}
  const budget=AbortSignal.any([signal,AbortSignal.timeout(110000)])
  const live=await LiveSession.open('MAP-AI-'+randomUUID(),budget)
  let research:PublicResearch={sources:[],records:[],receipts:[],trace:{status:'not_applicable',queries:[],source_ids:[],warnings:[],reused:false}}
  let decisionSupport:DecisionSupport|undefined
  let assessment:MapPreliminaryAssessment|undefined
  const previousMatches=!!previous?.assessment&&previous.context_id===context.id&&previous.profile===profile
  let reuse=previousMatches&&!previous!.refresh_required
  let refreshEvidence=previousMatches&&!!previous!.refresh_required
  const calls=()=>[...(reuse?previous!.model_calls:[]),...live.calls]
  const partial=():MapScreenAnalysis=>({...base,status:'partial',assessment:assessment!,model_calls:calls(),reason:'简报已完成，评分尚未完成。',research_sources:research.sources,research_records:research.records,adapter_receipts:research.receipts,research:research.trace})
  try{
    const publicContext=publicMapContext(context),name=researchSubject(publicContext)
    const originalSources=publicContext.local_projects.flatMap(p=>p.sources.filter(s=>s.untrusted_text&&s.content_status!=='metadata_only').map(s=>({...s,id:`${p.project_id}:${s.id}`})))
    if(reuse){
      research={sources:previous!.research_sources||[],records:previous!.research_records||[],receipts:previous!.adapter_receipts||[],trace:{...(previous!.research||research.trace),reused:true}}
      try{
        assessment=groundMapAssessment(previous!.assessment!,context,research.sources,research.records,new Date().toISOString(),profile)
        emit({type:'progress',stage:'sources',status:'completed',message:'复用已完成的简报与依据'})
      }catch{
        budget.throwIfAborted()
        reuse=false;refreshEvidence=true
        research={sources:[],records:[],receipts:[],trace:{status:'not_applicable',queries:[],source_ids:[],warnings:[],reused:false}}
        emit({type:'progress',stage:'sources',status:'running',message:'原简报依据已变化，重新取得当前资料'})
      }
    }
    if(!reuse&&name&&config.searchConfigured){
      emit({type:'progress',stage:'sources',status:'running',message:'核对研究对象与公开数据入口'})
      const queries=publicSearchPlan(name,SCREEN_PROFILES[profile].label)
      const intelligenceRevision=await intelligenceScopeRevision({name,city:context.city||undefined,purpose:SCREEN_PROFILES[profile].label,asOf:base.created_at})
      const key=createHash('sha256').update(JSON.stringify({intelligenceRevision,policy:RESEARCH_POLICY,name,target:publicContext.target,profile,day:base.created_at.slice(0,10),queries})).digest('hex')
      const path=join(config.dataDir,'map-screening','public-research',key+'.json')
      try{if(refreshEvidence)throw Error('brief-no-longer-valid');const cached=JSON.parse(await readFile(path,'utf8'));if(Date.now()-Date.parse(cached.saved_at)>86400000)throw Error('expired');research=cached.result;research.trace.reused=true;emit({type:'progress',stage:'sources',status:'completed',message:'复用当前对象的公开资料'})}
      catch{
        // Registered queries are program inputs, not a model-planning stage.
        budget.throwIfAborted()
        research=await live.runReadCapability('selected_public_research',s=>collectSelectedEvidence({name,city:context.city||undefined,purpose:SCREEN_PROFILES[profile].label,asOf:base.created_at},s,emit,undefined,queries))
        await mkdir(join(config.dataDir,'map-screening','public-research'),{recursive:true})
        if(research.sources.some(s=>s.untrusted_text))await writeFile(path,JSON.stringify({saved_at:new Date().toISOString(),result:research}),{mode:0o600})
      }
    }
    const projectSources=originalSources.map(s=>({id:s.id,title:s.title,text:s.untrusted_text,published_at:s.published_at||null,expires_at:s.expires_at||null,date_status:s.date_status,body_truncated:!!s.body_truncated,records_truncated:!!s.records_truncated}))
    const external=research.sources.filter(s=>s.content_status!=='metadata_only'&&s.untrusted_text)
    const places=context.groups.filter(usableMapEvidence).map(g=>({id:g.key,label:g.label,examples:g.sample.slice(0,5).map(p=>({name:p.name,category:p.category}))}))
    const allSources=[...projectSources,...external.map(s=>({id:s.id,title:s.title,text:s.untrusted_text?.slice(0,10000),published_at:s.published_at||null,expires_at:s.expires_at||null,date_status:s.date_status,body_truncated:!!s.body_truncated,records_truncated:!!s.records_truncated}))]
    const allRecords=[...research.records,...originalSources.flatMap(source=>sourceRecords(source))]
    const payload={target:publicContext.target,address:context.address,as_of:base.created_at,profile,dashboard_policy:dashboardPolicy(profile),sources:allSources,places,records:allRecords}
    const evidenceIds=[...places.map(s=>s.id),...allSources.map(s=>s.id)]
    const references=selectReferenceCases(neighborhood?`${name} 老旧小区 社区更新 居民 公共服务`:name)
    if(!reuse)emit({type:'progress',stage:'brief',status:'running',message:'形成具体参与路径'})
    const prompt=`给出所选空间的实际参与建议。方向：${SCREEN_PROFILES[profile].label}。${direction}摘要≤64字，机会、行动前提、下一步各最多1项且≤48字。先回答做什么、为谁做、通过什么业务入口；不要只说核查。只有本方案真实触发的关键前提才填cautions；无新增信息就留空。禁止“用途、权属和腾退未核实”“不可直接套用更新项目”等泛化阻却句。已经成交或截止的公告作为历史采购需求，下一步查后续采购，不能建议投过期标。expires_at已过或日期冲突的资料仅作历史线索，不能把旧金额写为当前预算；body_truncated表示原文未完整取得，不确认当前实施窗口。
可选dimension_evidence按${dimensions}最多各1项。每项必须有一个sources.id、该来源8–180字精确quote、≤120字basis，缺证据的维度不填。引文须明确包含当前对象名称；引用结构化记录字段时填写该条records.id作为record_id，并逐字使用该字段raw。不能用标题替另一对象的引文背书。邻楼、相邻对象和比较案例须明确写为周边或比较线索，不能变成当前对象自身的需求、资格或单体预算；联合项目、标段及分项金额保留完整范围。历史档案可以支持空间线索，不把旧采购、已成交或已截止的公告当当前实施入口。不要为填满图表拼接不同校区或不同项目。未知不打0分。六维等级用于方案比较，不能替代三类行动判定，也不能用高分抵消硬约束。不要输出factors，由已有事实规则管理硬约束。evidence_refs只能用给定ID，POI只用于发现对象，不用于维度评分。
方法案例不作为本地事实：${JSON.stringify(references)}
<untrusted_evidence>${JSON.stringify(payload)}</untrusted_evidence>`
    let repairNote=''
    for(let attempt=0;!reuse&&attempt<2;attempt++){
      let publishing=false
      try{
        const {value}=await live.call<MapPreliminaryAssessment>('map_initial_screen'+(attempt?'_repair':''),prompt+repairNote,'MapPreliminaryAssessment',[],undefined,{omitOptionalFields:['factors'],evidenceIds})
        const grounded=groundMapAssessment(value,context,external,research.records,new Date().toISOString(),profile)
        assessment=grounded
        if(!attempt&&(value.dimension_evidence?.length||0)>(grounded.dimension_evidence?.length||0)){
          const accepted=new Set(grounded.dimension_evidence?.map(e=>e.key))
          const rejected=value.dimension_evidence?.filter(e=>!accepted.has(e.key)).map(e=>e.key)
          repairNote=`\n以下维度的来源、对象或逐字引用未通过校验：${JSON.stringify(rejected)}。只尝试纠正一次：source_id 必须完整复制给定 ID，quote 必须是同一来源内连续的原文，不加省略号、不拼接、不改空格。只采用对应选中对象自身主张的原文；相邻或比较对象只能明确标为背景线索。作为他楼项目的开标场地仅可支持明确会务方案的场地使用需求，不能推成自身维保需求、采购资格或资金。不能核实就删除该维度。保留已成立的简报，不为补齐图表虚构依据。`
          publishing=true
          await emit({type:'brief',result:{...partial(),reason:'建议已取得，正在复核维度依据。'}})
          await emit({type:'progress',stage:'brief',status:'partial',message:'建议已展示，正在核对维度引用'})
          continue
        }
        break
      }catch(error){
        budget.throwIfAborted()
        if(publishing)throw error // A revoked context or disconnected viewer is not a model repair request.
        if(attempt){if(!assessment)throw error;break}
        repairNote='\n修正格式或来源：删除泛化条件，给出面向当前对象的业务动作；引用精确、连续的原文。'
      }
    }
    await emit({type:'brief',result:partial()})
    emit({type:'progress',stage:'brief',status:'completed',message:assessment!.summary})
    if(config.decisionEnabled){
      await emit({type:'progress',stage:'decision',status:'running',message:'评估六维方案适配'})
      const asOf=new Date().toISOString()
      assessment=groundMapAssessment(assessment!,context,external,research.records,asOf,profile)
      const input=mapDecisionInput({...context,created_at:asOf},SCREEN_PROFILES[profile].label,profile)
      const scoringIds=new Set(assessment!.dimension_evidence?.map(e=>e.source_id)||[])
      input.state={business_profile:neighborhood?'neighborhood':'general',...(input.neighborhoodAction?{neighborhood_action:input.neighborhoodAction}:{}),target:publicContext.target,as_of:(input.state as {as_of:string}).as_of,verified_conditions:input.factors,proposal:assessment!.summary,
        public_sources:allSources.filter(s=>scoringIds.has(s.id)).map(s=>({id:s.id,title:s.title,published_at:s.published_at})),
        records:allRecords.slice(0,8).map(r=>({...r,fields:r.fields.slice(0,20).map(f=>({key:f.key,value:typeof f.value==='string'?f.value.slice(0,200):f.value,unit:f.unit,locator:f.locator}))}))}

      input.sourceIds=[...input.sourceIds,...external.map(s=>s.id)]
      input.dashboard={purpose:assessment!.summary,evidence:assessment!.dimension_evidence||[],profile}
      decisionSupport=await live.runReadCapability('qwen_research_route',s=>evaluateDecision(input,s))
      const scored=decisionSupport.status==='completed'&&decisionSupport.dashboard?.status==='completed'
      emit({type:'progress',stage:'decision',status:scored?'completed':'partial',message:scored?'六维研判已更新':'本轮仅展示已取得的建议与依据'})
      // Keep the actual object-specific action. A generic router checklist must not overwrite it.
    }
    const completed=!decisionSupport||decisionSupport.status==='completed'
    return {...base,status:completed?'completed':'failed',assessment:assessment!,model_calls:calls(),reason:completed?null:decisionErrorMessage(decisionSupport?.error_code,decisionSupport?.error_detail),...(decisionSupport?{decision_support:decisionSupport}:{}),research_sources:research.sources,research_records:research.records,adapter_receipts:research.receipts,research:research.trace}
  }catch{
    signal.throwIfAborted()
    return {...base,status:'failed',assessment:assessment||null,model_calls:calls(),reason:assessment?'简报已保留，后续判断未完成，可重试评分。':budget.aborted?'本轮研究已停止。':'本轮研判未完成，请重试。',research_sources:research.sources,research_records:research.records,adapter_receipts:research.receipts,research:research.trace,...(decisionSupport?{decision_support:decisionSupport}:{})}
  }finally{await live.close()}
}
