import type {Project} from '../api'
import type {ProjectPage,SchemePane} from '../public-decisions'
import type {StrategyPacket} from '../../../../packages/retrofit/strategy'
import type {ResearchRound} from '../../../../packages/retrofit/research-rounds'
import {MODE_LABELS} from '../../../../packages/retrofit/renewal-mode'
import {buildProjectTasks,taskObjectApplicability} from '../../../../packages/retrofit/project-tasks'
import {PRIORITY_DIMENSIONS} from '../../../../packages/retrofit/decision-priorities'
import {currentDirectionText,type StrategyDirection} from './strategy-direction-text'
import {renewalCheckEmphasis} from './decision-emphasis'
import {projectOverviewState} from './ProjectOverview'

export type MobileTarget={page:ProjectPage;section?:string;pane?:SchemePane;scheme?:StrategyDirection;taskId?:string;workspace?:boolean}
export type MobileCard={id:string;title:string;body:string;eyebrow?:string;tone?:'neutral'|'warning'|'success'|'danger';facts?:{label:string;value:string}[];refs?:string[];target?:MobileTarget;action?:string;direction?:boolean}
export type MobileChapter={id:string;label:string;cards:MobileCard[]}
export type MobileProjectInput={project:Project;page:ProjectPage;packet:StrategyPacket|null;rounds:ResearchRound[];direction:StrategyDirection|null;loading?:boolean;failed?:boolean}
const level={low:'低',medium:'中',high:'高',unknown:'待核'}
const host=(url:string|null)=>{try{return url?new URL(url).hostname:'已导入材料'}catch{return '已存来源'}}
const stageNames:Record<string,string>={estimate:'估概算',budget:'预算',control_price:'控制价',award:'中标',contract:'合同',settlement:'结算',payment:'支付',unknown:'阶段待核'}
const empty=(id:string,title:string,body:string,target?:MobileTarget,action='打开完整工作区'):MobileCard=>({id,title,body,target,action})

