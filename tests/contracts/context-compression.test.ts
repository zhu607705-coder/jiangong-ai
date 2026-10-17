import {expect,it} from 'vitest'
import {compileRenewalResearchContext} from '../../runtime/workflows/renewal-research'
import {packEvidenceContext,mergeEvidenceWindows} from '../../packages/retrofit/evidence-compression'
import {sourceQuoteCandidates} from '../../services/map-screening/renewal-strategy'
import {strategyModelReferences,type StrategySource} from '../../packages/retrofit/strategy'
import type {RenewalResearchNote} from '../../apps/host/generated/contracts'

it('removes broad previews while retaining original quotes, money stages, remote negation and all expert reasoning',()=>{
 const source:StrategySource={id:'DOC-PRIVATE',title:'隔离测试资料',text:'未取得鉴定不得开工。预算100万元；中标95万元；资金尚未到账。\n'+'普通无关介绍。'.repeat(1000)+'\n对象😀的设施拟分段更新，尚未验收。',url:null,published_at:'2026-10-01',role:'current',locator:'paragraph:1',visibility:'internal',document_id:'DOCUMENT',document_version:'sha256:original',project_id:'P-TEST',data_class:'internal'}
 const quote='对象😀的设施拟分段更新，尚未验收。'
 const note:RenewalResearchNote={task_id:'engineering',summary:'两位专家可保留不同意见。',observations:[{source_id:source.id,quote,locator:'paragraph:2',inference:'不得把拟更新当作验收完成。'}],missing_data:['结构鉴定'],reasoned_proposals:[{kind:'scenario',premises:['未取得鉴定。'],assumptions:['假定保留结构'],conclusion:'条件成立时分段施工。',verification:'取得鉴定后复核。',evidence_refs:[source.id],parameters:[{name:'阶段费用',value:95,low:80,high:110,unit:'万元',basis:'情景参数，非已支付费用'}]}],investigation_requests:[{question_ids:['engineering'],missing_fields:['鉴定'],suggested_queries:['对象 鉴定'],domain_hints:[],affected_decisions:['范围']}]}
 const read={source_id:source.id,start_char:0,end_char:source.text.length,text:source.text}
 const result=compileRenewalResearchContext([source],[note],null,[],[read,read])
 expect(result.context.length).toBeLessThan(result.expanded*.7)
 expect(result.audit).toMatchObject({retention_ratio:1,omitted:[]})
 const retained=result.contextValue.evidence_windows
 for(const literal of ['未取得鉴定不得开工。','预算100万元；','中标95万元；','资金尚未到账。',quote])expect(retained.some(window=>window.text.includes(literal))).toBe(true)
 expect(retained.some(window=>window.text.includes('普通无关介绍。'.repeat(100)))).toBe(false)
 const compact=result.contextValue.untrusted_expert_notes[0],ref=compact.observations[0].quote_ref
 const restored={...compact,observations:compact.observations.map(({quote_ref,...row})=>({...row,quote:source.text.slice(quote_ref.start_char,quote_ref.end_char)}))}
 expect(restored).toEqual(note)
 expect(ref.end_char-ref.start_char).toBe(quote.length)
 expect(result.contextValue.source_catalog[0]).toMatchObject({document_version:'sha256:original',visibility:'internal',project_id:'P-TEST'})
 const refs=strategyModelReferences([source]),encoded=refs.encodeKnown(result.contextValue),packed=packEvidenceContext(encoded)
 expect(packed.evidence_windows.groups[0].source_id).toBe('s1')
 const candidates=sourceQuoteCandidates(refs.sources,[],encoded.evidence_windows)
 expect(candidates.length).toBeGreaterThan(0)
 for(const candidate of candidates){expect(candidate.quotes).toEqual([]);for(const range of candidate.quote_refs!)expect(encoded.evidence_windows.some(window=>window.start_char<=range.start_char&&window.end_char>=range.end_char)).toBe(true)}
})

it('never merges different sources or separated ranges into a fabricated continuous quote',()=>{
 const a:StrategySource={id:'A',title:'A',text:'预算100万元。中间不采用此方案。中标95万元。',role:'reference',locator:'a',url:null,published_at:null},b={...a,id:'B',text:'另一对象资金未到账。'}
 const window=(s:StrategySource,start:number,end:number)=>({source_id:s.id,start_char:start,end_char:end,text:s.text.slice(start,end)})
 const windows=mergeEvidenceWindows([a,b],[window(a,0,8),window(a,3,8),window(a,a.text.indexOf('中标'),a.text.length),window(b,0,b.text.length)])
 expect(windows).toHaveLength(3)
 expect(windows.filter(w=>w.source_id==='A')[0].end_char).toBeLessThan(windows.filter(w=>w.source_id==='A')[1].start_char)
 expect(()=>mergeEvidenceWindows([a],[{...window(a,0,8),text:'重写的原文'}])).toThrow('COMPRESSION_ORIGINAL_RANGE_MISMATCH')
})
