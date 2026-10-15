import { IconArrowRight, IconArrowUpRight, IconCircleCheck, IconMap2, IconSearch, IconAlertCircle, IconLoader2 } from '@tabler/icons-react'
import type { Project } from '../api'
import { MODE_LABELS, evaluateRenewalModeGate, projectRenewalModeInput } from '../../../../packages/retrofit/renewal-mode'
import type { StrategyPacket } from '../../../../packages/retrofit/strategy'
import type { ResearchRound } from '../../../../packages/retrofit/research-rounds'
import './ProjectOverview.css'

export type ProjectOverviewPage = 'overview' | 'evidence' | 'assessment' | 'scenarios' | 'actions' | 'results' | 'map'
export type ProjectOverviewProps = {
  project: Project
  currentStrategyPacket?: StrategyPacket | null
  latestSavedRound?: ResearchRound | null
  currentDirection?: 'comprehensive' | 'rebuild' | null
  stale?: boolean
  failed?: boolean
  loading?: boolean
  onNavigate: (page: ProjectOverviewPage, section?: string, pane?: string) => void
  onEvidence: (refs: string[], packet: StrategyPacket) => void
}
type OverviewState = 'loading' | 'failed' | 'stale' | 'checks' | 'candidates' | 'empty'

/** Saved analysis and the user's working direction remain independent inputs. */
export function projectOverviewState(props: Omit<ProjectOverviewProps,'onNavigate'|'onEvidence'>) {
  const {project,currentStrategyPacket,latestSavedRound}=props
  const belongs=(packet:StrategyPacket|null|undefined):packet is StrategyPacket=>!!packet&&packet.project_id===project.id&&packet.synthetic===project.input.synthetic
  const completed=(packet:StrategyPacket|null|undefined):packet is StrategyPacket=>belongs(packet)&&packet.status==='completed'&&!!packet.strategy
  const savedRound=latestSavedRound?.project_id===project.id&&latestSavedRound.status==='completed'&&completed(latestSavedRound.result)?latestSavedRound:null
  const candidates=[currentStrategyPacket,savedRound?.result].filter(completed)
  const packet=candidates.find(result=>result.context_version===project.context_version)||candidates.sort((a,b)=>b.context_version-a.context_version||Date.parse(b.created_at)-Date.parse(a.created_at))[0]||null
  const strategy=packet?.strategy||null
  const stale=!!props.stale||!!packet&&packet.context_version!==project.context_version
  const failed=!!props.failed||belongs(currentStrategyPacket)&&currentStrategyPacket.status==='failed'
  const gate=evaluateRenewalModeGate(projectRenewalModeInput(project.input))
  const relevant=gate.checks.filter(check=>strategy?.preferred_mode==='rebuild'||['structure_repairable','funding_secured'].includes(check.kind))
  const needsChecks=!!strategy&&(gate.direction==='investigate'||relevant.some(check=>check.kind==='structure_repairable'&&strategy.preferred_mode!=='rebuild'?check.state==='unknown'||check.state==='conflict':check.state!=='met'))
  const state:OverviewState=props.loading?'loading':failed?'failed':stale?'stale':!strategy?'empty':needsChecks?'checks':'candidates'
  return {packet,strategy,savedRound,stale,failed,state,needsChecks,gate}
}

function ObjectGeometry({project}:{project:Project}) {
  const scope=project.input.scope
  const ring=scope.geometry?.coordinates[0]?.filter(point=>point.length>=2&&point.slice(0,2).every(Number.isFinite))||[]
  if(ring.length>=3) {
    const xs=ring.map(point=>point[0]),ys=ring.map(point=>point[1]),left=Math.min(...xs),bottom=Math.min(...ys)
    const width=Math.max(...xs)-left,height=Math.max(...ys)-bottom
    if(width>0&&height>0) {
      const scale=Math.min(304/width,128/height),x=(360-width*scale)/2,y=(168-height*scale)/2
      const points=ring.map(point=>`${x+(point[0]-left)*scale},${168-y-(point[1]-bottom)*scale}`).join(' ')
      return <div className="project-overview-geometry"><svg viewBox="0 0 360 168" role="img" aria-label="项目已登记研究范围轮廓"><path className="project-overview-grid" d="M0 42H360M0 84H360M0 126H360M90 0V168M180 0V168M270 0V168"/><polygon points={points}/></svg><span>{scope.legal_parcel_confirmed?'已登记项目边界':'研究范围 · 权属边界待确认'}</span></div>
    }
  }
  const point=scope.centroid
  return <div className="project-overview-geometry project-overview-geometry--point"><IconMap2 size={28} stroke={1.3}/><strong>{point?.label||'研究范围尚未登记'}</strong>{point&&Number.isFinite(point.latitude)&&Number.isFinite(point.longitude)?<span>{point.latitude.toFixed(4)}° / {point.longitude.toFixed(4)}° · 地名代表点</span>:<span>在地图中查看位置与边界</span>}</div>
}

