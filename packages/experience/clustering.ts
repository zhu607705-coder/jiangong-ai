import type { ExperienceCard, ExperienceEvidence, FactorDefinition, FactorPolicy, KnowledgeGroup, KnowledgeGrouping, MeasureFactor } from '../../apps/host/generated/contracts'
import { canonical, hash } from '../intelligence/domain'

const GROUPING_VERSION = 'knowledge-complete-linkage-v1'
const MAX_CANDIDATES = 200
const order = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
const unique = (values: string[]) => [...new Set(values)].sort(order)
const cited = (source: ExperienceEvidence) => !!source.document_id.trim() && !!source.version.trim()
  && !!source.locator.trim() && !!source.quote.trim()
const confirmed = (factor: MeasureFactor) => factor.epistemic_status === 'fact' && factor.evidence.length > 0 && factor.evidence.every(cited)
const bounded = (value: number) => Number.isFinite(value) && value >= 0 && value <= 1

export interface FactorDistanceResult {
  distance: number | null
  coverage: number
  comparable: boolean
  reasons: string[]
}

const definitionShape = (definition: FactorDefinition) => ({ key: definition.key, value_type: definition.value_type,
  role: definition.role, weight: definition.weight, unit: definition.unit, scale: definition.scale, measure_keys: unique(definition.measure_keys) })

function activeDefinitions(policy: FactorPolicy, measureKey?: string): { definitions: FactorDefinition[]; error: string | null } {
  if (policy.status === 'rejected') return { definitions: [], error: '因素策略已被拒绝，不能用于归组。' }
  if (!bounded(policy.min_coverage)) return { definitions: [], error: '共同覆盖门槛必须是明确的 0–1 有限数值。' }
  const active = policy.definitions.filter(definition => ['key', 'mandatory'].includes(definition.role) && definition.weight > 0
    && (measureKey === undefined || !definition.measure_keys.length || definition.measure_keys.includes(measureKey)))
    .sort((a, b) => order(a.key, b.key) || order(canonical(definitionShape(a)), canonical(definitionShape(b))))
  const byKey = new Map<string, FactorDefinition>()
  for (const definition of active) {
    if (!Number.isFinite(definition.weight)) return { definitions: [], error: `因素 ${definition.key} 的权重不是有限数值。` }
    const previous = byKey.get(definition.key)
    if (previous && canonical(definitionShape(previous)) !== canonical(definitionShape(definition))) {
      return { definitions: [], error: `因素 ${definition.key} 存在相互冲突的策略定义，不能选择其中一个。` }
    }
    byKey.set(definition.key, definition)
  }
  return { definitions: [...byKey.values()], error: byKey.size ? null : '没有正权重的 key/mandatory 距离因素；不能生成已校准的默认参数。' }
}

// NaN/Infinity must remain distinguishable from missing values even when canonical JSON serializes them as null.
const scalarShape = (value: MeasureFactor['value']) => typeof value === 'number' && !Number.isFinite(value)
  ? { type: 'number', value: String(value) } : { type: typeof value, value }
const measurementShape = (factor: MeasureFactor) => ({ value: scalarShape(factor.value), unit: factor.unit, stage: factor.stage,
  object_ref: factor.object_ref, amount_kind: factor.amount_kind, association: factor.association,
  epistemic_status: factor.epistemic_status, derivation: factor.derivation ?? null })
const monetary = (factor: MeasureFactor) => factor.amount_kind !== 'not_applicable'
  || /(?:元|人民币|\bcny\b|\brmb\b|\busd\b|\beur\b|[$€¥])/i.test(factor.unit ?? '')
  || typeof factor.value === 'number' && factor.unit === null
    && /(?:^|[._])(?:cost|amount|budget|payment|funding_amount|contract_amount|金额|费用|经费|预算|资金)$/i.test(factor.key)

function measurements(factors: MeasureFactor[]): Map<string, MeasureFactor[]> {
  const result = new Map<string, MeasureFactor[]>()
  for (const factor of factors) {
    const values = result.get(factor.key) ?? []
    values.push(factor); result.set(factor.key, values)
  }
  return result
}

