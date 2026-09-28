import {describe,it,expect,vi} from 'vitest'
import type {Source} from '../../apps/host/generated/contracts'
import {adaptLandchina,adaptConstruction,adaptStatistics,adaptOfficialSource,adaptProcurement} from '../../services/capabilities/adapters/public-records'
import {collectSelectedEvidence,visibleText,type ResearchWeb} from '../../services/capabilities/research'
import {publicSourceClass,safePublicUrl} from '../../packages/research/public-sources'
import {validate} from '../../packages/contracts/validate'
const source=(text:string,url='https://m.landchina.com/record'):Source=>({id:'TEST-SOURCE',title:'明确标注的解析测试样本',url,data_class:'public',visibility:'public',synthetic:false,content_status:'full_text',published_at:'2026-07-28',untrusted_text:text})
const html=(s:string)=>'<html><body>'+s+'</body></html>'
const land=html('<table><tr><th>电子监管号</th><th>项目名称</th><th>土地面积（公顷）</th><th>成交价（万元）</th></tr><tr><td>TEST-PARCEL</td><td>测试用地</td><td>1.28</td><td>932.15</td></tr></table>')
const statistics=(count:number)=>JSON.stringify({returndata:{wdnodes:[{wdcode:'zb',nodes:[{code:'A',cname:'测试指标',unit:'万人'}]},{wdcode:'reg',nodes:[{code:'330100',cname:'杭州'}]}],datanodes:Array.from({length:count},(_,i)=>({wds:[{wdcode:'zb',value:'A'},{wdcode:'reg',value:'330100'},{wdcode:'sj',value:String(1800+i)}],data:{hasdata:i!==0,data:i===1?0:i}}))}})

