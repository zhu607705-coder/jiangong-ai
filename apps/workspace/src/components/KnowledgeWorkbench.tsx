import { useEffect, useId, useRef, useState } from 'react'
import type { ExperienceDraft, ExperienceKnowledge, KnowledgeCondition, KnowledgeConditionMatch, KnowledgeMatch, KnowledgeQuery, KnowledgeTrace, ProjectInput, Source } from '../../../host/generated/contracts'
import { validate } from '../../../../packages/contracts/validate'
import { api } from '../api'
import './knowledge-workbench.css'

type Props = { projectId: string; revision: number; asOf: string; currentProject?: ProjectInput; onRun?: (query: KnowledgeQuery) => void }
type MatchResult = { trace: KnowledgeTrace; sources: Source[] }
type Document = { id: string; file_name: string; sha256?: string; parser_result?: { source_hash?: string } }
const kindLabels = { case: '案例', rule: '规则与心法' }
const originLabels = { project_case: '项目案例', official_policy: '正式政策', research_paper: '研究论文', practice: '实践经验' }
const transferLabels = { transferable: '满足迁移条件', conditional: '待补充迁移条件', not_transferable: '当前不可迁移' }
const conditionLabels = { matched: '命中', unmatched: '未命中', unknown: '未知', conflict: '冲突' }
const operatorLabels = { eq: '=', ne: '≠', gt: '>', gte: '≥', lt: '<', lte: '≤', contains: '包含' }
const levelLabels: Record<ExperienceKnowledge['evidence_level'], string> = {
  proposal_only: '仅有提议', implementation_record: '实施记录', observational_study: '观察研究', controlled_study: '对照研究',
  official_policy: '正式政策', expert_practice: '专家实践', not_reported: '尚未记载',
}
const blankKnowledge = (): ExperienceKnowledge => ({ kind: 'case', origin: 'project_case', measure_key: '', measure_name: '', conditions: [], exclusions: [], transfer_notes: [], evidence_level: 'not_reported' })
const template = (): ExperienceDraft => ({ title: '', project_type: '', development_mode: '', stage: '',
  fields: (['decision_question', 'background', 'key_conditions', 'alternatives', 'proposal', 'actual_decision', 'decision_basis', 'implementation', 'outcome', 'applicability'] as const).map(key => ({ key, value: null, evidence: [] })),
  knowledge: blankKnowledge(),
})
const exampleCondition = [{ fact_kind: 'resident_consultation_status', label: '居民协商状态', operator: 'eq', value: '已完成', unit: null,
  evidence: [{ document_id: '替换为已导入材料ID', version: '替换为原文sha256', locator: '替换为原文定位', quote: '替换为原文中的连续片段' }] }]
const message = (error: unknown) => error instanceof Error ? error.message : '请求未完成，请重试。'
const safeUrl = (url?: string): string | undefined => { try { const parsed = new URL(url || ''); return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : undefined } catch { return undefined } }

