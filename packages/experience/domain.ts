import type { ExperienceDraft, ExperienceEvidence, ExperienceKnowledge, KnowledgeCondition } from '../../apps/host/generated/contracts'
import { validate } from '../contracts/validate'
import { ExperienceError } from './errors'
import { documentSlices, type ParsedDocument, type DocumentSlice } from './document-slices'
import { experienceEvidenceGroups, validateAdditionalKnowledge } from './pipeline-normalize'

export const FIELD_LABELS = {
  decision_question: '决策问题', background: '背景目标', key_conditions: '关键条件', alternatives: '备选方案',
  proposal: '提议方案', actual_decision: '实际决策', decision_basis: '决策依据', implementation: '实际实施', outcome: '执行结果', applicability: '适用边界',
} as const
export type FieldKey = keyof typeof FIELD_LABELS
export const FIELD_KEYS = Object.keys(FIELD_LABELS) as FieldKey[]

export { ExperienceError } from './errors'
export { documentSlices, type DocumentSlice, type ParsedDocument } from './document-slices'

export const instructionLike = (text: string) => /(?:忽略|绕过|覆盖).{0,20}(?:系统|之前|所有|规则|指令|权限)|(?:system|developer)\s*[:：]|(?:API.?KEY|sk-[A-Za-z0-9]{8})/i.test(text)
const quotedConditionValue = (quote: string, value: KnowledgeCondition['value']): boolean => {
  if (typeof value === 'string') return quote.includes(value)
  const literal = String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(typeof value === 'number' ? `(^|[^0-9.eE+-])${literal}(?=$|[^0-9.eE])` : `(^|[^A-Za-z0-9_])${literal}(?=$|[^A-Za-z0-9_])`).test(quote)
}

/** Empty fields are explicit; cited summaries must remain verbatim extracts. */
export function normalizeDraft(value: unknown): ExperienceDraft {
  const draft = structuredClone(validate<ExperienceDraft>('ExperienceDraft', value))
  if (!draft.title.trim()) throw new ExperienceError(422, 'TITLE_REQUIRED', '请填写经验名称。')
  const keys = new Set<string>()
  for (const field of draft.fields) {
    if (keys.has(field.key)) throw new ExperienceError(422, 'DUPLICATE_FIELD', '经验字段不能重复。')
    keys.add(field.key)
    if (field.value !== null && !field.value.trim()) throw new ExperienceError(422, 'EMPTY_FIELD_VALUE', '没有原文记载的字段请使用待补充。')
    if (field.value === null && field.evidence.length) throw new ExperienceError(422, 'NULL_FIELD_CITED', '待补充字段不能附带肯定引文。')
    if (field.value !== null && !field.evidence.length) throw new ExperienceError(422, 'FIELD_EVIDENCE_REQUIRED', '每个非空字段都需要原文引用。')
    if (field.value !== null && !field.evidence.some(evidence => evidence.quote.includes(field.value!))) {
      throw new ExperienceError(422, 'FIELD_VALUE_NOT_QUOTED', '经验值须为所引原文的连续片段，未记载的理由不能补写。')
    }
    if ((field.value !== null && instructionLike(field.value)) || field.evidence.some(evidence => instructionLike(evidence.quote))) {
      throw new ExperienceError(422, 'UNTRUSTED_INSTRUCTION', '材料中的模型指令不能成为经验字段。')
    }
  }
  if (draft.knowledge) {
    const knowledge = draft.knowledge
    if (!knowledge.measure_name.trim()) throw new ExperienceError(422, 'MEASURE_NAME_REQUIRED', '请填写举措名称。')
    const texts = [draft.title, knowledge.measure_name, ...knowledge.transfer_notes]
    for (const condition of [...knowledge.conditions, ...knowledge.exclusions]) {
      texts.push(condition.fact_kind, condition.label, String(condition.value), condition.unit || '', ...condition.evidence.map(evidence => evidence.quote))
      if (typeof condition.value === 'string' && !condition.value.trim()) throw new ExperienceError(422, 'EMPTY_CONDITION_VALUE', '知识条件不能使用空白值。')
      if (condition.source_value !== undefined && !condition.evidence.some(evidence => evidence.quote.includes(condition.source_value!))) {
        throw new ExperienceError(422, 'CONDITION_SOURCE_VALUE_NOT_QUOTED', '条件原文取值须逐字存在于引文中。')
      }
      if (!condition.evidence.some(evidence => quotedConditionValue(evidence.quote, condition.value))
        && !(typeof condition.value === 'boolean' && condition.source_value?.trim())) {
        throw new ExperienceError(422, 'CONDITION_VALUE_NOT_QUOTED', '条件值须逐字存在于原文引文中，不能补写条件。')
      }
      if (condition.unit !== null && !condition.evidence.some(evidence => evidence.quote.includes(condition.unit!))) {
        throw new ExperienceError(422, 'CONDITION_UNIT_NOT_QUOTED', '条件单位须逐字存在于原文引文中。')
      }
      if (condition.unit !== null && !condition.unit.trim()) throw new ExperienceError(422, 'EMPTY_CONDITION_UNIT', '没有单位的知识条件请使用null。')
    }
    if (texts.some(instructionLike)) throw new ExperienceError(422, 'UNTRUSTED_INSTRUCTION', '材料中的模型指令不能成为知识条件或迁移说明。')
    const quotes = [...draft.fields.flatMap(field => field.evidence), ...[...knowledge.conditions, ...knowledge.exclusions].flatMap(condition => condition.evidence)]
    if (knowledge.transfer_notes.some(note => !note.trim() || !quotes.some(evidence => evidence.quote.includes(note)))) {
      throw new ExperienceError(422, 'TRANSFER_NOTE_NOT_QUOTED', '迁移边界须为已有原文引文的连续片段。')
    }
  }
  draft.fields = FIELD_KEYS.map(key => draft.fields.find(field => field.key === key) || { key, value: null, evidence: [] })
  validateAdditionalKnowledge(draft, instructionLike)
  return draft
}

