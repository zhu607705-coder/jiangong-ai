import {useEffect,useState} from 'react'
import {api} from '../api'
import {useWorkbenchAccess} from '../AdminAccess'
import InternalMaterialIntake,{type MaterialUploadMetadata} from './InternalMaterialIntake'
import type {ProjectInvestigationTask} from '../../../../packages/retrofit/project-tasks'
import type {TaskMaterialLink,TaskMaterialReceipt} from '../../../../packages/retrofit/task-materials'
import './task-material-import.css'

export type TaskUpload=(file:File,metadata:MaterialUploadMetadata,link:TaskMaterialLink)=>Promise<TaskMaterialReceipt>
export type TaskExtract=(documentId:string,link:TaskMaterialLink)=>Promise<TaskMaterialReceipt>
const status={completed:'已完成',empty:'未取得对应内容',ocr_required:'待OCR',not_requested:'尚未调用',failed:'本次未完成'}
export default function TaskMaterialImport({projectId,revision,task,link,synthetic,onUpload,onExtract,onReassess,onReceived}:{projectId:string;revision:number;task:ProjectInvestigationTask;link:TaskMaterialLink;synthetic:boolean;onUpload:TaskUpload;onExtract?:TaskExtract;onReassess:()=>void;onReceived:()=>void}){
 const {canWrite}=useWorkbenchAccess(),[items,setItems]=useState<TaskMaterialReceipt[]>([]),[busy,setBusy]=useState(''),[error,setError]=useState(''),[text,setText]=useState(''),[consent,setConsent]=useState<Record<string,boolean>>({})
 const category:MaterialUploadMetadata['material_category']=task.internal_data?.key==='resident_wellbeing'||/满意|幸福/.test(task.title)?'resident_satisfaction':/电梯|食堂|用餐|运营/.test(task.title)?'operations':/结构|鉴定|工程/.test(task.title)?'structural_assessment':/资金|预算|费用/.test(task.title)?'cost_funding':'other'
 useEffect(()=>{const controller=new AbortController();void api<{items:TaskMaterialReceipt[]}>(`/projects/${encodeURIComponent(projectId)}/investigation-materials?input_hash=${encodeURIComponent(link.input_hash)}`,undefined,controller.signal).then(value=>{if(!controller.signal.aborted&&Array.isArray(value.items))setItems(current=>{const incoming=value.items.filter(item=>item.task_id===link.task_id);return [...current.filter(item=>item.context_version>=revision&&!incoming.some(row=>row.document_id===item.document_id)),...incoming]})}).catch(()=>{});return()=>controller.abort()},[projectId,revision,link.task_id,link.input_hash])
 const keep=(item:TaskMaterialReceipt)=>setItems(current=>[...current.filter(row=>row.document_id!==item.document_id),item])
 async function upload(file:File,metadata:MaterialUploadMetadata){if(busy)return;setBusy('正在保存原文、关联任务并读取调查字段…');setError('');try{const result=await onUpload(file,metadata,link);keep(result);onReceived();setText('')}catch(error){setError(error instanceof Error?error.message:'资料未完成关联，已上传原文件可在资料页继续查看。')}finally{setBusy('')}}
 async function extract(item:TaskMaterialReceipt){if(busy||!onExtract||!consent[item.document_id])return;setBusy('DSH 正在调用原文提取工具，完成后保存待审核草稿…');setError('');try{keep(await onExtract(item.document_id,link))}catch(error){setError(error instanceof Error?error.message:'本次提取未完成，原文件与本地字段保留。')}finally{setBusy('')}}
 return <section className="task-material-import" aria-label="本项调查资料导入"><header><h3>在这项任务中导入新数据</h3><p>上传后先在服务器解析并定位字段，需要时单独调用模型提取。文件与结果关联当前任务及原研判基线。</p></header>
  <InternalMaterialIntake key={task.id} initialCategory={category} onUpload={upload} disabled={!canWrite||!!busy} compact synthetic={synthetic}/>
  <details className="task-paste"><summary>也可以粘贴调查记录或访谈文本</summary><textarea aria-label="本项调查记录" value={text} onChange={event=>setText(event.target.value)} placeholder="粘贴原始记录，保留调查日期、单位、人数和样本口径。"/><button disabled={!canWrite||!!busy||!text.trim()} onClick={()=>void upload(new File([text],`调查记录-${new Date().toISOString().slice(0,10)}.txt`,{type:'text/plain'}),{material_category:category})}>保存记录并提取字段</button></details>
  {busy&&<p role="status" className="task-tool-working">{busy}</p>}{error&&<p role="alert" className="task-material-error">{error}</p>}
  {items.map(item=><article key={item.document_id} className="task-material-receipt"><header><strong>{item.file_name}</strong><span>服务器资料 v{item.context_version} · 任务来自原研判</span></header>
   <ol aria-label="实际工具调用记录">{item.tools.map((tool,index)=><li key={index} data-state={tool.status}><strong>{tool.tool}</strong><span>{status[tool.status]}{tool.count!==undefined?` · ${tool.count.toLocaleString('zh-CN')}${tool.tool==='ParserPort'?' 字符':tool.tool==='表格原始行读取'?' 行':tool.tool==='任务指标提取'?' 项':' 份草稿'}`:''}</span><p>{tool.detail}</p></li>)}</ol>
   <details open className="task-extracted-fields"><summary>已提取 {item.observations.length} 个字段或要点</summary>{item.observations.length?<table><thead><tr><th>字段</th><th>原值或原文要点</th><th>定位</th></tr></thead><tbody>{item.observations.map((row,index)=><tr key={index}><th>{row.field}</th><td>{row.value}</td><td>{row.locator}{row.representation==='source_bound_draft'&&<span>模型草稿</span>}</td></tr>)}</tbody></table>:<p>{item.parse_status==='ocr_required'?'文件已保存，需要OCR或可复制原文后再提取。':'文件已关联；可调用原文提取工具，或补充带指标列名与单位的表格。'}</p>}</details>
   {item.extraction.warnings.map((warning,index)=><p key={index} className="task-material-warning">{warning}</p>)}
   {onExtract&&item.extraction.status!=='completed'&&item.parse_status==='extracted'&&<div className="task-model-extraction"><label><input type="checkbox" checked={!!consent[item.document_id]} onChange={event=>setConsent(current=>({...current,[item.document_id]:event.target.checked}))} disabled={!canWrite||!!busy}/>同意仅将此文件发送给 DeepSeek 做原文提取</label><button disabled={!canWrite||!!busy||!consent[item.document_id]} onClick={()=>void extract(item)}>{item.extraction.status==='failed'?'重试原文提取':'调用原文提取工具'}</button></div>}
  </article>)}
  {!!items.length&&<div className="task-next-analysis"><strong>新材料已关联，原方案保持原样</strong><p>下一轮会使用新资料重新判断，并与本轮方案对照。开始前仍可调整所选文件。</p><button onClick={onReassess} disabled={!!busy}>带入下一轮研判 →</button></div>}
 </section>
}
