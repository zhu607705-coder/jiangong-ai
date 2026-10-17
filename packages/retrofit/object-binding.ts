import type {ProjectInput} from '../../apps/host/generated/contracts'
import {administrativeAddress,objectLocationConflicts} from '../research/evidence'
import type {StrategySource} from './strategy'

export type ObjectBinding = {
  policy:'object-context-v1'; relation:'same_object'|'different_object'|'unresolved'|'comparable_case';
  basis:'explicit_location_conflict'|'registered_project'|'name_candidate'|'reference'|'reviewed_evidence';
  project_id:string; city:string|null; reason:string
}
/** Read explicit registered address/name prefixes when legacy projects have no separate city field. */
export function projectObjectLocation(scope:ProjectInput['scope']) {
  const address=scope.map_anchor?.address||scope.name
  return {address,city:scope.city||administrativeAddress(address).city}
}
export function bindStrategySource(source:StrategySource,project:Pick<ProjectInput,'project_id'|'scope'|'sources'>&Partial<Pick<ProjectInput,'facts'|'as_of'>>):StrategySource {
  const name=project.scope.map_anchor?.name||project.scope.name
  const passages=source.text.split(/[。；;\n]/).filter(line=>line.includes(name)||/^(?:建设地点|项目地址|建设地址)[:：]/.test(line.trim())).join('。')
  const original=project.sources.find(row=>row.id===source.id),projectRefs=original?.object_refs?.filter(ref=>ref.startsWith('project:'))||[]
  const foreign=projectRefs.length&&!projectRefs.includes(`project:${project.project_id}`)&&!projectRefs.includes(project.scope.boundary_source||'')?projectRefs[0].slice('project:'.length):undefined
  const registered=foreign||source.project_id||(projectRefs.includes(`project:${project.project_id}`)?project.project_id:undefined)
  let binding=bindObjectPassage(project,source.title,passages,registered,source.role==='reference'&&source.object_binding?.relation!=='different_object')
  const reviewed=project.facts?.some(fact=>fact.source_id===source.id&&fact.epistemic_status==='fact'&&!!fact.observed_at&&!!fact.locator&&(fact.object_ref===`project:${project.project_id}`||fact.scope_kind==='project')&&(!project.as_of||Date.parse(fact.observed_at)<=Date.parse(project.as_of+'T23:59:59.999Z')))
  if(binding.relation==='unresolved'&&reviewed&&source.role==='current')binding={...binding,relation:'same_object',basis:'reviewed_evidence',reason:'对象范围由已登记且带时点、定位的事实记录关联；各项金额与实施条件仍分别核对。'}
  return {...source,role:binding.relation==='different_object'?'reference':source.role,object_binding:binding}
}
/** Assess the supplied passage, not unrelated footer or other cases elsewhere in a file. */
export function bindObjectPassage(project:Pick<ProjectInput,'project_id'|'scope'>, title:string, passage:string, registeredProject?:string, reference=false):ObjectBinding {
  const location=projectObjectLocation(project.scope),city=location.city||null,name=project.scope.map_anchor?.name||project.scope.name
  const base={policy:'object-context-v1' as const,project_id:project.project_id,city}
  if(reference)return {...base,relation:'comparable_case',basis:'reference',reason:'对标资料只用于方法和方案参考。'}
  if(registeredProject&&registeredProject!==project.project_id||objectLocationConflicts(title,location,name)||objectLocationConflicts(passage,location,name))
    return {...base,relation:'different_object',basis:'explicit_location_conflict',reason:'资料中的对象或明确地点与项目登记不一致，保留为异地参考，请核对对象地址。'}
  if(registeredProject===project.project_id)return {...base,relation:'unresolved',basis:'registered_project',reason:'资料登记在本项目；物理对象与工程范围仍需核对。'}
  return {...base,relation:'unresolved',basis:'name_candidate',reason:'同名原文作为候选依据，对象地址仍需核对。'}
}
