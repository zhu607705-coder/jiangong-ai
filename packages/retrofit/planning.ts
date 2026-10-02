import type { Fact, ProjectInput, DecisionPacket } from '../../apps/host/generated/contracts'

export const RETROFIT_RULE_VERSION = 'neighborhood-action-v1'
export const RETROFIT_CHECKS = [
  { key: 'resident_needs_confirmed', label: '居民需求与异议', where: '分楼栋问卷、社区走访及异议台账', impact: '改造内容、优先顺序与居民负担' },
  { key: 'engineering_review_passed', label: '方案相关工程评审', where: '原图纸、专业检测及消防/管网核查', impact: '工程范围、安全前置条件与施工组织' },
  { key: 'service_gap_confirmed', label: '公共服务缺口', where: '设施名录、容量和开放时间、实测步行路线', impact: '养老托育、无障碍和配套设施配置' },
  { key: 'scope_and_consent_confirmed', label: '实施范围与居民协同', where: '年度计划、权属资料、方案公示及居民协商记录', impact: '实施主体、项目边界与扰民安排' },
  { key: 'funding_confirmed', label: '预算与资金落实', where: '工程量预算、资金批准/分摊确认及拨付安排', impact: '资金缺口、分期与交付范围' },
  { key: 'maintenance_confirmed', label: '长效维护安排', where: '设施接收、物业合同、管护预算及收费协商', impact: '改造后的责任、年度支出和持续使用' },
  { key: 'rule_set_confirmed', label: '本方案专业规则复核', where: '企业人员与专业人员确认的规则版本及适用范围', impact: '是否允许推进尽调的业务门槛' },
] as const
const VETOES = { safety_veto: '已确认的方案安全否决条件', rights_veto: '已确认的权属或实施权限否决条件', protection_veto: '已确认的保护要求与方案冲突' } as const
export type RetrofitAdvice = { decision: 'proceed'|'supplement'|'defer'; label: string; rule_version: string; reasons: { text: string; evidence_refs: string[] }[]; missing: { key: string; label: string; where: string; impact: string }[] }
function usable(project: ProjectInput, fact: Fact): boolean {
  const source = project.sources.find(s => s.id === fact.source_id), date = Date.parse(fact.observed_at || ''), asOf = Date.parse(project.as_of + 'T23:59:59Z')
  return !!source && !!(source.hash || source.raw_hash) && source.synthetic === project.synthetic && source.content_status !== 'metadata_only'
    && fact.epistemic_status === 'fact' && typeof fact.value === 'boolean' && fact.object_ref === `project:${project.project_id}` && !!fact.locator
    && Number.isFinite(date) && date <= asOf && source.date_status !== 'conflict'
    && (!source.published_at || Number.isFinite(Date.parse(source.published_at)) && Date.parse(source.published_at) <= asOf)
    && (!source.expires_at || Number.isFinite(Date.parse(source.expires_at)) && Date.parse(source.expires_at) > asOf)
}
/** A business gate over explicit project-bound facts; fit scores never enter it. */
export function retrofitAdvice(project: ProjectInput): RetrofitAdvice {
  const facts = project.facts.filter(f => f.kind.startsWith('retrofit.') && usable(project, f))
  const rows = (key: string) => facts.filter(f => f.kind === 'retrofit.' + key)
  const conflict = (key: string) => rows(key).some(f => f.value === true) && rows(key).some(f => f.value === false)
  const veto = Object.entries(VETOES).find(([key]) => !conflict(key) && rows(key).some(f => f.value === true))
  const missing:RetrofitAdvice['missing'] = RETROFIT_CHECKS.filter(check => conflict(check.key) || !rows(check.key).length || rows(check.key).some(f => f.value !== true)).map(check => ({ ...check }))
  for (const [key, label] of Object.entries(VETOES)) if (conflict(key)) missing.push({ key, label: `${label}存在冲突`, where: '回查同一对象的相反证据并由专业人员复核', impact: '当前方案是否必须暂缓' })
  if (veto) return { decision: 'defer', label: '当前条件下暂缓', rule_version: RETROFIT_RULE_VERSION, reasons: [{ text: veto[1], evidence_refs: rows(veto[0]).filter(f => f.value === true).map(f => f.source_id) }], missing }
  if (missing.length) return { decision: 'supplement', label: '先补充关键资料再判断', rule_version: RETROFIT_RULE_VERSION, reasons: [{ text: '以下资料或规则会改变当前改造方案的范围与实施安排。', evidence_refs: [] }], missing }
  return { decision: 'proceed', label: '建议进一步尽调', rule_version: RETROFIT_RULE_VERSION, reasons: [{ text: '当前方案的七项前置核查均有项目范围内的确认依据。', evidence_refs: [...new Set(facts.map(f => f.source_id))] }], missing: [] }
}
export type RetrofitPlan = { basic: number|null; improvement: number|null; enhancement: number|null; reserve_percent: number; planned_funding: number|null; households: number|null }
/** User-entered scheme assumptions only; this result never alters the fact gate. */
export function calculateRetrofitPlan(plan: RetrofitPlan) {
  for (const value of [plan.basic,plan.improvement,plan.enhancement,plan.planned_funding,plan.households]) if (value !== null && (!Number.isFinite(value) || value < 0)) throw new Error('方案参数必须为非负有限数')
  if (!Number.isFinite(plan.reserve_percent) || plan.reserve_percent < 0 || plan.reserve_percent > 100) throw new Error('预备费比例须在0–100%')
  const costs = [plan.basic,plan.improvement,plan.enhancement], known = costs.every(value => value !== null)
  const subtotal = known ? costs.reduce<number>((sum,value)=>sum+value!,0) : null
  const total = subtotal === null ? null : Math.round(subtotal * (1 + plan.reserve_percent / 100) * 100) / 100
  return { subtotal, total, funding_gap: total === null || plan.planned_funding === null ? null : Math.max(0, Math.round((total-plan.planned_funding)*100)/100),
    per_household: total === null || !plan.households ? null : Math.round(total/plan.households*100)/100 }
}

