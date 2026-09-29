import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe,expect,it } from 'vitest'
import { readingTitle,noticeKind,publicationLabel,ReadingEvidence,NoticeMeta,publisherLabel } from '../../apps/workspace/src/intelligence/reading-view'
const url='https://www.ccgp.gov.cn/cggg/zygg/jzxcs/202607/t20260714_fixture.htm'
const core='合成样例：浙江大学建工试验大厅改造竞争性磋商公告'
const suffix='_中国政府采购网-中华人民共和国财政部唯一指定政府采购信息网络发布媒体'
const realShort='浙江大学紫金港校区图书馆主馆北地块景观功能提升改造工程公开招标公告'
const realTrailer=' - 财政部唯一指定政府采购信息网络发布媒体 国家级政府采购专业网站'
const realTitle=realShort+realTrailer
const realUrl='http://www.ccgp.gov.cn/cggg/zygg/gkzb/202609/t20260904_27270393.htm'
const item={title:core+suffix,url,status:'ready',published_at:'2026-07-14T01:00:00Z',score:80,analysis:{status:'ready',scores:[78,82],structure:{locator_quote:'合成分类引文：本公告采购建筑改造服务。'}}}

describe('read-only intelligence notice presentation',()=>{
  it.each(['_中国政府采购网',' - 中国政府采购网',suffix,'｜中国政府采购网'])('removes only the recognised publisher trailer %s',tail=>{
    expect(readingTitle(core+tail,url)).toBe(core)
  })
  it('removes the exact official media trailer from the provided ccgp title only',()=>{
    expect(readingTitle(realTitle,realUrl)).toBe(realShort)
    expect(readingTitle(realShort+' - 财政部唯一指定政府采购信息网络发布媒体',realUrl)).toBe(realShort+' - 财政部唯一指定政府采购信息网络发布媒体')
    expect(readingTitle(realTitle,'https://example.org/cggg/zygg/gkzb/example.htm')).toBe(realTitle)
    expect(realTitle).toBe(realShort+realTrailer)
  })
  it('preserves material fields, project punctuation and unknown trailers',()=>{
    const frozen=Object.freeze(structuredClone(item))
    readingTitle(frozen.title,frozen.url);noticeKind(frozen.title,frozen.url)
    expect(frozen.title).toBe(core+suffix)
    expect(readingTitle('合成工程-A标段（第二次）_中国政府采购网',url)).toBe('合成工程-A标段（第二次）')
    expect(readingTitle(core+'_其它项目范围',url)).toBe(core+'_其它项目范围')
    expect(readingTitle(core+'_中国政府采购网-自定义文字',url)).toBe(core+'_中国政府采购网-自定义文字')
  })
  it('does not strip names from an unrelated or lookalike hostname',()=>{
    for(const u of ['https://ccgp.gov.cn.example.org/a','https://example.org/a','not a URL'])expect(readingTitle(core+suffix,u)).toBe(core+suffix)
    expect(publisherLabel('not a URL')).toBe('原始来源')
  })
  it.each([
    ['样例采购意向公开','采购意向'],['样例公开招标公告','招标公告'],
    ['样例竞争性磋商公告','采购公告'],['样例成交结果公告','成交结果'],
    ['样例中标公告','中标结果'],['样例中标候选人公示','候选人公示'],
    ['样例合同公告','合同公告'],['样例更正公告','更正公告'],['样例终止公告','终止 / 废标公告'],
    ['样例项目进展','公开资料'],
  ])('uses document kind rather than model or project status: %s',(title,expected)=>{
    expect(noticeKind(title,'https://example.org/a').label).toBe(expected)
  })
  it('uses an exact official column as fallback and exposes title/column disagreement',()=>{
    expect(noticeKind('样例无类型标题',url).label).toBe('采购公告')
    expect(noticeKind('样例成交结果公告',url).label).toBe('公告类型待核')
    expect(noticeKind('样例无类型标题','https://ccgp.gov.cn.example.org/cggg/zygg/cjgg/x').label).toBe('公开资料')
  })
  it('keeps the publishing date separate from submission deadlines and local time',()=>{
    expect(publicationLabel(item)).toBe('发布 2026-07-14')
    expect(publicationLabel({published_at:'2026-07-14T23:00:00Z'})).toBe('发布 2026-07-15')
    expect(publicationLabel({published_at:'2026-07-14'})).toBe('发布 2026-07-14')
    expect(publicationLabel({published_at:null})).toBe('发布日期未载')
    expect(publicationLabel({...item,date_status:'conflict'})).toBe('日期待核')
    expect(publicationLabel({...item,date_status:'search_only'})).toBe('索引日期 2026-07-14')
    expect(publicationLabel({published_at:'2026-02-30'})).toBe('日期待核')
  })
  it('ready and unscored both describe the same historical notice, never a current opportunity',()=>{
    for(const status of ['ready','unscored','needs_review']){
      const html=renderToStaticMarkup(React.createElement(NoticeMeta,{item:{...item,status}}))
      expect(html).toContain('采购公告');expect(html).not.toMatch(/可投|可参与|招标中|已竣工|当前机会/)
    }
  })
  it('renders the stored score, both runs and classification quote without inventing score rationale',()=>{
    const html=renderToStaticMarkup(React.createElement(ReadingEvidence,{item}))
    expect(html).toContain('阅读优先级');expect(html).toContain('80');expect(html).toContain('78');expect(html).toContain('82')
    expect(html).toContain('分类引文');expect(html).toContain(item.analysis.structure.locator_quote)
    expect(html).not.toMatch(/可靠度|投资价值|评分依据|成功率/)
  })
  it('does not promote scores in needs_review/failed and permits a real zero',()=>{
    for(const status of ['needs_review','unscored','failed'])expect(renderToStaticMarkup(React.createElement(ReadingEvidence,{item:{...item,status}}))).toBe('')
    expect(renderToStaticMarkup(React.createElement(ReadingEvidence,{item:{...item,score:0}}))).toContain('>0<')
    expect(renderToStaticMarkup(React.createElement(ReadingEvidence,{item:{...item,score:NaN,analysis:undefined}}))).not.toContain('阅读优先级</span>')
  })
  it('escapes original material rather than executing it',()=>{
    const html=renderToStaticMarkup(React.createElement(ReadingEvidence,{item:{...item,analysis:{structure:{locator_quote:'<img src=x onerror=alert(1)>'}}}}))
    expect(html).toContain('&lt;img');expect(html).not.toContain('<img')
  })
})
