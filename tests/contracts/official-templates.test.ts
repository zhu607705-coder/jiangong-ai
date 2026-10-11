import { describe, expect, it } from 'vitest'
import type { Source } from '../../apps/host/generated/contracts'
import { adaptOfficialSource, officialArticleText } from '../../services/capabilities/adapters/public-records'

const url = 'https://ggzy.zj.gov.cn/jyxxgk/002001/002001004/20261001/test.html'
const source = (content: string, title = '样本老旧小区改造中标候选人公示', address = url): Source => ({
  id: 'OFFICIAL-TEMPLATE-TEST', title, url: address, data_class: 'public', visibility: 'public', synthetic: false,
  content_status: 'full_text', published_at: '2026-10-01', raw_hash: 'a'.repeat(64), untrusted_text: content,
})
const table = '<table><tr><td>项目名称:</td><td>样本老旧小区改造</td><td>项目代码:</td><td>2604-330114-89-01-189929</td></tr>' +
  '<tr><td>标段（包）名称:</td><td>样本老旧小区改造一标</td><td>标段（包）编号:</td><td>A3300000090006226001001</td></tr>' +
  '<tr><td>预算金额（元）:</td><td>2,500.00</td></tr></table>'
const article = (heading = '信息公开中标候选人公示', fields = table) => '<html><body><nav>中标结果公告</nav>' +
  `<div class="article-info"><h1>样本老旧小区改造</h1><title><span id="litPosition">${heading}</span></title>${fields}` +
  '<script>BAD_SCRIPT 项目名称:恶意替换</script><style>BAD_STYLE</style></div></body></html>'
const first = (content: string, title?: string) => adaptOfficialSource(source(content, title)).records[0]

