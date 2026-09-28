import type { Context } from '@deepseek-ai/cordis'
import type { ProjectInput, Source } from '../../apps/host/generated/contracts'
import regionPack from '../../packages/regions/region-pack.json'
import { createHash } from 'node:crypto'
import { z } from 'zod'

const locations = z.object({ results: z.array(z.object({ id: z.number(), name: z.string(), latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180), country_code: z.string().optional(), admin1: z.string().optional(), admin2: z.string().optional() }).passthrough()).optional() }).passthrough()
const normalize = (name: string) => name.trim().replace(/[市县区]$/, '')

export async function resolveScope(ctx: Context, project: ProjectInput, signal: AbortSignal): Promise<{ scope: ProjectInput['scope']; source?: Source; warning?: string }> {
  const scope = structuredClone(project.scope)
  scope.region_pack ||= regionPack.id
  if (scope.geometry) { scope.resolution_status = 'provided_polygon'; return { scope } }
  if (project.synthetic) return { scope }
  if (scope.region_pack !== regionPack.id) return { scope: { ...scope, resolution_status: 'uncovered', resolution_note: '所选地区资料包尚未配置，保留边界未知。' } }
  const query = scope.city || scope.name
  const url = new URL(regionPack.geocoding.endpoint)
  url.search = new URLSearchParams({ name: query, count: '5', format: 'json', language: 'zh', countryCode: regionPack.country_code }).toString()
  try {
    const response = await ctx.web.fetch({ url: url.toString() }, signal)
    if (response.statusCode !== 200) throw new Error('Geocoder returned non-200')
    const result = locations.parse(JSON.parse(response.body.content))
    const locationName = query.split(/[,，]/)[0]
    const candidates = (result.results || []).filter(p => p.country_code === 'CN' && normalize(p.name) === normalize(locationName))
    if (candidates.length !== 1) return { scope: { ...scope, resolution_status: candidates.length ? 'ambiguous' : 'uncovered', resolution_note: candidates.length ? '存在多个同名地点，未自动选择；请补充省市或研究边界。' : '未解析到唯一地点，仍可检索公开资料；地块边界保持未知。' } }
    const place = candidates[0], id = `GEO-${place.id}`
    scope.city ||= place.name
    scope.centroid = { latitude: place.latitude, longitude: place.longitude, label: [place.admin1, place.name].filter(Boolean).join(' / '), source_id: id }
    scope.resolution_status = 'place_point'; scope.resolution_note = '地名代表点已解析，不能据此推断片区边界、法定宗地或开发权利。'
    const selected = { name: place.name, latitude: place.latitude, longitude: place.longitude, admin1: place.admin1, admin2: place.admin2, limitation: scope.resolution_note }
    return { scope, source: { id, title: 'GeoNames 地名代表点（Open-Meteo）', url: url.toString(), data_class: 'public', visibility: 'public', synthetic: false, content_status: 'full_text', license: 'GeoNames attribution / Open-Meteo noncommercial research', untrusted_text: JSON.stringify(selected), retrieved_at: new Date().toISOString(), hash: createHash('sha256').update(response.body.content).digest('hex'), locator: `geonames:${place.id}` } }
  } catch { return { scope: { ...scope, resolution_status: 'uncovered', resolution_note: '地名解析服务未返回可用结果；不填充虚构坐标。' }, warning: '地名定位不可用，研究边界仍需输入或补充。' } }
}
