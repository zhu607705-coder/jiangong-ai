import type { ExperienceCard, ExperienceEvidence, Fact, KnowledgeCondition, KnowledgeConditionMatch, KnowledgeMatch, KnowledgeQuery, KnowledgeTrace, ProjectInput } from '../../apps/host/generated/contracts'
import { lexicalSimilarity } from '../../vendor/aihot/algorithms'
import { projectFactUsable } from '../retrofit/planning'

export const KNOWLEDGE_POLICY_VERSION = 'knowledge-routing-v2' as const
// This retrieval cutoff measures shared character pairs, never truth or decision confidence.
const LEXICAL_RELATED_MIN = 0.25
const unique = (values: string[], limit = 100) => [...new Set(values)].slice(0, limit)
const scalar = (value: unknown): value is string | number | boolean => typeof value === 'boolean'
  || typeof value === 'string' && !!value.trim() || typeof value === 'number' && Number.isFinite(value)
const cited = (evidence: ExperienceEvidence) => !!evidence.document_id.trim() && !!evidence.version.trim()
  && !!evidence.locator.trim() && !!evidence.quote.trim()
const valueText = (value: unknown) => { const text = JSON.stringify(value); return text.length > 160 ? text.slice(0, 157) + '...' : text }
const display = (condition: KnowledgeCondition) => `${condition.label}（${condition.fact_kind} ${condition.operator} ${valueText(condition.value)}${condition.unit === null ? '' : ' ' + condition.unit}）`

/** Operators compare like types only. Numeric strings are not measurements. */
function compare(value: Fact['value'], condition: KnowledgeCondition): boolean | null {
  if (!scalar(value) || !scalar(condition.value) || typeof value !== typeof condition.value) return null
  switch (condition.operator) {
    case 'eq': return value === condition.value
    case 'ne': return value !== condition.value
    case 'contains': return typeof value === 'string' && typeof condition.value === 'string' ? value.includes(condition.value) : null
    case 'gt': return typeof value === 'number' && typeof condition.value === 'number' ? value > condition.value : null
    case 'gte': return typeof value === 'number' && typeof condition.value === 'number' ? value >= condition.value : null
    case 'lt': return typeof value === 'number' && typeof condition.value === 'number' ? value < condition.value : null
    case 'lte': return typeof value === 'number' && typeof condition.value === 'number' ? value <= condition.value : null
    default: return null
  }
}

function matchCondition(project: ProjectInput, condition: KnowledgeCondition, knowledgeSource: string): KnowledgeConditionMatch {
  const sameKind = project.facts.filter(fact => fact.kind === condition.fact_kind)
  const admitted = sameKind.filter(fact => projectFactUsable(project, fact)
    && project.sources.find(source => source.id === fact.source_id)?.parse_status !== 'empty')
  const result = (state: KnowledgeConditionMatch['state'], reason: string): KnowledgeConditionMatch => ({
    condition: structuredClone(condition), state, reason,
    fact_refs: unique(admitted.map(fact => fact.id)), evidence_refs: unique([knowledgeSource, ...admitted.map(fact => fact.source_id)]),
  })
  if (!scalar(condition.value) || !condition.evidence.length || !condition.evidence.every(cited)) return result('unknown', '条件原文引用或比较值不完整，需复核。')
  if (!admitted.length) return result('unknown', sameKind.length
    ? '同名资料未通过来源、对象、时点或事实状态核验，不能确认本项目条件。'
    : '当前项目没有该条件的已核实事实。')
  // Do not select a convenient unit/value from conflicting records or silently convert units.
  if (admitted.some(fact => fact.unit !== condition.unit)) return result('unknown', '事实单位与条件单位不一致，需核实口径后再比较。')
  if (new Set(admitted.map(fact => `${typeof fact.value}:${JSON.stringify(fact.value)}`)).size > 1) {
    return result('conflict', '同一条件存在多个不同的已核实值，需回查分歧。')
  }
  const matched = compare(admitted[0].value, condition)
  if (matched === null) return result('unknown', '事实和条件的类型或比较方式不兼容，不能转换后确认。')
  return result(matched ? 'matched' : 'unmatched', matched
    ? '已核实事实满足该结构化条件。'
    : `已核实事实 ${valueText(admitted[0].value)} 不满足 ${display(condition)}。`)
}

