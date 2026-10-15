import { useEffect, useMemo, useState } from 'react'
import type { RenewalStrategy } from '../../../host/generated/contracts'
import type { ResearchMaterial, ResearchMissingMaterial, ResearchRound } from '../../../../packages/retrofit/research-rounds'
import type { StrategyPacket, StrategySource } from '../../../../packages/retrofit/strategy'
import { MODE_LABELS } from '../../../../packages/retrofit/renewal-mode'
import { currentDirectionText, type StrategyDirection } from './strategy-direction-text'
import './decision-comparison.css'

type CompletedPacket = StrategyPacket & { strategy: RenewalStrategy }
type Snapshot = { key: string; label: string; packet: CompletedPacket; round: ResearchRound | null }
type Level = RenewalStrategy['dimensions'][number]['current_level']
type Cell = { text: string[]; refs: string[]; packet: CompletedPacket }
type ComparisonRow = { key: string; label: string; before: Cell; after: Cell | null }
const DIMENSIONS = [{ key: 'demand', label: '居民需求' }, { key: 'supply', label: '公共服务' }, { key: 'adaptation', label: '居住工程' }, { key: 'implementation', label: '实施协同' }, { key: 'operations', label: '长效维护' }, { key: 'resources', label: '资金交付' }] as const
const LEVELS: Record<Level, { label: string; value: number | null }> = { low: { label: '低', value: 1 }, medium: { label: '中', value: 3 }, high: { label: '高', value: 5 }, unknown: { label: '待评价', value: null } }
const STAGES = { preliminary: '前期论证投入', construction: '工程投入', hold: '暂缓投入' }
const CATEGORY_LABELS: Record<ResearchMaterial['material_category'], string> = { resident_needs: '居民需求', resident_satisfaction: '满意度调查', structural_assessment: '结构与工程鉴定', cost_funding: '预算与资金', operations: '运营台账', other: '其他资料' }
const unique = (values: string[]) => [...new Set(values)]
const complete = (packet: StrategyPacket | null | undefined): packet is CompletedPacket => !!packet && packet.status === 'completed' && !!packet.strategy
const sourceVersion = (source: StrategySource) => `${source.id}\u0000${source.document_version || source.text}\u0000${source.locator}`
const fileVersion = (material: ResearchMaterial) => `${material.document_id}:${material.version}`
const dateLabel = (value: string) => new Date(value).toLocaleDateString('zh-CN')
const cleanText = (text: string, direction?: StrategyDirection | null) => direction ? currentDirectionText(text, direction) : text
const dimension = (packet: CompletedPacket, key: typeof DIMENSIONS[number]['key']) => { const rows = packet.strategy.dimensions.filter(row => row.key === key); return rows.length === 1 ? rows[0] : null }
const level = (packet: CompletedPacket, key: typeof DIMENSIONS[number]['key'], direction?: StrategyDirection | null): Level => { const row = dimension(packet, key); return row ? direction ? row[`${direction}_level`] : row.current_level : 'unknown' }
const knownRefs = (packet: StrategyPacket, refs: string[]) => unique(refs).filter(id => packet.sources.some(source => source.id === id && !!source.text.trim()))
const supportedCurrentDimension = (packet: CompletedPacket, key: typeof DIMENSIONS[number]['key']) => { const row = dimension(packet, key); return !!row && row.current_level !== 'unknown' && row.evidence_refs.some(id => packet.sources.some(source => source.id === id && source.role === 'current' && !!source.text.trim())) }

/** Counts concern the saved analysis and its references, not construction or resident outcomes. */
export function decisionComparisonMetrics(packet: StrategyPacket) {
  if (!complete(packet)) return null
  return { sources: new Set(packet.sources.map(source => source.id)).size,
    supported: DIMENSIONS.filter(({ key }) => supportedCurrentDimension(packet, key)).length,
    unknown: DIMENSIONS.filter(({ key }) => level(packet, key) === 'unknown').length }
}

