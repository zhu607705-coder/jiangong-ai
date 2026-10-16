import { useEffect, useRef, useState } from 'react'
import type { RenewalInternalDataRequest, RenewalWorkPackage } from '../../../host/generated/contracts'
import type { StrategyPacket } from '../../../../packages/retrofit/strategy'
import { currentDirectionText, type StrategyDirection } from './strategy-direction-text'
import {useProjectDecisionGuidance,orderByDecision} from './ProjectDecisionGuidance'
import './concrete-work-plan.css'

const PRIORITY = { first: { order: 0, label: '优先' }, next: { order: 1, label: '后续' }, reserve: { order: 2, label: '储备' } }
const TARGET_BASIS = { object_source: '原文所指对象', project_scope: '项目范围提议', scenario: '情景对象' }
const DATA_KEYS = { resident_wellbeing: '居民幸福度', elevator_usage: '电梯利用率', meal_attendance: '食堂用餐人数', other: '其他内部指标' }

function quantityText(row: RenewalWorkPackage) {
  if (row.quantity_basis === 'unknown' || row.quantity === null || !Number.isFinite(row.quantity) || row.quantity < 0 || !row.unit?.trim()) return null
  return `${row.quantity.toLocaleString('zh-CN', { maximumFractionDigits: 10 })} ${row.unit}`
}

