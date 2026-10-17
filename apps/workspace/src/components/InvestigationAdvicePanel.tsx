import {useEffect,useRef,useState} from 'react'
import {api,type Project} from '../api'
import {useWorkbenchAccess} from '../AdminAccess'
import type {StrategyPacket} from '../../../../packages/retrofit/strategy'
import type {AdviceDirection,InvestigationAdviceResult} from '../../../../packages/retrofit/investigation-advice'
import './investigation-advice.css'

export default function InvestigationAdvicePanel({project,packet,direction,onTask,onEvidence}:{project:Project;packet:StrategyPacket;direction:AdviceDirection;onTask:(id:string)=>void;onEvidence:(refs:string[])=>void}){
 const {canWrite}=useWorkbenchAccess(),key=[project.id,project.context_version,packet.input_hash,packet.created_at,direction,project.input.scope.name,project.input.scope.city,project.input.scope.map_anchor?.address].join('|')
 const identity=useRef(key);identity.current=key
 const abort=useRef<AbortController|null>(null),[state,setState]=useState<{key:string;result:InvestigationAdviceResult|null}>({key:'',result:null}),[busy,setBusy]=useState(false),[error,setError]=useState(''),[active,setActive]=useState(0)
 const result=state.key===key?state.result:null,endpoint=`/projects/${encodeURIComponent(project.id)}/investigation-advice`
 const belongs=(value:InvestigationAdviceResult|null)=>!!value&&value.policy==='investigation-advice-v1'&&value.project_id===project.id&&value.context_version===project.context_version&&value.strategy_hash===packet.input_hash&&value.strategy_created_at===packet.created_at&&value.direction===direction
 async function load(refresh=false){
  abort.current?.abort();const controller=new AbortController();abort.current=controller
  setBusy(true);setError('')
  const current=()=>!controller.signal.aborted&&identity.current===key
  try{
   let value=refresh?null:await api<InvestigationAdviceResult|null>(`${endpoint}?direction=${direction||'unselected'}`,undefined,controller.signal)
   if(!current())return
   if(!value&&canWrite)value=await api<InvestigationAdviceResult>(endpoint,{expected_context_version:project.context_version,expected_strategy_hash:packet.input_hash,direction,refresh},controller.signal)
   if(current()&&value){if(!belongs(value))setError('当前资料或方案已变化，请重新读取建议。');else{setState({key,result:value});setActive(0)}}
  }catch(e){if(current())setError(e instanceof Error?e.message:'智能建议暂未生成，可继续核对资料。')}
  finally{if(current())setBusy(false)}
 }
 useEffect(()=>{setState({key,result:null});setActive(0);void load();return()=>abort.current?.abort()},[key,canWrite])
 const step=result?.steps[active]||result?.steps[0]
 return <section className="investigation-advice" aria-label="DeepSeek 精准调查建议" aria-busy={busy}>
  <header><span>DeepSeek V4.1 Flash · 调查建议</span><button type="button" disabled={busy||!canWrite} onClick={()=>void load(true)}>{busy?'正在分析…':result?'更新建议':'生成建议'}</button></header>
  {busy&&<p className="investigation-advice-loading" role="status">正在对照登记地址与资料差异，整理优先行动、所需材料和获取渠道…</p>}
  {error&&<p className="investigation-advice-error" role="status">{error}</p>}
  {result&&step&&<><p className="investigation-advice-summary">{result.summary}</p><div className="investigation-advice-tabs" role="tablist" aria-label="优先调查步骤">{result.steps.map((item,index)=><button key={item.task_id} type="button" role="tab" aria-selected={active===index} onClick={()=>setActive(index)}>{String(index+1).padStart(2,'0')} · {item.title}</button>)}</div><article className="investigation-advice-step" role="tabpanel"><h3>{step.action}</h3><dl><div><dt>需要材料</dt><dd>{step.material}</dd></div><div><dt>建议渠道</dt><dd>{step.channel}</dd></div><div><dt>判断用途</dt><dd>{step.reason}</dd></div></dl><details><summary>取得后怎样核对</summary><p>{step.completion_check}</p></details><div className="investigation-advice-actions"><button type="button" onClick={()=>onTask(step.task_id)}>打开对应调查 →</button>{!!step.evidence_refs.length&&<button type="button" onClick={()=>onEvidence(step.evidence_refs)}>查看参考资料</button>}</div></article><footer>依据资料 v{result.context_version} · {result.source_count}份公开资料 · {result.reused?'已保存建议':`${(result.duration_ms/1000).toFixed(1)}秒生成`}</footer></>}
  {!busy&&!result&&!error&&<p>当前暂未保存智能建议，可继续通过下方任务补充资料。</p>}
 </section>
}
