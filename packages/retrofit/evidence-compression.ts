import type {StrategySource} from './strategy'
type Window={source_id:string;start_char:number;end_char:number;text:string}
/** Union only overlapping/touching intervals of the same immutable source. Gaps stay separate. */
export function mergeEvidenceWindows(sources:readonly StrategySource[],windows:readonly Window[]):Window[]{
  const byId=new Map(sources.map(source=>[source.id,source]))
  for(const window of windows){const source=byId.get(window.source_id);if(!source||window.start_char<0||window.end_char>source.text.length||source.text.slice(window.start_char,window.end_char)!==window.text)throw new Error('COMPRESSION_ORIGINAL_RANGE_MISMATCH')}
  return sources.flatMap(source=>{
    const result:Window[]=[]
    for(const window of windows.filter(window=>window.source_id===source.id).sort((a,b)=>a.start_char-b.start_char||a.end_char-b.end_char)){
      const previous=result.at(-1)
      if(previous&&window.start_char<=previous.end_char){previous.end_char=Math.max(previous.end_char,window.end_char);previous.text=source.text.slice(previous.start_char,previous.end_char)}
      else result.push({...window})
    }
    return result
  })
}

/** Prompt representation only: every row is [UTF-16 start, literal text]; end = start + text.length. */
export function packEvidenceContext<T extends {evidence_windows:readonly Window[]}>(context:T){
  const groups:{source_id:string;rows:[number,string][]}[]=[]
  for(const window of context.evidence_windows){
    let group=groups.find(group=>group.source_id===window.source_id)
    if(!group){group={source_id:window.source_id,rows:[]};groups.push(group)}
    group.rows.push([window.start_char,window.text])
  }
  return {...context,evidence_windows:{columns:['start_char','text'] as const,groups}}
}

export function preserveCriticalWindows(sources:readonly StrategySource[],reads:readonly Window[],windows:readonly Window[],quotes:readonly {source_id:string;quote:string}[],limit=32000){
  const byId=new Map(sources.map(source=>[source.id,source])),result=mergeEvidenceWindows(sources,windows),critical:({kind:'amount_stage'|'negation_condition';window:Window})[]=[]
  const add=(source:StrategySource,start:number,end:number)=>{const text=source.text.slice(start,end);if(!text.trim())return;const kind=/\d[\d.,]*\s*(?:元|万元|亿元|户|幢|栋|台|㎡|平方米|%)/.test(text)?'amount_stage':/(?:尚未|没有|不得|不能|不含|未|只有|若|前提|除外|须|需先)/.test(text)?'negation_condition':null;if(kind&&!critical.some(atom=>atom.window.source_id===source.id&&atom.window.start_char===start&&atom.window.end_char===end))critical.push({kind,window:{source_id:source.id,start_char:start,end_char:end,text}})}
  for(const read of reads){const source=byId.get(read.source_id);if(!source)continue;let at=read.start_char;for(const sentence of read.text.split(/(?<=[。；\n])/)){add(source,at,at+sentence.length);at+=sentence.length}}
  for(const citation of quotes){const source=byId.get(citation.source_id);if(!source)continue;const index=source.text.indexOf(citation.quote);if(index<0)continue;const before=source.text.slice(0,index),start=Math.max(before.lastIndexOf('。'),before.lastIndexOf('\n'),before.lastIndexOf('；'))+1;const stops=['。','\n','；'].map(stop=>source.text.indexOf(stop,index+citation.quote.length)).filter(end=>end>=0);add(source,start,stops.length?Math.min(...stops)+1:source.text.length)}
  let used=result.reduce((sum,window)=>sum+window.text.length,0),deduplicated=0
  for(const atom of critical){
    if(result.some(window=>window.source_id===atom.window.source_id&&window.start_char<=atom.window.start_char&&window.end_char>=atom.window.end_char))continue
    const candidate=mergeEvidenceWindows(sources,[...result,atom.window]),size=candidate.reduce((sum,window)=>sum+window.text.length,0)
    if(size<=limit){deduplicated+=used+atom.window.text.length-size;result.splice(0,result.length,...candidate);used=size}
  }
  const omitted=critical.filter(atom=>!result.some(window=>window.source_id===atom.window.source_id&&window.start_char<=atom.window.start_char&&window.end_char>=atom.window.end_char)).map(atom=>atom.window),kept=critical.length-omitted.length
  return {windows:result,audit:{critical_fragments:critical.length,retained_critical_fragments:kept,retention_ratio:critical.length?kept/critical.length:1,omitted:omitted.map(({source_id,start_char,end_char})=>({source_id,start_char,end_char})),retained_chars:used,deduplicated_chars:deduplicated,semantic_claim:'literal_conditions_and_amounts_preserved_in_retained_ranges' as const}}
}
