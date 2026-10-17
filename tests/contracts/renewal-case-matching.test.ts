import {expect,it} from 'vitest'
import fixture from '../../fixtures/inputs/01_auto.json'
import {projectRenewalModeInput} from '../../packages/retrofit/renewal-mode'
import {rankRenewalCases,historyCases,rankHistory,selectCaseReferences,CASE_PRESETS,type CaseContext} from '../../packages/retrofit/case-matching'
import {renewalHistory} from '../../services/map-screening/renewal-history'
const input=()=>projectRenewalModeInput({...structuredClone(fixture),business_profile:'neighborhood',scope:{...fixture.scope,name:'杭州测试小区',city:'杭州市'}} as any)
const context=(topics:string[],city='杭州',direction?:'comprehensive'|'rebuild'):CaseContext=>({target:'测试对象',city,topics,households:null,as_of:'2026-10-17',direction})
it('expands to eleven cases with specific actions and separates the same source’s different physical objects',()=>{
 const cases=input().cases
 expect(cases).toHaveLength(11);expect(new Set(cases.map(row=>row.id)).size).toBe(11)
 expect(cases.filter(row=>row.directions?.includes('comprehensive')).length).toBeGreaterThan(5)
 expect(cases.find(row=>row.id==='CASE-CUIYUAN1-LIFT')?.metrics.find(row=>row.label==='已完成加梯')?.value).toBe(32)
 expect(cases.find(row=>row.id==='CASE-CUIYUAN3-REUSE')?.interventions?.join('')).toContain('25幢')
})
it('changes the selected precedent for elevator, dining operations and rebuilding finance',()=>{
 const cases=input().cases
 expect(rankRenewalCases(cases,context(['elevator'],'杭州','comprehensive'))[0].item.id).toBe('CASE-CUIYUAN1-LIFT')
 expect(rankRenewalCases(cases,context(['meals','operations'],'广州','comprehensive'))[0].item.id).toBe('CASE-LIWAN-MEALS')
 expect(rankRenewalCases(cases,{...context(['funding','residents'],'杭州','rebuild'),households:548})[0].item.id).toBe('MODE-ZHEGONG-20261012')
 expect(rankRenewalCases(cases,context(['elevator'],'杭州','comprehensive')).every(row=>!row.item.directions?.length||row.item.directions.includes('comprehensive'))).toBe(true)
})
it('keeps unknown comparison factors explicit and never replaces them with perfect fit',()=>{
 const result=rankRenewalCases(input().cases,context([],''))[0]
 expect(result.known_factors).toBe(1);expect(result.score).toBeLessThan(result.upper_score)
 expect(result.factors.find(row=>row.key==='scale')?.value).toBeNull()
 expect(()=>rankRenewalCases(input().cases,context([]),{weights:{issue:0,direction:0,region:0,evidence:0,scale:0}})).toThrow('CASE_WEIGHT_INVALID')
 expect(CASE_PRESETS).toHaveLength(3)
})
it('does not invent publication dates, settlement labels or independent mirrored sources',()=>{
 const mode=input();mode.history={snapshot_date:'2026-10-14',total:1,provinces:{},contract_count:0,settlement_count:0,official_costs:[],records:[{id:'R1',project_name:'电梯改造',city:'杭州',year:2025,work_type:'施工',amounts_yuan:{winning_bid:123400,settlement:null},locator:'sheet:1/row:2',document_id:'D1',review_status:'unreviewed',url:'https://www.zj.gov.cn/a'}]}
 const candidates=historyCases(mode.history);expect(candidates[0].published_at).toBe('');expect(candidates[0].metrics).toHaveLength(1)
 const selected=selectCaseReferences(mode);expect(selected.every(row=>row.item.kind!=='workbook')).toBe(true);expect(new Set(selected.map(row=>row.item.url)).size).toBe(selected.length)
})
it('ranks the complete imported pool by current project scope, not four fixed project names',async()=>{
 const mode=input();mode.matching_context=context(['pipe'],'丽水')
 const history=await renewalHistory({search:async()=>({items:[]})} as any,process.cwd(),mode)
 expect(history.total).toBe(1277);expect(history.records).toHaveLength(24)
 expect(history.records.some(row=>!/浙工新村|凤南一村|彭一小区|彭浦新村/.test(row.project_name))).toBe(true)
 expect(history.records.every(row=>row.review_status==='unreviewed')).toBe(true)
 const a=rankHistory([{project_name:'供水管网更新',city:'杭州',scope:'更换给水管网'},{project_name:'电梯更新',city:'上海',scope:'电梯设备'}],context(['elevator'],'上海'))
 expect(a[0].project_name).toBe('电梯更新')
})
