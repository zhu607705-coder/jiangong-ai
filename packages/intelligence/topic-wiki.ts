import {canonical,hash,type Entry} from './domain'
import {documentSlices} from '../experience/document-slices'
import {semanticWindows} from '../experience/semantic-index'
import {PROMPTS,OUTPUT_SCHEMAS} from './prompts'

export const TOPIC_POLICY='public-topic-wiki-v1'
import {TOPICS,topicOf,type TopicId} from './topic-catalog'
export {TOPICS,topicOf,type TopicId} from './topic-catalog'
export type WikiRef={source_id:string;version:string;quote:string;locator:string;start:number;end:number}
export type WikiClaim={kind:'finding'|'comparison'|'conflict'|'hypothesis';text:string;refs:WikiRef[]}
export type TopicSource={id:string;version:string;title:string;url:string;city:string;published_at:string|null;windows:{locator:string;text:string}[]}
export type TopicInput={policy:string;topic:typeof TOPICS[number];input_hash:string;sources:TopicSource[];matching_sources:number;scan_truncated:boolean;related_topics:TopicId[]}
export type TopicPage={topic_id:TopicId;input_hash:string;policy:string;created_at:string;model:string;claims:WikiClaim[];questions:string[];sources:Omit<TopicSource,'windows'>[];related_topics:TopicId[];matching_sources:number;scan_truncated:boolean;review_items:number}
export type TopicDetail={topic:typeof TOPICS[number];input_hash:string;matching_sources:number;selected_sources:number;scan_truncated:boolean;page:TopicPage|null;stale:boolean;job:{id:string;status:string;error:string|null}|null;history:{input_hash:string;created_at:string}[]}

export function publicWikiSource(entry:Entry){return entry.source.visibility==='public'&&entry.source.data_class==='public'&&!entry.source.synthetic&&entry.participation!=='signal_only'&&entry.source.content_status!=='metadata_only'&&!!entry.text.trim()}
function topicScore(entry:Entry,topic:typeof TOPICS[number]){return topic.terms.reduce((score,term)=>score+(entry.title.includes(term)?8:0)+(entry.text.includes(term)?1:0),0)}

/** The wiki is a compiled view of original versions, never a replacement original. */
export function topicInput(id:string,entries:Entry[],model:string,truncated=false):TopicInput{
  const topic=topicOf(id),pool=entries.filter(e=>publicWikiSource(e)&&topicScore(e,topic)>0)
  pool.sort((a,b)=>topicScore(b,topic)-topicScore(a,topic)||a.id.localeCompare(b.id))
  const sources=pool.slice(0,12).map(entry=>{
    const slices=documentSlices({file_name:'original.md',parser_result:{text:entry.text}})
    const windows=semanticWindows(slices.map(s=>({id:entry.id+'@'+entry.version+':'+s.locator,version:entry.version,text:s.text,locator:s.locator,file_name:entry.title})))
      .map(w=>({locator:w.locator,text:w.text,score:topic.terms.filter(term=>w.text.includes(term)).length}))
      .sort((a,b)=>b.score-a.score||a.locator.localeCompare(b.locator)).slice(0,3)
      .map(w=>({locator:w.locator,text:w.text.slice(0,1400)}))
    return {id:entry.id,version:entry.version,title:entry.title,url:entry.url,city:entry.city,published_at:entry.published_at,windows}
  })
  const related_topics=TOPICS.filter(t=>t.id!==topic.id&&pool.some(e=>topicScore(e,t)>0)).map(t=>t.id)
  const input_hash=hash(canonical({policy:TOPIC_POLICY,prompt:PROMPTS.topic,schema:OUTPUT_SCHEMAS.topic,topic,model,truncated,pool:pool.map(e=>[e.id,e.version,hash(e.text)]).sort(),sources}))
  return {policy:TOPIC_POLICY,topic,input_hash,sources,matching_sources:pool.length,scan_truncated:truncated,related_topics}
}

/** Invalid citations become follow-up work; independently supported claims remain usable. */
export function compileTopicPage(input:TopicInput,value:unknown,entries:Entry[],model:string,now=new Date()):TopicPage{
  const result=value as {claims?:unknown[];questions?:unknown[]},claims:WikiClaim[]=[],questions=(result?.questions||[]).filter((q):q is string=>typeof q==='string'&&q.trim().length>0).slice(0,12).map(q=>q.slice(0,600))
  const originals=new Map(entries.filter(publicWikiSource).map(e=>[e.id+'@'+e.version,e]));let review_items=0
  for(const raw of (result?.claims||[]).slice(0,18)){
    const row=raw as {kind?:string;text?:string;refs?:{source_id:string;version:string;quote:string}[]}
    if(!['finding','comparison','conflict','hypothesis'].includes(row.kind||'')||typeof row.text!=='string'||!row.text.trim())continue
    const refs:WikiRef[]=[]
    for(const ref of (row.refs||[]).slice(0,5)){
      const entry=originals.get(ref.source_id+'@'+ref.version),source=input.sources.find(s=>s.id===ref.source_id&&s.version===ref.version)
      if(!entry||!source||typeof ref.quote!=='string'||!ref.quote.trim()||!source.windows.some(w=>w.text.includes(ref.quote)))continue
      const start=entry.text.indexOf(ref.quote);if(start<0)continue
      refs.push({...ref,locator:'line:'+entry.text.slice(0,start).split(/\r?\n/).length,start,end:start+ref.quote.length})
    }
    if(!refs.length||(['comparison','conflict'].includes(row.kind!)&&new Set(refs.map(r=>r.source_id)).size<2)){
      review_items++;questions.push('核实材料后再采用：'+row.text.slice(0,350));continue
    }
    claims.push({kind:row.kind as WikiClaim['kind'],text:row.text.slice(0,1000),refs})
  }
  if(!input.sources.length)questions.push('先归集该主题的公开原文，再整理跨材料知识。')
  return {topic_id:input.topic.id,input_hash:input.input_hash,policy:TOPIC_POLICY,created_at:now.toISOString(),model,claims,questions:[...new Set(questions)].slice(0,18),sources:input.sources.map(({windows:_,...s})=>s),related_topics:input.related_topics,matching_sources:input.matching_sources,scan_truncated:input.scan_truncated,review_items}
}

export function topicMarkdown(page:TopicPage,relatedLink:(id:TopicId)=>string=id=>id+'.md'):string{
  const title=topicOf(page.topic_id).title,labels={finding:'跨材料结论',comparison:'案例差异',conflict:'材料分歧',hypothesis:'推理线索'}
  const rows=[`# ${title}`,'',`资料快照：${page.input_hash} · 更新于 ${page.created_at}`,'',`本版整理 ${page.sources.length} 份原文，当前匹配 ${page.matching_sources} 份${page.scan_truncated?'（检索窗口内）':''}。`,'']
  for(const kind of Object.keys(labels) as WikiClaim['kind'][]){const claims=page.claims.filter(c=>c.kind===kind);if(!claims.length)continue;rows.push('## '+labels[kind],'');for(const c of claims){rows.push('- '+c.text);for(const r of c.refs){const s=page.sources.find(s=>s.id===r.source_id&&s.version===r.version)!;rows.push(`  - [${s.title}](${s.url}) · ${r.locator} · 版本 ${r.version}`,`    > ${r.quote.replace(/\r?\n/g,'\n    > ')}`)}}rows.push('')}
  rows.push('## 下一步补充','',...page.questions.map(q=>'- '+q),'','## 相关主题','',...page.related_topics.map(id=>`- [${topicOf(id).title}](${relatedLink(id)})`),'')
  return rows.join('\n')
}
