import {expect,it,vi} from 'vitest'
import Ajv from 'ajv'
import schema from '../../packages/contracts/schema.json'
import fixture from '../../fixtures/inputs/01_auto.json'
import providerResponse from './fixtures/decision-sparse-zero.json'
import {projectInput,ContractError,contractErrorMessage} from '../../packages/contracts/validate'
import {handoffPublicSources} from '../../packages/maps/public-context'
import {mapDecisionInput} from '../../packages/decision/structured-route'
import {evaluateDecision,parseDecisionChoice} from '../../services/capabilities/decision-model'
import {parseDashboard} from '../../packages/decision/dashboard'
import type {MapScreenContext,Source} from '../../apps/host/generated/contracts'

const source=(id:string,text='本小区给水设施改造原文。'):Source=>({id,title:'原始公告',url:'https://example.org/original',untrusted_text:text,hash:'original-v1',locator:'line:1',visibility:'public',data_class:'public',synthetic:false})
const context=(sources:Source[]=[]):MapScreenContext=>({id:'MAPCTX-FORMAT',provider:'amap',coordinate_encoding:'GCJ-02',created_at:'2026-10-16T05:00:00Z',expires_at:'2026-10-16T06:00:00Z',target:{kind:'point',longitude:120.1,latitude:30.2,radius_m:800,bounds:null,label:'测试小区',label_origin:'public'},address:'杭州',city:'杭州',groups:[],local_projects:sources.length?[{project_id:'P-FIRST',name:'测试',relation:'city_background',scope_label:'杭州',updated_at:'2026-10-16',context_version:0,as_of:'2026-10-16',business_profile:'neighborhood',sources,facts:[],rules:[],source_count:sources.length,fact_count:0,document_count:0}]:[],project_revision:'fixture',status:'complete',gaps:[],metric_note:'fixture'})

it('accepts more than 1000 distinct project originals without an arbitrary source-count gate',()=>{
  const value={...structuredClone(fixture),synthetic:false,sources:Array.from({length:1500},(_,i)=>source('SRC-'+i)),facts:[],context_rules:[]}
  expect(projectInput(value).sources).toHaveLength(1500)
})

it('merges exact inherited originals but preserves different body versions, scopes and source locators',()=>{
  const c=context([source('P-OLD:ORIGINAL'),source('ORIGINAL'),{...source('OTHER-VERSION'),hash:'v2',untrusted_text:'本小区2025年完成给水改造。'},{...source('OTHER-LOCATION'),locator:'line:2'},{...source('OTHER-SCOPE'),object_refs:['building:B2']}])
  const result=handoffPublicSources(c)
  expect(result).toHaveLength(4)
  expect(result.some(row=>row.id==='P-FIRST:ORIGINAL')).toBe(true)
  expect(result.some(row=>row.id.includes('P-OLD:'))).toBe(false)
})

it('keeps source IDs and every reference field compatible, including inherited identifiers above 250 characters',()=>{
  const long='P-NAMESPACE:'.repeat(30)+'ORIGINAL',value={...structuredClone(fixture),synthetic:false,sources:[source(long)],facts:[],context_rules:[]}
  expect(projectInput(value).sources[0].id).toBe(long)
  const ajv=new Ajv({strict:false}),keys=new Set(['source_id','source_ids','input_source_ids','evidence_refs'])
  let checked=0
  const walk=(node:unknown)=>{if(!node||typeof node!=='object')return;for(const [key,child] of Object.entries(node)) {
    if(keys.has(key)&&child&&typeof child==='object') {const contract=child as {type?:string};expect(ajv.validate(contract,contract.type==='array'?[long]:long),key).toBe(true);checked++}
    walk(child)
  }}
  walk(schema);expect(checked).toBeGreaterThan(30)
})

it('replays the real Decision response successfully when the input source namespace is long',async()=>{
  const input=mapDecisionInput(context([source('P-ARCHIVE:'.repeat(30)+'SOURCE')]),'判定改造模式','neighborhood')
  delete input.dashboard;input.state={purpose:'协议回放',verified_conditions:input.factors}
  const result=await evaluateDecision(input,new AbortController().signal,{apiKey:'controlled-test',endpoint:'https://maas.qianwenaiapi.com/compatible-mode/v1',model:'decision-model-preview'},async()=>new Response(JSON.stringify(providerResponse)))
  expect(result.status).toBe('completed');expect(result.error_code).toBeNull()
  expect(result.input_source_ids[0].length).toBeGreaterThan(250)
})

it('fills only omitted zeros with known labels, preserving incomplete nonzero distributions as invalid',()=>{
  expect(parseDecisionChoice({type:'choice',choice:'a',confidence:1,probabilities:{a:1}},['a','b']).probabilities).toEqual({a:1,b:0})
  expect(()=>parseDecisionChoice({type:'choice',choice:'a',confidence:.8,probabilities:{a:.8}},['a','b'])).toThrow('DECISION_INVALID_RESPONSE')
  expect(()=>parseDecisionChoice({type:'choice',choice:'a',confidence:1,probabilities:{outside:1}},['a','b'])).toThrow('DECISION_INVALID_RESPONSE')
})

it('retains valid radar dimensions when one optional score has a malformed shape',()=>{
  const input={purpose:'测试',evidence:[{key:'demand' as const,source_id:'S',quote:'需求原文。',basis:'依据'},{key:'supply' as const,source_id:'S',quote:'服务原文。',basis:'依据'}]}
  const raw={model:'decision-model-preview',request_id:'T',answers:{fit_demand:{type:'score',score:99,confidence:.9,probabilities:{2:1}},fit_supply:{type:'score',score:2,confidence:.9,probabilities:{2:1}}}}
  const onIssue=vi.fn(),result=parseDashboard(raw,input,{onIssue})
  expect(result.status).toBe('partial');expect(result.dimensions.find(row=>row.key==='demand')?.value).toBeNull()
  expect(result.dimensions.find(row=>row.key==='supply')?.value).toBe(3);expect(onIssue).toHaveBeenCalledOnce()
})

it('names the actual invalid field instead of blaming unrelated geometry and dates',()=>{
  try {projectInput({...fixture,as_of:'2026/10/16'});throw new Error('EXPECTED_INVALID_DATE')}
  catch(error){expect(error).toBeInstanceOf(ContractError);expect(contractErrorMessage(error as ContractError)).toContain('资料日期')}
})
