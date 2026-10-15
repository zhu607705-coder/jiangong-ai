import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fixture from '../../fixtures/inputs/01_auto.json'
import type { ProjectInput, RenewalStrategy } from '../../apps/host/generated/contracts'
import { config } from '../../apps/host/config'
import { projectDecisionInput } from '../../packages/decision/structured-route'
import { STRATEGY_POLICY, validateStrategy, type StrategySource } from '../../packages/retrofit/strategy'
import type { ModeCondition } from '../../packages/retrofit/renewal-mode'
import { withConcreteWorkPlan } from './fixtures/strategy-work-plan'

const ports = vi.hoisted(() => ({ open: vi.fn() }))
vi.mock('../../runtime/dsh/live-session', () => ({ LiveSession: { open: ports.open } }))
import { researchRenewalStrategy } from '../../services/map-screening/renewal-strategy'

const source: StrategySource = { id: 'CURRENT', title: '对象供水记录', text: '本小区29、30、31、48幢供水设施已开展方案核查，涉及252户。', url: null, published_at: '2023-08-18', role: 'current', locator: 'line:1' }
function proposal(): RenewalStrategy {
  return withConcreteWorkPlan({ headline: '按四幢供水范围优先研究管网改善与居民协同', summary: '优先组织供水分项改善，把施工范围、资金分担和持续维护同时落实。', preferred_mode: 'comprehensive',
    rationale: [{ point: '供水改善有明确的四幢对象范围。', source_id: source.id, quote: source.text }],
    paths: (['comprehensive', 'rebuild'] as const).map(mode => ({ mode, title: mode === 'comprehensive' ? '四幢供水改善优先' : '整片拆建条件比较', description: '围绕本对象明确工程动作与实施前提。', actions: [{ title: '核对四幢管线与计量方案', detail: '先核查现场管线并与四幢居民确认停水及施工安排。', evidence_refs: [source.id] }], requirements: ['按对象核实技术与资金条件。'] })),
    dimensions: (['demand', 'supply', 'adaptation', 'implementation', 'operations', 'resources'] as const).map(key => ({ key, current: '已登记四幢供水改善线索，现况待专项核查。', current_level: 'unknown', comprehensive: '在更新管线和落实维护责任的假设下研究可靠供水目标。', comprehensive_level: 'medium', rebuild: '将整体替换设施作为比较目标，实施前提另列。', rebuild_level: 'medium', evidence_refs: [source.id] })),
    next_checks: [{ title: '核查施工与维护衔接', detail: '核对四幢施工方案、居民安排及维护责任。', evidence_refs: [source.id] }],
  },source)
}
function brief() {
  return { renewal: { conclusion: '以四幢供水改善为本轮优先候选，整片拆建保留作条件比较。', reason: '本对象已有明确供水范围，分项改善与现有居住状态衔接更直接。', evidence_refs: [source.id] },
    investment: { conclusion: '先为四幢管线核查、计量方案和居民施工协商形成专项预算，再按核实范围分批投入。', reason: '现有资料支持对象范围，施工费用与居民安排仍需专项确认。', stage: 'preliminary' as const, evidence_refs: [source.id] },
    returns: { financial: '居民和财政分别核对建设分担，运维主体另核持续维护支出；本资料未给完整收支数据。', social: '目标是改善四幢252户供水可靠性，并减少施工对居民用水的影响。', evidence_refs: [source.id] } }
}
const initial = { modelConfigured: config.modelConfigured, searchConfigured: config.searchConfigured, decisionEnabled: config.decisionEnabled }
beforeEach(() => { vi.clearAllMocks(); Object.assign(config, { modelConfigured: true, searchConfigured: false, decisionEnabled: false }); vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('UNEXPECTED_NETWORK_CALL')) })
afterEach(() => { Object.assign(config, initial); vi.restoreAllMocks() })

