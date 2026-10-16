import { useId } from 'react'
import type { DecisionPacket } from '../../../host/generated/contracts'
import type { Project } from '../api'
import type { ResearchRound } from '../../../../packages/retrofit/research-rounds'
import type { StrategyPacket } from '../../../../packages/retrofit/strategy'
import { MODE_LABELS } from '../../../../packages/retrofit/renewal-mode'
import './ProjectResultsPage.css'

export type ProjectResultsPageProps = {
  project: Project
  packet: StrategyPacket | null
  rounds?: ResearchRound[]
  legacyPacket?: DecisionPacket | null
  onNavigate: (page: 'assessment' | 'scenarios' | 'results', section?: string, pane?: string) => void
  onRunDetails: () => void
}
const roundLabels: Record<ResearchRound['status'], string> = { draft: '草稿', running: '研究中', completed: '本轮已完成', failed: '本轮未完成', obsolete: '资料已变化' }
const packetLabels: Record<StrategyPacket['status'], string> = { completed: '完整结果已保存', failed: '本轮未完成', unavailable: '尚无可用结果' }
const stageLabels = { preliminary: '前期研究', construction: '工程实施', hold: '暂缓' }
const dimensions = { demand: '居民需求', supply: '公共服务', adaptation: '居住工程', implementation: '实施协同', operations: '长效维护', resources: '资金交付' }
const belongs = (project: Project, packet: StrategyPacket | null | undefined): packet is StrategyPacket =>
  !!packet && packet.project_id === project.id && packet.synthetic === project.input.synthetic
