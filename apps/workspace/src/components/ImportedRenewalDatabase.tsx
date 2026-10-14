import { useEffect, useMemo, useState } from 'react'
import './ImportedRenewalDatabase.css'

const amountLabels = { tender_budget: '招标预算', tender_ceiling: '招标控制价', winning_bid: '中标价', contract_price: '合同价', settlement: '结算价', total_investment: '总投资' }
type AmountKey = keyof typeof amountLabels
type HistoryRecord = {
  id: string; project_name: string; project_code: string | null; lot_id: string | null
  province: string | null; city: string | null; district: string | null; year: number | null
  amount_stage_original: string | null; amounts_yuan: Record<AmountKey, number | null>
  area: { building_floor: number | null; renovation_scope: number | null; site: number | null; other: number | null; other_basis_original: string | null }
  area_basis_original: string | null
  unit_cost_original: { denominator_m2: number | null; numerator_yuan: number | null; yuan_per_m2: number | null; comparability_note: string | null }
  work_type_original: string | null; renovation_scope_original: string | null
  households: number | null; buildings: number | null; duration_days: number | null
  award_notice_date: string | null; contract_date: string | null
  verification: { status_original: string | null; notes: string | null; review_status: string }
  source: { document_id: string; sha256: string; sheet: string; row: number; locator: string; amount_url: string | null; scale_url: string | null; contract_url: string | null; source_excerpt: string | null; scale_quote: string | null; source_platform_original: string | null }
  supplement: { fields_original: string | null; source_url: string | null; source_type_original: string | null; matching_original: string | null; quote: string | null }
  raw_fields: Record<string, string>
}
type HistoryDatabase = { snapshot_date: string; workbook_document_id: string; report_document_id: string; records: HistoryRecord[] }
type CorrectionReport = { text: string; statement: string }
const format = (value: number) => value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
const csvCell = (value: unknown) => {
  const text = String(value ?? '')
  return `"${(/^[=+\-@\t\r]/.test(text) ? "'" : '') + text.replaceAll('"', '""')}"`
}
function sourceLink(url: string | null, label: string) {
  return url && /^https?:\/\//i.test(url) ? <a href={url} target="_blank" rel="noreferrer">{label} ↗</a> : null
}

