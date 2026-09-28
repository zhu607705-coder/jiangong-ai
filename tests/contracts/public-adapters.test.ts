import {describe,it,expect,vi} from 'vitest'
import type {Source} from '../../apps/host/generated/contracts'
import {adaptLandchina,adaptConstruction,adaptStatistics,adaptOfficialSource,adaptProcurement} from '../../services/capabilities/adapters/public-records'
import {collectSelectedEvidence,visibleText,type ResearchWeb} from '../../services/capabilities/research'
import {publicSourceClass,safePublicUrl} from '../../packages/research/public-sources'
const source=(text:string,url='https://m.landchina.com/record'):Source=>({id:'TEST-SOURCE',title:'明确标注的解析测试样本',url,data_class:'public',visibility:'public',synthetic:false,content_status:'full_text',published_at:'2026-07-28',untrusted_text:text})
const html=(s:string)=>'<html><body>'+s+'</body></html>'
const land=html('<table><tr><th>电子监管号</th><th>项目名称</th><th>土地面积（公顷）</th><th>成交价（万元）</th></tr><tr><td>TEST-PARCEL</td><td>测试用地</td><td>1.28</td><td>932.15</td></tr></table>')

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
  it('extracts procurement tables without treating the buyer address as the project address',()=>{
    const [r]=adaptProcurement(source(html('<table><tr><td>采购项目名称</td><td>测试校园修缮</td></tr><tr><td>采购单位</td><td>样本大学</td></tr><tr><td>总成交金额</td><td>￥281.240000 万元（人民币）</td></tr><tr><td>采购单位地址</td><td>与工程地点不同的总部地址</td></tr></table>'),'https://www.ccgp.gov.cn/test'))
    expect(r.fields.find(f=>f.key==='award')).toMatchObject({value:281.24,unit:'万元'});expect(r.fields.some(f=>f.key==='location')).toBe(false)
  })
  it('recognizes punctuation variants of official field labels',()=>{
    const [r]=adaptProcurement(source(JSON.stringify({项目名称:'测试', '中标（成交）金额':'2.5万元'})))
    expect(r.fields.find(f=>f.key==='award')?.value).toBe(2.5)
  })
  it('keeps access restrictions and schema changes distinct',()=>{
    expect(adaptOfficialSource(source('请先登录并输入验证码')).receipt.status).toBe('access_required')
    expect(adaptOfficialSource(source('<h1>首页</h1>')).receipt.status).toBe('schema_changed')
    expect(adaptOfficialSource({...source(land),content_status:'metadata_only'}).records).toEqual([])
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
  it('never fetches a private literal URL returned by a search provider',async()=>{
    const t=web();t.search=async()=>({sources:[{url:'http://169.254.169.254/latest/metadata/'}]})
    await collectSelectedEvidence(request,new AbortController().signal,undefined,t);expect(t.fetch).not.toHaveBeenCalled()
  })
  it('rejects captcha pages for non-adapter websites too',async()=>{
    const t=web();t.search=async()=>({sources:[{url:'https://www.example.com/private'}]});t.fetch=async()=>({statusCode:200,body:{kind:'html',content:html('<h1>请先登录，安全验证</h1>')}})
    const r=await collectSelectedEvidence(request,new AbortController().signal,undefined,t);expect(r.sources[0].content_status).toBe('metadata_only')
  })
  it('cancels before additional web work',async()=>{const t=web(),c=new AbortController();c.abort();await expect(collectSelectedEvidence(request,c.signal,undefined,t)).rejects.toThrow();expect(t.search).not.toHaveBeenCalled()})
  it('strips scripts and retains actual article/table text',()=>{const text=visibleText(html('<script>BAD_INSTRUCTION</script><p>实际项目字段</p>'),'https://example.com');expect(text).not.toContain('BAD_INSTRUCTION');expect(text).toContain('实际项目字段')})
  it('classifies sources independently from their title or self-claimed authority',()=>{expect(publicSourceClass('https://www.ccgp.gov.cn/a')).toBe('database');expect(publicSourceClass('https://ccgp.gov.cn.evil.example/a')).toBe('supplementary');expect(safePublicUrl('file:///etc/passwd')).toBeNull()})
})
