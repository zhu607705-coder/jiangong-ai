import type {ProjectInput,RenewalStrategy,RenewalResearchNote} from '../../apps/host/generated/contracts'
import type {StrategyPacket} from './strategy'
import {projectRenewalModeInput} from './renewal-mode'
/** Host rendering of saved structured work, with explicit scenarios; never an invented model success. */
export function conditionalReport(project:ProjectInput,base:StrategyPacket,notes:readonly RenewalResearchNote[],reason:string):StrategyPacket{
  const current=base.sources.filter(source=>source.role==='current'&&source.object_binding?.relation!=='different_object'),first=current[0]
  const quote=first?.text.slice(0,Math.min(180,first.text.length))||'',refs=first?[first.id]:[]
  const dimensions=[['demand','居民需求','high','假设存在未满足的居民需求','通过分层住户问卷核对需求与幸福度。'],['supply','公共服务','low','假设设施使用与可达服务仍有缺口','采集服务点位、开放时段及真实使用人次。'],['adaptation','居住工程','medium','假设可保留建筑主体并实施局部维修','取得逐栋结构鉴定和分项设计。'],['implementation','实施协同','low','实施边界、业主决议和施工安排仍需核实','核对权属、居民决议及分期实施条件。'],['operations','长效维护','medium','假设能落实维护主体和服务排班','取得电梯使用、食堂就餐与维护台账。'],['resources','资金交付','low','资金总盘与到账时点尚待核实','按预算、合同、结算分列取得资金凭证。']] as const
  const proposed=notes.flatMap(note=>note.reasoned_proposals||[])
  const actions=proposed.slice(0,4).map(proposal=>({title:proposal.conclusion.slice(0,60),detail:[proposal.conclusion,...proposal.assumptions].join('；').slice(0,1000),evidence_refs:proposal.evidence_refs.filter(id=>base.sources.some(source=>source.id===id))}))
  const checks=[...new Set([...notes.flatMap(note=>note.missing_data),...projectRenewalModeInput(project).conditions.filter(condition=>condition.state==='unknown'||condition.state==='conflict').map(condition=>condition.kind)])]
  const strategy:RenewalStrategy={headline:`${project.scope.name}：先形成分项更新与投入核查方案`,summary:`${reason}。已保留本轮取得的原文和专家成果；以下列出可研究的具体动作、适用前提与后续资料。`,preferred_mode:'compare',
    rationale:first&&quote.length>=8?[{point:'采用本轮已取得的对象资料，按其原始范围和阶段研究。',source_id:first.id,quote}]:[],
    paths:(['comprehensive','rebuild'] as const).map(mode=>({mode,title:mode==='comprehensive'?'保留建筑的分项更新条件方案':'拆建必要性与实施条件的专题方案',description:mode==='comprehensive'?'先研究给排水、电气、消防及公共服务设施的分项改善，按实际楼栋和实施条件确定工程量。':'在结构、规划、居民决议与资金条件明确后，研究原地重建、安置与配套设施组织。',actions:actions.length?actions:[{title:mode==='comprehensive'?'给排水与电气设施分段更新':'重建与安置组织方案',detail:mode==='comprehensive'?'在假设保留建筑可修缮的条件下，研究分段更换受损管线、设置分区检修阀、改善消防通道与无障碍通行；工程数量取自后续现场测绘。':'研究分期腾退、过渡服务、回搬顺序与新建配套；在必要性和实施条件确认前作为备选方案进行测算。',evidence_refs:[]}],requirements:['核对本对象边界、逐栋专业资料及分期资金。'],work_packages:[]})),
    dimensions:dimensions.map(([key,label])=>({key,current:`${label}现况按本轮原文保留，未核实字段仍待核。`,current_level:'unknown',comprehensive:`按分项改善方案核对${label}的预期变化。`,comprehensive_level:'unknown',rebuild:`按拆建专题方案核对${label}的预期变化。`,rebuild_level:'unknown',evidence_refs:[]})),
    reasoning_dimensions:dimensions.map(([key,_label,level,premise,verification])=>({key,level,basis:'scenario_assumption',premises:['当前资料未覆盖该维度的全部事实。'],assumptions:[premise],reason:'这是明确前提下的规则情景等级，用于继续比较与补充资料，不作为现况统计。',verification,evidence_refs:[]})),
    next_checks:checks.slice(0,5).map(title=>({title,detail:'补充与本对象、范围、日期及金额阶段对应的原始资料；取得后更新受影响判断。',evidence_refs:[]})),
    internal_data_requests:[]}
  return {...base,status:'completed',strategy,error:null,delivery:{run_status:'completed',evidence_status:current.length?'partial':'none',report_status:'conditional',renderer:'host_structured_fallback',reason},content_review:{policy:'advisory-v1',status:'needs_review',checked_at:new Date().toISOString(),issues:[{code:'SYNTHESIS_CONDITIONAL_RENDER',path:'strategy',message:'综合模型本次未返回完整方案，已按保存的原文、专家成果及显式情景形成条件报告。'}],follow_up:{search_queries:[`${project.scope.name} 更新改造 项目地址 工程量 预算`],reading_focus:['补读未覆盖的问题和原件附件，核对条件及金额阶段。'],internal_data:['居民幸福度调查、电梯使用记录、社区食堂实际用餐人数及分项资金台账。']}}}
}