function download(value: unknown, filename: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url; anchor.download = filename; anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function TextList({ title, values }: { title: string; values: string[] }) {
  return <div className="knowledge-comparison-item"><h5>{title}</h5>{values.length ? <ul>{values.map((value, index) => <li key={index}>{value}</li>)}</ul> : <p>尚未记录</p>}</div>
}

function Conditions({ items, exclusion = false }: { items: KnowledgeConditionMatch[]; exclusion?: boolean }) {
  return <div className="knowledge-condition-list">{items.length ? items.map((item, index) => <div className={`knowledge-condition is-${item.state}`} key={index}>
    <div><span className="knowledge-state">{exclusion && item.state === 'matched' ? '触发排除' : conditionLabels[item.state]}</span><strong>{item.condition.label}</strong></div>
    <p>{item.reason}</p><small>{item.condition.fact_kind} {operatorLabels[item.condition.operator]} {String(item.condition.value)} {item.condition.unit || ''}</small>
    {!!item.fact_refs.length && <small>当前事实：{item.fact_refs.join('、')}</small>}
    {!!item.condition.evidence.length && <details><summary>条件原文依据 · {item.condition.evidence.length}</summary>{item.condition.evidence.map((evidence, evidenceIndex) => <div className="knowledge-quote" key={evidenceIndex}>
      <small>材料 {evidence.document_id} · {evidence.locator} · 版本 {evidence.version}</small><blockquote>{evidence.quote}</blockquote>
    </div>)}</details>}
  </div>) : <p className="knowledge-muted">{exclusion ? '未记录排除条件。' : '未记录结构化适用条件，需补齐后再判断能否直接复用。'}</p>}</div>
}

function MatchCard({ match, sources, hit }: { match: KnowledgeMatch; sources: Source[]; hit: boolean }) {
  const cited = sources.filter(source => match.evidence_refs.includes(source.id))
  const missing = match.evidence_refs.filter(id => !cited.some(source => source.id === id))
  const similarity = Number.isFinite(match.similarity) ? `${Math.round(Math.max(0, Math.min(1, match.similarity)) * 100)}%` : '未提供'
  return <article className={`knowledge-card ${hit ? 'is-hit' : 'is-candidate'}`} aria-label={`${kindLabels[match.kind]}：${match.title}`}>
    <header><div><small>{originLabels[match.origin]} · 来源项目 {match.source_project_id} · v{match.card_revision}</small><h4>{match.title}</h4>
      <p>{match.measure_name} <span className="knowledge-muted">· {match.measure_key}</span></p></div><span className={`knowledge-badge is-${match.transferability}`}>{transferLabels[match.transferability]}</span></header>
    <div className="knowledge-metrics"><span>{hit ? `${kindLabels[match.kind]}适用` : '候选待核'}</span><span>相关性：{match.related ? '与本次举措相关' : '相关性不足'}</span><span>词法相似率 {similarity}</span></div>
    <p className="knowledge-muted knowledge-similarity-note">词法相似率表示文字重合程度，条件与排除项决定是否适用。</p>
    {match.recommendation && <p className="knowledge-recommendation">{match.recommendation}</p>}
    <details className="knowledge-details"><summary>查看适用条件与排除条件</summary><h5>适用条件</h5><Conditions items={match.conditions} /><h5>排除条件</h5><Conditions items={match.exclusions} exclusion /></details>
    <div className="knowledge-comparison"><TextList title="已知相似条件" values={match.similar_conditions} /><TextList title="重要差异" values={match.important_differences} /><TextList title="迁移前提" values={match.reuse_premises} /><TextList title="仍需核实" values={match.unknowns} /></div>
    <details className="knowledge-details"><summary>查看来源与原文引用 · {cited.length}</summary>{cited.map(source => <div className="knowledge-quote" key={source.id}>
      <strong>{source.title}</strong><small>{source.id} · {source.locator || '定位待补充'}{source.hash ? ` · 版本 ${source.hash}` : ''}{source.synthetic ? ' · 合成测试材料' : ''}</small>
      {source.untrusted_text ? <blockquote>{source.untrusted_text}</blockquote> : <p className="knowledge-muted">当前响应未包含原文正文。</p>}
      {safeUrl(source.url) && <a href={safeUrl(source.url)} target="_blank" rel="noopener noreferrer">打开原始来源</a>}
    </div>)}{!!missing.length && <p className="knowledge-muted">待补齐来源：{missing.join('、')}</p>}{!match.evidence_refs.length && <p className="knowledge-muted">尚未提供来源引用。</p>}</details>
  </article>
}

export default function KnowledgeWorkbench({ projectId, revision, asOf, currentProject, onRun }: Props) {
  const scope = `${projectId}:${revision}:${asOf}`
  const activeScope = useRef(scope); activeScope.current = scope
  const request = useRef<{ token: number; controller?: AbortController }>({ token: 0 })
  const [query, setQuery] = useState<KnowledgeQuery>({ measure_key: '', question: '' })
  const [result, setResult] = useState<{ scope: string; value: MatchResult } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    request.current.controller?.abort(); request.current.token += 1
    setResult(null); setBusy(false); setError(''); setQuery({ measure_key: '', question: '' })
    return () => { request.current.controller?.abort(); request.current.token += 1 }
  }, [scope])
  const editQuery = (patch: Partial<KnowledgeQuery>) => {
    request.current.controller?.abort(); request.current.token += 1
    setQuery(current => ({ ...current, ...patch })); setResult(null); setError(''); setBusy(false)
  }
  const match = async () => {
    if (!query.measure_key.trim() || !query.question.trim() || busy) return
    const token = ++request.current.token, controller = new AbortController()
    request.current.controller?.abort(); request.current.controller = controller
    setBusy(true); setError(''); setResult(null)
    try {
      const value = await api<MatchResult>(`/projects/${encodeURIComponent(projectId)}/experiences/knowledge-match`, { query: { measure_key: query.measure_key.trim(), question: query.question.trim() } }, controller.signal)
      if (activeScope.current === scope && request.current.token === token && !controller.signal.aborted) setResult({ scope, value })
    } catch (cause) {
      if (activeScope.current === scope && request.current.token === token && !controller.signal.aborted) setError(message(cause))
    } finally {
      if (activeScope.current === scope && request.current.token === token) setBusy(false)
    }
  }
  const current = result?.scope === scope ? result.value : null
  const trace = current?.trace
  const hits = [...(trace?.case_hits || []), ...(trace?.rule_hits || [])]
  const hitIds = new Set(hits.map(hit => hit.card_id))
  const candidates = trace?.candidates.filter(candidate => !hitIds.has(candidate.card_id)) || []
  const groups = new Map<string, { name: string; items: { match: KnowledgeMatch; hit: boolean }[] }>()
  for (const item of [...hits.map(match => ({ match, hit: true })), ...candidates.map(match => ({ match, hit: false }))]) {
    const group = groups.get(item.match.measure_key) || { name: item.match.measure_name, items: [] }
    group.items.push(item); groups.set(item.match.measure_key, group)
  }
  const routeLabel = trace?.route === 'combined_hit' ? '案例与规则均适用' : trace?.route === 'case_hit' ? '案例适用' : trace?.route === 'rule_hit' ? '规则适用' : '两库均未命中'
  return <section className="knowledge-workbench" aria-label="案例与规则匹配">
    <header className="knowledge-heading"><div><small>CASE & RULE KNOWLEDGE</small><h3>从案例与规则找到适用举措</h3><p>按具体举措检查已有案例、论文规则与适用边界，保留当前条件、差异和迁移前提。</p></div><button type="button" onClick={() => download(template(), 'case-extraction-template.json')}>下载案例提取模板</button></header>
    <div className="knowledge-flow" aria-label="案例沉淀与复用流程"><span>材料与论文</span><span>按举措提取草稿</span><span>原文复核后入库</span><span>条件匹配</span><span>命中 → Agent 研判</span><span>两库未命中 → Agent 保底</span></div>
    <form className="knowledge-query" onSubmit={event => { event.preventDefault(); void match() }}>
      <label>举措标识<input value={query.measure_key} required pattern="[A-Za-z0-9_.-]+" maxLength={80} disabled={busy} onChange={event => editQuery({ measure_key: event.target.value })} placeholder="如 pipe_network 或 elevator" /></label>
      <label>本次决策问题<textarea value={query.question} required maxLength={1000} disabled={busy} onChange={event => editQuery({ question: event.target.value })} placeholder="描述拟采取的举措，以及当前需要判断的问题" /></label>
      <button type="submit" className="knowledge-primary" disabled={busy || !query.measure_key.trim() || !query.question.trim()}>{busy ? '正在匹配条件…' : '匹配案例与规则'}</button>
    </form><p className="knowledge-muted">匹配使用当前项目 v{revision}，资料截至 {asOf}。点击匹配仅检查资料库条件。</p>
    {currentProject?.synthetic && <p className="knowledge-muted">当前为合成测试项目，匹配结果仅用于流程验证。</p>}
    {error && <p className="knowledge-error" role="alert">{error}</p>}
    {trace && current && <div className="knowledge-results"><div className={`knowledge-route is-${trace.route}`} role="status"><strong>{routeLabel}</strong><span>案例命中 {trace.case_hits.length} · 规则命中 {trace.rule_hits.length}</span>
      {trace.route === 'agent_fallback' && <p>{trace.fallback_status === 'executed' ? '本次问题已完成 Agent 保底研判，结合待核条件查看建议。' : trace.fallback_status === 'blocked_external' ? 'Agent 保底当前受外部条件阻塞，先补齐资料或配置后再研判。' : trace.fallback_status === 'offline_only' ? '当前仅有本地保底建议，关键资料缺项仍需核实。' : '两类资料都未满足直接适用条件。可先补齐待核项，再基于本次问题启动 Agent 保底研判。'}</p>}
      {!!trace.reasons.length && <ul>{trace.reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul>}
    </div><div className="knowledge-result-actions"><small>规则版本 {trace.policy_version} · 研判时点 {trace.evaluated_as_of}</small><button type="button" onClick={() => download(current, 'knowledge-match.json')}>下载本次匹配 JSON</button>{onRun && <button type="button" className="knowledge-primary" onClick={() => onRun({ ...trace.query })}>基于本次问题研判</button>}</div>
      {Array.from(groups, ([key, group]) => <section className="knowledge-measure" key={key} aria-label={`举措：${group.name}`}><h4>{group.name}<small>{key}</small></h4>{group.items.map(item => <MatchCard key={`${item.match.card_id}:${item.match.kind}`} match={item.match} sources={current.sources} hit={item.hit} />)}</section>)}
      {!groups.size && <p className="knowledge-muted">当前没有可展示的已审核候选；可整理项目材料或论文规则后再匹配。</p>}
      <p className="knowledge-muted">条件缺项与冲突保留为待核事项，匹配与生成的建议须结合原文和专业复核。</p>
    </div>}
    <details className="knowledge-template"><summary>查看案例提取格式</summary><p>一张卡只沉淀一项举措。十个字段分别保留问题、背景、条件、方案、提议、实际决策、依据、实施、结果与适用边界；原文没有的内容保留为空。</p><p>结构化条件使用 fact_kind / operator / value / unit，附材料 ID（document_id）、版本（version）、定位（locator）与逐字引文（quote）。以下是格式示例，须用实际原文替换占位内容。</p><pre>{JSON.stringify(exampleCondition, null, 2)}</pre><p>下载模板中的内容为空；填写完成并复核原文后才能进入适用匹配。</p></details>
  </section>
}