describe('bounded Zhejiang official engineering templates', () => {
  it('keeps explicit project and lot identities, units and cell locators without a model', () => {
    const result = adaptOfficialSource(source(article()))
    expect(result.receipt.status).toBe('success')
    expect(result.records).toHaveLength(1)
    const record = result.records[0]
    expect(record.adapter).toBe('procurement')
    expect(record.source_hash).toBe('a'.repeat(64))
    expect(record.fields.find(f => f.key === 'project_id')).toMatchObject({ value: '2604-330114-89-01-189929', locator: 'table[1].row[1].cell[4]' })
    expect(record.fields.find(f => f.key === 'lot_id')?.value).toBe('A3300000090006226001001')
    expect(record.fields.find(f => f.key === 'lot_name')?.value).toBe('样本老旧小区改造一标')
    expect(record.fields.find(f => f.key === 'budget')).toMatchObject({ value: 2500, unit: '元', raw: '2,500.00' })
    expect(record.fields.find(f => f.key === 'publication_stage')?.value).toBe('candidate_notice')
  })

  it.each([
    ['招标公告', '信息公开招标公告', 'tender_notice'],
    ['中标结果公告', '信息公开中标结果公示', 'award_notice'],
    ['评分公示', '信息公开评分公示', 'evaluation_notice'],
  ])('requires the title and publication heading to agree for %s', (suffix, heading, expected) => {
    expect(first(article(heading), '样本老旧小区改造' + suffix).fields.find(f => f.key === 'publication_stage')?.value).toBe(expected)
  })

  it('keeps scoring/candidate versus award headings conflicted instead of treating money as an award', () => {
    const fields = table.replace('</table>', '<tr><td>总中标金额:</td><td>99万元</td></tr></table>')
    for (const title of ['样本改造评分公示', '样本改造中标候选人公示']) {
      const record = first(article('信息公开中标结果公示', fields), title)
      const stage = record.fields.find(f => f.key === 'publication_stage')!
      expect(stage.value).toBeNull()
      expect(stage.raw).toContain(title)
      expect(stage.raw).toContain('信息公开中标结果公示')
      expect(record.fields.find(f => f.key === 'award')).toMatchObject({ value: null, raw: '99万元' })
    }
  })

  it('does not infer a publication stage from one known heading, document prose or numeric values', () => {
    for (const [content, title] of [[article('信息公开中标结果公示'), '样本工程'], [article('', table), '样本工程中标结果公告']] as const) {
      expect(first(content, title).fields.find(f => f.key === 'publication_stage')?.value).toBeNull()
    }
  })

  it('accepts retained line-oriented text and binds the label and value to their original lines', () => {
    const body = '信息公开中标候选人公示\n项目名称:\n\n样本小区\n项目代码:\nTEST-PROJECT\n标段（包）编号:\nTEST-LOT\n预算金额（万元）:\n2.5'
    const record = first(body)
    expect(record.fields.find(f => f.key === 'project_name')).toMatchObject({ value: '样本小区', locator: 'line[2] / line[4]' })
    expect(record.fields.find(f => f.key === 'project_id')).toMatchObject({ value: 'TEST-PROJECT', locator: 'line[5] / line[6]' })
    expect(record.fields.find(f => f.key === 'budget')).toMatchObject({ value: 2.5, unit: '万元' })
    expect(record.fields.find(f => f.key === 'publication_stage')?.value).toBe('candidate_notice')
  })

  it('does not borrow another label as a missing value and preserves duplicate conflicting values', () => {
    const record = first('信息公开中标候选人公示\n项目名称:\n项目代码:\nTEST-PROJECT\n标段（包）编号:\nTEST-LOT\n预算金额:\n10元\n预算金额:\n20元')
    expect(record.fields.some(f => f.key === 'project_name')).toBe(false)
    expect(record.fields.find(f => f.key === 'budget')).toMatchObject({ value: null, raw: '10元 / 20元' })
  })

  it('preserves conflicting project identities within one fixed metadata block instead of choosing a row', () => {
    for (const body of [article('信息公开中标候选人公示', table.replace('</table>', '<tr><td>项目代码:</td><td>OTHER-PROJECT</td></tr></table>')),
      '信息公开中标候选人公示\n项目名称:\n样本小区\n项目代码:\nTEST-PROJECT\n项目代码:\nOTHER-PROJECT']) {
      const result = adaptOfficialSource(source(body))
      expect(result.records).toHaveLength(1)
      const identity = result.records[0].fields.find(f => f.key === 'project_id')!
      expect(identity.value).toBeNull()
      expect(identity.raw).toContain('OTHER-PROJECT')
    }
  })

  it('does not assign a buyer office address to the construction site or turn candidate bids into award amounts', () => {
    const record = first(article('信息公开中标候选人公示', table.replace('</table>', '<tr><td>招标人:</td><td>名称:测试业主 地址:测试总部</td></tr><tr><td>投标报价:</td><td>99万元</td></tr></table>')))
    expect(record.fields.some(f => f.key === 'location')).toBe(false)
    expect(record.fields.some(f => f.key === 'award')).toBe(false)
  })

  it('extracts only the known article container and removes executable/navigation text', () => {
    const text = officialArticleText(article(), url)!
    expect(text).toContain('项目代码:')
    expect(text).toContain('2604-330114-89-01-189929')
    expect(text).toContain('信息公开中标候选人公示')
    expect(text).not.toContain('BAD_SCRIPT')
    expect(text).not.toContain('BAD_STYLE')
    expect(text).not.toContain('中标结果公告')
    expect(first(text).fields.find(f => f.key === 'lot_id')?.value).toBe('A3300000090006226001001')
  })

  it('does not accept lookalike hosts, other official sites, unsupported containers or metadata-only pages', () => {
    for (const address of ['https://ggzy.zj.gov.cn.evil.example/test', 'https://other.ggzy.zj.gov.cn/test', 'https://example.gov.cn/test']) {
      expect(officialArticleText(article(), address)).toBeNull()
      expect(adaptOfficialSource(source(article(), undefined, address)).records).toEqual([])
    }
    expect(officialArticleText('<html><body>' + table + '</body></html>', url)).toBeNull()
    expect(adaptOfficialSource({ ...source(article()), content_status: 'metadata_only' }).records).toEqual([])
  })
})