const timestamp = (value: string) => {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : `${date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}（北京时间）`
}
const refs = (ids: string[]) => `引用来源：${ids.length ? ids.join('、') : '未登记'}`
const literal = (text: string) => {
  const fence = '`'.repeat(Math.max(3, ...[...text.matchAll(/`+/g)].map(match => match[0].length + 1)))
  return `${fence}text\n${text}\n${fence}`
}

/** A readable export of this saved result only; original sources and optional structured additions remain unchanged. */
export function renderStrategyReportMarkdown(project: Project, packet: StrategyPacket): string {
  if (!belongs(project, packet)) throw new Error('REPORT_PROJECT_MISMATCH')
  const strategy = packet.strategy
  const lines = [`# ${strategy?.headline || '本轮研究记录'}`, '', `项目：${project.name}（${packet.project_id}）`,
    `生成时点：${packet.created_at}`, `资料基线：v${packet.context_version}`, `项目当前资料版本：v${project.context_version}`,
    `结果状态：${packetLabels[packet.status]}`, `资料类型：${packet.synthetic ? '模拟项目' : '项目资料'}`, `结果标识：${packet.input_hash}`, '']
  if (packet.error) lines.push('本轮记录：' + packet.error, '')
  if (strategy) {
    lines.push(strategy.summary, '')
    const brief = strategy.decision_brief
    if (brief) lines.push('## 改造方向', '', brief.renewal.conclusion, '', brief.renewal.reason, '', refs(brief.renewal.evidence_refs), '',
      '## 投入阶段与安排', '', `阶段：${stageLabels[brief.investment.stage]}`, '', brief.investment.conclusion, '', brief.investment.reason, '', refs(brief.investment.evidence_refs), '',
      '## 财务与社会效果', '', '财务效果：' + brief.returns.financial, '', '社会效果：' + brief.returns.social, '', refs(brief.returns.evidence_refs), '')
    lines.push('## 判断与原文引用', '')
    for (const claim of strategy.rationale) lines.push(`### ${claim.point}`, '', `来源：${claim.source_id}`, '', literal(claim.quote), '')
    for (const path of strategy.paths) {
      lines.push(`## ${MODE_LABELS[path.mode]} · ${path.title}`, '', path.description, '', '### 具体举措', '')
      for (const action of path.actions) lines.push(`#### ${action.title}`, '', action.detail, '', refs(action.evidence_refs), '')
      if (path.requirements.length) lines.push('### 实施要求', '', ...path.requirements.map(item => '- ' + item), '')
      for (const item of path.work_packages || []) lines.push(`### 工作包：${item.target}`, '', `工作包标识：${item.id}`, `对象依据：${item.target_basis}`,
        `举措：${item.intervention}`, `范围：${item.scope}`, `数量：${item.quantity === null ? '未登记' : String(item.quantity)}${item.unit ? ' ' + item.unit : ''}`,
        `数量依据：${item.quantity_basis}`, `交付：${item.delivery}`, `顺序：${item.priority}`, `原文来源：${item.source_id} · ${item.locator}`, '', literal(item.quote), '',
        ...item.preconditions.map(condition => '- 前置条件：' + condition), '', refs(item.evidence_refs), '')
    }
    if (strategy.dimensions.length) lines.push('## 六维现况与方案目标', '')
    for (const dimension of strategy.dimensions) lines.push(`### ${dimensions[dimension.key]}`, '', `现况（${dimension.current_level}）：${dimension.current}`,
      `综合整治目标（${dimension.comprehensive_level}）：${dimension.comprehensive}`, `原拆原建目标（${dimension.rebuild_level}）：${dimension.rebuild}`, '', refs(dimension.evidence_refs), '')
    if (strategy.internal_data_requests?.length) lines.push('## 待补内部资料', '')
    for (const request of strategy.internal_data_requests || []) lines.push(`### ${request.metric}`, '', `记录标识：${request.id} · ${request.key}`, `用途：${request.purpose}`,
      `采集方法：${request.collection_method}`, `单位：${request.unit}`, `时段：${request.period}`, `分母口径：${request.denominator}`,
      `关联工作包：${request.related_package_ids.join('、') || '未登记'}`, '', refs(request.evidence_refs), '')
    if (strategy.round_review) {
      lines.push('## 本轮相对上一轮的变化', '', strategy.round_review.summary, '')
      for (const change of strategy.round_review.changes) lines.push(`### ${change.topic}`, '', '原判断：' + change.before, '', '本轮判断：' + change.after,
        '', '变化依据：' + change.reason, '', refs(change.evidence_refs), '')
      for (const missing of strategy.round_review.missing_materials) lines.push(`### 待补：${missing.topic}`, '', missing.request, '', missing.reason, '', refs(missing.evidence_refs), '')
    }
    if (strategy.next_checks.length) lines.push('## 下一步核查', '')
    for (const check of strategy.next_checks) lines.push(`### ${check.title}`, '', check.detail, '', refs(check.evidence_refs), '')
  }
  lines.push('## 本次保存的来源原文', '')
  for (const source of packet.sources) lines.push(`### ${source.title}`, '', `来源标识：${source.id}`, `原文定位：${source.locator || '未登记'}`,
    `范围：${source.role === 'current' ? '本对象材料' : '参考材料'}`, `来源日期：${source.published_at || '未登记'}`,
    ...(source.visibility ? [`访问范围：${source.visibility}`] : []), ...(source.data_class ? [`资料类别：${source.data_class}`] : []),
    ...(source.document_version ? [`文档版本：${source.document_version}`] : []), ...(source.url ? [`原始链接：${source.url}`] : []), '', literal(source.text), '')
  return lines.join('\n') + '\n'
}

// Reuses the existing browser Blob/anchor download pattern from the material and community report components.
function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type })), link = document.createElement('a')
  link.href = url; link.download = name; link.hidden = true; document.body.append(link); link.click(); link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
