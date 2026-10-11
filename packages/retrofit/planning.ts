import type { Fact, ProjectInput, DecisionPacket, ResearchDimension, Source } from '../../apps/host/generated/contracts'
import { factAppliesToTarget } from '../maps/object-identity'
import { NEIGHBORHOOD_DIMENSION_POLICY, RETROFIT_ACTION_LABELS, RETROFIT_CHECKS, RETROFIT_VETOES, RETROFIT_RULE_VERSION, type RetrofitCheckKey, type RetrofitVetoKey } from './policy'
export { RETROFIT_CHECKS, RETROFIT_VETOES, RETROFIT_RULE_VERSION } from './policy'

export type RetrofitAdvice = { decision: 'proceed'|'supplement'|'defer'; label: string; rule_version: string; reasons: { text: string; evidence_refs: string[] }[]; missing: { key: string; label: string; where: string; impact: string }[] }
export type RetrofitEvidence = Pick<ProjectInput, 'project_id'|'as_of'|'synthetic'|'sources'|'facts'>
export type RetrofitConditionState = 'confirmed'|'unmet'|'missing'|'conflict'
export type RetrofitConditionCheck = { key: RetrofitCheckKey; label: string; where: string; impact: string; state: RetrofitConditionState; fact_refs: string[]; evidence_refs: string[] }
export type RetrofitVetoCondition = { key: RetrofitVetoKey; label: string; state: 'veto'|'clear'|'missing'|'conflict'; fact_refs: string[]; evidence_refs: string[] }
export type RetrofitDimensionCondition = { key: ResearchDimension; label: string; state: RetrofitConditionState|'veto'; checks: RetrofitConditionCheck[]; evidence_refs: string[] }
export type RetrofitAdmissionNote = { fact_id: string; source_id: string; locator: string|null; reason: string }
export type RetrofitConditions = {
  evaluated_as_of: string; rule_version: string; dimensions: RetrofitDimensionCondition[];
  rule_confirmation: RetrofitConditionCheck; checks: RetrofitConditionCheck[]; vetoes: RetrofitVetoCondition[];
  evidence_refs: string[]; unusable_fact_refs: string[]; admission_notes: RetrofitAdmissionNote[];
}
const unique = (refs: string[]) => [...new Set(refs)]
function cutoff(asOf: string): number {
  const at = Date.parse(asOf + 'T23:59:59Z')
  return /^\d{4}-\d{2}-\d{2}$/.test(asOf) && Number.isFinite(at) && new Date(at).toISOString().slice(0, 10) === asOf ? at : NaN
}
function admissionReason(project: RetrofitEvidence, fact: Fact, source: Source|undefined, asOf: number, scalarCondition = false): string|null {
  const objectRef = `project:${project.project_id}`
  if (!Number.isFinite(asOf)) return '项目研究截止时点无效'
  if (!source) return '来源未关联当前项目'
  if (!(source.hash || source.raw_hash)?.trim()) return '来源版本未提供'
  if (source.synthetic !== project.synthetic) return '来源与项目的合成数据标记不一致'
  if (source.content_status === 'metadata_only' || source.parse_status === 'ocr_required') return '来源尚无可读正文证据'
  if (source.evidence_scope === 'area' || source.evidence_scope === 'background') return '区域或背景来源不能确认本项目条件'
  if (source.object_refs !== undefined && !source.object_refs.includes(objectRef)) return '来源明确对象不包含当前项目'
  if (fact.epistemic_status !== 'fact' || (scalarCondition
    ? !['string', 'number', 'boolean'].includes(typeof fact.value) || typeof fact.value === 'number' && !Number.isFinite(fact.value) || typeof fact.value === 'string' && !fact.value.trim()
    : typeof fact.value !== 'boolean')) return scalarCondition ? '未形成明确的条件事实' : '未形成明确的布尔确认事实'
  if (fact.object_ref !== objectRef) return '事实未精确绑定当前项目'
  if (fact.scope_kind !== undefined && !['object', 'project', 'shared'].includes(fact.scope_kind)) return '事实作用域未登记'
  if (!factAppliesToTarget(fact, project, { object_ref: objectRef, boundary_source: objectRef })) return '共享事实不适用于当前项目'
  if (!fact.locator?.trim()) return '原文定位未提供'
  const observed = Date.parse(fact.observed_at || '')
  if (!Number.isFinite(observed) || observed > asOf) return '观察时点缺失、无效或晚于研究截止'
  if (source.date_status === 'conflict') return '来源日期存在分歧'
  if (source.published_at && (!Number.isFinite(Date.parse(source.published_at)) || Date.parse(source.published_at) > asOf)) return '来源发布日期无效或晚于研究截止'
  if (source.expires_at && (!Number.isFinite(Date.parse(source.expires_at)) || Date.parse(source.expires_at) <= asOf)) return '来源有效期无效或已届满'
  return null
}
export function retrofitFactUsable(project: RetrofitEvidence, fact: Fact): boolean {
  return admissionReason(project, fact, project.sources.find(source => source.id === fact.source_id), cutoff(project.as_of)) === null
}
/** Share provenance, object and time checks with case/rule condition matching. */
export function projectFactUsable(project: RetrofitEvidence, fact: Fact): boolean {
  return admissionReason(project, fact, project.sources.find(source => source.id === fact.source_id), cutoff(project.as_of), true) === null
}
/** Evaluate the existing explicit confirmations once. Missing/negative/conflict
 * remain distinct; fit scores, counts and policy aspirations never become facts. */
