import { expect, test } from 'vitest'
import type { ActionChunk, ExperienceCard } from '../../apps/host/generated/contracts'
import { cardsForChunk, entriesForChunk } from '../../packages/experience/lineage'
const chunk:ActionChunk = {id:'chunk',document_id:'doc',document_version:'hash-1',measure_key:'pipe_network',object_ref:null,stage:'proposed',kind:'action',classification:'local',spans:[{document_id:'doc',version:'hash-1',locator:'page:2',quote:'拟更新二次供水管网，先安排入户调查。'}],text:'拟更新二次供水管网，先安排入户调查。',context_chunk_ids:[]}
const card = (id:string,document_id='doc',version='hash-1',locator='page:2',quote='拟更新二次供水管网'):ExperienceCard => ({id,stage:'proposed',fields:[{key:'proposal',value:quote,evidence:[{document_id,version,locator,quote}]}]} as ExperienceCard)
test('document, version, locator and literal quote all participate in an evidence link',()=>{
  const linked=card('correct')
  expect(cardsForChunk(chunk,[linked,card('wrong-doc','other'),card('wrong-version','doc','hash-2'),card('wrong-locator','doc','hash-1','page:3'),card('wrong-quote','doc','hash-1','page:2','已经完工'),card('empty','doc','hash-1','page:2','')])).toEqual([linked])
  expect(linked.fields[0].value).toBe('拟更新二次供水管网')
})
test('repeated evidence values share a display entry but retain all originating records and separate stages',()=>{
  const first=card('one'), second=card('two'), later=card('later'); later.stage='implemented'
  const entries=entriesForChunk(chunk,[first,second,later])
  expect(entries).toHaveLength(2)
  expect(entries[0].cardIds).toEqual(['one','two'])
  expect(entries[1]).toMatchObject({stage:'implemented',cardIds:['later']})
})
test('context chunks alone do not become cited evidence fields',()=>{
  const context=card('context','doc','hash-1','page:1','不相关')
  context.knowledge={chunks:[chunk]} as ExperienceCard['knowledge']
  expect(cardsForChunk(chunk,[context])).toEqual([])
})
