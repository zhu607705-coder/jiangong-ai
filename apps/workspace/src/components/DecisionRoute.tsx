import type { DecisionSupport, MapScreenProfile } from '../../../host/generated/contracts'
import { DECISION_ACTIONS, decisionErrorMessage } from '../../../../packages/decision/route-labels'
import { factorLabels } from '../../../../packages/maps/decision-factors'

export function DecisionRoute({value, details=false, profile}: {value?:DecisionSupport;details?:boolean;profile?:MapScreenProfile}) {
  if(!value) return null
  if(value.status!=='completed' || !value.answers || !value.action || !value.priority) return details ? <div className="decision-route-details"><strong>Qwen 判断未完成</strong><p>{decisionErrorMessage(value.error_code)}</p><small>{value.duration_ms > 0 ? `已等待 ${(value.duration_ms / 1000).toFixed(1)} 秒 · ` : ''}{value.error_code}</small></div> : null
  const labels = factorLabels(value.policy_version ? (value.policy_version.includes('neighborhood') ? 'neighborhood' : 'balanced') : profile)
  if(!details) return <div className="decision-route" aria-label="本轮判断操作"><strong>{DECISION_ACTIONS[value.action]}</strong><span>优先核查 · {labels[value.priority]}</span></div>
  return <div className="decision-route-details"><strong>结构化判断依据</strong><p>{value.model} · {value.duration_ms} ms</p>
    <p>原始选择：{DECISION_ACTIONS[value.answers.next_action.choice as keyof typeof DECISION_ACTIONS]} · 置信度 {(100*value.answers.next_action.confidence).toFixed(1)}%</p>
    <dl>{Object.entries(value.answers.next_action.probabilities).map(([key,p])=><div key={key}><dt>{DECISION_ACTIONS[key as keyof typeof DECISION_ACTIONS]}</dt><dd>{(100*p).toFixed(1)}%</dd></div>)}</dl>
    {value.guard_reasons.map(reason=><p key={reason}>{reason}</p>)}
    <p>分流阈值是当前研究规则，尚未用企业结果校准；模型置信度不作为投资成功率。</p>
    <small>请求 {value.request_id} · 输入 {value.input_tokens} tokens · {value.policy_version}</small>
  </div>
}
