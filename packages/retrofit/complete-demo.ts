import type { DecisionDashboard, OperationsInput, OperationsValue, ResearchDimension } from '../../apps/host/generated/contracts'
import { dashboardDimensions, NEIGHBORHOOD_DASHBOARD_POLICY } from '../decision/dashboard'
import { calculateRetrofitPlan } from './planning'
import { table } from '../../vendor/cre/scripts/lib/report-table'

export type DemoProvenance = { id: string; label: string; kind: 'reference' | 'assumption' | 'derived'; source: string; basis: string }
export type DemoLedgerRow = { id: string; period: string; date: string; service_id: string; slot: string; resident_id: string; paid: boolean; charge: number; variable_cost: number; kind: 'synthetic' }
export type DemoDimension = { key: ResearchDimension; label: string; before: string; after: string; beforeRatio: number; afterRatio: number; source: string }
export type CompleteCommunityDemo = ReturnType<typeof buildCompleteCommunityDemo>

const round = (value: number) => Math.round(value * 100) / 100
const score = (ratio: number) => Math.round((1 + 4 * Math.min(1, Math.max(0, ratio))) * 10) / 10
const value = (number: number, unit: string, basis: string): OperationsValue => ({ value: number, unit, status: 'assumption', source_kind: 'demo', source: `完整模拟数据 v1：${basis}`, as_of: '2026-10-13' })

/** Same community and denominator; rebuilding adds explicit construction and relocation assumptions. */
export function buildStrategyDemo(mode: 'comprehensive' | 'rebuild') {
  const demo = buildCompleteCommunityDemo()
  if (mode === 'comprehensive') return { before: demo.beforeDashboard, after: demo.afterDashboard, dimensions: demo.dimensions, budget_wan: demo.capital.total!, assumptions: '综合整治复用完整模拟工程清单、协商记录和出资安排。' }
  const construction = demo.buildingArea * 4500 / 10000, demolition = demo.buildingArea * 20 / 10000
  const relocation = demo.households * 2000 * 24 / 10000, contingency = construction * .1
  const budget = round(construction + demolition + relocation + contingency)
  const changes: Record<string, { ratio: number; text: string }> = {
    demand: { ratio: 10 / 10, text: '演示目标：重建后覆盖10/10项优先诉求；停车和户型问题纳入设计。' },
    supply: { ratio: 1, text: '演示目标：保留并重配社区服务设施，满足同一1630人次月需求；过渡期另安排服务。' },
    adaptation: { ratio: 16 / 16, text: '演示目标：新建方案解决16/16项工程与功能任务；实施仍需专业设计与验收。' },
    implementation: { ratio: 420 / 600, text: '拆建情景另假设420/600户表达研究意愿，180户继续协商；不是已通过法定决议。' },
    operations: { ratio: 8 / 10, text: '拆建情景假设8/10项长效职责有安排，临时搬迁服务与新物业收费两项尚需落实。' },
    resources: { ratio: 1600 / budget, text: `同样1600万元已安排资金，对比拆建演示预算${budget}万元；资金缺口${round(budget - 1600)}万元。` },
  }
  const dimensions = demo.dimensions.map(row => ({ ...row, after: changes[row.key].text, afterRatio: changes[row.key].ratio, source: 'SIM-REBUILD-TARGET' }))
  const after: DecisionDashboard = { ...demo.afterDashboard, request_id: 'SIM-REBUILD-TARGET-v1', purpose: '原拆原建方案条件（模拟）', dimensions: demo.afterDashboard.dimensions.map(row => ({ ...row, value: score(changes[row.key].ratio), basis: changes[row.key].text + ' 分值=1+4×覆盖比例，上限5。', evidence_refs: ['SIM-REBUILD-TARGET'] })) }
  return { before: demo.beforeDashboard, after, dimensions, budget_wan: budget,
    assumptions: `拆建模拟：45000㎡×假设4500元/㎡建安，拆除20元/㎡；600户×2000元/月×24个月过渡安置；建安预备费10%。合计${budget}万元。建设单价、周期和意愿均为演示假设，未使用上海房价推算。` }
}

