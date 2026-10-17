import type {ProjectInput} from '../../apps/host/generated/contracts'
import {objectLocationConflicts} from '../research/evidence'
import type {StrategySource} from './strategy'

export type ObjectBinding = {
  policy:'object-context-v1'; relation:'same_object'|'different_object'|'unresolved'|'comparable_case';
  basis:'explicit_location_conflict'|'registered_project'|'name_candidate'|'reference';
  project_id:string; city:string|null; reason:string
}
export function bindStrategySource(source:StrategySource,project:Pick<ProjectInput,'project_id'|'scope'|'sources'>):StrategySource {
  const name=project.scope.map_anchor?.name||project.scope.name
  const passages=source.text.split(/[。；;\n]/).filter(line=>line.includes(name)||/^(?:建设地点|项目地址|建设地址)[:：]/.test(line.trim())).join('。')
  const registered=source.project_id||(project.sources.some(row=>row.id===source.id&&row.object_refs?.includes(`project:${project.project_id}`))?project.project_id:undefined)
  const binding=bindObjectPassage(project,source.title,passages,registered,source.role==='reference'&&source.object_binding?.relation!=='different_object')
  return {...source,role:binding.relation==='different_object'?'reference':source.role,object_binding:binding}
}
/** Assess the supplied passage, not unrelated footer or other cases elsewhere in a file. */
export function bindObjectPassage(project:Pick<ProjectInput,'project_id'|'scope'>, title:string, passage:string, registeredProject?:string, reference=false):ObjectBinding {
  const city=project.scope.city||null,name=project.scope.map_anchor?.name||project.scope.name
  const base={policy:'object-context-v1' as const,project_id:project.project_id,city}
  if(reference)return {...base,relation:'comparable_case',basis:'reference',reason:'对标资料只用于方法和方案参考。'}
  if(registeredProject&&registeredProject!==project.project_id||objectLocationConflicts(title,{city:city||undefined},name)||objectLocationConflicts(passage,{city:city||undefined},name))
    return {...base,relation:'different_object',basis:'explicit_location_conflict',reason:'资料中的对象或明确地点与项目登记不一致，保留为异地参考，请核对对象地址。'}
  if(registeredProject===project.project_id)return {...base,relation:'unresolved',basis:'registered_project',reason:'资料登记在本项目；物理对象与工程范围仍需核对。'}
  return {...base,relation:'unresolved',basis:'name_candidate',reason:'同名原文作为候选依据，对象地址仍需核对。'}
}
