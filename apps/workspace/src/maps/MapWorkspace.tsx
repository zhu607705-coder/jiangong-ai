import { useEffect, useRef, useState } from 'react'
import { IconSearch, IconX, IconPlus, IconMinus, IconNavigation, IconLayersIntersect, IconArrowRight,
  IconCube, IconMapPin, IconSatellite, IconBuildingSkyscraper, IconFocus2, IconAdjustments, IconArrowLeft, IconExternalLink } from '@tabler/icons-react'
import { api, type Project } from '../api'
import type { MapConfiguration, PlaceSelection, PlaceDetails } from '../../../../packages/maps/types'
import { loadAmap, coordinates, normalizePoi, searchPlaces, placeDetails, placeForResearch, mapCoordinates, type AmapSdk, type MapLayer } from './amap-client'
import MapSettings from './MapSettings'
import PreliminaryCard from './PreliminaryCard'
import ScreeningControls from './ScreeningControls'
import DataSourcesPanel from './DataSourcesPanel'
import { scanMap } from './screening-stream'
import { SCREEN_TIERS, classifyCells } from '../../../../packages/maps/screening-policy'
import type { MapScreenBounds, MapScreenCell, MapScreenContext, MapScreenProfile, MapScreenResult, MapScreenTheme } from '../../../host/generated/contracts'

