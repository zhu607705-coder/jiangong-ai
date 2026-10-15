import { useMemo, useState } from 'react'
import type { StrategyPacket } from '../../../../packages/retrofit/strategy'
import type { RenewalModeGate } from '../../../../packages/retrofit/renewal-mode'
import { MODE_LABELS } from '../../../../packages/retrofit/renewal-mode'
import { compareGoalPriorities, PRIORITY_DIMENSIONS, PRIORITY_PRESETS, type PriorityWeights } from '../../../../packages/retrofit/decision-priorities'
import './decision-brief.css'

const number = (value: number) => value.toLocaleString('zh-CN', { maximumFractionDigits: 1 })
const gradeLabels = { low: '低', medium: '中', high: '高', unknown: '待评价' }

export default function DecisionBrief({ result, gate, onEvidence, onPlan }: {
  result: StrategyPacket; gate: RenewalModeGate; onEvidence: (refs: string[]) => void; onPlan: () => void;
}) {
  const strategy = result.strategy!
  const [weights, setWeights] = useState<PriorityWeights>({ ...PRIORITY_PRESETS[0].weights })
  const sourceIds = useMemo(() => new Set(result.sources.map(source => source.id)), [result.sources])
  const comparison = useMemo(() => {
    try { return compareGoalPriorities(strategy.dimensions, weights, sourceIds) } catch { return null }
  }, [strategy.dimensions, weights, sourceIds])
  const direction = gate.direction
  const path: 'comprehensive' | 'rebuild' = direction === 'rebuild' ? 'rebuild' : 'comprehensive'
  const resources = strategy.dimensions.find(row => row.key === 'resources')
  const social = strategy.dimensions.filter(row => ['demand', 'supply', 'operations'].includes(row.key))
  const headline = direction === 'rebuild' ? '优先开展原拆原建论证' : direction === 'investigate' ? '先完成专项核查，明确更新路径' : '综合整治优先，按栋分期推进论证'
  const actions = strategy.paths.find(row => row.mode === path)?.actions.slice(0, 3) || []
  const label = (preference: string) => preference === 'unresolved' ? '补齐评价后排序' : preference === 'tie' ? '两方案偏好相近' : `${MODE_LABELS[preference as 'comprehensive' | 'rebuild']}适配更高`
  return <section className="decision-brief" aria-label="更新与投资决策摘要">
    <header><span>辅助决策 · 先给判断，再看依据</span><h3>{headline}</h3><p>按实施条件确定路径，按资金与居民效果安排投入顺序。</p></header>
    <div className="decision-questions">
      <article><span>01 要不要更新</span><h4>{direction === 'investigate' ? '优先启动专项核查' : '建议推进更新前期工作'}</h4><p>{direction === 'investigate' ? gate.next_step : `优先研究：${actions.map(action => action.title).join('、') || '本对象的分项改善与实施安排'}。`}</p><button onClick={onPlan}>查看具体举措 →</button></article>
      <article><span>02 值不值得投入</span><h4>{direction === 'investigate' ? '先投入关键问题核实' : '先投分项论证，按成熟度分期'}</h4><p>把工程范围、资金来源、居民承担与维护费用列入同一方案，优先安排有需求、有实施路径的项目。</p><details><summary>费用与资金依据</summary><p>{resources?.current || '建立分项概算和资金安排表。'}</p>{!!resources?.evidence_refs.length && <button onClick={() => onEvidence(resources!.evidence_refs)}>查看资金原文</button>}</details></article>
      <article><span>03 投入带来什么</span><h4>财务收支与社会改善分别比较</h4><p>财务看建设投入、经营收支和持续维护；社会看通行便利、供水可靠、服务覆盖与居民负担。</p><details><summary>本方案的具体改善目标</summary>{social.map(row => <div key={row.key}><strong>{PRIORITY_DIMENSIONS.find(item => item.key === row.key)?.label}</strong><p>{row[path]}</p><button onClick={() => onEvidence(row.evidence_refs)}>查看依据</button></div>)}</details></article>
    </div>
    <p className="decision-principle"><strong>模型负责解释，程序负责判定。</strong>每个结论对应判断标准、原文依据和下一步行动。</p>
    <details className="decision-criteria">
      <summary><strong>判断标准与目标权重</strong><span>先检查实施条件，再比较方案适配</span></summary>
      <div className="decision-rule-chain"><article><b>1</b><strong>实施条件</strong><p>结构、权属规划、居民决议、安置、资金和维护逐项核实。</p></article><article><b>2</b><strong>目标取舍</strong><p>在同一效果标尺下调整目标权重，对照两条路径。</p></article><article><b>3</b><strong>形成行动</strong><p>给出优先路径、分期举措与下一项调查，并关联原文。</p></article></div>
      <div className="decision-preference-heading"><h4>调整目标，看看取舍怎样变化</h4><p>滑杆表示该项从低适配改善到高适配的价值。预设可直接调整。</p></div>
      <div className="decision-presets">{PRIORITY_PRESETS.map(preset => <button key={preset.id} aria-pressed={PRIORITY_DIMENSIONS.every(row => weights[row.key] === preset.weights[row.key])} onClick={() => setWeights({ ...preset.weights })}>{preset.label}</button>)}</div>
      <div className="decision-weight-layout"><div className="decision-sliders">{PRIORITY_DIMENSIONS.map(row => <label key={row.key}><span>{row.label}<strong>{comparison ? number(weights[row.key] / PRIORITY_DIMENSIONS.reduce((total, item) => total + weights[item.key], 0) * 100) : 0}%</strong></span><input type="range" min="0" max="5" step="1" aria-label={`${row.label}目标权重`} value={weights[row.key]} onChange={event => setWeights(current => ({ ...current, [row.key]: Number(event.target.value) }))}/></label>)}</div>
        <div className="decision-preference-results" aria-live="polite">{comparison ? <>
          <h4>{label(comparison.preference)}</h4>
          {(['comprehensive', 'rebuild'] as const).map(mode => {
            const assessment = comparison[mode]
            const knownContribution = assessment.contributions.reduce((total, row) => total + (row.contribution ?? 0), 0)
            return <article key={mode}>
              <header><strong>{MODE_LABELS[mode]}</strong><b>{assessment.score === null ? `${number(assessment.lower)}–${number(assessment.upper)}` : number(assessment.score)}<small> / 100</small></b></header>
              <div className="decision-score-track"><span style={{ width: `${assessment.lower}%` }}/>{assessment.score === null && <i style={{ left: `${assessment.lower}%`, width: `${assessment.upper - assessment.lower}%` }}/>}</div>
              <p>已知贡献 {number(knownContribution)} 分 · 已评价目标权重 {number(assessment.assessed_share * 100)}%</p>
              <p>{assessment.missing.length ? `${assessment.missing.length}项效果待评价` : '所选目标均已有评价'}</p>
            </article>
          })}
          <p className="decision-current-action">当前行动：{headline}。</p>
        </> : <p role="alert">请至少保留一项目标权重。</p>}</div></div>
      <details className="decision-score-detail"><summary>查看评分依据、贡献与敏感性</summary><p>沿用方案低／中／高适配等级，依次记20／60／100；按归一化权重加总。待评价维度保留20至100的可能范围，阴影表示其影响。实施条件由独立规则核验。</p>
        <div className="decision-table-scroll"><table><thead><tr><th>判断维度</th><th>权重</th><th>综合整治</th><th>原拆原建</th><th>原文</th></tr></thead><tbody>{PRIORITY_DIMENSIONS.map(row => {
          const dimension = strategy.dimensions.find(item => item.key === row.key)
          return <tr key={row.key}><th>{row.label}</th><td>{comparison ? `${number(comparison.comprehensive.contributions.find(item => item.key === row.key)!.share * 100)}%` : '—'}</td>
            {(['comprehensive', 'rebuild'] as const).map(mode => {
              const contribution = comparison?.[mode].contributions.find(item => item.key === row.key)
              return <td key={mode}>{contribution?.score !== null && dimension ? gradeLabels[dimension[`${mode}_level`]] : '待评价'}<small>{contribution?.share === 0 ? '未纳入' : contribution?.contribution != null ? `贡献 ${number(contribution.contribution)} 分` : '补充评价后计算'}</small></td>
            })}
            <td><button disabled={!dimension?.evidence_refs.length} onClick={() => onEvidence(dimension?.evidence_refs || [])}>查看依据</button></td></tr>
        })}</tbody></table></div>
        <ul>{PRIORITY_PRESETS.map(preset => <li key={preset.id}>{preset.label}：{label(compareGoalPriorities(strategy.dimensions, preset.weights, sourceIds).preference)}</li>)}</ul><p>计算版本 {comparison?.policy_version || 'renewal-goal-sensitivity-v1'} · 方案资料 v{result.context_version} · 本次调整仅用于当前页面比较。</p>
      </details>
    </details>
  </section>
}
