import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { projectInput, validate, modelSchema } from '../../packages/contracts/validate'
import { evaluateScenarios } from '../../packages/decision/evaluate'
import { validateComparison } from '../../packages/decision/model-policy'
import type { ComparisonPacket, ProjectInput, ScenarioProposal } from '../../apps/host/generated/contracts'

const neighborhoodKeys=['demand','supply','adaptation','implementation','operations','resources']
const legacyKeys=['implementation','building','demand','organization','enterprise','resources']
function project(neighborhood=true):ProjectInput {
  const input=projectInput(JSON.parse(readFileSync('fixtures/inputs/02_enterprise.json','utf8')))
  input.business_profile=neighborhood?'neighborhood':'general'
  return input
}
function proposal(input:ProjectInput):ScenarioProposal {
  return {scenarios:evaluateScenarios(input),rationale:'合成契约测试',unresolved:[]}
}
function comparison(input:ProjectInput,keys=neighborhoodKeys):ComparisonPacket {
  return {summary:'先核对本方案条件，再比较专项尽调路径。',criteria:keys.map(criterion=>({criterion,judgments:input.candidate_ids.map(scenario_id=>({scenario_id,conclusion:'本维条件保留未知。',evidence_refs:[],unknowns:['缺少专项资料']}))})),tied_paths:[],unresolved_disagreements:[],followups:[{id:'TEST-FOLLOW',priority:1,title:'取得本方案原始资料',why:'供复核条件使用',impacted_paths:input.candidate_ids,status:'suggested'}]} as ComparisonPacket
}

describe('profile-bound comparison dimensions',()=>{
  it('accepts the new neighborhood matrix through the canonical contract and identifies its policy',()=>{
    const input=project(),packet=comparison(input)
    expect(()=>validate('ComparisonPacket',packet)).not.toThrow()
    const result=validateComparison(input,proposal(input),packet)
    expect(result).toHaveProperty('policy_version','neighborhood-comparison-v1')
    expect(result.criteria.map(row=>row.criterion)).toEqual(neighborhoodKeys)
  })
  it.each(['missing','duplicate','legacy'])('rejects a %s neighborhood dimension instead of relabeling it',variant=>{
    const input=project(),packet=comparison(input)
    if(variant==='missing')packet.criteria.pop()
    if(variant==='duplicate')packet.criteria[1]=structuredClone(packet.criteria[0])
    if(variant==='legacy')packet.criteria=comparison(input,legacyKeys).criteria
    expect(()=>validateComparison(input,proposal(input),packet)).toThrow('维度')
  })
  it.each(['missing','duplicate','unexpected'])('requires each neighborhood dimension to cover all candidate paths without %s judgments',variant=>{
    const input=project(),packet=comparison(input),judgments=packet.criteria[0].judgments
    if(variant==='missing')judgments.pop()
    if(variant==='duplicate')judgments[1]=structuredClone(judgments[0])
    if(variant==='unexpected')judgments[0].scenario_id='whole_site_rebuild'
    expect(()=>validateComparison(input,proposal(input),packet)).toThrow('路径')
  })
  it('rejects a conflicting explicit policy instead of silently changing its meaning',()=>{
    const input=project(),packet={...comparison(input),policy_version:'comparison-legacy-v1'}
    expect(()=>validateComparison(input,proposal(input),packet)).toThrow('版本')
  })
  it('retains historical packets without a policy and general legacy criteria',()=>{
    const input=project(false),packet=comparison(input,legacyKeys)
    expect(()=>validate('ComparisonPacket',packet)).not.toThrow()
    expect(validateComparison(input,proposal(input),packet)).not.toHaveProperty('policy_version')
    // Historical neighborhood records remain readable without being recategorized.
    expect(()=>validate('ComparisonPacket',{...packet,criteria:packet.criteria.slice(0,3)})).not.toThrow()
  })
  it('does not admit new neighborhood-only criteria into a general-project comparison',()=>{
    const input=project(false)
    expect(()=>validateComparison(input,proposal(input),comparison(input))).toThrow('维度')
  })
  it('exposes the new criterion keys and optional policy through the existing model schema',()=>{
    const schema=modelSchema('ComparisonPacket') as any
    expect(schema.properties).toHaveProperty('policy_version')
    expect(schema.required).not.toContain('policy_version')
    expect(schema.properties.criteria.items.properties.criterion.enum).toEqual(expect.arrayContaining([...new Set([...legacyKeys,...neighborhoodKeys])]))
  })
})
