import { useMemo, useState } from 'react'
import type { StrategyPacket } from '../../../../packages/retrofit/strategy'
import type { RenewalModeGate } from '../../../../packages/retrofit/renewal-mode'
import { MODE_LABELS } from '../../../../packages/retrofit/renewal-mode'
import { compareGoalPriorities, PRIORITY_DIMENSIONS, PRIORITY_PRESETS, type PriorityWeights } from '../../../../packages/retrofit/decision-priorities'
import './decision-brief.css'

const number = (value: number) => value.toLocaleString('zh-CN', { maximumFractionDigits: 1 })
const gradeLabels = { low: '低', medium: '中', high: '高', unknown: '待评价' }
const firstSentence = (text: string) => text.trim().split(/(?<=[。！？])/)[0] || text

export default function DecisionBrief({ result, gate, onEvidence, onPlan, showPriorities = true }: {
  result: StrategyPacket; gate: RenewalModeGate; onEvidence: (refs: string[]) => void; onPlan: () => void; showPriorities?: boolean;
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
  const selected = strategy.paths.find(row => row.mode === path), brief = strategy.decision_brief
  const guarded = strategy.preferred_mode === 'rebuild' && !gate.rebuild_allowed || strategy.preferred_mode === 'comprehensive' && direction !== 'comprehensive'
  const safeHeadline = direction === 'investigate' ? '先核查结构处置与实施条件' : selected?.title || MODE_LABELS[direction]
  const headline = guarded ? safeHeadline : strategy.headline
  const lead = guarded ? selected?.description || gate.summary : brief?.renewal.reason || strategy.summary || selected?.description || ''
  const renewal = { conclusion: guarded ? safeHeadline : brief?.renewal.conclusion || selected?.title || firstSentence(strategy.summary), reason: guarded ? gate.summary : brief?.renewal.reason || selected?.description || strategy.rationale[0]?.point || strategy.summary,
    refs: brief?.renewal.evidence_refs || selected?.actions.flatMap(action => action.evidence_refs) || strategy.rationale.map(row => row.source_id) }
  const investment = { conclusion: guarded && brief?.investment.stage === 'construction' ? '先核查实施与资金条件，再确定工程投入' : brief?.investment.conclusion || firstSentence(resources?.[path] || resources?.current || selected?.requirements.join('；') || ''),
    reason: brief?.investment.reason || resources?.current || selected?.description || '', refs: brief?.investment.evidence_refs || resources?.evidence_refs || [] }
  const financial = brief?.returns.financial || resources?.[path] || resources?.current || '本次研判尚无对应财务测算说明。'
  const socialReturn = brief?.returns.social || social.map(row => `${PRIORITY_DIMENSIONS.find(item => item.key === row.key)?.label || row.key}：${row[path]}`).join('；')
  const returnsRefs = brief?.returns.evidence_refs || [...(resources?.evidence_refs || []), ...social.flatMap(row => row.evidence_refs)]
  const references = (refs: string[]) => [...new Set(refs)].filter(id => sourceIds.has(id))
  const latestCall = [...result.model_calls].reverse().find(call => call.stage === 'renewal_strategy') || result.model_calls.at(-1)
  const unknown = gate.checks.filter(row => row.state === 'unknown').length, met = gate.checks.filter(row => row.state === 'met').length
  const label = (preference: string) => preference === 'unresolved' ? '补齐评价后排序' : preference === 'tie' ? '两方案偏好相近' : `${MODE_LABELS[preference as 'comprehensive' | 'rebuild']}适配更高`
  return <section className="decision-brief" aria-label="更新与投资决策摘要">
    <header><span>AI 综合研判{guarded ? ' · 已应用程序核验' : ''}</span><h3>{headline}</h3><p>{lead}</p><div className="decision-ai-meta">{latestCall?.returned_model ? `模型：${latestCall.returned_model}` : latestCall?.requested_model ? `请求模型：${latestCall.requested_model}（返回标识未登记）` : '已保存研判 · 模型标识未登记'} · 本次方案关联 {result.sources.length} 份资料</div></header>
    <aside className="decision-program-check" aria-label="程序核验方向"><div><strong>程序核验方向</strong><span>{MODE_LABELS[direction]}</span></div><p>拆建条件已满足 {met}/{gate.checks.length} · 待核 {unknown}</p><details><summary>核验说明与模型原始分析</summary><p>{gate.summary}</p><p>下一步：{gate.next_step}</p>{guarded && <div className="decision-original-analysis"><strong>原始模型分析</strong><h4>{strategy.headline}</h4><p>{strategy.summary}</p>{brief && <><p>{brief.renewal.conclusion}：{brief.renewal.reason}</p><p>{brief.investment.conclusion}：{brief.investment.reason}</p></>}</div>}</details></aside>
    <div className="decision-questions">
      <article><span>01 要不要更新</span><h4>{renewal.conclusion}</h4><p>{renewal.reason}</p>{!!references(renewal.refs).length && <button onClick={() => onEvidence(references(renewal.refs))}>查看更新判断依据</button>}<button onClick={onPlan}>选择研究方向 →</button></article>
      <article><span>02 值不值得投入</span><h4>{investment.conclusion || '本次方案尚未给出投入结论'}</h4>{brief && <span className="decision-investment-stage" data-stage={guarded && brief.investment.stage === 'construction' ? 'preliminary' : brief.investment.stage}>模型建议阶段：{({ preliminary: '前期论证投入', construction: '工程投入', hold: '暂缓投入' })[guarded && brief.investment.stage === 'construction' ? 'preliminary' : brief.investment.stage]}</span>}<p>{investment.reason}</p>{!!references(investment.refs).length && <button onClick={() => onEvidence(references(investment.refs))}>查看投入与资金依据</button>}</article>
      <article><span>03 投入带来什么</span><dl className="decision-returns"><div><dt>财务收益与收支</dt><dd>{financial}</dd></div><div><dt>社会收益</dt><dd>{socialReturn || '本次研判尚无对应社会效果说明。'}</dd></div></dl>{!!references(returnsRefs).length && <button onClick={() => onEvidence(references(returnsRefs))}>查看收益与效果依据</button>}</article>
    </div>
    {!!strategy.rationale.length && <section className="decision-ai-rationale strategy-rationale" aria-label="AI研判的主要依据"><h4>这项判断依据什么</h4>{strategy.rationale.slice(0, 3).map((row, index) => <article key={`${row.source_id}:${index}`}><p>{row.point}</p><details><summary>展开引用原文</summary><blockquote>{row.quote}</blockquote></details><button disabled={!sourceIds.has(row.source_id)} onClick={() => onEvidence([row.source_id])}>依据 {index + 1} · {result.sources.find(source => source.id === row.source_id)?.title || '来源暂不可读'} →</button></article>)}</section>}
    <p className="decision-principle"><strong>模型负责解释，程序负责判定。</strong>每个结论对应判断标准、原文依据和下一步行动。</p>
    {showPriorities && <details className="decision-criteria">
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
          <p className="decision-current-action">当前程序方向：{MODE_LABELS[direction]}。本次研究方向在下方明确选择。</p>
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
    </details>}
  </section>
}
