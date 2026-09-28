import { useEffect, useRef, useState } from 'react'
import { IconSparkles, IconRefresh, IconChevronDown, IconArrowUpRight } from '@tabler/icons-react'
import { api } from '../api'
import type { PlaceSelection } from '../../../../packages/maps/types'
import type { MapScreenAnalysis, MapScreenCell, MapScreenContext, MapScreenProfile, MapScreenTheme } from '../../../host/generated/contracts'
import { SCREEN_PROFILES, SCREEN_TIERS } from '../../../../packages/maps/screening-policy'

import { decisionSignals, FACTOR_LABELS } from '../../../../packages/maps/decision-factors'
import { DecisionRoute } from '../components/DecisionRoute'

export default function PreliminaryCard({ selection, profile, theme, cell, onContext, onProfile, onOpenProject, onAssessment }: {
  selection: PlaceSelection; profile: MapScreenProfile; theme: MapScreenTheme; cell: MapScreenCell | null;
  onContext: (id: string, context: MapScreenContext) => void; onProfile: (profile: MapScreenProfile) => void; onOpenProject: (id: string) => void; onAssessment?: (contextId: string, result: MapScreenAnalysis) => void;
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
      if (!controller.signal.aborted) { setAnalysis(result); onAssessment?.(context.id, result) }
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
  const signals = context ? decisionSignals(context) : []
  return <section className="initial-assessment" aria-label="区域初步分析">
    {stage === 'context' && <p role="status">正在读取所选位置…</p>}
    {context && <>
      <DecisionRoute value={analysis?.decision_support} />
      {cell && <div className="screening-tier" style={{ '--tier-color': SCREEN_TIERS[cell.tier].color } as React.CSSProperties}><i />{SCREEN_TIERS[cell.tier].label}</div>}
      {model ? <div className="assessment-narrative">
        <p className="assessment-headline">{model.summary}</p>
        {model.opportunities.slice(0,1).map((c,i) => <p key={i}>{c.text}<button className="claim-source" onClick={() => showEvidence(c.evidence_refs)} title={cite(c.evidence_refs)}>依据</button></p>)}
        {model.cautions.slice(0,1).map((c,i) => <p key={i}><strong>关键条件 </strong>{c.text}<button className="claim-source" onClick={() => showEvidence(c.evidence_refs)} title={cite(c.evidence_refs)}>依据</button></p>)}
        {model.next_steps.slice(0,1).map((step,i) => <p key={i}><strong>下一步 </strong>{step}</p>)}
      </div> : <div className="selection-signals">{signals.length ? signals.map(s => <article key={s.title}>
        <h4>{s.title}</h4><p className="signal-observation">{s.observation}</p><p>{s.implication}</p>
      </article>) : <p>选定研究方向，查看这处空间的实施路径。</p>}</div>}
      <div className="assessment-ai-action"><select aria-label="初判研究方向" value={profile} disabled={stage === 'analysis'} onChange={e => onProfile(e.target.value as MapScreenProfile)}>{Object.entries(SCREEN_PROFILES).map(([id,p]) => <option key={id} value={id}>{p.label}</option>)}</select>
        {stage === 'analysis' ? <button onClick={() => { analysisAbort.current?.abort(); setStage('done') }}>停止</button> : <button onClick={() => void analyze()} disabled={!!model}><IconSparkles size={15} />{model ? '已研判' : '研判此处'}</button>}</div>
      {stage === 'analysis' && <p role="status">正在研判…</p>}
      <button className="assessment-source-toggle" aria-expanded={sourcesOpen} onClick={() => setSourcesOpen(v => !v)}>查看依据 <IconChevronDown size={14} /></button>
      {sourcesOpen && <div className="assessment-sources">
        <DecisionRoute value={analysis?.decision_support} details />
        <p>{cell ? cell.boundary_source : '位置周边 800 米'} · {new Date(context.created_at).toLocaleDateString('zh-CN')}</p>
        {context.groups.map(g => <div key={g.key} id={'evidence-' + encodeURIComponent(g.source_id)}><strong>{g.label}</strong><p>{g.sample.map(p => p.name).join('、') || g.issue || '暂无样本'}</p></div>)}
        {signals.map(s=><div key={s.title}><strong>{s.title}的调查用途</strong><p>{s.next}</p></div>)}
        {sources.map(s => <div key={s.ref} id={'evidence-' + encodeURIComponent(s.ref)}><strong>{s.title}</strong><p>{s.project.relation === 'city_background' ? '城市背景' : '所选项目'} · {s.visibility === 'internal' ? '内部资料' : '公开资料'} · {s.published_at?.slice(0,10) || '日期待补'}</p>{s.untrusted_text && <details><summary>原文摘录</summary><p className="evidence-excerpt">{s.untrusted_text}</p></details>}{s.url && /^https?:\/\//.test(s.url) && <a href={s.url} target="_blank" rel="noreferrer">原始来源 ↗</a>}</div>)}
        {local.map(p => <button key={p.project_id} onClick={() => onOpenProject(p.project_id)}>{p.name}<IconArrowUpRight size={14} /></button>)}
        {cell?.factors?.map(f=><div key={f.key}><strong>{FACTOR_LABELS[f.key]}</strong><p>{f.summary}</p>{f.evidence_refs.length>0 && <button onClick={()=>showEvidence(f.evidence_refs)}>查看来源</button>}</div>)}
      </div>}
    </>}
    {(error || analysis?.reason) && <div className="assessment-retry"><span>{error || analysis?.reason}</span><button aria-label="刷新片区资料" onClick={() => setRetry(v => v + 1)}><IconRefresh size={14} />重试</button></div>}
  </section>
}
