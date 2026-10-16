import { useState } from 'react'
import type { StrategyProgress } from '../../../../packages/retrofit/strategy'
import './strategy-research-progress.css'

const STAGES: Record<StrategyProgress['stage'], string> = { sources: '读取项目资料', research: '检索与整理来源', model: '研究两条更新路径', validation: '整理方案与待核项', result: '形成完整方案' }
const PHASES = { planning: '制定专题研究分工', specialists: '专家并行研究', compression: '压缩与整理上下文', synthesis: '综合形成决策方案' }
const ROLES: Record<string, string> = { building_delivery: '建筑与实施专家', cost_value: '投入与价值专家', residents_operations: '居民需求与运营专家' }
const STATUS = { pending: '等待执行', running: '进行中', completed: '已完成', failed: '未完成', skipped: '本轮跳过', recorded: '已有执行记录', stopped: '已停止' }
type TimelineEntry = { key: string; label: string; latest: StrategyProgress; count: number }
const validCount = (value: number | undefined): value is number => value !== undefined && Number.isFinite(value) && value >= 0
const number = (value: number) => value.toLocaleString('zh-CN', { maximumFractionDigits: 0 })
const shortSummary = (value?: string) => { const summary = value?.trim() || ''; return summary.length > 280 ? `${summary.slice(0, 280)}…` : summary }

/** Progress is a view of received events; elapsed time never advances a phase or a task. */
export default function StrategyResearchProgress({ events, elapsed, onStop }: { events: StrategyProgress[]; elapsed: number; onStop: () => void }) {
  const [stopped, setStopped] = useState(false)
  const latest = events.at(-1)
  const timeline: TimelineEntry[] = []
  for (const event of events) {
    const key = event.workflow ? `workflow:${event.workflow.phase}` : `stage:${event.stage}`
    const previous = timeline.at(-1)
    if (previous?.key === key) { previous.latest = event; previous.count++ }
    else timeline.push({ key, label: event.workflow ? PHASES[event.workflow.phase] : STAGES[event.stage], latest: event, count: 1 })
  }
  const taskSnapshot = [...events].reverse().find(event => event.workflow?.tasks !== undefined)?.workflow?.tasks || []
  const tasks = [...new Map(taskSnapshot.map(task => [task.id, task])).values()].slice(0, 3)
  const sourceCount = [...events].reverse().find(event => validCount(event.source_count))?.source_count
  const compression = [...events].reverse().find(event => event.workflow?.phase === 'compression' && (validCount(event.workflow.context_before_chars) || validCount(event.workflow.context_after_chars)))?.workflow
  const completed = latest?.stage === 'result' && latest.status === 'completed'
  const failed = latest?.status === 'failed'
  const workflow = events.some(event => !!event.workflow)
  const heading = stopped ? '研究已停止' : completed ? '本轮方案研究已完成' : failed ? '本轮方案研究未完成' : workflow ? '专题协作研究进度' : '整体更新方案研究进度'
  function stop() { if (stopped || completed || failed) return; onStop(); setStopped(true) }
  return <section className={`strategy-progress strategy-research-progress${failed ? ' is-failed' : ''}`} aria-label="整体更新方案研究进度" aria-live="polite" data-workflow={workflow ? 'native' : 'legacy'} data-terminal={completed || failed || stopped}>
    <header><div><span>服务端实际进度</span><h3>{heading}</h3></div><div className="strategy-elapsed"><span>{validCount(elapsed) ? `${number(elapsed)} 秒` : '计时未登记'}</span>{!completed && !failed && !stopped && <button type="button" onClick={stop}>停止本次研究</button>}</div></header>
    <div className="strategy-progress-summary"><strong>{stopped ? '已保留停止前的进度记录。' : latest?.message || '等待服务返回实际研究阶段。'}</strong>{stopped && latest?.message && <p>最后事件：{latest.message}</p>}<p>{validCount(sourceCount) ? `已整理 ${number(sourceCount)} 份资料` : '本轮资料数量等待服务返回'} · {timeline.length} 条阶段记录</p></div>
    {!!timeline.length && <ol className="srp-timeline" aria-label="研究阶段事件时间线">{timeline.map((entry, index) => {
      const state = stopped && index === timeline.length - 1 && entry.latest.status === 'running' ? 'stopped' : index < timeline.length - 1 && entry.latest.status === 'running' ? 'recorded' : entry.latest.status
      return <li key={`${entry.key}:${index}`} data-phase={entry.key} data-state={state}><span className="srp-phase-marker" aria-hidden="true">{state === 'completed' ? '✓' : String(index + 1).padStart(2, '0')}</span><div><strong>{entry.label}</strong><span>{STATUS[state]}</span><p>{entry.latest.message}</p></div></li>
    })}</ol>}
    {!!tasks.length && <section className="srp-experts" aria-label="已规划的专家任务"><header><h4>专题专家任务</h4><span>{tasks.length} 项已规划任务{stopped ? ' · 停止前最后状态' : ''}</span></header><div className="srp-expert-grid">{tasks.map(task => <article key={task.id} className="srp-expert" data-task-id={task.id} data-state={task.status}><div><span className="srp-task-indicator" aria-hidden="true"/><strong>{ROLES[task.role] || '专题研究专家'}</strong><span className="srp-task-status">{STATUS[task.status]}</span></div><p>{validCount(task.source_count) ? `关联 ${number(task.source_count)} 份资料` : '资料数量未登记'}</p>{shortSummary(task.summary) && <details><summary>任务要点</summary><p>{shortSummary(task.summary)}</p></details>}</article>)}</div></section>}
    {compression && <section className="srp-compression" aria-label="上下文压缩字符记录"><div><h4>上下文字符记录</h4><p>按服务返回的同次压缩记录显示</p></div><dl><div><dt>压缩前</dt><dd>{validCount(compression.context_before_chars) ? number(compression.context_before_chars) : '未登记'}<small>字符</small></dd></div><span aria-hidden="true">→</span><div><dt>压缩后</dt><dd>{validCount(compression.context_after_chars) ? number(compression.context_after_chars) : '等待记录'}<small>字符</small></dd></div></dl></section>}
  </section>
}
