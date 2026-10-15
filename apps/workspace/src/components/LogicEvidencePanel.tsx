import { useId } from 'react'
import type { Project } from '../api'
import type { StrategyPacket, StrategySource } from '../../../../packages/retrofit/strategy'
import { MODE_LABELS, MODE_STANDARD, projectRenewalModeInput, type ModeCondition } from '../../../../packages/retrofit/renewal-mode'
import { currentDirectionText, type StrategyDirection } from './strategy-direction-text'
import './LogicEvidencePanel.css'

export type LogicEvidencePanelProps = {
  project: Project
  selectedDirection?: StrategyDirection | null
  strategyPacket: StrategyPacket | null
  onEvidence: (refs: string[]) => void
}

const dimensionGroups = {
  demand: { standard: 'consent_relocation', label: '居民需求' },
  supply: { standard: 'maintenance', label: '公共服务' },
  adaptation: { standard: 'safety', label: '居住工程' },
  implementation: { standard: 'rights_planning', label: '实施协同' },
  operations: { standard: 'maintenance', label: '长效维护' },
  resources: { standard: 'funding', label: '资金交付' },
} as const
const conditionLabels: Record<string, string> = {
  structure_repairable: '结构可修复性', demolition_permitted: '拆除与保护条件', rights_clear: '权属与边界',
  rebuild_planning_confirmed: '重建规划条件', resident_resolution_valid: '居民决议', relocation_ready: '腾退与回搬',
  funding_secured: '资金落实', life_cycle_cost_compared: '全周期费用比选', maintenance_entity_confirmed: '维护责任',
}
const repairConditions = new Set(['structure_repairable', 'rights_clear', 'resident_resolution_valid', 'funding_secured', 'maintenance_entity_confirmed'])
const conditionStatus = (condition: ModeCondition) => condition.state === 'conflict' ? '记录存在分歧'
  : condition.state === 'unknown' || condition.value === null ? '待核实' : condition.value ? '已确认' : '已确认不成立'