/** Apply the same evidence gate after model output and before publishing the packet. */
export function applyNeighborhoodGate(project:ProjectInput, packet:DecisionPacket):DecisionPacket {
  if(project.business_profile!=='neighborhood')return packet
  const advice=retrofitAdvice(project)
  packet.neighborhood_action=advice
  packet.summary=[advice.label,advice.decision==='defer'?advice.reasons[0].text:advice.missing[0]?.label||'进入方案专项尽调'].join('：')
  if(advice.decision==='defer')for(const scenario of packet.scenarios)if(scenario.id!=='defer_and_investigate'){
    scenario.status='blocked';scenario.blockers=[...new Set([...scenario.blockers,...advice.reasons.map(r=>r.text)])]
    scenario.evidence_refs=[...new Set([...scenario.evidence_refs,...advice.reasons.flatMap(r=>r.evidence_refs)])]
  }
  packet.followups=advice.missing.map((check,index)=>({id:'RETROFIT-'+check.key,priority:index<2?1:2,title:check.label+'：'+check.where,why:'补齐后检查：'+check.impact,impacted_paths:packet.scenarios.map(s=>s.id),status:'suggested'}))
  if(advice.decision==='defer'){
    packet.reviews=packet.reviews.filter(r=>r.id!=='REV-SAFETY')
    packet.reviews.push({id:'REV-RETROFIT-VETO',severity:'high',issue:advice.reasons[0].text,target_refs:packet.scenarios.filter(s=>s.status==='blocked').map(s=>s.id),evidence_refs:advice.reasons.flatMap(r=>r.evidence_refs),recommendation:'暂停当前方案的建设推进，由相应专业人员确认可调整范围与解除条件。'})
    packet.followups.unshift({id:'RETROFIT-VETO',priority:1,title:'对照否决依据调整本方案并专业复核',why:advice.reasons[0].text,impacted_paths:packet.scenarios.filter(s=>s.status==='blocked').map(s=>s.id),status:'suggested'})
  }
  if(packet.comparison){packet.comparison.summary=packet.summary;packet.comparison.tied_paths=packet.comparison.tied_paths.filter(id=>packet.scenarios.find(s=>s.id===id)?.status!=='blocked');packet.comparison.followups=packet.followups}
  return packet
}