/** A fictional Hangzhou sample. No values are inserted into real facts or observations. */
export function buildCompleteCommunityDemo() {
  const households = 600, population = 1500, buildingArea = 45000
  const capital = calculateRetrofitPlan({ basic: 800, improvement: 440, enhancement: 200, reserve_percent: 10, planned_funding: 1600, households })
  const operations: OperationsInput = {
    name: '全量数据模拟 · 2026年9月运营', facility_id: 'SIM-CENTER-600', facility_name: '杭州样本社区服务中心（模拟）', period: '2026-09',
    scope_note: '虚构杭州样本社区，600户1500人；活动室、助餐区及咨询室为三个独立资源。完整自然月模拟回放；固定现金、逐人次变动成本与政府直接支付分别列账。建设投资单列，月度不含折旧及贷款本息。',
    target_population: value(population, 'person', '600户，其中300户2人、300户3人，合计1500人'), unique_users: value(300, 'person', '基准方案设定300位目标居民月度使用；潜在服务需求按项目分别登记'), cost_scope_complete: true,
    services: [
      { id: 'activity', name: '社区活动', resource_id: 'SIM-ACTIVITY-ROOM', schedule_note: '独立活动室，30席，每月30场、每场1小时；场次需求可匹配排班。', capacity_per_slot: value(30, 'visit/slot', '活动室核定30席（模拟设施表）'), available_slots: value(30, 'slot/month', '9月安排30场独立活动'), demand_visits: value(720, 'visit/month', '300位月度参与者的活动预约合计720人次'), paid_share: value(0.5, 'ratio', '收费活动与公益活动人次各半'), fee_per_visit: value(10, 'yuan/visit', '模拟公示收费10元/付费人次'), variable_cost_per_visit: value(2, 'yuan/visit', '材料2元/服务人次') },
      { id: 'meal', name: '社区助餐', resource_id: 'SIM-MEAL-HALL', schedule_note: '独立助餐区，40份/餐，每月26餐；相同人员不在活动室同时承担服务。', capacity_per_slot: value(40, 'visit/slot', '助餐区每餐40份'), available_slots: value(26, 'slot/month', '每月26个助餐开放日'), demand_visits: value(832, 'visit/month', '每开放日32份预约×26日'), paid_share: value(0.9, 'ratio', '90%为收费助餐人次，10%为公益名额'), fee_per_visit: value(15, 'yuan/visit', '模拟收费15元/付费餐'), variable_cost_per_visit: value(9, 'yuan/visit', '每份餐食与耗材9元') },
      { id: 'consultation', name: '家庭与养老咨询', resource_id: 'SIM-CONSULTATION-ROOM', schedule_note: '独立咨询室，每次接待4人，每月26场；每人次30分钟。', capacity_per_slot: value(4, 'visit/slot', '每场4个预约名额'), available_slots: value(26, 'slot/month', '每月26场咨询'), demand_visits: value(78, 'visit/month', '每场平均3个预约×26场'), paid_share: value(0.5, 'ratio', '收费与公益咨询各半'), fee_per_visit: value(20, 'yuan/visit', '模拟收费20元/付费咨询'), variable_cost_per_visit: value(5, 'yuan/visit', '单次记录与耗材5元') },
    ],
    cash_items: [
      { economic_item_id: 'SIM-STAFF-UTILITIES', kind: 'fixed_cost', description: '人员20000＋能源1500＋维护1500＋保洁2000＋管理1000', amount: value(26000, 'yuan/month', '人员：助餐岗9000＋社区岗8000＋咨询兼职3000；再加能源1500、维护1500、保洁2000、管理1000，合计26000元/月') },
      { economic_item_id: 'SIM-SPACE-INCOME', kind: 'other_earned_income', description: '非政府场地合作收入', amount: value(5000, 'yuan/month', '合作时段10次×500元；与人次收费及购买服务分别登记') },
      { economic_item_id: 'SIM-PURCHASE', kind: 'government_purchase', description: '政府公益服务合同月度付款', amount: value(5000, 'yuan/month', '演示合同年60000元÷12') },
      { economic_item_id: 'SIM-SUBSIDY', kind: 'operating_subsidy', description: '财政运营支持', amount: value(12000, 'yuan/month', '演示年度运营补贴144000元÷12') },
      { economic_item_id: 'SIM-OTHER-SUPPORT', kind: 'other_support', description: '当月无其他非经营支持', amount: value(0, 'yuan/month', '明确设定当月无捐赠等支持') },
      { economic_item_id: 'SIM-DIRECT-MAINTENANCE', kind: 'government_direct_cost', description: '政府直付场所基础维护，未计入运营方现金成本', amount: value(2000, 'yuan/month', '演示直付合同24000元/年÷12；与运营方日常维护分别列账') },
    ],
    analysis_bounds: [
      { id: 'activity-demand', target: 'service_demand_multiplier', item_id: 'activity', low: 0.8, high: 1.2, unit: 'ratio', origin: 'manual_scenario', basis: '活动预约需求设定为基准的80%至120%，保留其余项目；用于演示压力测试。', source_ref: '完整模拟预约册 v1 / 活动项目', as_of: '2026-10-13' },
      { id: 'fixed-cash', target: 'cash_amount', item_id: 'SIM-STAFF-UTILITIES', low: 24000, high: 30000, unit: 'yuan/month', origin: 'manual_scenario', basis: '人员、能源及固定维护费用设定在24000至30000元/月。', source_ref: '完整模拟预算 v1 / 五项固定支出', as_of: '2026-10-13' },
    ],
  }
  const ledger: DemoLedgerRow[] = []
  // Construct an entire month, not just disconnected KPI values. Each row is
  // assigned to one resource slot; paid rows are evenly spread across the month.
  for (const spec of [{ id: 'activity', count: 684, paid: 342, users: 180, offset: 0 }, { id: 'meal', count: 810, paid: 729, users: 200, offset: 86 }, { id: 'consultation', count: 74, paid: 37, users: 82, offset: 0 }]) {
    const service = operations.services.find(s => s.id === spec.id)!, slots = service.available_slots.value!
    let rowIndex = 0
    for (let slot = 0; slot < slots; slot++) {
      const count = Math.floor(spec.count / slots) + (slot < spec.count % slots ? 1 : 0)
      for (let n = 0; n < count; n++, rowIndex++) {
        const paid = Math.floor((rowIndex + 1) * spec.paid / spec.count) > Math.floor(rowIndex * spec.paid / spec.count)
        ledger.push({ id: `SIM-${spec.id}-${rowIndex + 1}`, period: operations.period, date: `${operations.period}-${String(slot + 1).padStart(2, '0')}`, service_id: spec.id, slot: `${spec.id}-${slot + 1}`, resident_id: `SIM-RESIDENT-${String(spec.offset + rowIndex % spec.users + 1).padStart(4, '0')}`, paid, charge: paid ? service.fee_per_visit.value! : 0, variable_cost: service.variable_cost_per_visit.value!, kind: 'synthetic' })
      }
    }
  }
  const dimensions: DemoDimension[] = [
    { key: 'demand', label: '居民需求', before: '600户完成摸排（540份问卷＋60户补访）；10项优先诉求已有3项得到处理。', after: '供水、助餐、活动及适老通行等方案覆盖9项优先诉求；剩余1项为长期停车治理。', beforeRatio: 3 / 10, afterRatio: 9 / 10, source: 'SIM-SURVEY / 需求覆盖清单' },
    { key: 'supply', label: '公共服务', before: '活动360、助餐520、咨询40人次/月，共920人次；面对1630人次需求。', after: '三个独立资源容量共2044人次/月，基准服务1630人次、300位居民；未满足需求0人次。', beforeRatio: 920 / 1630, afterRatio: 1630 / 1630, source: 'SIM-SCHEDULE / 独立房间容量与预约表' },
    { key: 'adaptation', label: '居住工程', before: '15幢、45000㎡；16项工程接口与整改任务已有8项完成核对。', after: '拟方案完成15/16项接口核对；剩余1项为公共标识完善，模拟安全否决条件为0项。', beforeRatio: 8 / 16, afterRatio: 15 / 16, source: 'SIM-ENGINEERING / 模拟工程核查表' },
    { key: 'implementation', label: '实施协同', before: '初始协商方案354/600户同意，246户记录不同意见或尚未签署。', after: '分期调整后552户同意、30户异议、18户暂缓签署；施工影响按楼栋登记处理。', beforeRatio: 354 / 600, afterRatio: 552 / 600, source: 'SIM-CONSENT / 分楼栋协商记录' },
    { key: 'operations', label: '长效维护', before: '10项设施、人员、收费与管护职责中5项已有责任与预算安排。', after: '10项职责全部登记；3处独立服务资源排班，人员、成本、补贴及政府直付均已列账。', beforeRatio: 5 / 10, afterRatio: 10 / 10, source: 'SIM-RESPONSIBILITY / 十项职责和月度预算' },
    { key: 'resources', label: '资金交付', before: '初始可安排资金1000万元；含预备费建设预算1584万元，缺口584万元。', after: '财政1280、居民160、合作方160万元，合计1600万元；覆盖1584万元预算，余额16万元。', beforeRatio: 1000 / capital.total!, afterRatio: 1600 / capital.total!, source: 'SIM-CAPITAL / 三类工程与出资安排' },
  ]
  const dashboard = (phase: 'before' | 'after'): DecisionDashboard => ({ policy_version: NEIGHBORHOOD_DASHBOARD_POLICY, purpose: `杭州样本社区${phase === 'before' ? '改造前现况' : '拟改造方案'}（模拟）`, model: '模拟条件覆盖规则 v1：1 + 4 × min(完成比例,1)', request_id: `SIM-FULL-COMMUNITY-${phase}-v1`, status: 'completed', dimensions: dashboardDimensions(NEIGHBORHOOD_DASHBOARD_POLICY).map(d => { const row = dimensions.find(r => r.key === d.key)!; return { key: d.key, value: score(phase === 'before' ? row.beforeRatio : row.afterRatio), confidence: null, basis: `${phase === 'before' ? row.before : row.after} 演示分值=1+4×条件覆盖比例，上限5；${row.source}。`, evidence_refs: [row.source] } }) })
  const provenance: DemoProvenance[] = [
    { id: 'SIM-REFERENCE-COST', label: '工程金额强度参考', kind: 'reference', source: '已归档广州2024年鸿中楼、青年苑两个施工合同 / renewal-cost-library-20261013.json', basis: '同口径施工合同总价÷总建筑面积为308.85和317.78元/㎡；演示取320元/㎡，45000㎡×320元/㎡=1440万元，再加10%预备费。' },
    { id: 'SIM-REFERENCE-OPS', label: '运营预算量级参考', kind: 'reference', source: '用户社区运营调研记录，2026-10-13', basis: '用户提供年运营费30–50万元、头部年收入30–80万元的访谈量级；演示基准运营成本42.38万元/年、经营收入30.73万元/年，均以本月×12做预算折算。' },
    { id: 'SIM-INVENTORY', label: '人口与建筑', kind: 'assumption', source: '完整模拟存量名册 v1', basis: '15幢×40户=600户；300户×2人＋300户×3人=1500人；每户平均75㎡，合计45000㎡；设定老人420人、儿童180人、其他900人。' },
    { id: 'SIM-ROOMS', label: '场地与人员排班', kind: 'assumption', source: '完整模拟设施及排班册 v1', basis: '服务中心600㎡：活动室90、助餐80、咨询20、后厨100、办公80、公厕60、储物40、通道130㎡。活动岗每月30小时、助餐岗26个开放日、咨询兼职每月52小时；按独立房间与岗位安排，避免共享资源重复登记。' },
    ...dimensions.map(d => ({ id: d.source, label: d.label, kind: 'assumption' as const, source: d.source, basis: d.before + ' ' + d.after })),
    { id: 'SIM-UNIQUE-USERS', label: '跨情景去重人数模型', kind: 'derived', source: '模拟使用频次假设 v1', basis: '基准1630人次÷300人=5.433333人次/人/月。需求情景中先按容量计算服务人次，再除以该频次，四舍五入并以人口、服务人次为上限。' },
    { id: 'SIM-LEDGER', label: '月度模拟台账', kind: 'derived', source: '逐人次模拟登记册 / 1568行', basis: '活动684、助餐810、咨询74人次，收费分别342、729、37人次；按独立场次均匀分配。活动居民1–180、助餐居民87–286、咨询居民1–74，跨项目去重286人。固定支出26500，合作收入4800，其余公共资金按预算登记。' },
  ]
  const householdRegister = Array.from({ length: households }, (_, index) => ({ id: `SIM-HOUSEHOLD-${String(index + 1).padStart(4, '0')}`, building: Math.floor(index / 40) + 1, residents: index < 300 ? 2 : 3, collection: index < 540 ? 'questionnaire' : 'followup_interview', before_consent: index < 354 ? 'support' : 'different_opinion_or_unsigned', after_consent: index < 552 ? 'support' : index < 582 ? 'objection' : 'unsigned', kind: 'synthetic' as const }))
  return { id: 'complete-community-demo-v1', name: '杭州样本社区 · 完整数据模拟', kind: 'synthetic' as const, households, population, buildingArea, buildings: 15, elderly: 420, children: 180, capital, funding: { government: 1280, residents: 160, partner: 160 }, operations, ledger, householdRegister, dimensions, beforeDashboard: dashboard('before'), afterDashboard: dashboard('after'), visitsPerResident: 1630 / 300, provenance }
}