/** Shared source IDs retain the original text even when one file covers several decisions or directions. */
function EvidenceSource({ id, source, quote, project, onEvidence }: {
  id: string; source?: StrategySource; quote?: string; project: Project; onEvidence: LogicEvidencePanelProps['onEvidence']
}) {
  if (!source) return <div className="logic-evidence-source is-missing" data-source-id={id}><strong>引用 {id}</strong><p>本轮未保存对应来源片段。</p></div>
  const registered = project.input.sources.find(row => row.id === id)
  const role = source.visibility === 'internal' ? '项目内部材料' : source.role === 'current' ? '本对象资料' : '参考资料'
  const date = source.source_date ? `材料标注日期 ${source.source_date}` : source.published_at ? `来源日期 ${source.published_at.slice(0, 10)}` : '日期未登记'
  const literalQuote = quote?.trim() && source.text.includes(quote) ? quote : source.text
  return <details className="logic-evidence-source" data-source-id={id}>
    <summary>{source.title}</summary>
    <p className="logic-evidence-source-meta">{role} · {date}</p>
    <p className="logic-evidence-locator">原文定位：{source.locator || '未登记定位'}</p>
    <blockquote>{literalQuote}</blockquote>
    {literalQuote !== source.text && <details><summary>核对该来源完整片段</summary><blockquote>{source.text}</blockquote></details>}
    {(source.document_version || registered?.hash) && <p className="logic-evidence-version">材料版本：{source.document_version || registered?.hash}</p>}
    <div className="logic-evidence-source-actions">
      {registered && <button type="button" onClick={() => onEvidence([id])}>定位来源库原文</button>}
      {source.url && /^https?:\/\//.test(source.url) && <a href={source.url} target="_blank" rel="noreferrer">打开原始来源 ↗</a>}
    </div>
  </details>
}

/** Controlled by App's selected direction and exact current packet; this panel never fetches a public replacement. */
export default function LogicEvidencePanel({ project, selectedDirection, strategyPacket, onEvidence }: LogicEvidencePanelProps) {
  const headingId = useId()
  const valid = strategyPacket?.project_id === project.id && strategyPacket.context_version === project.context_version
    && strategyPacket.synthetic === project.input.synthetic && strategyPacket.status === 'completed' && !!strategyPacket.strategy
  const packet = valid ? strategyPacket : null, strategy = packet?.strategy
  const evidence = (ids: string[], quote?: string) => [...new Set(ids)].map(id => <EvidenceSource key={id} id={id}
    source={packet?.sources.find(source => source.id === id)} quote={quote} project={project} onEvidence={onEvidence} />)

  if (!selectedDirection) return <section className="logic-evidence-panel" aria-labelledby={headingId}>
    <header><span>判断标准 → 方向建议 → 原文依据</span><h3 id={headingId}>先明确本次研究方向</h3><p>选择方向后，这里只呈现该方向的判断逻辑与引用。上传文件和全部原始材料继续保留在下方来源库。</p></header>
    <details className="logic-evidence-comparison"><summary>方向选择前：核对两种路径的判断标准</summary>
      <div className="logic-evidence-table"><table><thead><tr><th>判断标准</th><th>综合整治</th><th>原拆原建</th></tr></thead>
        <tbody>{MODE_STANDARD.map(row => <tr key={row.key}><th>{row.label}</th><td>{row.comprehensive}</td><td>{row.rebuild}</td></tr>)}</tbody></table></div>
      {strategy?.rationale.map((claim, index) => <article className="logic-evidence-rationale" key={index}><h4>{claim.point}</h4>{evidence([claim.source_id], claim.quote)}</article>)}
    </details>
  </section>

  const label = MODE_LABELS[selectedDirection]
  if (!strategy || !packet) return <section className="logic-evidence-panel" data-selected-direction={selectedDirection} aria-labelledby={headingId}>
    <header><span>{label} · 逻辑与证据</span><h3 id={headingId}>尚无当前版本方案</h3></header>
    <p className={strategyPacket ? 'logic-evidence-stale' : 'logic-evidence-empty'}>{strategyPacket
      ? '所传方案与当前项目、资料版本或模拟状态不一致，请先回到方向判断读取本次方案。'
      : '完成当前项目的方向判断与本轮研究后，这里显示建议及其原文依据。'}</p>
  </section>

  const path = strategy.paths.find(row => row.mode === selectedDirection)
  const modeInput = projectRenewalModeInput(project.input)
  const standards = MODE_STANDARD.map(standard => {
    const kinds = new Set<string>(standard.kinds)
    return { ...standard, conditions: modeInput.conditions.filter(condition => kinds.has(condition.kind)
      && (selectedDirection === 'rebuild' || repairConditions.has(condition.kind))),
      dimensions: strategy.dimensions.filter(dimension => dimensionGroups[dimension.key].standard === standard.key)
        .map(dimension => ({ ...dimension, text: currentDirectionText(dimension[selectedDirection], selectedDirection) })).filter(dimension => dimension.text) }
  })
  const actions = (path?.actions || []).map((action, index) => ({ ...action, index,
    title: currentDirectionText(action.title, selectedDirection), detail: currentDirectionText(action.detail, selectedDirection) }))
    .filter(action => action.title || action.detail)
  const requirements = (path?.requirements || []).map(text => currentDirectionText(text, selectedDirection)).filter(Boolean)

  return <section className="logic-evidence-panel" data-selected-direction={selectedDirection} aria-labelledby={headingId}>
    <header><span>判断标准 → {label}建议 → 证据原文</span><h3 id={headingId}>{label} · 判断逻辑与证据</h3>
      <p>按现有六维语义组织工程、资金、实施与居民服务；建议和引用沿用本次方案，条件状态取自项目已登记记录。</p></header>
    <section className="logic-evidence-standards" aria-label="本方向判断标准与已有说明"><h4>1. 按什么标准判断</h4>
      <div className="logic-evidence-standard-grid">{standards.map(standard => <article className="logic-evidence-standard" key={standard.key}>
        <h5>{standard.label}</h5><p>{standard[selectedDirection]}</p>
        <ul className="logic-evidence-conditions">{standard.conditions.map(condition => <li key={condition.kind}>
          <strong>{conditionLabels[condition.kind] || condition.kind}</strong><span>{conditionStatus(condition)}</span>
          {!!condition.locators.length && <small>登记定位：{condition.locators.join('；')}</small>}
        </li>)}</ul>
        {standard.dimensions.map(dimension => <div className="logic-evidence-dimension" key={dimension.key}>
          <strong>{dimensionGroups[dimension.key].label} · 本方向说明</strong><p>{dimension.text}</p>{evidence(dimension.evidence_refs)}
        </div>)}
      </article>)}</div>
    </section>
    <section className="logic-evidence-path" aria-label="本方向建议与实施要求">
      <div className="logic-evidence-decision-copy"><h4>2. 本方向的建议与举措</h4>
        <h5>{path && currentDirectionText(path.title, selectedDirection) || `${label}方案`}</h5>
        {path && <p>{currentDirectionText(path.description, selectedDirection)}</p>}
        {!!requirements.length && <details className="logic-evidence-requirements"><summary>本方向的实施要求</summary><ul>{requirements.map((text, index) => <li key={index}>{text}</li>)}</ul></details>}
      </div>
      {actions.map(action => {
        const refs = new Set(action.evidence_refs)
        const related = standards.filter(standard => standard.conditions.some(condition => condition.source_ids.some(id => refs.has(id)))
          || standard.dimensions.some(dimension => dimension.evidence_refs.some(id => refs.has(id))))
        return <article className="logic-evidence-action" key={`${selectedDirection}:${action.index}`}>
          <div><div className="logic-evidence-decision-copy"><h5>{action.title || '本方向专项举措'}</h5><p>{action.detail}</p></div>
            <p className="logic-evidence-action-standards"><strong>判断对应：</strong>{related.length ? related.map(row => row.label).join('、') : '本方向措施与实施要求'}</p>
            {!!related.length && <small>按已登记条件或六维说明中共同引用的来源对应。</small>}
          </div>
          <div className="logic-evidence-originals"><h6>3. 这项建议引用哪些原文</h6>{action.evidence_refs.length
            ? evidence(action.evidence_refs) : <p>该项方案未登记具体来源引用。</p>}</div>
        </article>
      })}
      {!actions.length && <p className="logic-evidence-empty">本次方案尚未保存该方向的具体举措。</p>}
    </section>
  </section>
}
