import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { validate } from '../../packages/contracts/validate'
import { EVIDENCE_GROUPS, INVESTIGATION_GAPS, SCREEN_METHOD, assertScreenBounds, classifyCells, contextComparable, screeningGrid } from '../../packages/maps/screening-policy'
import type { MapScreenAnalysis, MapScreenBounds, MapScreenContext, MapScreenEvidence, MapScreenPoi, MapScreenProfile, MapScreenResult, MapScreenTarget, MapScreenTheme } from '../../apps/host/generated/contracts'
import { fingerprint, type MapProvider } from './provider'
import { evidenceAt, type ProjectEvidenceSnapshot } from './project-evidence'

export type ContextAnalyst = (context: MapScreenContext, profile: MapScreenProfile, signal: AbortSignal) => Promise<MapScreenAnalysis>
const round = (value: number) => Math.round(value * 1e6) / 1e6
const stamp = () => new Date().toISOString()

export function normalizeEvidence(key: typeof EVIDENCE_GROUPS[number], raw: any, sourceId: string): MapScreenEvidence {
  const count = typeof raw?.count === 'number' ? raw.count : /^\d+$/.test(String(raw?.count)) ? Number(raw.count) : null
  if (!Number.isSafeInteger(count) || count! < 0 || !Array.isArray(raw?.pois)) throw new Error('INVALID_AMAP_COUNTS')
  const sample: MapScreenPoi[] = []
  const seen = new Set<string>()
  for (const p of raw.pois.slice(0, 5)) {
    const parts = typeof p.location === 'string' ? p.location.split(',') : []
    const [longitude, latitude] = parts.map(Number)
    if (typeof p.id !== 'string' || typeof p.name !== 'string' || parts.length !== 2 || parts.some((v: string) => !v.trim()) || !Number.isFinite(longitude) || !Number.isFinite(latitude) || Math.abs(longitude) > 180 || Math.abs(latitude) > 90 || seen.has(p.id)) continue
    seen.add(p.id)
    sample.push({ id: p.id.slice(0, 100), name: p.name.slice(0, 200), category: typeof p.type === 'string' ? p.type.slice(0, 300) : '', longitude, latitude })
  }
  if (count! > 0 && !sample.length) throw new Error('INVALID_AMAP_SAMPLE')
  if (count === 0 && raw.pois.length) throw new Error('INVALID_AMAP_COUNTS')
  return { key: key.key, source_id: sourceId, label: key.label, types_query: key.types, status: count! >= 600 ? 'capped' : 'available', reported_count: count,
    sample, retrieved_at: stamp(), issue: count! >= 600 ? '检索数量较大，完整性需补核；完整性未经核查，不纳入数量分级。' : null }
}

export function normalizedTarget(value: unknown): MapScreenTarget {
  const target = validate<MapScreenTarget>('MapScreenTarget', value)
  if (target.kind === 'point' && (target.bounds !== null || target.radius_m === null)) throw new Error('INVALID_TARGET')
  if (target.kind === 'cell') {
    if (!target.bounds || target.radius_m !== null) throw new Error('INVALID_TARGET')
    assertScreenBounds(target.bounds)
    if (Math.abs(target.longitude - (target.bounds.west + target.bounds.east) / 2) > 1e-5 || Math.abs(target.latitude - (target.bounds.south + target.bounds.north) / 2) > 1e-5) throw new Error('INVALID_CELL_CENTER')
  }
  return { ...target, longitude: round(target.longitude), latitude: round(target.latitude), bounds: target.bounds ? Object.fromEntries(Object.entries(target.bounds).map(([k, v]) => [k, round(v)])) as unknown as MapScreenBounds : null }
}

export class MapScreeningService {
  private contexts = new Map<string, MapScreenContext>()
  private analyses = new Map<string, MapScreenAnalysis>()
  private activeAnalyses = 0
  private analyzing = new Set<string>()
  constructor(private provider: MapProvider, private directory: string, private analyst: ContextAnalyst,
    private loadEvidence: () => Promise<ProjectEvidenceSnapshot> = async () => ({revision: 'empty', projects: [], syntheticCount: 0})) {}

