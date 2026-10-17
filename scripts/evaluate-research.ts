import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {dirname} from 'node:path'
import {decisionMetrics,fitTemperature,type LabelledDecision} from '../packages/decision/evaluation'
import {resolveAnswerSlots} from '../packages/retrofit/research-coverage'
const output=process.argv[2]||'research/test_results/research-scientific-evaluation-20261017.json'
const labelled:LabelledDecision[]=process.argv[3]?JSON.parse(await readFile(process.argv[3],'utf8')):[]
const calibration=labelled.filter(row=>row.split==='calibration'),test=labelled.filter(row=>row.split==='test')
let replay:unknown=null
try{
 const frozen=JSON.parse(await readFile('.cache/frozen-public-evidence-20261017.json','utf8'))
 const sources=frozen.sources.map((source:any)=>({...source,text:source.untrusted_text,role:'reference',locator:source.locator||'source:captured'}))
 const coverage=resolveAnswerSlots('机电配套、雨棚、消防通道的金额、阶段与资金来源',sources)
 replay={scope:'Replay extraction on frozen actual public originals; not another provider request.',provider:frozen.provider,captured_at:frozen.captured_at,source_count:sources.length,field_count:coverage.slots.length,covered:coverage.slots.length-coverage.missing,slots:coverage.slots.map(({topic,field,status,answer,source_ids})=>({topic,field,status,answer,source_ids})),all_quotes_literal:coverage.slots.every(slot=>slot.quotes.every(quote=>sources.some((source:any)=>source.id===quote.source_id&&source.text.includes(quote.quote)))),cost_stage_records:coverage.money.map(({topic,amount_decimal,original_unit,amount_yuan,stage,price_year,funding_source,source_id})=>({topic,amount_decimal,original_unit,amount_yuan,stage,price_year,funding_source,source_id}))}
}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
const result={checked_at:new Date().toISOString(),calibration:fitTemperature(calibration,test.map(row=>row.object_id)),held_out_metrics:decisionMetrics(test),business_quality_status:test.length?'labelled_evaluation':'insufficient_independent_human_labels',frozen_source_replay:replay,evaluation_contract:{split_unit:'physical_object',time_isolation:'as_of_before_label_outcome',provider_confidence_is_label:false,comparison_axes:['provider_only_on_fixed_queries','pipeline_change_on_frozen_sources','decision_quality_on_held_out_objects'],no_enterprise_effect_claim:true}}
await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({calibration:result.calibration.status,business_quality:result.business_quality_status,replay}))
