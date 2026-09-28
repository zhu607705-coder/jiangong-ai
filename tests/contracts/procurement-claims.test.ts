import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { groundMapAssessment } from '../../services/map-screening/analyst'
import { adaptOfficialSource } from '../../services/capabilities/adapters/public-records'
import { visibleText } from '../../services/capabilities/research'
import type { MapPreliminaryAssessment, MapScreenContext, Source } from '../../apps/host/generated/contracts'

const context={created_at:'2026-09-28T08:00:00Z',city:'杭州市',address:'浙江省杭州市西湖区',target:{label:'甲办公楼',label_origin:'public',object_ref:'amap:A'},groups:[],local_projects:[]} as unknown as MapScreenContext
const source=(text:string):Source=>({id:'S',title:'甲办公楼采购公告',url:'https://www.ccgp.gov.cn/fixture',data_class:'public',visibility:'public',synthetic:false,content_status:'full_text',published_at:'2026-09-20T00:00:00Z',date_status:'verified',untrusted_text:text,raw_hash:createHash('sha256').update(text).digest('hex')})
const brief=(summary:string):MapPreliminaryAssessment=>({summary,opportunities:[],cautions:[],unknowns:[],next_steps:[]})
const table=(deadline:string,id='P-ONE',extra='')=>`<table><tr><td>项目编号</td><td>${id}</td></tr><tr><td>项目名称</td><td>甲办公楼空调维护采购项目</td></tr><tr><td>响应文件提交截止时间</td><td>${deadline}</td></tr>${extra}</table>`
const field=(label:string,value:string)=>`<tr><td>${label}</td><td>${value}</td></tr>`
function entryEligibility(html:string){
  const original=source(html),records=adaptOfficialSource(original).records
  const parsed={...original,untrusted_text:visibleText(html,original.url!)}
  return {records,accepted:records.map(record=>groundMapAssessment({...brief('研究楼栋维护采购。'),dimension_evidence:[{key:'implementation',source_id:'S',record_id:record.id,quote:'甲办公楼空调维护采购项目',basis:'核查当前采购入口。'}]},context,[parsed],records).dimension_evidence!.length)}
}

describe('monetary claim ownership',()=>{
  const original=source('杭州市西湖区甲办公楼空调更新预算为120万元。')
  it.each(['甲办公楼空调更新预算为120万元。','甲办公楼预算为120万元。','预算为120万元。','本项目预算为120万元。'])(
    'keeps the supported current-object amount: %s',text=>expect(()=>groundMapAssessment(brief(text),context,[original])).not.toThrow(),
  )
  it.each([
    '甲办公楼旁的乙办公楼预算为120万元。',
    '甲办公楼与乙办公楼各预算120万元。',
    '本项目预算不足，乙办公楼预算为120万元。',
    '甲办公楼预算为120万元，乙办公楼预算为120万元。',
    '甲办公楼和乙办公楼分别预算120万元。',
  ])('does not move a real amount to a different claim owner: %s',text=>{
    expect(()=>groundMapAssessment(brief(text),context,[original])).toThrow('MAP_ASSESSMENT_UNGROUNDED_AMOUNT')
  })
})

describe('same procurement identity across actual adapter records',()=>{
  it.each([false,true])('keeps conflicting deadlines unresolved regardless of row order: reverse=%s',reverse=>{
    const rows=[table('2026年9月20日09:00:00'),table('2026年10月5日09:00:00')]
    const result=entryEligibility(`<html><body>${(reverse?rows.reverse():rows).join('')}</body></html>`)
    expect(result.records).toHaveLength(2)
    expect(result.accepted).toEqual([0,0])
  })
  it('does not let a record ID conceal contradictory future deadlines',()=>{
    expect(entryEligibility(table('2026年10月5日09:00:00')+table('2026年10月8日09:00:00')).accepted).toEqual([0,0])
  })
  it('keeps distinct procurement IDs and explicit lots independent',()=>{
    expect(entryEligibility(table('2026年9月20日09:00:00','P-A')+table('2026年10月5日09:00:00','P-B')).accepted).toEqual([0,1])
    expect(entryEligibility(table('2026年9月20日09:00:00','P-ONE',field('标段编号','LOT-A'))+table('2026年10月5日09:00:00','P-ONE',field('标段编号','LOT-B'))).accepted).toEqual([0,1])
  })
  it('honors an explicit, internally consistent before/after deadline correction',()=>{
    const corrected=`<table>${field('项目编号','P-ONE')}${field('项目名称','甲办公楼空调维护采购项目')}${field('更正前响应截止时间','2026年9月20日09:00:00')}${field('更正后响应截止时间','2026年10月5日09:00:00')}</table>`
    const result=entryEligibility(table('2026年9月20日09:00:00')+corrected)
    expect(result.records).toHaveLength(2)
    expect(result.records[1].fields.map(f=>f.key)).toContain('deadline_previous')
    expect(result.records[1].fields.map(f=>f.key)).toContain('deadline_corrected')
    expect(result.accepted[1]).toBe(1)
    expect(entryEligibility(table('2026年9月20日09:00:00')+corrected.replace('2026年10月5日09:00:00','2026年9月21日09:00:00')).accepted).toEqual([0,0])
  })
  it('rejects contradictory corrections, unknown replacement targets and correction cycles',()=>{
    const correction=(before:string,after:string)=>`<table>${field('项目编号','P-ONE')}${field('项目名称','甲办公楼空调维护采购项目')}${field('更正前响应截止时间',before)}${field('更正后响应截止时间',after)}</table>`
    const a='2026年9月20日09:00:00',b='2026年10月5日09:00:00',c='2026年10月8日09:00:00'
    for(const raw of [table(a)+correction(a,b)+correction(a,c),table(a)+correction(b,c),correction(a,b)+correction(b,a)])expect(entryEligibility(raw).accepted.every(value=>value===0)).toBe(true)
  })
})

describe('project location and actor-address roles',()=>{
  it.each([
    '甲办公楼本期采购空调维护服务，供应商地址：浙江省宁波市海曙区。',
    '甲办公楼位于杭州市西湖区；代理机构地址：上海市浦东新区。',
  ])('does not geolocate the project from a different actor: %s',quote=>{
    expect(groundMapAssessment({...brief('研究维护服务。'),dimension_evidence:[{key:'demand',source_id:'S',quote,basis:'本对象维护采购。'}]},context,[source(quote)]).dimension_evidence).toHaveLength(1)
  })
  it('still checks the project location when a supplier address is also present',()=>{
    const quote='甲办公楼，供应商地址：杭州市西湖区；项目地址：浙江省宁波市海曙区。'
    expect(groundMapAssessment({...brief('研究维护服务。'),dimension_evidence:[{key:'demand',source_id:'S',quote,basis:'本对象维护采购。'}]},context,[source(quote)]).dimension_evidence).toEqual([])
  })
})
