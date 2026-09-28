import { describe, it, expect, vi } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AmapSettings, amapUpstream } from '../../apps/host/amap'
import { coordinates, normalizePoi, normalizeDetails, placeForResearch, projectCoordinates, mapCoordinates, toProjectAnchor } from '../../apps/workspace/src/maps/amap-client'
import { projectInput } from '../../packages/contracts/validate'
import type { Project } from '../../apps/workspace/src/api'

const credentials = { js_key: 'a'.repeat(32), security_code: 'b'.repeat(32) }
const place = { id: 'POI-UNIT-TEST', name: '测试专用地点', location: '120.1,30.2', type: '风景名胜;景点', address: '测试地址' }
describe('AMap configuration and proxy boundary', () => {
  it('requires a separate pair of map credentials and never publishes the security code', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hzz-map-'))
    try {
      const settings = new AmapSettings(directory); await settings.load({})
      expect(settings.publicConfiguration().configured).toBe(false)
      await expect(settings.save({ js_key: 'sk-' + 'c'.repeat(32), security_code: credentials.security_code })).rejects.toThrow('高德')
      await settings.save(credentials)
      const publicConfig = settings.publicConfiguration()
      expect(publicConfig.configured).toBe(true)
      expect(JSON.stringify(publicConfig)).not.toContain(credentials.security_code)
      expect(publicConfig.service_path).toBe('/_AMapService')
      const recovered = new AmapSettings(directory); await recovered.load({})
      expect(recovered.publicConfiguration()).toEqual(publicConfig)
      expect(JSON.parse(await readFile(join(directory, 'amap-credentials.json'), 'utf8'))).toEqual(credentials)
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
  it('forces the provider host and server credential even if request parameters try to replace them', () => {
    const url = amapUpstream('/_AMapService/v3/place/text?key=other&jscode=other&keywords=杭州&s=rsv3&platform=JS', credentials)
    expect(url.origin).toBe('https://restapi.amap.com')
    expect(url.searchParams.get('key')).toBe(credentials.js_key)
    expect(url.searchParams.get('jscode')).toBe(credentials.security_code)
    expect(url.searchParams.get('s')).toBe('rsv3')
    expect(amapUpstream('/_AMapService/v4/map/styles?id=darkblue', credentials).origin).toBe('https://webapi.amap.com')
  })
  it('rejects arbitrary destinations, unsupported endpoints and executable JSONP callbacks', () => {
    for (const url of ['/_AMapService//outside.example/secret', '/_AMapService/v3/unknown', '/_AMapService/v3/place/text?callback=a);alert(1)', '/_AMapService/../../v3/place/text']) expect(() => amapUpstream(url, credentials)).toThrow()
    expect(amapUpstream('/_AMapService/v3/place/text?callback=jsonp_123_456_', credentials).searchParams.get('callback')).toBe('jsonp_123_456_')
  })
  it('permits the provider JS initialization endpoint observed in a real browser', () => {
    expect(amapUpstream('/_AMapService/v3/log/init?s=rsv3&platform=JS', credentials).pathname).toBe('/v3/log/init')
  })
})

describe('map selection data remains spatially honest', () => {
  it('accepts SDK positions but refuses missing or out-of-range coordinates', () => {
    expect(coordinates({ getLng: () => 120, getLat: () => 30 })).toEqual([120, 30])
    for (const input of [undefined, {}, ',30', '120,', '120,30,99', [190, 30], [120, NaN]]) expect(coordinates(input)).toBeNull()
  })
  it('normalizes search and native hotspot results without inventing a building object', () => {
    const p = normalizePoi(place)!
    expect(p.kind).toBe('poi')
    expect(p.coordinate_encoding).toBe('GCJ-02')
    expect(p.poi_id).toBe(place.id)
    expect(normalizePoi({ name: '仅有名字' })).toBeNull()
    expect(normalizePoi({ name: '坐标点', lnglat: { lng: 120.1, lat: 30.2 } })?.kind).toBe('point')
  })
  it('uses only usable provider photos and handles absent detail fields', () => {
    const details = normalizeDetails({ poiList: { pois: [{ photos: [{ url: 'javascript:alert(1)' }, { url: 'https://name:pass@example.org/photo' }, { url: 'https://example.org/photo.jpg', title: '示例照片' }] }] } })
    expect(details.photos).toHaveLength(1)
    expect(details.address).toBeNull()
    expect(details.category).toBe('未提供分类')
  })
  it('persists GCJ anchors without relabeling them as WGS84 or research polygons', async () => {
    const fixture = JSON.parse(await readFile('fixtures/inputs/01_auto.json', 'utf8'))
    const anchor = toProjectAnchor(normalizePoi(place)!)
    fixture.synthetic = false; fixture.facts = []; fixture.sources = []; fixture.scope.geometry = null; fixture.scope.map_anchor = anchor
    const value = projectInput(fixture)
    expect(value.scope.coordinate_encoding).toBe('WGS84')
    expect(value.scope.map_anchor?.coordinate_encoding).toBe('GCJ-02')
    expect(value.scope.geometry).toBeNull()
    const project: Project = { id: 'test', name: 'test', context_version: 0, input: value }
    expect(projectCoordinates(project)).toEqual({ coordinates: [[120.1, 30.2]], encoding: 'GCJ-02', polygon: false })
    value.synthetic = true
    expect(projectCoordinates(project)).toBeNull()
  })
  it('converts and preserves every project polygon ring, including multiple holes',async()=>{
    const rings=[[[120,30],[121,30],[121,31],[120,31],[120,30]],[[120.2,30.2],[120.2,30.3],[120.3,30.3],[120.3,30.2],[120.2,30.2]],[[120.6,30.6],[120.6,30.7],[120.7,30.7],[120.7,30.6],[120.6,30.6]]]
    const input=JSON.parse(await readFile('fixtures/inputs/01_auto.json','utf8'))
    Object.assign(input,{synthetic:false,sources:[],facts:[],context_rules:[]})
    input.scope={name:'明确的空间回归样本',geometry:{type:'Polygon',coordinates:rings},coordinate_encoding:'WGS84',legal_parcel_confirmed:false}
    const project={id:'RINGS',name:'测试',context_version:0,input:projectInput(input)} as Project
    vi.stubGlobal('window',{setTimeout,clearTimeout})
    try{
      const sdk={convertFrom:(points:number[][],_type:string,done:Function)=>done('complete',{locations:points.map(([lng,lat])=>({lng:lng+.005,lat:lat+.003}))})}
      expect(projectCoordinates(project)?.coordinates).toEqual(rings)
      expect((await mapCoordinates(sdk as any,project))?.points).toEqual(rings.map(r=>r.map(([x,y])=>[x+.005,y+.003])))
      expect(project.input.scope.geometry?.coordinates).toEqual(rings)
    }finally{vi.unstubAllGlobals()}
  })
  it('rejects an anchor incorrectly declared as WGS84 at the shared contract boundary', async () => {
    const fixture = JSON.parse(await readFile('fixtures/inputs/01_auto.json', 'utf8'))
    fixture.scope.map_anchor = { ...toProjectAnchor(normalizePoi(place)!), coordinate_encoding: 'WGS84' }
    expect(() => projectInput(fixture)).toThrow()
  })
  it('carries a reverse-geocoded address into a point-based project without promoting missing-data text', () => {
    const point = normalizePoi({name:'选中的地图位置',location:'120.1,30.2'})!
    const known = normalizeDetails({regeocode:{formattedAddress:'浙江省杭州市测试路1号'}})
    expect(placeForResearch(point, known).name).toBe('浙江省杭州市测试路1号')
    expect(placeForResearch(point, known).address).toBe(known.address)
    expect(placeForResearch(point, normalizeDetails({})).address).toBeFalsy()
    expect(placeForResearch(point, normalizeDetails({})).name).toBe(point.name)
    expect(placeForResearch(normalizePoi(place)!, known).name).toBe(place.name)
  })
})
