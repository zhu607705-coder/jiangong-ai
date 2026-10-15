import type { RenewalStrategy } from '../../../apps/host/generated/contracts'
import type { StrategySource } from '../../../packages/retrofit/strategy'

/** Isolated contract data; these candidate works are not a real project assessment. */
export function withConcreteWorkPlan<T extends RenewalStrategy>(value:T,source:StrategySource):T {
  for(const path of value.paths)path.work_packages=[
    {id:`${path.mode}-PIPE`,target:path.mode==='comprehensive'?'既有供水管网':'拟建住宅给水管网',target_basis:'project_scope',source_id:source.id,quote:source.text,locator:source.locator,
      intervention:path.mode==='comprehensive'?'更换老化给水立管':'新建住宅给水管网',scope:'当前项目内的供水设施候选方案，长度待设计确定。',quantity:null,unit:null,quantity_basis:'unknown',delivery:'形成可维护的给水管网。',priority:'first',preconditions:['核实设计与资金条件。'],evidence_refs:[source.id]},
    {id:`${path.mode}-METER`,target:path.mode==='comprehensive'?'既有分户计量设施':'拟建分户计量设施',target_basis:'project_scope',source_id:source.id,quote:source.text,locator:source.locator,
      intervention:path.mode==='comprehensive'?'改造分户计量设施':'配置分户计量设备',scope:'当前项目内的计量设施候选方案，数量待设计确定。',quantity:null,unit:null,quantity_basis:'unknown',delivery:'形成分户计量与检修条件。',priority:'next',preconditions:['核实设备布置与维护责任。'],evidence_refs:[source.id]},
  ]
  value.internal_data_requests=[
    {id:'REQ-WELLBEING',key:'resident_wellbeing',metric:'居民满意度与幸福度',purpose:'调整居民影响和服务优先级。',collection_method:'按楼幢抽样问卷并保留原选项。',unit:'分及人数',period:'同一调查周',denominator:'有效答卷人数，按楼幢分别登记。',related_package_ids:['comprehensive-PIPE'],evidence_refs:[source.id]},
    {id:'REQ-ELEVATOR',key:'elevator_usage',metric:'分幢电梯使用量',purpose:'比较加梯配置与维护安排。',collection_method:'连续观察或读取设备匿名计数。',unit:'人次/日',period:'连续7日含工作日与周末',denominator:'各幢实际观察天数与服务户数。',related_package_ids:[],evidence_refs:[]},
    {id:'REQ-MEAL',key:'meal_attendance',metric:'食堂实际用餐人数',purpose:'确定助餐容量和运营安排。',collection_method:'按餐次去重登记用餐人数。',unit:'人/餐',period:'连续7日午晚餐',denominator:'实际开餐次数及符合服务条件的人数。',related_package_ids:[],evidence_refs:[]},
  ]
  return value
}