const DEFAULT_CENTER: [number, number] = [120.153576, 30.287459]
export default function MapWorkspace({ ready, project, focusProject, settingsRequest, onOpenProject, onCreateFromPlace }: {
  ready: boolean; project: Project | null; focusProject: number; settingsRequest: number;
  onOpenProject: (id?: string) => void; onCreateFromPlace: (place: PlaceSelection, context?: MapScreenContext | null) => void;
}) {
  const canvas = useRef<HTMLDivElement>(null), map = useRef<AMap.Map | null>(null), sdk = useRef<AmapSdk | null>(null)
  const marker = useRef<AMap.Marker | null>(null), projectOverlays = useRef<any[]>([])
  const layers = useRef<{ satellite: MapLayer; visible: boolean; buildings: boolean; nativeBuildings: { show(): void; hide(): void } | null } | null>(null)
  const [config, setConfig] = useState<MapConfiguration | null>(null), [settings, setSettings] = useState(false)
  const [phase, setPhase] = useState<'loading' | 'unconfigured' | 'ready' | 'error'>('loading')
  const [mapError, setMapError] = useState(''), [notice, setNotice] = useState('')
  const [query, setQuery] = useState(''), [searching, setSearching] = useState(false), [results, setResults] = useState<PlaceSelection[] | null>(null)
  const [selection, setSelection] = useState<PlaceSelection | null>(null), [projectPreview, setProjectPreview] = useState(false)
  const [expanded, setExpanded] = useState(false), [details, setDetails] = useState<PlaceDetails | null>(null), [detailsError, setDetailsError] = useState(''), [detailLoading, setDetailLoading] = useState(false)
  const [camera, setCamera] = useState({ zoom: 17.2, pitch: 55, rotation: 0 })
  const [layerPanel, setLayerPanel] = useState(false), [satellite, setSatellite] = useState(false), [buildings, setBuildings] = useState(true)
  const [webgl, setWebgl] = useState(true)
  const [buildingControl, setBuildingControl] = useState(false)
  const searchVersion = useRef(0), selectionVersion = useRef(0)
  const [profile, setProfile] = useState<MapScreenProfile>('balanced')
  const [theme, setTheme] = useState<MapScreenTheme>('overall'), [dataOpen, setDataOpen] = useState(false)
  const [screenCells, setScreenCells] = useState<MapScreenCell[]>([]), [screenResult, setScreenResult] = useState<MapScreenResult | null>(null)
  const [screenRunning, setScreenRunning] = useState(false), [screenProgress, setScreenProgress] = useState(0), [screenError, setScreenError] = useState(''), [screenStale, setScreenStale] = useState(false)
  const [selectedCell, setSelectedCell] = useState<MapScreenCell | null>(null)
  const [previewContext, setPreviewContext] = useState<{ forId: string; context: MapScreenContext } | null>(null)
  const screenAbort = useRef<AbortController | null>(null), screenVersion = useRef(0), screenOverlays = useRef<any[]>([])
  const screenView = useRef<{ longitude: number; latitude: number; zoom: number } | null>(null)

  function selectPlace(place: PlaceSelection, move = true) {
    selectionVersion.current++
    searchVersion.current++
    setSelection(place); setPreviewContext(null); setSelectedCell(null); setProjectPreview(false); setExpanded(false); setDetails(null); setDetailsError(''); setDetailLoading(false); setSearching(false); setResults(null); setNotice('')
    if (move) map.current?.setZoomAndCenter(Math.max(map.current.getZoom(), 17), [place.longitude, place.latitude])
  }
  function clearSelection() { selectionVersion.current++; setSelection(null); setSelectedCell(null); setProjectPreview(false); setExpanded(false); setDetails(null); setDetailLoading(false) }
  const selectRef = useRef(selectPlace); selectRef.current = selectPlace
  function chooseCell(cell: MapScreenCell) {
    if (!cell.context) { setNotice(screenRunning ? '正在读取街区资料。' : '请重新读取此街区。'); return }
    selectPlace({ id: cell.context.id, kind: 'point', name: cell.label, longitude: cell.context.target.longitude, latitude: cell.context.target.latitude, coordinate_encoding: 'GCJ-02', category: '街区' }, false)
    setSelectedCell(cell)
  }
  const chooseCellRef = useRef(chooseCell); chooseCellRef.current = chooseCell
  function clearScreen() { screenAbort.current?.abort(); screenVersion.current++; setScreenRunning(false); setScreenCells([]); setScreenResult(null); setScreenError(''); setScreenProgress(0); setScreenStale(false); screenView.current = null; if (selectedCell) clearSelection() }
  async function startScreen() {
    const current = map.current
    if (!current) return
    const center = coordinates(current.getCenter())!, bounds = current.getBounds()
    const sw = coordinates(bounds.getSouthWest()), ne = coordinates(bounds.getNorthEast())
    if (!sw || !ne) return
    const width=ne[0]-sw[0],height=ne[1]-sw[1]
    if(width>.06||height>.06){setScreenError('请放大到街区范围后标色。');return}
    if (width <= 0 || height <= 0) { setScreenError('当前视图不支持此范围，请重新定位到街区。'); return }
    const target: MapScreenBounds = {west:sw[0],east:ne[0],south:sw[1],north:ne[1]}
    clearScreen(); clearSelection(); setLayerPanel(false)
    const controller = new AbortController(), version = ++screenVersion.current
    screenAbort.current = controller; screenView.current = { longitude: center[0], latitude: center[1], zoom: current.getZoom() }
    setScreenRunning(true)
    try {
      await scanMap(target, profile, theme, controller.signal, event => {
        if (version !== screenVersion.current || controller.signal.aborted) return
        if (event.type === 'progress') setNotice(event.message)
        if (event.type === 'start') setScreenCells(event.cells)
        if (event.type === 'cell') { setScreenCells(cells => cells.map(c => c.id === event.cell.id ? event.cell : c)); setScreenProgress(event.completed) }
        if (event.type === 'complete') { setScreenCells(event.result.cells); setScreenResult(event.result) }
        if (event.type === 'error') setScreenError(event.message)
      })
    } catch (error) { if (version === screenVersion.current && !controller.signal.aborted) setScreenError(error instanceof Error ? error.message : '区域筛选未完成。') }
    finally { if (version === screenVersion.current) {setScreenRunning(false);setNotice('')} }
  }

  useEffect(() => {
    if (!ready) return
    let alive = true
    api<MapConfiguration>('/maps/config').then(value => { if (alive) { setConfig(value); if (!value.configured) setPhase('unconfigured') } })
      .catch(() => { if (alive) { setPhase('error'); setMapError('地图配置暂时无法读取，请刷新工作台重试。') } })
    return () => { alive = false }
  }, [ready])
  useEffect(() => { if (settingsRequest) setSettings(true) }, [settingsRequest])

  useEffect(() => {
    if (!config?.configured || !canvas.current) return
    let alive = true, instance: AMap.Map | null = null, clickTimer: ReturnType<typeof setTimeout> | undefined, hotspotAt = -1000, firstComplete = true
    setPhase('loading'); setMapError(''); setNotice('')
    const timeout = window.setTimeout(() => { if (alive) { setPhase('error'); setMapError('地图加载超时，请检查网络、高德 Key 和绑定域名。') } }, 20000)
    void loadAmap(config).then(api => {
      if (!alive || !canvas.current) return
      sdk.current = api
      const probe = document.createElement('canvas')
      const context = probe.getContext('webgl2') || probe.getContext('webgl')
      const has3D = !!context; context?.getExtension('WEBGL_lose_context')?.loseContext(); setWebgl(has3D)
      const imageLayer = new api.TileLayer.Satellite({ zIndex: 3 })
      layers.current = { satellite: imageLayer, visible: false, buildings: true, nativeBuildings: null }
      instance = new api.Map(canvas.current, { viewMode: has3D ? '3D' : '2D', pitch: has3D ? 55 : 0, rotation: 0, zoom: 17.2,
        center: DEFAULT_CENTER, zooms: [3, 20], dragEnable: true, zoomEnable: true,
        rotateEnable: has3D, pitchEnable: has3D, scrollWheel: true, isHotspot: true,
        showBuildingBlock: true, mapStyle: 'amap://styles/normal', skyColor: '#344f68' })
      map.current = instance
      instance.addControl(new api.Scale({ position: { bottom: '42px', left: '20px' } }))
      const cameraChanged = () => { if (alive && instance) setCamera({ zoom: instance.getZoom(), pitch: instance.getPitch(), rotation: instance.getRotation() }) }
      instance.on('complete', () => {
        if (!alive || !instance) return
        if (firstComplete) {
          firstComplete = false
          const actual3D = has3D && instance.getPitch() > 0
          setWebgl(actual3D)
          const buildingLayer = instance.getLayers().find(layer => {
            const identity = layer as { CLASS_NAME?: string; className?: string }
            return (identity.CLASS_NAME || identity.className) === 'AMap.Buildings'
          }) as { show(): void; hide(): void } | undefined
          layers.current!.nativeBuildings = buildingLayer && typeof buildingLayer.hide === 'function' && typeof buildingLayer.show === 'function' ? buildingLayer : null
          setBuildingControl(!!layers.current!.nativeBuildings)
          if (!actual3D) setNotice('当前浏览器未启用高德 3D，已显示 2D 地图。可在支持硬件加速的浏览器中打开。')
        }
        window.clearTimeout(timeout); setPhase('ready'); cameraChanged()
      })
      // JS API 2.0 emits pitchchange; its older type union does not list that event.
      for (const event of ['zoomend', 'rotatechange', 'pitchchange']) instance.on(event as Parameters<AMap.Map['on']>[0], cameraChanged)
      const viewChanged = () => { if (alive && screenView.current && instance) { const c = instance.getCenter(), old = screenView.current; setScreenStale(Math.abs(c.getLng() - old.longitude) > .00001 || Math.abs(c.getLat() - old.latitude) > .00001 || Math.abs(instance.getZoom() - old.zoom) > .01) } }
      instance.on('moveend', viewChanged); instance.on('zoomend', viewChanged)
      instance.on('click', (event: any) => {
        if (performance.now() - hotspotAt < 250) return
        window.clearTimeout(clickTimer)
        clickTimer = setTimeout(() => {
          const p = coordinates(event.lnglat)
          if (alive && p) selectRef.current({ id: `point-${p.join(',')}`, name: '选中的地图位置', kind: 'point', longitude: p[0], latitude: p[1], coordinate_encoding: 'GCJ-02' }, false)
        }, 160)
      })
      instance.on('hotspotclick', (event: any) => { hotspotAt = performance.now(); window.clearTimeout(clickTimer); const poi = normalizePoi(event); if (poi) selectRef.current(poi, false) })
    }).catch(() => { if (alive) { window.clearTimeout(timeout); setPhase('error'); setMapError('高德地图未能加载，请检查地图配置和网络连接。') } })
    return () => { alive = false; screenAbort.current?.abort(); window.clearTimeout(timeout); window.clearTimeout(clickTimer); instance?.destroy(); if (map.current === instance) map.current = null; marker.current = null; projectOverlays.current = []; screenOverlays.current = []; layers.current = null }
  }, [config?.revision])

  useEffect(() => {
    const current = map.current, api = sdk.current
    if (!current || !api || phase !== 'ready') return
    marker.current?.setMap(null); marker.current = null
    if (!selection || selectedCell) return
    const point = document.createElement('div'); point.className = 'atlas-marker'
    const core = document.createElement('span'); core.className = 'atlas-marker-core'; point.append(core)
    const label = document.createElement('span'); label.className = 'atlas-marker-label'; label.textContent = selection.name; point.append(label)
    marker.current = new api.Marker({ position: [selection.longitude, selection.latitude], content: point, anchor: 'center', bubble: false, zIndex: 200 })
    current.add(marker.current)
  }, [selection, selectedCell?.id, phase])
  useEffect(() => {
    const current = map.current, api = sdk.current
    if (!current || !api || phase !== 'ready') return
    current.remove(screenOverlays.current); screenOverlays.current = []
    for (const cell of screenCells) {
      if (!cell.geometry) continue
      const b = cell.bounds, color = SCREEN_TIERS[cell.tier].color
      const polygon = new api.Polygon({ path: cell.geometry?.coordinates as AMap.Vector2[][], fillColor: color,
        fillOpacity: cell.tier === 'pending' ? .05 : .27, strokeColor: color, strokeWeight: selectedCell?.id === cell.id ? 3 : 1.5, strokeStyle: cell.tier === 'incomplete' ? 'dashed' : 'solid', bubble: false, zIndex: 130 })
      polygon.on('click', () => chooseCellRef.current(cell))
      const label = document.createElement('button'); label.type = 'button'; label.className = 'screen-grid-label'; label.textContent = cell.label
      label.setAttribute('aria-label', `查看${cell.label}初筛`)
      label.style.borderColor = color
      label.onclick = event => { event.stopPropagation(); chooseCellRef.current(cell) }
      const pin = new api.Marker({ position: cell.anchor as AMap.Vector2, content: label, anchor: 'center', bubble: false, zIndex: 140 })
      screenOverlays.current.push(polygon, pin)
    }
    current.add(screenOverlays.current)
  }, [screenCells, selectedCell?.id, phase])
  useEffect(() => {
    if (!focusProject || !project) return
    clearSelection(); setProjectPreview(true); setResults(null)
    if (!map.current || !sdk.current || phase !== 'ready') return
    let alive = true
    map.current.remove(projectOverlays.current); projectOverlays.current = []
    void mapCoordinates(sdk.current, project).then(location => {
      if (!alive || !map.current || !sdk.current) return
      if (!location) { setNotice(project.input.synthetic ? '合成项目没有真实地理位置；地图保持自由浏览。' : '此项目还没有地图定位。可搜索并选中具体地点。'); return }
      const overlay = location.polygon
        ? new sdk.current.Polygon({ path: location.points, fillColor: '#5bdfc1', fillOpacity: 0.10, strokeColor: '#74ebd4', strokeWeight: 2, strokeStyle: 'dashed', bubble: false })
        : new sdk.current.Marker({ position: location.points[0], title: project.name })
      projectOverlays.current = [overlay]; map.current.add(overlay)
      overlay.on('click', () => { clearSelection(); setProjectPreview(true) })
      if (location.polygon) map.current.setFitView([overlay], false, [160, 370, 160, 140], 18)
      else map.current.setZoomAndCenter(17, location.points[0])
    }).catch(() => { if (alive) setNotice('项目坐标转换未完成，未把原坐标直接叠加到高德底图。') })
    return () => { alive = false }
  }, [focusProject, project?.id, phase])
  useEffect(() => {
    const current = map.current, available = layers.current
    if (!current || !available || phase !== 'ready') return
    // Attach/detach only our satellite overlay; keep the provider's native
    // building and label layers mounted across basemap changes.
    if (satellite !== available.visible) {
      if (satellite) current.add(available.satellite); else current.remove(available.satellite)
      available.visible = satellite
    }
    const showBuildings = buildings && webgl
    if (showBuildings !== available.buildings) {
      if (showBuildings) available.nativeBuildings?.show(); else available.nativeBuildings?.hide()
      available.buildings = showBuildings
    }
  }, [satellite, buildings, phase, webgl])
  useEffect(() => () => { selectionVersion.current++; searchVersion.current++; screenAbort.current?.abort() }, [])

  async function openDetails() {
    if (!selection || !sdk.current) return
    const version = ++selectionVersion.current
    setExpanded(true); setDetailLoading(true); setDetailsError('')
    try { const value = await placeDetails(sdk.current, selection); if (selectionVersion.current === version) setDetails(value) }
    catch (e) { if (selectionVersion.current === version) setDetailsError(e instanceof Error ? e.message : '详情加载失败') }
    finally { if (selectionVersion.current === version) setDetailLoading(false) }
  }
  const interactive = phase === 'ready'
  return <section className="atlas-view" aria-label="地图空间探索">
    <div className="atlas-map" ref={canvas} aria-label="高德交互地图" data-map-status={phase} />
    <div className="atlas-vignette" />
    <div className="atlas-search-wrap">
      <form className="atlas-search glass-panel" role="search" onSubmit={async e => {
        e.preventDefault(); if (!sdk.current || !interactive || !query.trim()) return
        const version = ++searchVersion.current; setSearching(true); setNotice('')
        try { const found = await searchPlaces(sdk.current, query.trim()); if (searchVersion.current === version) setResults(found) }
        catch (e) { if (searchVersion.current === version) setNotice(e instanceof Error ? e.message : '搜索失败') }
        finally { if (searchVersion.current === version) setSearching(false) }
      }}>
        <IconSearch size={20} /><input aria-label="搜索城市、建筑或地点" placeholder="搜索城市、建筑、园区或景观…" value={query} onChange={e => { setQuery(e.target.value); searchVersion.current++; setSearching(false); setResults(null) }} onKeyDown={e => { if (e.key === 'Escape') setResults(null) }} />
        {query && <button type="button" className="map-icon-button" aria-label="清空地点搜索" onClick={() => { searchVersion.current++; setQuery(''); setResults(null); setSearching(false) }}><IconX size={16} /></button>}
        <button type="submit" disabled={!interactive || searching || !query.trim()}>{searching ? '搜索中' : '搜索'}</button>
      </form>
      {results && <div className="atlas-search-results glass-panel" aria-label="地点搜索结果">{results.length ? results.map(place => <button key={place.id} onClick={() => selectPlace(place)}>
        <IconMapPin size={18} /><span><strong>{place.name}</strong><small>{[place.city, place.address].filter(Boolean).join(' · ') || place.category || '高德地图地点'}</small></span><IconArrowRight size={15} />
      </button>) : <p>没有找到匹配地点，试试更完整的地名。</p>}</div>}
    </div>
    <ScreeningControls theme={theme} onTheme={value => {
      setTheme(value)
      if (screenResult) { const cells = classifyCells(screenResult.cells, value); setScreenCells(cells); setScreenResult({...screenResult, theme: value, cells, status: cells.length ? 'completed' : 'partial', comparison_count: cells.filter(c => c.tier !== 'incomplete').length}); setSelectedCell(current => current ? cells.find(c => c.id === current.id) || null : null) }
    }} running={screenRunning} completed={screenProgress}
      cells={screenCells} result={screenResult} error={screenError} enabled={interactive} stale={screenStale}
      onScan={() => void startScreen()} onCancel={() => { screenAbort.current?.abort(); screenVersion.current++; setScreenRunning(false); setScreenCells(cells => cells.map(c => ({ ...c, tier: 'incomplete' }))); setScreenError('已停止。') }} onClear={clearScreen} onCell={chooseCell} onData={() => setDataOpen(true)} />
    {dataOpen && <DataSourcesPanel onClose={() => setDataOpen(false)} onOpenProject={id => { setDataOpen(false); onOpenProject(id) }} />}
    <div className="atlas-status glass-panel"><i className={interactive ? 'is-live' : ''} />{interactive ? `高德地图 · ${satellite ? '卫星影像' : webgl && camera.pitch > 0 ? '3D 城市' : '2D 浏览'}` : phase === 'loading' ? '地图连接中' : '地图待连接'}</div>

    {phase !== 'ready' && <div className="atlas-connection">
      <div className="atlas-orbit" aria-hidden="true"><IconCube size={56} stroke={1} /><span /><span /></div>
      <div className="map-eyebrow">建工 AI</div>
      <h1>{phase === 'loading' ? '正在展开城市空间' : phase === 'unconfigured' ? '从一张真实地图开始' : '地图连接暂未完成'}</h1>
      <p>{phase === 'loading' ? '正在连接高德底图与地点服务…' : phase === 'unconfigured' ? '连接高德后，缩放街区、查看 3D 建筑，\n点选感兴趣的位置，再深入了解。' : mapError}</p>
      {phase !== 'loading' && <button className="map-primary" onClick={() => setSettings(true)}><IconKeyVisual />{config?.configured ? '检查地图配置' : '连接高德地图'}<IconArrowRight size={17} /></button>}
      {phase === 'error' && <button className="map-text-button" onClick={() => window.location.reload()}>重新加载地图</button>}
      {phase === 'unconfigured' && <small>请配置地图 Key</small>}
    </div>}

    {(selection || projectPreview && project) && <aside className={`atlas-inspector glass-panel ${expanded ? 'is-expanded' : ''} ${selection ? 'with-assessment' : ''}`} aria-label={expanded ? '地点详细信息' : '选中对象简要信息'}>
      <div className="map-card-heading"><span className="map-eyebrow">{projectPreview ? '项目' : expanded ? '地点详情' : '已选位置'}</span><button className="map-icon-button" onClick={clearSelection} aria-label="取消选中"><IconX size={18} /></button></div>
      {projectPreview && project ? <>
        <div className="atlas-selection-icon"><IconBuildingSkyscraper size={27} stroke={1.4} /></div><h2>{project.name}</h2><p>{project.input.scope.name}</p>
        <div className="atlas-selection-tags"><span>{project.input.synthetic ? '合成项目' : '研究项目'}</span><span>经验 v{project.context_version}</span></div>
        <div className="atlas-facts"><div><span>已有来源</span><strong>{new Set([...project.input.sources, ...(project.runs?.find(r => r.decision)?.decision?.sources || [])].map(s => s.id)).size}<small> 份</small></strong></div><div><span>研究边界</span><strong>{project.input.scope.geometry && !project.input.synthetic ? '已提供' : '待补充'}</strong></div></div>
        <p className="atlas-evidence-note">打开研判后可查看项目资料、实施路径与调查清单。</p>
        {project.runs?.find(r => r.decision)?.decision && <p className="project-last-summary">上次研判：{project.runs.find(r => r.decision)!.decision!.summary}</p>}
        <button className="map-primary" onClick={() => onOpenProject()}>进入项目研判 <IconArrowRight size={17} /></button>
      </> : selection && <>
        {expanded && <div className="atlas-selection-icon"><IconMapPin size={28} stroke={1.4} /></div>}<h2>{selection.name}</h2><p>{selection.address || ''}</p>
        <div className="atlas-selection-tags"><span>{selection.category?.split(';')[0] || (selection.kind === 'poi' ? '地图地点' : '坐标点')}</span></div>
        {expanded && <div className="atlas-coordinate"><span>位置 · GCJ-02</span><code>{selection.longitude.toFixed(6)}, {selection.latitude.toFixed(6)}</code></div>}
        <div hidden={expanded}><PreliminaryCard selection={selection} profile={profile} theme={theme} cell={selectedCell} onProfile={value=>{
          setProfile(value)
          const reset=(cells:MapScreenCell[])=>classifyCells(cells.map(c=>({...c,factors:undefined,dashboard:undefined})),theme)
          setScreenCells(reset);setSelectedCell(c=>c?reset([c])[0]:null)
          setScreenResult(prev=>prev?{...prev,profile:value,cells:reset(prev.cells)}:prev)
        }} onOpenProject={onOpenProject}
          onAssessment={(id, result) => {
            if (!result.assessment) return
            setScreenCells(prev => classifyCells(prev.map(c => c.context?.id === id ? {...c, factors: result.assessment!.factors, dashboard: result.decision_support?.dashboard} : c), theme))
            setSelectedCell(prev => prev?.context?.id === id ? classifyCells([{...prev, factors: result.assessment!.factors, dashboard: result.decision_support?.dashboard}],theme)[0] : prev)
            setScreenResult(prev => prev ? {...prev,cells:classifyCells(prev.cells.map(c=>c.context?.id===id?{...c,factors:result.assessment!.factors,dashboard:result.decision_support?.dashboard}:c),theme)} : prev)
          }}
          onContext={(id, context) => {
            setPreviewContext({forId:id,context})
            const update=(c:MapScreenCell)=>c.context?.id===id||c.context?.id===context.id?{...c,context,...(c.context.id!==context.id?{factors:undefined,dashboard:undefined,analysis_available:false}:{})}:c
            setScreenCells(prev=>classifyCells(prev.map(update),theme));setSelectedCell(prev=>prev?classifyCells([update(prev)],theme)[0]:null)
            setScreenResult(prev=>prev?{...prev,cells:classifyCells(prev.cells.map(update),theme)}:prev)
            if(context.address)setSelection(current=>current?.id===id?{...current,address:context.address!}:current)
          }} /></div>
        {!expanded ? <div className="assessment-actions"><button className="map-primary" onClick={() => onCreateFromPlace(placeForResearch(selection, details), previewContext?.forId === selection.id ? previewContext.context : null)}>建立项目 <IconArrowRight size={17} /></button><button className="map-text-button" onClick={() => void openDetails()}>查看地点详情</button></div> : <>
          <div className="atlas-detail-divider" />
          {detailLoading && <p role="status" className="atlas-detail-loading">正在读取地点资料…</p>}
          {detailsError && <div className="map-error" role="alert">{detailsError}<button className="map-text-button" onClick={() => void openDetails()}>重试</button></div>}
          {details && <><dl className="atlas-detail-fields"><div><dt>详细地址</dt><dd>{details.address || '该地点未返回详细地址'}</dd></div><div><dt>地点分类</dt><dd>{details.category}</dd></div>{details.telephone && <div><dt>联系电话</dt><dd>{details.telephone}</dd></div>}</dl>
            {details.photos.length > 0 && <div className="atlas-photos">{details.photos.map(photo => <img key={photo.url} src={photo.url} alt={photo.title || `${selection.name}的地点照片`} loading="lazy" referrerPolicy="no-referrer" />)}</div>}
            </>}
          <button className="map-primary" onClick={() => onCreateFromPlace(placeForResearch(selection, details), previewContext?.forId === selection.id ? previewContext.context : null)}>建立项目 <IconArrowRight size={17} /></button>
          <div className="atlas-detail-actions"><button className="map-text-button" onClick={() => { selectionVersion.current++; setExpanded(false); setDetailLoading(false) }}><IconArrowLeft size={14} />返回简要信息</button>
            <a href={`https://uri.amap.com/marker?position=${selection.longitude},${selection.latitude}&name=${encodeURIComponent(selection.name)}&coordinate=gaode&callnative=0`} target="_blank" rel="noreferrer">高德查看 <IconExternalLink size={13} /></a></div>
        </>}
      </>}
    </aside>}

    {notice && <div className="atlas-notice glass-panel" role="status"><span>{notice}</span><button className="map-icon-button" onClick={() => setNotice('')} aria-label="关闭地图提示"><IconX size={15} /></button></div>}
    <div className="atlas-layer-control">
      {layerPanel && <section className="atlas-layer-panel glass-panel" aria-label="地图图层"><h3>观看城市的不同方式</h3>
        <button disabled={!interactive} aria-pressed={!satellite} onClick={() => setSatellite(false)}><IconCube size={20} /><span>城市地图<small>道路、建筑与景观标注</small></span>{!satellite && <i />}</button>
        <button disabled={!interactive} aria-pressed={satellite} onClick={() => setSatellite(true)}><IconSatellite size={20} /><span>卫星影像<small>查看地表与周边环境</small></span>{satellite && <i />}</button>
        <label><span><IconBuildingSkyscraper size={17} /> 3D 建筑楼块</span><input type="checkbox" checked={buildings} disabled={!interactive || !webgl || !buildingControl} onChange={e => setBuildings(e.target.checked)} /></label>
        <p>{satellite ? '卫星影像' : '城市地图'}</p>
      </section>}
      <button className={`atlas-layer-toggle glass-panel ${layerPanel ? 'active' : ''}`} aria-expanded={layerPanel} onClick={() => setLayerPanel(v => !v)}><IconLayersIntersect size={19} />图层<span>{satellite ? '卫星' : '城市'}</span></button>
    </div>
    <div className="atlas-navigation glass-panel" aria-label="地图视角控制">
      <button title="正北朝向" aria-label="正北朝向" disabled={!interactive} onClick={() => map.current?.setRotation(0)}><IconNavigation size={21} style={{ transform: `rotate(${-camera.rotation}deg)` }} /><small>N</small></button>
      <span className="atlas-control-divider" />
      <button title="放大地图" aria-label="放大地图" disabled={!interactive} onClick={() => map.current?.zoomIn()}><IconPlus size={22} /></button>
      <button title="缩小地图" aria-label="缩小地图" disabled={!interactive} onClick={() => map.current?.zoomOut()}><IconMinus size={22} /></button>
      <span className="atlas-control-divider" />
      <button title="切换俯视与立体视角" aria-label="切换2D和3D视角" disabled={!interactive || !webgl} onClick={() => map.current?.setPitch(camera.pitch > 0 ? 0 : 55)}><strong>{camera.pitch > 0 ? '3D' : '2D'}</strong></button>
      <button title="回到选中位置" aria-label="回到选中位置" disabled={!interactive || !selection} onClick={() => { if (selection) map.current?.setZoomAndCenter(17, [selection.longitude, selection.latitude]) }}><IconFocus2 size={22} /></button>
    </div>
    <div className="atlas-bottom-hint"><span className="atlas-mouse-symbol" />滚轮缩放<span>·</span>拖拽平移<span>·</span>右键调整视角</div>
    {interactive && <div className="atlas-camera-readout"><span>ZOOM <b>{camera.zoom.toFixed(1)}</b></span><span>PITCH <b>{Math.round(camera.pitch)}°</b></span></div>}
    {settings && <MapSettings configured={!!config?.configured} onClose={() => setSettings(false)} onSaved={value => { clearSelection(); setConfig(value); setSettings(false) }} />}
  </section>
}
function IconKeyVisual() { return <IconAdjustments size={18} /> }
