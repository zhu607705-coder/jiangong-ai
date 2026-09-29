import './area-selection.css'
import {useEffect,useRef,useState} from 'react'
import type {MapScreenTarget} from '../../../host/generated/contracts'
import {rectangleTarget,type PixelPoint} from '../../../../packages/maps/area-selection'
import {coordinates,type AmapSdk} from './amap-client'

export default function AreaSelectionOverlay({map,sdk,onConfirm,onClose}:{map:AMap.Map;sdk:AmapSdk;onConfirm:(target:MapScreenTarget,signal:AbortSignal)=>Promise<void>;onClose:()=>void}){
  const [start,setStart]=useState<PixelPoint|null>(null),[end,setEnd]=useState<PixelPoint|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('')
  const drag=useRef(false),controller=useRef<AbortController|null>(null),confirmRef=useRef(()=>{})
  useEffect(()=>{
    const camera={pitch:map.getPitch(),rotation:map.getRotation()},status=map.getStatus()
    // Top-down north-up avoids a trapezoidal ground footprint from perspective.
    map.setPitch(0);map.setRotation(0);map.setStatus({dragEnable:false,zoomEnable:false,rotateEnable:false,pitchEnable:false,keyboardEnable:false,doubleClickZoom:false})
    const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();controller.current?.abort();onClose()}else if(e.key==='Enter'){e.preventDefault();confirmRef.current()}}
    window.addEventListener('keydown',key)
    return()=>{window.removeEventListener('keydown',key);controller.current?.abort();map.setStatus(status);map.setPitch(camera.pitch);map.setRotation(camera.rotation)}
  },[map,sdk])
  async function confirm(){if(!start||!end||busy)return
    const c=new AbortController();controller.current=c;setError('');setBusy(true)
    try{const target=rectangleTarget(start,end,p=>{const result=coordinates(map.containerToLngLat(new sdk.Pixel(p.x,p.y)));if(!result)throw Error('坐标读取失败。');return result});await onConfirm(target,c.signal);if(!c.signal.aborted)onClose()}
    catch(e){if(!c.signal.aborted)setError((e as Error).message)}finally{if(!c.signal.aborted)setBusy(false)}
  }
  confirmRef.current=()=>void confirm()
  const point=(e:React.PointerEvent<HTMLDivElement>)=>{const rect=e.currentTarget.getBoundingClientRect();return {x:Math.max(0,Math.min(rect.width,e.clientX-rect.left)),y:Math.max(0,Math.min(rect.height,e.clientY-rect.top))}}
  return <div className="area-selection-overlay" role="region" aria-label="区域框选画布"
    onPointerDown={e=>{if(busy||e.button!==0||(e.target as HTMLElement).closest('button,.area-selection-toolbar'))return;e.preventDefault();drag.current=true;e.currentTarget.setPointerCapture(e.pointerId);setStart(point(e));setEnd(point(e));setError('')}}
    onPointerMove={e=>{if(drag.current)setEnd(point(e))}}
    onPointerUp={e=>{if(!drag.current)return;drag.current=false;setEnd(point(e));if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId)}}
    onPointerCancel={()=>{drag.current=false;setStart(null);setEnd(null)}}>
    {start&&end&&<div className="area-selection-box" style={{left:Math.min(start.x,end.x),top:Math.min(start.y,end.y),width:Math.abs(start.x-end.x),height:Math.abs(start.y-end.y)}}/>}
    <div className="area-selection-toolbar glass-panel"><span>{busy?'读取所选范围资料…':'左键拖出范围 · Enter 确认 · Esc 取消'}</span><button className="map-primary" disabled={!start||!end||busy} onClick={()=>void confirm()}>确认范围</button><button className="map-text-button" onClick={()=>{controller.current?.abort();onClose()}}>取消</button>{error&&<p role="alert">{error}</p>}</div>
  </div>
}