type EditorProps = { draft: ExperienceDraft; onChange: (updater: (draft: ExperienceDraft) => ExperienceDraft) => void; busy: boolean; documents?: Document[] }
type ConditionKey = 'conditions' | 'exclusions'
function ConditionEditor({ label, value, limit, busy, onChange }: { label: string; value: KnowledgeCondition[]; limit: number; busy: boolean; onChange: (value: KnowledgeCondition[]) => void }) {
  const id = useId(), field = useRef<HTMLTextAreaElement>(null), published = useRef(JSON.stringify(value))
  const [text, setText] = useState(() => JSON.stringify(value, null, 2)), [error, setError] = useState('')
  const serialized = JSON.stringify(value)
  useEffect(() => {
    if (serialized !== published.current) { published.current = serialized; setText(JSON.stringify(value, null, 2)); setError(''); field.current?.setCustomValidity('') }
  }, [serialized, value])
  const edit = (next: string) => {
    setText(next)
    try {
      const parsed: unknown = JSON.parse(next)
      if (!Array.isArray(parsed)) throw new Error('请使用 JSON 数组；无条件时填写 []。')
      if (parsed.length > limit) throw new Error(`最多 ${limit} 条。`)
      const items = parsed.map((item, index) => {
        try { return validate<KnowledgeCondition>('KnowledgeCondition', item) }
        catch { throw new Error(`第 ${index + 1} 条格式不完整。请核对 fact_kind、label、operator、value、unit 与 1–5 条完整原文引用。`) }
      })
      published.current = JSON.stringify(items); setError(''); field.current?.setCustomValidity(''); onChange(items)
    } catch (cause) {
      const detail = cause instanceof SyntaxError ? 'JSON 尚未完整或格式有误。' : message(cause)
      const note = `${detail} 修正前无法保存草稿。`
      setError(note); field.current?.setCustomValidity(note)
    }
  }
  return <label className="knowledge-json-editor">{label}<textarea ref={field} aria-label={label} aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined} value={text} disabled={busy} spellCheck={false} onChange={event => edit(event.target.value)} />{error && <span id={`${id}-error`} className="knowledge-error" role="alert">{error}</span>}</label>
}