describe('dedicated public-data adapters',()=>{
  it('reads land results with identity, original unit and table cell lineage',()=>{
    const [r]=adaptLandchina(source(land));expect(r.adapter).toBe('landchina');expect(r.fields.find(f=>f.key==='area')).toMatchObject({value:1.28,unit:'公顷'});expect(r.fields.find(f=>f.key==='transaction_price')?.locator).toContain('cell[4]')
  })
  it('retains multiple parcels without merging their facts',()=>{
    const rows=land.replace('</table>','<tr><td>SECOND</td><td>另一地块</td><td>2</td><td>34</td></tr></table>')
    const records=adaptLandchina(source(rows));expect(records).toHaveLength(2);expect(records[0].id).not.toBe(records[1].id)
  })
  it('does not invent an area unit when the source leaves it unspecified',()=>{
    const [r]=adaptLandchina(source(JSON.stringify({宗地编号:'FIXTURE',土地面积:35})));expect(r.fields.find(f=>f.key==='area')).toMatchObject({value:35,unit:''})
  })
  it('preserves explicit raw-value units including yuan, hectares and compound areas',()=>{
    const [r]=adaptLandchina(source(JSON.stringify({宗地编号:'FIXTURE',土地面积:'1.3公顷',成交价:'3000000元'})))
    expect(r.fields.find(f=>f.key==='area')).toMatchObject({value:1.3,unit:'公顷'});expect(r.fields.find(f=>f.key==='transaction_price')).toMatchObject({value:3000000,unit:'元'})
  })
  it('parses construction identity and permit fields, not a claim of safety',()=>{
    const [r]=adaptConstruction(source(JSON.stringify({项目名称:'样本工程',施工许可证编号:'PERMIT-TEST',建筑面积:'2.1万平方米',竣工验收日期:'2026-01-02'}),'https://jzsc.mohurd.gov.cn/project/TEST'))
    expect(r.fields.find(f=>f.key==='area')).toMatchObject({value:2.1,unit:'万平方米'});expect(r.fields.find(f=>f.key==='permit_id')?.value).toBe('PERMIT-TEST');expect(JSON.stringify(r)).not.toContain('安全')
  })
  it('does not assign one building the permit found in another vertical table',()=>{
    const body=html('<table><tr><td>项目名称</td><td>甲楼改造</td></tr><tr><td>建筑面积</td><td>500㎡</td></tr></table><table><tr><td>项目名称</td><td>乙楼改造</td></tr><tr><td>施工许可证编号</td><td>B-ONLY-PERMIT</td></tr></table>')
    const rows=adaptConstruction(source(body,'https://jzsc.mohurd.gov.cn/test'))
    expect(rows).toHaveLength(2)
    expect(rows.find(r=>r.subject==='甲楼改造')?.fields.some(f=>f.key==='permit_id')).toBe(false)
    expect(rows.find(r=>r.subject==='乙楼改造')?.fields.find(f=>f.key==='permit_id')).toMatchObject({value:'B-ONLY-PERMIT',locator:'table[2].row[2].cell[2]'})
  })
  it('preserves same-project table fragments and separates equal names with different project IDs',()=>{
    const make=(id:string,key:string,value:string)=>`<table><tr><td>项目编号</td><td>${id}</td></tr><tr><td>项目名称</td><td>同名工程</td></tr><tr><td>${key}</td><td>${value}</td></tr></table>`
    const rows=adaptConstruction(source(html(make('A','建筑面积','500㎡')+make('A','施工许可证编号','A-PERMIT')+make('B','施工许可证编号','B-PERMIT')),'https://jzsc.mohurd.gov.cn/test'))
    expect(rows).toHaveLength(3)
    const a=rows.filter(r=>r.fields.some(f=>f.key==='project_id'&&f.value==='A'))
    expect(a).toHaveLength(2);expect(a.flatMap(r=>r.fields).some(f=>f.value==='B-PERMIT')).toBe(false)
    expect(rows[2].fields.find(f=>f.key==='permit_id')?.value).toBe('B-PERMIT')
  })
  it('extracts procurement tables without treating the buyer address as the project address',()=>{
    const [r]=adaptProcurement(source(html('<table><tr><td>采购项目名称</td><td>测试校园修缮</td></tr><tr><td>采购单位</td><td>样本大学</td></tr><tr><td>总成交金额</td><td>￥281.240000 万元（人民币）</td></tr><tr><td>采购单位地址</td><td>与工程地点不同的总部地址</td></tr></table>'),'https://www.ccgp.gov.cn/test'))
    expect(r.fields.find(f=>f.key==='award')).toMatchObject({value:281.24,unit:'万元'});expect(r.fields.some(f=>f.key==='location')).toBe(false)
  })
  it('recognizes punctuation variants of official field labels',()=>{
    const [r]=adaptProcurement(source(JSON.stringify({项目名称:'测试', '中标（成交）金额':'2.5万元'})))
    expect(r.fields.find(f=>f.key==='award')?.value).toBe(2.5)
  })
  it('keeps CCGP award-header labels out of facts and retains separate construction lots',()=>{
    // Reduced layout from the live CCGP campus awards: the summary is a key/value
    // table, followed by a column-oriented main-award table with td headers.
    const content=html('<table><tr><td>采购项目名称</td><td>测试宿舍修缮</td></tr><tr><td>总成交金额</td><td>200万元</td></tr></table>'+
      '<table><tr><td>序号</td><td>供应商名称</td><td>工程名称</td><td>施工范围</td><td>施工工期</td><td>项目经理</td><td>执业证书</td></tr>'+
      '<tr><td>1</td><td>测试企业甲</td><td>测试宿舍甲标段</td><td>详见图纸</td><td>25日历天</td><td>测试人员甲</td><td>TEST-A</td></tr>'+
      '<tr><td colspan="7"> </td></tr><tr><td>序号</td><td>供应商名称</td><td>工程名称</td><td>施工范围</td><td>施工工期</td><td>项目经理</td><td>执业证书</td></tr>'+
      '<tr><td>2</td><td>测试企业乙</td><td>测试宿舍乙标段</td><td>详见图纸</td><td>60日历天</td><td>测试人员乙</td><td>TEST-B</td></tr></table>')
    const records=adaptProcurement(source(content,'https://www.ccgp.gov.cn/test'))
    expect(records).toHaveLength(3)
    expect(records.find(r=>r.subject==='测试宿舍修缮')?.fields.some(f=>f.key==='duration')).toBe(false)
    expect(records.find(r=>r.subject==='测试宿舍甲标段')?.fields.find(f=>f.key==='duration')?.value).toBe('25日历天')
    expect(records.find(r=>r.subject==='测试宿舍乙标段')?.fields.find(f=>f.key==='duration')?.value).toBe('60日历天')
    expect(records.flatMap(r=>r.fields).some(f=>f.value==='项目经理')).toBe(false)
  })
  it('preserves null numeric fields and omits records without a nonempty identity',()=>{
    const records=adaptLandchina(source(JSON.stringify([{宗地编号:'TEST',土地面积:null},{宗地编号:null,土地面积:5},{项目名称:'',土地面积:5}])))
    expect(records).toHaveLength(1)
    expect(records[0].fields.find(f=>f.key==='area')?.value).toBeNull()
  })
  it('keeps access restrictions and schema changes distinct',()=>{
    expect(adaptOfficialSource(source('请先登录并输入验证码')).receipt.status).toBe('access_required')
    expect(adaptOfficialSource(source('<h1>首页</h1>')).receipt.status).toBe('schema_changed')
    expect(adaptOfficialSource({...source(land),content_status:'metadata_only'}).records).toEqual([])
  })
  it('detects visible access gates independently of script size and preserves real articles with login navigation',()=>{
    const padded=html('请先登录并输入验证码<script>'+ 'x'.repeat(6100)+'</script>')
    expect(adaptOfficialSource(source(padded)).receipt.status).toBe('access_required')
    const normal=html('<header>请先登录并输入验证码</header><article>'+land+'</article>')
    expect(adaptOfficialSource(source(normal)).records).toHaveLength(1)
  })
  it('supports official local republications but never promotes a lookalike host',()=>{
    expect(adaptOfficialSource(source(land,'https://natural.example.gov.cn/result')).records).toHaveLength(1)
    expect(adaptOfficialSource(source(land,'https://landchina.com.evil.example/result')).records).toEqual([])
  })
  it('decodes NBS dimension codes, units and time without zero filling missing observations',()=>{
    const raw={returndata:{wdnodes:[{wdcode:'zb',nodes:[{code:'A',cname:'统计测试指标',unit:'万人'}]},{wdcode:'reg',nodes:[{code:'330100',cname:'杭州市'}]}],datanodes:[{wds:[{wdcode:'zb',value:'A'},{wdcode:'reg',value:'330100'},{wdcode:'sj',value:'2025'}],data:{hasdata:true,data:0}},{wds:[{wdcode:'zb',value:'A'},{wdcode:'reg',value:'330100'},{wdcode:'sj',value:'2024'}],data:{hasdata:false}}]}}
    const records=adaptStatistics(source(JSON.stringify(raw),'https://data.stats.gov.cn/export'))
    expect(records).toHaveLength(2);expect(records[0]).toMatchObject({subject:'杭州市',scope:'area',period:'2025'});expect(records[0].fields[0]).toMatchObject({value:0,unit:'万人'});expect(records[1].fields[0].value).toBeNull()
  })
  it('does not guess regional scope from national or incompatible statistics tables',()=>{
    expect(adaptStatistics(source(JSON.stringify({data:[1,2,3]})))).toEqual([])
  })
  it.each([49,50,51,60,100,101])('keeps %i input rows within the per-source record/receipt contract',count=>{
    const r=adaptOfficialSource(source(statistics(count),'https://data.stats.gov.cn/export'))
    expect(r.records).toHaveLength(Math.min(50,count))
    expect(r.receipt.record_ids).toEqual(r.records.map(x=>x.id))
    expect(r.receipt.status).toBe(count>50?'truncated':'success')
    expect(()=>validate('AdapterReceipt',r.receipt)).not.toThrow()
    expect(r.records[0].fields[0].value).toBeNull();expect(r.records[1].fields[0].value).toBe(0)
  })
})