describe('source-grounded DeepSeek decision brief', () => {
  it('keeps old strategies compatible while requiring the brief for new research', () => {
    expect(STRATEGY_POLICY).toBe('renewal-strategy-overview-v6')
    const legacy=proposal();for(const path of legacy.paths)delete path.work_packages;delete legacy.internal_data_requests
    expect(validateStrategy(legacy, [source])).toBeTruthy()
    expect(() => validateStrategy(proposal(), [source], [], true)).toThrow('STRATEGY_DECISION_BRIEF_REQUIRED')
  })
  it('repairs unconditional relocation claims including the not-needing-whole-relocation variants', async () => {
    for(const claim of ['分项更新不需整体搬迁。','居民无需整体搬迁。','居民不用整体搬迁。']) {
      const project={...structuredClone(fixture),business_profile:'neighborhood'} as ProjectInput
      const input=projectDecisionInput(project)
      input.renewalMode!.evidence=[{source_id:source.id,title:source.title,quote:source.text,url:null,published_at:source.published_at!,locator:source.locator}]
      const mistaken={...proposal(),decision_brief:brief()}
      mistaken.decision_brief.returns.social=claim
      mistaken.dimensions.find(row=>row.key==='adaptation')!.comprehensive=claim
      const repaired=structuredClone(mistaken)
      repaired.decision_brief.returns.social='按施工组织核实是否搬迁，结合四幢供水安排控制居民影响。'
      repaired.dimensions.find(row=>row.key==='adaptation')!.comprehensive='假设分栋实施不需整体搬迁，实际安排按施工组织确认。'
      const call=vi.fn().mockResolvedValueOnce({value:mistaken}).mockResolvedValueOnce({value:repaired})
      ports.open.mockResolvedValueOnce({calls:[],call,close:vi.fn(async()=>{})})
      const result=await researchRenewalStrategy(project,0,input,'relocation-fixture',false,new AbortController().signal,null)
      expect(result.status).toBe('completed');expect(call).toHaveBeenCalledTimes(2)
      expect(call.mock.calls[1][0]).toBe('renewal_strategy_quote_repair')
      expect(call.mock.calls[1][1]).toContain('STRATEGY_RELOCATION_ASSUMPTION_REQUIRED')
      expect(result.strategy?.decision_brief?.returns.social).toBe(repaired.decision_brief.returns.social)
    }
  })
  it('accepts same-sentence relocation assumptions while preserving source quotes and historical before text', async () => {
    const project={...structuredClone(fixture),business_profile:'neighborhood'} as ProjectInput
    const input=projectDecisionInput(project),quote='原始资料记载居民不需整体搬迁，材料的适用范围仍须核对。'
    input.renewalMode!.evidence=[{source_id:source.id,title:source.title,quote,url:null,published_at:source.published_at!,locator:source.locator}]
    const value={...proposal(),decision_brief:brief(),round_review:{summary:'按当前原文复核居民影响。',changes:[{topic:'居民安排',before:'居民不需整体搬迁。',after:'按施工组织核实是否搬迁。',reason:'施工组织尚待核实。',evidence_refs:[source.id]}],missing_materials:[]}}
    value.rationale[0].quote=quote
    for(const path of value.paths)for(const work of path.work_packages||[])work.quote=quote
    value.decision_brief.returns.social='在分栋实施的假设下，居民不需整体搬迁；具体安排按施工组织确认。'
    value.dimensions.find(row=>row.key==='adaptation')!.comprehensive='居民无需整体搬迁仅作为待核前提，按施工组织核实后确定。'
    const call=vi.fn().mockResolvedValue({value})
    ports.open.mockResolvedValueOnce({calls:[],call,close:vi.fn(async()=>{})})
    const result=await researchRenewalStrategy(project,0,input,'relocation-conditional-fixture',false,new AbortController().signal,null)
    expect(result.status).toBe('completed');expect(call).toHaveBeenCalledOnce()
    expect(result.strategy?.rationale[0].quote).toBe(quote)
    expect(result.strategy?.round_review?.changes[0].before).toBe('居民不需整体搬迁。')
  })
  it.each(['renewal', 'investment', 'returns'] as const)('requires known nonempty evidence for %s', section => {
    const value = { ...proposal(), decision_brief: brief() }
    value.decision_brief[section].evidence_refs = []
    expect(() => validateStrategy(value, [source], [], true)).toThrow('STRATEGY_BRIEF_EVIDENCE_MISSING')
    value.decision_brief[section].evidence_refs = ['OTHER-PROJECT']
    expect(() => validateStrategy(value, [source], [], true)).toThrow('STRATEGY_SOURCE_MISMATCH')
  })
  it('rejects empty decisions and invalid investment stages while retaining the quote check', () => {
    const value = { ...proposal(), decision_brief: brief() }
    value.decision_brief.renewal.conclusion = '  '
    expect(() => validateStrategy(value, [source], [], true)).toThrow('STRATEGY_BRIEF_INCOMPLETE')
    value.decision_brief = brief(); value.decision_brief.investment.stage = 'anything' as 'preliminary'
    expect(() => validateStrategy(value, [source], [], true)).toThrow('STRATEGY_BRIEF_INCOMPLETE')
    value.decision_brief = brief(); value.rationale[0].quote = '所有楼栋已经取得结构安全鉴定并完成竣工验收。'
    expect(() => validateStrategy(value, [source], [], true)).toThrow('STRATEGY_QUOTE_MISMATCH')
  })
  it('accepts conditional target levels without manufacturing current facts or bypassing the rebuild gate', () => {
    const value = { ...proposal(), decision_brief: brief() }
    expect(validateStrategy(value, [source], [], true).dimensions.every(row => row.current_level === 'unknown' && row.comprehensive_level === 'medium')).toBe(true)
    value.preferred_mode = 'rebuild'
    expect(() => validateStrategy(value, [source], [], true)).toThrow('STRATEGY_REBUILD_GATE_UNMET')
  })
  it('returns the model-authored project decisions and repairs an omitted brief through the same DSH call seam', async () => {
    const project = { ...structuredClone(fixture), business_profile: 'neighborhood' } as ProjectInput
    const input = projectDecisionInput(project)
    input.renewalMode!.evidence = [{ source_id: source.id, title: source.title, quote: source.text, url: null, published_at: '2023-08-18', locator: source.locator }]
    const completed = { ...proposal(), decision_brief: brief() }
    const call = vi.fn().mockResolvedValueOnce({ value: proposal(), sessionId: 'MOCK-INITIAL' }).mockResolvedValueOnce({ value: completed, sessionId: 'MOCK-REPAIR' })
    const close = vi.fn(async () => {})
    ports.open.mockResolvedValue({ calls: [], call, close })
    const result = await researchRenewalStrategy(project, 0, input, 'fixture-hash', false, new AbortController().signal, null)
    expect(result.status).toBe('completed'); expect(result.strategy?.decision_brief).toEqual(completed.decision_brief)
    expect(call).toHaveBeenCalledTimes(2)
    expect(call.mock.calls[0][1]).toContain('decision_brief')
    expect(call.mock.calls[0][1]).toContain('投入阶段')
    expect(call.mock.calls[0][1]).toContain('两路比较集中在decision_brief和rationale')
    expect(call.mock.calls[1][1]).toContain('STRATEGY_DECISION_BRIEF_REQUIRED')
    expect(close).toHaveBeenCalledOnce(); expect(fetch).not.toHaveBeenCalled()
  })
  it('fails a new research result that still omits the brief after the bounded repair', async () => {
    const project = { ...structuredClone(fixture), business_profile: 'neighborhood' } as ProjectInput
    const input = projectDecisionInput(project)
    input.renewalMode!.evidence = [{ source_id: source.id, title: source.title, quote: source.text, url: null, published_at: '2023-08-18', locator: source.locator }]
    const call = vi.fn().mockResolvedValue({ value: proposal(), sessionId: 'MOCK-LEGACY-ONLY' })
    ports.open.mockResolvedValue({ calls: [], call, close: vi.fn(async () => {}) })
    const result = await researchRenewalStrategy(project, 0, input, 'fixture-hash', false, new AbortController().signal, null)
    expect(call).toHaveBeenCalledTimes(2)
    expect(result).toMatchObject({ status: 'failed', strategy: null, diagnostic: { code: 'MODEL_OUTPUT_INVALID' } })
    expect(result.error).not.toContain('STRATEGY_DECISION_BRIEF_REQUIRED')
    expect(fetch).not.toHaveBeenCalled()
  })
  it('requires cited object funding and repairability before admitting construction investment',()=>{
    const value={...proposal(),decision_brief:brief()};value.decision_brief.investment.stage='construction' as 'preliminary'
    expect(()=>validateStrategy(value,[source],[],true)).toThrow('STRATEGY_CONSTRUCTION_GATE_UNMET')
    const verified:StrategySource={...source,id:'VERIFIED',title:'本对象已核实条件',text:'本对象建设资金已落实，专业鉴定确认结构可修复。',published_at:'2026-10-15'}
    const conditions:ModeCondition[]=['funding_secured','structure_repairable'].map(kind=>({kind,value:true,state:'supported',source_ids:[verified.id],locators:['line:1']}))
    expect(validateStrategy(value,[source,verified],conditions,true).decision_brief?.investment.stage).toBe('construction')
    expect(()=>validateStrategy(value,[source,{...verified,role:'reference'}],conditions,true)).toThrow('STRATEGY_CONSTRUCTION_GATE_UNMET')
    expect(()=>validateStrategy(value,[source,verified],conditions.map(row=>({...row,locators:[]})),true)).toThrow('STRATEGY_CONSTRUCTION_GATE_UNMET')
  })
  it('repairs a historical preparation mistaken for construction while preserving the proposed route and measures',async()=>{
    const project={...structuredClone(fixture),business_profile:'neighborhood'} as ProjectInput,input=projectDecisionInput(project)
    input.renewalMode!.conditions=[]
    input.renewalMode!.evidence=[{source_id:source.id,title:'浙大求是社区推进二次供水改造',quote:source.text+'有关工作人员表示，亚运会召开之后将进场施工。',url:null,published_at:'2023-08-18',locator:source.locator},
      {source_id:'DRAFT',title:'求是村75幢1单元电梯草案',quote:'估算总投资约54万元，建设资金来自市区补助及自筹。',url:null,published_at:'2024-09-18',locator:'投资章节'}]
    const mistaken={...proposal(),decision_brief:brief()};mistaken.decision_brief.investment.stage='construction' as 'preliminary';mistaken.decision_brief.investment.reason='已开工，属可招标可交付口径。'
    const corrected={...proposal(),decision_brief:brief()}
    const call=vi.fn().mockResolvedValueOnce({value:mistaken,sessionId:'MOCK-STALE-STAGE'}).mockResolvedValueOnce({value:corrected,sessionId:'MOCK-CORRECTED-STAGE'})
    ports.open.mockResolvedValue({calls:[],call,close:vi.fn(async()=>{})})
    const log=vi.spyOn(console,'warn').mockImplementation(()=>{})
    const result=await researchRenewalStrategy(project,0,input,'fixture-hash',false,new AbortController().signal,null)
    expect(result.status).toBe('completed');expect(result.strategy?.decision_brief?.investment.stage).toBe('preliminary')
    expect(result.strategy?.headline).toBe(corrected.headline);expect(result.strategy?.paths).toEqual(corrected.paths)
    expect(call.mock.calls[0][1]).toContain('2023年求是村二次供水原文记载的是进场准备')
    expect(call.mock.calls[0][1]).toContain('2024年75幢1单元加梯原文是征求意见草案')
    expect(call.mock.calls[1][1]).toContain('STRATEGY_CONSTRUCTION_GATE_UNMET')
    expect(log).toHaveBeenCalledWith(expect.stringContaining('STRATEGY_CONSTRUCTION_GATE_UNMET'))
    expect(fetch).not.toHaveBeenCalled()
  })
  it('keeps cross-route comparisons out of individual paths and future targets without censoring the global brief or current text',()=>{
    const value={...proposal(),decision_brief:brief()}
    value.paths[0].description='整体拆建不进入本路径。'
    expect(()=>validateStrategy(value,[source],[],true)).toThrow('STRATEGY_PATH_DIRECTION_MIXED')
    value.paths[0].description='按四幢范围更新供水设施。';value.paths[1].requirements=['不具备时转做综合整治。']
    expect(()=>validateStrategy(value,[source],[],true)).toThrow('STRATEGY_PATH_DIRECTION_MIXED')
    value.paths[1].requirements=['核实建设与过渡条件。'];value.dimensions[0].comprehensive='与原拆原建相比改善需求适配。'
    expect(()=>validateStrategy(value,[source],[],true)).toThrow('STRATEGY_PATH_DIRECTION_MIXED')
    value.dimensions[0].comprehensive='按本方向设施配置改善需求适配。';value.dimensions[0].current='原文将综合整治和原拆原建并列作研究线索。'
    value.decision_brief.renewal.reason='综合整治与原拆原建的整体取舍集中在本段解释。'
    expect(validateStrategy(value,[source],[],true)).toBe(value)
  })
})
