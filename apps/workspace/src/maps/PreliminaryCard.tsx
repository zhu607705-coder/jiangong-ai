import { useEffect, useRef, useState } from 'react'
import { IconSparkles, IconRefresh, IconChevronDown, IconArrowUpRight } from '@tabler/icons-react'
import { api } from '../api'
import type { PlaceSelection } from '../../../../packages/maps/types'
import type { MapScreenAnalysis, MapScreenCell, MapScreenContext, MapScreenProfile, MapScreenTheme } from '../../../host/generated/contracts'
import { EVIDENCE_GROUPS, SCREEN_PROFILES, SCREEN_TIERS, SCREEN_THEMES, contextHeadline } from '../../../../packages/maps/screening-policy'

export default function PreliminaryCard({ selection, profile, theme, cell, onContext, onProfile, onOpenProject }: {
  selection: PlaceSelection; profile: MapScreenProfile; theme: MapScreenTheme; cell: MapScreenCell | null;
  onContext: (id: string, context: MapScreenContext) => void; onProfile: (profile: MapScreenProfile) => void; onOpenProject: (id: string) => void;
}) {
  const [context, setContext] = useState<MapScreenContext | null>(null), [analysis, setAnalysis] = useState<MapScreenAnalysis | null>(null)
  const [stage, setStage] = useState<'context' | 'analysis' | 'done'>('context'), [error, setError] = useState(''), [retry, setRetry] = useState(0)
  const [sourcesOpen, setSourcesOpen] = useState(false), analysisAbort = useRef<AbortController | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    analysisAbort.current?.abort()
    setContext(null); setAnalysis(null); setStage('context'); setError(''); setSourcesOpen(false)
    const timer = window.setTimeout(async () => {
      try {
        const target = cell?.context?.target || { kind: 'point', longitude: selection.longitude, latitude: selection.latitude, radius_m: 800, bounds: null }
        const snapshot = !retry && cell?.context && Date.parse(cell.context.expires_at) > Date.now() ? cell.context : await api<MapScreenContext>('/maps/screening/context', { target }, controller.signal)
        if (controller.signal.aborted) return
        setContext(snapshot); setStage('done'); onContext(selection.id, snapshot)
      } catch (error) { if (!controller.signal.aborted) { setStage('done'); setError(error instanceof Error ? error.message : '资料暂未取得。') } }
    }, 220)
    return () => { window.clearTimeout(timer); controller.abort(); analysisAbort.current?.abort() }
  }, [selection.id, selection.longitude, selection.latitude, cell?.context?.id, retry])
  useEffect(() => { analysisAbort.current?.abort(); setAnalysis(null); setStage(s => s === 'analysis' ? 'done' : s) }, [profile])

  async function analyze() {
    if (!context || stage === 'analysis') return
    const controller = new AbortController(); analysisAbort.current = controller
    setStage('analysis'); setError('')
    try {
      const result = await api<MapScreenAnalysis>('/maps/screening/analysis', { context_id: context.id, profile }, controller.signal)
      if (!controller.signal.aborted) setAnalysis(result)
    } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : '初判未完成。') }
    finally { if (!controller.signal.aborted) setStage('done') }
  }
  const model = analysis?.assessment
  const local = context?.local_projects.filter(p => p.relation === 'within_scope') || []
  const background = context?.local_projects.filter(p => p.relation === 'city_background') || []
  const sources = context?.local_projects.flatMap(p => p.sources.map(s => ({...s, project: p, ref: `${p.project_id}:${s.id}`}))) || []
  const cite = (refs: string[]) => refs.map(ref => {
    const title = context?.groups.find(g => g.source_id === ref)?.label || sources.find(s => s.ref === ref)?.title || '来源'
    return title.length > 22 ? title.slice(0, 22) + '…' : title
  }).join(' · ')
  function showEvidence(refs: string[]) {
    setSourcesOpen(true)
    requestAnimationFrame(() => document.getElementById('evidence-' + encodeURIComponent(refs[0]))?.scrollIntoView({block:'start'}))
  }
  return <section className="initial-assessment" aria-label="区域初步分析">
    <header><span><IconSparkles size={15} />片区初步信息</span><small>事实先行 · 按需研判</small></header>
    <p className="assessment-scope">{cell ? '所选分析格网 · 非地块边界' : '选中位置周边直线 800 米'}<span>高德场所记录 + 已有项目资料</span></p>
    {cell && <div className="screening-tier" style={{ '--tier-color': SCREEN_TIERS[cell.tier].color } as React.CSSProperties}><i />{SCREEN_TIERS[cell.tier].label}{cell.metric_value !== null && <small>{cell.metric_value} {SCREEN_THEMES[theme].unit} · {SCREEN_THEMES[theme].label}</small>}</div>}
    {stage === 'context' && <div className="assessment-loading" role="status"><span />正在读取区位事实与已有项目证据…</div>}
    {context && <>
      <div className="assessment-ai-action"><select aria-label="初判研究方向" value={profile} disabled={stage === 'analysis'} onChange={e => onProfile(e.target.value as MapScreenProfile)}>{Object.entries(SCREEN_PROFILES).map(([id,p]) => <option key={id} value={id}>{p.label}</option>)}</select>
        {stage === 'analysis' ? <button onClick={() => { analysisAbort.current?.abort(); setStage('done'); setError('已停止本轮初判，已取得事实保留。') }}>停止初判</button> : <button onClick={() => void analyze()} disabled={!!model}><IconSparkles size={14} />{model ? '初判已生成' : '结合资料生成初判'}</button>}</div>
      <div className="assessment-metrics">{EVIDENCE_GROUPS.map(def => {
        const group = context.groups.find(g => g.key === def.key)!
        return <div key={def.key}><span>{def.label}</span><strong>{group.reported_count === null ? '—' : group.reported_count}{group.reported_count !== null && <small> 条</small>}</strong><small>{group.status === 'failed' ? '本轮未取得数据' : group.status === 'capped' ? '数量较大，待补核' : def.note}</small></div>
      })}</div>
      <div className="project-evidence-summary"><strong>项目资料关联</strong>
        <p>{local.length ? `范围内 ${local.length} 个真实项目，${local.reduce((n,p) => n+p.fact_count,0)} 条来源事实。` : '当前范围未关联已定位的真实项目。'}{background.length ? `已关联 ${background.reduce((n,p)=>n+p.source_count,0)} 份同城公开资料，仅作城市背景。` : '暂无匹配的城市背景资料。'}</p>
        {context.local_projects.map(p => <button key={p.project_id} onClick={() => onOpenProject(p.project_id)}>{p.name}<span>{p.relation === 'city_background' ? '城市背景' : `${p.fact_count} 条事实`}</span><IconArrowUpRight size={12} /></button>)}
      </div>
      <p className="assessment-headline">{model?.summary || contextHeadline(context)}</p>
      <div className="assessment-missing"><strong>投资判断还缺什么</strong><span>成交与租金、获取和改造成本、权属租约、结构条件、真实需求；当前不生成收益评分。</span></div>
      {stage === 'analysis' && <div className="assessment-loading" role="status"><span />正在解读这份固定快照；可继续浏览地图…</div>}
      {model && <div className="assessment-narrative">
        <div><h4>值得核查的方向</h4>{model.opportunities.length ? model.opportunities.map((c,i) => <p key={i}>{c.text}<button className="claim-source" onClick={() => showEvidence(c.evidence_refs)} title={cite(c.evidence_refs)}>依据：{cite(c.evidence_refs)}</button></p>) : <p>当前资料不足以形成具体方向。</p>}</div>
        <div className="assessment-counter"><h4>反向信号</h4>{model.cautions.map((c,i) => <p key={i}>{c.text}<button className="claim-source" onClick={() => showEvidence(c.evidence_refs)}>依据：{cite(c.evidence_refs)}</button></p>)}</div>
        <div><h4>优先核查</h4>{model.next_steps.map((step,i) => <p key={i}><IconArrowUpRight size={12} />{step}</p>)}</div>
      </div>}
      <button className="assessment-source-toggle" aria-expanded={sourcesOpen} onClick={() => setSourcesOpen(v => !v)}>查看依据 · 地图 {context.groups.filter(g => g.status === 'available').length}/4 类 · 项目资料 {sources.length} 份 <IconChevronDown size={13} /></button>
      {sourcesOpen && <div className="assessment-sources">
        <p>{context.metric_note}</p><p>地图获取时间：{new Date(context.created_at).toLocaleString('zh-CN')} · 项目资料保留各自时间</p>
        {context.groups.map(g => <div key={g.key} id={'evidence-' + encodeURIComponent(g.source_id)}><strong>{g.label} · {g.status === 'available' ? '已取得' : '待补核'}</strong><p>{g.sample.map(p => p.name).join('、') || g.issue || '本轮无匹配样例'}</p></div>)}
        {sources.map(s => <div key={s.ref} id={'evidence-' + encodeURIComponent(s.ref)}><strong>{s.title}</strong><p>{s.project.relation === 'city_background' ? '城市背景' : '关联项目资料'} · {s.visibility === 'internal' ? '内部材料，仅本地查看' : '公开资料'} · {s.content_status === 'metadata_only' ? '仅元数据' : s.untrusted_text ? '有正文摘录' : '正文在项目资料页'}</p><p>获取：{s.retrieved_at?.slice(0,10) || '未记录'} · 发布：{s.published_at?.slice(0,10) || '待核实'}</p>{s.untrusted_text && <details><summary>查看原文摘录</summary><p className="evidence-excerpt">{s.untrusted_text}</p></details>}{s.url && /^https?:\/\//.test(s.url) && <a href={s.url} target="_blank" rel="noreferrer">打开原始来源 ↗</a>}</div>)}
        {local.map(p => <div key={p.project_id}><strong>{p.name} · 已有事实与企业约束</strong>{p.facts.map(f => <p key={f.id}>{f.kind}：{typeof f.value === 'object' ? JSON.stringify(f.value) : String(f.value ?? '未知')} {f.unit || ''} · 来源 {f.source_id}</p>)}{p.rules.map(rule => <p key={rule.id}>{rule.original_text || rule.note}</p>)}</div>)}
        <p>{model ? 'AI 使用这份地图与项目公开资料快照；内部原文未发送。引用表示来源关联，具体适用性仍需核验。' : '浏览与标色不调用模型；生成初判时才解读固定快照中的公开资料。'}</p>
      </div>}
    </>}
    {(error || analysis?.reason) && <div className="assessment-retry"><span>{error || analysis?.reason}</span><button aria-label="刷新片区资料" onClick={() => setRetry(v => v + 1)}><IconRefresh size={14} />刷新资料</button></div>}
    <p className="assessment-footnote">先看证据和缺口，再决定调查哪里。地图记录不能证明可投或预测收益。</p>
  </section>
}
