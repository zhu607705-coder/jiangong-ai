import { createHash } from 'node:crypto'
import { HttpFetchProvider } from '@deepseek-ai/dsh-web-fetch-http'
import { describe, expect, it } from 'vitest'
import { groundMapAssessment } from '../../services/map-screening/analyst'
import { adaptOfficialSource } from '../../services/capabilities/adapters/public-records'
import { dashboardQuestions } from '../../packages/decision/dashboard'
import { collectSelectedEvidence, visibleText } from '../../services/capabilities/research'
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
  it.each(['甲办公楼和乙办公楼','乙办公楼和甲办公楼'])('does not let an equivalent prose tail override the full structured owner: %s',owner=>{
    const html=`<html><body><table>${field('项目编号','P-JOINT')}${field('项目名称',owner)}${field('预算金额','120万元')}</table><p>${owner}预算为120万元。</p></body></html>`
    const original=source(html),records=adaptOfficialSource(original).records,parsed={...original,untrusted_text:visibleText(html,original.url!)}
    expect(parsed.untrusted_text).toContain(`${owner}预算为120万元。`)
    expect(()=>groundMapAssessment(brief('甲办公楼预算为120万元。'),context,[parsed],records)).toThrow('MAP_ASSESSMENT_UNGROUNDED_AMOUNT')
    expect(()=>groundMapAssessment(brief(`${owner}预算为120万元。`),context,[parsed],records)).not.toThrow()
    const result=groundMapAssessment({...brief('研究维护服务。'),dimension_evidence:[{key:'resources',source_id:'S',record_id:records[0].id,quote:owner,basis:'甲办公楼预算为120万元。'}]},context,[parsed],records)
    expect(result.dimension_evidence).toEqual([])
    for(const recordsToUse of [records,[]]){
      const evidenceSource=recordsToUse.length?parsed:source(`${owner}预算为120万元。`)
      for(const key of ['summary','next_steps','opportunities','cautions'] as const){
        const wrong=brief('研究维护服务。'),claim='甲办公楼预算为120万元。'
        if(key==='summary')wrong.summary=claim
        else if(key==='next_steps')wrong.next_steps=[claim]
        else wrong[key]=[{text:claim,evidence_refs:['S']}]
        expect(()=>groundMapAssessment(wrong,context,[evidenceSource],recordsToUse),key).toThrow('MAP_ASSESSMENT_UNGROUNDED_AMOUNT')
      }
      expect(()=>groundMapAssessment(brief(`${owner}预算为120万元。`),context,[evidenceSource],recordsToUse)).not.toThrow()
      for(const wrong of ['预算为120万元。','本项目预算为120万元。','甲办公楼预算为120元。','甲办公楼预算为180万元。']){
        expect(()=>groundMapAssessment(brief(wrong),context,[evidenceSource],recordsToUse)).toThrow('MAP_ASSESSMENT_UNGROUNDED_AMOUNT')
      }
    }
  })
  it('keeps complete literal quantitative claims without accepting a joint-owner tail',()=>{
    const text='乙办公楼和甲办公楼使用率为30%。'
    expect(()=>groundMapAssessment(brief(text),context,[source(text)])).not.toThrow()
    expect(()=>groundMapAssessment(brief('甲办公楼使用率为30%。'),context,[source(text)])).toThrow('MAP_ASSESSMENT_UNGROUNDED_AMOUNT')
    const single='甲办公楼使用率为30%。'
    expect(()=>groundMapAssessment(brief(single),context,[source(single)])).not.toThrow()
  })
  it.each(['/','＋','&'])('treats coordinated owner order symmetrically for %s',separator=>{
    for(const owner of [`甲办公楼${separator}乙办公楼改造`,`乙办公楼${separator}甲办公楼改造`]){
      const original=source(`<table>${field('项目编号','JOINT')}${field('项目名称',owner)}${field('预算金额','120万元')}</table>`),records=adaptOfficialSource(original).records
      const parsed={...original,untrusted_text:visibleText(original.untrusted_text!,original.url!)}
      expect(()=>groundMapAssessment(brief('甲办公楼预算为120万元。'),context,[parsed],records)).toThrow('MAP_ASSESSMENT_UNGROUNDED_AMOUNT')
      expect(()=>groundMapAssessment(brief(`${owner}预算为120万元。`),context,[parsed],records)).not.toThrow()
    }
  })
  it.each(['甲办公楼（含乙办公楼）改造','甲办公楼（包括乙办公楼）改造','甲办公楼连同乙办公楼改造'])('preserves an explicit inclusion scope in both prose and basis: %s',owner=>{
    const original=source(`<table>${field('项目编号','INCLUSION')}${field('项目名称',owner)}${field('预算金额','120万元')}</table>`),records=adaptOfficialSource(original).records
    const parsed={...original,untrusted_text:visibleText(original.untrusted_text!,original.url!)}
    expect(()=>groundMapAssessment(brief('甲办公楼预算为120万元。'),context,[parsed],records)).toThrow()
    expect(()=>groundMapAssessment(brief(`${owner}预算为120万元。`),context,[parsed],records)).not.toThrow()
    const amount=records[0].fields.find(f=>f.key==='budget')!
    const result=groundMapAssessment({...brief('研究楼栋维护服务。'),dimension_evidence:[{key:'resources',source_id:'S',record_id:records[0].id,quote:owner,basis:'甲办公楼预算为120万元。'}]},context,[parsed],records)
    expect(amount.value).toBe(120)
    expect(result.dimension_evidence).toEqual([])
  })
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
  it('keeps a joint budget on its full owner rather than assigning it to one building',()=>{
    const html=`<table>${field('项目编号','JOINT')}${field('项目名称','甲办公楼与乙办公楼联合改造')}${field('预算金额','120万元')}</table>`
    const original=source(html),records=adaptOfficialSource(original).records,parsed={...original,untrusted_text:visibleText(html,original.url!)}
    for(const text of ['甲办公楼预算为120万元。','预算为120万元。','本项目预算为120万元。'])expect(()=>groundMapAssessment(brief(text),context,[parsed],records)).toThrow('MAP_ASSESSMENT_UNGROUNDED_AMOUNT')
    expect(()=>groundMapAssessment(brief('甲办公楼与乙办公楼联合改造预算为120万元。'),context,[parsed],records)).not.toThrow()
    expect(()=>groundMapAssessment(brief('甲办公楼与乙办公楼各预算120万元。'),context,[parsed],records)).toThrow()
  })
  it('does not erase a lot or a stated cost component when paraphrasing its amount',()=>{
    const html=`<table>${field('项目编号','P-LOT')}${field('项目名称','甲办公楼改造A标段')}${field('标段编号','A')}${field('预算金额','120万元')}</table>`
    const original=source(html),records=adaptOfficialSource(original).records,parsed={...original,untrusted_text:visibleText(html,original.url!)}
    expect(()=>groundMapAssessment(brief('甲办公楼预算为120万元。'),context,[parsed],records)).toThrow()
    expect(()=>groundMapAssessment(brief('甲办公楼改造A标段预算为120万元。'),context,[parsed],records)).not.toThrow()
    const sub=source('甲办公楼电梯分项预算为120万元。')
    expect(()=>groundMapAssessment(brief('甲办公楼预算为120万元。'),context,[sub])).toThrow()
    expect(()=>groundMapAssessment(brief('甲办公楼电梯分项预算为120万元。'),context,[sub])).not.toThrow()
  })
  it.each(['甲办公楼、乙办公楼联合改造','乙办公楼、甲办公楼联合改造'])('preserves the full owner when a joint name uses list punctuation: %s',owner=>{
    const original=source(`<table>${field('项目编号','JOINT')}${field('项目名称',owner)}${field('预算金额','120万元')}</table>`),records=adaptOfficialSource(original).records
    const parsed={...original,untrusted_text:visibleText(original.untrusted_text!,original.url!)}
    expect(()=>groundMapAssessment(brief('甲办公楼预算为120万元。'),context,[parsed],records)).toThrow()
    expect(()=>groundMapAssessment(brief(`${owner}预算为120万元。`),context,[parsed],records)).not.toThrow()
  })
  it.each([[150,120,'万元',false],[120,120,'万元',true],[120,120,'元',false]] as const)('does not borrow a neighbouring row through flattened table text: %s/%s %s', (own,other,unit,valid)=>{
    const original=source(`<table>${field('项目编号','P-A')}${field('项目名称','甲办公楼改造')}${field('预算金额',own+unit)}</table><table>${field('项目编号','P-B')}${field('项目名称','乙办公楼改造')}${field('预算金额',other+'万元')}</table>`),records=adaptOfficialSource(original).records
    const parsed={...original,untrusted_text:visibleText(original.untrusted_text!,original.url!)}
    const run=()=>groundMapAssessment(brief('甲办公楼预算为120万元。'),context,[parsed],records)
    if(valid)expect(run).not.toThrow();else expect(run).toThrow('MAP_ASSESSMENT_UNGROUNDED_AMOUNT')
  })
})

