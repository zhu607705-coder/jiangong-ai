import type { DecisionPacket } from './generated/contracts'
import { table } from '../../vendor/cre/scripts/lib/report-table'
import { buildDecisionBrief } from '../../packages/decision/brief-view'

const statusNames = { conditional: '有条件待核', blocked: '条件阻断', investigate: '本轮调查' }
const dimensionNames = { implementation: '实施与采购', building: '建筑条件', demand: '使用需求', organization: '组织方式', enterprise: '承接能力', resources: '投入与资源' }
export function renderReport(packet: DecisionPacket): string {
  const brief = buildDecisionBrief(packet)
  const lines = ['# 建造前片区研判', '', `项目：${packet.project_id} · 版本：${packet.revision} · 资料时点：${packet.as_of}`, '',
    `数据：${packet.synthetic ? '显式合成' : '用户资料与公开来源'}；执行：${packet.execution_mode === 'offline' ? '离线工程验证（未调用模型与联网搜索）' : `真实模型研判（${packet.model || '模型标识未返回'}；业务效用未经验证）`}`, '', brief.summary, '',
    '## 调查发现', '']
  if(packet.neighborhood_action){ const a=packet.neighborhood_action;lines.push('## 老旧小区改造行动建议','',a.label,'',...a.reasons.map(r=>'- '+r.text+'；来源：'+r.evidence_refs.join('、')), '',...a.missing.map(c=>'- '+c.label+'：'+c.where+'；补齐后检查：'+c.impact),'', '规则版本：'+a.rule_version,'') }
  if (!brief.findings.length) lines.push('本轮尚无带来源的具体发现。', '')
  for (const finding of brief.findings) {
    lines.push(`### ${dimensionNames[finding.dimension]} · ${finding.status === 'supported' ? '有来源记录' : finding.status === 'conflict' ? '来源有冲突' : '有条件线索'}`, '',
      finding.claim, '', `来源：${finding.evidence_refs.join('、') || '未列明'}`)
    if (finding.unknowns.length) lines.push(`仍需核验：${finding.unknowns.join('；')}`)
    lines.push('')
  }
  lines.push('## 实施路径', '')
  for (const path of brief.paths) {
    lines.push(`### ${path.title} · ${statusNames[path.status]}`, '')
    if (path.status === 'blocked') lines.push('当前已确认条件阻断该路径。', '')
    else lines.push('可研究的操作：', ...path.actions.map((action, i) => `${i + 1}. ${action}`), '')
    if (path.conditions.length) lines.push('这一路径需先落实：', ...path.conditions.map(condition => `- ${condition}`), '')
    if (path.organizationNotes.length) lines.push('本项目组织条件与偏好：', ...path.organizationNotes.map(note => `- ${note}`), '')
    if (path.sourceRefs.length) lines.push(`引用来源：${path.sourceRefs.join('、')}`, '')
  }
  if (brief.investigation) {
    lines.push('### 本轮先查：' + brief.investigation.title, '', ...brief.investigation.actions.map((action, i) => `${i + 1}. ${action}`), '')
    if (brief.investigation.conditions.length) lines.push('核验对象：' + brief.investigation.conditions.join('；'), '')
  }
  lines.push('## 依据与条件比较', '')
  for (const path of brief.paths) {
    lines.push(`### ${path.title}`, '')
    for (const theme of path.themes) {
      lines.push(`#### ${theme.label}`, '')
      if (theme.judgments.length) lines.push(...theme.judgments.map(judgment => `- ${judgment}`), '')
      if (theme.unknowns.length) lines.push(`要核实：${theme.unknowns.join('；')}`)
      if (theme.sourceRefs.length) lines.push(`来源：${theme.sourceRefs.join('、')}`)
      lines.push('')
    }
  }
  lines.push('', '## 指标与缺项', '')
  table(lines, ['指标', '值', '状态', '来源'], packet.metrics.map(m => [m.label, m.value == null ? '未知' : `${m.value} ${m.unit ?? ''}`, m.status, m.source_refs.join(', ')]))
  lines.push('', '## 反证检查', ...packet.reviews.map(r => `- ${r.issue} ${r.recommendation}`), '', '## 下一步调查', ...brief.nextActions.map(f => `- P${f.priority} ${f.title}${f.why ? `：${f.why}` : ''}`), '', '## 项目 Context', '')
  table(lines, ['类型', '表达', '作用域', '来源'], packet.context_rules.filter(r => r.active !== false).map(r => [r.kind, r.original_text || r.note, r.scope, r.source_id]))
  lines.push('', '## 来源', ...packet.sources.map(s => `- ${s.id}：${s.title}（${s.content_status === 'metadata_only' ? '仅元数据；' : ''}${s.data_class} / ${s.visibility}）${s.url ? ` ${s.url}` : ''}`), '', '## 边界', ...packet.warnings.map(w => `- ${w}`), '', `run_id: ${packet.run_id}`, `snapshot: ${packet.snapshot_hash}`, '')
  if (packet.comparison) {
    if (packet.unresolved_disagreements?.length) lines.push('## 未解决分歧', ...(packet.unresolved_disagreements || []).map(d => `- ${d}`), '')
    lines.push('## 实际调用记录', '')
    table(lines, ['阶段', '返回模型', '输入 token', '输出 token', '终止状态'], (packet.model_calls || []).map(c => [c.stage, c.returned_model, c.input_tokens, c.output_tokens, c.finish_reason]))
  }
  return lines.join('\n')
}