export default function ConcreteWorkPlan({ packet, direction, onEvidence, onInvestigate }: {
  packet: StrategyPacket; direction: StrategyDirection; onEvidence: (refs: string[], packet?: StrategyPacket) => void; onInvestigate?: () => void;
}) {
  const strategy = packet.status === 'completed' ? packet.strategy : null
  const path = strategy?.paths.find(row => row.mode === direction)
  const clean = (value: string) => currentDirectionText(value, direction)
  const guidance=useProjectDecisionGuidance(packet.input_hash)
  const originalPackages=[...(path?.work_packages||[])].sort((a,b)=>PRIORITY[a.priority].order-PRIORITY[b.priority].order)
  const packages=guidance?orderByDecision(originalPackages,guidance.measures,row=>`${direction}:${row.id}`):originalPackages
  const ownIds = new Set(packages.filter(row => packages.filter(other => other.id === row.id).length === 1).map(row => row.id))
  const requests = (strategy?.internal_data_requests || []).filter(request => request.related_package_ids.some(id => ownIds.has(id)))
  const unlinked = (strategy?.internal_data_requests || []).filter(request => !request.related_package_ids.length)
  const [focused, setFocused] = useState(''), root = useRef<HTMLElement | null>(null)
  useEffect(() => { setFocused('') }, [packet.input_hash, direction])
  const knownRefs = (refs: string[]) => [...new Set(refs)].filter(id => packet.sources.some(source => source.id === id))
  const evidence = (refs: string[]) => onEvidence(knownRefs(refs), packet)
  function focusPackage(id: string) {
    const target = [...root.current?.querySelectorAll<HTMLElement>('[data-work-package-id]') || []].find(row => row.getAttribute('data-work-package-id') === id)
    if (!target) return
    setFocused(id); target.scrollIntoView?.({ block: 'center', behavior: 'smooth' }); target.focus?.({ preventScroll: true })
  }
  function requestTable(rows: RenewalInternalDataRequest[], linked: boolean) {
    return <div className="cwp-table-scroll"><table className="cwp-data-table"><thead><tr><th scope="col">待采集指标与用途</th><th scope="col">采集方法</th><th scope="col">单位／时间窗</th><th scope="col">样本分母</th><th scope="col">关联分项</th></tr></thead><tbody>{rows.map(request => <tr key={request.id}><th scope="row"><strong>{clean(request.metric) || DATA_KEYS[request.key]}</strong><p>{clean(request.purpose)}</p></th><td>{clean(request.collection_method)}</td><td><strong>{request.unit}</strong><p>{request.period}</p></td><td>{request.denominator}</td><td>{linked ? packages.filter(row => ownIds.has(row.id) && request.related_package_ids.includes(row.id)).map(row => <button key={row.id} className="cwp-link" onClick={() => focusPackage(row.id)}>{row.target} →</button>) : <span>尚未关联具体分项</span>}{!!knownRefs(request.evidence_refs).length && <button className="cwp-link" onClick={() => evidence(request.evidence_refs)}>采集建议依据 ↗</button>}</td></tr>)}</tbody></table></div>
  }
  if (!path) return <section className="concrete-work-plan cwp-empty"><h3>本方向具体方案尚未形成</h3><p>完成本资料版本的改造研判后，在这里查看对象、做法、数量口径和交付分项。</p></section>
  return <section ref={root} className="concrete-work-plan" aria-label="具体改造分项方案" data-plan-direction={direction}>
    <header className="cwp-heading"><div><span>{packages.length ? '具体改造分项' : '旧版建议'}</span><h3>{clean(path.title) || '本方向改造方案'}</h3><p>{clean(path.description)}</p></div><div className="cwp-baseline"><strong>资料 v{packet.context_version}</strong>{packages.length > 0 && <span>{packages.length} 个分项 · 优先 {packages.filter(row => row.priority === 'first').length} 项</span>}</div></header>
    {packages.length ? <div className="cwp-table-scroll"><table className="cwp-work-table" aria-label="改造对象与工程分项表"><thead><tr><th scope="col">{guidance?'Decision 顺序':'优先序'}</th><th scope="col">具体对象与范围</th><th scope="col">改造做法</th><th scope="col">数量口径</th><th scope="col">交付效果</th><th scope="col">实施前提</th><th scope="col">出处与依据</th></tr></thead><tbody>{packages.map((row, index) => { const source = packet.sources.find(source => source.id === row.source_id), number = quantityText(row), refs = knownRefs([row.source_id, ...row.evidence_refs]); return <tr key={`${row.id}:${index}`} data-work-package-id={row.id} data-focused={focused === row.id} tabIndex={-1}><td><span className={`cwp-priority cwp-priority--${row.priority}`}>{PRIORITY[row.priority].label}</span><span className="cwp-row-number">{String(index + 1).padStart(2, '0')}</span></td><th scope="row"><strong>{row.target}</strong><span className={`cwp-target-basis cwp-target-basis--${row.target_basis}`}>{TARGET_BASIS[row.target_basis]}</span><p>{clean(row.scope)}</p></th><td>{clean(row.intervention) || '本方向具体做法待完善。'}</td><td><strong className={!number ? 'cwp-quantity-missing' : undefined}>{number || '工程量待测'}</strong><span className="cwp-quantity-basis">{!number ? '按本分项范围测量' : row.quantity_basis === 'scenario' ? '情景设定' : '原文记载数值'}</span></td><td>{clean(row.delivery) || '本方向交付要求待明确。'}</td><td>{row.preconditions.length ? <ul>{row.preconditions.map(clean).filter(Boolean).map((condition, position) => <li key={position}>{condition}</li>)}</ul> : '该分项未另列前提'}</td><td><span className="cwp-source-title">{source?.title || '当前版本来源暂不可读'}</span><span className="cwp-locator">{row.locator}</span><details><summary>引用原文</summary><blockquote>{row.quote}</blockquote></details><button className="cwp-link" disabled={!source} onClick={() => evidence([row.source_id])}>查看原始来源 ↗</button>{refs.length > 1 && <button className="cwp-link" onClick={() => evidence(refs)}>全部关联依据 ↗</button>}</td></tr> })}</tbody></table></div> : <div className="cwp-legacy"><p>当前保存版本仅含概括举措。可在改造研判中重新研究，升级为带对象、数量口径与交付效果的分项清单。</p><div className="ssw-actions">{path.actions.map((action, index) => { const title = clean(action.title), detail = clean(action.detail); return title || detail ? <article key={index}><span className="ssw-action-number">{String(index + 1).padStart(2, '0')}</span><div><h4>{title || '本方向原版建议'}</h4><p>{detail}</p>{!!knownRefs(action.evidence_refs).length && <button className="ssw-link cwp-link" onClick={() => evidence(action.evidence_refs)}>查看举措依据 ↗</button>}</div></article> : null })}</div></div>}
    {!!path.requirements.map(clean).filter(Boolean).length && <aside className="cwp-shared-conditions"><strong>本方向共同实施前提</strong><ul>{path.requirements.map(clean).filter(Boolean).map((requirement, index) => <li key={index}>{requirement}</li>)}</ul></aside>}
    {!!requests.length && <section className="cwp-data-requests" aria-label="本方向内部数据采集计划"><header><div><span>与工程分项分开安排</span><h4>下一轮应补充哪些内部数据</h4></div>{onInvestigate && <button className="cwp-investigate" onClick={onInvestigate}>进入调查任务 →</button>}</header>{requestTable(requests, true)}</section>}
    {!!unlinked.length && <section className="cwp-unlinked-requests" aria-label="项目层面内部数据采集计划"><h4>项目层面采集建议 · {unlinked.length} 项尚未关联具体分项</h4>{requestTable(unlinked, false)}{onInvestigate && <button className="cwp-link" onClick={onInvestigate}>在调查任务中安排采集 →</button>}</section>}
    {!requests.length && !unlinked.length && onInvestigate && <button className="cwp-link cwp-investigate-link" onClick={onInvestigate}>在调查任务中补充本方案实施资料 →</button>}
  </section>
}