function readMeasurement(values: MeasureFactor[] | undefined): { factor: MeasureFactor | null; reason: string | null } {
  if (!values?.length) return { factor: null, reason: '没有记录，缺失值不补零。' }
  if (new Set(values.map(value => canonical(measurementShape(value)))).size > 1) {
    return { factor: null, reason: '同一因素存在取值、单位、对象或阶段冲突，需回查原文。' }
  }
  if (values.some(value => value.value === null || value.epistemic_status === 'missing')) return { factor: null, reason: '测量值缺失，不能作为零值。' }
  if (values.some(value => !confirmed(value))) return { factor: null, reason: '没有完整的已确认事实引用；估计和情景假设不等于确认值。' }
  if (values.some(value => value.association === 'unresolved' || !value.object_ref?.trim() || !value.stage.trim())) {
    return { factor: null, reason: '因素对象或阶段关联未解决。' }
  }
  const factor = values[0]
  if (monetary(factor) && (factor.association === 'shared' || ['unknown', 'not_applicable'].includes(factor.amount_kind))) {
    return { factor: null, reason: '共享金额或金额口径未明确，不能直接匹配单项费用。' }
  }
  if (factor.association === 'derived' && (!factor.derivation || !factor.derivation.numerator_key.trim() || !factor.derivation.denominator_key.trim())) {
    return { factor: null, reason: '派生值没有明确的计算来源。' }
  }
  return { factor, reason: null }
}

function componentDistance(a: MeasureFactor, b: MeasureFactor, definition: FactorDefinition): { distance: number | null; reason: string | null } {
  if (a.stage !== b.stage) return { distance: null, reason: '记录阶段不同；提议、实施及支付阶段不能互代。' }
  if (a.unit !== b.unit || a.unit !== definition.unit) return { distance: null, reason: '单位不相容，不能静默换算。' }
  if ((monetary(a) || monetary(b)) && a.amount_kind !== b.amount_kind) {
    return { distance: null, reason: '预算、合同、实付、已落实资金等金额口径不同。' }
  }
  switch (definition.value_type) {
    case 'number':
    case 'ordinal': {
      if (typeof a.value !== 'number' || typeof b.value !== 'number' || !Number.isFinite(a.value) || !Number.isFinite(b.value)) {
        return { distance: null, reason: '需要有限的数值类型；数字字符串和序数词不能强制转数。' }
      }
      if (definition.scale === null || !Number.isFinite(definition.scale) || definition.scale <= 0) {
        return { distance: null, reason: '数值和序数距离需要显式的正有限尺度。' }
      }
      return { distance: Math.min(1, Math.abs(a.value - b.value) / definition.scale), reason: null }
    }
    case 'category':
      return typeof a.value === 'string' && typeof b.value === 'string' && !!a.value.trim() && !!b.value.trim()
        ? { distance: a.value === b.value ? 0 : 1, reason: null }
        : { distance: null, reason: '类别需要非空字符串，不能与数值或布尔类型混比。' }
    case 'boolean':
      return typeof a.value === 'boolean' && typeof b.value === 'boolean'
        ? { distance: a.value === b.value ? 0 : 1, reason: null }
        : { distance: null, reason: '布尔因素需要布尔类型，不能从文字推定。' }
  }
}

function distanceWithDefinitions(left: MeasureFactor[], right: MeasureFactor[], definitions: FactorDefinition[], minCoverage: number): FactorDistanceResult {
  const a = measurements(left), b = measurements(right), reasons: string[] = []
  // Normalize weights before summing so individually finite large weights cannot overflow the denominator.
  const largestWeight = Math.max(...definitions.map(definition => definition.weight))
  let totalWeight = 0, commonWeight = 0, weightedDistance = 0
  for (const definition of definitions) {
    const weight = definition.weight / largestWeight
    totalWeight += weight
    const x = readMeasurement(a.get(definition.key)), y = readMeasurement(b.get(definition.key))
    const prefix = `${definition.label}（${definition.key}）：`
    if (x.reason) reasons.push(prefix + x.reason)
    if (y.reason) reasons.push(prefix + y.reason)
    if (!x.factor || !y.factor) continue
    const component = componentDistance(x.factor, y.factor, definition)
    if (component.reason) reasons.push(prefix + component.reason)
    if (component.distance === null) continue
    commonWeight += weight; weightedDistance += weight * component.distance
  }
  const coverage = totalWeight > 0 ? Math.min(1, commonWeight / totalWeight) : 0
  const comparable = commonWeight > 0 && coverage >= minCoverage
  if (!commonWeight) reasons.push('没有共同的可比较因素，不能制造接近度。')
  else if (!comparable) reasons.push(`共同覆盖 ${coverage} 未达到策略门槛 ${minCoverage}。`)
  return { distance: comparable ? Math.min(1, weightedDistance / commonWeight) : null, coverage, comparable, reasons: unique(reasons) }
}