/** Project ownership, immutable byte hash, locator and exact quote all have to match. */
export function validateEvidence(draft: ExperienceDraft, documents: ParsedDocument[], projectId: string): void {
  validateEvidenceGroups(experienceEvidenceGroups(draft), documents, projectId)
}

export function validateEvidenceGroups(references: ExperienceEvidence[][], documents: ParsedDocument[], projectId: string): void {
  const byId = new Map(documents.map(document => [document.id, document]))
  const locatorsByDocument = new Map<string, Map<string, DocumentSlice>>()
  for (const group of references) {
    for (const evidence of group) {
      const document = byId.get(evidence.document_id)
      if (!document || document.project_id !== projectId) throw new ExperienceError(422, 'DOCUMENT_SCOPE', '引用必须来自该项目已导入的原始材料。')
      if (evidence.version !== document.sha256 || document.parser_result.source_hash !== document.sha256) throw new ExperienceError(409, 'DOCUMENT_VERSION_CONFLICT', '原文版本已变化，请重新提取并复核。')
      let locators = locatorsByDocument.get(document.id)
      if (!locators) {
        locators = new Map(documentSlices(document).map(slice => [slice.locator, slice]))
        locatorsByDocument.set(document.id, locators)
      }
      const slice = locators.get(evidence.locator)
      if (!slice) throw new ExperienceError(422, 'LOCATOR_NOT_FOUND', '引用定位不存在。')
      if (!evidence.quote.trim() || !slice.text.includes(evidence.quote)) throw new ExperienceError(422, 'QUOTE_NOT_FOUND', '引文必须逐字存在于指定原文位置。')
    }
  }
}