function decisionRows(snapshot: Snapshot, direction?: StrategyDirection | null): Cell[] {
  const packet = snapshot.packet, strategy = packet.strategy, path = direction ? strategy.paths.find(row => row.mode === direction) : null
  const resources = dimension(packet, 'resources'), social = strategy.dimensions.filter(row => ['demand', 'supply', 'operations'].includes(row.key))
  const brief = strategy.decision_brief, useBrief = !direction
  const text = (values: (string | undefined)[]) => values.filter((value): value is string => !!value).map(value => cleanText(value, direction)).filter(Boolean)
  const actionPaths = path ? [path] : direction ? [] : strategy.paths
  const investmentText = text([useBrief ? brief?.investment.conclusion : undefined])
  const financialText = text([useBrief ? brief?.returns.financial : undefined])
  const socialText = text([useBrief ? brief?.returns.social : undefined])
  return [
    { packet, text: direction ? text([path?.title, path?.description]) : text([`模型方向建议：${MODE_LABELS[strategy.preferred_mode]}`, brief?.renewal.conclusion || strategy.headline, brief?.renewal.reason || strategy.summary]), refs: path?.actions.flatMap(action => action.evidence_refs) || brief?.renewal.evidence_refs || strategy.rationale.map(row => row.source_id) },
    { packet, text: text([brief && investmentText.length ? `模型建议阶段：${STAGES[brief.investment.stage]}` : direction ? '该版未单列本方向的投入阶段。' : undefined, ...investmentText,
      ...(direction ? path?.requirements.slice(0, 2).map(requirement => `实施前提：${requirement}`) || [] : []), ...actionPaths.flatMap(row => row.actions.slice(0, 2).map(action => `${direction ? '' : `${MODE_LABELS[row.mode]}：`}${action.title}：${action.detail}`))]), refs: unique([...(useBrief ? brief?.investment.evidence_refs || [] : []), ...actionPaths.flatMap(row => row.actions.flatMap(action => action.evidence_refs))]) },
    { packet, text: financialText.length ? financialText : text([direction ? resources?.[direction] : resources?.current]), refs: financialText.length && brief ? brief.returns.evidence_refs : resources?.evidence_refs || [] },
    { packet, text: socialText.length ? socialText : text(social.map(row => `${DIMENSIONS.find(item => item.key === row.key)?.label}：${direction ? row[direction] : row.current}`)), refs: socialText.length && brief ? brief.returns.evidence_refs : social.flatMap(row => row.evidence_refs) },
  ]
}

function missingMaterials(snapshot: Snapshot, direction?: StrategyDirection | null): ResearchMissingMaterial[] {
  const strategy = snapshot.packet.strategy
  const registered = snapshot.round ? snapshot.round.missing_materials : strategy.round_review?.missing_materials || strategy.next_checks.map(row => ({ topic: row.title, request: row.detail, reason: '原方案列出的核实事项。', evidence_refs: row.evidence_refs }))
  return registered.map(row => ({ ...row, topic: cleanText(row.topic, direction), request: cleanText(row.request, direction), reason: cleanText(row.reason, direction) })).filter(row => row.request.trim())
}

function LevelReadout({ value }: { value: Level }) {
  const grade = LEVELS[value]
  return <div className={`dc-level dc-level--${value}`}><strong>{grade.value === null ? '待评价' : `${grade.label} · ${grade.value}`}</strong><span className="dc-level-track" aria-hidden="true">{grade.value !== null && <i style={{ left: `${(grade.value - 1) / 4 * 100}%` }}/>}</span></div>
}

