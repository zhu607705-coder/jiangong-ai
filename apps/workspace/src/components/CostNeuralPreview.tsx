import { useState } from 'react'
import prototype from '../../../../data/templates/cost-neural-prototype.json'
import { predictCostNetwork,workbookCostFeatures,costScopeChoices,type CostNetwork } from '../../../../packages/construction-costs/neural-preview'
import './cost-neural-preview.css'

const format=(value:number,digits=0)=>value.toLocaleString('zh-CN',{maximumFractionDigits:digits})
const modelLabels={median:'中位数基线',ridge:'岭回归',bp:'BP网络',pso_bp:'PSO-BP'}
function download(content:unknown) {
 const url=URL.createObjectURL(new Blob([JSON.stringify(content,null,2)],{type:'application/json'})),link=document.createElement('a')
 link.href=url;link.download='造价预测试验-当前参数.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
}
export default function CostNeuralPreview() {
 const [open,setOpen]=useState(false),[mode,setMode]=useState<'synthetic'|'workbook'>('synthetic')
 const [values,setValues]=useState(prototype.datasets.synthetic.default_inputs)
 const [area,setArea]=useState(18000),[scope,setScope]=useState('roof_and_related_facilities')
 const dataset=prototype.datasets[mode],isSynthetic=mode==='synthetic'
 const inputs=isSynthetic?values:workbookCostFeatures(area,scope)
 const price=predictCostNetwork(dataset.model as CostNetwork,inputs), floorArea=isSynthetic?values[4]:area
 const total=price*floorArea/10000,baseline=dataset.baseline.value
 const metric=dataset.metrics.locked_final_audit.pso_bp
 const unknownScope=!isSynthetic&&!dataset.scope_categories_seen_in_training.includes(scope)
 return <section className="cost-neural-preview" aria-label="神经网络造价预测试验">
  <button type="button" className="cost-neural-toggle" aria-expanded={open} onClick={()=>setOpen(value=>!value)}><span><strong>尝试神经网络造价预测</strong><span>已训练示例模型 · 调整工程参数，查看价格变化</span></span><span>{open?'收起 −':'展开 +'}</span></button>
  {open&&<div className="cost-neural-body"><header><div><span className="cost-neural-tag">{isSynthetic?'合成示例 · 七指标模型':'公告数据试验 · 中标价格'}</span><h3>把工程参数变成可核对的预测</h3><p>{isSynthetic?'480条合成数据，按明确公式和随机扰动生成；这里只展示模型训练与预测的使用过程。':'37条工作簿施工中标记录，输入建筑面积与工程范围类别。公告尚未逐条重新核验，跨地区误差较大，当前作试验展示。'}</p></div><button type="button" onClick={()=>download({data_kind:dataset.kind,target:dataset.target,inputs,predicted_yuan_per_m2:price,predicted_total_wan:total,comparison_baseline:baseline,metrics:metric,note:dataset.note,model_version:dataset.model.model_version})}>导出当前试验</button></header>
   <div className="cost-neural-modes" aria-label="预测数据类型"><button type="button" aria-pressed={isSynthetic} onClick={()=>setMode('synthetic')}>七指标合成示例</button><button type="button" aria-pressed={!isSynthetic} onClick={()=>setMode('workbook')}>现有公告数据试验</button></div>
   <div className="cost-neural-layout"><div className="cost-neural-inputs">{isSynthetic?prototype.datasets.synthetic.fields.map((field,index)=><label key={field.id}><span>{field.label}<strong>{format(values[index])}<small>{field.unit}</small></strong></span><input type="range" aria-label={`造价示例${field.label}`} min={field.min} max={field.max} step={field.step} value={values[index]} onChange={event=>setValues(current=>current.map((value,position)=>position===index?Number(event.target.value):value))}/></label>):<><label>受益建筑面积（㎡）<input type="number" aria-label="公告试验建筑面积" min="1000" max="600000" step="500" value={area} onChange={event=>{const value=Number(event.target.value);if(Number.isFinite(value)&&value>=1000&&value<=600000)setArea(value)}}/></label><label>公告工程范围<select aria-label="公告试验工程范围" value={scope} onChange={event=>setScope(event.target.value)}>{costScopeChoices.map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label><p>范围是从工作簿原文登记的类别，未知保持“范围待明确”。人口和工期缺失或时点不明，未作为本次输入。</p></>}</div>
    <div className="cost-neural-result" aria-live="polite"><span>{isSynthetic?'示例单方成本预测':'中标金额按受益建筑面积摊算'}</span><strong>{format(price,1)}<small>元/㎡</small></strong><p>按当前{format(floorArea)}㎡折算 <b>{format(total,1)}万元</b></p><div className="cost-neural-baseline"><span>训练样本中位数基线</span><b>{format(baseline,1)}元/㎡</b><div><i style={{width:`${Math.min(100,price/(price+baseline)*100)}%`}}/></div><span>模型与基线同时保留，方便核对。</span></div><p className="cost-neural-context">{isSynthetic?'目标是人为构造的EPC单方成本，未代替本社区建设预算。':'目标是施工中标价格，未转为竣工结算成本。'}{unknownScope?' 当前范围未在训练集中出现，属于范围外试验。':''}</p></div>
   </div>
   <details className="cost-neural-validation"><summary>这次训练用了哪些数据，效果怎样</summary><p>{isSynthetic?'合成数据：300条训练、60条开发、60条另行评估、60条锁定测试。':'公告数据：上海20条训练、4条开发、4条另行评估，广东9条锁定测试；没有浙江建筑面积样本。'}PSO只按开发集误差选择参数，锁定测试不参与训练或选型。</p><div className="cost-neural-quality"><div><span>锁定测试样本</span><strong>{metric.n}项</strong></div><div><span>平均绝对误差</span><strong>{format(metric.mae,1)}元/㎡</strong></div><div><span>平均百分比误差</span><strong>{format(metric.mape,1)}%</strong></div><div><span>决定系数 R²</span><strong>{format(metric.r2||0,3)}</strong></div></div><p>{isSynthetic?'该误差只说明模型对生成规则的学习效果，真实造价精度另用真实项目验证。':'当前百分比误差较高、R²为负，跨地区泛化较弱，现有结果适合揭示数据缺口和演示操作。屋面、外墙、综合等范围的价格不能当作同口径均价。'}</p><div className="cost-neural-metric-table"><table><thead><tr><th>同一锁定测试集</th><th>MAE 元/㎡</th><th>MAPE</th><th>R²</th></tr></thead><tbody>{Object.entries(dataset.metrics.locked_final_audit).map(([key,result])=><tr key={key}><th>{modelLabels[key as keyof typeof modelLabels]}</th><td>{format(result.mae,1)}</td><td>{format(result.mape,1)}%</td><td>{format(result.r2||0,3)}</td></tr>)}</tbody></table></div><p>本次为NumPy CPU小型适配：双隐藏层tanh，Adam执行BP更新，外层PSO搜索节点数、学习率与L2。论文MATLAB trainlm及广东原网络权重未复现或直接采用。</p></details>
  </div>}
 </section>
}