const aliases: Record<string, FieldKey> = Object.fromEntries([
  ...Object.entries(FIELD_LABELS).map(([key, label]) => [label, key]),
  ...FIELD_KEYS.map(key => [key, key]),
  ['背景', 'background'], ['背景与目标', 'background'], ['目标', 'background'], ['候选方案', 'alternatives'],
  ['提议', 'proposal'], ['拟议方案', 'proposal'], ['实施情况', 'implementation'], ['实施', 'implementation'], ['结果', 'outcome'], ['适用条件', 'applicability'],
  ['依据', 'decision_basis'], ['选择依据', 'decision_basis'],
]) as Record<string, FieldKey>
const metadataAliases: Record<string, keyof Pick<ExperienceDraft, 'title' | 'project_type' | 'development_mode' | 'stage'>> = {
  '经验名称': 'title', '项目类型': 'project_type', '开发模式': 'development_mode', '项目阶段': 'stage',
  title: 'title', project_type: 'project_type', development_mode: 'development_mode', stage: 'stage',
}
const labelKey = (value: string) => value.replace(/^\s*(?:[-*]\s*|#{1,6}\s*)/, '').replace(/\s*\(\d+\)\s*$/, '').trim()
const citation = (document: ParsedDocument, slice: DocumentSlice, quote: string): ExperienceEvidence => ({ document_id: document.id, version: document.sha256, locator: slice.locator, quote })
type Candidate = { draft: ExperienceDraft; values: Map<FieldKey, { value: string; evidence: ExperienceEvidence }[]>; knowledge: Partial<ExperienceKnowledge> }
const candidate = (title: string): Candidate => ({ draft: { title: title.slice(0, 120), project_type: '', development_mode: '', stage: '', fields: [] }, values: new Map(), knowledge: {} })
const knowledgeAliases: Record<string, keyof ExperienceKnowledge> = {
  '举措编号': 'measure_key', '举措名称': 'measure_name', '知识类型': 'kind', '来源类型': 'origin', '证据级别': 'evidence_level',
  '适用条件(JSON数组)': 'conditions', '排除条件(JSON数组)': 'exclusions', '迁移边界': 'transfer_notes',
  measure_key: 'measure_key', measure_name: 'measure_name', kind: 'kind', origin: 'origin', evidence_level: 'evidence_level',
  conditions: 'conditions', exclusions: 'exclusions', transfer_notes: 'transfer_notes',
}
const enumLabels: Record<string, string> = {
  '案例': 'case', '规则': 'rule', '项目案例': 'project_case', '官方政策': 'official_policy', '研究论文': 'research_paper', '实践经验': 'practice',
  '仅提议': 'proposal_only', '实施记录': 'implementation_record', '观察研究': 'observational_study', '对照研究': 'controlled_study', '专家实践': 'expert_practice', '未报告': 'not_reported',
}

/** A labelled JSON condition is itself original text; absent references bind to that exact line. */
function addKnowledge(group: Candidate, key: keyof ExperienceKnowledge, value: string, document: ParsedDocument, slice: DocumentSlice, quote: string): void {
  if (instructionLike(value)) throw new ExperienceError(422, 'UNTRUSTED_INSTRUCTION', '材料中的模型指令不能成为知识元数据。')
  if (key === 'conditions' || key === 'exclusions') {
    let parsed: unknown
    try { parsed = JSON.parse(value) } catch { throw new ExperienceError(422, 'CONDITION_JSON_INVALID', '适用条件和排除条件须使用JSON数组。') }
    if (!Array.isArray(parsed)) throw new ExperienceError(422, 'CONDITION_JSON_INVALID', '适用条件和排除条件须使用JSON数组。')
    group.knowledge[key] = parsed.map(condition => {
      if (!condition || typeof condition !== 'object' || Array.isArray(condition)) throw new ExperienceError(422, 'CONDITION_JSON_INVALID', '每个知识条件须使用JSON对象。')
      return { ...condition, unit: condition.unit ?? null, evidence: condition.evidence ?? [citation(document, slice, quote)] } as KnowledgeCondition
    })
  } else if (key === 'transfer_notes') {
    group.knowledge.transfer_notes = [...(group.knowledge.transfer_notes || []), value]
    const existing = group.values.get('applicability') || []
    group.values.set('applicability', [...existing, { value: existing[0]?.value || value, evidence: citation(document, slice, quote) }])
  } else {
    Object.assign(group.knowledge, { [key]: enumLabels[value] || value })
  }
}

/** Labelled statements only: proposals, decisions, implementation and outcomes never substitute for each other. */
export function extractLocal(document: ParsedDocument): { drafts: ExperienceDraft[]; warnings: string[] } {
  const slices = documentSlices(document), groups: Candidate[] = [], warnings: string[] = []
  let current = candidate(document.file_name)
  const add = (group: Candidate, key: FieldKey, value: string, evidence: ExperienceEvidence) => {
    if (!value.trim() || value.length > 3000 || instructionLike(value) || instructionLike(evidence.quote)) return
    group.values.set(key, [...(group.values.get(key) || []), { value, evidence }])
  }
  for (const slice of slices) {
    if (slice.values) {
      const row = candidate(`${document.file_name} · ${slice.locator}`)
      for (const [rawKey, rawValue] of Object.entries(slice.values)) {
        const key = labelKey(rawKey), value = String(rawValue ?? '').trim()
        if (aliases[key]) add(row, aliases[key], value, citation(document, slice, value))
        else if (knowledgeAliases[key] && value) addKnowledge(row, knowledgeAliases[key], value, document, slice, slice.text)
        else if (metadataAliases[key] && value) row.draft[metadataAliases[key]] = value.slice(0, metadataAliases[key] === 'title' ? 120 : 80)
      }
      if (row.values.size || Object.keys(row.knowledge).length) groups.push(row)
      continue
    }
    for (const line of slice.text.split(/\r?\n/)) {
      const match = line.match(/^\s*(?:[-*]\s*|#{1,6}\s*)?([^:：]{1,60})\s*[:：]\s*(.+)$/)
      if (!match) continue
      const key = labelKey(match[1]), value = match[2].trim()
      const knowledgeKey = knowledgeAliases[key]
      if ((knowledgeKey === 'measure_key' || knowledgeKey === 'measure_name') && (current.knowledge[knowledgeKey] !== undefined || current.values.size > 0 && !current.knowledge.measure_key && !current.knowledge.measure_name)) {
        groups.push(current); current = candidate(document.file_name)
      }
      if (knowledgeKey) { addKnowledge(current, knowledgeKey, value, document, slice, line.trim()); continue }
      const fieldKey = aliases[key]
      if (fieldKey) {
        if (fieldKey === 'decision_question' && current.values.has('decision_question')) { groups.push(current); current = candidate(document.file_name) }
        add(current, fieldKey, value, citation(document, slice, line.trim()))
      } else if (metadataAliases[key] && value) current.draft[metadataAliases[key]] = value.slice(0, metadataAliases[key] === 'title' ? 120 : 80)
    }
  }
  if (current.values.size || Object.keys(current.knowledge).length) groups.push(current)
  const drafts = groups.map(group => {
    group.draft.fields = FIELD_KEYS.map(key => {
      const values = group.values.get(key) || [], unique = new Set(values.map(value => value.value))
      if (unique.size > 1) {
        warnings.push(`${document.file_name}的“${FIELD_LABELS[key]}”有不一致记载，保留待补充，需拆分经验或人工核对。`)
        return { key, value: null, evidence: [] }
      }
      return { key, value: values[0]?.value ?? null, evidence: values.slice(0, 5).map(value => value.evidence) }
    })
    if (Object.keys(group.knowledge).length) {
      if (!group.knowledge.measure_key || !group.knowledge.measure_name) {
        warnings.push(`${document.file_name}的举措缺少编号或名称，知识元数据保留待补充；已有十字段仍可复核。`)
      } else {
        const origin = group.knowledge.origin || 'project_case'
        group.draft.knowledge = {
          kind: group.knowledge.kind || (origin === 'project_case' ? 'case' : 'rule'), origin,
          measure_key: group.knowledge.measure_key, measure_name: group.knowledge.measure_name,
          conditions: group.knowledge.conditions || [], exclusions: group.knowledge.exclusions || [],
          transfer_notes: group.knowledge.transfer_notes || [], evidence_level: group.knowledge.evidence_level || 'not_reported',
        }
        if (group.draft.title === document.file_name) group.draft.title = group.knowledge.measure_name
      }
    }
    return normalizeDraft(group.draft)
  }).filter(draft => draft.fields.some(field => field.value !== null) || draft.knowledge && [...draft.knowledge.conditions, ...draft.knowledge.exclusions].length > 0)
  if (!drafts.length) warnings.push(`${document.file_name}未识别到明确经验字段；可补充标签后重提取，或在原文引用旁手动整理。`)
  if (document.parser_result.status !== 'extracted') warnings.push(`${document.file_name}当前解析状态为${document.parser_result.status || '未知'}，无法补写扫描页或缺失内容。`)
  return { drafts, warnings }
}
