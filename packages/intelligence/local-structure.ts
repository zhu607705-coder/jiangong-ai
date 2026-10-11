import type {Source} from '../../apps/host/generated/contracts'
import {adaptOfficialSource} from '../../services/capabilities/adapters/public-records'
import {hash,emptyStructure,structureOf,unscored,type Analysis,type Material,type Structure} from './domain'

export const LOCAL_STRUCTURE_VERSION='official-template-v1'
export type LocalStructure={structure:Structure;issue:string|null}
/** Extract one explicitly identified official project. No fit/attention scores,
 * inferred location, occurrence date or automatic event merge are produced. */
export function localOfficialStructure(m:Material):LocalStructure|null{
  let url:URL
  try{url=new URL(m.url)}catch{return null}
  if(url.protocol!=='https:'||url.username||url.password||url.port||url.hostname!=='ggzy.zj.gov.cn'||!url.pathname.startsWith('/jyxxgk/002001/'))return null
  const s=m.source as unknown as Source
  if(s.data_class!=='public'||s.visibility!=='public'||s.synthetic!==false||s.content_status!=='full_text'
    ||s.body_truncated||s.records_truncated||s.date_status!=='verified'||!Number.isFinite(Date.parse(m.published_at||''))
    ||!s.id||!m.text||s.hash!==hash(m.text))return null
  const records=adaptOfficialSource({...s,title:m.title,untrusted_text:m.text}).records
  const rows=records.filter(r=>r.scope==='object'&&r.adapter==='procurement')
  if(!rows.length)return null
  const value=(key:string)=>rows.map(r=>r.fields.find(f=>f.key===key)?.value)
  const ids=new Set(value('project_id')),names=new Set(value('project_name'))
  if(ids.size!==1||names.size!==1)return null
  const id=[...ids][0],name=[...names][0]
  if(typeof id!=='string'||!/^\d{4}-\d{6}-\d{2}-\d{2}-\d{6}$/.test(id)
    ||typeof name!=='string'||!name.includes('老旧小区')||!m.text.includes(name))return null
  const index=m.text.indexOf(id);if(index<0)return null
  const stages=value('publication_stage'),stage=stages[0]
  const labels:Record<string,string>={candidate_notice:'中标候选人公示',award_notice:'中标结果公示',evaluation_notice:'定量评审结果公示',tender_notice:'招标公告'}
  const issue=!stage||stages.some(x=>x!==stage)||!labels[String(stage)]?'PUBLICATION_STAGE_CONFLICT':null
  const quote=m.text.slice(Math.max(0,index-50),index+id.length)
  const structure=structureOf({...emptyStructure(),category:'procurement',object:name,object_id:id,
    action:issue?null:labels[String(stage)],locator_quote:quote,summary:m.title.slice(0,500),
    tags:['老旧小区','官方定式',...(issue?[]:[labels[String(stage)]])]},m.title+'\n'+m.text)
  return {structure,issue}
}
export function localAnalysis(result:LocalStructure):Analysis{
  return {...unscored(),status:result.issue?'needs_review':'unscored',structure:result.structure,
    issue:result.issue||'CODE_STRUCTURED',prompt_version:LOCAL_STRUCTURE_VERSION}
}
