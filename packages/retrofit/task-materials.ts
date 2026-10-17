export type TaskMaterialLink={task_id:string;input_hash:string;direction?:'comprehensive'|'rebuild'|null}
export type TaskFieldObservation={field:string;value:string;locator:string;quote:string;representation:'parsed_table'|'original_text'|'source_bound_draft'}
export type TaskToolReceipt={tool:string;status:'completed'|'empty'|'ocr_required'|'not_requested'|'failed';detail:string;count?:number;duration_ms?:number}
export type TaskMaterialReceipt=TaskMaterialLink&{document_id:string;file_name:string;version:string;context_version:number;task_title:string;parse_status:string;observations:TaskFieldObservation[];tools:TaskToolReceipt[];created_at:string;updated_at:string;extraction:{status:'not_requested'|'completed'|'failed';model_calls:number|null;card_ids:string[];warnings:string[]}}
const metrics=/幸福|满意|问卷|答卷|样本|人数|人次|用餐|就餐|餐次|利用|使用|运行|次数|台数|住户|覆盖|收入|成本|支出|资金|预算|金额|面积|工程量|鉴定|结构|状况|结论|检验|合格|日期|月份|日期|单位|分母|satisfaction|wellbeing|usage|attendance|count|cost|amount/i
/** Read actual cells and literal labelled numbers. No inferred totals or population-wide percentages. */
export function extractTaskObservations(profile:unknown,text:string):TaskFieldObservation[]{
 const out:TaskFieldObservation[]=[],tables=(profile as {tables?:{rows?:{rowNumber:number;values:Record<string,unknown>}[]}[]})?.tables||[]
 for(const [tableIndex,table] of tables.entries())for(const row of table.rows||[]){
  const entries=Object.entries(row.values||{}),quote=JSON.stringify(row.values)
  for(const [field,value] of entries){if(out.length>=24)break;if(!metrics.test(field)||value===null||value===undefined||String(value).trim()==='')continue
   out.push({field,value:String(value),locator:`table:${tableIndex+1}/row:${row.rowNumber}`,quote,representation:'parsed_table'})
  }
  // Key/value sheets often name the first two columns 指标 and 数值.
  const label=entries.find(([key])=>/指标|项目|字段|名称/.test(key)),value=entries.find(([key])=>/^(?:数值|值|结果|统计值)$/.test(key))
  if(out.length<24&&label&&value&&value[1]!==null&&value[1]!==undefined&&String(value[1]).trim()&&metrics.test(String(label[1]))&&!out.some(item=>item.locator===`table:${tableIndex+1}/row:${row.rowNumber}`&&item.field===String(label[1])))out.push({field:String(label[1]),value:String(value[1]),locator:`table:${tableIndex+1}/row:${row.rowNumber}`,quote,representation:'parsed_table'})
 }
 for(const match of text.matchAll(/(幸福度|满意度|有效问卷(?:数)?|有效答卷(?:数)?|就餐人次|用餐人数|电梯运行台数|电梯使用次数|运营收入|运营成本|工程预算)\s*[:：]\s*([\d,.]+\s*(?:%|分|份|人次|人|次|台|万元|元)?)/g)){
  if(out.length>=24)break;out.push({field:match[1],value:match[2].trim(),locator:`text:chars:${match.index}-${match.index!+match[0].length}`,quote:match[0],representation:'original_text'})
 }
 return out
}
