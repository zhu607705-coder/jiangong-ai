import type { OperationsInput, OperationsResult } from '../../apps/host/generated/contracts'
import { explorationInput, type ExplorationParameters } from './visual-analysis'
import type { CompleteCommunityDemo } from './complete-demo'

export type DemoPlan = { name: string; parameters: ExplorationParameters; input: OperationsInput; result: OperationsResult }

export function readDemoPlans(demo: CompleteCommunityDemo, value: unknown): DemoPlan[] {
  if (!Array.isArray(value)) return []
  return value.filter((plan): plan is DemoPlan => {
    try {
      explorationInput(demo, plan.parameters)
      return typeof plan.name === 'string' && plan.input?.facility_id === demo.operations.facility_id
        && plan.input?.period === demo.operations.period && Array.isArray(plan.result?.services)
        && ['served_visits', 'unique_users', 'balance_after_support', 'government_outlay'].every(key => Number.isFinite(plan.result?.metrics?.[key]))
    } catch { return false }
  }).slice(0, 3)
}

/** Stored numeric inputs and outputs; no inferred decision revision or causal attribution. */
export function compareDemoPlans(before: DemoPlan, after: DemoPlan) {
  const unmet = (plan: DemoPlan) => plan.result.services.some(row => row.unmet_visits == null) ? null : plan.result.services.reduce((sum, row) => sum + row.unmet_visits!, 0)
  const rows = [
    ['居民服务需求', before.parameters.demand * 100, after.parameters.demand * 100, '%'],
    ['活动室开放', before.parameters.activitySlots, after.parameters.activitySlots, '场/月'],
    ['运营补贴', before.parameters.subsidy, after.parameters.subsidy, '元/月'],
    ['月度服务', before.result.metrics.served_visits, after.result.metrics.served_visits, '人次/月'],
    ['覆盖居民', before.result.metrics.unique_users, after.result.metrics.unique_users, '人/月'],
    ['尚未满足需求', unmet(before), unmet(after), '人次/月'],
    ['支持后现金结余', before.result.metrics.balance_after_support, after.result.metrics.balance_after_support, '元/月'],
    ['政府总投入', before.result.metrics.government_outlay, after.result.metrics.government_outlay, '元/月'],
  ] as const
  return rows.map(([label, from, to, unit]) => ({label, from, to, unit, delta: from == null || to == null ? null : Math.round((to - from) * 100) / 100}))
}

export const demoInvestigations = [
  {id:'schedule', priority:1, title:'核实开放排班与人员承载', object:'社区服务中心运营方、社区岗位负责人', method:'核对活动室预约表、人员排班和实际开放时段，现场抽查两个工作日。', fields:'房间、席位、开放日期、每场时长、岗位工时、额外人工费用', done:'排班表与人员工时能够逐场对应，并确认15–45场/月是否需要增加人工预算。'},
  {id:'visits', priority:1, title:'核实真实需求与月度覆盖', object:'助餐点、活动室、咨询服务窗口及居民样本', method:'取得同一月份匿名服务登记，按居民匿名编号跨服务去重；按年龄和楼栋抽样回访。', fields:'月份、日期、服务类别、匿名居民编号、场次、收费、未能预约人次', done:'原始登记与月度汇总核对一致，能直接计算去重人数与未满足需求，替换5.433333次/人的模拟假设。'},
  {id:'funding', priority:1, title:'核实政府投入与运营收支', object:'街道财务、服务采购负责人、运营机构', method:'分别核对服务采购合同、补贴文件、政府直付和运营方月度凭证。', fields:'合同期间、购买服务、运营补贴、直接支付、居民收费、固定与变动支出', done:'每笔金额都可定位至合同或凭证，财政与运营现金分账勾稽一致。'},
  {id:'cost', priority:2, title:'补齐工程造价训练样本', object:'浙江已实施项目的建设单位、采购与结算档案', method:'按项目和标段关联公告、控制价清单、合同、竣工结算及面积说明；先收集杭州和浙江同类工程。', fields:'EPC或施工范围、价格阶段、建筑面积、分部分项费用、六类改造覆盖、施工条件、使用年限、其他费用、工期、结算金额', done:'同一工程的输入与竣工单方成本可追溯，特征单位统一，项目分组可用于浙江独立测试。'},
  {id:'residents', priority:2, title:'核实居民协商与工程条件', object:'15幢居民代表、物业、专项工程人员', method:'逐栋核对住户协商记录及供水、无障碍、结构检测资料，明确异议与未签署住户的诉求。', fields:'楼栋、住户数、协商日期、支持/异议/未签署、权属、检测结论、专项工程接口', done:'每栋有同一时点的协商清单，关键工程条件有可定位原件，能据此修订六维现况与实施顺序。'},
] as const

export type InvestigationProgress = {status:'pending'|'doing'|'done'; note:string; evidence:string}
export const emptyProgress: InvestigationProgress = {status:'pending', note:'', evidence:''}
export function validInvestigationProgress(value: unknown): InvestigationProgress {
  const row = value as Partial<InvestigationProgress> | null
  if (!row || !['pending','doing','done'].includes(row.status || '') || typeof row.note !== 'string' || typeof row.evidence !== 'string') return {...emptyProgress}
  // Completion in the demonstration requires a traceable note; it never verifies real evidence.
  if (row.status === 'done' && (!row.note.trim() || !row.evidence.trim())) return {...emptyProgress, note:row.note, evidence:row.evidence}
  return row as InvestigationProgress
}
