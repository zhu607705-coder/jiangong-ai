import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, extname, join, resolve } from 'node:path'
import { parseMaterial } from '../../apps/host/ingest'
import { parseCsvRows } from '../../vendor/cre/dashboard/server/parser-service'
import { projectPython } from '../../scripts/python-runtime'

const execFileAsync = promisify(execFile)
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024
const FORMATS = ['.txt', '.md', '.csv', '.pdf', '.docx', '.xlsx']
export type EvaluationDocument = {
  id: string; file_name: string; source_path: string; source_hash: string; text_hash: string
  source_bytes: number; parser: string; text: string; locators: string[]; parse_notes: string[]
  extraction_scope: 'full_text' | 'bounded_parser_output'
}
export type InputOptions = { projectRoot: string; pythonPath?: string }

/** The existing ParserPort performs extraction. This adapter adds local CLI provenance and budgets. */
export async function loadEvaluationDocument(file: string, options: InputOptions): Promise<EvaluationDocument> {
  let path: string
  try { path = await realpath(file) } catch { throw new Error('DOCUMENT_FILE_NOT_FOUND') }
  const info = await stat(path), fileName = basename(path), extension = extname(fileName).toLowerCase()
  if (!info.isFile()) throw new Error('DOCUMENT_NOT_A_FILE')
  if (info.size > MAX_DOCUMENT_BYTES) throw new Error('DOCUMENT_FILE_LIMIT')
  if (!FORMATS.includes(extension)) throw new Error('DOCUMENT_FORMAT_UNSUPPORTED')
  const bytes = await readFile(path), hash = createHash('sha256').update(bytes).digest('hex')
  const id = 'DOC-' + hash.slice(0, 16)
  let parsed: { status: string; parser: string; source_hash: string; text: string; notes: string[]; segments?: { locator: string; text: string }[] }
  let locators: string[], scope: EvaluationDocument['extraction_scope']
  if (['.txt', '.md', '.csv'].includes(extension)) {
    let decoded: string
    try { decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { throw new Error('DOCUMENT_TEXT_ENCODING') }
    if (bytes.includes(0)) throw new Error('DOCUMENT_TEXT_ENCODING')
    const csvRows = extension === '.csv' ? parseCsvRows(decoded) : []
    // parseMaterial previews at most 250 CSV records; do not silently grade a larger table's prefix.
    if (csvRows.length > 250) throw new Error('DOCUMENT_EXTRACT_LIMIT')
    parsed = parseMaterial({ documentId: id, fileName, filePath: path, mime: 'text/plain', type: 'document', projectRoot: options.projectRoot })
    locators = extension === '.csv' ? [`csv:rows:1-${csvRows.length}`] : [`lines:1-${parsed.text.split(/\r\n|\r|\n/).length}`]
    scope = 'full_text'
  } else {
    const directory = await mkdtemp(join(tmpdir(), 'jiangong-document-eval-'))
    try {
      const blobs = join(directory, 'blobs'); await mkdir(blobs)
      const copied = join(blobs, id + extension); await copyFile(path, copied)
      const python = options.pythonPath || projectPython(options.projectRoot)
      const script = 'import json,sys\nfrom services.capabilities.parsers import parse_document\nprint(json.dumps(parse_document(sys.argv[1],sys.argv[2],sys.argv[3]),ensure_ascii=False))'
      try {
        const { stdout } = await execFileAsync(python, ['-c', script, copied, fileName, id], {
          cwd: resolve(options.projectRoot), env: { ...process.env, PYTHONUTF8: '1', DATA_DIR: directory }, timeout: 45000, maxBuffer: 12 * 1024 * 1024,
        })
        parsed = JSON.parse(stdout)
      } catch { throw new Error('DOCUMENT_BINARY_PARSER_FAILED') }
    } finally { await rm(directory, { recursive: true, force: true }) }
    locators = parsed.segments?.map(segment => segment.locator) || []
    scope = 'bounded_parser_output'
    if (parsed.notes?.some(note => note.includes('研判输入已截断'))) throw new Error('DOCUMENT_EXTRACT_LIMIT')
    parsed.notes = [...parsed.notes, '评估范围为现有 ParserPort 提取的内容；PDF 最多 50 页，DOCX 最多 50 表且每表 251 行，XLSX 最多 30 表且每表读取 5000 行、预览 250 行。未提取部分不参与评估。']
  }
  if (parsed.status === 'ocr_required') throw new Error('DOCUMENT_OCR_REQUIRED')
  if (parsed.status !== 'extracted' || !parsed.text?.trim()) throw new Error('DOCUMENT_EMPTY')
  if (parsed.source_hash !== hash) throw new Error('DOCUMENT_SOURCE_CHANGED')
  return { id, file_name: fileName, source_path: path, source_hash: hash, source_bytes: info.size, parser: parsed.parser,
    text_hash: createHash('sha256').update(parsed.text).digest('hex'), text: parsed.text, locators,
    extraction_scope: scope, parse_notes: parsed.notes }
}
