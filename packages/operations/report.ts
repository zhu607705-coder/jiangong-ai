import type { OperationsSnapshot, OperationsWorkspace } from '../../apps/host/generated/contracts'
import { table } from '../../vendor/cre/scripts/lib/report-table'
import { operationsValues } from './service'

export const operationMetricLabels: Record<string, string> = {
  capacity_visits: '月服务容量（人次）', served_visits: '服务人次', unmet_visits: '未满足服务人次', utilization: '容量利用率（比例）',
  unique_users: '目标居民去重服务人数', coverage: '目标居民覆盖率（比例）', fee_income: '居民自付收入（元/月）', earned_income: '经营收入，含政府购买服务（元/月）',
  operating_cost: '运营方现金支出（元/月）', government_purchase: '政府购买服务（元/月）', operating_subsidy: '运营补贴（元/月）', other_support: '其他支持（元/月）',
  balance_before_support: '补贴及其他支持前现金结余（元/月）', balance_after_support: '支持后现金结余（元/月）', unfunded_gap: '剩余运营缺口（元/月）',
  required_subsidy: '所需运营补贴（元/月）', government_outlay: '财政运营支出（元/月）', government_cost_per_visit: '财政每服务人次支出（元/人次）',
  commercial_cost_coverage: '非政府经营收入覆盖运营支出比例', government_direct_cost: '政府直接支付运营支出（元/月）', total_service_cost: '总运营现金支出（元/月）',
}
const text = (value: string) => value.replace(/[\r\n]+/g, ' ')
export function renderOperationsReport(snapshot: OperationsSnapshot, workspace: OperationsWorkspace): string {
  const lines = [`# ${text(snapshot.input.facility_name)} · ${text(snapshot.input.name)}`, '',
    `月份：${snapshot.input.period}；预测冻结时间：${snapshot.created_at}；项目资料版本：${snapshot.context_version}。`,
    `快照：${snapshot.id}；输入与公式版本哈希：${snapshot.input_hash}；计算版本：${snapshot.result.model_version}。`, '',
    `范围与排班假设：${text(snapshot.input.scope_note)}`, '',
    '本报告为月度情景测算。服务量由需求与有效排班容量计算；建设投资、折旧、贷款本息另列。政府购买服务和补贴分别记录一次，再映射为运营方流入与财政支出。', '', '## 测算结果', '']
  table(lines, ['指标', '值'], Object.entries(snapshot.result.metrics).map(([key, value]) => [operationMetricLabels[key] || key, value ?? '待补充']))
  lines.push('', '## 服务时段与容量', '')
  table(lines, ['服务', '核算方式', '容量人次', '服务人次', '先合计再分配的上限', '时段错配少服务人次'], snapshot.result.services.map(service => [service.name,
    service.capacity_method === 'time_blocks' ? '分时段核算，需求不跨时段结转' : '月度需求可匹配排班的假设', service.capacity_visits, service.served_visits,
    service.monthly_pooled_upper_bound ?? '未记录', service.aggregation_overstatement_visits ?? '未记录']))
  if (snapshot.result.science) {
    const science = snapshot.result.science
    const status = { feasible: '在当前条件下可达', infeasible: '在当前条件下不可达', not_identifiable: '需补数据或服务结构', already_balanced: '已有条件满足平衡' }
    lines.push('', '## 收支切换值与参数敏感性', '')
    table(lines, ['切换值', '数值', '单位', '状态', '固定条件'], science.break_even.map(item => [item.label, item.value, item.unit, status[item.status], item.basis]))
    if (science.sensitivity.length) {
      lines.push('', '每次改变一项参数，其余参数保持基准值。', '')
      table(lines, ['参数', '下界', '基准', '上界', '下界现金结余', '基准现金结余', '上界现金结余', '范围依据'], science.sensitivity.map(item => [item.label, item.low, item.base, item.high, item.low_balance, item.base_balance, item.high_balance, item.basis + '；' + item.source_ref]))
    }
    if (science.joint_range) {
      const range = science.joint_range
      lines.push('', `${range.label}：测试${range.tested_corners}个角点组合，其中${range.valid_corners}个可计算现金结余；最低${range.min_balance ?? '未知'}元，最高${range.max_balance ?? '未知'}元，最大缺口${range.worst_gap ?? '未知'}元。`,
        `最低结余参数：${range.min_at.map(item => item.id + '=' + item.value).join('，')}。`)
    }
    lines.push('', ...science.notes.map(note => `- ${text(note)}`))
  }
  lines.push('', '## 来源与参数', '')
  table(lines, ['参数', '数值', '单位', '性质', '来源类型', '来源', '依据时点'], operationsValues(snapshot.input).map(({ label, item }) => [label, item.value ?? '待补充', item.unit, item.status, item.source_kind, item.source, item.as_of]))
  lines.push('', '## 需补资料', '')
  table(lines, ['字段', '原因', '采集方式'], snapshot.result.missing.map(item => [item.field, item.reason, item.collect_from]))
  lines.push('', ...snapshot.result.warnings.map(warning => `- ${text(warning)}`), '', '## 实际月份核验', '')
  const comparisons = workspace.comparisons.filter(item => item.snapshot_id === snapshot.id)
  if (!comparisons.length) lines.push('待取得同一中心、同一月份的原始运营台账。当前没有实绩验证结果。')
  for (const comparison of comparisons) {
    const observation = workspace.observations.find(item => item.id === comparison.observation_id)!
    lines.push(`${comparison.timing === 'prospective' ? '月前冻结预测对照' : '历史回放对照'}；样本用途：${comparison.split === 'holdout' ? '留出验证' : '校准'}。`,
      `实绩由用户核对录入；来源：${text(observation.source_title)} / ${text(observation.input.locator)}；采集日：${observation.input.collected_at}。`,
      `来源ID：${text(observation.input.source_id)}；冻结来源哈希：${observation.source_hash}；原件地址：${text(observation.source_snapshot.url || '项目内已上传原件')}。`, '')
    table(lines, ['指标', '预测', '实际', '实际−预测', '绝对误差', '相对误差（比例）'], comparison.differences.map(row => [operationMetricLabels[row.metric], row.predicted ?? '未知', row.observed ?? '未知', row.error ?? '待补', row.absolute_error ?? '待补', row.percentage_error ?? '不适用']))
  }
  return lines.join('\n') + '\n'
}