export function summarizeDemoLedger(demo: CompleteCommunityDemo): Record<string, number> {
  const served_visits = demo.ledger.length, unique_users = new Set(demo.ledger.map(row => row.resident_id)).size
  const fee_income = demo.ledger.reduce((sum, row) => sum + row.charge, 0), variable = demo.ledger.reduce((sum, row) => sum + row.variable_cost, 0)
  const operating_cost = 26500 + variable, government_purchase = 5000, operating_subsidy = 12000, government_direct_cost = 2000
  const earned_income = fee_income + 4800 + government_purchase, balance_after_support = earned_income + operating_subsidy - operating_cost
  const capacity_visits = demo.operations.services.reduce((sum, s) => sum + s.capacity_per_slot.value! * s.available_slots.value!, 0)
  return { served_visits, unique_users, capacity_visits, utilization: served_visits / capacity_visits, coverage: unique_users / demo.population, fee_income, operating_cost, earned_income, government_purchase, operating_subsidy, government_direct_cost, government_outlay: government_purchase + operating_subsidy + government_direct_cost, balance_after_support, unfunded_gap: Math.max(0, -balance_after_support), government_cost_per_visit: round((government_purchase + operating_subsidy + government_direct_cost) / served_visits), government_cash_income: 0 }
}

/** Applied ONLY in explicit simulation mode, after the existing service calculator. */
export function simulateScenarioUsers(input: OperationsInput, servedVisits: number, frequency: number): OperationsInput {
  if (input.unique_users.source_kind !== 'demo' || input.unique_users.status !== 'assumption' || input.target_population.source_kind !== 'demo' || !Number.isFinite(servedVisits) || servedVisits < 0 || !Number.isFinite(frequency) || frequency < 1 || input.target_population.value === null) throw new Error('SIMULATION_USER_MODEL_REQUIRES_LABELLED_DEMO')
  const result = structuredClone(input)
  result.unique_users = value(Math.min(input.target_population.value, Math.floor(servedVisits), Math.round(servedVisits / frequency)), 'person', `容量核算后的${servedVisits}人次÷假设月均${frequency.toFixed(6)}人次/人，四舍五入并按人口、服务人次封顶；用于完整模拟，不是实测去重人数`)
  return result
}