export function KnowledgeProfileEditor({ draft, onChange, busy, documents = [] }: EditorProps) {
  const knowledge = draft.knowledge
  const transferField = useRef<HTMLTextAreaElement>(null)
  const notesError = knowledge && (knowledge.transfer_notes.length > 10 ? '迁移说明最多十项，请合并后保存。' : knowledge.transfer_notes.some(note => note.length > 1000) ? '每项迁移说明最多 1000 字，请缩短后保存。' : '')
  useEffect(() => { transferField.current?.setCustomValidity(notesError || '') }, [notesError])
  const patch = (update: Partial<ExperienceKnowledge>) => onChange(current => current.knowledge ? { ...current, knowledge: { ...current.knowledge, ...update } } : current)
  const changeConditions = (key: ConditionKey, values: KnowledgeCondition[]) => patch({ [key]: values })
  return <fieldset className="knowledge-profile-editor" disabled={busy}><legend>举措与复用条件</legend>
    <label className="knowledge-enable"><input type="checkbox" checked={!!knowledge} onChange={event => { const enabled = event.target.checked; onChange(current => { if (enabled) return { ...current, knowledge: blankKnowledge() }; const { knowledge: _knowledge, ...plain } = current; return plain }) }} />按举措沉淀为案例或规则</label>
    {!knowledge && <p className="knowledge-muted">开启后填写举措与适用条件，旧经验继续保留十字段格式。</p>}
    {knowledge && <><p className="knowledge-muted">每张卡对应一项举措；论文规则与项目实施结果分别保留出处，未知项留空待核。</p><div className="knowledge-profile-grid">
      <label>沉淀类型<select aria-label="沉淀类型" value={knowledge.kind} onChange={event => patch({ kind: event.target.value as ExperienceKnowledge['kind'] })}>{Object.entries(kindLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label>内容来源<select aria-label="内容来源" value={knowledge.origin} onChange={event => patch({ origin: event.target.value as ExperienceKnowledge['origin'] })}>{Object.entries(originLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label>举措标识<input aria-label="知识举措标识" value={knowledge.measure_key} required pattern="[A-Za-z0-9_.-]+" maxLength={80} onChange={event => patch({ measure_key: event.target.value })} placeholder="如 pipe_network 或 elevator" /></label>
      <label>举措名称<input aria-label="举措名称" value={knowledge.measure_name} required maxLength={120} onChange={event => patch({ measure_name: event.target.value })} placeholder="如管网改造" /></label>
      <label>证据类型<select aria-label="证据类型" value={knowledge.evidence_level} onChange={event => patch({ evidence_level: event.target.value as ExperienceKnowledge['evidence_level'] })}>{Object.entries(levelLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
    </div><label>迁移说明（每行一项）<textarea ref={transferField} aria-label="迁移说明" aria-invalid={!!notesError} value={knowledge.transfer_notes.join('\n')} onChange={event => patch({ transfer_notes: event.target.value ? event.target.value.split('\n') : [] })} /></label>
    {notesError && <p className="knowledge-error" role="alert">{notesError}</p>}
    <div className="knowledge-profile-conditions"><ConditionEditor label="结构化适用条件 JSON" value={knowledge.conditions} limit={30} busy={busy} onChange={values => changeConditions('conditions', values)} /><ConditionEditor label="排除条件 JSON" value={knowledge.exclusions} limit={20} busy={busy} onChange={values => changeConditions('exclusions', values)} /></div>
    <details className="knowledge-template"><summary>条件格式与原文引用示例</summary><p>格式示例；所有占位信息须替换成已导入材料的真实原文。value 的类型须与当前事实一致，数值比较须核对 unit；每项需要 1–5 条引用。</p><pre>{JSON.stringify(exampleCondition, null, 2)}</pre><p>支持 eq、ne、gt、gte、lt、lte、contains。没有排除项时使用 []；缺少已核实适用条件的卡只能提供调查线索。</p>{!!documents.length && <ul>{documents.map(document => <li key={document.id}>{document.file_name} · ID {document.id} · 版本 {document.parser_result?.source_hash || document.sha256 || '待解析'}</li>)}</ul>}</details>
    </>}
  </fieldset>
}
