import { useEffect, useRef, useState } from 'react'
import type { ActionChunk, DistilledSkill, ExperienceCard, ExperienceEvidence, FactorDefinition, FactorPolicy, KnowledgeCondition, KnowledgeGrouping, MeasureFactor } from '../../../host/generated/contracts'
import type { ParsedDocument } from '../../../../packages/experience/document-slices'
import { validate } from '../../../../packages/contracts/validate'
import { api } from '../api'
import './knowledge-pipeline-panel.css'

type Props = { projectId: string; revision: number; onChanged?: (type?: 'documents') => void | Promise<void> }
type Document = { id: string; file_name: string; parser_result?: ParsedDocument['parser_result'] }
type PublicSource = { id: string; title: string; url?: string; content_status?: string }
type Pipeline = { documents: Document[]; policies: FactorPolicy[]; skills: DistilledSkill[]; cards: ExperienceCard[]; public_sources?: PublicSource[] }
type PolicyEditor = { id: string; revision?: number; definitions: FactorDefinition[]; minCoverage: string; maxDistance: string; note: string }
type Page = 'sources' | 'policy' | 'groups' | 'skills'
const pages: { key: Page; label: string }[] = [{ key: 'sources', label: '原文与措施因素' }, { key: 'policy', label: '导师因素政策' }, { key: 'groups', label: '分组预览' }, { key: 'skills', label: '技能蒸馏' }]
const statusLabels = { draft: '草稿待复核', approved: '已审核', rejected: '复核未通过' }
const roleLabels: Record<FactorDefinition['role'], string> = { mandatory: '必备因素', key: '关键因素', background: '背景因素', discarded: '不参与判断', pending: '待导师确认' }
const typeLabels: Record<FactorDefinition['value_type'], string> = { number: '数值', category: '类别', boolean: '是否', ordinal: '有序类别' }
const associationLabels: Record<MeasureFactor['association'], string> = { direct: '直接关联', shared: '多举措共享', unresolved: '归属待核', derived: '计算推导' }
const amountLabels: Record<MeasureFactor['amount_kind'], string> = { budget: '预算', contract: '合同额', paid: '已支付', committed: '承诺出资', maintenance: '运维费用', package_total: '整包总额', unknown: '金额口径待核', not_applicable: '非金额因素' }
const epistemicLabels: Record<MeasureFactor['epistemic_status'], string> = { fact: '原文事实', estimate: '估计值', scenario_assumption: '情景假设', missing: '缺失' }
const emptyPipeline = (): Pipeline => ({ documents: [], policies: [], skills: [], cards: [] })
const newEditor = (): PolicyEditor => ({ id: '', definitions: [], minCoverage: '', maxDistance: '', note: '' })
const asEditor = (policy: FactorPolicy): PolicyEditor => ({ id: policy.id, revision: policy.revision, definitions: structuredClone(policy.definitions), minCoverage: String(policy.min_coverage), maxDistance: String(policy.max_distance), note: policy.note })
const newDefinition = (): FactorDefinition => ({ key: '', label: '', value_type: 'number', role: 'pending', weight: 0, unit: null, scale: null, measure_keys: [], evidence: [] })
const message = (error: unknown) => error instanceof Error ? error.message : '请求未完成，请重试。'
const merge = <T extends { id: string }>(current: T[], next: T[]): T[] => [...next, ...current.filter(item => !next.some(update => update.id === item.id))]

function Evidence({ items, documents }: { items: ExperienceEvidence[]; documents: Document[] }) {
  return items.length ? <details className="pipeline-evidence"><summary>原文定位与引用 · {items.length}</summary>{items.map((item, index) => <div key={index}>
    <small>{documents.find(document => document.id === item.document_id)?.file_name || item.document_id} · {item.locator}</small>
    <blockquote>{item.quote}</blockquote><small>材料 {item.document_id} · 版本 {item.version}</small>
  </div>)}</details> : <small className="pipeline-muted">原文定位待补</small>
}

function Conditions({ title, items, documents }: { title: string; items: KnowledgeCondition[]; documents: Document[] }) {
  return <div><h5>{title}</h5>{items.length ? items.map((condition, index) => <div className="pipeline-condition" key={index}>
    <strong>{condition.label}</strong><p>{condition.fact_kind} · {condition.operator} · {String(condition.value)} {condition.unit || ''}</p>
    {condition.source_value && <p>原文取值：{condition.source_value}</p>}<Evidence items={condition.evidence} documents={documents} />
  </div>) : <p className="pipeline-muted">尚未记录</p>}</div>
}

