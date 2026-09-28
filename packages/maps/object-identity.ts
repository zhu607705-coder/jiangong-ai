import type { Fact, MapProjectEvidence, MapScreenTarget } from '../../apps/host/generated/contracts'

export const genericMapLabel=(label:string)=>/^(道路|水系|建筑轮廓|街区|片区|建筑群|园区|建筑|校园|校区|选中的地图位置)[\s\d]*$/.test(label.trim())

/** A project's presence nearby is not a mapping from every fact to this object. */
export function factAppliesToTarget(fact:Fact,project:Pick<MapProjectEvidence,'project_id'>,target?:MapScreenTarget):boolean {
  // The project workflow explicitly requests the whole project. Map requests
  // always have a target and must carry a resolved object reference.
  if(!target)return true
  if(!target.object_ref)return false
  if(fact.scope_kind==='shared')return !!fact.applies_to?.includes(target.object_ref)
  if(fact.scope_kind==='project')return target.boundary_source===`project:${project.project_id}`||target.object_ref===`project:${project.project_id}`
  return fact.object_ref===target.object_ref
}