/** Presentation of existing packets/rules; never a new verdict, score, fetch or model call. */
export function mobileProjectChapters(input:MobileProjectInput):MobileChapter[]{
  const {project,page,packet,rounds,direction}=input
  const validRounds=rounds.filter(r=>r.project_id===project.id&&r.result?.project_id===project.id&&r.result.synthetic===project.input.synthetic)
  const latestSavedRound=validRounds.filter(r=>r.status==='completed'&&r.result?.strategy).sort((a,b)=>b.round_number-a.round_number)[0]||null
  const state=projectOverviewState({project,currentStrategyPacket:packet,latestSavedRound,currentDirection:direction,loading:input.loading,failed:input.failed})
  const current=state.packet,strategy=state.strategy,gate=state.gate
  const path=strategy?.paths.find(p=>p.mode===direction)
  const clean=(value:string)=>direction?currentDirectionText(value,direction):value
  const assessmentPacket=packet&&packet.project_id===project.id&&packet.synthetic===project.input.synthetic&&packet.context_version===project.context_version?packet:null
  const sourceIds=new Set((current||assessmentPacket)?.sources.map(s=>s.id)||[])
  const refs=(values:readonly string[]|undefined)=>[...new Set(values||[])].filter(id=>sourceIds.has(id))
  const commonFacts=[{label:'工作方向',value:direction?MODE_LABELS[direction]:'尚未选择'},{label:'资料版本',value:`v${project.context_version}`}]
  const status=state.failed?'本轮未完成':state.stale?'资料已变化':strategy?'已保存研究建议':input.loading?'正在读取':'尚未研判'
  const headline=current?.current_context?.object_review_required?'先核对登记对象与历史资料范围':strategy?.decision_brief?.renewal.conclusion||strategy?.headline||(input.loading?'正在读取本项目的研究状态':project.input.sources.length?'已有资料，可进入改造研判':'先补充本项目资料')
  const lead=current?.current_context?.object_review_required?'已有报告含同名异地资料，先核对本对象，旧原件继续保留作参考。':strategy?.decision_brief?.renewal.reason||strategy?.summary||'导入已有材料，再按本项目条件形成方向判断与方案。'
  const conclusion:MobileCard={id:'conclusion',title:headline,body:lead,eyebrow:status,tone:state.failed?'danger':state.stale||state.needsChecks?'warning':'neutral',facts:commonFacts,refs:refs(strategy?.decision_brief?.renewal.evidence_refs),target:{page:'assessment',section:'direction',workspace:false},action:strategy?'查看改造研判':'打开改造研判'}
  const object:MobileCard={id:'object',title:project.input.scope.name||project.name,body:project.input.scope.city||'城市尚未登记',eyebrow:'研究对象',facts:[{label:'资料基准',value:project.input.as_of},{label:'原始来源',value:`${project.input.sources.length}份`},{label:'事实记录',value:`${project.input.facts.length}项`},{label:'资料版本',value:`v${project.context_version}`}],target:{page:'evidence',section:'profile'},action:'查看对象档案'}
  const selectedRound=current?validRounds.find(r=>r.status==='completed'&&r.input_hash===current?.input_hash&&r.context_version===current.context_version):undefined
  const tasks=buildProjectTasks(current,direction,selectedRound?.missing_materials||[])
  const taskCards=tasks.map(task=>{const applicability=current?taskObjectApplicability(current,task):null;return {id:task.id,title:task.title,body:task.request,eyebrow:applicability?.label|| (task.internal_data?'内部数据调查':'资料与条件核实'),tone:applicability?.state==='foreign_reference'||applicability?.state==='needs_review'?'warning' as const:'neutral' as const,facts:task.reason?.trim()?[{label:'判断用途',value:task.reason}]:[],refs:refs(task.evidence_refs),target:{page:'actions' as const,section:'current',taskId:task.id},action:'打开这项调查'}})
  const missingTasks=[empty('no-tasks','尚未形成调查清单','先读取已有方案或进入改造研判。新材料可在资料页随时补充。',{page:'evidence',section:'files'},'补充项目资料')]
  const conditions:MobileCard[]=gate.checks.map(check=>({id:check.kind,title:check.label,body:check.detail,eyebrow:renewalCheckEmphasis(check).label,tone:renewalCheckEmphasis(check).tone,refs:refs(check.source_ids),target:{page:'assessment',section:'direction'},action:'查看条件与判定'}))
  const dimensions=assessmentPacket?.current_assessment?.dimensions||strategy?.dimensions||[]
  const dimensionCards:MobileCard[]=dimensions.map(row=>{const selected=strategy?.dimensions.find(d=>d.key===row.key),inferred=(assessmentPacket?.current_assessment?.reasoning_dimensions||strategy?.reasoning_dimensions)?.find(d=>d.key===row.key);return {id:row.key,title:PRIORITY_DIMENSIONS.find(d=>d.key===row.key)?.label||row.key,body:row.current+(inferred?`\n推理暂估：${inferred.reason}\n前提：${inferred.premises.join('；')}\n假设：${inferred.assumptions.join('；')}\n待核：${inferred.verification}`:''),eyebrow:inferred&&row.current_level==='unknown'?'六维 · 推理暂估':'六维现况',facts:[{label:'证据等级',value:level[row.current_level]},...(inferred?[{label:'推理暂估',value:level[inferred.level]}]:[]),...(direction&&selected?[{label:`${MODE_LABELS[direction]}目标`,value:level[selected[`${direction}_level`]]}]:[])],refs:refs(row.evidence_refs),target:{page:'assessment',section:'current'},action:'查看六维评价'}})
  const sourceCards:MobileCard[]=project.input.sources.map(source=>({id:source.id,title:source.title,body:source.untrusted_text?.trim()||'尚未取得可读正文，可在资料工作区补取或上传。',eyebrow:source.visibility==='public'?'公开来源':'项目资料',facts:[{label:'内容状态',value:source.content_status==='full_text'?'已取得正文':source.content_status==='excerpt'?'原文片段':'元数据或待读取'},{label:'来源日期',value:source.published_at?.slice(0,10)||'未登记'}],refs:[source.id],target:{page:'evidence',section:'files'},action:'资料工作区'}))
  const caseCards:MobileCard[]=(current?.sources||[]).filter(source=>source.role==='reference'&&(!direction||!!clean(source.title))).map(source=>({id:source.id,title:source.title,body:clean(source.text)||source.text,eyebrow:'参考原件',facts:[{label:'出处',value:host(source.url)},{label:'日期',value:source.published_at?.slice(0,10)||'未登记'}],refs:[source.id],target:{page:'assessment',section:'cases'},action:'查看案例适用条件'}))
  const paths=strategy?.paths.filter(row=>!direction||row.mode===direction)||[]
  const pathCards:MobileCard[]=paths.map(row=>({id:row.mode,title:row.title,body:clean(row.description),eyebrow:direction?'当前研究方案':'待选择研究方向',facts:[{label:'方向',value:MODE_LABELS[row.mode]},{label:'改造分项',value:`${row.work_packages?.length||row.actions.length}项`}],direction:!direction,target:{page:'scenarios',section:'detail',scheme:row.mode,pane:'content'},action:'打开本方案工作区'}))
  const workCards:MobileCard[]=paths.flatMap(row=>row.work_packages?.length?row.work_packages.map(work=>({id:row.mode+':'+work.id,title:work.target,body:work.intervention,eyebrow:MODE_LABELS[row.mode]+' · '+({first:'优先实施',next:'后续安排',reserve:'备选安排'})[work.priority],facts:[{label:'范围',value:work.scope},{label:'数量',value:work.quantity===null?'待核实':`${work.quantity}${work.unit||''}`},{label:'交付要求',value:work.delivery}],refs:refs(work.evidence_refs),target:{page:'scenarios',section:'detail',scheme:row.mode,pane:'content'},action:'查看具体实施安排'})):row.actions.map((action,index)=>({id:row.mode+':action:'+index,title:clean(action.title)||action.title,body:clean(action.detail),eyebrow:MODE_LABELS[row.mode]+' · 已保存举措',refs:refs(action.evidence_refs),target:{page:'scenarios' as const,section:'detail',scheme:row.mode,pane:'content' as const},action:'查看具体实施安排'})))
  const relevant=new Set(path?.work_packages?.flatMap(work=>work.evidence_refs)||[])
  const moneyCards:MobileCard[]=(current?.cost_reference||[]).filter(row=>!direction||row.source_ids.some(id=>relevant.has(id))).map((row,index)=>({id:'cost-'+index,title:row.scope,body:row.stage==='unknown'?'先核对原件中的计价对象、阶段和单位，再按分项录入本方案。':'按原件阶段和工程范围核对，具体参数在本方案资金工作区采用。',eyebrow:row.stage==='unknown'?'费用原件 · 阶段待核':'分阶段费用参考',facts:[{label:'费用阶段',value:stageNames[row.stage]||row.stage},{label:row.stage==='unknown'?'原件记录':'原件金额范围',value:row.stage==='unknown'?`${row.record_count}条，进入原文分列核对`:row.min_yuan===null||row.max_yuan===null?'未登记':`${(row.min_yuan/10000).toLocaleString('zh-CN')}–${(row.max_yuan/10000).toLocaleString('zh-CN')}万元`},{label:'价格年',value:row.price_year?String(row.price_year):'未登记'}],refs:refs(row.source_ids),target:{page:'scenarios',section:'detail',pane:'funding',scheme:direction||undefined},action:'打开建设与资金'}))
  const roundCards:MobileCard[]=validRounds.slice().sort((a,b)=>b.round_number-a.round_number).map(round=>({id:round.id,title:`第${round.round_number}轮 · 资料v${round.context_version}`,body:round.result?.strategy?.headline||round.error||'本轮还没有保存完整方案。',eyebrow:({completed:'已完成',running:'研究中',failed:'本轮未完成',draft:'草稿',obsolete:'历史记录'})[round.status],facts:[{label:'补充资料',value:`${(round.materials?.length||0)}份`},{label:'待补数据',value:`${(round.missing_materials?.length||0)}项`}],target:{page:'results',section:'history'},action:'查看本轮报告'}))
  if(page==='overview')return [
    {id:'conclusion',label:'结论',cards:[conclusion,...(strategy?.decision_brief?[{id:'investment',title:strategy.decision_brief.investment.conclusion,body:strategy.decision_brief.investment.reason,eyebrow:'投入建议',refs:refs(strategy.decision_brief.investment.evidence_refs),target:{page:'scenarios' as const,section:'compare'},action:'查看方案与测算'},{id:'returns',title:'财务与社会收益',body:'按本轮研究分别查看财务回报和公共服务改善。',eyebrow:'收益判断',facts:[{label:'财务收益',value:strategy.decision_brief.returns.financial},{label:'社会收益',value:strategy.decision_brief.returns.social}],refs:refs(strategy.decision_brief.returns.evidence_refs),target:{page:'scenarios' as const,section:'compare'},action:'查看方案与效果'}]:[])]},
    {id:'object',label:'对象',cards:[object]},
    {id:'investigation',label:'调查',cards:taskCards.length?taskCards:missingTasks},
    {id:'progress',label:'进度',cards:[{id:'progress',title:status,body:state.stale?'已有建议与当前资料版本不同，可在成果页比较补充前后判断。':strategy?'已有分析可继续查看，补充材料后可形成下一轮。':'先整理本项目资料，再形成首轮判断。',facts:[{label:'资料',value:`${project.input.sources.length}份`},{label:'已存轮次',value:String(validRounds.length)},{label:'方案版本',value:current?`v${current.context_version}`:'尚未保存'},{label:'当前资料',value:`v${project.context_version}`}],target:{page:strategy?'results':'evidence',section:strategy?'history':'files',workspace:false},action:strategy?'查看成果与版本':'整理项目资料'}]},
  ]
  if(page==='evidence')return [
    {id:'sources',label:'资料',cards:sourceCards.length?sourceCards:[empty('sources-empty','导入手头已有资料','文件、调查记录和公开来源均从原资料工作区进入。',{page:'evidence',section:'files'},'打开资料导入')]},
    {id:'object',label:'对象',cards:[object]},
    {id:'conditions',label:'条件',cards:conditions},
    {id:'intake',label:'补充',cards:[empty('internal','补充企业内部数据','满意度与幸福感、电梯利用率、食堂用餐人数等可按真实调查日期和样本口径导入。',{page:'evidence',section:'files'},'上传或粘贴调查记录'),empty('experience','项目经验与约束','沿用本项目的经验、原文和审核状态整理适用条件。',{page:'evidence',section:'context'},'打开经验工作区')]},
  ]
  if(page==='assessment')return [
    {id:'direction',label:'方向',cards:[{...conclusion,id:'mode',direction:false,eyebrow:'模式结果待读取',title:'先查看本项目的模式判定',body:'按当前资料与判断标准核对方向，再选择要研究的方案。已保存的模式结果可在工作区继续查看。',target:{page:'assessment',section:'direction',workspace:true},action:'打开模式判定'}]},
    {id:'dimensions',label:'六维',cards:dimensionCards.length?dimensionCards:[empty('dim-empty','六维评价随资料与研判形成','可在完整研判工作区查看已有证据与推理评价。',{page:'assessment',section:'current'},'打开现况评价')]},
    {id:'conditions',label:'条件',cards:conditions},
    {id:'cases',label:'对标',cards:caseCards.length?caseCards:[empty('cases-empty','查看与当前问题相关的案例','打开原案例工作区，按对象、方向和条件核对适用性。',{page:'assessment',section:'cases'},'打开案例匹配')]},
  ]
  if(page==='scenarios')return [
    {id:'scheme',label:'方案',cards:pathCards.length?pathCards:[empty('plan-empty','先明确研究方向与方案','已有分析和工作区仍可查看，尚未生成的方案不补造。',{page:'scenarios',section:'compare'},'打开方案比选')]},
    {id:'measures',label:'举措',cards:workCards.length?workCards:[empty('work-empty','查看本方向的具体安排','楼栋、设施、范围与工程量沿用已保存方案及其原文。',{page:'scenarios',section:'detail',scheme:direction||undefined,pane:'content'},'打开内容与效果')]},
    {id:'funding',label:'资金',cards:moneyCards.length?moneyCards:[empty('cost-empty','按本方案核算建设与资金','采用估算、预算、合同、结算同口径参数，保留资金到位时点和缺口。',{page:'scenarios',section:'detail',scheme:direction||undefined,pane:'funding'},'打开资金测算')]},
    {id:'operations',label:'运营',cards:[empty('operations',direction?`${MODE_LABELS[direction]} · 社区运营`:'先选定方案，再推演运营','拖动服务需求、活动安排与补贴参数，查看服务覆盖和月度收支。',{page:'scenarios',section:'detail',scheme:direction||undefined,pane:'operations'},'打开运营推演'),empty('weights','比较目标偏好','调整本方案的目标权重，查看当前评价与各维贡献。',{page:'scenarios',section:'detail',scheme:direction||undefined,pane:'sensitivity'},'打开敏感性分析')]},
  ]
  if(page==='actions')return [
    {id:'current',label:'调查',cards:taskCards.length?taskCards:missingTasks},
    {id:'conditions',label:'条件',cards:conditions},
    {id:'intake',label:'回填',cards:[empty('task-intake','把新取得的数据带回项目','在任务详情中上传文件、粘贴记录、提取字段；新材料保留与原轮次的关联。',{page:'actions',section:'current'},'打开调查办理'),empty('reassess','补充后再判断','在原方案和新增文件基础上开展下一轮，原轮次和依据保留。',{page:'assessment',section:'direction'},'进入下一轮研判')]},
    {id:'history',label:'历史',cards:roundCards.length?roundCards:[empty('history-empty','调查历史随研究轮次保留','首轮研判后可在这里回看历次调查要求。',{page:'actions',section:'history'},'查看历史工作区')]},
  ]
  const changes:MobileCard[]=(strategy?.round_review?.changes||[]).map((change,index)=>({id:'change-'+index,title:change.topic,body:change.reason,eyebrow:'补充资料后的变化',facts:[{label:'此前',value:change.before},{label:'本轮',value:change.after}],refs:refs(change.evidence_refs),target:{page:'results',section:'history'},action:'查看完整版本对照'}))
  return [
    {id:'report',label:'成果',cards:[strategy?{...conclusion,target:{page:'results',section:'reports'},action:'阅读完整报告'}:empty('report-empty','尚未保存本版本完整报告','已有材料与历史记录继续保留。',{page:'assessment',section:'direction'},'进入改造研判')]},
    {id:'changes',label:'变化',cards:changes.length?changes:[empty('changes-empty','补充前后判断在这里对比','版本变化沿用已保存的两轮资料与分析，不构造未实际发生的效用提升。',{page:'results',section:'history'},'查看决策对比')]},
    {id:'rounds',label:'轮次',cards:roundCards.length?roundCards:[empty('rounds-empty','暂无已存研究轮次','先整理资料并开展首轮研判。',{page:'assessment',section:'direction'},'打开改造研判')]},
    {id:'export',label:'导出',cards:[empty('export','导出本轮成果与依据','从原成果工作区导出Markdown、JSON或阅读报告，保留原文、版本与引用关系。',{page:'results',section:'reports'},'打开成果导出')]},
  ]
}
