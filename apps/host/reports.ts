import type { DecisionPacket } from './generated/contracts'
import { table } from '../../vendor/cre/scripts/lib/report-table'
import { DECISION_ACTIONS } from '../../packages/decision/structured-route'

const statusNames = { conditional: '有条件待核', blocked: '组织条件阻断', investigate: '调查基线' }
export function renderReport(packet: DecisionPacket): string {
  const lines = ['# 建造前片区研判', '', `项目：${packet.project_id} · 版本：${packet.revision} · 资料时点：${packet.as_of}`, '',
    `数据：${packet.synthetic ? '显式合成' : '用户资料与公开来源'}；执行：${packet.execution_mode === 'offline' ? '离线工程验证（未调用模型与联网搜索）' : `真实模型研判（${packet.model || '模型标识未返回'}；业务效用未经验证）`}`, '', packet.summary, '', '## 候选路径', '']
  table(lines, ['路径', '当前状态', '前置条件', '反证'], packet.scenarios.map(s => [s.title, statusNames[s.status], s.prerequisites.join('；'), s.counterevidence.join('；')]))
  lines.push('', '## 指标与缺项', '')
  table(lines, ['指标', '值', '状态', '来源'], packet.metrics.map(m => [m.label, m.value == null ? '未知' : `${m.value} ${m.unit ?? ''}`, m.status, m.source_refs.join(', ')]))
  lines.push('', '## 反证检查', ...packet.reviews.map(r => `- ${r.issue} ${r.recommendation}`), '', '## 下一步调查', ...packet.followups.map(f => `- P${f.priority} ${f.title}：${f.why}`), '', '## 项目 Context', '')
  table(lines, ['类型', '表达', '作用域', '来源'], packet.context_rules.filter(r => r.active !== false).map(r => [r.kind, r.original_text || r.note, r.scope, r.source_id]))
  lines.push('', '## 来源', ...packet.sources.map(s => `- ${s.id}：${s.title}（${s.data_class} / ${s.visibility}）${s.url ? ` ${s.url}` : ''}`), '', '## 边界', ...packet.warnings.map(w => `- ${w}`), '', `run_id: ${packet.run_id}`, `snapshot: ${packet.snapshot_hash}`, '')
  if (packet.comparison) {
    lines.push('## 模型比较矩阵', '')
    table(lines, ['维度', '路径', '判断', '尚缺'], packet.comparison.criteria.flatMap(c => c.judgments.map(j => [c.criterion, j.scenario_id, j.conclusion, j.unknowns.join('；')])))
    lines.push('', '## 未解决分歧', ...(packet.unresolved_disagreements || []).map(d => `- ${d}`), '', '## 实际调用记录', '')
    table(lines, ['阶段', '返回模型', '输入 token', '输出 token', '终止状态'], (packet.model_calls || []).map(c => [c.stage, c.returned_model, c.input_tokens, c.output_tokens, c.finish_reason]))
  }
  if(packet.decision_support?.status==='completed') {
    const route=packet.decision_support
    lines.push('## 结构化判断操作','',`${DECISION_ACTIONS[route.action!]}：${route.next_step}`,
      `决策模型：${route.model}；请求：${route.request_id}；耗时：${route.duration_ms} ms`,
      ...route.guard_reasons.map(reason=>`- ${reason}`),'')
    table(lines,['候选操作','模型选项概率'],Object.entries(route.answers!.next_action.probabilities).map(([key,p])=>[DECISION_ACTIONS[key as keyof typeof DECISION_ACTIONS],`${(100*p).toFixed(1)}%`]))
    lines.push('','这些概率用于研究流程分流，尚未按企业结果校准。','')
  }
  return lines.join('\n')
}
