import type { MapDecisionFactor, MapScreenContext, MapScreenTheme } from '../../apps/host/generated/contracts'
import { factAppliesToTarget } from './object-identity'

export const FACTOR_LABELS = {
  implementation: '实施条件', adaptation: '空间适配', demand: '使用需求',
  operations: '运营组织', resources: '资源安排', access: '交通衔接',
} as const
export type FactorKey = keyof typeof FACTOR_LABELS
// An explicit, versioned research rubric, not a statistical success score.
export const FACTOR_POLICY = 'source-factors-v1'
export const FACTOR_FIELDS: Record<FactorKey, readonly string[]> = {
  implementation: ['use_permitted', 'rights_secured', 'relocation_resolved'],
  adaptation: ['structural_fit_verified', 'fire_strategy_verified'],
  demand: ['user_need_verified', 'competing_supply_absorbable'],
  operations: ['operator_committed', 'revenue_path_verified'],
  resources: ['phase_funding_secured', 'capex_affordable'],
  access: ['walk_connection_verified'],
}
const FIELD_LABELS: Record<string, string> = {
  use_permitted:'用途适配', rights_secured:'权利取得', relocation_resolved:'腾退安排',
  structural_fit_verified:'结构适配', fire_strategy_verified:'消防路径', user_need_verified:'使用需求',
  competing_supply_absorbable:'同类供给消化', operator_committed:'运营主体', revenue_path_verified:'收入来源',
  phase_funding_secured:'分期资金', capex_affordable:'改造投入', walk_connection_verified:'步行接驳',
}
/** Only current, object-bound boolean source facts enter the screening rubric.
 * Raw POI counts, publication counts, model prose and city background never enter it. */
export function decisionFactors(context: MapScreenContext, evaluatedAt=context.created_at): MapDecisionFactor[] {
  const asOf = Date.parse(evaluatedAt)
  return (Object.keys(FACTOR_LABELS) as FactorKey[]).map(key => {
    const rows = context.local_projects.filter(p => p.relation === 'within_scope').flatMap(p => p.facts.flatMap(f => {
      const field = f.kind.replace(/^screening\./, '')
      const source = p.sources.find(s => s.id === f.source_id)
      const observed = Date.parse(f.observed_at || '')
      const expired=source?.expires_at!==undefined&&(!Number.isFinite(Date.parse(source.expires_at))||Date.parse(source.expires_at)<=asOf)
      const invalidPublication=source?.published_at!==undefined&&(!Number.isFinite(Date.parse(source.published_at))||Date.parse(source.published_at)>asOf)
      if (!f.kind.startsWith('screening.') || !FACTOR_FIELDS[key].includes(field) || typeof f.value !== 'boolean'
          || !factAppliesToTarget(f,p,context.target)
          || !f.locator || !f.object_ref || !source || source.synthetic || source.content_status === 'metadata_only'
          || expired || invalidPublication || source.date_status==='conflict'
          || !Number.isFinite(observed) || observed > asOf || asOf - observed > 180 * 86400000) return []
      return [{ field, value:f.value, ref:`${p.project_id}:${f.source_id}`, project:p.project_id, subject:`${p.project_id}:${f.object_ref}` }]
    }))
    const negative = rows.filter(r => !r.value)
    const positive = rows.filter(r => r.value)
    // Opposing claims on the same subject stay conditional rather than overwriting each other.
    const conflict = negative.some(n => positive.some(p => p.field === n.field && p.subject === n.subject))
    const subjects = [...new Set(rows.map(r => r.subject))]
    const scopedProjects = context.local_projects.filter(p => p.relation === 'within_scope')
    const allCovered = subjects.length > 0 && subjects.every(subject => FACTOR_FIELDS[key].every(field => rows.some(r => r.subject === subject && r.field === field && r.value)))
      && scopedProjects.every(p => rows.some(r => r.project === p.project_id))
    const state = conflict ? 'conditional' : negative.length ? 'blocked' : allCovered ? 'supported' : positive.length ? 'conditional' : 'unknown'
    return { key, state, summary: conflict ? `${FACTOR_LABELS[key]}资料存在分歧` : negative.length ? `${FIELD_LABELS[negative[0].field]}受限` : positive.length ? `${[...new Set(positive.map(r => FIELD_LABELS[r.field]))].join('、')}已有依据` : `${FACTOR_LABELS[key]}待核查`,
      evidence_refs:[...new Set(rows.map(r => r.ref))].slice(0,4), quote:'', conflict } as MapDecisionFactor
  })
}
export function factorTier(factors: MapDecisionFactor[], theme: MapScreenTheme) {
  const rows = theme === 'overall' ? factors : factors.filter(f => f.key === (theme==='supply'?'demand':theme))
  if (rows.some(f => f.state === 'blocked')) return 'sparse' as const
  if (rows.some(f => f.conflict)) return 'moderate' as const
  if (theme !== 'overall') return rows.some(f => f.state === 'supported') ? 'strong' as const : rows.some(f => f.state === 'conditional') ? 'moderate' as const : 'incomplete' as const
  const essential = ['implementation','adaptation','demand','operations','resources']
  if (essential.every(k => rows.some(f => f.key === k && f.state === 'supported'))) return 'strong' as const
  return rows.some(f => f.state === 'supported' || f.state === 'conditional') ? 'moderate' as const : 'incomplete' as const
}

export type DecisionSignal = { title:string; observation:string; implication:string; next:string }
/** Small deterministic previews, created only for the selected context; no LLM call. */
export function decisionSignals(context: MapScreenContext): DecisionSignal[] {
  const result: DecisionSignal[] = []
  const samples = (key:string) => context.groups.find(g => g.key === key)?.sample || []
  const campus=samples('civic').filter(p=>/大学|校区/.test(p.name))
  if(/大学|校区/.test(context.target?.label||'')||campus.length)return [{title:'校园服务',observation:context.target?.label||campus.slice(0,2).map(p=>p.name).join('、'),implication:'先查修缮采购和后勤服务，再比较校外配套。',next:'查采购计划、建设项目和教学运行安排。'}]
  const office = samples('work_live').filter(p => /商务|写字楼|办公|产业园/.test(p.category))
  const homes = samples('work_live').filter(p => /住宅|小区|公寓/.test(p.category))
  if (office.length) result.push({title:'办公线索', observation:office.slice(0,2).map(p=>p.name).join('、'), implication:'优先调查工作日餐饮与企业服务。', next:'核查入驻企业、实际到岗和楼宇空置。'})
  else if (homes.length) result.push({title:'居住线索', observation:homes.slice(0,2).map(p=>p.name).join('、'), implication:'优先调查社区服务与日常消费。', next:'核查常住人群和服务使用情况。'})
  const commerce = samples('activity')
  if (commerce.length) result.push({title:'现有配套', observation:commerce.slice(0,2).map(p=>p.name).join('、'), implication:'先比较同类供给，再选择补充业态。', next:'核查空铺、营业时段与稳定客群。'})
  const transit = samples('transit')
  if (result.length < 2 && transit.length) result.push({title:'交通节点', observation:transit.slice(0,2).map(p=>p.name).join('、'), implication:'调查站点到建筑入口的实际步行衔接。', next:'核查过街设施、阻隔与通行时间。'})
  return result.slice(0,2)
}
