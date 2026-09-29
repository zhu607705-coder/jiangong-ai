import type { MapScreenTarget } from '../../apps/host/generated/contracts'
export type PixelPoint={x:number;y:number}
/** A screen drag becomes a real user polygon, never a claimed parcel. */
export function rectangleTarget(a:PixelPoint,b:PixelPoint,toGeo:(p:PixelPoint)=>[number,number]):MapScreenTarget {
  if(Math.abs(a.x-b.x)<8||Math.abs(a.y-b.y)<8)throw Error('请拖出一个区域，而不是单击。')
  const left=Math.min(a.x,b.x),right=Math.max(a.x,b.x),top=Math.min(a.y,b.y),bottom=Math.max(a.y,b.y)
  const ring=[{x:left,y:top},{x:right,y:top},{x:right,y:bottom},{x:left,y:bottom}].map(toGeo)
  if(ring.some(p=>p.length!==2||p.some(v=>!Number.isFinite(v))))throw Error('坐标读取失败，请重画范围。')
  const xs=ring.map(p=>p[0]),ys=ring.map(p=>p[1]),bounds={west:Math.min(...xs),east:Math.max(...xs),south:Math.min(...ys),north:Math.max(...ys)}
  if(bounds.east-bounds.west>.06||bounds.north-bounds.south>.06)throw Error('请缩小框选范围到一个街区附近。')
  if(bounds.east<=bounds.west||bounds.north<=bounds.south||bounds.west < -180||bounds.east>180||bounds.south<=-85||bounds.north>=85)throw Error('范围坐标无效。')
  ring.push([...ring[0]])
  return {kind:'cell',bounds,geometry:{type:'Polygon',coordinates:[ring]},radius_m:null,longitude:(bounds.west+bounds.east)/2,latitude:(bounds.south+bounds.north)/2,
    label:'框选区域',label_origin:'unresolved',boundary_source:'user:rectangle'}
}
export function isTypingTarget(target:EventTarget|null):boolean {
  return target instanceof HTMLElement&&(target.isContentEditable||!!target.closest('input,textarea,select,[contenteditable=true]'))
}