function recommendation(card: ExperienceCard): string | null {
  const keys = card.knowledge?.kind === 'case' ? ['actual_decision', 'implementation', 'proposal', 'decision_basis'] as const : ['actual_decision', 'proposal', 'decision_basis'] as const
  for (const key of keys) {
    const field = card.fields.find(field => field.key === key)
    if (field?.value?.trim() && field.evidence.some(evidence => cited(evidence) && evidence.quote.includes(field.value!))) return field.value
  }
  return null
}

function matchCard(project: ProjectInput, card: ExperienceCard, query: KnowledgeQuery): KnowledgeMatch {
  const knowledge = card.knowledge!, knowledgeSource = `S-KB-${card.id}-R${card.revision}`
  const relevantTexts = [card.title, knowledge.measure_name,
    ...card.fields.filter(field => ['decision_question', 'key_conditions', 'applicability'].includes(field.key)).map(field => field.value || ''),
    ...knowledge.conditions.map(condition => [condition.label, condition.fact_kind, String(condition.value)].join(' ')),
  ]
  const question = query.question.trim().toLowerCase()
  const similarity = Math.max(0, ...relevantTexts.map(text => lexicalSimilarity(question, text.toLowerCase())))
  const key = query.measure_key.trim(), related = key ? key === knowledge.measure_key : !!question && similarity >= LEXICAL_RELATED_MIN
  const conditions = knowledge.conditions.map(condition => matchCondition(project, condition, knowledgeSource))
  const exclusions = knowledge.exclusions.map(condition => matchCondition(project, condition, knowledgeSource))
  const suggested = recommendation(card)
  const evidenceDifferences: string[] = []
  if (knowledge.kind === 'case') {
    for (const [key, label] of [['implementation', '实际实施'], ['outcome', '实际结果']] as const) {
      if (!card.fields.some(field => field.key === key && field.value?.trim() && field.evidence.some(evidence => cited(evidence) && evidence.quote.includes(field.value!)))) {
        evidenceDifferences.push(`原文未提供可引用的${label}，该案例不能作为实施成功或效果已验证的依据。`)
      }
    }
    if (knowledge.evidence_level === 'proposal_only') evidenceDifferences.push('证据层级为提议记载，复用范围限于有条件的提议，不能宣称实施效果。')
  }
  if (knowledge.evidence_level === 'observational_study') evidenceDifferences.push('观察性研究可支持方法借鉴与条件关联，不能据此确认因果效益。')
  const incompatible = !related || conditions.some(row => row.state === 'unmatched') || exclusions.some(row => row.state === 'matched')
  const important_differences = unique([
    ...(!related ? [key ? `当前举措 ${key} 与案例举措 ${knowledge.measure_key} 不一致。` : '决策问题未形成足够的词法关联，需确认是否属于同一举措。'] : []),
    ...conditions.filter(row => row.state === 'unmatched').map(row => row.reason),
    ...exclusions.filter(row => row.state === 'matched').map(row => `已命中排除条件：${display(row.condition)}。`),
    ...evidenceDifferences,
  ], 30)
  const unknowns = unique([
    ...(!conditions.length ? ['没有结构化适用条件，无法确认可迁移性。'] : []),
    ...conditions.filter(row => ['unknown', 'conflict'].includes(row.state)).map(row => `${row.condition.label}：${row.reason}`),
    ...exclusions.filter(row => ['unknown', 'conflict'].includes(row.state)).map(row => `排除项 ${row.condition.label}：${row.reason}`),
    ...(!suggested ? ['实际决策、提议或决策依据缺少可引用的推荐片段。'] : []),
  ], 30)
  const transferability = incompatible ? 'not_transferable'
    : conditions.length && conditions.every(row => row.state === 'matched') && exclusions.every(row => row.state === 'unmatched') && suggested
      ? 'transferable' : 'conditional'
  return {
    card_id: card.id, card_revision: card.revision, title: card.title, source_project_id: card.project_id,
    kind: knowledge.kind, origin: knowledge.origin, measure_key: knowledge.measure_key, measure_name: knowledge.measure_name,
    similarity, related, transferability, conditions, exclusions,
    similar_conditions: conditions.filter(row => row.state === 'matched').map(row => display(row.condition)),
    important_differences,
    reuse_premises: unique([...conditions.map(row => display(row.condition)), ...exclusions.map(row => '须排除：' + display(row.condition)), ...knowledge.transfer_notes], 30),
    unknowns, recommendation: suggested,
    evidence_refs: unique([knowledgeSource, ...conditions.flatMap(row => row.evidence_refs), ...exclusions.flatMap(row => row.evidence_refs)]),
  }
}

