import { config } from '../../apps/host/config'
import { validate } from '../../packages/contracts/validate'
import type { MapScreenBounds, MapScreenCell } from '../../apps/host/generated/contracts'
import type { ProjectEvidenceSnapshot } from './project-evidence'

export type RegionResult = { cells:MapScreenCell[]; notes:string[] }
export type RegionResolver = (bounds:MapScreenBounds,snapshot:ProjectEvidenceSnapshot,signal:AbortSignal)=>Promise<RegionResult>
export const resolveMapRegions:RegionResolver = async(bounds,snapshot,signal)=> {
  const boundaries=snapshot.projects.filter(p=>p.project.input.scope.geometry).slice(0,100).map(({project})=>({
    id:project.id,label:project.name.slice(0,40),geometry:project.input.scope.geometry,coordinate_encoding:'WGS84',
  }))
  const response=await fetch(config.capabilityUrl+'/spatial/regions',{
    method:'POST',signal:AbortSignal.any([signal,AbortSignal.timeout(22000)]),
    headers:{'Content-Type':'application/json','X-Capability-Token':config.capabilityToken},body:JSON.stringify({...bounds,boundaries}),
  })
  if(!response.ok)throw new Error('REGION_PROVIDER_UNAVAILABLE')
  const result=await response.json() as {cells:unknown[];total:number;truncated:boolean;attribution:string;provider_status:string}
  if(!Array.isArray(result.cells)||result.cells.length>24)throw new Error('INVALID_REGIONS')
  const cells=result.cells.map(c=>validate<MapScreenCell>('MapScreenCell',c))
  // Unknown boundaries stay empty; never fabricate a replacement grid.
  const notes=[result.attribution]
  if(result.truncated)notes.push('范围内对象较多，本轮取中心附近24个；缩小视野可查看其余对象。')
  if(!cells.length)notes.push('此处暂未取得街区边界，可点选建筑研判。')
  return {cells,notes}
}
