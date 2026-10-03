import { ExperienceError } from './errors'

export interface ParsedDocument {
  id: string; project_id: string; file_name: string; sha256: string; created_at: string;
  parser_result: { status?: string; source_hash?: string; text?: string; segments?: { locator: string; text: string }[]; profile?: { tables?: { rows?: { rowNumber: number; values: Record<string, unknown> }[] }[] } }
}
export interface DocumentSlice { locator: string; text: string; values?: Record<string, unknown> }

/** Wrap the existing ParserPort results; never reread or mutate uploaded files. */
export function documentSlices(document: Pick<ParsedDocument, 'file_name' | 'parser_result'>): DocumentSlice[] {
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

