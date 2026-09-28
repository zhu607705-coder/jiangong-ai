import { describe, expect, it } from 'vitest'
import { classifyPublicSource, PUBLIC_SOURCE_CATALOG, publicSearchPlan } from '../../packages/research/public-sources'

describe('public research source policy', () => {
  it('classifies official databases ahead of general web sources', () => {
    expect(classifyPublicSource('https://m.landchina.com/').tier).toBe('primary_database')
    expect(classifyPublicSource('https://new.tzxm.gov.cn/bsdt/cjwt/gyxmdm/').tier).toBe('primary_database')
    expect(classifyPublicSource('https://example.hangzhou.gov.cn/a').tier).toBe('official_publication')
    expect(classifyPublicSource('https://example.com/report').tier).toBe('supplementary')
  })

  it('keeps the public database catalog broad enough for investment research', () => {
    const ids = new Set(PUBLIC_SOURCE_CATALOG.map(item => item.id))
    for (const id of ['landchina','investment','public_resource','construction','enterprise','statistics','tianditu']) expect(ids.has(id)).toBe(true)
  })

  it('builds bounded evidence-gap search needs rather than a city-wide crawl', () => {
    const plan = publicSearchPlan('杭州市拱墅区')
    expect(plan.length).toBeGreaterThanOrEqual(5)
    expect(plan.length).toBeLessThanOrEqual(8)
    expect(plan.every(item => item.queries.length === 2)).toBe(true)
    expect(plan.flatMap(item => item.queries).every(query => query.includes('杭州市拱墅区'))).toBe(true)
  })
})
