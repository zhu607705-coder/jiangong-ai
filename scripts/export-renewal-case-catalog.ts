import {writeFile} from 'node:fs/promises'
import benchmarks from '../data/public_cases/renewal-mode-benchmarks-20261014.json'
import {expandCuratedCases} from '../packages/retrofit/case-matching'
const cases=expandCuratedCases(benchmarks.cases,'2026-10-17')
const markdown=['# 城市更新案例参考目录','',`版本：2026-10-17 · ${cases.length} 个公开案例。来源事实、可借鉴措施与迁移核对项分别保存；全部属于参考资料。`,'',...cases.flatMap(row=>[
 `## ${row.name}`,``, `- case_id: ${row.id}`,`- 城市：${row.city}`,`- 模式：${row.mode}`,`- 阶段：${row.reported_stage}`,`- 来源日期：${row.published_at}`,`- 来源：[${row.publisher} · ${row.source_title}](${row.url})`,'',...(row.source_quote?[`原文摘录：${row.source_quote}`,'']:[]),
 '### 已记载的量与范围','',...row.metrics.map(metric=>`- ${metric.label}：${metric.value} ${metric.unit}；${metric.scope}`),'', '### 可借鉴的具体做法','',...(row.interventions||[]).map(value=>'- '+value),'', `决策用途：${row.decision_use||row.comparison_note}`,'',`资金口径：${row.funding_note}`,'','### 迁移到当前项目时核对','',...(row.transfer_checks||[row.comparison_note]).map(value=>'- '+value),'',
])].join('\n')
await writeFile('data/public_cases/renewal-case-reference-catalog.md',markdown+'\n');console.log(JSON.stringify({cases:cases.length,output:'data/public_cases/renewal-case-reference-catalog.md'}))