export default function ImportedRenewalDatabase() {
  const [open, setOpen] = useState(false)
  const [database, setDatabase] = useState<HistoryDatabase | null>(null)
  const [report, setReport] = useState<CorrectionReport | null>(null)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const [province, setProvince] = useState(''), [city, setCity] = useState(''), [stage, setStage] = useState(''), [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  useEffect(() => {
    if (!open || database) return
    let active = true
    setError('')
    Promise.all([
      import('../../../../data/imports/renewal-database-20261014/history-records.json'),
      import('../../../../data/imports/renewal-database-20261014/correction-report.json'),
    ]).then(([history, correction]) => {
      if (active) { setDatabase(history.default as HistoryDatabase); setReport(correction.default) }
    }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : '读取补全数据失败') })
    return () => { active = false }
  }, [open, database, retry])
  const records = database?.records || []
  const provinces = useMemo(() => [...new Set(records.map(record => record.province).filter((value): value is string => !!value))].sort(), [database])
  const cities = useMemo(() => [...new Set(records.filter(record => !province || record.province === province).map(record => record.city).filter((value): value is string => !!value))].sort(), [database, province])
  const matches = useMemo(() => {
    const words = query.trim().toLocaleLowerCase('zh-CN').split(/\s+/).filter(Boolean)
    return records.filter(record => (!province || record.province === province) && (!city || record.city === city) && (!stage || record.amounts_yuan[stage as AmountKey] !== null) && words.every(word => [record.id, record.project_name, record.project_code, record.lot_id, record.renovation_scope_original, record.district].join(' ').toLocaleLowerCase('zh-CN').includes(word)))
  }, [database, province, city, stage, query])
  const pages = Math.max(1, Math.ceil(matches.length / 25)), currentPage = Math.min(page, pages - 1)
  const rows = matches.slice(currentPage * 25, currentPage * 25 + 25)
  function exportCsv() {
    const fields = [...new Set(records.flatMap(record => Object.keys(record.raw_fields)))]
    const headings = [...fields, '导入原件定位', '导入审核状态', '状态来源']
    const csv = [headings.map(csvCell).join(','), ...matches.map(record => [...fields.map(field => record.raw_fields[field]), record.source.locator, record.verification.review_status, '提供方报告及工作簿声明'].map(csvCell).join(','))].join('\r\n')
    const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' })), link = document.createElement('a')
    link.href = url; link.download = `用户补全历史工程_20261014_${matches.length}条.csv`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return <section className="imported-renewal-database" aria-label="用户补全历史工程数据">
    <button className="imported-database-toggle" type="button" aria-expanded={open} onClick={() => setOpen(value => !value)}>
      <span><strong>用户补全数据 · 2026-10-14</strong><span>浙沪粤 1,277 条工程 · 补全工作簿与修正报告</span></span><span aria-hidden="true">{open ? '收起 −' : '展开 +'}</span>
    </button>
    {open && <div className="imported-database-body">
      {!database && !error && <p role="status">正在载入完整工程记录…</p>}
      {error && <p role="alert">{error} <button type="button" onClick={() => setRetry(value => value + 1)}>重试读取</button></p>}
      {database && <>
        <p className="imported-database-note">金额按预算、控制价、中标、合同及结算分别保留。核验状态来自提供方报告与工作簿；导入审核状态为待复核。面积按原口径展示，缺失字段保留“未记载”。</p>
        <div className="imported-database-stats">{provinces.map(value => <span key={value}><strong>{format(records.filter(record => record.province === value).length)}</strong>{value}</span>)}<span><strong>{format(records.filter(record => record.amounts_yuan.contract_price !== null).length)}</strong>有合同价</span><span><strong>{format(records.filter(record => record.amounts_yuan.settlement !== null).length)}</strong>有结算价</span></div>
        <details className="imported-database-report"><summary>查看核验与修正报告原文</summary><p>{report?.statement}</p><pre>{report?.text}</pre><p>报告材料：{database.report_document_id} · 工作簿：{database.workbook_document_id}</p></details>
        <div className="imported-database-filters">
          <label>补全库关键词<input value={query} onChange={event => { setQuery(event.target.value); setPage(0) }} placeholder="项目、标段、编号或改造内容" /></label>
          <label>补全库省份<select value={province} onChange={event => { setProvince(event.target.value); setCity(''); setPage(0) }}><option value="">全部省份</option>{provinces.map(value => <option key={value}>{value}</option>)}</select></label>
          <label>补全库城市<select value={city} onChange={event => { setCity(event.target.value); setPage(0) }}><option value="">全部城市</option>{cities.map(value => <option key={value}>{value}</option>)}</select></label>
          <label>补全库金额阶段<select value={stage} onChange={event => { setStage(event.target.value); setPage(0) }}><option value="">全部阶段</option>{Object.entries(amountLabels).map(([value, label]) => <option key={value} value={value}>含{label}</option>)}</select></label>
        </div>
        <div className="imported-database-toolbar"><span>匹配 {format(matches.length)} 条 / 已导入 {format(records.length)} 条 · 每页 25 条</span><button type="button" onClick={exportCsv} disabled={!matches.length}>导出补全库筛选 CSV</button></div>
        {rows.length ? <div className="imported-database-table" tabIndex={0} aria-label="用户补全工程表，可横向滚动"><table><thead><tr><th>项目与范围</th><th>分阶段金额</th><th>面积与规模</th><th>报告状态与来源</th></tr></thead><tbody>{rows.map(record => <tr key={record.id}>
          <td><strong>{record.project_name}</strong><span>{record.id} · {[record.province, record.city, record.district].filter(Boolean).join(' · ')}</span><span>{record.year ?? '年份未记载'} · {record.work_type_original || '发包模式未记载'}</span>{record.project_code && <span>项目编号：{record.project_code}</span>}{record.lot_id && <span>标段编号：{record.lot_id}</span>}<details><summary>改造范围</summary><p>{record.renovation_scope_original || '未记载'}</p></details></td>
          <td><span className="imported-database-stage">原金额阶段：{record.amount_stage_original || '未记载'}</span>{Object.entries(amountLabels).map(([key, label]) => <span className={stage === key ? 'is-selected-amount' : ''} key={key}>{label}：{record.amounts_yuan[key as AmountKey] === null ? '未记载' : `${format(record.amounts_yuan[key as AmountKey]! / 10000)} 万元`}</span>)}</td>
          <td><span>建筑面积：{record.area.building_floor === null ? '未记载' : `${format(record.area.building_floor)} ㎡`}</span><span>改造范围面积：{record.area.renovation_scope === null ? '未记载' : `${format(record.area.renovation_scope)} ㎡`}</span><span>用地面积：{record.area.site === null ? '未记载' : `${format(record.area.site)} ㎡`}</span>{record.area.other !== null && <span>其他面积：{format(record.area.other)} ㎡ · {record.area.other_basis_original || '口径未记载'}</span>}<span>单方面积口径：{record.area_basis_original || '未记载'}</span>{record.unit_cost_original.yuan_per_m2 !== null && <span>原表单方：{format(record.unit_cost_original.yuan_per_m2)} 元/㎡</span>}<span>户数 {record.households ?? '未记载'} · 楼栋 {record.buildings ?? '未记载'}</span>{record.unit_cost_original.comparability_note && <p>{record.unit_cost_original.comparability_note}</p>}</td>
          <td><strong className="imported-database-status">提供方：{record.verification.status_original || '未记载核验状态'}</strong><span>系统导入：待复核</span><span>{record.source.locator}</span><span>公告：{record.award_notice_date || '未记载'}<br/>签约：{record.contract_date || '未记载'}</span>{sourceLink(record.source.amount_url, '金额公告')}{sourceLink(record.source.scale_url, '规模公告')}{sourceLink(record.source.contract_url, '合同公告')}<details><summary>查看原文、补录与备注</summary><p>{record.source.source_platform_original}</p><strong>金额原文摘录</strong><blockquote>{record.source.source_excerpt || '未记载'}</blockquote><strong>规模原文</strong><blockquote>{record.source.scale_quote || '未记载'}</blockquote>{record.verification.notes && <p>{record.verification.notes}</p>}{record.supplement.quote && <><strong>补录原文</strong><blockquote>{record.supplement.quote}</blockquote><span>补录匹配：{record.supplement.matching_original || '未记载'}</span><p>{record.supplement.source_url}</p></>}<span>材料 ID：{record.source.document_id}</span><span>SHA-256：{record.source.sha256}</span></details></td>
        </tr>)}</tbody></table></div> : <p>没有匹配记录，可调整省市、金额阶段或关键词。</p>}
        <nav className="imported-database-pagination" aria-label="补全库分页"><button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>补全库上一页</button><span>第 {currentPage + 1} / {pages} 页</span><button type="button" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>补全库下一页</button></nav>
      </>}
    </div>}
  </section>
}
