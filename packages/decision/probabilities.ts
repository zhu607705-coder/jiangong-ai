// System One's live responses serialize probabilities to at least two decimals.
// Check whether a normalized distribution can exist within the reported rounding
// intervals, rather than treating the rounded sum or mean as exact.
const EPSILON=1e-9
/** Some System One answers omit zero-probability labels. Only close an already
 * unit-mass distribution over known options; missing nonzero mass is never invented. */
export function completeProbabilityMap(value:unknown,options:readonly string[]):Record<string,number>|null {
  if(!value||typeof value!=='object'||Array.isArray(value))return null
  const entries=Object.entries(value)
  if(!entries.length||entries.some(([key,p])=>!options.includes(key)||typeof p!=='number'||!Number.isFinite(p)||p<0||p>1))return null
  const missing=options.filter(key=>!Object.hasOwn(value,key))
  if(missing.length&&Math.abs(entries.reduce((sum,[,p])=>sum+Number(p),0)-1)>EPSILON)return null
  const dense=Object.fromEntries(options.map(key=>[key,(value as Record<string,number>)[key]??0]))
  return validProbabilityMass(Object.values(dense))?dense:null
}
function decimals(value:number):number {
  const [coefficient,exponent='0']=String(value).split('e')
  return Math.max(0,(coefficient.split('.')[1]?.length||0)-Number(exponent))
}
function bounds(values:readonly number[]) {
  if(!values.length||values.some(p=>!Number.isFinite(p)||p<0||p>1))return null
  const halfUnit=.5*10**-Math.max(2,...values.map(decimals))
  const intervals=values.map(p=>({low:Math.max(0,p-halfUnit),high:Math.min(1,p+halfUnit)}))
  if(intervals.reduce((sum,p)=>sum+p.low,0)>1+EPSILON||intervals.reduce((sum,p)=>sum+p.high,0)<1-EPSILON)return null
  return intervals
}
export function validProbabilityMass(values:readonly number[]):boolean {return bounds(values)!==null}
export function compatibleExpectedScore(score:number,values:readonly number[]):boolean {
  const intervals=bounds(values)
  if(!intervals||!Number.isFinite(score))return false
  const order=intervals.map((_,i)=>i)
  const extreme=(indices:number[])=>{
    let left=Math.max(0,1-intervals.reduce((sum,p)=>sum+p.low,0))
    let mean=intervals.reduce((sum,p,i)=>sum+i*p.low,0)
    for(const i of indices){const added=Math.min(left,intervals[i].high-intervals[i].low);mean+=i*added;left-=added}
    return mean
  }
  const scoreError=.5*10**-Math.max(2,decimals(score))+EPSILON
  return score+scoreError>=extreme(order)&&score-scoreError<=extreme([...order].reverse())
}
