import { useState } from 'react'
import type { DecisionDashboard as Dashboard } from '../../../host/generated/contracts'
import type { StrategyPacket } from '../../../../packages/retrofit/strategy'
import DecisionDashboard from './DecisionDashboard'
import './strategy-current-assessment.css'

type Description = { key: string; label: string; text: string; evidence_refs: string[] }
const levels = { low: 1, medium: 3, high: 5 }

export default function StrategyCurrentAssessment({ result, dashboard, descriptions, demoActive, onEvidence, onScheme }: {
  result: StrategyPacket; dashboard: Dashboard; descriptions: Description[]; demoActive: boolean;
  onEvidence: (refs: string[], packet?: StrategyPacket) => void; onScheme: () => void;
}) {
  const rows = result.strategy?.reasoning_dimensions || []
  const validReasoning = rows.length === 6 && new Set(rows.map(row => row.key)).size === 6 && descriptions.every(row => rows.some(reason => reason.key === row.key))
  const fallback = result.workflow?.tasks.some(task => task.reasoning === 'reasoned_fallback') && dashboard.dimensions.some(row => row.value === null)
  const [view, setView] = useState<'evidence' | 'reasoning'>(validReasoning && fallback ? 'reasoning' : 'evidence')
  const reasoning = validReasoning && view === 'reasoning'
  const sourceIds = new Set(result.sources.filter(source => !source.project_id || source.project_id === result.project_id).map(source => source.id))
  const reasoningDashboard: Dashboard = { ...dashboard, purpose: '推理情景', dimensions: rows.map(row => ({ key: row.key, value: levels[row.level], confidence: null, basis: [`${row.basis === 'logical_inference' ? '逻辑推理' : '情景假设'} · ${row.level === 'low' ? '低' : row.level === 'medium' ? '中' : '高'}等级`, `前提：${row.premises.join('；')}`, `假设：${row.assumptions.join('；') || '未额外设定'}`, `评分依据：${row.reason}`, `验证方式：${row.verification}`].join('\n'), evidence_refs: row.evidence_refs.filter(id => sourceIds.has(id)) })) }
  return <section className={`strategy-current-assessment${reasoning ? ' strategy-current--reasoning' : ''}`} aria-label="六维现况画像" data-assessment-view={reasoning ? 'reasoning' : 'evidence'}>
    <header><h3>{reasoning ? '推理情景画像' : '现况画像'}</h3><p>{reasoning ? '基于本轮前提与假设形成的六维判断' : demoActive ? '完整模拟 · 同一社区现况基线' : '本项目现况证据 · 未知项保留待评价'} · 资料 v{result.context_version}</p></header>
    {validReasoning && <div className="strategy-assessment-switch" role="group" aria-label="六维评价依据"><button aria-pressed={!reasoning} onClick={() => setView('evidence')}>证据画像</button><button aria-pressed={reasoning} onClick={() => setView('reasoning')}>推理情景</button></div>}
    {reasoning && <p className="strategy-reasoning-tag"><strong>推理情景</strong>点击维度查看前提、假设、评分依据和验证方式；现况证据等级另行保留。</p>}
    <DecisionDashboard key={reasoning ? 'reasoning' : 'evidence'} value={reasoning ? reasoningDashboard : dashboard} onEvidence={refs => onEvidence(refs, result)} presentation={reasoning ? { title: '前提与假设下的六维判断', scale: '推理情景等级 · 1/3/5级', accessibleLabel: '六维推理情景判断', method: '等级取自本轮模型的推理情景字段。点击各维度核对前提、假设与验证方式，资料补充后再与现况证据对照。' } : { title: '现有社区的六维现况', scale: demoActive ? '模拟条件覆盖 · 1–5级' : '现况证据适配 · 1/3/5级', accessibleLabel: demoActive ? '六维模拟条件覆盖' : '六维现况证据画像', method: '现况与方案目标分开呈现；方案改后目标在单方案工作区查看。' }} />
    {!reasoning && <div className="strategy-dimension-cards">{descriptions.map(row => <article key={row.key}><h4>{row.label}</h4><p>{row.text}</p><button disabled={!row.evidence_refs.length} onClick={() => onEvidence(row.evidence_refs, result)}>查看本维依据</button></article>)}</div>}
    <button className="secondary" onClick={onScheme}>查看某一方案的预期改善 →</button>
  </section>
}
