import {expect,it} from 'vitest'
import fixture from '../../fixtures/inputs/01_auto.json'
import type {Project} from '../../apps/workspace/src/api'
import type {StrategyPacket} from '../../packages/retrofit/strategy'
import {mobileProjectChapters} from '../../apps/workspace/src/components/mobile-project-model'

const project:Project={id:'MOBILE-P',name:'手机契约样本',context_version:3,input:{...fixture,project_id:'MOBILE-P',synthetic:false,business_profile:'neighborhood',facts:[],sources:[]} as Project['input']}
function packet():StrategyPacket{return {project_id:project.id,context_version:3,input_hash:'mobile-v3',created_at:'2026-10-19T00:00:00Z',synthetic:false,status:'completed',error:null,decision:null,research:null,model_calls:[],sources:[{id:'S1',title:'本对象原文',url:null,text:'既有来源内容',published_at:null,locator:'line:1',role:'current'}],strategy:{headline:'已保存的真实判断文本',summary:'当前资料支持分项研究。',preferred_mode:'comprehensive',rationale:[],paths:[{mode:'comprehensive',title:'保留修缮方案',description:'维修供水设施。原拆原建属于另一路径。',actions:[],requirements:[]},{mode:'rebuild',title:'拆建方案',description:'重建居住空间。综合整治属于另一路径。',actions:[],requirements:[]}],dimensions:[{key:'demand',current:'尚无居民问卷。',current_level:'unknown',comprehensive:'修缮目标',comprehensive_level:'medium',rebuild:'重建目标',rebuild_level:'high',evidence_refs:[]}],reasoning_dimensions:[{key:'demand',level:'medium',basis:'logical_inference',reason:'按已登记住宅用途作暂估。',premises:['存在住宅使用'],assumptions:['需求结构待核'],verification:'补充住户问卷。',evidence_refs:[]}],next_checks:[{title:'采集住户问卷',detail:'注明楼栋、日期和有效样本。',evidence_refs:['S1']}]}}}
const model=(page:'overview'|'evidence'|'assessment'|'scenarios'|'actions'|'results',value:StrategyPacket|null=null,direction:'comprehensive'|'rebuild'|null=null)=>mobileProjectChapters({project,page,packet:value,rounds:[],direction})

it('does not invent a mode recommendation or expose a selected direction before research',()=>{
 const first=model('assessment')[0].cards[0]
 expect(first.eyebrow).toBe('模式结果待读取');expect(first.title).not.toContain('综合整治优先');expect(first.direction).toBe(false)
 expect(model('overview')[0].cards[0].facts?.find(f=>f.label==='工作方向')?.value).toBe('尚未选择')
})
it('uses only the selected scheme and its effect levels in later pages',()=>{
 const chapters=model('scenarios',packet(),'comprehensive')
 expect(chapters[0].cards).toHaveLength(1);expect(chapters[0].cards[0].title).toBe('保留修缮方案');expect(chapters[0].cards[0].body).not.toContain('原拆原建')
 const dim=model('assessment',packet(),'comprehensive')[1].cards[0]
 expect(dim.facts).toContainEqual({label:'综合整治目标',value:'中'});expect(JSON.stringify(dim.facts)).not.toContain('重建目标')
})
it('retains reasoning with its assumptions and does not relabel it as an evidence score',()=>{
 const dim=model('assessment',packet())[1].cards[0]
 expect(dim.eyebrow).toBe('六维 · 推理暂估');expect(dim.facts).toContainEqual({label:'证据等级',value:'待核'});expect(dim.facts).toContainEqual({label:'推理暂估',value:'中'});expect(dim.body).toContain('需求结构待核');expect(dim.body).toContain('补充住户问卷')
})
it('preserves every source card for paging and its entire original text for reading',()=>{
 const sources=Array.from({length:25},(_,i)=>({id:'S'+i,title:'材料'+i,data_class:'public',visibility:'public',synthetic:false,content_status:'full_text',untrusted_text:'长原文'.repeat(1000)}))
 const p={...project,input:{...project.input,sources}} as Project
 const cards=mobileProjectChapters({project:p,page:'evidence',packet:null,rounds:[],direction:null})[0].cards
 expect(cards).toHaveLength(25);expect(cards[24].body).toBe(sources[24].untrusted_text);expect(cards[24].refs).toEqual(['S24'])
})
it('reuses task IDs so a card can open the original task drawer',()=>{
 const card=model('actions',packet())[0].cards[0]
 expect(card.title).toBe('采集住户问卷');expect(card.target?.page).toBe('actions');expect(card.target?.taskId).toBe(card.id);expect(card.refs).toEqual(['S1'])
})
it('ignores another project packet and keeps all six business page structures available',()=>{
 const other={...packet(),project_id:'OTHER'}
 expect(model('overview',other)[0].cards[0].title).not.toBe(other.strategy!.headline)
 for(const page of ['overview','evidence','assessment','scenarios','actions','results'] as const){const chapters=model(page);expect(chapters).toHaveLength(4);expect(chapters.every(c=>c.cards.length>0)).toBe(true)}
})

it('shows independently saved six-dimensional assessment even when the whole plan failed',()=>{
 const p=packet(),dimensions=p.strategy!.dimensions,reasoning=p.strategy!.reasoning_dimensions!
 p.status='failed';p.strategy=null;p.current_assessment={input_hash:p.input_hash,context_version:3,created_at:p.created_at,dimensions,reasoning_dimensions:reasoning,issues:[],status:'partial'}
 const cards=model('assessment',p)[1].cards
 expect(cards[0].title).toBe('居民需求');expect(cards[0].body).toContain('补充住户问卷');expect(cards[0].eyebrow).toBe('六维 · 推理暂估')
})

it('does not present a whole-plan preference as an explicitly completed mode judgement',()=>{
 const first=model('assessment',packet())[0].cards[0];expect(first.eyebrow).toBe('模式结果待读取');expect(first.direction).toBe(false);expect(first.title).not.toContain('综合整治优先')
})

it('does not display a mixed unknown-stage monetary range as a comparable estimate',()=>{
 const p=packet();p.cost_reference=[{scope:'参考原文 · 费用对象待分列',stage:'unknown',price_year:null,record_count:12,min_yuan:1350,max_yuan:530000000,source_ids:['S1']}]
 const card=model('scenarios',p)[2].cards[0];expect(card.eyebrow).toBe('费用原件 · 阶段待核');expect(JSON.stringify(card.facts)).not.toContain('53,000');expect(card.facts).toContainEqual({label:'原件记录',value:'12条，进入原文分列核对'})
})
