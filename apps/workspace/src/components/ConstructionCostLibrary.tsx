import { useEffect, useState } from 'react'
import { api } from '../api'
import type { AmountKind, WorkType, CostLibraryResult } from '../../../../packages/construction-costs/library'
import './construction-cost-library.css'
import CostNeuralPreview from './CostNeuralPreview'

const amountLabels: Record<AmountKind, string> = { estimate: '估算', budget: '预算', tender_ceiling: '招标控制价', candidate_bid: '候选报价', winning_bid: '中标价', contract_price: '合同价', settlement: '结算价' }
const workLabels: Record<WorkType, string> = { construction: '施工', epc: 'EPC工程总承包', design: '设计', supervision: '监理', other: '其他' }
const basisLabels: Record<string, string> = { tender_estimate: '招标估算', total_investment_estimate: '总投资估算', contract_price: '合同价', epc_contract_total: 'EPC合同总价', construction_contract: '施工合同价', telecom_subproject_contract: '通信分项合同价', construction_winning_bid: '施工中标总价', construction_award: '施工中标总价', construction_tender_control: '施工招标控制价', tender_construction_cost: '招标建安工程造价', candidate_bid_not_award: '候选报价，待正式定标' }
const scopeLabels: Record<string, string> = { epc_package: 'EPC标段', construction_lot: '施工标段', overall_project_investment: '整体项目投资', telecom_subproject: '通信分项' }
const areaLabels: Record<string, string> = { building_floor_area: '总建筑面积', renovation_site_area: '整体改造范围面积', existing_building_area: '现有建筑面积（待核对口径）', road_area: '道路作业面积', unknown: '面积口径待核实' }
const platformStatus: Record<string, string> = { public_api_and_html_verified: '已核验部分合同和招标公告，按项目逐项扩充。', linked_official_source: '通过主管部门原发公告及政府采购合同附件归档。', public_notice_verified_spa_api_unverified: '已归档部分项目估算，施工合同等原件由相关交易分平台补充。', public_contracts_verified: '已核验广州3个独立施工合同，金额和建筑面积来自同一官方公告。', housing_repair_results_verified: '新增4个住宅综合修缮施工中标项目，以明确项目与标段身份关联规模原件。' }
const number = (value: number) => value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
export default function ConstructionCostLibrary({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false), [q, setQ] = useState(''), [province, setProvince] = useState('')
  const [kind, setKind] = useState(''), [work, setWork] = useState('')
  const [area, setArea] = useState(''), [year, setYear] = useState('')
  const [loaded, setLoaded] = useState<{ key: string; result?: CostLibraryResult; error?: string }>({ key: '' })
  const [retry, setRetry] = useState(0)
  const params = new URLSearchParams({ ...(q.trim() ? { q: q.trim() } : {}), ...(province ? { province } : {}), ...(kind ? { amount_kind: kind } : {}), ...(work ? { work_type: work } : {}), ...(area ? { scale_basis: area } : {}), ...(/^\d{4}$/.test(year) ? { year } : {}) })
  const path = `/projects/${encodeURIComponent(projectId)}/construction-costs`, query = params.toString(), key = `${path}?${query}`
  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      api<CostLibraryResult>(key, undefined, controller.signal).then(result => { if (!controller.signal.aborted) setLoaded({ key, result }) }).catch(error => { if (!controller.signal.aborted) setLoaded({ key, error: error instanceof Error ? error.message : '读取历史造价失败。' }) })
    }, 180)
    return () => { clearTimeout(timer); controller.abort() }
  }, [open, key, retry])
  const current = loaded.key === key ? loaded : null
  const result = current?.result
  return <section className="construction-cost-library" aria-label="历史改造工程造价库">
    <button className="cost-library-toggle" type="button" aria-expanded={open} onClick={() => setOpen(value => !value)}><span><strong>历史改造工程造价库</strong><small>公开交易公告 · 按工程与价格阶段查阅</small></span><span aria-hidden="true">{open ? '收起 −' : '展开 +'}</span></button>
    {open && <div className="cost-library-body">
      <CostNeuralPreview />
      <p className="cost-library-note">浙江、上海、广东官方平台已归档样本，正在逐项补充。工程类型、价格阶段与面积口径分别记录；跨公告引用保留各自原件。候选报价待正式定标。</p>
      <div className="cost-library-filters">
        <label>关键词<input value={q} onChange={event => setQ(event.target.value)} placeholder="项目名称、标段或工程范围" maxLength={300}/></label>
        <label>省份<select value={province} onChange={event => setProvince(event.target.value)}><option value="">全部省份</option>{['浙江', '上海', '广东'].map(value => <option key={value}>{value}</option>)}</select></label>
        <label>价格阶段<select value={kind} onChange={event => setKind(event.target.value)}><option value="">全部阶段</option>{Object.entries(amountLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>工程类型<select value={work} onChange={event => setWork(event.target.value)}><option value="">全部类型</option>{Object.entries(workLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>面积口径<select value={area} onChange={event => setArea(event.target.value)}><option value="">全部口径</option>{Object.entries(areaLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>价格年份<input aria-label="价格年份" inputMode="numeric" value={year} onChange={event => setYear(event.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="全部年份，如2026"/></label>
      </div>
      {!current && <p role="status">正在读取已核验的造价原文…</p>}
      {current?.error && <p role="alert">{current.error} <button type="button" onClick={() => setRetry(value => value + 1)}>重试</button></p>}
      {result && <>
        <div className="cost-library-toolbar"><span>匹配 {result.summary.matched} 条 / 已入库 {result.summary.total} 条 · {result.summary.source_count} 份公告</span><a href={`/api${path}/export${query ? '?' + query : ''}`} download>导出当前筛选 CSV</a></div>
        <details className="cost-library-benchmark"><summary>同口径参考 · {result.benchmark.groups.length} 组</summary>
          <p>按城市、工程范围、价格阶段、面积口径和价格年份分组。数值为每平方米对应的工程金额，保留各项目施工内容差异。以下是组内描述性统计，尚未作跨年价格调整；没有预测区间。</p>
          {result.benchmark.groups.length ? <div className="cost-benchmark-groups">{result.benchmark.groups.map(group => <article key={group.id}>
            <strong>{group.dimensions.province} · {group.dimensions.city} · {group.dimensions.price_year}年</strong>
            <p>{workLabels[group.dimensions.work_type]} · {amountLabels[group.dimensions.amount_kind]} · {areaLabels[group.dimensions.scale_basis] || group.dimensions.scale_basis}</p>
            <small>{scopeLabels[group.dimensions.scope_family] || scopeLabels[group.dimensions.scope_level] || group.dimensions.scope_family} · {basisLabels[group.dimensions.amount_basis] || group.dimensions.amount_basis}</small>
            <dl><div><dt>最小值</dt><dd>{number(group.min_yuan_per_m2)}</dd></div><div><dt>中位数</dt><dd>{number(group.median_yuan_per_m2)}</dd></div><div><dt>最大值</dt><dd>{number(group.max_yuan_per_m2)}</dd></div></dl><small>单位：元/㎡ · {group.n_records}条记录，{group.n_projects}个项目{group.status === 'single_reference' ? ' · 单项目参考' : ''}</small>
            <details><summary>查看组内项目与范围</summary><ul>{group.item_ids.map(id => { const item = result.items.find(candidate => candidate.id === id); return <li key={id}>{item?.project_name || id}{item?.comparability_note && <small>{item.comparability_note}</small>}</li> })}</ul></details>
          </article>)}</div> : <p>当前筛选暂无口径、面积和价格时点均已核验的可比组。</p>}
          {!!result.benchmark.excluded.length && <details><summary>{result.benchmark.excluded.length}条金额记录暂未进入同口径参考</summary><ul>{result.benchmark.excluded.map(item => <li key={item.id}><strong>{result.items.find(record => record.id === item.id)?.project_name || item.id}</strong>：{item.reasons.join(' ')}</li>)}</ul></details>}
        </details>
        {!!result.summary.issues.length && <details className="cost-library-issues"><summary>有 {result.summary.issues.length} 项来源或记录待核验</summary><ul>{result.summary.issues.map((issue, index) => <li key={`${issue.id}:${index}`}>{issue.id}：{issue.detail}</li>)}</ul></details>}
        {result.items.length ? <div className="cost-library-table-wrap" tabIndex={0} aria-label="历史工程造价表，可横向滚动"><table><thead><tr><th>项目与标段</th><th>金额与阶段</th><th>工程范围</th><th>时间与原文</th></tr></thead><tbody>{result.items.map(item => <tr key={`${item.id}:${item.version}`}>
          <td><strong>{item.project_name}</strong><small>{item.province} · {item.city || '城市待核'} · {workLabels[item.work_type]}</small>{item.project_code && <small>项目代码：{item.project_code}</small>}{item.lot_id && <small>标段：{item.lot_id}</small>}</td>
          <td><strong>{(item.amount_yuan / 10000).toLocaleString('zh-CN', { maximumFractionDigits: 4 })} 万元</strong><small>{item.amount_yuan.toLocaleString('zh-CN', { maximumFractionDigits: 2 })} 元</small><span className="cost-kind">{amountLabels[item.amount_kind]}</span>{item.amount_basis && <small>{basisLabels[item.amount_basis] || item.amount_basis}</small>}</td>
          <td>{item.scope_level && <small>{scopeLabels[item.scope_level] || '已标注工程范围'}</small>}<p>{item.scope_quote || '工程范围待核实'}</p><small>{areaLabels[item.scale_basis || 'unknown'] || item.scale_basis}：{item.scale_value !== null ? `${item.scale_value.toLocaleString('zh-CN')} ${item.scale_unit}` : '待核实'}</small>{item.benchmark?.eligible && <strong>{number(item.benchmark.intensity_yuan_per_m2!)} 元/㎡</strong>}{item.comparability_note && <small>{item.comparability_note}</small>}</td>
          <td><small>公告 {item.notice_date || '日期待核实'}</small><small>价格日期 {item.benchmark?.price_date || '待核实'}</small><a href={item.source.url} target="_blank" rel="noreferrer">查看金额原件 ↗</a><details><summary>各字段原文与来源</summary><strong>金额原文</strong><blockquote>{item.amount_quote}</blockquote><small>{item.source.title}</small><small className="cost-source-hash">原件 SHA-256：{item.source.source_hash}</small>{item.scale_quote && <><strong>面积原文</strong><blockquote>{item.scale_quote}</blockquote><small>{item.scale_source_id && item.scale_source_id !== item.source_id ? '引用下方面积支撑公告' : '来自同一金额原件'}</small></>}{(item.evidence_sources || []).map(source => <div key={source.id}><a href={source.url} target="_blank" rel="noreferrer">{source.title} ↗</a><small>{[item.scale_source_id === source.id ? '面积来源' : '', item.scope_source_id === source.id ? '范围来源' : '', item.price_date_source_id === source.id ? '价格日期来源' : ''].filter(Boolean).join(' · ') || '关联支撑原件'}</small><small className="cost-source-hash">原件 SHA-256：{source.source_hash}</small></div>)}{!!item.field_issues?.length && <small>{item.field_issues.map(issue => issue.detail).join(' ')}</small>}</details></td>
        </tr>)}</tbody></table></div> : <p className="cost-library-empty">{result.summary.total ? '当前筛选没有匹配记录，可更换省份、价格阶段或关键词。' : '尚无通过原件校验的工程记录，归档清单就绪后展示。'}</p>}
        <div className="cost-library-platforms">{result.platforms.map(platform => <details key={platform.url}><summary><a href={platform.url} target="_blank" rel="noreferrer">{platform.name}</a></summary><p>{platformStatus[platform.status] || '按公告原件逐项归档，完整覆盖情况待核验。'}</p></details>)}</div>
      </>}
    </div>}
  </section>
}
