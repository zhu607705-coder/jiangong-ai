/** Evaluation helpers operate on labelled held-out objects; provider confidence is never a truth label. */
export type LabelledDecision={object_id:string;split:'development'|'calibration'|'test';label:number;probabilities:number[];confidence?:number}
export function decisionMetrics(rows:readonly LabelledDecision[]){
  if(!rows.length)return {n:0,brier:null,log_loss:null,rps:null,accuracy:null,ece:null,objects:0}
  const valid=rows.filter(row=>row.probabilities.length>1&&row.label>=0&&row.label<row.probabilities.length&&row.probabilities.every(value=>Number.isFinite(value)&&value>=0&&value<=1)&&Math.abs(row.probabilities.reduce((a,b)=>a+b,0)-1)<.001)
  if(valid.length!==rows.length)throw new Error('EVALUATION_LABEL_OR_DISTRIBUTION_INVALID')
  const mean=(values:number[])=>values.reduce((a,b)=>a+b,0)/values.length
  const score=valid.map(row=>{const pred=row.probabilities.indexOf(Math.max(...row.probabilities));let cumulative=0,rps=0;row.probabilities.slice(0,-1).forEach((value,index)=>{cumulative+=value;rps+=(cumulative-(row.label<=index?1:0))**2});return {brier:row.probabilities.reduce((sum,value,index)=>sum+(value-(index===row.label?1:0))**2,0),log:-Math.log(Math.max(1e-12,row.probabilities[row.label])),rps:rps/(row.probabilities.length-1),correct:Number(pred===row.label),confidence:Math.max(...row.probabilities)}})
  let ece=0;for(let bin=0;bin<10;bin++){const items=score.filter(row=>Math.min(9,Math.floor(row.confidence*10))===bin);if(items.length)ece+=items.length/score.length*Math.abs(mean(items.map(row=>row.correct))-mean(items.map(row=>row.confidence)))}
  return {n:valid.length,objects:new Set(valid.map(row=>row.object_id)).size,brier:mean(score.map(row=>row.brier)),log_loss:mean(score.map(row=>row.log)),rps:mean(score.map(row=>row.rps)),accuracy:mean(score.map(row=>row.correct)),ece}
}
export function fitTemperature(rows:readonly LabelledDecision[],testObjectIds:readonly string[]=[]){
  if(rows.some(row=>row.split!=='calibration'||testObjectIds.includes(row.object_id)))throw new Error('CALIBRATION_SPLIT_LEAKAGE')
  if(new Set(rows.map(row=>row.object_id)).size<10)return {status:'insufficient_labels' as const,temperature:1,objects:new Set(rows.map(row=>row.object_id)).size}
  const scale=(p:number[],t:number)=>{const logits=p.map(value=>Math.log(Math.max(1e-12,value))/t),weights=logits.map(value=>Math.exp(value-Math.max(...logits))),sum=weights.reduce((a,b)=>a+b,0);return weights.map(value=>value/sum)}
  const candidates=[.5,.75,1,1.25,1.5,2,3,4].map(temperature=>({temperature,loss:decisionMetrics(rows.map(row=>({...row,probabilities:scale(row.probabilities,temperature)}))).log_loss!})).sort((a,b)=>a.loss-b.loss)
  return {status:'fitted' as const,temperature:candidates[0].temperature,objects:new Set(rows.map(row=>row.object_id)).size}
}
export function latencySummary(values:readonly number[]){const sorted=[...values].sort((a,b)=>a-b),q=(fraction:number)=>sorted.length?sorted[Math.max(0,Math.ceil(sorted.length*fraction)-1)]:null;return {n:sorted.length,p50_ms:q(.5),p95_ms:q(.95)}}
export function rankCoverage(eligible:readonly string[],scored:readonly string[],important:readonly string[],ranked:readonly string[],k=5){const selected=new Set(scored),top=new Set(ranked.slice(0,k));return {eligible:eligible.length,scored:scored.length,selection_recall:important.length?important.filter(id=>selected.has(id)).length/important.length:null,top_k_recall:important.length?important.filter(id=>top.has(id)).length/important.length:null,scope:'scored_subset'}}
export function investigationSensitivity(rows:{id:string;baseline_utility:number;possible_utilities:number[];acquisition_days:number;conflict?:boolean}[]){return rows.map(row=>({id:row.id,method:'scenario_range_per_acquisition_day',score:(Math.max(...row.possible_utilities,row.baseline_utility)-Math.min(...row.possible_utilities,row.baseline_utility))/(1+Math.max(0,row.acquisition_days))*(row.conflict?1.5:1),interpretation:'情景范围与获取成本的启发式优先级；未假定结果概率，不是期望信息价值。'})).sort((a,b)=>b.score-a.score)}
