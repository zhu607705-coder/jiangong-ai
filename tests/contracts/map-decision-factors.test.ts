import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { decisionFactors, factorTier, decisionSignals, FACTOR_FIELDS } from '../../packages/maps/decision-factors'
import { assertBriefProse, selectReferenceCases } from '../../runtime/skills/investment-brief'
import { normalizedTarget } from '../../services/map-screening/service'
import type { MapScreenContext, MapProjectEvidence } from '../../apps/host/generated/contracts'
function context(facts:any[]=[]):MapScreenContext {
  return {id:'fixture',created_at:'2026-09-28T00:00:00Z',groups:[],local_projects:[{project_id:'P1',relation:'within_scope',
    sources:[{id:'S1',synthetic:false,content_status:'full_text',visibility:'public',data_class:'public'}],facts} as MapProjectEvidence]} as unknown as MapScreenContext
}
function fact(field:string,value=true,subject='building-A') {
  return {id:field,kind:'screening.'+field,value,unit:null,source_id:'S1',object_ref:subject,locator:'p2',observed_at:'2026-09-01T00:00:00Z'}
}
describe('source-backed factors',()=>{
  it('requires each prerequisite for the same object',()=>{
    const fields=FACTOR_FIELDS.implementation
    expect(decisionFactors(context(fields.map(f=>fact(f))))[0].state).toBe('supported')
    expect(decisionFactors(context(fields.map((f,i)=>fact(f,true,`building-${i}`))))[0].state).toBe('conditional')
  })
  it('never splices independent projects into one pass',()=>{
    const ctx=context([fact('use_permitted')]);const p=structuredClone(ctx.local_projects[0]);p.project_id='P2';p.facts=[fact('rights_secured'),fact('relocation_resolved')];ctx.local_projects.push(p)
    expect(decisionFactors(ctx)[0].state).toBe('conditional')
  })
  it('keeps explicit blockers and conflicting evidence distinct',()=>{
    expect(decisionFactors(context([fact('rights_secured',false)]))[0].state).toBe('blocked')
    expect(decisionFactors(context([fact('rights_secured',false),fact('rights_secured')]))[0].state).toBe('conditional')
    expect(decisionFactors(context([fact('rights_secured',false,'B'),fact('rights_secured',true,'A')]))[0].state).toBe('blocked')
  })
  it('rejects stale, future, unlocated and source-free facts',()=>{
    for(const patch of [{observed_at:'2020-01-01'},{observed_at:'2030-01-01'},{observed_at:'invalid'},{object_ref:undefined},{locator:undefined},{source_id:'MISSING'}])
      expect(decisionFactors(context([{...fact('rights_secured'),...patch}]))[0].state).toBe('unknown')
  })
  it('ignores synthetic, metadata-only and city-wide assertions',()=>{
    const ctx=context([fact('rights_secured')]);ctx.local_projects[0].relation='city_background';expect(decisionFactors(ctx)[0].state).toBe('unknown')
    ctx.local_projects[0].relation='within_scope';ctx.local_projects[0].sources[0].synthetic=true;expect(decisionFactors(ctx)[0].state).toBe('unknown')
    ctx.local_projects[0].sources[0].synthetic=false;ctx.local_projects[0].sources[0].content_status='metadata_only';expect(decisionFactors(ctx)[0].state).toBe('unknown')
  })
  it('requires all five decision dimensions for overall green and never numeric counts',()=>{
    const ctx=context(Object.values(FACTOR_FIELDS).flat().map(f=>fact(f)))
    expect(factorTier(decisionFactors(ctx),'overall')).toBe('strong')
    ctx.local_projects[0].facts=ctx.local_projects[0].facts.filter(f=>f.kind!=='screening.capex_affordable')
    expect(factorTier(decisionFactors(ctx),'overall')).toBe('moderate')
    ctx.local_projects[0].facts.push(fact('capex_affordable',false))
    expect(factorTier(decisionFactors(ctx),'overall')).toBe('sparse')
  })
  it('turns office places into an investigation, not a demand estimate',()=>{
    const ctx=context();ctx.groups=[{key:'work_live',sample:[{name:'测试商务楼',category:'商务住宅;商务写字楼'}],reported_count:999} as any]
    const signal=decisionSignals(ctx)[0];expect(signal.title).toBe('办公线索');expect(signal.next).toContain('空置');expect(JSON.stringify(signal)).not.toContain('999')
  })
})
describe('brief skill and casebook',()=>{
  it('has exactly 50 distinct traceable cases with separate source facts and analyst readings',()=>{
    const data=JSON.parse(readFileSync('runtime/skills/investment-brief/references/cases.json','utf8'))
    expect(data.cases).toHaveLength(50);expect(new Set(data.cases.map((c:any)=>c.name)).size).toBe(50)
    for(const c of data.cases) for(const key of ['source_url','source_locator','published_at','published_fact','investment_reading','next_check','transfer_condition']) expect(c[key]).toBeTruthy()
  })
  it('retrieves at most three relevant references and no unrelated fallback',()=>{
    expect(selectReferenceCases('办公 改造 社区 服务')).toHaveLength(3)
    expect(selectReferenceCases('no matching topic')).toEqual([])
  })
  it('rejects boilerplate without deleting material negative conditions',()=>{
    expect(()=>assertBriefProse({summary:'不代表真实需求。'})).toThrow('BRIEF_STYLE_RETRY')
    expect(()=>assertBriefProse({summary:'租约尚未到期，先核查分期实施条件。'})).not.toThrow()
  })
})
describe('polygon input validation',()=>{
  const bounds={west:120,east:120.01,south:30,north:30.01}
  const target={kind:'cell',bounds,radius_m:null,longitude:120.004,latitude:30.004,
    geometry:{type:'Polygon',coordinates:[[[120,30],[120.01,30],[120.01,30.01],[120,30.01],[120,30]]]}}
  it('accepts a bounded physical polygon and rejects an exterior anchor',()=>{
    expect(normalizedTarget(target).geometry).toEqual(target.geometry)
    expect(()=>normalizedTarget({...target,longitude:120.02})).toThrow()
  })
  it('rejects geometry outside query bounds and attached to a point',()=>{
    expect(()=>normalizedTarget({...target,bounds:{...bounds,east:120.005}})).toThrow('INVALID_REGION_GEOMETRY')
    expect(()=>normalizedTarget({...target,kind:'point',bounds:null,radius_m:800})).toThrow('INVALID_TARGET')
  })
})
