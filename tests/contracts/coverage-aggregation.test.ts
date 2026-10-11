import { describe, expect, it } from 'vitest'
import { aggregateCoverageCells, type CoverageEvidence, type EvidenceCoverage } from '../../apps/workspace/src/imports/evidence-coverage'

const dimensions:EvidenceCoverage['dimensions']=[{key:'demand',label:'居民需求'},{key:'adaptation',label:'居住工程'}]
const objects:EvidenceCoverage['objects']=[{ref:'project:P',label:'项目',scope:'project'},{ref:'building:B1',label:'B1',scope:'object'},{ref:'building:B2',label:'B2',scope:'object'}]
const evidence=(id:string,overrides:Partial<CoverageEvidence>={}):CoverageEvidence=>({id,kind:'fact',sourceId:'S1',locator:'line:1',objectRefs:['building:B1'],dimension:'demand',value:true,unit:null,observedAt:'2026-09-01',publishedAt:'2026-09-01',version:'synthetic-v1',state:'clue',reason:'合成回归',...overrides})
// Small independent scan reference preserves the former observable contract.
const reference=(rows:CoverageEvidence[])=>objects.flatMap(object=>dimensions.map(dimension=>{
  const evidence=rows.filter(row=>row.state!=='unmatched'&&row.dimension===dimension.key&&row.objectRefs.includes(object.ref))
  return {objectRef:object.ref,dimension:dimension.key,state:evidence.some(row=>row.state==='locatable')?'locatable':evidence.length?'clue':'empty',evidence}
}))
describe('indexed coverage reduction',()=>{
  it('preserves shared scope, stable evidence ordering and state precedence',()=>{
    const rows=[evidence('A'),evidence('B',{objectRefs:['building:B1','building:B2','building:B1'],state:'locatable'}),evidence('C',{state:'unmatched'}),evidence('D',{dimension:'adaptation',value:false}),evidence('E',{dimension:null}),evidence('F',{objectRefs:['project:P']})]
    const before=structuredClone(rows)
    expect(aggregateCoverageCells(objects,dimensions,rows)).toEqual(reference(rows))
    expect(rows).toEqual(before)
  })
  it('matches the scan reference across deterministic mixed rows',()=>{
    for(let seed=0;seed<30;seed++){
      const rows=Array.from({length:40},(_,i)=>evidence(`F-${seed}-${i}`,{dimension:i%5?dimensions[(i+seed)%2].key:null,state:i%7===0?'unmatched':i%3===0?'locatable':'clue',objectRefs:i%4===0?['building:B1','building:B2']:[['project:P','building:B1','building:B2','foreign:X'][(i+seed)%4]]}))
      expect(aggregateCoverageCells(objects,dimensions,rows)).toEqual(reference(rows))
    }
  })
  it('keeps empty dimensions and objects empty without inventing evidence',()=>{
    expect(aggregateCoverageCells([],dimensions,[])).toEqual([])
    expect(aggregateCoverageCells(objects,[],[])).toEqual([])
    expect(aggregateCoverageCells(objects,dimensions,[])).toEqual(reference([]))
  })
})
