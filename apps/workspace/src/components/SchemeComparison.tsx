import type { Project } from '../api'
import type { StrategyPacket } from '../../../../packages/retrofit/strategy'
import type { RenewalModeGate } from '../../../../packages/retrofit/renewal-mode'
import { MODE_LABELS } from '../../../../packages/retrofit/renewal-mode'
import { buildStrategyDemo } from '../../../../packages/retrofit/complete-demo'
import { currentDirectionText, type StrategyDirection } from './strategy-direction-text'

export default function SchemeComparison({ project, result, gate, demoActive, selectedDirection, onOpen, onEvidence }: {
  project: Project; result: StrategyPacket | null; gate: RenewalModeGate; demoActive: boolean; selectedDirection: StrategyDirection | null;
  onOpen: (mode: StrategyDirection) => void; onEvidence: (refs: string[], packet?: StrategyPacket) => void;
}) {
  const packet = result?.status === 'completed' && result.project_id === project.id && result.context_version === project.context_version && result.synthetic === (demoActive || project.input.synthetic) ? result : null
  const strategy = packet?.strategy
  const modes = ['comprehensive', 'rebuild'] as const
  const content = (mode: StrategyDirection, key: 'requirements' | 'actions' | 'resources' | 'operations' | 'effects') => {
    const path = strategy?.paths.find(row => row.mode === mode), clean = (text: string) => currentDirectionText(text, mode)
    if (key === 'requirements') return path?.requirements.map(clean).filter(Boolean).join('；') || '方案形成后在此列出实施前提，现可先查看本方向工作区。'
    if (key === 'actions') return path?.actions.slice(0, 2).map(action => clean(action.title)).filter(Boolean).join('；') || '本方向优先举措尚未生成。'
    if (demoActive && key === 'resources') { const demo = buildStrategyDemo(mode); return `完整模拟预算 ${demo.budget_wan.toLocaleString('zh-CN')} 万元；进入本方向核对资金假设。` }
    if (key === 'resources' || key === 'operations') return clean(strategy?.dimensions.find(row => row.key === key)?.[mode] || '') || '本方向尚无对应说明，进入方案后可补充参数。'
    return strategy?.dimensions.filter(row => ['demand', 'supply', 'adaptation'].includes(row.key)).map(row => clean(row[mode])).filter(Boolean).join('；') || '改后目标随本方向方案形成后展示。'
  }
  const rows = [['requirements', '适用条件'], ['actions', '优先举措'], ['resources', '建设与资金'], ['operations', '社区运营'], ['effects', '预期改善']] as const
  return <section className="scheme-comparison" aria-label="同基线方案比选">
    <header><div><h3>在同一资料基线上比较两个方案</h3><p>资料 v{packet?.context_version ?? project.context_version} · {demoActive ? '完整模拟' : `${project.input.synthetic?'合成资料研判 · ':''}${packet?.sources.length || 0} 份方案关联资料`}</p></div><span className="scheme-system-advice">系统核验建议：{MODE_LABELS[gate.direction]}</span></header>
    <div className="scheme-comparison-table"><table><thead><tr><th scope="col">比较事项</th>{modes.map((mode, index) => <th scope="col" key={mode}><span>方案 {index === 0 ? 'A' : 'B'} · {MODE_LABELS[mode]}</span><strong>{currentDirectionText(strategy?.paths.find(row => row.mode === mode)?.title || `${MODE_LABELS[mode]}研究方案`, mode)}</strong>{selectedDirection === mode && <small>当前工作方案</small>}</th>)}</tr></thead><tbody>{rows.map(([key, label]) => <tr key={key}><th scope="row">{label}</th>{modes.map(mode => <td key={mode}>{content(mode, key)}</td>)}</tr>)}<tr><th scope="row">工作入口</th>{modes.map(mode => <td key={mode}><button className="secondary" data-open-scheme={mode} onClick={() => onOpen(mode)}>打开{MODE_LABELS[mode]}方案 →</button></td>)}</tr></tbody></table></div>
    <p className="scheme-selection-note">系统建议由条件核验形成；打开某个方案只切换当前工作对象。两方案的历史版本变化在成果管理中查看。</p>
    {!!strategy && <div className="scheme-comparison-sources">{modes.map(mode => { const path = strategy.paths.find(row => row.mode === mode), refs = [...new Set(path?.actions.flatMap(action => action.evidence_refs) || [])]; return <button key={mode} className="text-button" disabled={!refs.length} onClick={() => onEvidence(refs, packet || undefined)}>查看{MODE_LABELS[mode]}的方案依据</button> })}</div>}
  </section>
}