/** Pure routing over already permission/time/version-filtered reviewed knowledge.
 * Similarity ranks candidates. Provenance-bound facts decide applicability.
 * A hit never creates a project fact or bypasses the final business constraint gate.
 */
export function matchKnowledge(project: ProjectInput, cards: ExperienceCard[], query: KnowledgeQuery): KnowledgeTrace {
  const matches = cards.filter(card => card.status === 'approved' && card.knowledge).map(card => matchCard(project, card, query))
    .sort((a, b) => b.similarity - a.similarity || (a.card_id < b.card_id ? -1 : a.card_id > b.card_id ? 1 : b.card_revision - a.card_revision))
  const direct = matches.filter(match => match.related && match.transferability === 'transferable')
  const allCaseHits = direct.filter(match => match.kind === 'case'), allRuleHits = direct.filter(match => match.kind === 'rule')
  const route = allCaseHits.length && allRuleHits.length ? 'combined_hit' : allCaseHits.length ? 'case_hit' : allRuleHits.length ? 'rule_hit' : 'agent_fallback'
  const reasons: string[] = [query.measure_key.trim()
    ? '相关性按显式举措标识判断；词法相似度仅用于排列候选。'
    : '未选择举措标识，相关性按决策问题的词法重合判断；相似度不代表可信概率。']
  if (route === 'agent_fallback') reasons.push('案例与规则均无满足全部适用条件且已排除禁用条件的直接命中，等待 Agent 保底研判。')
  else reasons.push('至少一路知识具备可引用依据和完整适用条件，将交由Agent研判迁移与建议；最终行动仍接受业务硬约束检查。')
  const ruleMeasures = unique(allRuleHits.map(match => match.measure_key))
  for (const measure of ruleMeasures) {
    const rules = allRuleHits.filter(match => match.measure_key === measure)
    if (new Set(rules.map(match => match.recommendation)).size > 1) reasons.push(`举措 ${measure} 的命中规则包含不同推荐原文（${rules.slice(0, 5).map(match => match.card_id).join('、')}${rules.length > 5 ? `等 ${rules.length} 条` : ''}）；保留分歧，需复核。自由文本差异不能自动判为一致或相反。`)
  }
  const candidates = matches.filter(match => match.transferability !== 'transferable')
  if (allCaseHits.length > 20 || allRuleHits.length > 20 || candidates.length > 100) reasons.push('展示数量已按契约上限截取，请缩小举措范围查看其余记录。')
  return { policy_version: KNOWLEDGE_POLICY_VERSION, evaluated_as_of: project.as_of, query: structuredClone(query), route,
    case_hits: allCaseHits.slice(0, 20), rule_hits: allRuleHits.slice(0, 20), candidates: candidates.slice(0, 100), reasons: reasons.slice(0, 30),
    fallback_status: route === 'agent_fallback' ? 'pending' : 'not_needed', agent_status: 'pending' }
}
