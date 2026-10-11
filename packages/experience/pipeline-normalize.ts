import type { ExperienceDraft, ExperienceEvidence, FactorPolicy, MeasureFactor } from '../../apps/host/generated/contracts'
import { validate } from '../contracts/validate'
import { ExperienceError } from './errors'
import { deriveMeasureFactors, extractMeasureFactors } from './measure-factors'

export function experienceEvidenceGroups(draft: ExperienceDraft): ExperienceEvidence[][] {
  return [
    ...draft.fields.map(field => field.evidence),
    ...(draft.knowledge ? [...draft.knowledge.conditions, ...draft.knowledge.exclusions].map(condition => condition.evidence) : []),
    ...(draft.knowledge?.chunks || []).map(chunk => chunk.spans),
    ...(draft.knowledge?.factors || []).map(factor => factor.evidence),
  ]
}

const fail = (code: string, message: string): never => { throw new ExperienceError(422, code, message) }
const unitAliases: Record<string, string[]> = { 'm²': ['m²', 'm2', '㎡', '平方米'], '平方米': ['m²', 'm2', '㎡', '平方米'] }
const quotedNumber = (text: string, value: number) => [...text.matchAll(/[-+]?\d+(?:,\d{3})*(?:\.\d+)?/g)].some(match => Number(match[0].replaceAll(',', '')) === value)
function extractedEvidenceFactors(factor: MeasureFactor): MeasureFactor[] {
  if (!factor.evidence.length) return []
  return extractMeasureFactors({ id: 'evidence-validation', document_id: factor.evidence[0].document_id, document_version: factor.evidence[0].version,
    kind: 'action', classification: 'local', measure_key: 'evidence_validation', object_ref: factor.object_ref, stage: factor.stage,
    spans: factor.evidence, text: factor.evidence.map(e => e.quote).join('\n'), context_chunk_ids: [] })
}

/** New semantic records preserve the same original-evidence boundary as ten-field cards. */
export function validateAdditionalKnowledge(draft: ExperienceDraft, instructionLike: (text: string) => boolean): void {
  const chunks = draft.knowledge?.chunks || [], factors = draft.knowledge?.factors || []
  if (new Set(chunks.map(chunk => chunk.id)).size !== chunks.length) fail('DUPLICATE_CHUNK', '举措片段编号不能重复。')
  const ids = new Set(chunks.map(chunk => chunk.id))
  for (const chunk of chunks) {
    if (!chunk.spans.length || chunk.spans.some(span => span.document_id !== chunk.document_id || span.version !== chunk.document_version)) fail('CHUNK_SOURCE_MISMATCH', '片段必须来自声明的同一原文版本。')
    const joined = chunk.spans.map(span => span.quote).join('\n')
    if (!chunk.text.trim() || !joined.includes(chunk.text)) fail('CHUNK_TEXT_NOT_QUOTED', '片段正文必须来自保存的原文引文。')
    if (chunk.context_chunk_ids.some(id => !ids.has(id))) fail('CHUNK_CONTEXT_NOT_FOUND', '所关联背景片段需要随举措一起保存。')
    if (instructionLike(chunk.text)) fail('UNTRUSTED_INSTRUCTION', '材料中的模型指令不能成为举措片段。')
  }
  for (const factor of factors) {
    if (!/^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(factor.key)) fail('FACTOR_KEY_INVALID', '因素编号须为稳定英文标识。')
    if (!factor.evidence.length && factor.value !== null) fail('FACTOR_EVIDENCE_REQUIRED', '因素数值需要原文定位。')
    if (factor.value === null && factor.epistemic_status !== 'missing') fail('NULL_FACTOR_STATUS', '空因素须标为缺失。')
    if ([factor.label, ...factor.evidence.map(e => e.quote)].some(instructionLike)) fail('UNTRUSTED_INSTRUCTION', '材料中的模型指令不能成为因素。')
    const raw = factor.evidence.map(e => e.quote).join('\n')
    if (factor.association !== 'derived') {
      if (factor.derivation) fail('FACTOR_DERIVATION_STATE', '派生计算需要独立标记。')
      if (typeof factor.value === 'number' && (!Number.isFinite(factor.value) || !quotedNumber(raw, factor.value))) fail('FACTOR_VALUE_NOT_QUOTED', '因素数值必须能在原文中回读。')
      if (typeof factor.value === 'string' && !raw.includes(factor.value)) fail('FACTOR_VALUE_NOT_QUOTED', '因素取值必须来自原文。')
      if (typeof factor.value === 'boolean' && !raw.includes(String(factor.value))) fail('FACTOR_BOOLEAN_MAPPING', '布尔含义需要明确原文，本轮不能猜测转换。')
      const parsed = factor.unit && /元/.test(factor.unit) ? extractedEvidenceFactors(factor).filter(value => value.value === factor.value && value.unit === factor.unit) : []
      if (factor.unit && !(unitAliases[factor.unit] || [factor.unit]).some(unit => raw.includes(unit)) && !parsed.length) fail('FACTOR_UNIT_NOT_QUOTED', '因素单位需要原文依据。')
      if (parsed.length && parsed.every(value => value.association === 'shared' || value.amount_kind === 'package_total') && factor.association === 'direct') fail('FACTOR_SHARED_ALLOCATION', '工程包共享总额不能直接归到单项措施。')
      if (parsed.length && parsed.every(value => value.epistemic_status !== 'fact') && factor.epistemic_status === 'fact') fail('FACTOR_STATUS_NOT_CONFIRMED', '估算或方案假设不能直接改成已核实事实。')
    } else validateDerivedFactor(factor, factors)
  }
}