export default function DecisionComparison({ rounds, materials, selectedDirection = null, candidate = null, onEvidence, onSupplement }: {
  rounds: ResearchRound[]; materials: ResearchMaterial[]; selectedDirection?: StrategyDirection | null; candidate?: StrategyPacket | null;
  onEvidence: (refs: string[], packet?: StrategyPacket) => void; onSupplement: () => void;
}) {
  const saved = useMemo(() => {
    const valid = rounds.filter(round => round.status === 'completed' && complete(round.result) && round.result.project_id === round.project_id && round.result.context_version === round.context_version).sort((a, b) => a.round_number - b.round_number)
    const subject = valid[0]?.result
    return valid.filter((round, index) => !!subject && round.project_id === subject.project_id && round.result!.synthetic === subject.synthetic && valid.findIndex(row => row.id === round.id) === index)
  }, [rounds])
  const subjectKey = saved[0] ? `${saved[0].project_id}:${saved[0].result!.synthetic}` : candidate ? `${candidate.project_id}:${candidate.synthetic}` : ''
  const [selection, setSelection] = useState<{ subject: string; before: string; after: string } | null>(null)
  const requestedBefore = selection?.subject === subjectKey ? saved.find(row => row.id === selection.before) : null
  const beforeRound = requestedBefore && (saved.length === 1 || requestedBefore.id !== saved.at(-1)?.id) ? requestedBefore : saved[0]
  const later = saved.filter(row => beforeRound && row.round_number > beforeRound.round_number)
  const afterRound = (selection?.subject === subjectKey ? later.find(row => row.id === selection.after) : null) || later.at(-1)
  const before: Snapshot | null = beforeRound && complete(beforeRound.result) ? { key: beforeRound.id, label: `第 ${beforeRound.round_number} 轮`, packet: beforeRound.result, round: beforeRound } : complete(candidate) ? { key: `candidate:${candidate.input_hash}`, label: '当前首版 · 尚未登记轮次', packet: candidate, round: null } : null
  const after: Snapshot | null = afterRound && complete(afterRound.result) ? { key: afterRound.id, label: `第 ${afterRound.round_number} 轮`, packet: afterRound.result, round: afterRound } : null
  const [view, setView] = useState<'decision' | 'dimensions'>('decision')
  const [inspection, setInspection] = useState<ComparisonRow | null>(null)
  useEffect(() => { setInspection(null) }, [before?.key, after?.key, selectedDirection])
  if (!before) return <section className="decision-comparison dc-empty" aria-label="决策版本对照"><span>资料 → 判断 → 补充 → 再判断</span><h3>先形成首版，再看决策怎样完善</h3><p>使用现有资料形成第一轮建议；随后按缺项补充项目文件，保存新一轮判断与变化。</p><button onClick={onSupplement}>进入研判总览，继续首轮研判</button></section>
  const baselineMetrics = decisionComparisonMetrics(before.packet)!, latestMetrics = after ? decisionComparisonMetrics(after.packet)! : null
  const beforeFiles = new Set(before.round?.materials.map(fileVersion) || []), baselineFileIds = new Set(before.round?.materials.map(row => row.document_id) || [])
  const afterFiles = after?.round?.materials || []
  const addedFiles = afterFiles.filter((material, index) => !beforeFiles.has(fileVersion(material)) && afterFiles.findIndex(row => fileVersion(row) === fileVersion(material)) === index)
  const pendingFiles = materials.filter(material => material.project_id === before.packet.project_id && !(after?.round || before.round)?.materials.some(row => fileVersion(row) === fileVersion(material)))
  const oldSources = new Set(before.packet.sources.map(sourceVersion)), newSources = after?.packet.sources.filter(source => !oldSources.has(sourceVersion(source))) || []
  const firstMissing = missingMaterials(before, selectedDirection), remaining = missingMaterials(after || before, selectedDirection)
  const explainedChanges = !selectedDirection ? after?.packet.strategy.round_review?.changes || [] : []
  const priorCells = decisionRows(before, selectedDirection), nextCells = after ? decisionRows(after, selectedDirection) : null
  const matrix = [{ key: 'direction', label: selectedDirection ? '本方向更新建议' : '更新方向' }, { key: 'investment', label: '投入阶段与优先举措' }, { key: 'financial', label: '财务收益与收支预期' }, { key: 'social', label: '社会效果预期' }].map((row, index): ComparisonRow => ({ ...row, before: priorCells[index], after: nextCells?.[index] || null }))
  const filled = after ? DIMENSIONS.filter(({ key }) => !supportedCurrentDimension(before.packet, key) && supportedCurrentDimension(after.packet, key)).length : 0
  const reopened = after ? DIMENSIONS.filter(({ key }) => level(before.packet, key) !== 'unknown' && level(after.packet, key) === 'unknown').length : 0
  const recommendation = (snapshot: Snapshot) => decisionRows(snapshot, selectedDirection)[0].text[0] || '本方向方案尚未记录'
  function chooseBefore(id: string) { const chosen = saved.find(row => row.id === id)!; const next = saved.filter(row => row.round_number > chosen.round_number); setSelection({ subject: subjectKey, before: id, after: next.some(row => row.id === afterRound?.id) ? afterRound!.id : next.at(-1)?.id || '' }) }
  function inspectDimension(key: typeof DIMENSIONS[number]['key'], label: string) {
    const cell = (snapshot: Snapshot): Cell => { const row = dimension(snapshot.packet, key); return { packet: snapshot.packet, text: [row ? cleanText(selectedDirection ? row[selectedDirection] : row.current, selectedDirection) : '该版没有这一维度的评价记录。'], refs: row?.evidence_refs || [] } }
    setInspection({ key, label, before: cell(before!), after: after ? cell(after) : null })
  }
  return <section className="decision-comparison" aria-label="决策版本对照" data-selected-direction={selectedDirection || ''} data-before-round={before.round?.id || ''} data-after-round={after?.round?.id || ''}>
    <header className="dc-heading"><div><span>看见资料怎样改变决策</span><h3>从首版建议，到有新依据的判断</h3><p>{selectedDirection ? `当前对照：${MODE_LABELS[selectedDirection]} · 各版均使用该方向的方案与评价。` : '方向判断对照 · 查看模型更新建议与现况评价的变化。'}</p></div><button className="dc-supplement" onClick={onSupplement}>补充资料，继续下一版 →</button></header>
    <div className="dc-version-controls" aria-label="选择对照轮次"><label>对照前版<select aria-label="对照前版" value={before.round?.id || ''} disabled={saved.length < 2} onChange={event => chooseBefore(event.target.value)}>{saved.length ? (saved.length === 1 ? saved : saved.slice(0, -1)).map(round => <option key={round.id} value={round.id}>第 {round.round_number} 轮 · 资料 v{round.context_version}</option>) : <option value="">已保存方案 · 资料 v{before.packet.context_version}</option>}</select></label><span aria-hidden="true">→</span><label>对照新版<select aria-label="对照新版" value={after?.round?.id || ''} disabled={!later.length} onChange={event => setSelection({ subject: subjectKey, before: before.round!.id, after: event.target.value })}>{later.length ? later.map(round => <option key={round.id} value={round.id}>第 {round.round_number} 轮 · 资料 v{round.context_version}</option>) : <option value="">等待补充资料后的下一版</option>}</select></label><span className="dc-saved-status">{before.round ? `${saved.length} 轮完整报告已保存` : '已有方案尚未采纳为首轮；可先阅读，再到总览继续。'}</span></div>
    <div className="dc-story" aria-label="资料到决策的变化过程"><article><span>01 前版依据</span><strong>{baselineMetrics.sources} 份关联资料</strong><p>{new Set(before.round?.materials.map(fileVersion) || []).size} 份项目文件 · 资料 v{before.packet.context_version}</p></article><article><span>02 首版建议与缺项</span><strong className="dc-clamp">{recommendation(before)}</strong><p>{firstMissing.length} 项待补资料与核实事项</p></article><article><span>03 项目补充</span><strong>{after ? `${addedFiles.length} 份新增或更新文件` : `${pendingFiles.length} 份文件可继续纳入`}</strong><p className="dc-clamp">{(after ? addedFiles : pendingFiles).slice(0, 2).map(material => material.file_name).join('、') || (after ? '本次文件清单未增加，可展开核对来源变化。' : '按下面缺项补充真实项目资料。')}</p></article><article><span>04 新版判断</span><strong className="dc-clamp">{after ? recommendation(after) : '补充资料后，形成独立的新一版'}</strong><p>{after ? `${after.label} · 资料 v${after.packet.context_version}` : '原报告与引用继续保留'}</p></article></div>
    <div className="dc-utility" aria-label="可验证的研判效用变化"><article data-metric="sources"><span>方案关联资料</span><strong>{baselineMetrics.sources}<i>→</i>{latestMetrics?.sources ?? '待比较'}</strong><p>按每版来源标识去重</p></article><article data-metric="supported"><span>有本对象原文的现况已评价维度</span><strong>{baselineMetrics.supported}<i>→</i>{latestMetrics?.supported ?? '待比较'}<small>/6</small></strong><p>现况等级已评价，引用可找到本对象正文</p></article><article data-metric="unknown"><span>现况待评价维度</span><strong>{baselineMetrics.unknown}<i>→</i>{latestMetrics?.unknown ?? '待比较'}</strong><p>{after ? `新增有原文评价 ${filled} 维 · 新增待评 ${reopened} 维` : '未知项保留未知，下一轮再对照'}</p></article></div>
    <div className="dc-matrix-heading"><div role="tablist" aria-label="对照内容"><button role="tab" aria-selected={view === 'decision'} onClick={() => setView('decision')}>决策变化</button><button role="tab" aria-selected={view === 'dimensions'} onClick={() => setView('dimensions')}>六维评价</button></div><p>{view === 'decision' ? '财务与社会效果为方案预期；资料和评价变化反映本次研判的信息增量。' : `${selectedDirection ? '本方向目标适配（方案预期）' : '现况证据适配'}：低／中／高按 1／3／5 展示，待评价留空。`}</p></div>
    <div className="dc-table-scroll"><table className="dc-matrix" aria-label={view === 'decision' ? '前后版本决策变化矩阵' : '前后版本六维评价矩阵'}><thead><tr><th scope="col">{view === 'decision' ? '判断事项' : '评价维度'}</th><th scope="col"><strong>{before.label}</strong><span>资料 v{before.packet.context_version} · {dateLabel(before.packet.created_at)}</span></th><th scope="col"><strong>{after?.label || '待形成下一版'}</strong><span>{after ? `资料 v${after.packet.context_version} · ${dateLabel(after.packet.created_at)}` : '补充后再判断'}</span></th><th scope="col">说明与依据</th></tr></thead><tbody>{view === 'decision' ? matrix.map(row => <tr key={row.key}><th scope="row">{row.label}</th>{[row.before, row.after].map((cell, index) => <td key={index}><div className="dc-cell-text dc-clamp">{cell ? cell.text.length ? cell.text.join('；') : '该版尚未给出本项说明。' : '下一版完成后在这里对照。'}</div></td>)}<td><button className="dc-text-button" onClick={() => setInspection(row)}>展开对照依据 ↗</button></td></tr>) : DIMENSIONS.map(({ key, label }) => <tr key={key} data-dimension={key}><th scope="row">{label}</th><td><LevelReadout value={level(before.packet, key, selectedDirection)}/></td><td>{after ? <LevelReadout value={level(after.packet, key, selectedDirection)}/> : <span className="dc-pending">等待下一版</span>}</td><td><button className="dc-text-button" onClick={() => inspectDimension(key, label)}>查看评价与原文 ↗</button></td></tr>)}</tbody></table></div>
    {!!explainedChanges.length && after && <details className="dc-change-reasons"><summary>模型说明：哪些依据使判断改变</summary>{explainedChanges.map((change, index) => <article key={`${change.topic}:${index}`}><h4>{change.topic || '判断变化'}</h4><p>此前：{change.before}</p><p>本轮：{change.after}</p><p>{change.reason}</p><button className="dc-text-button" onClick={() => setInspection({ key: `change-${index}`, label: change.topic || '判断变化', before: { packet: before.packet, text: [change.before], refs: [] }, after: { packet: after.packet, text: [change.after, change.reason], refs: change.evidence_refs } })}>展开这项变化的原文依据 ↗</button></article>)}</details>}
    <div className="dc-evidence-and-gaps"><details className="dc-new-evidence"><summary><strong>补充了哪些依据</strong><span>{addedFiles.length} 份新增或更新文件 · {newSources.length} 条新增或更新来源</span></summary>{addedFiles.map(material => <article key={fileVersion(material)}><h4>{material.file_name}<span>{baselineFileIds.has(material.document_id) ? '版本更新' : '新增文件'}</span></h4><p>{CATEGORY_LABELS[material.material_category]} · {material.visibility === 'internal' ? '项目内部' : '公开'} · 形成日期 {material.source_date ? `${material.source_date}（用户登记）` : '未登记'}</p><p>{material.locator} · 文件版本 {material.version.slice(0, 12)}</p></article>)}{newSources.map(source => <article key={sourceVersion(source)}><h4>{source.title}</h4><p>{source.locator} · {source.role === 'current' ? '本对象来源' : '对标参考'}</p><button className="dc-text-button" onClick={() => setInspection({ key: source.id, label: source.title, before: { packet: before.packet, text: [], refs: [] }, after: after ? { packet: after.packet, text: [], refs: [source.id] } : null })}>查看这条来源</button></article>)}{!addedFiles.length && !newSources.length && <p>当前对照没有已登记的新增文件或来源；实际判断仍保存在两版原文中。</p>}</details><section className="dc-gaps" aria-label="仍需补充的资料"><header><h4>下一版优先补什么</h4><span>{remaining.length} 项</span></header>{remaining.slice(0, 2).map((row, index) => <article key={`${row.topic}:${index}`}><strong>{row.topic || '本方向待核事项'}</strong><p>{row.request}</p></article>)}{remaining.length > 2 && <details><summary>展开其余 {remaining.length - 2} 项</summary>{remaining.slice(2).map((row, index) => <article key={index}><strong>{row.topic}</strong><p>{row.request}</p></article>)}</details>}{!remaining.length && <p>本版未登记新的补资料条目；完整实施条件保留在方案中。</p>}<button className="dc-text-button" onClick={onSupplement}>按缺项补充资料 →</button></section></div>
    <details className="dc-version-identity"><summary>查看对照轮次与资料版本</summary>{[before, after].filter((snapshot): snapshot is Snapshot => !!snapshot).map(snapshot => <p key={snapshot.key}><strong>{snapshot.label}</strong> · {snapshot.round ? `轮次 ID：${snapshot.round.id}` : '尚未登记研判轮次'} · 资料 v{snapshot.packet.context_version} · 方案标识 {snapshot.packet.input_hash}</p>)}</details>
    {inspection && <aside className="dc-inspection" role="dialog" aria-modal="false" aria-label={`${inspection.label}的对照依据`}><header><div><span>版本原文与来源</span><h4>{inspection.label}</h4></div><button aria-label="关闭对照依据" onClick={() => setInspection(null)}>×</button></header>{[{ snapshot: before, cell: inspection.before }, { snapshot: after, cell: inspection.after }].map(({ snapshot, cell }, index) => snapshot && cell ? <section key={index}><h5>{snapshot.label} · 资料 v{snapshot.packet.context_version}</h5>{cell.text.map((text, index) => <p key={index}>{text}</p>)}{knownRefs(cell.packet, cell.refs).map(id => { const source = cell.packet.sources.find(source => source.id === id)!; return <details key={id}><summary>{source.title}</summary><p>{source.role === 'current' ? '本对象资料' : '独立对标参考'} · {source.visibility === 'internal' ? '项目内部' : source.visibility === 'public' ? '公开来源' : '访问范围未登记'} · {source.published_at?.slice(0, 10) || '来源日期未登记'} · {source.locator}</p><blockquote>{source.text}</blockquote><button className="dc-text-button" onClick={() => onEvidence([id], cell.packet)}>在资料页定位</button></details> })}{!knownRefs(cell.packet, cell.refs).length && <p className="dc-pending">本项未登记可读原文引用。</p>}</section> : null)}</aside>}
  </section>
}
