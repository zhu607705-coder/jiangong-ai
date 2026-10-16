import StrategyContentNotice from './StrategyContentNotice'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { StrategyPacket } from '../../../../packages/retrofit/strategy'
import type { ResearchMaterial, ResearchRound } from '../../../../packages/retrofit/research-rounds'
import InternalMaterialIntake, { MATERIAL_CATEGORIES, type MaterialUploadMetadata } from './InternalMaterialIntake'
import { MODE_LABELS } from '../../../../packages/retrofit/renewal-mode'
import './research-rounds.css'

export type RoundSubmission = { parent_round_id?: string; material_intake: 'none' | 'provided'; document_ids: string[]; allow_internal_ai: boolean }
const statusLabels = { draft: '待开始', running: '研判中', completed: '已完成', failed: '本轮未完成', obsolete: '资料版本已变化' }
const materialLabel = (value: ResearchMaterial['material_category']) => MATERIAL_CATEGORIES.find(([key]) => key === value)?.[1] || '其他项目资料'
const readable = (material: ResearchMaterial) => material.parse_status === 'extracted'
const dateLabel = (value: string) => new Date(value).toLocaleString('zh-CN')

function RoundArchive({ result }: { result: StrategyPacket }) {
  const strategy = result.strategy
  if (!strategy) return null
  return <div className="research-round-details"><p>{strategy.summary}</p>
    {strategy.decision_brief && <><h5>投入判断</h5><p>{strategy.decision_brief.investment.conclusion}</p><p>{strategy.decision_brief.investment.reason}</p><h5>财务与社会效果</h5><p>{strategy.decision_brief.returns.financial}</p><p>{strategy.decision_brief.returns.social}</p></>}
    {strategy.paths.map(path => <details key={path.mode}><summary>{MODE_LABELS[path.mode]} · {path.title}</summary><p>{path.description}</p>{path.actions.map(action => <div key={action.title}><h5>{action.title}</h5><p>{action.detail}</p></div>)}<ul>{path.requirements.map(text => <li key={text}>{text}</li>)}</ul></details>)}
    <details><summary>当轮六维现况与两方向目标</summary>{strategy.dimensions.map(row => <article key={row.key}><h5>{({ demand: '居民需求', supply: '公共服务', adaptation: '居住工程', implementation: '实施协同', operations: '长效维护', resources: '资金交付' })[row.key]}</h5><p>现况：{row.current}</p><p>综合整治：{row.comprehensive}</p><p>原拆原建：{row.rebuild}</p></article>)}</details>
    <details><summary>当轮引用原文与出处 · {result.sources.length} 份资料</summary>{strategy.rationale.map((row, index) => <article key={`${row.source_id}:${index}`}><p>{row.point}</p><blockquote>{row.quote}</blockquote><p>{result.sources.find(source => source.id === row.source_id)?.title || row.source_id}</p></article>)}</details>
  </div>
}