export function renderCompleteDemoReport(demo: CompleteCommunityDemo): string {
  const actual = summarizeDemoLedger(demo), lines = [`# ${demo.name} · 政府工作人员模拟报表`, '', '全量模拟演示：样本名册、协商、工程、运营预测和模拟台账共同构造；公开合同仅用作预算量级参考。', `月份：${demo.operations.period}；人口${demo.population}人；${demo.households}户；${demo.buildings}幢；建筑面积${demo.buildingArea}㎡。`, '', '## 六维现况与拟方案', '']
  table(lines, ['维度', '模拟现况', '拟方案', '现况分值', '方案分值'], demo.dimensions.map(d => [d.label, d.before, d.after, score(d.beforeRatio), score(d.afterRatio)]))
  lines.push('', '演示等级按 1 + 4 × min(完成比例,1) 推算，逐维显示条件覆盖程度，不计算用于审批的总分。', '', `建设预算：${demo.capital.total}万元；三方出资1600万元；余额16万元。工程投资与月度运营分别列账。`, '', '## 逐人次模拟台账汇总', '')
  table(lines, ['指标', '模拟台账值'], Object.entries(actual).map(([key, number]) => [key, round(number)]))
  lines.push('', '财政现金收入设定为0；公共服务效果以使用、去重覆盖与供需改善呈现。年度现金预算用月度值×12折算，去重人数不乘12。', '', '## 数据构造与推算依据', '')
  table(lines, ['条目', '性质', '来源', '生成规则'], demo.provenance.map(row => [row.label, row.kind, row.source, row.basis]))
  return lines.join('\n') + '\n'
}
