import type { ExperienceDraft, ExperienceEvidence, ExperienceField } from '../../apps/host/generated/contracts'
import { validate } from '../contracts/validate'

export const FIELD_LABELS = {
  decision_question: '决策问题', background: '背景目标', key_conditions: '关键条件', alternatives: '备选方案',
  proposal: '提议方案', actual_decision: '实际决策', decision_basis: '决策依据', implementation: '实际实施', outcome: '执行结果', applicability: '适用边界',
} as const
export type FieldKey = keyof typeof FIELD_LABELS
export const FIELD_KEYS = Object.keys(FIELD_LABELS) as FieldKey[]

export class ExperienceError extends Error {
  constructor(readonly status: number, readonly code: string, detail: string) { super(detail) }
}
export interface ParsedDocument {
  id: string; project_id: string; file_name: string; sha256: string; created_at: string;
  parser_result: { status?: string; source_hash?: string; text?: string; segments?: { locator: string; text: string }[]; profile?: { tables?: { rows?: { rowNumber: number; values: Record<string, unknown> }[] }[] } }
}
export interface DocumentSlice { locator: string; text: string; values?: Record<string, unknown> }

/** Wrap the existing ParserPort results; never reread or mutate uploaded files. */
export function documentSlices(document: ParsedDocument): DocumentSlice[] {
  const parsed = document.parser_result
  const slices: DocumentSlice[] = []
  for (const segment of parsed.segments || []) {
    if (typeof segment.locator === 'string' && typeof segment.text === 'string' && segment.text.trim()) slices.push({ ...segment })
  }
  const textFormat = /\.(md|txt)$/i.test(document.file_name)
  if (textFormat || !slices.length && !/\.(csv|xlsx)$/i.test(document.file_name)) {
    for (const [index, text] of (parsed.text || '').split(/\r?\n/).entries()) {
      if (text.trim()) slices.push({ locator: `line:${index + 1}`, text })
    }
  }
  for (const [tableIndex, table] of (parsed.profile?.tables || []).entries()) {
    for (const row of table.rows || []) {
      if (!Number.isInteger(row.rowNumber) || !row.values || typeof row.values !== 'object') continue
      slices.push({ locator: `table:${tableIndex + 1}/row:${row.rowNumber}`, text: Object.entries(row.values).map(([key, value]) => `${key}=${String(value ?? '')}`).join(' | '), values: row.values })
    }
  }
  // A locator must resolve to one unambiguous slice of the parsed original.
  const result = new Map<string, DocumentSlice>()
  for (const slice of slices) {
    const old = result.get(slice.locator)
    if (old && old.text !== slice.text) throw new ExperienceError(422, 'AMBIGUOUS_LOCATOR', '解析定位存在冲突，请核查原文。')
    result.set(slice.locator, slice)
  }
  return [...result.values()]
}

export const instructionLike = (text: string) => /(?:忽略|绕过|覆盖).{0,20}(?:系统|之前|所有|规则|指令|权限)|(?:system|developer)\s*[:：]|(?:API.?KEY|sk-[A-Za-z0-9]{8})/i.test(text)

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
  draft.fields = FIELD_KEYS.map(key => draft.fields.find(field => field.key === key) || { key, value: null, evidence: [] })
  return draft
}

/** Project ownership, immutable byte hash, locator and exact quote all have to match. */
export function validateEvidence(draft: ExperienceDraft, documents: ParsedDocument[], projectId: string): void {
  const byId = new Map(documents.map(document => [document.id, document]))
  for (const field of draft.fields) {
    for (const evidence of field.evidence) {
      const document = byId.get(evidence.document_id)
      if (!document || document.project_id !== projectId) throw new ExperienceError(422, 'DOCUMENT_SCOPE', '引用必须来自该项目已导入的原始材料。')
      if (evidence.version !== document.sha256 || document.parser_result.source_hash !== document.sha256) throw new ExperienceError(409, 'DOCUMENT_VERSION_CONFLICT', '原文版本已变化，请重新提取并复核。')
      const slice = documentSlices(document).find(item => item.locator === evidence.locator)
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
type Candidate = { draft: ExperienceDraft; values: Map<FieldKey, { value: string; evidence: ExperienceEvidence }[]> }
const candidate = (title: string): Candidate => ({ draft: { title: title.slice(0, 120), project_type: '', development_mode: '', stage: '', fields: [] }, values: new Map() })

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
        else if (metadataAliases[key] && value) row.draft[metadataAliases[key]] = value.slice(0, metadataAliases[key] === 'title' ? 120 : 80)
      }
      if (row.values.size) groups.push(row)
      continue
    }
    for (const line of slice.text.split(/\r?\n/)) {
      const match = line.match(/^\s*(?:[-*]\s*|#{1,6}\s*)?([^:：]{1,60})\s*[:：]\s*(.+)$/)
      if (!match) continue
      const key = labelKey(match[1]), value = match[2].trim()
      const fieldKey = aliases[key]
      if (fieldKey) {
        if (fieldKey === 'decision_question' && current.values.has('decision_question')) { groups.push(current); current = candidate(document.file_name) }
        add(current, fieldKey, value, citation(document, slice, line.trim()))
      } else if (metadataAliases[key] && value) current.draft[metadataAliases[key]] = value.slice(0, metadataAliases[key] === 'title' ? 120 : 80)
    }
  }
  if (current.values.size) groups.push(current)
  const drafts = groups.map(group => {
    group.draft.fields = FIELD_KEYS.map(key => {
      const values = group.values.get(key) || [], unique = new Set(values.map(value => value.value))
      if (unique.size > 1) {
        warnings.push(`${document.file_name}的“${FIELD_LABELS[key]}”有不一致记载，保留待补充，需拆分经验或人工核对。`)
        return { key, value: null, evidence: [] }
      }
      return { key, value: values[0]?.value ?? null, evidence: values.slice(0, 5).map(value => value.evidence) }
    })
    return normalizeDraft(group.draft)
  }).filter(draft => draft.fields.some(field => field.value !== null))
  if (!drafts.length) warnings.push(`${document.file_name}未识别到明确经验字段；可补充标签后重提取，或在原文引用旁手动整理。`)
  if (document.parser_result.status !== 'extracted') warnings.push(`${document.file_name}当前解析状态为${document.parser_result.status || '未知'}，无法补写扫描页或缺失内容。`)
  return { drafts, warnings }
}