export default function ResearchRoundsPanel({ projectName, revision, rounds, materials = [], candidate = null, busy = false, loading = false, error = '', onAdopt, onStart, onUpload, onReadCurrent, onEvidence, sourceCounts = { public: 0, internal: 0 }, children, onReload, synthetic = false, historyOnly = false, intakeOnly = false }: {
  projectName: string; revision: number; rounds: ResearchRound[]; materials?: ResearchMaterial[]; candidate?: StrategyPacket | null;
  busy?: boolean; loading?: boolean; error?: string;
  onAdopt?: (packet: StrategyPacket) => Promise<void>; onStart?: (input: RoundSubmission) => Promise<void>;
  onUpload?: (file: File, metadata: MaterialUploadMetadata) => Promise<void>; onReadCurrent?: () => void;
  onEvidence: (refs: string[]) => void; sourceCounts?: { public: number; internal: number; synthetic?: number }; children?: ReactNode; onReload?: () => void; synthetic?: boolean; historyOnly?: boolean; intakeOnly?: boolean;
}) {
  const [uploadOpen, setUploadOpen] = useState(false), [consent, setConsent] = useState(false)
  const ordered = [...rounds].sort((a, b) => a.round_number - b.round_number)
  const completed = ordered.filter(round => round.status === 'completed' && round.result?.strategy)
  const baseline = completed.at(-1), first = completed[0]
  const baselineVersions = new Set(baseline?.materials.map(material => `${material.document_id}:${material.version}`) || [])
  const additional = materials.filter(material => !baselineVersions.has(`${material.document_id}:${material.version}`))
  const materialKey = materials.map(material => `${material.document_id}:${material.version}`).sort().join('|')
  const [selection, setSelection] = useState<{ key: string; ids: string[] }>({ key: '', ids: [] })
  const inheritedIds = baseline?.materials.map(material => material.document_id) || []
  const selectedIds = [...new Set([...(selection.key === materialKey ? selection.ids : materials.filter(readable).map(material => material.document_id)), ...inheritedIds])]
  const selected = materials.filter(material => selectedIds.includes(material.document_id))
  const internalSelected = selected.some(material => material.visibility === 'internal') || !!baseline?.materials.some(material => material.visibility === 'internal')
  const nextNumber = Math.max(0, ...ordered.map(round => round.round_number)) + 1
  const latestReview = baseline?.result?.strategy?.round_review
  const missing = baseline?.missing_materials || []
  const requestedMaterials=baseline?.result?.content_review?missing.filter(item=>item.topic!=='后续资料补充'):missing
  const question = baseline ? `第 ${baseline.round_number} 轮之后，还可以补充哪些项目资料？` : '研判之前，有没有企业或项目内部资料？'
  const actionable = !busy && !loading && !error
  useEffect(() => { setConsent(false) }, [revision, baseline?.id])
  const categories = useMemo(() => MATERIAL_CATEGORIES.map(([, label]) => label).join('、'), [])
  async function prepareUpload() {
    if (!baseline && candidate) await onAdopt?.(candidate)
    setUploadOpen(true)
  }
  async function useExisting() {
    if (!baseline && candidate) await onAdopt?.(candidate)
    else if (!baseline) await onStart?.({ material_intake: 'none', document_ids: [], allow_internal_ai: false })
    onReadCurrent?.()
  }
  return <>
    {!historyOnly && <section className="research-intake" aria-label="内部资料补充与研判" data-context-version={revision}>
      <header><span>研判协作助手 · {projectName}</span><h3>{question}</h3></header>
      {synthetic && <p className="research-round-notice">合成演示 · 本项目文件、轮次与模型输出均为模拟情景，不写入真实项目。</p>}
      <p>{baseline ? `保留首轮基线，沿用第 ${baseline.round_number} 轮结果；新增文件后再形成独立的第 ${nextNumber} 轮。` : `公开资料可以支持第一轮判断；${categories}能帮助核实项目真实条件。`}</p>
      <div className="research-source-count"><span>现有公开资料 {sourceCounts.public} 份</span><span>本项目内部资料 {sourceCounts.internal} 份</span>{!!sourceCounts.synthetic && <span>合成资料 {sourceCounts.synthetic} 份</span>}<span>当前资料版本 v{revision}</span></div>
      {loading && <p role="status">正在读取已保存的研判轮次与项目文件…</p>}
      {error && <div className="research-round-notice" role="alert"><p>{error}</p><button disabled={busy || loading} onClick={onReload}>重新读取轮次</button></div>}
      {baseline?.result?.content_review&&<StrategyContentNotice packet={baseline.result} details/>}
      {!!requestedMaterials.length&&<section aria-label="待补充项目资料"><h4>本轮建议补充资料</h4><ul className="research-round-gap-list">{requestedMaterials.map((item,index)=><li key={`${item.topic}:${index}`}><strong>{item.topic}：{item.request}</strong><p>{item.reason}</p></li>)}</ul></section>}
      <div className="research-intake-actions">
        <button disabled={!actionable} aria-pressed={uploadOpen} onClick={() => void prepareUpload()}>有，补充内部资料</button>
        <button disabled={!actionable} onClick={() => void useExisting()}>{baseline ? '暂不补充，查看已完成研判' : candidate ? '暂不补充，保留现有方案作为首轮' : '暂不补充，先用现有公开资料开展首轮研判'}</button>
      </div>
      {candidate && !baseline && <p>已找到本项目完成的方案，可直接采纳为首轮基线；不会重新调用模型。</p>}
      {uploadOpen && (onUpload ? <InternalMaterialIntake onUpload={onUpload} disabled={busy || loading} synthetic={synthetic}/> : <button disabled={busy} onClick={() => onEvidence([])}>前往“逻辑与证据”上传文件</button>)}
      {!!additional.length && <section aria-label="本轮可补充的文件"><h4>{baseline ? '本轮使用的项目文件' : '可纳入首轮的项目文件'}</h4>{baseline && <p>沿用上一轮文件 {inheritedIds.length} 份，补充新增文件 {additional.length} 份；下方完整清单用于本轮分析。</p>}<ul className="research-material-list">{materials.map(material => <li key={`${material.document_id}:${material.version}`}><label><input type="checkbox" aria-label={`纳入${material.file_name}`} checked={selectedIds.includes(material.document_id)} disabled={busy || !readable(material) || inheritedIds.includes(material.document_id)} onChange={event => setSelection({ key: materialKey, ids: event.target.checked ? [...selectedIds, material.document_id] : selectedIds.filter(id => id !== material.document_id) })}/><div><strong>{material.file_name}{baseline ? inheritedIds.includes(material.document_id) ? ' · 沿用上一轮' : ' · 本轮新增' : ''}</strong><span>{materialLabel(material.material_category)} · {material.data_class === 'internal' ? '项目内部' : material.data_class === 'synthetic' ? '模拟资料' : '公开资料'} · 形成日期：{material.source_date ? `${material.source_date}（用户登记）` : '未登记'}</span><span>{readable(material) ? '已解析原文' : material.parse_status === 'ocr_required' ? '扫描页待 OCR，取得可读文本后可纳入' : '尚无可用原文'} · {material.locator}</span></div></label></li>)}</ul>
        {internalSelected && <label className="research-internal-consent"><input type="checkbox" aria-label="同意本轮使用所选项目内部资料进行AI分析" checked={consent} disabled={busy} onChange={event => setConsent(event.target.checked)}/><span>同意将本项目所选内部资料用于本轮 AI 分析。资料继续标记为项目内部，按本次研判范围使用。</span></label>}
        <div className="research-round-actions"><button disabled={!actionable || !selected.length || internalSelected && !consent} onClick={() => void onStart?.({ ...(baseline ? { parent_round_id: baseline.id } : {}), material_intake: 'provided', document_ids: selectedIds, allow_internal_ai: internalSelected && consent })}>{baseline ? `基于首轮＋新增资料开展第 ${nextNumber} 轮研判` : '纳入所选资料，开展首轮研判'}</button></div>
      </section>}
      {baseline && !additional.length && <p>下一轮从补充文件开始。可依据下方缺项上传资料，再明确启动补充研判。</p>}
      <p>文件保留在本项目资料库，可回到“逻辑与证据”查看解析原文与来源定位。</p>
    </section>}
    {children}
    {!intakeOnly && !!ordered.length && <section className="research-rounds" aria-label="研判轮次与变化"><header><span>首轮基线 → 新增资料 → 补充研判</span><h3>每轮结论和变化都保留</h3></header>
      <div className="research-round-cards">{ordered.map(round => <article key={round.id} data-round-id={round.id} data-current={round.id === baseline?.id}><header><strong>第 {round.round_number} 轮{round.id === first?.id ? ' · 首轮基线' : ''}</strong><span>{statusLabels[round.status]}</span></header><h4>{round.result?.strategy?.headline || (round.status === 'failed' ? '本轮尚未形成完整结论' : '等待本轮研判结果')}</h4><p>{round.result?.strategy?.decision_brief?.renewal.conclusion || round.result?.strategy?.summary || '完成后将保留本轮判断与依据。'}</p><p className="research-round-date">资料 v{round.context_version} · {dateLabel(round.created_at)}{round.origin === 'adopted_history' ? ' · 采纳已保存方案' : ''}</p><details className="research-round-materials"><summary>本轮资料 · {round.materials.length} 份文件</summary><ul className="research-material-list">{round.materials.map(material => <li key={`${material.document_id}:${material.version}`}><strong>{material.file_name}{material.added_in_round ? ' · 本轮新增' : ''}</strong><span>{materialLabel(material.material_category)} · 资料日期 {material.source_date || '未登记'} · {material.visibility === 'internal' ? '项目内部' : '公开'}</span></li>)}</ul>{!round.materials.length && <p>本轮以已取得的公开来源研判，来源原文保存在报告中。</p>}</details>{round.result?.strategy && <details><summary>查看本轮完整原始报告与引用</summary><RoundArchive result={round.result}/></details>}{round.error && <p className="research-round-notice">本轮未完成，原有轮次仍保留，可补充资料后重新开展。</p>}</article>)}</div>
      {first && baseline && first.id !== baseline.id && <section className="research-round-changes" aria-label="相对首轮的判断变化"><h4>相对首轮，判断怎样变化</h4>{latestReview ? <><p>{latestReview.summary}</p>{latestReview.changes.map((change, index) => <article key={`${change.topic}:${index}`}><h5>{change.topic}</h5><dl><div><dt>此前</dt><dd>{change.before}</dd></div><div><dt>本轮</dt><dd>{change.after}</dd></div></dl><p>变化原因：{change.reason}</p>{!!change.evidence_refs.length && <button className="research-text-button" onClick={() => onEvidence(change.evidence_refs)}>查看新增判断依据</button>}</article>)}</> : <><p>以下并列保留两轮原文结论。</p><dl><div><dt>首轮</dt><dd>{first.result?.strategy?.headline}</dd></div><div><dt>最新一轮</dt><dd>{baseline.result?.strategy?.headline}</dd></div></dl></>}</section>}
      {historyOnly&&!!missing.length && <section aria-label="下一轮建议补充资料"><h4>下一轮建议补充什么</h4><ul className="research-round-gap-list">{missing.map((item, index) => <li key={`${item.topic}:${index}`}><strong>{item.topic}：{item.request}</strong><p>{item.reason}</p>{!!item.evidence_refs.length && <button className="research-text-button" onClick={() => onEvidence(item.evidence_refs)}>查看缺项对应依据</button>}</li>)}</ul>{!historyOnly && <button className="research-text-button" disabled={!actionable} onClick={() => setUploadOpen(true)}>按这些缺项补充内部资料 ↑</button>}</section>}
    </section>}
    {historyOnly && !ordered.length && <p className="research-round-notice">本项目尚无已保存研判轮次。可在研判总览采纳已有方案作为首轮，或使用现有资料开展首轮研判。</p>}
  </>
}