describe('the target is the claim object, not just a geographical reference',()=>{
  it.each([
    '甲办公楼只是乙办公楼维保项目的开标地点。',
    '甲办公楼作为乙办公楼维保采购的开标场地。',
    '甲办公楼为乙办公楼维保采购提供开标场地。',
    '乙办公楼的维保项目在甲办公楼进行开标。',
    '乙办公楼维保项目开标地点设在甲办公楼。',
  ])('binds an event venue to its proposal and dimension, including actual records: %s',quote=>{
    const html=`<html><body><table>${field('项目编号','VENUE')}${field('项目名称',quote)}</table></body></html>`
    const raw=source(html),records=adaptOfficialSource(raw).records,parsed={...raw,untrusted_text:visibleText(html,raw.url!)}
    expect(records).toHaveLength(1)
    for(const structured of [false,true]){
      const sources=structured?[parsed]:[source(quote)],record_id=structured?records[0].id:undefined
      const evaluate=(summary:string,key:'demand'|'implementation'|'resources',basis:string)=>groundMapAssessment({...brief(summary),dimension_evidence:[{key,source_id:'S',record_id,quote,basis}]},context,sources,structured?records:[])
      const wrong=evaluate('研究甲办公楼设备维护。','demand','甲办公楼存在设备维护采购需求。')
      expect(wrong.dimension_evidence).toEqual([])
      expect(dashboardQuestions({purpose:wrong.summary,evidence:wrong.dimension_evidence!})).toEqual({})
      const meeting=evaluate('研究甲办公楼会务服务。','demand','开标活动提供了本楼会务场地使用线索。')
      expect(meeting.dimension_evidence).toHaveLength(1)
      expect(Object.keys(dashboardQuestions({purpose:meeting.summary,evidence:meeting.dimension_evidence!}))).toEqual(['fit_demand'])
      for(const key of ['implementation','resources'] as const)expect(evaluate('研究甲办公楼会务服务。',key,'开标活动提供了本楼会务场地使用线索。').dimension_evidence).toEqual([])
      expect(evaluate('研究甲办公楼会务服务。','demand','甲办公楼存在设备维护采购需求。').dimension_evidence).toEqual([])
    }
  })
  it.each([
    '乙办公楼（紧邻甲办公楼）本期采购设备维护服务。',
    '乙办公楼的维保项目在甲办公楼进行开标。',
    '乙办公楼的维保项目开标地点：甲办公楼。',
  ])('rejects reference-only and tender-venue mentions: %s',quote=>{
    const result=groundMapAssessment({...brief('研究楼栋维护服务。'),dimension_evidence:[{key:'demand',source_id:'S',quote,basis:'当前楼栋维护需求。'}]},context,[source(quote)])
    expect(result.dimension_evidence).toEqual([])
    expect(dashboardQuestions({purpose:result.summary,evidence:result.dimension_evidence!})).toEqual({})
  })
  it('checks the same object-role boundary on actual adapter project names',()=>{
    const subject='乙办公楼（紧邻甲办公楼）设备维护采购项目',original=source(`<table>${field('项目编号','OTHER')}${field('项目名称',subject)}${field('预算金额','120万元')}</table>`)
    const records=adaptOfficialSource(original).records,parsed={...original,untrusted_text:visibleText(original.untrusted_text!,original.url!)}
    const result=groundMapAssessment({...brief('研究楼栋维护服务。'),dimension_evidence:[{key:'demand',source_id:'S',record_id:records[0].id,quote:subject,basis:'当前楼栋维护需求。'}]},context,[parsed],records)
    expect(result.dimension_evidence).toEqual([])
  })
  it.each([
    ['甲办公楼本期采购设备维护服务。',true],
    ['甲办公楼目前没有新增采购需求。',true],
    ['乙办公楼旁的甲办公楼本期采购设备维护服务。',true],
    ['与乙办公楼相比，甲办公楼更需要设备维护。',true],
    ['甲办公楼旁的乙办公楼本期采购设备维护服务。',false],
    ['与甲办公楼相邻的乙办公楼本期采购设备维护服务。',false],
    ['甲办公楼正常运营。乙办公楼本期采购设备维护服务。',false],
    ['与甲办公楼相比，乙办公楼本期采购设备维护服务。',false],
  ])('checks the scoring request, preserving positive and negative own claims: %s',(quote,accepted)=>{
    const result=groundMapAssessment({...brief('研究楼栋维护服务。'),dimension_evidence:[{key:'demand',source_id:'S',quote:quote as string,basis:'核对该楼维护需求。'}]},context,[source(quote as string)])
    expect(result.dimension_evidence).toHaveLength(accepted?1:0)
    expect(Object.hasOwn(dashboardQuestions({purpose:result.summary,evidence:result.dimension_evidence!}),'fit_demand')).toBe(accepted)
  })
})