function FactorTable({ card, documents }: { card: ExperienceCard; documents: Document[] }) {
  return <article className="pipeline-card" aria-label={`措施因素：${card.title}`}>
    <header><div><strong>{card.knowledge?.measure_name || card.title}</strong><small>{card.knowledge?.measure_key || '举措待归类'} · {card.stage || '阶段待核'} · {card.id} v{card.revision}</small></div><span className={`pipeline-badge is-${card.status}`}>{statusLabels[card.status]}</span></header>
    {card.knowledge?.factors?.length ? <table className="pipeline-factor-table"><caption>措施与因素记录</caption><thead><tr><th>因素</th><th>取值与单位</th><th>关联与口径</th><th>依据</th></tr></thead><tbody>{card.knowledge.factors.map((factor, index) => <tr key={`${factor.key}:${index}`}>
      <td data-label="因素"><strong>{factor.label}</strong><small>{factor.key}</small></td>
      <td data-label="取值与单位">{factor.value === null ? '缺失' : String(factor.value)} {factor.unit || ''}<small>{epistemicLabels[factor.epistemic_status]}</small></td>
      <td data-label="关联与口径">{associationLabels[factor.association]} · {amountLabels[factor.amount_kind]}<small>对象 {factor.object_ref || '未定位'} · {factor.stage || '阶段待核'}{factor.observed_at ? ` · ${factor.observed_at}` : ''}</small>{factor.derivation && <small>计算 {factor.derivation.formula}：{factor.derivation.numerator_key} / {factor.derivation.denominator_key}</small>}</td>
      <td data-label="依据"><Evidence items={factor.evidence} documents={documents} /></td>
    </tr>)}</tbody></table> : <p className="pipeline-muted">这张卡尚未记录结构化因素；原文无记载的内容留空。</p>}
  </article>
}

