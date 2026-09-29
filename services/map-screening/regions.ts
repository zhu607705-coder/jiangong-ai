import { config } from '../../apps/host/config'
import { validate } from '../../packages/contracts/validate'
import type { MapScreenBounds, MapScreenCell, MapRegionGeometry } from '../../apps/host/generated/contracts'
import type { ProjectEvidenceSnapshot } from './project-evidence'

export type RegionResult = { cells:MapScreenCell[]; notes:string[] }
export type RegionResolver = (bounds:MapScreenBounds,snapshot:ProjectEvidenceSnapshot,signal:AbortSignal,geometry?:MapRegionGeometry)=>Promise<RegionResult>
export type TopologyValidator=(geometry:MapRegionGeometry,signal:AbortSignal)=>Promise<void>
export const validateRegionTopology:TopologyValidator=async(geometry,signal)=>{
  const response=await fetch(config.capabilityUrl+'/spatial/validate-geometry',{method:'POST',signal:AbortSignal.any([signal,AbortSignal.timeout(10000)]),headers:{'Content-Type':'application/json','X-Capability-Token':config.capabilityToken},body:JSON.stringify({geometry})})
  if(!response.ok||(await response.json() as {valid?:boolean}).valid!==true)throw new Error('INVALID_REGION_TOPOLOGY')
}
export const resolveMapRegions:RegionResolver = async(bounds,snapshot,signal,geometry)=> {
  const boundaries=snapshot.projects.filter(p=>!p.project.input.synthetic&&p.project.input.scope.geometry).slice(0,100).map(({project})=>({
    id:project.id,label:project.name.slice(0,40),geometry:project.input.scope.geometry,coordinate_encoding:project.input.scope.coordinate_encoding,
  }))
  const response=await fetch(config.capabilityUrl+'/spatial/regions',{
    method:'POST',signal:AbortSignal.any([signal,AbortSignal.timeout(22000)]),
    headers:{'Content-Type':'application/json','X-Capability-Token':config.capabilityToken},body:JSON.stringify({...bounds,boundaries,partial_project_boundaries:true,...(geometry?{clip_geometry:geometry}:{})}),
  })
  if(!response.ok)throw new Error(response.status===422?'REGION_INPUT_REJECTED':'REGION_PROVIDER_UNAVAILABLE')
  const result=await response.json() as {cells:unknown[];total:number;truncated:boolean;attribution:string;provider_status:string;skipped_project_boundaries?:number}
  if(!Array.isArray(result.cells)||result.cells.length>24)throw new Error('INVALID_REGIONS')
  const cells:MapScreenCell[]=[];let skipped=0
  for(const c of result.cells){try{cells.push(validate<MapScreenCell>('MapScreenCell',c))}catch{skipped++}}
  // Unknown boundaries stay empty; never fabricate a replacement grid.
  const notes=[result.attribution]
  if(result.provider_status==='unavailable')notes.push('公开街区边界服务未返回，当前仅使用已有项目范围。可框选区域直接研究。')
  if(result.skipped_project_boundaries)notes.push(`已隔离 ${result.skipped_project_boundaries} 个不支持的项目边界；其余对象继续筛选。`)
  if(skipped)notes.push(`已隔离 ${skipped} 个不符合几何契约的对象。`)
  if(result.truncated)notes.push('范围内对象较多，本轮取中心附近24个；缩小视野可查看其余对象。')
  if(!cells.length)notes.push('此处暂未取得街区边界，可点选建筑研判。')
  return {cells,notes}
}
