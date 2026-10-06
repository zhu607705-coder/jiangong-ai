import {test,expect} from 'vitest'
import {analyzeMaterial,type Judge} from '../../packages/intelligence/pipeline'
import {emptyStructure,unscored,type Analysis,type Material} from '../../packages/intelligence/domain'
import type {IntelRepository} from '../../packages/intelligence/repository'
import {localOfficialStructure,localAnalysis} from '../../packages/intelligence/local-structure'
import {materialFromSource,evidenceSource} from '../../packages/intelligence/material'

// Contract fixtures only; real official originals are checked separately.
const material:Material={id:'contract',version:'a'.repeat(64),title:'模板资料',url:'https://example.org/contract',text:'模板原文',published_at:null,channel_id:'contract',city:'',publisher_group:'contract',source:{}}
function memory(){let saved:Analysis=unscored();const calls:string[]=[]
  const repo={receipt:async(stage:string,_subject:string,_input:unknown,_model:string,run:()=>Promise<unknown>)=>{calls.push(stage);return run()},analyze:async(_id:string,_version:string,value:Analysis)=>{saved=value},entries:async()=>{throw Error('UNKNOWN must not recall relation candidates')},membership:async()=>{throw Error('UNKNOWN must not merge events')}} as unknown as IntelRepository
  return {repo,calls,result:()=>saved}
}
const official=()=>materialFromSource({id:'CONTRACT-OFFICIAL',title:'合成老旧小区改造工程中标候选人公示',
  url:'https://ggzy.zj.gov.cn/jyxxgk/002001/contract-template.html',data_class:'public',visibility:'public',synthetic:false,
  content_status:'full_text',published_at:'2026-09-01',date_status:'verified',untrusted_text:'信息公开中标候选人公示\n项目名称：\n合成老旧小区改造工程\n项目代码：\n2604-330114-89-01-123456\n标段（包）编号：\nA3300000090000000001001'})
test('UNKNOWN retains grounded structure without scores or event merging',async()=>{
  const m=memory(),structure={...emptyStructure(),summary:'模板原文',locator_quote:'模板原文'}
  const judge:Judge=async(stage)=>({model:'contract',value:stage==='prefilter'?{label:'UNKNOWN'}:stage==='structure'?structure:{attentionScore:90}})
  await analyzeMaterial(m.repo,material,judge,new AbortController().signal,'contract')
  expect(m.calls).toEqual(['prefilter','structure'])
  expect(m.result()).toMatchObject({status:'needs_review',prefilter:'UNKNOWN',selected:false,score:null,scores:[],structure:{summary:'模板原文'}})
})
test('official template is code-structured without invented date, location or score',()=>{
  const result=localOfficialStructure(official())!;expect(result).not.toBeNull()
  expect(result.structure).toMatchObject({object_id:'2604-330114-89-01-123456',action:'中标候选人公示',city:null,occurred_at:null,dimensions:[]})
  expect(localAnalysis(result)).toMatchObject({status:'unscored',issue:'CODE_STRUCTURED',model:null,selected:false,score:null,scores:[]})
})
test('only the known complete public template can enter the code path',()=>{
  const m=official()
  for(const patch of [{url:'https://ggzy.zj.gov.cn.attacker.org/jyxxgk/002001/x'},{text:m.text+' changed'},
    {source:{...m.source,synthetic:true}},{source:{...m.source,visibility:'internal'}},{source:{...m.source,body_truncated:true}},
    {source:{...m.source,date_status:'conflict'}},{source:{...m.source,content_status:'metadata_only'}}])expect(localOfficialStructure({...m,...patch})).toBeNull()
})
test('official title/body stage conflict remains unscored and unmerged',async()=>{
  const m=official();m.title='合成老旧小区改造工程评分公示'
  const mem=memory(),judge:Judge=async()=>({model:'contract',value:{label:'PASS'}})
  await analyzeMaterial(mem.repo,m,judge,new AbortController().signal,'contract')
  expect(mem.calls).toEqual(['prefilter']);expect(mem.result()).toMatchObject({status:'needs_review',issue:'PUBLICATION_STAGE_CONFLICT',score:null,structure:{action:null}})
})
test('known official structure skips model extraction while retaining both independent scores',async()=>{
  const mem=memory();(mem.repo as any).entries=async()=>({entries:[],truncated:false});(mem.repo as any).membership=async()=>{}
  const judge:Judge=async(stage)=>({model:'contract',value:stage==='prefilter'?{label:'PASS'}:{attentionScore:80}})
  await analyzeMaterial(mem.repo,official(),judge,new AbortController().signal,'contract')
  expect(mem.calls).toEqual(['prefilter','score-1','score-2']);expect(mem.result().score).toBe(80)
})
test('original Source handoff retains template fields without creating facts or rewritten text',()=>{
  const m=official(),source=evidenceSource(m)!
  expect(source.untrusted_text).toBe(m.text);expect(source.hash).toBe(m.source.hash)
  expect(source.public_records).toHaveLength(1)
  expect(source.public_records![0].source_id).toBe(source.id)
  expect(source.public_records![0].fields.find(f=>f.key==='project_id')?.value).toBe('2604-330114-89-01-123456')
  expect(source).not.toHaveProperty('facts')
})