describe('actual DSH body completeness before record normalization',()=>{
  const html='<html><head><meta name="PubDate" content="2026-09-20"></head><body>'+table('2026年10月5日09:00:00')+'<!--'+'x'.repeat(81000)+'-->'+table('2026年9月20日09:00:00')+'</body></html>'
  it('allows a complete long excerpt and an independent complete detail while preserving partial-source demand',async()=>{
    const positive=html.replace('2026年9月20日09:00:00','2026年10月5日09:00:00')
    const research=await collectSelectedEvidence({name:'甲办公楼',purpose:'维护采购',asOf:context.created_at},new AbortController().signal,undefined,{
      search:async()=>({sources:['partial','complete'].map(key=>({url:`https://www.ccgp.gov.cn/${key}`,title:'甲办公楼采购公告',publishedAt:'2026-09-20'}))}),
      fetch:async({url},signal)=>{
        const provider:any=new HttpFetchProvider({maxBodyChars:url.endsWith('partial')?80000:200000,maxResponseBytes:2_000_000,timeoutMs:15000,maxRedirects:2,userAgent:'fixture'})
        return provider.readBody(new Response(positive,{headers:{'content-type':'text/html; charset=utf-8'}}),new URL(url),signal)
      },
    })
    for(const source of research.sources){
      expect(source.content_status).toBe('excerpt')
      const record=research.records.find(record=>record.source_id===source.id)!
      for(const key of ['implementation','demand'] as const){
        const result=groundMapAssessment({...brief('研究维护采购。'),dimension_evidence:[{key,source_id:source.id,record_id:record.id,quote:record.subject,basis:'原文采购线索。'}]},context,research.sources,research.records)
        expect(result.dimension_evidence).toHaveLength(key==='implementation'&&source.body_truncated?0:1)
      }
    }
  })
  it.each([
    {name:'complete body, display excerpt',maxBodyChars:200000,maxResponseBytes:2_000_000,truncated:false},
    {name:'character cap',maxBodyChars:80000,maxResponseBytes:2_000_000,truncated:true},
    {name:'byte cap',maxBodyChars:200000,maxResponseBytes:80000,truncated:true},
  ])('keeps current entry unconfirmed under $name',async({maxBodyChars,maxResponseBytes,truncated})=>{
    const provider:any=new HttpFetchProvider({maxBodyChars,maxResponseBytes,timeoutMs:15000,maxRedirects:2,userAgent:'fixture'})
    let bodyTruncated=false
    const research=await collectSelectedEvidence({name:'甲办公楼',purpose:'维护采购',asOf:context.created_at},new AbortController().signal,undefined,{
      search:async()=>({sources:[{url:'https://www.ccgp.gov.cn/body-fixture',title:'甲办公楼采购公告',publishedAt:'2026-09-20'}]}),
      fetch:async({url},signal)=>{const result=await provider.readBody(new Response(html,{headers:{'content-type':'text/html; charset=utf-8'}}),new URL(url),signal);bodyTruncated=result.truncated;return result},
    })
    expect(bodyTruncated).toBe(truncated)
    expect(research.sources[0].content_status).toBe('excerpt')
    const record=research.records[0]
    expect(record.fields.find(f=>f.key==='deadline_resolved')?.value).toBeNull()
    const result=groundMapAssessment({...brief('研究维护采购。'),dimension_evidence:[{key:'implementation',source_id:record.source_id,record_id:record.id,quote:record.subject,basis:'当前采购入口。'}]},context,research.sources,research.records)
    expect(result.dimension_evidence).toEqual([])
    if(truncated){expect(research.trace.status).toBe('partial');expect(research.trace.warnings.some(w=>w.includes('BODY_TRUNCATED'))).toBe(true)}
  })
})

