import type { MapConfiguration, PlaceSelection, PlaceDetails } from '../../../../packages/maps/types'
import type { Project } from '../api'

type ResultCallback = (status: string, result: any) => void
interface PlaceService { search(query: string, callback: ResultCallback): void; getDetails(id: string, callback: ResultCallback): void }
interface GeocodeService { getAddress(point: [number, number], callback: ResultCallback): void }
export type MapLayer = Parameters<AMap.Map['setLayers']>[0][number]
export type AmapSdk = Omit<typeof AMap, 'Polygon'> & {
  // The provider's published type package omits Polygon's options constructor.
  Polygon: new (options: Parameters<AMap.Polygon['setOptions']>[0]) => AMap.Polygon;
  PlaceSearch: new (options: Record<string, unknown>) => PlaceService;
  Geocoder: new (options?: Record<string, unknown>) => GeocodeService;
  Scale: new (options?: Record<string, unknown>) => AMap.Control;
}
let sdkPromise: Promise<AmapSdk> | undefined
let loadedRevision = ''

export async function loadAmap(configuration: MapConfiguration): Promise<AmapSdk> {
  if (!configuration.configured || !configuration.js_key) throw new Error('请先连接高德地图。')
  if (sdkPromise && loadedRevision === configuration.revision) return sdkPromise
  loadedRevision = configuration.revision
  sdkPromise = (async () => {
    const module = await import('@amap/amap-jsapi-loader')
    const loader = (module.default || module) as unknown as { load: (opts: unknown) => Promise<AmapSdk>; reset: () => void }
    loader.reset()
    ;(window as unknown as { _AMapSecurityConfig: { serviceHost: string } })._AMapSecurityConfig = {
      serviceHost: window.location.origin + configuration.service_path,
    }
    return loader.load({ key: configuration.js_key, version: configuration.sdk_version,
      plugins: ['AMap.PlaceSearch', 'AMap.Geocoder', 'AMap.Scale'] })
  })()
  return sdkPromise
}

export function coordinates(value: any): [number, number] | null {
  let lng: unknown, lat: unknown
  if (typeof value === 'string') {
    const parts = value.split(',')
    if (parts.length !== 2 || parts.some(part => !part.trim())) return null
    ;[lng, lat] = parts.map(Number)
  }
  else if (Array.isArray(value)) { if (value.length !== 2) return null; [lng, lat] = value }
  else { lng = typeof value?.getLng === 'function' ? value.getLng() : value?.lng; lat = typeof value?.getLat === 'function' ? value.getLat() : value?.lat }
  if (typeof lng !== 'number' || typeof lat !== 'number' || !Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lng) > 180 || Math.abs(lat) > 90) return null
  return [lng, lat]
}
const text = (v: unknown) => typeof v === 'string' ? v.trim().slice(0, 500) : ''
export function normalizePoi(poi: any): PlaceSelection | null {
  const point = coordinates(poi?.location || poi?.lnglat), name = text(poi?.name)
  if (!point || !name) return null
  const id = text(poi?.id)
  return { id: id || `point-${point.join(',')}`, kind: id ? 'poi' : 'point', name: name.slice(0, 200),
    longitude: point[0], latitude: point[1], coordinate_encoding: 'GCJ-02',
    ...(id ? { poi_id: id } : {}), address: text(poi?.address), category: text(poi?.type), city: text(poi?.cityname) }
}
function serviceCall<T>(execute: (done: ResultCallback) => void, parse: (data: any) => T, empty?: T): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error('地点服务响应超时，请稍后重试。')), 12000)
    execute((status, data) => {
      window.clearTimeout(timeout)
      if (status === 'complete') { try { resolve(parse(data)) } catch { reject(new Error('地点服务返回了无法识别的信息。')) } }
      else if (status === 'no_data' && empty !== undefined) resolve(empty)
      else reject(new Error('地点服务未返回结果，请检查高德 Key 的服务权限与额度。'))
    })
  })
}
export function searchPlaces(sdk: AmapSdk, query: string): Promise<PlaceSelection[]> {
  const service = new sdk.PlaceSearch({ pageSize: 12, extensions: 'base' })
  return serviceCall(done => service.search(query, done), data => (data.poiList?.pois || []).map(normalizePoi).filter((v: PlaceSelection | null): v is PlaceSelection => !!v), [])
}
export function normalizeDetails(data: any): PlaceDetails {
  const poi = data?.poiList?.pois?.[0]
  const address = poi ? text(poi.address) : text(data?.regeocode?.formattedAddress)
  return { address: address || null, category: text(poi?.type) || '未提供分类', telephone: text(poi?.tel),
    photos: (Array.isArray(poi?.photos) ? poi.photos : []).flatMap((p: any) => {
      try { const u = new URL(p.url); return u.protocol === 'https:' && !u.username && !u.password ? [{ url: u.toString(), title: text(p.title) }] : [] } catch { return [] }
    }).slice(0, 3), source: '高德地图' }
}
export function placeDetails(sdk: AmapSdk, selection: PlaceSelection): Promise<PlaceDetails> {
  if (selection.poi_id) {
    const service = new sdk.PlaceSearch({ extensions: 'all' })
    return serviceCall(done => service.getDetails(selection.poi_id!, done), normalizeDetails)
  }
  const geocoder = new sdk.Geocoder({ extensions: 'base', radius: 100 })
  return serviceCall(done => geocoder.getAddress([selection.longitude, selection.latitude], done), normalizeDetails)
}

export function placeForResearch(selection: PlaceSelection, details: PlaceDetails | null): PlaceSelection {
  const address = details?.address || selection.address
  return { ...selection, ...(address ? { address } : {}),
    name: selection.kind === 'point' && address ? address.slice(0, 200) : selection.name }
}

/** GCJ-02 is only a display anchor. WGS84 research geometries are never relabelled. */
export function toProjectAnchor(selection: PlaceSelection): NonNullable<Project['input']['scope']['map_anchor']> {
  return { provider: 'amap', coordinate_encoding: 'GCJ-02', longitude: selection.longitude, latitude: selection.latitude,
    name: selection.name.slice(0, 200), ...(selection.poi_id ? { poi_id: selection.poi_id } : {}), ...(selection.address ? { address: selection.address } : {}) }
}
export function projectCoordinates(project: Project): { coordinates: [number, number][]; encoding: 'WGS84' | 'GCJ-02'; polygon: boolean } | null {
  if (project.input.synthetic) return null
  const scope = project.input.scope
  if (scope.geometry) return { coordinates: scope.geometry.coordinates[0].map(p => [p[0], p[1]]), encoding: 'WGS84', polygon: true }
  if (scope.map_anchor) return { coordinates: [[scope.map_anchor.longitude, scope.map_anchor.latitude]], encoding: 'GCJ-02', polygon: false }
  if (scope.centroid) return { coordinates: [[scope.centroid.longitude, scope.centroid.latitude]], encoding: 'WGS84', polygon: false }
  return null
}
export async function mapCoordinates(sdk: AmapSdk, project: Project): Promise<{ points: [number, number][]; polygon: boolean } | null> {
  const location = projectCoordinates(project)
  if (!location) return null
  if (location.encoding === 'GCJ-02') return { points: location.coordinates, polygon: location.polygon }
  const points = await serviceCall<[number, number][]>(done => sdk.convertFrom(location.coordinates, 'gps', done), data => {
    const converted = (data.locations || []).map(coordinates)
    if (converted.length !== location.coordinates.length || converted.some((p: unknown) => !p)) throw new Error('转换失败')
    return converted
  })
  return { points, polygon: location.polygon }
}