export function evaluateRetrofitConditions(project: RetrofitEvidence): RetrofitConditions {
  const sources = new Map<string, Source>()
  // Match the legacy find() ownership rule even for a malformed duplicate ID.
  for (const source of project.sources) if (!sources.has(source.id)) sources.set(source.id, source)
  const registered = new Set([...RETROFIT_CHECKS.map(check => 'retrofit.' + check.key), ...Object.keys(RETROFIT_VETOES).map(key => 'retrofit.' + key)])
  const byKind = new Map<string, Fact[]>(), asOf = cutoff(project.as_of), admission_notes: RetrofitAdmissionNote[] = [], admitted: Fact[] = []
  const dimensionByKind = new Map(NEIGHBORHOOD_DIMENSION_POLICY.flatMap(policy => [...policy.confirmationKeys, ...policy.vetoKeys].map(key => ['retrofit.' + key, policy.key] as const)))
  const dimensionRefs = new Map<ResearchDimension, string[]>()
  for (const fact of project.facts) {
    if (!registered.has(fact.kind)) continue
    const reason = admissionReason(project, fact, sources.get(fact.source_id), asOf)
    if (reason) { admission_notes.push({ fact_id: fact.id, source_id: fact.source_id, locator: fact.locator || null, reason }); continue }
    const rows = byKind.get(fact.kind) || []
    rows.push(fact); byKind.set(fact.kind, rows); admitted.push(fact)
    const dimension = dimensionByKind.get(fact.kind)
    if (dimension) { const refs = dimensionRefs.get(dimension) || []; refs.push(fact.source_id); dimensionRefs.set(dimension, refs) }
  }
  function claims(key: string) {
    const rows = byKind.get('retrofit.' + key) || []
    let positive = false, negative = false
    for (const row of rows) { positive ||= row.value === true; negative ||= row.value === false }
    return { rows, positive, negative, fact_refs: unique(rows.map(row => row.id)), evidence_refs: unique(rows.map(row => row.source_id)) }
  }
  const checks: RetrofitConditionCheck[] = RETROFIT_CHECKS.map(check => {
    const { positive, negative, fact_refs, evidence_refs } = claims(check.key)
    return { ...check, state: positive && negative ? 'conflict' : positive ? 'confirmed' : negative ? 'unmet' : 'missing', fact_refs, evidence_refs }
  })
  const vetoes: RetrofitVetoCondition[] = (Object.keys(RETROFIT_VETOES) as RetrofitVetoKey[]).map(key => {
    const { positive, negative, fact_refs, evidence_refs } = claims(key)
    return { key, label: RETROFIT_VETOES[key], state: positive && negative ? 'conflict' : positive ? 'veto' : negative ? 'clear' : 'missing', fact_refs, evidence_refs }
  })
  const checkByKey = new Map(checks.map(check => [check.key, check])), vetoByKey = new Map(vetoes.map(veto => [veto.key, veto]))
  const dimensions: RetrofitDimensionCondition[] = NEIGHBORHOOD_DIMENSION_POLICY.map(policy => {
    const ownChecks = policy.confirmationKeys.map(key => checkByKey.get(key)!), ownVetoes = policy.vetoKeys.map(key => vetoByKey.get(key)!)
    const state = ownVetoes.some(veto => veto.state === 'veto') ? 'veto'
      : ownChecks.some(check => check.state === 'conflict') || ownVetoes.some(veto => veto.state === 'conflict') ? 'conflict'
        : ownChecks.some(check => check.state === 'unmet') ? 'unmet'
          : ownChecks.some(check => check.state === 'missing') ? 'missing' : 'confirmed'
    return { key: policy.key, label: policy.label, state, checks: ownChecks, evidence_refs: unique(dimensionRefs.get(policy.key) || []) }
  })
  return { evaluated_as_of: project.as_of, rule_version: RETROFIT_RULE_VERSION, dimensions, rule_confirmation: checkByKey.get('rule_set_confirmed')!,
    checks, vetoes, evidence_refs: unique(admitted.map(fact => fact.source_id)), unusable_fact_refs: unique(admission_notes.map(note => note.fact_id)), admission_notes }
}
/** A business gate over the same condition evaluation used by the map and UI. */
export function retrofitAdvice(project: RetrofitEvidence): RetrofitAdvice {
  return retrofitAdviceFromConditions(evaluateRetrofitConditions(project))
}
export function retrofitAdviceFromConditions(evaluation:RetrofitConditions):RetrofitAdvice {
  const veto = evaluation.vetoes.find(row => row.state === 'veto')
  const missing: RetrofitAdvice['missing'] = evaluation.checks.filter(check => check.state !== 'confirmed').map(({ key, label, where, impact }) => ({ key, label, where, impact }))
  for (const row of evaluation.vetoes) if (row.state === 'conflict') missing.push({ key: row.key, label: `${row.label}存在冲突`, where: '回查同一对象的相反证据并由专业人员复核', impact: '当前方案是否必须暂缓' })
  if (veto) return { decision: 'defer', label: RETROFIT_ACTION_LABELS.defer, rule_version: RETROFIT_RULE_VERSION, reasons: [{ text: veto.label, evidence_refs: veto.evidence_refs }], missing }
  if (missing.length) return { decision: 'supplement', label: RETROFIT_ACTION_LABELS.supplement, rule_version: RETROFIT_RULE_VERSION, reasons: [{ text: '以下资料或规则会改变当前改造方案的范围与实施安排。', evidence_refs: [] }], missing }
  return { decision: 'proceed', label: RETROFIT_ACTION_LABELS.proceed, rule_version: RETROFIT_RULE_VERSION, reasons: [{ text: '当前方案的七项前置核查均有项目范围内的确认依据。', evidence_refs: evaluation.evidence_refs }], missing: [] }
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
  packet.summary=[advice.label,advice.decision==='defer'?advice.reasons[0].text:advice.missing[0]?.label||'开展改造方案专项调查'].join('：')
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
