import { useEffect,useRef,useState } from 'react'
import type { ExperienceCard,DistilledSkill } from '../../../host/generated/contracts'
import type { ExperienceLearningEvent,ExperienceLearningResult } from '../../../../packages/experience/learning'
import { api } from '../api'
import { consumeStream } from '../maps/screening-stream'
import './experience-learning.css'

const phases=[['upload','导入原件'],['reading','阅读与定位'],['extraction','构建经验'],['skills','蒸馏技能'],['rules','更新规则']] as const
const message=(error:unknown)=>error instanceof Error?error.message:'本轮整理未完成，原件已保留。'
function save(text:string,name:string,type='text/markdown;charset=utf-8') {const url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();URL.revokeObjectURL(url)}
export default function ExperienceLearningIntake({projectId,synthetic,onChanged,onOpenDetails}:{projectId:string;synthetic:boolean;onChanged:()=>Promise<void>|void;onOpenDetails:()=>void}) {
  const [files,setFiles]=useState<File[]>([]),[text,setText]=useState(''),[title,setTitle]=useState('项目沟通记录')
  const [useModel,setUseModel]=useState(true),[allowInternal,setAllowInternal]=useState(false),[busy,setBusy]=useState(false),[applying,setApplying]=useState('')
  const [phase,setPhase]=useState(''),[events,setEvents]=useState<string[]>([]),[error,setError]=useState(''),[result,setResult]=useState<ExperienceLearningResult|null>(null)
  const [tab,setTab]=useState<'cards'|'skills'|'rules'>('cards'),[applied,setApplied]=useState<string[]>([])
  const [availability,setAvailability]=useState<{model_configured:boolean;internal_model_enabled:boolean}|null>(null)
  const controller=useRef<AbortController|null>(null),active=useRef(projectId);active.current=projectId
  const base=`/projects/${encodeURIComponent(projectId)}/knowledge`
  useEffect(()=>{void api<{automation?:typeof availability}>(`${base}/pipeline`).then(value=>{if(active.current===projectId)setAvailability(value.automation||null)}).catch(()=>{});return()=>controller.current?.abort()},[projectId,base])
  const log=(value:string)=>setEvents(current=>[...current,value])
  async function learn() {
    if(busy||(!files.length&&!text.trim()))return
    const scope=projectId,abort=new AbortController();controller.current=abort
    setBusy(true);setError('');setEvents([]);setResult(null);setApplied([]);setPhase('upload')
    const warnings:string[]=[],ids:string[]=[]
    try {
      await api('/session',undefined,abort.signal)
      const originals=[...files,...(text.trim()?[new File([text],`${title.replace(/[\\/:*?"<>|]/g,'_').trim()||'项目沟通记录'}.txt`,{type:'text/plain;charset=utf-8'})]:[])]
      if(originals.length>10)throw new Error('每轮最多整理10份材料；聊天记录也作为一份原件。')
      for(const [index,file] of originals.entries()) {
        abort.signal.throwIfAborted();log(`正在导入 ${index+1}/${originals.length}：${file.name}`)
        if(file.size>10*1024*1024){warnings.push(`${file.name}超过10MB，请拆分后补充。`);continue}
        const form=new FormData();form.append('original_file_name',file.name);form.append('file',file);form.append('synthetic',String(synthetic));form.append('material_category','other')
        const response=await fetch(`/api/projects/${encodeURIComponent(projectId)}/documents`,{method:'POST',credentials:'same-origin',headers:{'X-Requested-With':'haizhizi'},body:form,signal:abort.signal})
        const document=await response.json()
        if(!response.ok){warnings.push(`${file.name}：${document.detail||'导入未完成'}`);continue}
        ids.push(document.id);log(`已保存原件：${file.name}`)
      }
      if(!ids.length)throw new Error(warnings.join('；')||'尚无已保存的原件，请重试导入。')
      const response=await fetch(`/api${base}/learn`,{method:'POST',credentials:'same-origin',signal:abort.signal,headers:{'Content-Type':'application/json','Accept':'application/x-ndjson','X-Requested-With':'haizhizi'},body:JSON.stringify({document_ids:ids,use_model:useModel,allow_internal_ai:allowInternal})})
      if(!response.ok){const value=await response.json().catch(()=>({}));throw new Error(value.detail||'原件已导入，自动整理暂未完成。')}
      await consumeStream<ExperienceLearningEvent>(response,abort.signal,event=>{
        if(active.current!==scope)return
        if(event.type==='progress'){setPhase(event.phase);log(event.message)}
        else if(event.type==='complete'){setResult({...event.result,warnings:[...warnings,...event.result.warnings]});setTab('cards');setPhase('complete')}
        else setError(event.message)
      })
      if(active.current===scope)await onChanged()
    } catch(cause) {if(active.current===scope)setError(abort.signal.aborted?'整理已停止，已导入的原件和已生成经验保留。':message(cause))}
    finally {if(active.current===scope)setBusy(false)}
  }
  async function apply(candidate:ExperienceCard,previous:ExperienceCard|null) {
    setApplying(candidate.id);setError('')
    try {
      const updated=await api<{rule:ExperienceCard;skills:DistilledSkill[]}>(`${base}/rule-updates/apply`,{candidate_id:candidate.id,expected_candidate_revision:candidate.revision,...(previous?{target_id:previous.id,expected_target_revision:previous.revision}:{})})
      setApplied(current=>[...current,candidate.id]);setResult(current=>current?{...current,skills:[...updated.skills,...current.skills.filter(skill=>!updated.skills.some(item=>item.measure_key===skill.measure_key))]}:current);await onChanged()
    } catch(cause){setError(message(cause))}finally{setApplying('')}
  }
  async function activateSkill(skill:DistilledSkill) {
    setApplying(skill.id);setError('')
    try {
      const updated=await api<{skill:DistilledSkill;cards:ExperienceCard[]}>(`${base}/skills/${encodeURIComponent(skill.id)}/activate`,{expected_revision:skill.revision})
      setResult(current=>current?{...current,skills:current.skills.map(item=>item.id===skill.id?updated.skill:item),cards:current.cards.map(card=>updated.cards.find(item=>item.id===card.id)||card),rule_updates:current.rule_updates.map(update=>({...update,candidate:updated.cards.find(card=>card.id===update.candidate.id)||update.candidate,previous:updated.cards.find(card=>card.id===update.previous?.id)||update.previous}))}:current)
      await onChanged()
    } catch(cause){setError(message(cause))}finally{setApplying('')}
  }
  const ruleText=(card:ExperienceCard)=>[...card.fields.filter(field=>field.value).map(field=>field.value),...(card.knowledge?.conditions||[]).map(condition=>`适用：${condition.label} ${String(condition.value)}${condition.unit||''}`),...(card.knowledge?.exclusions||[]).map(condition=>`排除：${condition.label} ${String(condition.value)}${condition.unit||''}`)].join('；')
  return <section className="experience-learning" aria-label="导入并自动沉淀经验">
    <header><div><span>从一次项目工作，积累下一次判断的依据</span><h3>直接放入文件或聊天记录</h3><p>自动整理决策、做法和结果，继续生成技能与规则更新对比。</p></div><button type="button" onClick={onOpenDetails}>查看知识与技能版本 →</button></header>
    <div className="learning-inputs"><label className="learning-file-drop">选择项目文件<input type="file" multiple accept=".txt,.md,.csv,.pdf,.docx,.xlsx" disabled={busy} onChange={event=>setFiles(Array.from(event.target.files||[]))}/><span>支持 PDF、Word、Excel、TXT、Markdown、CSV；每份 ≤10MB。</span>{!!files.length&&<strong>已选 {files.length} 份：{files.map(file=>file.name).join('、')}</strong>}</label><div><label>聊天记录或复盘原文<textarea aria-label="聊天记录或复盘原文" rows={6} value={text} maxLength={1000000} disabled={busy} onChange={event=>setText(event.target.value)} placeholder="可直接粘贴长段聊天、会议纪要或项目复盘，保留发言和上下文。"/></label><label className="learning-title">记录名称<input value={title} maxLength={120} disabled={busy} onChange={event=>setTitle(event.target.value)}/></label></div></div>
    <div className="learning-options"><label><input type="checkbox" checked={useModel} disabled={busy} onChange={event=>setUseModel(event.target.checked)}/>使用已配置模型自动分析</label>{useModel&&<label><input type="checkbox" checked={allowInternal} disabled={busy||availability?.internal_model_enabled===false} onChange={event=>setAllowInternal(event.target.checked)}/>允许本轮所选内部原文发送给已配置模型</label>}{availability?.internal_model_enabled===false&&<span>服务器当前对内部材料采用本地整理，原件仍可导入。</span>}</div>
    <div className="learning-actions"><button type="button" disabled={busy||(!files.length&&!text.trim())} onClick={()=>void learn()}>{busy?'正在构建…':'导入并自动构建'}</button>{busy&&<button type="button" onClick={()=>controller.current?.abort()}>停止本轮</button>}<span>原件、经验、技能与规则分别保存，更新保留版本。</span></div>
    {!!phase&&<ol className="learning-phases" aria-label="自动沉淀进度">{phases.map(([key,label],index)=><li key={key} data-active={phase===key} data-complete={phase==='complete'||phases.findIndex(([value])=>value===phase)>index}><span>{index+1}</span>{label}</li>)}</ol>}
    {events.length>0&&<p className="learning-status" role="status">{events.at(-1)}</p>}{error&&<p className="learning-error" role="alert">{error}</p>}
    {result&&<div className="learning-result"><div className="learning-summary"><strong>已整理 {result.cards.length} 条经验 · {result.skills.length} 个技能 · {result.rule_updates.length} 项规则候选</strong><span>阅读 {result.coverage.completed_windows}/{result.coverage.windows} 段 · {result.coverage.completed_characters.toLocaleString('zh-CN')} 字符{result.coverage.reused_windows>0?` · 复用${result.coverage.reused_windows}段`:''}{result.coverage.complete?'':' · 尚有资料可继续处理'}</span></div>
      <nav aria-label="自动构建结果"><button type="button" aria-pressed={tab==='cards'} onClick={()=>setTab('cards')}>项目经验</button><button type="button" aria-pressed={tab==='skills'} onClick={()=>setTab('skills')}>技能蒸馏</button><button type="button" aria-pressed={tab==='rules'} onClick={()=>setTab('rules')}>规则更新对比</button></nav>
      {tab==='cards'&&<div className="learning-card-grid">{result.cards.map(card=><article key={card.id}><span>{card.knowledge?.kind==='rule'?'实践规则':'项目经验'} · {card.status==='approved'?'已采用':'来源待核'}</span><h4>{card.title}</h4>{card.fields.filter(field=>field.value).slice(0,4).map(field=><p key={field.key}>{field.value}</p>)}<details><summary>查看对应原文</summary>{card.fields.flatMap(field=>field.evidence).map((evidence,index)=><blockquote key={index}>{evidence.quote}<cite>{evidence.locator}</cite></blockquote>)}</details></article>)}</div>}
      {tab==='skills'&&<div className="learning-card-grid">{result.skills.map(skill=><article key={skill.id}><span>{skill.status==='approved'?'已采用技能':'技能草稿'} · v{skill.revision}</span><h4>{skill.title}</h4><ol>{skill.procedure.map((step,index)=><li key={index}>{step}</li>)}</ol><p>适用条件：{skill.preconditions.map(item=>item.label).join('；')||'待补充'}</p><button type="button" disabled={!!applying||skill.status==='approved'} onClick={()=>void activateSkill(skill)}>{skill.status==='approved'?'已采用本版技能':applying===skill.id?'正在采用…':'采用本版技能'}</button><button type="button" onClick={()=>void api<{markdown:string;filename:string}>(`${base}/skills/${encodeURIComponent(skill.id)}/export?preview=${skill.status!=='approved'}`).then(value=>save(value.markdown,value.filename)).catch(cause=>setError(message(cause)))}>{skill.status==='approved'?'导出技能 MD':'导出技能草稿 MD'}</button></article>)}</div>}
      {tab==='rules'&&<div className="learning-card-grid">{result.rule_updates.map(update=><article key={update.candidate.id}><span>{update.previous?`旧版 v${update.previous.revision} → 本轮候选`:'新增规则候选'}</span><h4>{update.candidate.title}</h4><div className="learning-rule-comparison"><div><strong>原有规则</strong><p>{update.previous?ruleText(update.previous):'尚无同举措规则'}</p></div><div><strong>本轮拟更新</strong><p>{ruleText(update.candidate)}</p></div></div><p>变化 {update.changes.length} 项 · 原文与旧版本保留</p><button type="button" disabled={!!applying||applied.includes(update.candidate.id)} onClick={()=>void apply(update.candidate,update.previous)}>{applied.includes(update.candidate.id)?'已采用本版规则':applying===update.candidate.id?'正在更新…':'采用本版规则'}</button></article>)}</div>}
      {tab==='cards'&&!result.cards.length&&<p>原件已保存。可补充具体决策、采取的措施或实施记录后继续整理。</p>}{tab==='skills'&&!result.skills.length&&<p>经验已保留，补充可引用的操作做法后可以继续蒸馏。</p>}{tab==='rules'&&!result.rule_updates.length&&<p>本轮未发现明确的规则原句。已有经验和技能已保留，可补充适用条件后继续更新。</p>}
      {!!result.warnings.length&&<details className="learning-follow-up"><summary>后续补充与处理记录 · {result.warnings.length}</summary><ul>{result.warnings.map((warning,index)=><li key={index}>{warning}</li>)}</ul></details>}<button type="button" className="learning-export" onClick={()=>save(JSON.stringify(result,null,2),'项目经验沉淀.json','application/json;charset=utf-8')}>导出本轮 JSON</button>
    </div>}
  </section>
}