/** Weighted Gower distance over confirmed, like-type common values. It never evaluates business applicability. */
export function factorDistance(left: MeasureFactor[], right: MeasureFactor[], policy: FactorPolicy, measureKey?: string): FactorDistanceResult {
  const prepared = activeDefinitions(policy, measureKey)
  return prepared.error ? { distance: null, coverage: 0, comparable: false, reasons: [prepared.error] }
    : distanceWithDefinitions(left, right, prepared.definitions, policy.min_coverage)
}

const facilityTypes: Record<string, string> = { 电梯: 'elevator', 排水: 'drainage', 管网: 'pipe', 道路: 'road', 照明: 'lighting', 消防: 'fire_safety', 停车: 'parking' }
function referenceType(reference: string | null): string | null {
  const ref = reference?.normalize('NFKC').trim().toLowerCase()
  if (!ref) return null
  if (/(?:^|[/:])(?:unit|entrance|stairwell|单元)[:/-].+/.test(ref) || /\d+\s*(?:号)?单元$/.test(ref)) return 'unit'
  if (/^(?:building|block|楼栋|建筑)[:/-].+/.test(ref) || /^(?:\d+号楼|[a-z\d]+栋)$/.test(ref)) return 'building'
  const facility = ref.match(/^facility:([^:/]+):.+$/)
  if (facility) return 'facility:' + (facilityTypes[facility[1]] ?? facility[1])
  const known = ref.match(/^(elevator|drainage|pipe|road|lighting|parking|fire_safety|电梯|排水|管网|道路|照明|消防|停车)[:/-].+$/)
  return known ? 'facility:' + (facilityTypes[known[1]] ?? known[1]) : null
}

function assetType(card: ExperienceCard): { type: string | null; reason: string | null } {
  const kinds: string[] = []
  for (const factor of card.knowledge?.factors ?? []) {
    if (!confirmed(factor) || factor.association === 'unresolved' || factor.association === 'shared') continue
    const kind = referenceType(factor.object_ref)
    if (kind) kinds.push(kind)
    if (typeof factor.value === 'string' && /(?:^|[._])(?:asset_type|object_type|facility_type)$/.test(factor.key)) {
      const type = factor.value.normalize('NFKC').trim().toLowerCase()
      if (['building', '楼栋', '建筑'].includes(type)) kinds.push('building')
      else if (['unit', '单元'].includes(type)) kinds.push('unit')
      else if (facilityTypes[type] || ['elevator', 'drainage', 'pipe', 'road', 'lighting', 'parking', 'fire_safety'].includes(type)) kinds.push('facility:' + (facilityTypes[type] ?? type))
      else if (/(?:^|[._])facility_type$/.test(factor.key) && /^[a-z][a-z0-9_]*$/.test(type)) kinds.push('facility:' + type)
    }
  }
  for (const chunk of card.knowledge?.chunks ?? []) {
    if (chunk.kind !== 'action' || chunk.measure_key !== card.knowledge?.measure_key || !chunk.spans.length || !chunk.spans.every(cited)) continue
    const kind = referenceType(chunk.object_ref)
    if (kind) kinds.push(kind)
  }
  const types = unique(kinds)
  if (!types.length) return { type: null, reason: '资产对象类型未知；项目名、文字相似或共享资料不能替代楼栋、单元或设施类型关联。' }
  if (types.length > 1) return { type: null, reason: `一张卡涉及多个资产对象类型（${types.join('、')}），需先分清举措对象。` }
  return { type: types[0], reason: null }
}

