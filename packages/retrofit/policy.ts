import type { ResearchDimension } from '../../apps/host/generated/contracts'

export const RETROFIT_ACTION_LABELS = { proceed: '建议开展专项调查', supplement: '先补充关键资料再判断', defer: '当前条件下暂缓' } as const

export const RETROFIT_RULE_VERSION = 'neighborhood-action-v2'
export const RETROFIT_CHECKS = [
  { key: 'resident_needs_confirmed', label: '居民需求与异议', where: '分楼栋问卷、社区走访及异议台账', impact: '改造内容、优先顺序与居民负担' },
  { key: 'engineering_review_passed', label: '方案相关工程评审', where: '原图纸、专业检测及消防/管网核查', impact: '工程范围、安全前置条件与施工组织' },
  { key: 'service_gap_confirmed', label: '公共服务缺口', where: '设施名录、容量和开放时间、实测步行路线', impact: '养老托育、无障碍和配套设施配置' },
  { key: 'scope_and_consent_confirmed', label: '实施范围与居民协同', where: '年度计划、权属资料、方案公示及居民协商记录', impact: '实施主体、项目边界与扰民安排' },
  { key: 'funding_confirmed', label: '预算与资金落实', where: '工程量预算、资金批准/分摊确认及拨付安排', impact: '资金缺口、分期与交付范围' },
  { key: 'maintenance_confirmed', label: '长效维护安排', where: '设施接收、物业合同、管护预算及收费协商', impact: '改造后的责任、年度支出和持续使用' },
  { key: 'rule_set_confirmed', label: '本方案专业规则复核', where: '企业人员与专业人员确认的规则版本及适用范围', impact: '是否开展专项调查的业务门槛' },
] as const
export const RETROFIT_VETOES = {
  safety_veto: '已确认的方案安全否决条件',
  rights_veto: '已确认的权属或实施权限否决条件',
  protection_veto: '已确认的保护要求与方案冲突',
} as const
export type RetrofitCheckKey = typeof RETROFIT_CHECKS[number]['key']
export type RetrofitVetoKey = keyof typeof RETROFIT_VETOES
export type NeighborhoodDimensionPolicy = {
  key: ResearchDimension; label: string; question: string; levels: string[];
  evidenceKinds: readonly string[]; confirmationKeys: readonly RetrofitCheckKey[];
  vetoKeys: readonly RetrofitVetoKey[]; investigation: string;
}

/** One registered business vocabulary. Levels describe the existing optional
 * model comparison; confirmed conditions alone control the formal action. */
export const NEIGHBORHOOD_DIMENSION_POLICY: NeighborhoodDimensionPolicy[] = [
  { key: 'demand', label: '居民需求', question: '哪些居民家庭的日常居住困难需要优先改善？',
    levels: ['方案与已核实居民需求冲突', '仅有居住改善线索', '具体居民群体与需求已有依据', '改造内容对应已确认需求', '居民需求与改造使用效果均经验证'],
    evidenceKinds: ['resident_needs', 'resident_household', 'resident_survey'], confirmationKeys: ['resident_needs_confirmed'], vetoKeys: [],
    investigation: '取得分楼栋居民需求调查与异议台账，核对改造内容及居民负担。' },
  { key: 'supply', label: '公共服务', question: '现有养老、托育、医疗、停车及活动空间缺口如何补齐？',
    levels: ['方案与公共服务条件冲突', '服务缺口或配置依据薄弱', '有可核查的服务改善方向', '具体服务缺口与设施配置对应', '服务供需和可达性均经验证'],
    evidenceKinds: ['service_gap', 'public_service', 'public_service_capacity'], confirmationKeys: ['service_gap_confirmed'], vetoKeys: [],
    investigation: '核验公共设施容量、开放时间和居民步行路线，确认服务缺口。' },
  { key: 'adaptation', label: '居住工程', question: '基础、完善、提升改造与鉴定、消防、管网条件是否匹配？',
    levels: ['已核实工程条件阻断方案', '工程冲突与改造接口明显', '存在可研究的工程适配路径', '工程范围与鉴定等依据对应', '工程条件及施工接口均已专业核验'],
    evidenceKinds: ['engineering_review', 'engineering_condition', 'building_inventory'], confirmationKeys: ['engineering_review_passed'], vetoKeys: ['safety_veto', 'protection_veto'],
    investigation: '取得本方案的鉴定、消防及管网专业核查，明确施工接口。' },
  { key: 'implementation', label: '实施协同', question: '居民协商、实施主体和施工期间安排是否支持推进？',
    levels: ['已核实实施条件阻断方案', '居民协商或实施责任存在明显冲突', '居民协商与实施主体已有线索', '实施责任、居民协商与施工安排明确', '当前实施安排与所需程序均已核实'],
    evidenceKinds: ['resident_consent', 'implementation_scope', 'implementation_arrangement'], confirmationKeys: ['scope_and_consent_confirmed'], vetoKeys: ['rights_veto'],
    investigation: '核对居民协商、实施范围、责任主体和本方案专业规则。' },
  { key: 'operations', label: '长效维护', question: '改造后设施由谁维护，责任、费用和居民参与怎样持续？',
    levels: ['维护机制存在明确冲突', '维护责任或费用安排薄弱', '已有物业或设施维护主体', '维护责任、费用与居民参与明确', '持续维护安排及实际履行均有验证'],
    evidenceKinds: ['maintenance_arrangement', 'maintenance_cost'], confirmationKeys: ['maintenance_confirmed'], vetoKeys: [],
    investigation: '取得设施移交、维护责任及年度管护费用安排。' },
  { key: 'resources', label: '资金交付', question: '资金来源、居民负担、工程成本、分期与企业交付是否匹配？',
    levels: ['资金与交付条件明确阻断', '资金或交付缺口明显', '资金来源或分期路径有依据', '资金、成本与交付范围匹配', '资金来源和交付安排均已落实'],
    evidenceKinds: ['funding_arrangement', 'project_budget', 'engineering_cost'], confirmationKeys: ['funding_confirmed'], vetoKeys: [],
    investigation: '核对工程量预算、出资批准、分摊确认与拨付安排。' },
]
