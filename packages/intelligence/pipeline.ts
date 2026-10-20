import { hash,canonical,structureOf,finishAnalysis,unscored,pairCompatible,type Entry,type Material,type Structure } from './domain'
import { reportText,lexicalSimilarity,sameOccurrence,storyForDevelopment,firmlyTied,RELATIONS,type Candidate,type Verdict } from '../../vendor/aihot/algorithms'
import { PROMPTS,PROMPT_VERSION,OUTPUT_SCHEMAS } from './prompts'
import type { IntelRepository,ReceiptResult } from './repository'
import {localOfficialStructure,localAnalysis} from './local-structure'
import {intelligenceDailyModelBudget} from './model-budget'
export type Judge=(stage:keyof typeof PROMPTS,input:unknown,schema:Record<string,unknown>,prompt:string,signal:AbortSignal,model?:string)=>Promise<ReceiptResult>
export async function analyzeMaterial(repo:IntelRepository,m:Material,judge:Judge,signal:AbortSignal,model:string,reviewModel?:string,dailyLimit=intelligenceDailyModelBudget(),routes:Partial<Record<keyof typeof PROMPTS,string>>={},threshold=65){
  if(!Number.isInteger(threshold)||threshold<0||threshold>100)throw new Error('INVALID_SELECTION_THRESHOLD')
  const call=async(stage:keyof typeof PROMPTS,input:unknown,slot:string=stage,useModel=routes[stage]||model)=>{
    signal.throwIfAborted()
    return (await repo.receipt(slot,`${m.id}@${m.version}`,{input,prompt:PROMPT_VERSION},useModel,()=>judge(stage,input,OUTPUT_SCHEMAS[stage],PROMPTS[stage],signal,useModel),dailyLimit)).value as Record<string,unknown>
  }
  const input={title:m.title,body:m.text,published_at:m.published_at}
  if(!m.text){await repo.analyze(m.id,m.version,{...unscored(m.title),issue:'MATERIAL_NOT_READ'});return}
  const pre=await call('prefilter',input)
  if(!['PASS','BLOCK','UNKNOWN'].includes(String(pre.label)))throw new Error('INVALID_PREFILTER_OUTPUT')
  if(pre.label==='BLOCK'){await repo.analyze(m.id,m.version,{...unscored(),status:'irrelevant',prefilter:'BLOCK',model,prompt_version:PROMPT_VERSION});return}
  const local=localOfficialStructure(m)
  if(local?.issue){signal.throwIfAborted();await repo.analyze(m.id,m.version,{...localAnalysis(local),prefilter:pre.label as 'PASS'|'UNKNOWN',model,prompt_version:PROMPT_VERSION});return}
  const extracted=local?.structure??await call('structure',input)
  let structure:Structure
  try {
    // The model sees both fields, and the publisher's title is also source text.
    structure=structureOf(extracted,m.title+'\n'+m.text)
  } catch(error) {
    const issue=error instanceof Error?error.message:''
    if(!['QUOTE_NOT_IN_SOURCE','OBJECT_ID_NOT_IN_QUOTE'].includes(issue))throw error
    // An ungrounded identity is a review item, never a scored opportunity.
    await repo.analyze(m.id,m.version,{...unscored(m.title),status:'needs_review',prefilter:pre.label as 'PASS'|'UNKNOWN',model,prompt_version:PROMPT_VERSION,issue})
    return
  }
  if(pre.label==='UNKNOWN'){
    signal.throwIfAborted()
    await repo.analyze(m.id,m.version,{...unscored(),status:'needs_review',prefilter:'UNKNOWN',structure,
      model,prompt_version:PROMPT_VERSION,issue:'PREFILTER_UNKNOWN'})
    return
  }
  const first=await call('score',input,'score-1'),second=await call('score',input,'score-2')
  const analysis=finishAnalysis(pre.label as 'PASS'|'UNKNOWN',structure,[Number(first.attentionScore),Number(second.attentionScore)],model,threshold)
  analysis.prompt_version=PROMPT_VERSION
  signal.throwIfAborted();await repo.analyze(m.id,m.version,analysis)
  // Recall is bounded, then compared to roots. Lexical similarity never authorizes merging.
  const pool=(await repo.entries(undefined,400)).entries.filter(e=>e.id!==m.id&&e.analysis.status==='ready'&&pairCompatible(structure,e.analysis.structure))
  const candidates=pool.map(e=>({entry:e,score:lexicalSimilarity(reportText(m.title,structure.summary),reportText(e.title,e.analysis.structure.summary))}))
    .filter(c=>c.score>=0.25).sort((a,b)=>b.score-a.score).slice(0,4)
  const views:Candidate[]=[],verdicts=new Map<string,Verdict>(),seen=new Set<string>()
  for(const c of candidates){
    if(seen.has(c.entry.event_id))continue;seen.add(c.entry.event_id)
    const root=c.entry.event_id===c.entry.story_id
    const pair={A:{title:m.title,structure},B:{title:c.entry.title,structure:c.entry.analysis.structure}}
    const result=await call('relate',pair,'relate-'+hash(canonical(pair)).slice(0,16))
    if(!RELATIONS.includes(result.relation as Verdict['relation'])||typeof result.confidence!=='number'||result.confidence<0||result.confidence>1)throw new Error('INVALID_RELATION_OUTPUT')
    const v:Verdict={relation:result.relation as Verdict['relation'],confidence:result.confidence,note:String(result.note??'').slice(0,300)}
    // A concrete object ID + matching occurrence date are required for automatic SAME_OCCURRENCE.
    const other=c.entry.analysis.structure
    const exact=!!structure.object_id&&structure.object_id===other.object_id&&!!structure.occurred_at&&structure.occurred_at===other.occurred_at&&structure.action===other.action
    if(v.relation==='SAME_OCCURRENCE'&&!exact){
      if(!reviewModel||reviewModel===model){v.relation='UNRELATED'}
      else{const review=await call('relate',pair,'review-'+hash(canonical(pair)).slice(0,16),reviewModel)
        if(review.relation!=='SAME_OCCURRENCE'||typeof review.confidence!=='number'||!Number.isFinite(review.confidence)||review.confidence<0.85||review.confidence>1)v.relation='UNRELATED'}
    }
    if(!firmlyTied(v.relation,v.confidence,0.85)&&v.relation!=='ROUNDUP')v.relation='UNRELATED'
    views.push({factId:c.entry.event_id,storyId:c.entry.story_id,storyRoot:root,score:c.score});verdicts.set(c.entry.event_id,v)
  }
  signal.throwIfAborted()
  const same=sameOccurrence(views,verdicts)[0],development=storyForDevelopment(views,verdicts)
  const own='EV-'+hash(m.id+'|'+m.version).slice(0,24)
  await repo.membership(m.id,m.version,same?.factId??own,same?.storyId??development?.storyId??own,same?'SAME_OCCURRENCE':development?'SAME_STORY':'UNRELATED')
}
