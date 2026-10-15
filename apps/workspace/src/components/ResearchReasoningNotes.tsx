import type { StrategyPacket } from '../../../../packages/retrofit/strategy'
import './research-reasoning-notes.css'

const roles = { building_delivery: '建筑与实施', cost_value: '投入与价值', residents_operations: '居民与运营' }
const number = (value: number) => Number.isFinite(value) ? value.toLocaleString('zh-CN', { maximumFractionDigits: 20 }) : '未登记'

export default function ResearchReasoningNotes({ result, onEvidence, onScenario }: {
  result: StrategyPacket | null;
  onEvidence: (refs: string[], packet?: StrategyPacket) => void;
  onScenario?: (pane: 'funding' | 'operations') => void;
}) {
  const proposals = result?.workflow?.notes?.flatMap(note => (note.reasoned_proposals || []).map((proposal, index) => ({ note, proposal, index }))) || []
  if (!result || !proposals.length) return null
  const partial = result.status !== 'completed' || !result.strategy
  const sourceIds = new Set(result.sources.filter(source => !source.project_id || source.project_id === result.project_id).map(source => source.id))
  return <section className="research-reasoning-notes" aria-label="逻辑推理与情景假设" data-result-status={result.status}>
    <header><div><h3>{partial ? '已取得的推理建议' : '模型推理与情景建议'}</h3><p>{partial ? '本轮最终方案尚未形成，以下为已返回的专家建议。' : '根据本轮前提与假设提出建议，可逐项核实并进入情景测算。'}</p></div><span>推理建议 · 非原始事实</span></header>
    <div className="reasoning-proposals">{proposals.map(({ note, proposal, index }) => {
      const task = result.workflow?.tasks.find(row => row.id === note.task_id)
      const refs = [...new Set(proposal.evidence_refs.filter(id => sourceIds.has(id)))]
      return <article key={`${note.task_id}:${index}`} data-reasoning-kind={proposal.kind}>
        <div className="reasoning-proposal-labels"><strong>{proposal.kind === 'logical_inference' ? '逻辑推理' : '情景假设'}</strong>{task && <span>{roles[task.role]}</span>}</div>
        <h4>{proposal.conclusion}</h4>
        <dl><div><dt>前提</dt><dd>{proposal.premises.map((text, i) => <p key={i}>{text}</p>)}</dd></div><div><dt>假设</dt><dd>{proposal.assumptions.length ? proposal.assumptions.map((text, i) => <p key={i}>{text}</p>) : '未额外设定'}</dd></div><div><dt>验证办法</dt><dd>{proposal.verification}</dd></div></dl>
        {!!proposal.parameters?.length && <div className="reasoning-parameters"><table><caption>本建议的情景参数</caption><thead><tr><th>参数</th><th>情景值</th><th>下限</th><th>上限</th><th>单位</th><th>取值依据</th></tr></thead><tbody>{proposal.parameters.map((parameter, i) => <tr key={i}><th scope="row">{parameter.name}</th><td>{number(parameter.value)}</td><td>{number(parameter.low)}</td><td>{number(parameter.high)}</td><td>{parameter.unit}</td><td>{parameter.basis}</td></tr>)}</tbody></table></div>}
        {!!refs.length && <button className="text-button" onClick={() => onEvidence(refs, result)}>查看关联来源 →</button>}
      </article>
    })}</div>
    {onScenario && <footer><span>参数按本轮假设只读展示；可在方案工作区设置测算输入。</span><div><button className="secondary" onClick={() => onScenario('funding')}>进入建设资金测算 →</button><button className="secondary" onClick={() => onScenario('operations')}>进入社区运营测算 →</button></div></footer>}
  </section>
}