function evidenceShape(evidence: ExperienceEvidence[]) { return evidence.map(source => ({ ...source })).sort((a, b) => order(canonical(a), canonical(b))) }
function sourceFingerprint(cards: ExperienceCard[], policy: FactorPolicy | null, limit: number): string {
  const definitions = policy?.definitions.filter(definition => ['key', 'mandatory'].includes(definition.role) && definition.weight > 0) ?? []
  const rows = cards.map(card => {
    const keys = new Set(definitions.filter(definition => !definition.measure_keys.length || definition.measure_keys.includes(card.knowledge?.measure_key ?? '')).map(definition => definition.key))
    return { id: card.id, revision: card.revision, status: card.status, stage: card.stage, measure_key: card.knowledge?.measure_key ?? null,
      kind: card.knowledge?.kind ?? null, evidence_level: card.knowledge?.evidence_level ?? null, asset: assetType(card),
      factors: (card.knowledge?.factors ?? []).filter(factor => keys.has(factor.key)).map(factor => ({ ...factor, value: scalarShape(factor.value), evidence: evidenceShape(factor.evidence) }))
        .sort((a, b) => order(canonical(a), canonical(b))) }
  }).sort((a, b) => order(a.id, b.id) || a.revision - b.revision || order(canonical(a), canonical(b)))
  return hash(canonical({ version: GROUPING_VERSION, max_candidates: limit, cards: rows, policy: policy ? {
    id: policy.id, revision: policy.revision, status: policy.status, min_coverage: policy.min_coverage, max_distance: policy.max_distance,
    definitions: definitions.map(definition => ({ ...definitionShape(definition), evidence: evidenceShape(definition.evidence) }))
      .sort((a, b) => order(a.key, b.key) || order(canonical(a), canonical(b))),
  } : null }))
}

interface Candidate { card: ExperienceCard; pool: string; definitions: FactorDefinition[]; selfCoverage: number }
interface Cluster { members: Candidate[]; key: string; diameter: number; coverage: number }
interface Link { distance: number | null; coverage: number }
const clusterKey = (members: Candidate[]) => canonical(members.map(member => ({ card_id: member.card.id, revision: member.card.revision })))

function clusterPool(candidates: Candidate[], policy: FactorPolicy): KnowledgeGroup[] {
  const clusters: (Cluster | null)[] = candidates.map(member => ({ members: [member], key: clusterKey([member]), diameter: 0, coverage: member.selfCoverage }))
  const links: Link[][] = candidates.map(() => [])
  for (let i = 0; i < candidates.length; i++) for (let j = i + 1; j < candidates.length; j++) {
    const result = distanceWithDefinitions(candidates[i].card.knowledge!.factors ?? [], candidates[j].card.knowledge!.factors ?? [], candidates[i].definitions, policy.min_coverage)
    links[i][j] = links[j][i] = { distance: result.distance, coverage: result.coverage }
  }
  // Complete-link distances update by max, including incomparable links. At most n merges scan an n² matrix.
  for (;;) {
    let best: { i: number; j: number; link: Link; key: string } | null = null
    for (let i = 0; i < clusters.length; i++) {
      if (!clusters[i]) continue
      for (let j = i + 1; j < clusters.length; j++) {
        if (!clusters[j]) continue
        const link = links[i][j]
        if (link.distance === null || link.distance > policy.max_distance) continue
        const key = canonical([clusters[i]!.key, clusters[j]!.key].sort(order))
        if (!best || link.distance < best.link.distance! || link.distance === best.link.distance && order(key, best.key) < 0) best = { i, j, link, key }
      }
    }
    if (!best) break
    const a = clusters[best.i]!, b = clusters[best.j]!, members = [...a.members, ...b.members].sort((x, y) => order(x.card.id, y.card.id))
    clusters[best.i] = { members, key: clusterKey(members), diameter: Math.max(a.diameter, b.diameter, best.link.distance!),
      coverage: Math.min(a.coverage, b.coverage, best.link.coverage) }
    clusters[best.j] = null
    for (let k = 0; k < clusters.length; k++) {
      if (k === best.i || !clusters[k]) continue
      const left = links[best.i][k], right = links[best.j][k]
      links[best.i][k] = links[k][best.i] = { distance: left.distance === null || right.distance === null ? null : Math.max(left.distance, right.distance),
        coverage: Math.min(left.coverage, right.coverage) }
    }
  }
  return clusters.filter((cluster): cluster is Cluster => cluster !== null).map(cluster => {
    const first = cluster.members[0], card_refs = cluster.members.map(member => ({ card_id: member.card.id, revision: member.card.revision }))
    return { id: 'KG-' + hash(canonical({ pool: first.pool, card_refs })).slice(0, 24), measure_key: first.card.knowledge!.measure_key,
      stage: first.card.stage, kind: first.card.knowledge!.kind, card_refs, diameter: cluster.diameter, min_coverage: cluster.coverage }
  })
}