const stateLabels:Record<OverviewState,string>={loading:'正在读取研究状态',failed:'本轮研究未完成',stale:'资料变化待复核',checks:'先核查关键条件',candidates:'可比较候选方案',empty:'尚无研判结果'}

export default function ProjectOverview(props:ProjectOverviewProps) {
  const {project,currentDirection,onNavigate,onEvidence}=props
  const {packet,strategy,savedRound,stale,failed,state,needsChecks}=projectOverviewState(props)
  const hasMaterials=project.input.sources.some(source=>source.untrusted_text?.trim()||source.parse_status==='extracted')
  const headline=strategy?.decision_brief?.renewal.conclusion||strategy?.headline||(props.loading?'正在读取本项目的研究状态':hasMaterials?'已有资料，进入改造研判':'先补充本项目的研究资料')
  const lead=strategy?.decision_brief?.renewal.reason||strategy?.summary||(hasMaterials?'在改造研判中查看已有条件、补充内部材料并开始研究。':'可先导入居民需求、鉴定或费用材料，再开展项目研判。')
  const ids=new Set(packet?.sources.map(source=>source.id)||[])
  const usable=(refs:readonly string[])=>[...new Set(refs)].filter(id=>ids.has(id))
  const evidence=usable(strategy?.decision_brief?.renewal.evidence_refs||strategy?.rationale.map(row=>row.source_id)||[])
  const roundMatches=!!savedRound&&savedRound.result?.input_hash===packet?.input_hash
  const fromRound=roundMatches?savedRound.missing_materials.map(item=>({title:item.topic,detail:item.request,refs:item.evidence_refs})):[]
  const investigations=[...fromRound,...(strategy?.next_checks.map(item=>({title:item.title,detail:item.detail,refs:item.evidence_refs}))||[])].filter((item,index,all)=>all.findIndex(other=>other.title===item.title)===index).slice(0,3)
  const statusAction:Record<OverviewState,{label:string;page:ProjectOverviewPage;section?:string}>={
    loading:{label:'查看运行详情',page:'results',section:'runs'},failed:{label:'查看运行详情',page:'results',section:'runs'},stale:{label:'查看受影响内容',page:'results',section:'history'},
    checks:{label:'查看关键核查项',page:'actions',section:'current'},candidates:{label:'比较候选方案',page:'scenarios',section:'compare'},
    empty:hasMaterials?{label:'进入改造研判',page:'assessment',section:'direction'}:{label:'补充项目资料',page:'evidence',section:'materials'},
  }
  const primary=statusAction[state]
  const researchLabel=needsChecks?'先核查':strategy?MODE_LABELS[strategy.preferred_mode]:'待研判'
  const unknown=strategy?.dimensions.filter(row=>row.current_level==='unknown').length||0
  return <div className="project-overview" data-overview-state={state}>
    <header className="project-overview-heading"><div><span>当前项目</span><h1>项目总览</h1><p>{project.name} · 先看判断与下一步，再进入具体工作。</p></div></header>
    <div className="project-overview-grid-layout">
      <section className={`project-overview-card project-overview-hero project-overview-hero--${state}`} aria-labelledby="project-overview-recommendation">
        <div className="project-overview-status" aria-live="polite"><span>{props.loading?<IconLoader2 size={16}/>:failed||stale?<IconAlertCircle size={16}/>:needsChecks?<IconSearch size={16}/>:<IconCircleCheck size={16}/>} {stateLabels[state]}</span>{project.input.synthetic&&<span className="project-overview-synthetic">模拟项目</span>}</div>
        <div className="project-overview-directions"><span>{stale||failed?'上次系统建议':'系统建议'}：<strong>{researchLabel}</strong></span><span>当前工作方向：<strong>{currentDirection?MODE_LABELS[currentDirection]:'尚未选择'}</strong></span></div>
        <h2 id="project-overview-recommendation">{headline}</h2><p className="project-overview-lead">{lead}</p>
        {strategy?.decision_brief?.investment.conclusion&&<p className="project-overview-investment"><span>投入建议</span>{strategy.decision_brief.investment.conclusion}</p>}
        {failed&&<p className="project-overview-notice" role="status">{strategy?'本轮未完成，以下保留上次已保存的研究建议。':'本轮未形成完整结论，已取得资料和运行记录仍可查看。'}</p>}
        {!failed&&stale&&<p className="project-overview-notice">当前资料为 v{project.context_version}{packet?`，这份建议基于 v${packet.context_version}`:''}。先查看变化，再复核对应判断。</p>}
        <div className="project-overview-actions"><button className="project-overview-primary" onClick={()=>onNavigate(primary.page,primary.section)}>{primary.label}<IconArrowRight size={17}/></button>{strategy&&<button onClick={()=>onNavigate('assessment','direction')}>查看完整研判</button>}{packet&&!!evidence.length&&<button className="project-overview-text-button" onClick={()=>onEvidence(evidence,packet)}>查看判断依据</button>}</div>
        <footer className="project-overview-result-meta"><span>{packet?`${stale||failed?'已保存建议':'方案'} · 资料 v${packet.context_version}`:'尚无已保存的方案'}</span>{packet&&<button className="project-overview-text-button" onClick={()=>onNavigate('results','history')}>查看版本依据<IconArrowUpRight size={14}/></button>}</footer>
      </section>
      <section className="project-overview-card project-overview-object" aria-labelledby="project-overview-object"><header><h2 id="project-overview-object">研究对象</h2><button className="project-overview-text-button" onClick={()=>onNavigate('evidence','profile')}>对象档案<IconArrowUpRight size={14}/></button></header><ObjectGeometry project={project}/><dl><div><dt>对象</dt><dd>{project.input.scope.name||project.name}</dd></div><div><dt>资料基准</dt><dd>{project.input.as_of} · v{project.context_version}</dd></div>{project.input.scope.city&&<div><dt>城市</dt><dd>{project.input.scope.city}</dd></div>}</dl><button className="project-overview-text-button" onClick={()=>onNavigate('map')}>在地图中定位<IconArrowRight size={15}/></button></section>
      <section className="project-overview-card project-overview-investigations" aria-labelledby="project-overview-investigations"><header><h2 id="project-overview-investigations">最先处理的事项</h2><button className="project-overview-text-button" onClick={()=>onNavigate('actions','current')}>全部调查<IconArrowUpRight size={14}/></button></header>{stale&&!!investigations.length&&<p className="project-overview-section-note">上次研究的待核事项</p>}{investigations.length?<ol>{investigations.map((item,index)=><li key={item.title}><span className="project-overview-task-index">{String(index+1).padStart(2,'0')}</span><div><h3>{item.title}</h3><p>{item.detail}</p>{packet&&!!usable(item.refs).length&&<button className="project-overview-text-button" onClick={()=>onEvidence(usable(item.refs),packet)}>查看依据</button>}</div></li>)}</ol>:<div className="project-overview-empty"><IconSearch size={24} stroke={1.4}/><p>尚未形成关键调查项。</p><button className="project-overview-text-button" onClick={()=>onNavigate(hasMaterials?'assessment':'evidence',hasMaterials?'direction':'materials')}>{hasMaterials?'进入研判整理待核事项':'先补充项目材料'}<IconArrowRight size={15}/></button></div>}</section>
      <section className="project-overview-card project-overview-work" aria-labelledby="project-overview-work"><header><h2 id="project-overview-work">当前工作摘要</h2></header><button onClick={()=>onNavigate('assessment','baseline')}><div><strong>六维现况</strong><span>{strategy?.dimensions.length?`${unknown?`${unknown}项现况待核`:'各维现况已有评价'} · 查看原文与评价条件`:'按现有指标整理资料与缺项'}</span></div><IconArrowRight size={18}/></button><button onClick={()=>onNavigate('scenarios','compare')}><div><strong>候选方案</strong><span>{strategy?.paths.length===2?'两条研究路径已保存，进入比较工作区':'查看路径条件与方案研究入口'}</span></div><IconArrowRight size={18}/></button><button onClick={()=>onNavigate('results','history')}><div><strong>成果与版本</strong><span>{savedRound?`已保存第${savedRound.round_number}轮 · 查看分析与变化`:packet?`已保存资料 v${packet.context_version} 的研究成果`:'查看已保存记录与当前研究状态'}</span></div><IconArrowRight size={18}/></button></section>
    </div>
  </div>
}