describe('same procurement identity across actual adapter records',()=>{
  it.each([49,50,51])('keeps the target conflict when unrelated rows move the counterexample to position %s',position=>{
    const filler=Array.from({length:position-2},(_,i)=>table('2026年10月8日09:00:00',`OTHER-${i}`).replaceAll('甲办公楼空调维护采购项目',`其他办公楼${i}维护项目`)).join('')
    for(const [first,last] of [['2026年10月5日09:00:00','2026年9月20日09:00:00'],['2026年9月20日09:00:00','2026年10月5日09:00:00']]){
      const result=entryEligibility(table(first)+filler+table(last))
      expect(result.records.length).toBeLessThanOrEqual(50)
      expect(result.accepted[0]).toBe(0)
    }
  })
  it('does not treat records omitted by the aggregate budget as a source with no deadline',async()=>{
    const pages={
      a:Array.from({length:50},(_,i)=>table('2026年10月5日09:00:00',`P-A-${i}`)).join(''),
      b:Array.from({length:50},(_,i)=>table('2026年10月5日09:00:00',`P-B-${i}`)).join(''),
      c:table('2026年9月20日09:00:00'),
    }
    const research=await collectSelectedEvidence({name:'甲办公楼',purpose:'楼栋维护',asOf:context.created_at},new AbortController().signal,undefined,{
      search:async()=>({sources:Object.keys(pages).map(key=>({url:`https://www.ccgp.gov.cn/${key}`,title:'甲办公楼采购公告',publishedAt:'2026-09-20'}))}),
      fetch:async({url})=>({statusCode:200,body:{kind:'html',content:`<html><head><meta name="PubDate" content="2026-09-20"></head><body>${pages[url.at(-1) as keyof typeof pages]}</body></html>`}}),
    })
    const omitted=research.sources.find(source=>source.url!.endsWith('/c'))!
    expect(research.records).toHaveLength(100)
    expect(research.records.some(record=>record.source_id===omitted.id)).toBe(false)
    expect(research.receipts.find(receipt=>receipt.source_id===omitted.id)?.status).toBe('truncated')
    const result=groundMapAssessment({...brief('研究楼栋维护采购。'),dimension_evidence:[{key:'implementation',source_id:omitted.id,quote:'甲办公楼空调维护采购项目',basis:'核查当前采购入口。'}]},context,research.sources,research.records)
    expect(result.dimension_evidence).toEqual([])
  })
  it('retains a same-identity contradiction beyond the per-source record limit',()=>{
    const rows=Array.from({length:50},(_,i)=>table('2026年10月5日09:00:00','P-ONE',field('采购单位',`采购单位${i}`)))
    const result=entryEligibility(rows.join('')+table('2026年9月20日09:00:00'))
    expect(result.records).toHaveLength(50)
    expect(result.accepted.every(value=>value===0)).toBe(true)
  })
  it('keeps an unrelated truncated record from invalidating a complete target identity',()=>{
    const rows=Array.from({length:50},(_,i)=>table('2026年10月5日09:00:00',`P-${i}`))
    const result=entryEligibility(rows.join('')+table('2026年9月20日09:00:00','P-OTHER'))
    expect(result.records).toHaveLength(50)
    expect(result.accepted.every(value=>value===1)).toBe(true)
  })
  it.each([true,false])('keeps an explicit correction beyond the cap: currently open=%s',open=>{
    const old='2026年10月5日09:00:00',current=open?'2026年10月8日09:00:00':'2026年9月20日09:00:00'
    const rows=Array.from({length:50},(_,i)=>table(old,'P-ONE',field('采购单位',`采购单位${i}`)))
    const correction=`<table>${field('项目编号','P-ONE')}${field('项目名称','甲办公楼空调维护采购项目')}${field('更正前响应截止时间',old)}${field('更正后响应截止时间',current)}</table>`
    const result=entryEligibility(rows.join('')+correction)
    expect(result.records).toHaveLength(50)
    expect(result.accepted.every(value=>value===Number(open))).toBe(true)
    if(open)expect(result.records[0].fields.find(f=>f.key==='deadline_resolved')?.raw).toBe(current)
  })
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