/** Organizes reviewed knowledge only. A draft grouping is a preview; neither approval nor similarity bypasses a condition gate. */
export function groupKnowledge(cards: ExperienceCard[], policy: FactorPolicy | null, maxCandidates = MAX_CANDIDATES): KnowledgeGrouping {
  const validLimit = Number.isInteger(maxCandidates) && maxCandidates >= 0
  const limit = validLimit ? Math.min(MAX_CANDIDATES, maxCandidates) : 0
  const result: KnowledgeGrouping = { policy_id: policy?.id ?? null, policy_revision: policy?.revision ?? null,
    policy_status: policy?.status ?? 'none', groups: [], unassigned: [], candidate_count: cards.length, truncated: cards.length > limit,
    source_fingerprint: sourceFingerprint(cards, policy, limit) }
  const unassigned: KnowledgeGrouping['unassigned'] = []
  const sorted = [...cards].sort((a, b) => order(a.id, b.id) || a.revision - b.revision)
  const counts = new Map<string, number>()
  for (const card of sorted) counts.set(card.id, (counts.get(card.id) ?? 0) + 1)
  const pools = new Map<string, Candidate[]>()
  const commonReason = !validLimit ? '候选容量必须是明确的非负整数。' : !policy ? '未配置因素策略；需要显式权重、尺度、共同覆盖和距离门槛后才能归组。'
    : policy.status === 'rejected' ? '因素策略已被拒绝，不能用于归组。' : !bounded(policy.max_distance) ? '归组距离门槛必须是明确的 0–1 有限数值。' : null
  for (let i = 0; i < sorted.length; i++) {
    const card = sorted[i], reject = (reason: string) => unassigned.push({ card_id: card.id, reason })
    if (commonReason) { reject(commonReason); continue }
    if (i >= limit) { reject(`超过本次 ${limit} 张候选容量，未进行距离比较或归组。`); continue }
    if (card.status !== 'approved') { reject('经验卡尚未审核通过，不能作为归组记录。'); continue }
    if ((counts.get(card.id) ?? 0) > 1) { reject('同一卡标识存在多个输入记录或版本，需先明确要复用的已审核版本。'); continue }
    if (!card.knowledge?.measure_key.trim() || !card.stage.trim()) { reject('缺少明确的举措标识或记录阶段，不能进入可比池。'); continue }
    const prepared = activeDefinitions(policy!, card.knowledge.measure_key)
    if (prepared.error) { reject(prepared.error); continue }
    const asset = assetType(card)
    if (!asset.type) { reject(asset.reason!); continue }
    const self = distanceWithDefinitions(card.knowledge.factors ?? [], card.knowledge.factors ?? [], prepared.definitions, policy!.min_coverage)
    if (!self.comparable) { reject(self.reasons.join(' ')); continue }
    // Even a generic card.stage must not let a proposal-only case impersonate an implementation record.
    const phase = card.knowledge.kind === 'case' ? card.knowledge.evidence_level : 'rule'
    const pool = canonical({ measure_key: card.knowledge.measure_key, stage: card.stage, kind: card.knowledge.kind, asset_type: asset.type, phase })
    const candidate: Candidate = { card, pool, definitions: prepared.definitions, selfCoverage: self.coverage }
    const members = pools.get(pool) ?? []
    members.push(candidate); pools.set(pool, members)
  }
  for (const members of pools.values()) result.groups.push(...clusterPool(members, policy!))
  result.groups.sort((a, b) => order(a.card_refs[0].card_id, b.card_refs[0].card_id))
  result.unassigned = unassigned.slice(0, MAX_CANDIDATES)
  if (unassigned.length > MAX_CANDIDATES) result.truncated = true
  return result
}
