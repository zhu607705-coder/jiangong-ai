import type { DimensionEvidence, ProjectInput, ResearchDimension } from '../../apps/host/generated/contracts'
import { eligibleDimension } from '../research/evidence'
import { documentSlices } from '../experience/document-slices'
import { NEIGHBORHOOD_FACTOR_FIELDS } from '../maps/decision-factors'
import type { DashboardInput } from './dashboard'

const FACT_KINDS:Record<ResearchDimension,readonly string[]>={
  demand:['resident_needs','resident_household','resident_survey'],supply:['service_gap','public_service','public_service_capacity'],
  adaptation:['engineering_review','engineering_condition','building_inventory'],implementation:['resident_consent','implementation_scope','implementation_arrangement'],
  operations:['maintenance_arrangement','maintenance_cost'],resources:['funding_arrangement','project_budget','engineering_cost'],
}
/** Select already located project facts; do not create evidence from POI counts or from a document's mere existence. */
export function projectDashboardInput(project:ProjectInput):DashboardInput|undefined {
  if(project.business_profile!=='neighborhood')return undefined
  const asOf=project.as_of+'T23:59:59Z',cutoff=Date.parse(asOf),object=`project:${project.project_id}`
  const purpose=`${project.scope.name}老旧小区改造前期研判`
  const context={created_at:asOf,target:{object_ref:object,label:project.scope.name,label_origin:'public'},city:project.scope.city||null,address:project.scope.name} as Parameters<typeof eligibleDimension>[1]
  const evidence:DimensionEvidence[]=[]
  for(const key of Object.keys(FACT_KINDS) as ResearchDimension[]){
    for(const fact of project.facts){
      if(!FACT_KINDS[key].includes(fact.kind)&&!NEIGHBORHOOD_FACTOR_FIELDS[key].some(field=>fact.kind==='retrofit.'+field))continue
      if(fact.epistemic_status!=='fact'||fact.object_ref!==object||!fact.locator||!Number.isFinite(Date.parse(fact.observed_at||''))||Date.parse(fact.observed_at!)>cutoff)continue
      const source=project.sources.find(s=>s.id===fact.source_id)
      if(!source||source.visibility!=='public'||source.data_class!=='public'||source.synthetic||!source.untrusted_text||!(source.hash||source.raw_hash))continue
      let quote=''
      if(/^line:\d+$/.test(fact.locator)){
        const slice=documentSlices({file_name:'source.txt',parser_result:{text:source.untrusted_text}}).find(s=>s.locator===fact.locator)
        quote=slice?.text.trim()||''
      }else if(typeof fact.value==='string'&&source.untrusted_text.includes(fact.value))quote=fact.value.trim()
      if(quote.length<8||quote.length>180||quote===source.title.trim())continue
      const item={key,source_id:source.id,quote,basis:`${fact.kind}；原文定位 ${fact.locator}`.slice(0,120)}
      if(!eligibleDimension(source,context,project.scope.name,item,[],purpose))continue
      evidence.push(item);break
    }
  }
  return {profile:'neighborhood',purpose,evidence}
}