describe('DSH evidence collection contract',()=>{
  const request={name:'测试大学玉泉校区',purpose:'建筑服务',asOf:'2026-09-28'}
  function web():ResearchWeb{
    return {search:vi.fn(async()=>({sources:[{url:'https://www.ccgp.gov.cn/test',title:'测试采购',snippet:'未读取的摘要不得成为事实',publishedAt:'2026-07-28'}]})),fetch:vi.fn(async()=>({statusCode:200,body:{kind:'html',content:html('<table><tr><td>采购项目名称</td><td>测试大学玉泉校区修缮</td></tr><tr><td>预算金额</td><td>150万元</td></tr></table>')}}))}
  }
  it('searches, fetches and produces typed records through the shared DSH web port',async()=>{
    const transport=web(),events:any[]=[]
    const r=await collectSelectedEvidence(request,new AbortController().signal,e=>events.push(e),transport)
    expect(transport.search).toHaveBeenCalledTimes(4);expect(transport.fetch).toHaveBeenCalledTimes(1);expect(r.records[0].adapter).toBe('procurement');expect(r.receipts[0].status).toBe('success');expect(events[0].stage).toBe('search');expect(r.sources[0].untrusted_text).not.toContain('未读取的摘要')
  })
  it('fetch failure stores metadata, not the search snippet as verified text',async()=>{
    const t=web();t.fetch=async()=>({statusCode:403,body:{kind:'html',content:'denied'}})
    const r=await collectSelectedEvidence(request,new AbortController().signal,undefined,t)
    expect(r.sources[0].content_status).toBe('metadata_only');expect(r.sources[0].untrusted_text).toBe('');expect(r.records).toEqual([])
  })
  it('excludes future results and private seeds before model use',async()=>{
    const t=web();t.search=async()=>({sources:[{url:'https://www.ccgp.gov.cn/future',publishedAt:'2026-10-12'}]})
    const r=await collectSelectedEvidence({...request,seedSources:[{...source(land),visibility:'internal'}]},new AbortController().signal,undefined,t)
    expect(r.sources).toEqual([]);expect(t.fetch).not.toHaveBeenCalled()
  })
  it('uses the document publication date when the search date masks a future document',async()=>{
    const t=web();t.search=async()=>({sources:[{url:'https://www.ccgp.gov.cn/future-body',publishedAt:'2026-08-01'}]})
    t.fetch=async()=>({statusCode:200,body:{kind:'html',content:'<html><head><meta name="PubDate" content="2026-10-01"></head><body>采购正文</body></html>'}})
    const r=await collectSelectedEvidence(request,new AbortController().signal,undefined,t)
    expect(r.sources).toEqual([])
    expect(r.trace.warnings.some(w=>w.includes('FUTURE'))).toBe(true)
  })
  it('records disagreement between document and search dates instead of silently trusting the earlier date',async()=>{
    const t=web();t.fetch=async()=>({statusCode:200,body:{kind:'html',content:'<html><head><meta name="PubDate" content="2026-08-15"></head><body>实际取得的采购正文</body></html>'}})
    const r=await collectSelectedEvidence(request,new AbortController().signal,undefined,t)
    expect(r.sources[0]).toMatchObject({published_at:'2026-08-15T00:00:00.000Z',search_published_at:'2026-07-28',date_status:'conflict'})
    expect(r.trace.status).toBe('partial')
  })
  it('keeps mixed success and long access-gate failures visible in the aggregate state',async()=>{
    const t=web();t.search=async()=>({sources:[{url:'https://www.ccgp.gov.cn/ok'},{url:'https://www.ccgp.gov.cn/login'}]})
    t.fetch=async({url})=>({statusCode:200,body:{kind:'html',content:url.endsWith('login')?html('请先登录并输入验证码<script>'+ 'x'.repeat(6100)+'</script>'):html('<article>真实取得的公开采购原文，可作为资料线索。</article>')}})
    const r=await collectSelectedEvidence(request,new AbortController().signal,undefined,t)
    expect(r.sources.find(s=>s.url?.endsWith('login'))).toMatchObject({content_status:'metadata_only',untrusted_text:''})
    expect(r.trace.status).toBe('partial');expect(r.trace.warnings.length).toBeGreaterThan(0)
  })
  it('never fetches a private literal URL returned by a search provider',async()=>{
    const t=web();t.search=async()=>({sources:[{url:'http://169.254.169.254/latest/metadata/'}]})
    await collectSelectedEvidence(request,new AbortController().signal,undefined,t);expect(t.fetch).not.toHaveBeenCalled()
  })
  it('rejects captcha pages for non-adapter websites too',async()=>{
    const t=web();t.search=async()=>({sources:[{url:'https://www.example.com/private'}]});t.fetch=async()=>({statusCode:200,body:{kind:'html',content:html('<h1>请先登录，安全验证</h1>')}})
    const r=await collectSelectedEvidence(request,new AbortController().signal,undefined,t);expect(r.sources[0].content_status).toBe('metadata_only')
  })
  it('cancels before additional web work',async()=>{const t=web(),c=new AbortController();c.abort();await expect(collectSelectedEvidence(request,c.signal,undefined,t)).rejects.toThrow();expect(t.search).not.toHaveBeenCalled()})
  it('applies one aggregate record budget and reconciles every receipt to the retained rows',async()=>{
    const t=web();t.search=async()=>({sources:['a','b','c'].map(x=>({url:'https://data.stats.gov.cn/'+x,publishedAt:'2026-07-01'}))})
    t.fetch=async()=>({statusCode:200,body:{kind:'json',content:statistics(60)}})
    const r=await collectSelectedEvidence(request,new AbortController().signal,undefined,t)
    expect(r.records).toHaveLength(100)
    expect(r.receipts.flatMap(x=>x.record_ids)).toEqual(r.records.map(x=>x.id))
    expect(r.receipts.every(x=>x.record_ids.length<=50)).toBe(true)
    expect(r.receipts.every(x=>x.status==='truncated')).toBe(true)
    expect(r.trace.status).toBe('partial')
  })
  it('strips scripts and retains actual article/table text',()=>{const text=visibleText(html('<script>BAD_INSTRUCTION</script><p>实际项目字段</p>'),'https://example.com');expect(text).not.toContain('BAD_INSTRUCTION');expect(text).toContain('实际项目字段')})
  it('classifies sources independently from their title or self-claimed authority',()=>{expect(publicSourceClass('https://www.ccgp.gov.cn/a')).toBe('database');expect(publicSourceClass('https://ccgp.gov.cn.evil.example/a')).toBe('supplementary');expect(safePublicUrl('file:///etc/passwd')).toBeNull()})
})
