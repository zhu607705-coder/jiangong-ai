import { useEffect, useRef, useState } from 'react'
import { IconAlertCircle, IconLoader2, IconMap2 } from '@tabler/icons-react'
import { api, type Project } from '../api'
import type { MapConfiguration } from '../../../../packages/maps/types'
import { loadAmap, mapCoordinates, projectCoordinates, type AmapSdk } from '../maps/amap-client'
import './ProjectLocationMap.css'

export type ProjectLocationMapProps = { project: Project }
type Location = NonNullable<ReturnType<typeof projectCoordinates>>
type MappedLocation = NonNullable<Awaited<ReturnType<typeof mapCoordinates>>>
type Phase = 'loading' | 'ready' | 'error'

function visibleSize(element: HTMLElement) {
  const bounds = element.getBoundingClientRect()
  if (bounds.width <= 0 || bounds.height <= 0) return null
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    if (node.hidden) return null
    const style = window.getComputedStyle?.(node)
    if (style?.display === 'none' || style?.visibility === 'hidden' || style?.visibility === 'collapse') return null
  }
  return { width: bounds.width, height: bounds.height }
}

function LocatedMap({ project, location }: ProjectLocationMapProps & { location: Location }) {
  const canvas = useRef<HTMLDivElement>(null)
  const [attempt, setAttempt] = useState(0)
  const [phase, setPhase] = useState<Phase>('loading')
  const [error, setError] = useState('')
  const locationKey = JSON.stringify(location)
  useEffect(() => {
    const element = canvas.current
    if (!element) return
    let alive = true, started = false, failed = false, completed = false, instance: AMap.Map | null = null
    let prepared: { sdk: AmapSdk; location: MappedLocation } | null = null
    let overlay: AMap.Marker | AMap.Polygon | null = null
    let previousSize: { width: number; height: number } | null = null
    let timeout: number | undefined
    const controller = new AbortController()
    setPhase('loading'); setError('')
    const fail = (message: string) => {
      if (!alive || failed) return
      failed = true
      window.clearTimeout(timeout)
      instance?.destroy(); instance = null
      setError(message); setPhase('error')
    }
    const renderTimeout = () => {
      window.clearTimeout(timeout)
      timeout = window.setTimeout(() => fail('位置地图加载超时，请稍后重试。'), 20000)
    }
    const fit = () => {
      if (!instance || !prepared || !overlay) return
      if (prepared.location.polygon) instance.setFitView([overlay], true, [28, 24, 40, 24], 18)
      else instance.setZoomAndCenter(17, prepared.location.points[0], true)
    }
    const createMap = () => {
      if (!alive || failed || instance || !prepared || !visibleSize(element)) return
      const { sdk, location: mapped } = prepared
      const center = mapped.polygon ? mapped.points[0]?.[0] : mapped.points[0]
      if (!center) { fail('项目坐标无法显示，请在地图中核对已登记的位置。'); return }
      try {
        renderTimeout()
        const options: Partial<AMap.MapOptions> & { resizeEnable: boolean } = {
          center, zoom: 17, viewMode: '2D', pitch: 0, rotation: 0,
          dragEnable: false, zoomEnable: false, scrollWheel: false, doubleClickZoom: false,
          touchZoom: false, keyboardEnable: false, rotateEnable: false, pitchEnable: false,
          animateEnable: false, isHotspot: false, resizeEnable: true, mapStyle: 'amap://styles/normal',
        }
        instance = new sdk.Map(element, options)
        instance.on('complete', () => {
          if (!alive || failed) return
          completed = true
          window.clearTimeout(timeout); timeout = undefined; setPhase('ready')
        })
        overlay = mapped.polygon
          ? new sdk.Polygon({ path: mapped.points, fillColor: '#2363e4', fillOpacity: .16, strokeColor: '#1b4fa8', strokeWeight: 2, strokeStyle: project.input.scope.legal_parcel_confirmed ? 'solid' : 'dashed', bubble: true })
          : new sdk.Marker({ position: mapped.points[0], title: project.name, clickable: false })
        instance.add(overlay)
        fit()
      } catch { fail('位置地图未能加载，请检查网络后重试。') }
    }
    const prepareMap = async () => {
      started = true
      timeout = window.setTimeout(() => fail('位置地图加载超时，请稍后重试。'), 20000)
      try {
        const configuration = await api<MapConfiguration>('/maps/config', undefined, controller.signal)
        if (!alive || failed) return
        if (!configuration.configured) { fail('地图服务尚未连接，请连接地图后重试。'); return }
        const sdk = await loadAmap(configuration)
        if (!alive || failed) return
        const mapped = await mapCoordinates(sdk, project)
        if (!alive || failed) return
        if (!mapped) { fail('项目坐标无法显示，请在地图中核对已登记的位置。'); return }
        prepared = { sdk, location: mapped }
        window.clearTimeout(timeout); timeout = undefined
        createMap()
      } catch { fail('位置地图未能加载，请检查地图连接与网络后重试。') }
    }
    const updateSize = (fromWindow = false) => {
      if (!alive || failed) return
      const size = visibleSize(element), previous = previousSize
      previousSize = size
      if (!size) {
        if (prepared) { window.clearTimeout(timeout); timeout = undefined }
        return
      }
      if (!started) { void prepareMap(); return }
      if (!instance) { createMap(); return }
      if (!completed && timeout === undefined) renderTimeout()
      if (!previous || size.width !== previous.width || size.height !== previous.height) {
        // Follow the main map's resize path; retain the instance and provider attribution.
        if (!fromWindow) window.dispatchEvent(new Event('resize'))
        fit()
      }
    }
    const resized = () => updateSize(true)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => updateSize())
    observer?.observe(element)
    // A hidden project page can become visible without a window resize.
    const visibility = typeof MutationObserver === 'undefined' ? null : new MutationObserver(() => updateSize())
    for (let node: HTMLElement | null = element; node; node = node.parentElement) {
      visibility?.observe(node, { attributes: true, attributeFilter: ['hidden', 'style', 'class'] })
    }
    window.addEventListener('resize', resized)
    updateSize()
    return () => {
      alive = false; controller.abort(); window.clearTimeout(timeout)
      observer?.disconnect(); visibility?.disconnect(); window.removeEventListener('resize', resized)
      instance?.destroy(); instance = null
    }
  }, [project.id, project.name, project.input.scope.legal_parcel_confirmed, locationKey, attempt])

  const boundary = location.polygon
    ? `${project.input.scope.legal_parcel_confirmed ? '已登记项目边界' : '研究范围 · 权属边界待确认'} · Polygon${location.coordinates.length > 1 ? ` · ${location.coordinates.length} 个环` : ''}`
    : project.input.scope.map_anchor ? '地图选点 · GCJ-02' : '地名代表点 · WGS84'
  return <div className="project-location-map" data-map-state={phase}>
    <div className="project-location-map-viewport">
      <div className="project-location-map-canvas" ref={canvas} role="img" aria-label={`${project.name}的只读位置地图`} />
      {phase === 'loading' && <div className="project-location-map-message" role="status"><IconLoader2 size={22} /><span>正在加载位置地图</span></div>}
      {phase === 'error' && <div className="project-location-map-message" role="alert"><IconAlertCircle size={23} /><span>{error}</span><button type="button" onClick={() => setAttempt(value => value + 1)}>重试地图</button></div>}
    </div>
    <div className="project-location-map-caption"><span>{phase === 'ready' ? '已定位 · ' : ''}{boundary}</span><a href="https://www.amap.com/" target="_blank" rel="noreferrer noopener">高德地图</a></div>
  </div>
}

export default function ProjectLocationMap({ project }: ProjectLocationMapProps) {
  const location = projectCoordinates(project)
  if (!location) return <div className="project-location-map project-location-map-empty" data-map-state="unlocated"><IconMap2 size={29} stroke={1.4} /><strong>{project.input.synthetic ? '模拟项目未登记真实位置' : '尚未登记地图位置'}</strong><span>{project.input.synthetic ? '不为模拟对象推断真实坐标。' : '可通过“在地图中定位”进入地图选点。'}</span></div>
  return <LocatedMap key={`${project.id}:${JSON.stringify(location)}`} project={project} location={location} />
}
