import type { CandidateId, DecisionPacket, Finding, Scenario } from '../../apps/host/generated/contracts'
import {NEIGHBORHOOD_COMPARISON_POLICY} from './comparison-policy'
import {NEIGHBORHOOD_DIMENSION_POLICY} from '../retrofit/policy'

type Criterion = NonNullable<DecisionPacket['comparison']>['criteria'][number]['criterion']
const themeDefinitions: { label: string; criteria: Criterion[] }[] = [
  { label: '对象与实施', criteria: ['implementation', 'building'] },
  { label: '使用与组织', criteria: ['demand', 'organization'] },
  { label: '承接与资源', criteria: ['enterprise', 'resources'] },
]
// These safety checks remain in the saved packet; displaying the same three
// preconditions on every option hides the conditions that distinguish options.
const sharedPolicyConditions = new Set([
  '核实地块和建筑权属、现有租约及实施权限',
  '取得结构检测、消防和用途适配意见',
  '补齐真实功能需求与运营依据',
  '调查活动需取得相应现场和资料访问授权',
])
const emptyProse = /暂缓基线|先补对象与权限证据再定路径|企业适配待核|不足以支撑入口判断|待核：未取得可核验的能力与资源材料/
// A stored model action does not establish that an old procurement round is open.
const immediateBid = /[，；。]\s*(?:直接)?投(?:标|\d)|^(?:立即|直接)?(?:投标|报名|递交)/
const unique = (items: string[]) => [...new Set(items.map(s => s.trim()).filter(Boolean))]
const terminal = (text: string) => /[。！？]$/.test(text) ? text : `${text}。`
const meaningful = (text: string) => !!text.trim() && !emptyProse.test(text)
const sourceIds = (packet: DecisionPacket, refs: string[]) => {
  const allowed = new Set(packet.sources.map(s => s.id))
  return unique(refs).filter(id => allowed.has(id))
}

export type BriefTheme = {
  label: string
  judgments: string[]
  unknowns: string[]
  sourceRefs: string[]
  findings: Finding[]
}
export type BriefPath = {
  id: CandidateId
  title: string
  status: Scenario['status']
  actions: string[]
  conditions: string[]
  organizationNotes: string[]
  themes: BriefTheme[]
  sourceRefs: string[]
}
export type BriefAction = { id: string | null; title: string; why: string; priority: number; impactedPaths: CandidateId[] }

function specificConditions(packet: DecisionPacket, scenario: Scenario): string[] {
  const own = unique(scenario.prerequisites).filter(s => !sharedPolicyConditions.has(s) && meaningful(s))
  if (own.length) return own.slice(0, 3)
  return unique((packet.comparison?.criteria || []).flatMap(c =>
    c.judgments.filter(j => j.scenario_id === scenario.id).flatMap(j => j.unknowns),
  )).filter(meaningful).slice(0, 3)
}

function investigationTitle(scenario: Scenario): string {
  const action = scenario.actions.find(meaningful)?.replace(/^先(?:行)?/, '').replace(/[。；]$/, '').trim()
  return action || '核对本项目调查对象与来源'
}

function themesFor(packet: DecisionPacket, scenario: Scenario): BriefTheme[] {
  const scenarioRefs = new Set(scenario.evidence_refs)
  const definitions=packet.comparison?.policy_version===NEIGHBORHOOD_COMPARISON_POLICY
    ?NEIGHBORHOOD_DIMENSION_POLICY.map(d=>({label:d.label,criteria:[d.key] as Criterion[]})):themeDefinitions
  return definitions.map(definition => {
    const judgments = (packet.comparison?.criteria || [])
      .filter(c => definition.criteria.includes(c.criterion))
      .flatMap(c => c.judgments.filter(j => j.scenario_id === scenario.id))
    const findings = packet.findings.filter(f =>
      definition.criteria.includes(f.dimension) &&
      f.status !== 'unknown' &&
      f.evidence_refs.some(ref => scenarioRefs.has(ref)) &&
      meaningful(f.claim),
    ).sort((a, b) => Number(b.status === 'supported') - Number(a.status === 'supported'))
    return {
      label: definition.label,
      judgments: unique(judgments.map(j => j.conclusion)).filter(meaningful),
      unknowns: unique(judgments.flatMap(j => j.unknowns)).filter(meaningful).slice(0, 3),
      sourceRefs: sourceIds(packet, [...judgments.flatMap(j => j.evidence_refs), ...findings.flatMap(f => f.evidence_refs)]),
      findings: findings.slice(0, 1),
    }
  }).filter(theme => theme.judgments.length || theme.findings.length || theme.unknowns.length)
}

/** Read-only projection across specialist findings, six comparison dimensions,
 * scenario actions and follow-ups. Old frozen decisions benefit without a model rerun. */
export function buildDecisionBrief(packet: DecisionPacket) {
  const paths: BriefPath[] = packet.scenarios.filter(s => s.id !== 'defer_and_investigate').map(s => ({
    id: s.id, title: meaningful(s.title) ? s.title : s.actions.find(meaningful) || '核查此实施方式',
    status: s.status, actions: s.status === 'blocked' ? [] : unique(s.actions).filter(action => meaningful(action) && !immediateBid.test(action)),
    conditions: specificConditions(packet, s),
    organizationNotes: unique([
      ...s.rule_refs.flatMap(id => packet.context_rules.filter(rule => rule.id === id && rule.active !== false).map(rule => rule.original_text || rule.note)),
      ...s.preference_notes,
    ]).filter(meaningful),
    themes: themesFor(packet, s),
    sourceRefs: sourceIds(packet, s.evidence_refs),
  }))
  const deferred = packet.scenarios.find(s => s.id === 'defer_and_investigate')
  const investigation = deferred && {
    title: investigationTitle(deferred), actions: unique(deferred.actions).filter(meaningful),
    conditions: specificConditions(packet, deferred), sourceRefs: sourceIds(packet, deferred.evidence_refs),
  }
  const nextActions: BriefAction[] = packet.followups
    .filter(f => !f.id.startsWith('decision-') && meaningful(f.title))
    .sort((a, b) => a.priority - b.priority)
    .map(f => ({ id: f.id, title: f.title, why: meaningful(f.why) ? f.why : '', priority: f.priority, impactedPaths: f.impacted_paths }))
    .filter((f, i, all) => all.findIndex(item => item.title === f.title) === i)
    .slice(0, 3)
  if (!nextActions.length && investigation?.actions.length) {
    nextActions.push({ id: null, title: investigation.actions[0], why: '', priority: 1, impactedPaths: packet.scenarios.map(s => s.id) })
  }
  const findings = packet.findings.filter(f => f.status !== 'unknown' && meaningful(f.claim) && sourceIds(packet, f.evidence_refs).length)
  const leading = findings.find(f => f.status === 'supported')?.claim.split(/[：；。]/)[0]
    || paths.flatMap(p => p.themes).flatMap(t => t.judgments)[0]
  const summary = [leading && terminal(leading), nextActions[0] && terminal(`本轮优先${nextActions[0].title.replace(/[。]$/, '')}`)].filter(Boolean).join('')
    || (investigation ? terminal(investigation.title) : '尚未形成可引用的项目判断。')
  const comparisonScope=packet.comparison?.policy_version===NEIGHBORHOOD_COMPARISON_POLICY
    ?'逐项比较居民需求、公共服务、居住工程、实施协同、长效维护和资金交付；条件依据来自本次冻结原文。'
    :'按原结果的实施、建筑、需求、组织、企业和资源口径核对；来源指向本次冻结原文。'
  return { summary, paths, investigation, nextActions, findings, comparisonScope }
}
