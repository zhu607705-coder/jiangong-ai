import type { ModeCondition } from './renewal-mode'

export type RenewalResearchRound = { key: 'object' | 'comparison'; label: string; queries: string[] }

/** Query selection only: execution, fetch limits and provenance stay in the existing research capability. */
export function renewalResearchRounds(name: string, conditions: ModeCondition[]): RenewalResearchRound[] {
  const unresolved = new Set(conditions.filter(row => row.state === 'unknown' || row.state === 'conflict').map(row => row.kind))
  const topics = [
    { kinds: ['structure_repairable', 'demolition_permitted'], words: '房屋安全鉴定 修缮 重建 保护要求' },
    { kinds: ['rights_clear', 'rebuild_planning_confirmed'], words: '更新 权属 规划条件 拆除重建 审批' },
    { kinds: ['resident_resolution_valid', 'relocation_ready'], words: '居民意见 筹资 安置 过渡 回搬' },
    { kinds: ['funding_secured'], words: '改造 预算 中标 合同 资金来源 居民出资' },
    { kinds: ['life_cycle_cost_compared'], words: '综合整治 原拆原建 全周期费用 修缮成本 重建成本' },
    { kinds: ['maintenance_entity_confirmed'], words: '电梯 供水 停车 社区服务 运营 维护费用' },
  ].map((topic, index) => ({ ...topic, index, missing: topic.kinds.some(kind => unresolved.has(kind)) }))
    .sort((a, b) => Number(b.missing) - Number(a.missing) || a.index - b.index)
  return [
    { key: 'object', label: '先查本项目的关键缺项', queries: topics.map(topic => `${name} ${topic.words} site:gov.cn`) },
    { key: 'comparison', label: '补查杭州与上海的费用及实施案例', queries: [
      '杭州 浙工新村 自主更新 总投资 居民出资 过渡 安置 site:gov.cn',
      '杭州 老旧小区 综合整治 拆除重建 全生命周期 费用 比选 site:gov.cn',
      '上海 凤南一村 拆除重建 总投资 建筑面积 居民出资 site:shanghai.gov.cn',
      '上海 蕃瓜弄小区 原拆原建 资金 临时安置 回搬 site:shanghai.gov.cn',
      '上海 旧住房 综合修缮 拆除重建 评估 居民意愿 资金平衡 site:shanghai.gov.cn',
      `${name} 改造 工程造价 运营 维修 费用 site:edu.cn`,
    ] },
  ]
}