function validateDerivedFactor(factor: MeasureFactor, factors: MeasureFactor[]): void {
  const calc = factor.derivation
  if (!calc || typeof factor.value !== 'number' || !Number.isFinite(factor.value)) fail('FACTOR_DERIVATION_REQUIRED', '派生因素需要完整计算和数值。')
  const numerators = factors.filter(f => f.key === calc!.numerator_key && f.association !== 'derived')
  const denominators = factors.filter(f => f.key === calc!.denominator_key && f.association !== 'derived')
  if (numerators.length !== 1 || denominators.length !== 1) fail('FACTOR_DERIVATION_AMBIGUOUS', '派生分子分母存在缺项或冲突。')
  const a = numerators[0], b = denominators[0]
  if (a.association !== 'direct' || b.association !== 'direct' || a.amount_kind === 'package_total' || a.amount_kind === 'unknown'
    || a.epistemic_status !== 'fact' || b.epistemic_status !== 'fact' || !a.object_ref || !a.stage || !a.observed_at || a.object_ref !== b.object_ref || a.stage !== b.stage || a.observed_at !== b.observed_at
    || typeof a.value !== 'number' || typeof b.value !== 'number' || b.value <= 0 || !a.unit || !b.unit) fail('FACTOR_DERIVATION_SCOPE', '共享总额、未核值、不同范围或缺失分母不能派生成本。')
  const expected = (a.value as number) / (b.value as number)
  const allowed = deriveMeasureFactors([a, b]).find(value => value.derivation?.formula === calc!.formula && value.derivation.numerator_key === a.key && value.derivation.denominator_key === b.key)
  if (!allowed) fail('FACTOR_DERIVATION_SCOPE', '计费单价或不明确的分项范围不能再次派生成本。')
  if (!a.evidence.some(left => b.evidence.some(right => left.document_id === right.document_id && left.version === right.version && left.locator === right.locator && left.quote === right.quote))) fail('FACTOR_DERIVATION_SCOPE', '派生分子分母需要共同的原文举措依据。')
  if (Math.abs((factor.value as number) - expected) > 1e-9 * Math.max(1, Math.abs(expected)) || factor.unit !== `${a.unit}/${b.unit}`) fail('FACTOR_DERIVATION_MISMATCH', '派生数值或单位与原始分子分母不一致。')
  const refs = new Set(factor.evidence.map(e => [e.document_id, e.version, e.locator, e.quote].join('|')))
  if ([...a.evidence, ...b.evidence].some(e => !refs.has([e.document_id, e.version, e.locator, e.quote].join('|')))) fail('FACTOR_DERIVATION_EVIDENCE', '派生因素须同时保留分子分母证据。')
}

export function validateFactorPolicy(policy: FactorPolicy, approving = false): FactorPolicy {
  const checked = validate<FactorPolicy>('FactorPolicy', policy)
  if (new Set(checked.definitions.map(d => d.key)).size !== checked.definitions.length) fail('DUPLICATE_FACTOR_DEFINITION', '因素定义不能重复。')
  for (const definition of checked.definitions) {
    if (!/^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(definition.key)) fail('FACTOR_KEY_INVALID', '因素编号须为稳定英文标识。')
    if (definition.condition && definition.condition.fact_kind !== definition.key) fail('FACTOR_CONDITION_KEY', '条件与因素编号须一致，避免映射到不同事实。')
    if (approving && ['key', 'mandatory'].includes(definition.role) && ['number', 'ordinal'].includes(definition.value_type) && !(definition.scale && definition.scale > 0)) fail('FACTOR_SCALE_REQUIRED', '数值因素需要复核后的比较尺度。')
    if (approving && definition.role === 'mandatory' && !definition.evidence.length) fail('MANDATORY_EVIDENCE_REQUIRED', '必须遵守的因素需要原始依据和适用范围。')
    if (approving && definition.on_unmet === 'defer' && (!definition.condition || !definition.condition.evidence.length)) fail('DEFER_RULE_EVIDENCE_REQUIRED', '独立暂缓条件需要有原文依据的可检查条件。')
  }
  if (approving && !checked.note.trim()) fail('FACTOR_REVIEW_NOTE_REQUIRED', '请记录因素复核范围与说明。')
  return checked
}
