import type { ResearchProgress } from '../../../../packages/research/events'
import { WaitingMotif } from './WaitingScene'
const stageName:Record<ResearchProgress['stage'],string>={sources:'研究对象',search:'公开检索',fetch:'读取原文',adapters:'提取数据',brief:'形成建议',decision:'六维研判'}
/** Progress comes from completed tools and validated outputs, not fabricated percentages. */
export default function ResearchActivity({events,running}:{events:ResearchProgress[];running:boolean}){
  if(!events.length&&!running)return null
  const latest=events.at(-1)
  const brief=[...events].reverse().find(e=>e.stage==='brief'&&e.status==='completed')
  return <section className={'research-activity'+(running?' is-running':'')} aria-label="研究进度">
    {running&&<div className="research-wait-row"><span className="research-wait-art" aria-hidden="true"><WaitingMotif variant="research" stageKey={latest?.stage}/></span>
      <div className="research-current" role="status" aria-live="polite"><i aria-hidden="true"/><span>{latest?.message||'正在启动公开研究'}</span></div></div>}
    {running&&brief&&latest?.stage==='decision'&&<p className="research-preview">{brief.message}</p>}
    <details><summary>{running?'查看过程':'研究过程'}</summary><ol>{events.slice(-18).map((e,i)=><li key={i}><span>{stageName[e.stage]}</span><p>{e.message}</p></li>)}</ol></details>
  </section>
}
