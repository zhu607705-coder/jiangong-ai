import evidenceSearch from '../../../../data/public_cases/renewal-evidence-search-20261015.json'
import type { RenewalModeInput } from '../../../../packages/retrofit/renewal-mode'

const selections = [
  { id: 'PUB-QS75-DRAFT-2024', stage: '单部电梯 · 草案估算', metrics: ['估算总投资'] },
  { id: 'PUB-HZ-OLD-2022-10', stage: '财政补助政策 · 非项目拨付', metrics: ['补助基数单价上限', '西湖区市级财政补助比例'] },
  { id: 'PUB-SH-QP-20240315', stage: '综合改造补贴控制标准', metrics: ['综合改造控制标准'] },
] as const

function metricValue(value: number, unit: string) {
  if (unit.includes('比例')) return `${(value * 100).toLocaleString('zh-CN')}%`
  if (unit === '元' && value >= 10000) return `${(value / 10000).toLocaleString('zh-CN', { maximumFractionDigits: 4 })} 万元`
  return `${value.toLocaleString('zh-CN')} ${unit}`
}

/** Already-read public evidence; these references do not create project conditions. */
export default function RenewalResearchEvidence({ input }: { input: RenewalModeInput }) {
  const isSubjectProject = !input.synthetic && input.object_ref === `project:${evidenceSearch.subject_project_id}`
  const selected = selections.flatMap(selection => {
    const record = evidenceSearch.records.find(row => row.source.id === selection.id)
    return record ? [{ ...selection, record }] : []
  })
  const local = selected.filter(row => row.id === 'PUB-QS75-DRAFT-2024' && isSubjectProject)
  const references = selected.filter(row => !local.includes(row))
  const method = evidenceSearch.records.find(row => row.source.id === 'PUB-NDRC-FEAS-2023')
  return <section className="renewal-research-evidence" aria-label="已查到的费用与资金依据">
    <h4>已查到的费用与资金依据</h4>
    <p className="renewal-research-date">已核公开原文 · 检索截至 {evidenceSearch.as_of}</p>
    {[{ title: '本项目局部包件原文', rows: local }, { title: '杭州政策与外地费用参考', rows: references }].filter(group => group.rows.length).map(group => <div className="renewal-research-group" key={group.title}>
      <h5>{group.title}</h5>
      {group.rows.map(({ record: { source, metadata }, stage, metrics }) => <article key={source.id}>
        <strong>{metadata.subject}</strong>
        <p className="renewal-research-scope">{metadata.region} · {source.published_at ? `${source.published_at.slice(0, 4)}年` : '来源日期待核'} · {stage}</p>
        <dl>{metrics.flatMap(name => { const metric = metadata.metrics.find(item => item.name === name); return metric ? [<div key={name}><dt>{metric.name}</dt><dd>{metricValue(metric.value, metric.unit)}<span>{metric.scope}</span></dd></div>] : [] })}</dl>
        {source.id === 'PUB-QS75-DRAFT-2024' && <p>草案列市区补助及自筹；金额仅对应75幢1单元一部电梯，后续概算、合同、验收和实际拨付继续追核。</p>}
        {source.id === 'PUB-HZ-OLD-2022-10' && <p>400元/平方米用于核定竣工财务决算补助基数，排除加装电梯、二次供水；50%为西湖区符合条件项目的市级补助比例。</p>}
        {source.id === 'PUB-SH-QP-20240315' && <p>520元/平方米为青浦方案采用的补贴控制单价，作为费用口径比较，杭州方案按本地工程量和政策核算。</p>}
        <a href={source.url} target="_blank" rel="noreferrer">{source.title} ↗</a>
        <small>原文定位：{source.locator}</small>
      </article>)}
    </div>)}
    {method && <p className="renewal-research-method">全周期比选已有方法依据：<a href={method.source.url} target="_blank" rel="noreferrer">2023年政府投资项目可研大纲 ↗</a>。下一步按相同楼幢、功能目标、价格年和比较期限，补齐修缮与重建两套建设、临迁、融资、运维及更换费用和服务效果。</p>}
    <p className="renewal-research-missing">本项目尚缺同口径修缮、重建两套全周期核算，以及本项目财政批复、居民分担、维修资金余额和拨付时点；以上原文分别提供局部估算、政策与比较方法。</p>
  </section>
}