function ExportButtons({ project, packet }: { project: Project; packet: StrategyPacket }) {
  const name = `${project.name}-资料v${packet.context_version}-${packet.input_hash.slice(0, 10)}`.replace(/[\\/:*?"<>|\p{Cc}]/gu, '_')
  return <div className="project-results-exports">
    <button type="button" onClick={() => download(`${name}.md`, renderStrategyReportMarkdown(project, packet), 'text/markdown;charset=utf-8')}>导出 Markdown</button>
    <button type="button" onClick={() => download(`${name}.json`, JSON.stringify(packet, null, 2) + '\n', 'application/json;charset=utf-8')}>导出 JSON</button>
  </div>
}
function ResultBaseline({ project, packet }: { project: Project; packet: StrategyPacket }) {
  const oldVersion = packet.context_version !== project.context_version
  return <dl className="project-results-baseline"><div><dt>生成时点</dt><dd><time dateTime={packet.created_at}>{timestamp(packet.created_at)}</time></dd></div>
    <div><dt>资料基线</dt><dd>v{packet.context_version}</dd></div><div><dt>当前资料</dt><dd>v{project.context_version}</dd></div>
    <div><dt>版本状态</dt><dd>{oldVersion ? '旧资料版本结果' : packet.publication?.is_current === false ? '同资料版本保存快照' : '与当前资料一致'}</dd></div></dl>
}

function SavedResearchReport({ project, packet }: { project: Project; packet: StrategyPacket }) {
  const strategy=packet.strategy!,brief=strategy.decision_brief
  return <details className="project-results-report"><summary>查看本轮调研报告</summary><article aria-label="本项目调研报告">
    <header><span>{project.name} · 资料 v{packet.context_version} · {timestamp(packet.created_at)}</span><h3>{strategy.headline}</h3><p>{strategy.summary}</p></header>
    {brief&&<section><h4>更新判断与投入安排</h4><h5>{brief.renewal.conclusion}</h5><p>{brief.renewal.reason}</p><h5>{brief.investment.conclusion}</h5><p>{stageLabels[brief.investment.stage]} · {brief.investment.reason}</p><h4>预期财务与社会效果</h4><p><strong>财务效果：</strong>{brief.returns.financial}</p><p><strong>社会效果：</strong>{brief.returns.social}</p></section>}
    {strategy.paths.map(path=><section key={path.mode}><h4>{MODE_LABELS[path.mode]} · {path.title}</h4><p>{path.description}</p>{path.work_packages?.length?<div className="project-report-table-scroll"><table><thead><tr><th>对象与范围</th><th>具体改造做法</th><th>工程量口径</th><th>预期交付</th><th>实施前提</th></tr></thead><tbody>{path.work_packages.map(row=><tr key={row.id}><th>{row.target}<p>{row.scope}</p></th><td>{row.intervention}</td><td>{row.quantity===null?'待测量':`${row.quantity} ${row.unit}`}<small>{row.quantity_basis==='scenario'?'情景设定':row.quantity_basis==='unknown'?'待核工程量':'原文记载'}</small></td><td>{row.delivery}</td><td>{row.preconditions.join('；')}</td></tr>)}</tbody></table></div>:<ul>{path.actions.map((row,index)=><li key={index}><strong>{row.title}</strong><p>{row.detail}</p></li>)}</ul>}</section>)}
    {!!strategy.next_checks.length&&<section><h4>下一步调查与补充材料</h4><ul>{strategy.next_checks.map((row,index)=><li key={index}><strong>{row.title}</strong><p>{row.detail}</p></li>)}</ul></section>}
    <section><h4>本轮引用来源</h4><ol>{packet.sources.map(source=><li key={source.id}><strong>{source.title}</strong><p>{source.role==='current'?'本对象资料':'案例参考'} · {source.published_at||'日期未登记'} · {source.locator}</p>{source.url&&/^https?:\/\//.test(source.url)&&<a href={source.url} target="_blank" rel="noreferrer">查看来源 ↗</a>}</li>)}</ol></section>
  </article></details>
}

export default function ProjectResultsPage({ project, packet, rounds = [], legacyPacket, onNavigate, onRunDetails }: ProjectResultsPageProps) {
  const headingId = useId()
  const localRounds = rounds.filter(round => round.project_id === project.id).slice().sort((a, b) => a.round_number - b.round_number)
  const candidates = [packet, ...localRounds.map(round => round.result)].filter((result): result is StrategyPacket =>
    belongs(project, result) && result.status === 'completed' && !!result.strategy)
    .sort((a, b) => b.context_version - a.context_version || Date.parse(b.created_at) - Date.parse(a.created_at))
  const saved = candidates.find(result => result.context_version === project.context_version)
    || candidates[0] || null
  const legacy = legacyPacket?.project_id === project.id && legacyPacket.synthetic === project.input.synthetic ? legacyPacket : null
  const currentFailure = belongs(project, packet) && packet.status !== 'completed' ? packet : null
  return <section className="project-results-page" aria-labelledby={headingId}>
    <header className="project-results-header"><div><h2 id={headingId}>成果管理</h2><p>查看本项目实际保存的方案、资料基线和研究轮次，保留旧报告及其对应来源。</p></div>
      <div className="project-results-navigation"><button type="button" onClick={() => onNavigate('results', 'history')}>版本变化</button><button type="button" onClick={onRunDetails}>运行详情</button></div></header>
    {currentFailure && <p className="project-results-failure" role="status">{packetLabels[currentFailure.status]}：{currentFailure.error || '本轮没有形成完整方案，原有报告继续保留。'}</p>}
    {saved ? <article className="project-results-primary" aria-label="已保存方案">
      <div className="project-results-tags"><span>完整结果已保存</span>{saved.synthetic && <span>模拟项目</span>}</div>
      <h3>{saved.strategy!.headline}</h3><p>{saved.strategy!.summary}</p><ResultBaseline project={project} packet={saved} />
      <div className="project-results-card-actions"><button type="button" className="project-results-main-action" onClick={() => onNavigate('scenarios', 'compare')}>查看方案</button><ExportButtons project={project} packet={saved} /></div>
      <SavedResearchReport project={project} packet={saved}/>
    </article> : <section className="project-results-empty" aria-label="暂无整体方案"><h3>尚无已保存的整体更新方案</h3><p>先核对本项目资料与条件，再开始改造研判。已有运行记录和归档文件仍可查看。</p>
      <button type="button" className="project-results-main-action" onClick={() => onNavigate('assessment', 'direction')}>进入改造研判</button></section>}
    {localRounds.length > 0 && <section className="project-results-rounds" aria-label="研究轮次与历史报告"><h3>研究轮次与历史报告</h3>
      <div className="project-results-round-list">{localRounds.map(round => {
        const result = belongs(project, round.result) ? round.result : null
        return <article className={`project-results-round status-${round.status}`} key={round.id} aria-label={`研究轮次 ${round.round_number}`}>
          <header><h4>第 {round.round_number} 轮</h4><span>{roundLabels[round.status]}</span></header>
          <p className="project-results-round-meta">资料基线 v{round.context_version} · 保存于 <time dateTime={round.created_at}>{timestamp(round.created_at)}</time></p>
          {result?.strategy ? <h5>{result.strategy.headline}</h5> : <p>该轮尚未保存完整方案。</p>}
          {round.error && <p className="project-results-round-error">{round.error}</p>}
          <p className="project-results-round-id">轮次 ID：{round.id}{round.parent_round_id ? ` · 上一轮：${round.parent_round_id}` : ' · 首轮记录'}</p>
          {result && <ExportButtons project={project} packet={result} />}
        </article>
      })}</div>
    </section>}
    {legacy && <article className="project-results-archive" aria-label="旧版运行报告"><h3>旧版运行报告</h3><p>运行版本 {legacy.revision} · 资料基线 v{legacy.context_version} · <time dateTime={legacy.created_at}>{timestamp(legacy.created_at)}</time></p>
      <p>{legacy.summary}</p><a href={`/api/runs/${encodeURIComponent(legacy.run_id)}/report`} download>导出旧版研判报告</a></article>}
  </section>
}
