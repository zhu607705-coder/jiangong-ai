import { readFileSync } from 'node:fs'
import { extname } from 'node:path'
import { z } from 'zod'
import { fileHash, parseCsvRows, buildUploadedDataProfile, buildTextUploadedDataProfile, type ParserInput } from '../../vendor/cre/dashboard/server/parser-service'
import { config } from './config'
import type { Fact } from './generated/contracts'

export class DocumentParseError extends Error {}

/** A UTF-8 form field preserves browser filenames without guessing the header's encoding. */
export function uploadFileName(originalName: string, suppliedName: unknown): string {
  if (suppliedName === undefined) return originalName
  return z.string().min(1).max(250)
    .refine(name => name.trim().length > 0 && !/[\p{Cc}\p{Cs}/\\:]/u.test(name), '文件名不能包含路径或控制字符')
    .refine(name => extname(name).toLowerCase() === extname(originalName).toLowerCase(), '文件名扩展名必须与上传文件一致')
    .parse(suppliedName)
}

/** Preserve table rows as source-bound records, without inventing project-wide aggregates. */
export function tableFacts(profile: unknown, documentId: string): Fact[] {
  if (!profile || typeof profile !== 'object' || !('tables' in profile) || !Array.isArray(profile.tables)) return []
  const facts: Fact[] = []
  for (const [tableIndex, candidate] of profile.tables.entries()) {
    if (!candidate || typeof candidate !== 'object' || !Array.isArray(candidate.rows)) continue
    for (const row of candidate.rows) {
      if (facts.length >= 1000) return facts
      if (!Number.isInteger(row.rowNumber) || !row.values || typeof row.values !== 'object') continue
      const locator = `table:${tableIndex + 1}/row:${row.rowNumber}`
      facts.push({ id: `${documentId}-T${tableIndex + 1}-R${row.rowNumber}`, kind: 'table_row', value: JSON.stringify(row.values), unit: null, source_id: documentId, object_ref: `document:${documentId}/${locator}`, locator })
    }
  }
  return facts
}

export async function parseDocument(input: ParserInput) {
  if (['.md', '.txt', '.csv'].includes(extname(input.fileName).toLowerCase())) return parseMaterial(input)
  const response = await fetch(`${config.capabilityUrl}/parsers/parse`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Capability-Token': config.capabilityToken }, body: JSON.stringify({ file_path: input.filePath, file_name: input.fileName, document_id: input.documentId }), signal: AbortSignal.timeout(45000) })
  if (!response.ok) {
    const failure = await response.json().catch(() => ({})) as { detail?: string }
    throw new DocumentParseError(failure.detail || `解析服务返回 ${response.status}`)
  }
  return await response.json() as { status: string; parser: string; source_hash: string; text: string; profile: unknown; notes: string[] }
}

export function parseMaterial(input: ParserInput) {
  const raw = readFileSync(input.filePath, 'utf8')
  const isCsv = extname(input.fileName).toLowerCase() === '.csv'
  const rows = isCsv ? parseCsvRows(raw) : []
  const empty = !raw.trim()
  return { status: empty ? 'empty' : 'extracted', parser: 'CRE generic text/table parser', source_hash: fileHash(input.filePath),
    text: isCsv ? rows.slice(0, 250).map(row => row.join(' | ')).join('\n') : raw,
    profile: empty ? { tableCount: 0, rowCount: 0, columnCount: 0, tables: [], issues: [] }
      : isCsv ? buildUploadedDataProfile(input, '项目材料', rows[0] || [], rows.slice(1)) : buildTextUploadedDataProfile(input, raw, '项目材料'),
    notes: ['仅完成可追溯内容解析；没有将材料自动升级为法规、组织约束或已核实事实。'] }
}