  async context(value: unknown, signal: AbortSignal, snapshot?: ProjectEvidenceSnapshot): Promise<MapScreenContext> {
    signal.throwIfAborted()
    snapshot ??= await this.loadEvidence()
    const target = normalizedTarget(value)
    const key = fingerprint([this.provider.revision(), target])
    const cached = this.contexts.get(key)
    if (cached && Date.parse(cached.expires_at) > Date.now()) {
      if (cached.project_revision === snapshot.revision) return structuredClone(cached)
      const rebound = {...cached, id: 'MAPCTX-' + randomUUID(), project_revision: snapshot.revision, local_projects: evidenceAt(snapshot, target, cached.city)}
      this.contexts.set(key, rebound); await this.save('contexts', rebound.id, rebound)
      return structuredClone(rebound)
    }
    const id = 'MAPCTX-' + randomUUID(), created = stamp()
    const params: Record<string, string> = { offset: '5', page: '1', extensions: 'base', children: '0' }
    if (target.kind === 'point') Object.assign(params, { location: `${target.longitude},${target.latitude}`, radius: String(target.radius_m), sortrule: 'distance' })
    else {
      const b = target.bounds!
      params.polygon = `${b.west.toFixed(6)},${b.north.toFixed(6)}|${b.east.toFixed(6)},${b.south.toFixed(6)}`
    }
    const groups = await Promise.all(EVIDENCE_GROUPS.map(async group => {
      const sourceId = `${id}:${group.key}`
      try {
        const data = await this.provider.query(target.kind === 'point' ? '/v3/place/around' : '/v3/place/polygon', { ...params, types: group.types }, signal)
        return normalizeEvidence(group, data, sourceId)
      } catch {
        signal.throwIfAborted()
        return { key: group.key, source_id: sourceId, label: group.label, types_query: group.types, status: 'failed' as const, reported_count: null, sample: [], retrieved_at: stamp(), issue: '本轮来源未成功返回；不把失败记为零。' }
      }
    }))
    let address: string | null = null, city: string | null = null
    {
      try {
        const data = await this.provider.query('/v3/geocode/regeo', { location: `${target.longitude},${target.latitude}`, extensions: 'base', radius: '100' }, signal)
        if (typeof data.regeocode?.formatted_address === 'string') address = data.regeocode.formatted_address.slice(0, 500)
        const component = data.regeocode?.addressComponent
        if (typeof component?.city === 'string' && component.city) city = component.city.slice(0, 100)
        else if (['北京市', '上海市', '天津市', '重庆市'].includes(component?.province)) city = component.province
      } catch { signal.throwIfAborted() }
    }
    signal.throwIfAborted()
    const result = validate<MapScreenContext>('MapScreenContext', { id, target, provider: 'amap', coordinate_encoding: 'GCJ-02', created_at: created,
      expires_at: new Date(Date.now() + (groups.every(g => g.status !== 'failed') ? 600_000 : 30_000)).toISOString(), address, city, groups,
      local_projects: evidenceAt(snapshot, target, city), project_revision: snapshot.revision,
      status: groups.every(g => g.status === 'available') ? 'complete' : 'partial', gaps: INVESTIGATION_GAPS,
      metric_note: '数量是高德检索报告的匹配记录，样例只保留前五条；可能含出入口、子场所及重复实体，不是独立建筑、人口、客流或真实需求。' })
    if (this.contexts.size >= 120) this.contexts.delete(this.contexts.keys().next().value!)
    this.contexts.set(key, result)
    await this.save('contexts', id, result)
    return structuredClone(result)
  }

  async analyze(id: string, profile: MapScreenProfile, signal: AbortSignal): Promise<MapScreenAnalysis> {
    if (!/^MAPCTX-[a-f\d-]{36}$/i.test(id)) throw new Error('CONTEXT_NOT_FOUND')
    let context: MapScreenContext
    try { context = validate<MapScreenContext>('MapScreenContext', JSON.parse(await readFile(join(this.directory, 'contexts', id + '.json'), 'utf8'))) }
    catch { throw new Error('CONTEXT_NOT_FOUND') }
    if (Date.parse(context.expires_at) < Date.now()) throw new Error('CONTEXT_EXPIRED')
    const key = id + ':' + profile, cached = this.analyses.get(key)
    if (cached?.status === 'completed') return structuredClone(cached)
    if (context.groups.filter(g => g.status === 'available').length < 2) return { context_id: id, profile, status: 'insufficient_data', assessment: null, model_calls: [], reason: '可用周边资料不足，保留已取得事实，暂不生成投资潜力解读。', created_at: stamp() }
    if (this.activeAnalyses >= 2 || this.analyzing.has(key)) return { context_id: id, profile, status: 'unavailable', assessment: null, model_calls: [], reason: '已有初筛解读正在运行，请稍后重试。', created_at: stamp() }
    this.activeAnalyses++; this.analyzing.add(key)
    try {
      const analysis = validate<MapScreenAnalysis>('MapScreenAnalysis', await this.analyst(context, profile, signal))
      signal.throwIfAborted()
      if (this.analyses.size >= 120) this.analyses.delete(this.analyses.keys().next().value!)
      if (analysis.status === 'completed') this.analyses.set(key, analysis)
      await this.save('analyses', id + '-' + profile, analysis)
      return analysis
    } finally { this.activeAnalyses--; this.analyzing.delete(key) }
  }

  async screen(bounds: MapScreenBounds, profile: MapScreenProfile, theme: MapScreenTheme, signal: AbortSignal, emit: (event: unknown) => void): Promise<MapScreenResult> {
    const cells = screeningGrid(bounds), id = 'MAPSCAN-' + randomUUID()
    const snapshot = await this.loadEvidence()
    emit({ type: 'start', id, bounds, profile, theme, cells })
    for (let i = 0; i < cells.length; i++) {
      signal.throwIfAborted()
      const cell = cells[i], b = cell.bounds
      cell.context = await this.context({ kind: 'cell', bounds: b, radius_m: null, longitude: (b.west + b.east) / 2, latitude: (b.south + b.north) / 2 }, signal, snapshot)
      cell.tier = 'pending'
      emit({ type: 'cell', cell, completed: i + 1, total: cells.length })
    }
    const classified = classifyCells(cells, theme)
    const result = validate<MapScreenResult>('MapScreenResult', { id, bounds, profile, theme, created_at: stamp(), cells: classified,
      status: classified.every(c => c.metric_value !== null) ? 'completed' : 'partial', method: SCREEN_METHOD,
      comparison_count: classified.filter(c => c.metric_value !== null).length,
      notes: ['分析格网不是法定地块或建筑边界。', '颜色为所选指标的固定数量分级，不是综合投资分数或收益预测。', '项目资料按实际范围关联；同城政策仅作背景，不推断单地块适用性。', '图例固定；不同网格面积或时点的记录数不能直接比较密度或变化。'] })
    await this.save('screens', id, result)
    emit({ type: 'complete', result })
    return result
  }
  private async save(folder: string, id: string, value: unknown) {
    await mkdir(join(this.directory, folder), { recursive: true })
    await writeFile(join(this.directory, folder, id + '.json'), JSON.stringify(value, null, 2) + '\n', { mode: 0o600 })
  }
}