export default function KnowledgePipelinePanel({ projectId, revision, onChanged }: Props) {
  const scope = `${projectId}\u0000${revision}`
  const active = useRef({ scope, generation: 0 })
  if (active.current.scope !== scope) active.current = { scope, generation: active.current.generation + 1 }
  const [loaded, setLoaded] = useState<{ scope: string; data: Pipeline; loading: boolean; error: string }>({ scope: '', data: emptyPipeline(), loading: true, error: '' })
  const [page, setPage] = useState<Page>('sources')
  const [selectedDocuments, setSelectedDocuments] = useState<string[]>([])
  const [publicSourceId, setPublicSourceId] = useState('')
  const [useModel, setUseModel] = useState(false)
  const [chunks, setChunks] = useState<ActionChunk[]>([])
  const [warnings, setWarnings] = useState<string[]>([])
  const [editor, setEditor] = useState<PolicyEditor>(newEditor)
  const [definitionsJson, setDefinitionsJson] = useState<string | null>(null)
  const [policyReviewNote, setPolicyReviewNote] = useState('')
  const [groupPolicyId, setGroupPolicyId] = useState('')
  const [measureKey, setMeasureKey] = useState('')
  const [question, setQuestion] = useState('')
  const [groupResult, setGroupResult] = useState<{ grouping: KnowledgeGrouping; cards: ExperienceCard[] } | null>(null)
  const [selectedCards, setSelectedCards] = useState<string[]>([])
  const [skillNotes, setSkillNotes] = useState<Record<string, string>>({})
  const [exported, setExported] = useState<{ skillId: string; filename: string; markdown: string } | null>(null)
  const [busy, setBusy] = useState('')
  const pending = useRef<{ generation: number; name: string } | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const base = `/projects/${encodeURIComponent(projectId)}/knowledge`
  const ready = loaded.scope === scope && !loaded.loading && !loaded.error
  const data = loaded.scope === scope ? loaded.data : emptyPipeline()

  useEffect(() => {
    const controller = new AbortController(), generation = active.current.generation
    setLoaded({ scope, data: emptyPipeline(), loading: true, error: '' })
    setSelectedDocuments([]); setPublicSourceId(''); setUseModel(false); setChunks([]); setWarnings([]); setEditor(newEditor()); setDefinitionsJson(null); setPolicyReviewNote('')
    setGroupPolicyId(''); setMeasureKey(''); setQuestion(''); setGroupResult(null); setSelectedCards([]); setSkillNotes({}); setExported(null)
    pending.current = null; setBusy(''); setError(''); setNotice('')
    void api<Pipeline>(`${base}/pipeline`, undefined, controller.signal).then(result => {
      if (controller.signal.aborted || active.current.generation !== generation) return
      setLoaded({ scope, data: result, loading: false, error: '' })
      setChunks([...new Map(result.cards.flatMap(card => card.knowledge?.chunks || []).map(chunk => [chunk.id, chunk])).values()])
    }).catch(cause => {
      if (!controller.signal.aborted && active.current.generation === generation) setLoaded({ scope, data: emptyPipeline(), loading: false, error: message(cause) })
    })
    return () => { controller.abort(); active.current.generation += 1 }
  }, [scope, base])

  const update = (change: (value: Pipeline) => Pipeline) => setLoaded(current => current.scope === scope ? { ...current, data: change(current.data) } : current)
  useEffect(() => {
    // Card review stays in the existing experience editor. Read only that list
    // when entering distillation so a newly approved source is available here.
    if (!ready || page !== 'skills' || pending.current) return
    const controller = new AbortController(), generation = active.current.generation
    void api<{ cards: ExperienceCard[] }>(`/projects/${encodeURIComponent(projectId)}/experiences`, undefined, controller.signal).then(result => {
      if (controller.signal.aborted || active.current.generation !== generation || pending.current) return
      update(value => ({ ...value, cards: result.cards }))
      setSelectedCards(current => {
        const eligible = current.filter(id => result.cards.some(card => card.id === id && card.status === 'approved' && card.knowledge?.measure_key))
        const measure = result.cards.find(card => card.id === eligible[0])?.knowledge?.measure_key
        return eligible.filter(id => result.cards.find(card => card.id === id)?.knowledge?.measure_key === measure)
      })
    }).catch(cause => {
      if (!controller.signal.aborted && active.current.generation === generation && !pending.current) setError(`技能来源卡片暂不可刷新：${message(cause)}`)
    })
    return () => controller.abort()
  }, [scope, projectId, page, ready])
  const run = async (name: string, task: (isCurrent: () => boolean) => Promise<void>) => {
    if (!ready || pending.current) return
    const generation = active.current.generation
    const isCurrent = () => active.current.scope === scope && active.current.generation === generation
    pending.current = { generation, name }; setBusy(name); setError(''); setNotice('')
    try { await task(isCurrent) } catch (cause) { if (isCurrent()) setError(message(cause)) }
    finally { if (isCurrent()) { pending.current = null; setBusy('') } }
  }
  const selectPolicy = (id: string) => {
    const policy = data.policies.find(item => item.id === id)
    setEditor(policy ? asEditor(policy) : newEditor()); setDefinitionsJson(null); setPolicyReviewNote(''); setError('')
  }
  const checkedDefinitions = (): FactorDefinition[] => {
    let value: unknown
    try { value = definitionsJson === null ? editor.definitions : JSON.parse(definitionsJson) } catch { throw new Error('高级因素定义不是有效 JSON，请检查括号和引号。') }
    if (!Array.isArray(value) || !value.length || value.length > 100) throw new Error('请提供 1–100 项因素定义。')
    const definitions = value.map((definition, index) => {
      try { return validate<FactorDefinition>('FactorDefinition', definition) } catch (cause) { throw new Error(`第 ${index + 1} 项因素定义不符合格式要求：${message(cause)}`) }
    })
    if (definitions.some(definition => !definition.key.trim() || !definition.label.trim())) throw new Error('请填写每项因素的标识与名称。')
    if (new Set(definitions.map(definition => definition.key.trim())).size !== definitions.length) throw new Error('因素标识不能重复。')
    return definitions.map(definition => ({ ...definition, key: definition.key.trim(), label: definition.label.trim(), measure_keys: definition.measure_keys.map(key => key.trim()).filter(Boolean) }))
  }
  const savePolicy = () => void run('policy-save', async isCurrent => {
    const definitions = checkedDefinitions(), minCoverage = Number(editor.minCoverage), maxDistance = Number(editor.maxDistance)
    if (!editor.minCoverage.trim() || !editor.maxDistance.trim() || !Number.isFinite(minCoverage) || !Number.isFinite(maxDistance) || minCoverage < 0 || minCoverage > 1 || maxDistance < 0 || maxDistance > 1) throw new Error('请填写 0–1 之间的覆盖率下限与距离上限；保存值先作为未复核草稿参数。')
    const policy = await api<FactorPolicy>(`${base}/policies`, { policy: { definitions, min_coverage: minCoverage, max_distance: maxDistance, note: editor.note.trim() }, ...(editor.id ? { id: editor.id, expected_revision: editor.revision } : {}) })
    if (!isCurrent()) return
    update(value => ({ ...value, policies: merge(value.policies, [policy]) })); setEditor(asEditor(policy)); setDefinitionsJson(null); setPolicyReviewNote(''); setGroupResult(null)
    setNotice('因素政策已保存为草稿，参数与适用范围仍需导师复核。')
  })
  const reviewPolicy = (status: 'approved' | 'rejected') => void run('policy-review', async isCurrent => {
    const current = data.policies.find(item => item.id === editor.id)
    if (!current || current.status !== 'draft') throw new Error('请先保存待复核的因素政策。')
    if (definitionsJson !== null || JSON.stringify(editor) !== JSON.stringify(asEditor(current))) throw new Error('因素政策有未保存修改，请先保存草稿再复核。')
    if (!policyReviewNote.trim()) throw new Error('请填写导师复核备注，说明依据与适用边界。')
    const policy = await api<FactorPolicy>(`${base}/policies/${encodeURIComponent(current.id)}/review`, { expected_revision: current.revision, status, note: policyReviewNote.trim() })
    if (!isCurrent()) return
    update(value => ({ ...value, policies: merge(value.policies, [policy]) })); setEditor(asEditor(policy)); setDefinitionsJson(null); setPolicyReviewNote(''); setGroupResult(null)
    setNotice(status === 'approved' ? '已记录导师复核。政策审核状态不代表企业效果已验证。' : '已记录未通过原因，可修改后重新保存草稿。')
  })
  const selectedMeasure = data.cards.find(card => selectedCards.includes(card.id))?.knowledge?.measure_key
  const currentPolicy = data.policies.find(policy => policy.id === editor.id)
  const policyDirty = !!currentPolicy && (definitionsJson !== null || JSON.stringify(editor) !== JSON.stringify(asEditor(currentPolicy)))
  const selectedGroupPolicy = data.policies.find(policy => policy.id === groupPolicyId)
  const selectedPublicSource = data.public_sources?.find(source => source.id === publicSourceId)

  return <section className="knowledge-pipeline" aria-label="知识沉淀操作面板">
    <header className="pipeline-heading"><div><small>KNOWLEDGE PIPELINE</small><h3>从原文举措到可复核知识</h3><p>保留措施、条件、因素与材料版本，逐步形成政策和技能草稿。复核记录与分组预览不代表已完成业务效果验证。</p></div><span className="pipeline-badge">项目范围</span></header>
    <nav className="pipeline-tabs" aria-label="知识沉淀步骤">{pages.map(item => <button type="button" key={item.key} aria-pressed={page === item.key} onClick={() => { setPage(item.key); setError(''); setNotice('') }}>{item.label}</button>)}</nav>
    {(!ready && !loaded.error) && <p role="status" className="pipeline-muted">正在读取材料、政策与技能记录…</p>}
    {loaded.scope === scope && loaded.error && <p role="alert" className="pipeline-error">知识沉淀记录暂不可读：{loaded.error}</p>}
    {error && <p role="alert" className="pipeline-error">{error}</p>}{notice && <p role="status" className="pipeline-notice">{notice}</p>}
    {ready && page === 'sources' && <div className="pipeline-page" aria-label="原文与措施因素">
      <h4>1. 原件定位与举措片段</h4><p className="pipeline-muted">先查看原文切分，再提取措施与因素。默认本地整理；原文无记载的数值、原因和结果不补写。</p>
      <fieldset className="pipeline-public-import" disabled={!!busy} aria-label="已有公开来源原件导入"><legend>已有公开来源原件</legend>
        {data.public_sources?.length ? <><label>已有公开来源<select aria-label="已有公开来源" value={publicSourceId} onChange={event => setPublicSourceId(event.target.value)}><option value="">选择已取得正文的公开来源</option>{data.public_sources.map(source => <option key={source.id} value={source.id}>{source.title}</option>)}</select></label>
          {selectedPublicSource && <small>{selectedPublicSource.id}{selectedPublicSource.content_status ? ` · ${selectedPublicSource.content_status}` : ''}{selectedPublicSource.url ? ` · ${selectedPublicSource.url}` : ''}</small>}
          <button type="button" disabled={!selectedPublicSource} onClick={() => void run('public-document', async isCurrent => {
            const document = await api<Document & { source_id: string; reused: boolean }>(`${base}/public-document`, { source_id: publicSourceId })
            if (!isCurrent()) return
            update(value => ({ ...value, documents: merge(value.documents, [document]) })); setSelectedDocuments(current => [...new Set([...current, document.id])]); setPublicSourceId('')
            setNotice(document.reused ? '已复用公开来源原件并选中，可切分原文或提取草稿。' : '已导入公开来源原件并选中，可切分原文或提取草稿。')
            const refreshed = await Promise.allSettled([api<Pipeline>(`${base}/pipeline`), Promise.resolve().then(() => onChanged?.('documents'))])
            if (!isCurrent()) return
            if (refreshed[0].status === 'fulfilled') {
              const pipeline = refreshed[0].value
              update(() => ({ ...pipeline, documents: merge(pipeline.documents, [document]) }))
            }
            const failures = refreshed.flatMap((result, index) => result.status === 'rejected' ? [`${index === 0 ? '知识面板' : '经验库文档列表'}刷新失败：${message(result.reason)}`] : [])
            if (failures.length) setError(`原件已保存。${failures.join('；')}`)
          })}>{busy === 'public-document' ? '正在导入…' : '从已有公开来源导入原件'}</button>
          <p className="pipeline-muted">将项目中已有的公开正文保存为可引用原件。普通上传材料仍按内部文档权限处理。</p>
        </> : <p className="pipeline-muted">当前项目暂无可导入的公开来源正文。</p>}
      </fieldset>
      <fieldset disabled={!!busy}><legend>选择提取材料</legend><div className="pipeline-documents">{data.documents.map(document => <div key={document.id}>
        <label className="pipeline-checkbox"><input type="checkbox" checked={selectedDocuments.includes(document.id)} onChange={event => setSelectedDocuments(current => event.target.checked ? [...current, document.id] : current.filter(id => id !== document.id))} /><span>{document.file_name}<small>{document.parser_result?.status === 'ocr_required' ? '待 OCR' : '已保存原件'} · {document.id}</small></span></label>
        <button type="button" aria-label={`切分原文：${document.file_name}`} disabled={document.parser_result?.status === 'ocr_required'} onClick={() => void run(`chunks:${document.id}`, async isCurrent => {
          const result = await api<{ chunks: ActionChunk[]; warnings: string[] }>(`${base}/chunks`, { document_id: document.id })
          if (!isCurrent()) return
          setChunks(current => [...result.chunks, ...current.filter(chunk => chunk.document_id !== document.id)]); setWarnings(result.warnings || [])
          setNotice(`已读取 ${result.chunks.length} 个举措或上下文片段，请核对原文定位。`)
        })}>{busy === `chunks:${document.id}` ? '正在切分…' : '切分原文'}</button>
      </div>)}</div>{!data.documents.length && <p className="pipeline-muted">请先在项目资料中上传历史材料。</p>}</fieldset>
      <label className="pipeline-checkbox pipeline-model"><input type="checkbox" aria-label="允许本次使用模型提取措施与因素" checked={useModel} disabled={!!busy} onChange={event => setUseModel(event.target.checked)} /><span>本次使用模型提取措施与因素<small>需有原文调用许可；勾选后仍须明确点击提取，候选仍需人工复核。</small></span></label>
      <button type="button" className="pipeline-primary" disabled={!!busy || !selectedDocuments.length} onClick={() => void run('extract', async isCurrent => {
        const result = await api<{ cards: ExperienceCard[]; warnings: string[]; model_calls: number }>(`${base}/extract`, { document_ids: selectedDocuments, use_model: useModel })
        if (!isCurrent()) return
        update(value => ({ ...value, cards: merge(value.cards, result.cards) })); setSelectedDocuments([]); setWarnings(result.warnings || []); setGroupResult(null)
        setChunks(current => merge(current, result.cards.flatMap(card => card.knowledge?.chunks || [])))
        setNotice(`已生成 ${result.cards.length} 张措施经验草稿；本次模型调用 ${result.model_calls} 次。请在下方项目经验卡中复核。`)
        try { await onChanged?.() } catch (cause) { if (isCurrent()) setError(`草稿已保存，但经验卡列表刷新失败：${message(cause)}`) }
      })}>{busy === 'extract' ? '正在提取…' : '提取措施与因素草稿'}</button>
      {!!warnings.length && <ul className="pipeline-warnings">{warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
      <div className="pipeline-chunks">{chunks.map(chunk => <article className="pipeline-card" key={chunk.id} aria-label={`原文片段：${chunk.id}`}>
        <header><div><strong>{chunk.kind === 'action' ? '举措原文' : '上下文原文'} · {chunk.measure_key || '举措待归类'}</strong><small>{chunk.id} · {chunk.classification === 'local' ? '本地切分' : '模型分类'} · {chunk.stage || '阶段待核'} · 对象 {chunk.object_ref || '未定位'}</small></div></header>
        <blockquote>{chunk.text}</blockquote><small>材料 {chunk.document_id} · 版本 {chunk.document_version}</small>
        {!!chunk.context_chunk_ids.length && <p className="pipeline-muted">关联上下文：{chunk.context_chunk_ids.join('、')}</p>}<Evidence items={chunk.spans} documents={data.documents} />
      </article>)}</div>
      <h4>2. 措施与因素表</h4><p className="pipeline-muted">直接关联、共享金额与待核归属分别保留；草稿因素不会自动成为已批准的判断门槛。</p>
      {data.cards.map(card => <FactorTable key={card.id} card={card} documents={data.documents} />)}{!data.cards.length && <p className="pipeline-muted">尚无措施经验卡。</p>}
    </div>}
    {ready && page === 'policy' && <div className="pipeline-page" aria-label="导师因素政策">
      <h4>导师复核因素与适用范围</h4><p className="pipeline-muted">因素角色、权重、单位、尺度与分组参数先保存为草稿；专业依据和原文条件可在高级 JSON 中完整编辑。</p>
      <label>选择因素政策<select value={editor.id} disabled={!!busy} onChange={event => selectPolicy(event.target.value)}><option value="">新建因素政策</option>{data.policies.map(policy => <option key={policy.id} value={policy.id}>{policy.id} · v{policy.revision} · {statusLabels[policy.status]}</option>)}</select></label>
      {currentPolicy && <p className="pipeline-policy-state"><span className={`pipeline-badge is-${policyDirty ? 'draft' : currentPolicy.status}`}>{policyDirty ? '表单有未保存修改' : statusLabels[currentPolicy.status]} · 保存版本 v{currentPolicy.revision}</span>{!policyDirty && currentPolicy.reviewed_by && <small>复核人 {currentPolicy.reviewed_by} · {currentPolicy.reviewed_at}</small>}{policyDirty && <small>保存后的修改需要重新复核。</small>}</p>}
      <form aria-label="因素政策编辑" onSubmit={event => { event.preventDefault(); savePolicy() }}>
        <fieldset disabled={!!busy || definitionsJson !== null}><legend>因素定义</legend>{editor.definitions.map((definition, index) => {
          const change = (patch: Partial<FactorDefinition>) => setEditor(current => ({ ...current, definitions: current.definitions.map((item, row) => row === index ? { ...item, ...patch } : item) }))
          return <div className="pipeline-definition" key={index}>
            <div className="pipeline-form-grid"><label>因素 {index + 1} 标识<input maxLength={80} value={definition.key} onChange={event => change({ key: event.target.value })} /></label><label>因素 {index + 1} 名称<input maxLength={150} value={definition.label} onChange={event => change({ label: event.target.value })} /></label>
              <label>因素 {index + 1} 类型<select value={definition.value_type} onChange={event => change({ value_type: event.target.value as FactorDefinition['value_type'] })}>{Object.entries(typeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label>因素 {index + 1} 角色<select value={definition.role} onChange={event => change({ role: event.target.value as FactorDefinition['role'] })}>{Object.entries(roleLabels).map(([value, label]) => <option key={value} value={value}>{label} · {value}</option>)}</select></label>
              <label>因素 {index + 1} 权重<input type="number" min="0" max="100" step="any" value={definition.weight} onChange={event => change({ weight: Number(event.target.value) })} /></label>
              <label>因素 {index + 1} 单位<input value={definition.unit || ''} onChange={event => change({ unit: event.target.value || null })} /></label>
              <label>因素 {index + 1} 数值尺度<input type="number" min="0" step="any" value={definition.scale ?? ''} placeholder="数值距离的归一化尺度" onChange={event => change({ scale: event.target.value === '' ? null : Number(event.target.value) })} /></label>
              <label>因素 {index + 1} 适用举措<input value={definition.measure_keys.join(', ')} placeholder="举措标识，用逗号分隔；空表示全举措" onChange={event => change({ measure_keys: event.target.value.split(/[,，]/).map(value => value.trim()) })} /></label>
            </div><Evidence items={definition.evidence} documents={data.documents} />{definition.condition && <details><summary>条件与未满足时的行动</summary><pre>{JSON.stringify({ condition: definition.condition, on_unmet: definition.on_unmet }, null, 2)}</pre></details>}
            <button type="button" onClick={() => setEditor(current => ({ ...current, definitions: current.definitions.filter((_, row) => row !== index) }))}>移除因素 {index + 1}</button>
          </div>
        })}<button type="button" disabled={editor.definitions.length >= 100} onClick={() => setEditor(current => ({ ...current, definitions: [...current.definitions, newDefinition()] }))}>添加因素</button></fieldset>
        <details className="pipeline-advanced"><summary>高级 JSON：条件、原文依据与完整定义</summary><p className="pipeline-muted">完整保留 evidence、condition、source_value 与 on_unmet。JSON 改动可先应用到表单，也会在保存时校验。</p><label>完整因素定义 JSON<textarea spellCheck={false} disabled={!!busy} value={definitionsJson ?? JSON.stringify(editor.definitions, null, 2)} onChange={event => setDefinitionsJson(event.target.value)} /></label>
          <button type="button" disabled={!!busy || definitionsJson === null} onClick={() => { try { const definitions = checkedDefinitions(); setEditor(current => ({ ...current, definitions })); setDefinitionsJson(null); setError('') } catch (cause) { setError(message(cause)) } }}>应用 JSON 定义</button>
        </details>
        <div className="pipeline-form-grid"><label>覆盖率下限<input type="number" min="0" max="1" step="any" value={editor.minCoverage} disabled={!!busy} onChange={event => setEditor(current => ({ ...current, minCoverage: event.target.value }))} /></label><label>组内距离上限<input type="number" min="0" max="1" step="any" value={editor.maxDistance} disabled={!!busy} onChange={event => setEditor(current => ({ ...current, maxDistance: event.target.value }))} /></label></div>
        <label>政策依据与适用备注<textarea maxLength={2000} value={editor.note} disabled={!!busy} onChange={event => setEditor(current => ({ ...current, note: event.target.value }))} /></label>
        <button type="submit" className="pipeline-primary" disabled={!!busy}>{busy === 'policy-save' ? '正在保存…' : '保存因素政策草稿'}</button>
      </form>
      {currentPolicy?.status === 'draft' && <div className="pipeline-review" aria-label="导师政策复核"><label>导师复核备注<textarea value={policyReviewNote} disabled={!!busy} maxLength={2000} placeholder="记录专业依据、原文核对和适用边界" onChange={event => setPolicyReviewNote(event.target.value)} /></label><div className="pipeline-actions">
        <button type="button" className="pipeline-primary" disabled={!!busy || policyDirty || !policyReviewNote.trim()} onClick={() => reviewPolicy('approved')}>政策复核通过</button><button type="button" disabled={!!busy || policyDirty || !policyReviewNote.trim()} onClick={() => reviewPolicy('rejected')}>政策复核不通过</button>
      </div></div>}
    </div>}
    {ready && page === 'groups' && <div className="pipeline-page" aria-label="分组预览">
      <h4>按举措、阶段与因素预览经验分组</h4><p className="pipeline-muted">预览显示政策版本与未分组原因；距离和覆盖率是整理参数，不能解释为业务可信概率。</p>
      <form aria-label="知识分组预览条件" onSubmit={event => { event.preventDefault(); void run('groups', async isCurrent => {
        const result = await api<{ grouping: KnowledgeGrouping; cards: ExperienceCard[] }>(`${base}/groups`, { ...(selectedGroupPolicy ? { policy_id: selectedGroupPolicy.id, policy_revision: selectedGroupPolicy.revision } : {}), ...(measureKey.trim() || question.trim() ? { query: { measure_key: measureKey.trim(), question: question.trim() } } : {}) })
        if (!isCurrent()) return
        setGroupResult(result); setNotice(`已预览 ${result.grouping.groups.length} 组经验，${result.grouping.unassigned.length} 张卡未分组。`)
      }) }}>
        <label>分组因素政策<select value={groupPolicyId} disabled={!!busy} onChange={event => { setGroupPolicyId(event.target.value); setGroupResult(null) }}><option value="">不指定因素政策</option>{data.policies.map(policy => <option key={policy.id} value={policy.id}>{policy.id} · v{policy.revision} · {statusLabels[policy.status]}</option>)}</select></label>
        {selectedGroupPolicy && selectedGroupPolicy.status !== 'approved' && <p className="pipeline-muted">当前为未通过复核的政策参数，仅用于预览。</p>}
        <div className="pipeline-form-grid"><label>分组举措标识<input value={measureKey} disabled={!!busy} placeholder="可留空" onChange={event => { setMeasureKey(event.target.value); setGroupResult(null) }} /></label><label>分组决策问题<input value={question} disabled={!!busy} placeholder="可留空" onChange={event => { setQuestion(event.target.value); setGroupResult(null) }} /></label></div>
        <button type="submit" className="pipeline-primary" disabled={!!busy}>{busy === 'groups' ? '正在预览…' : '预览知识分组'}</button>
      </form>
      {groupResult && <div aria-label="本次分组结果"><p className="pipeline-policy-state">政策 {groupResult.grouping.policy_id || '未指定'} · v{groupResult.grouping.policy_revision ?? '—'} · {groupResult.grouping.policy_status === 'none' ? '未使用因素政策' : statusLabels[groupResult.grouping.policy_status]}<small>候选 {groupResult.grouping.candidate_count} 张{groupResult.grouping.truncated ? ' · 结果已截断，请缩小范围' : ''}</small></p>
        {groupResult.grouping.groups.map(group => <article key={group.id} className="pipeline-card" aria-label={`知识组：${group.id}`}><h5>{group.measure_key} · {group.stage || '阶段待核'} · {group.kind === 'case' ? '案例' : '规则'}</h5><small>组内距离 {group.diameter ?? '未计算'} · 最低覆盖率 {group.min_coverage ?? '未计算'}</small><ul>{group.card_refs.map(ref => <li key={ref.card_id}>{groupResult.cards.find(card => card.id === ref.card_id)?.title || ref.card_id} · {ref.card_id} v{ref.revision}</li>)}</ul></article>)}
        {!!groupResult.grouping.unassigned.length && <div><h5>未分组记录</h5><ul>{groupResult.grouping.unassigned.map(item => <li key={item.card_id}>{item.card_id}：{item.reason}</li>)}</ul></div>}
        <details><summary>本次来源指纹</summary><pre>{groupResult.grouping.source_fingerprint}</pre></details>
      </div>}
    </div>}
    {ready && page === 'skills' && <div className="pipeline-page" aria-label="技能蒸馏">
      <h4>从已审核同举措卡片形成技能草稿</h4><p className="pipeline-muted">先选择已审核经验，整理输入、前置条件、流程与反例。草稿复核通过后才能导出。</p>
      <fieldset disabled={!!busy}><legend>选择技能来源卡片{selectedMeasure ? ` · 当前举措 ${selectedMeasure}` : ''}</legend><div className="pipeline-skill-sources">{data.cards.map(card => {
        const eligible = card.status === 'approved' && !!card.knowledge?.measure_key
        const sameMeasure = !selectedMeasure || card.knowledge?.measure_key === selectedMeasure
        return <label className="pipeline-checkbox" key={card.id}><input type="checkbox" aria-label={`选择技能来源：${card.title}`} checked={selectedCards.includes(card.id)} disabled={!eligible || !sameMeasure || (selectedCards.length >= 20 && !selectedCards.includes(card.id))} onChange={event => setSelectedCards(current => event.target.checked ? [...current, card.id] : current.filter(id => id !== card.id))} /><span>{card.title}<small>{card.knowledge?.measure_key || '举措待归类'} · {statusLabels[card.status]} · {card.id} v{card.revision}{eligible && !sameMeasure ? ' · 与已选举措不同' : ''}</small></span></label>
      })}</div>{!data.cards.length && <p className="pipeline-muted">先提取并在项目经验卡中审核措施记录。</p>}</fieldset>
      <button type="button" className="pipeline-primary" disabled={!!busy || !selectedCards.length} onClick={() => void run('distill', async isCurrent => {
        const skill = await api<DistilledSkill>(`${base}/skills/distill`, { card_ids: selectedCards })
        if (!isCurrent()) return
        update(value => ({ ...value, skills: merge(value.skills, [skill]) })); setSelectedCards([]); setNotice('已整理为技能草稿，流程与适用边界仍需复核。')
      })}>{busy === 'distill' ? '正在整理…' : '蒸馏技能草稿'}</button>
      <div className="pipeline-skill-list">{data.skills.map(skill => <article className="pipeline-card" key={skill.id} aria-label={`技能：${skill.title}`}><header><div><strong>{skill.title}</strong><small>{skill.measure_key} · {skill.id} v{skill.revision} · {skill.method === 'compiled' ? '本地编译整理' : '模型整理'}</small></div><span className={`pipeline-badge is-${skill.status}`}>{statusLabels[skill.status]}</span></header>
        <details><summary>来源卡片与版本 · {skill.card_refs.length}</summary><ul>{skill.card_refs.map(ref => <li key={ref.card_id}>{data.cards.find(card => card.id === ref.card_id)?.title || ref.card_id} · {ref.card_id} v{ref.revision}</li>)}</ul></details>
        <details className="pipeline-skill-content"><summary>查看技能流程与适用边界</summary><h5>输入因素</h5><p>{skill.input_keys.join('、') || '尚未记录'}</p><Conditions title="前置条件" items={skill.preconditions} documents={data.documents} /><Conditions title="排除条件" items={skill.exclusions} documents={data.documents} />
          <h5>操作流程</h5><ol>{skill.procedure.map((step, index) => <li key={index}>{step}</li>)}</ol><h5>验证要点</h5><ul>{skill.validation_points.map((point, index) => <li key={index}>{point}</li>)}</ul><h5>反例与边界</h5><ul>{skill.counterexamples.map((point, index) => <li key={index}>{point}</li>)}</ul><p className="pipeline-muted">允许的工具：{skill.allowed_tools.length ? '原文证据检索' : '无'}。当前审核只记录知识复核状态。</p>
        </details>
        {skill.review_note && <p className="pipeline-review-record">技能复核记录：{skill.review_note}{skill.reviewed_by ? ` · ${skill.reviewed_by}` : ''}{skill.reviewed_at ? ` · ${skill.reviewed_at}` : ''}</p>}
        {skill.status === 'draft' && <div className="pipeline-review"><label>技能复核备注<textarea aria-label={`技能复核备注：${skill.title}`} maxLength={2000} value={skillNotes[skill.id] || ''} disabled={!!busy} placeholder="核对来源版本、流程、前置条件与反例" onChange={event => setSkillNotes(current => ({ ...current, [skill.id]: event.target.value }))} /></label><div className="pipeline-actions">{(['approved', 'rejected'] as const).map(status => <button key={status} type="button" disabled={!!busy || !skillNotes[skill.id]?.trim()} className={status === 'approved' ? 'pipeline-primary' : ''} onClick={() => void run(`skill-review:${skill.id}`, async isCurrent => {
          const next = await api<DistilledSkill>(`${base}/skills/${encodeURIComponent(skill.id)}/review`, { expected_revision: skill.revision, status, note: skillNotes[skill.id].trim() })
          if (!isCurrent()) return
          update(value => ({ ...value, skills: merge(value.skills, [next]) })); setSkillNotes(current => ({ ...current, [skill.id]: '' })); setExported(null)
          setNotice(status === 'approved' ? '技能复核记录已保存，可导出已审核版本。' : '已保存技能未通过原因。')
        })}>{status === 'approved' ? '技能复核通过' : '技能复核不通过'}</button>)}</div><small className="pipeline-muted">草稿暂不可导出为可用 Skill。</small></div>}
        {skill.status === 'approved' && <button type="button" disabled={!!busy} onClick={() => void run(`export:${skill.id}`, async isCurrent => {
          setExported(null)
          const result = await api<{ filename: string; markdown: string }>(`${base}/skills/${encodeURIComponent(skill.id)}/export`)
          if (!isCurrent()) return
          setExported({ ...result, skillId: skill.id })
          const url = URL.createObjectURL(new Blob([result.markdown], { type: 'text/markdown;charset=utf-8' })), link = document.createElement('a')
          link.href = url; link.download = result.filename.split(/[\\/]/).at(-1) || `${skill.id}.md`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 0)
          setNotice('已导出审核通过的技能版本，请保留来源卡片与适用边界。')
        })}>下载已审核 Skill</button>}
        {exported?.skillId === skill.id && <details className="pipeline-export"><summary>查看导出内容 · {exported.filename}</summary><pre>{exported.markdown}</pre></details>}
      </article>)}</div>{!data.skills.length && <p className="pipeline-muted">尚无技能草稿。</p>}
    </div>}
  </section>
}
