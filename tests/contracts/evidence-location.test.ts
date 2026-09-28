import { describe, expect, it } from 'vitest'
import { objectQuoteMatches } from '../../packages/research/evidence'
import type { MapScreenContext, Source } from '../../apps/host/generated/contracts'

const context = (name: string): MapScreenContext => ({
  city: '杭州市', address: '浙江省杭州市西湖区余杭塘路',
  target: { label: name, label_origin: 'public' },
  created_at: '2026-09-28T08:00:00Z',
} as MapScreenContext)
const accepts = (name: string, quote: string) => objectQuoteMatches(
  { id: 'S', untrusted_text: quote } as Source, context(name), name, quote,
)

describe('object names and explicit administrative addresses', () => {
  it.each(['紫金港校区', '浙江大学(紫金港校区)', '桃源小区', '甲工业园区', '甲园区', '未来科技产业园', '科技大楼'])(
    'does not treat the selected object %s as an administrative district', name => {
      const written = name.replace(/[()]/g, '')
      expect(accepts(name, `${written}本期采购设备维护服务。`)).toBe(true)
      expect(accepts(name, `建设地点：浙江省杭州市西湖区${written}。`)).toBe(true)
      expect(accepts(name, `${written}（杭州市西湖区）本期采购设备维护服务。`)).toBe(true)
      expect(accepts(name, `${written}按照杭州市相关规范进行设备维护。`)).toBe(true)
      expect(accepts(name, `${written}本期采购浙江省通用标准设备。`)).toBe(true)
      expect(accepts(name, `${written}东区学生宿舍提升改造工程。`)).toBe(true)
      expect(accepts(name, `${written}西区食堂维护采购项目。`)).toBe(true)
    },
  )
  it.each([
    '科技大楼（合肥市蜀山区）本期采购设备维护服务。',
    '科技大楼本期采购设备维护服务，项目所在地：合肥市蜀山区。',
    '科技大楼本期采购设备维护服务；建设地点为杭州市余杭区。',
    '建设地点：安徽省合肥市西湖区科技大楼。',
    '科技大楼，工程地点：浙江省杭州市余杭区。',
    '科技大楼（余杭区）本期采购设备维护服务。',
    '科技大楼\n项目地址：合肥市蜀山区。',
  ])('rejects an explicitly conflicting address: %s', quote => {
    expect(accepts('科技大楼', quote)).toBe(false)
  })
  it('treats municipality and autonomous-region names as locations, not prose suffixes',()=>{
    for(const location of ['上海市浦东新区','新疆维吾尔自治区乌鲁木齐市天山区','内蒙古自治区呼和浩特市新城区'])
      expect(accepts('科技大楼',`科技大楼（${location}）本期采购设备维护服务。`)).toBe(false)
  })
})
