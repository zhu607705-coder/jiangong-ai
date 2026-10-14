/** Local attachment derivatives, using the existing protected binary ParserPort and RAG exporter.
 * The copy-to-isolated-blobs adapter follows packages/document-evaluation/input.ts, while keeping
 * its complete returned segments/profile instead of the evaluation-only text reduction.
 */
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { basename, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Source } from '../apps/host/generated/contracts'
import { normalizeImportDocument } from '../apps/workspace/src/imports/graph-model'
import { MAX_DOCUMENT_BYTES } from '../packages/document-evaluation/input'
import { buildRagExport, renderRagMarkdown } from '../packages/experience/rag-export'
import { projectPython } from './python-runtime'

const execute = promisify(execFile)
const projectRoot = fileURLToPath(new URL('..', import.meta.url))
const namespace = 'attachments-preparation'
const roles = {
  method_reference: '论文方法参考；论文实验属于作者结果，不作为本项目现况或团队实测记录。',
  project_design: '项目设计文档；方案、目标与技术设计按原文保存，不作为已实施或实测记录。',
  ai_collected_leads: '用户声明AI采集线索；本次没有逐条复核所列原公告，不提升为已核实工程事实。',
} as const
type ContextRole = keyof typeof roles
type Attachment = { path: string; role: ContextRole }
type ParserTable = { rowCount?: number; columnCount?: number; rows?: unknown[]; source?: { sheet?: string; headerRow?: number } }
type ParserResult = {
  status: 'extracted' | 'empty' | 'ocr_required'; parser: string; source_hash: string; text: string;
  segments: { locator: string; text: string }[]; profile: { tableCount: number; tables: ParserTable[] }; notes: string[];
}
type SourceCounts = {
  pages?: number; paragraph_count?: number; nonempty_paragraph_count?: number; table_count?: number;
  tables?: { index: number; rows_including_header: number; columns: number }[];
  sheets?: { name: string; physical_rows: number; nonempty_rows: number }[];
}
type ParsedReceipt = { parsed_result: ParserResult; source_counts: SourceCounts;
  export_extension: 'full_authorized_workbook_rows' | null;
  online_parser_snapshot: { text_chars: number; segments: number; notes: string[]; tables: { sheet: string | null; row_count: number; preview_rows: number }[] } }

const parserLimits = {
  source_bytes_max: MAX_DOCUMENT_BYTES, pdf_pages_max: 50, docx_tables_max: 50, docx_rows_per_table_max: 251,
  xlsx_tables_max: 30, xlsx_rows_read_per_sheet_max: 5000, xlsx_preview_rows_per_sheet_max: 250,
  text_chars_max: 100000, returned_segments_max: 1000, archive_entries_max: 3000, archive_uncompressed_bytes_max: 50 * 1024 * 1024,
}
const digest = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex')
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`
const inside = (parent: string, target: string) => {
  const path = relative(parent, target)
  return path !== '' && !isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`)
}

// The protected parser validates the binary first. Only this local XLSX derivative fills the
// already authorized 5000-row reading window using CRE's exact header and cell serialization.
const pythonScript = String.raw`import json,sys
from pathlib import Path
from services.capabilities.parsers import parse_document
path,file_name,document_id=sys.argv[1:4]
parsed=parse_document(path,file_name,document_id)
snapshot={'text_chars':len(parsed['text']),'segments':len(parsed['segments']),'notes':list(parsed['notes']),'tables':[{'sheet':t.get('source',{}).get('sheet'),'row_count':t.get('rowCount',0),'preview_rows':len(t.get('rows',[]))} for t in parsed['profile']['tables']]}
extension_applied=None
extension=Path(file_name).suffix.lower()
counts={}
if extension=='.pdf':
 import pdfplumber
 with pdfplumber.open(path) as doc: counts={'pages':len(doc.pages)}
elif extension=='.docx':
 from docx import Document
 doc=Document(path)
 counts={'paragraph_count':len(doc.paragraphs),'nonempty_paragraph_count':sum(bool(p.text.strip()) for p in doc.paragraphs),'table_count':len(doc.tables),'tables':[{'index':i+1,'rows_including_header':len(t.rows),'columns':len(t.columns)} for i,t in enumerate(doc.tables)]}
elif extension=='.xlsx':
 from openpyxl import load_workbook
 book=load_workbook(path,read_only=True,data_only=True)
 sheets=[]
 for sheet in book.worksheets:
  physical=nonempty=0
  for row in sheet.iter_rows(values_only=True):
   physical+=1
   nonempty+=int(any(value is not None and str(value).strip() for value in row))
  sheets.append({'name':sheet.title,'physical_rows':physical,'nonempty_rows':nonempty})
 book.close()
 counts={'sheets':sheets}
 import pandas as pd
 from vendor.cre.parsers import prepare_table,serialize_cell
 excel=pd.ExcelFile(path,engine='openpyxl')
 if not getattr(excel.book,'data_only',False): raise ValueError('Workbook export requires cached formula values')
 by_locator={segment['locator']:segment for segment in parsed['segments']}
 for table in parsed['profile']['tables']:
  source=table.get('source',{})
  sheet=source.get('sheet')
  raw=pd.read_excel(excel,sheet_name=sheet,header=None,nrows=5001)
  prepared=prepare_table(raw,sheet)
  columns=[str(column) for column in prepared.columns if not str(column).startswith('__')]
  if prepared.attrs['header_row_number']!=source.get('headerRow') or columns!=table['columns'] or len(prepared)!=table['rowCount']:
   raise ValueError('Authorized row export differs from existing ParserPort header or row semantics')
  rows=[]
  for _,row in prepared.iterrows():
   number=int(row['__excel_row_number'])
   values={column:serialize_cell(row.get(column)) for column in columns}
   rows.append({'rowNumber':number,'values':values})
   locator=f'sheet:{sheet}/row:{number}'
   text=' | '.join(f'{key}={value}' for key,value in values.items())
   if locator in by_locator:
    if by_locator[locator]['text']!=text: raise ValueError('Existing locator text changed during export extension')
   else:
    segment={'locator':locator,'text':text}
    parsed['segments'].append(segment)
    by_locator[locator]=segment
  if rows[:len(table['rows'])]!=table['rows']: raise ValueError('Original preview rows differ from full authorized rows')
  table['rows']=rows
  table['truncated']=False
 excel.close()
 extension_applied='full_authorized_workbook_rows'
 parsed['notes'].append('本地RAG导出补充：复用CRE表头定位与单元格序列化，在原有每表5000行读取范围内保存全部授权行；在线250行预览限制保持不变，原text的100000字符截取标记保留。')
print(json.dumps({'parsed_result':parsed,'source_counts':counts,'export_extension':extension_applied,'online_parser_snapshot':snapshot},ensure_ascii=False))`

function argumentsFrom(values: string[]) {
  let outputDir = resolve(projectRoot, '.cache/rag-user-inputs')
  const attachments: Attachment[] = []
  for (let index = 0; index < values.length; index++) {
    const flag = values[index], value = values[++index]
    if (!value) throw new Error(`Missing value for ${flag}`)
    if (flag === '--output-dir') outputDir = resolve(value)
    else if (flag === '--file') attachments.push({ path: value, role: 'project_design' })
    else if (flag === '--role' && attachments.length && Object.hasOwn(roles, value)) attachments.at(-1)!.role = value as ContextRole
    else throw new Error(`Unsupported argument: ${flag}`)
  }
  if (!attachments.length) throw new Error('Use --file PATH --role method_reference|project_design|ai_collected_leads, repeated per attachment.')
  return { outputDir, attachments }
}

async function removeOwnTemporaryDirectory(cacheRoot: string, directory: string) {
  const resolved = await realpath(directory)
  if (!inside(cacheRoot, resolved) || !basename(resolved).startsWith('rag-parse-')) throw new Error('TEMP_CLEANUP_OUTSIDE_AUTHORIZED_CACHE')
  await rm(resolved, { recursive: true, force: true })
}

async function parseAttachment(input: Attachment, cacheRoot: string, python: string) {
  const sourcePath = await realpath(input.path), info = await stat(sourcePath), fileName = basename(sourcePath)
  const extension = extname(fileName).toLowerCase()
  if (!info.isFile() || !['.pdf', '.docx', '.xlsx'].includes(extension)) throw new Error('Unsupported attachment file')
  if (info.size > MAX_DOCUMENT_BYTES) throw new Error('Attachment exceeds existing 10 MB ParserPort budget')
  const sourceHash = digest(await readFile(sourcePath)), documentId = `DOC-${sourceHash.slice(0, 16)}`
  const directory = await mkdtemp(join(cacheRoot, 'rag-parse-'))
  let receipt: ParsedReceipt
  try {
    if (!inside(cacheRoot, await realpath(directory))) throw new Error('TEMP_OUTSIDE_AUTHORIZED_CACHE')
    const blobs = join(directory, 'blobs'); await mkdir(blobs)
    const copied = join(blobs, documentId + extension); await copyFile(sourcePath, copied)
    const { stdout } = await execute(python, ['-c', pythonScript, copied, fileName, documentId], {
      cwd: projectRoot, env: { ...process.env, PYTHONUTF8: '1', DATA_DIR: directory }, timeout: 45000, maxBuffer: 24 * 1024 * 1024,
    })
    receipt = JSON.parse(stdout) as ParsedReceipt
    if (receipt.parsed_result.source_hash !== sourceHash || digest(await readFile(sourcePath)) !== sourceHash) throw new Error('SOURCE_BYTES_CHANGED')
  } finally {
    await removeOwnTemporaryDirectory(cacheRoot, directory)
  }
  const parsed = receipt.parsed_result
  const normalized = normalizeImportDocument({ id: documentId, file_name: fileName, parser_result: parsed })
  const source: Source = {
    id: `ATTACHMENT-${documentId}`, title: `${input.role === 'ai_collected_leads' ? '用户声明AI采集线索' : input.role === 'method_reference' ? '论文方法参考' : '项目设计文档'}：${fileName}`,
    hash: sourceHash, raw_hash: sourceHash, locator: `document:${documentId}`, visibility: 'internal', data_class: 'internal',
    synthetic: false, content_status: 'uploaded', parse_status: parsed.status, evidence_scope: 'background',
  }
  const tables = parsed.profile.tables.map((table, index) => ({
    table: index + 1, sheet: table.source?.sheet || null, parser_rows: table.rowCount ?? 0,
    returned_preview_rows: table.rows?.length || 0, preview_truncated: (table.rowCount ?? 0) > (table.rows?.length || 0),
  }))
  const boundaries = {
    export_extension: receipt.export_extension, online_parser_snapshot: receipt.online_parser_snapshot,
    text_truncated: parsed.notes.some(note => note.includes('研判输入已截断')),
    returned_text_chars: parsed.text.length, returned_segment_count: parsed.segments.length,
    retained_segment_text_chars: parsed.segments.reduce((sum, segment) => sum + segment.text.length, 0),
    pdf_page_limit_applies: (receipt.source_counts.pages || 0) > parserLimits.pdf_pages_max,
    docx_table_limit_applies: (receipt.source_counts.table_count || 0) > parserLimits.docx_tables_max,
    docx_rows_limit_applies: receipt.source_counts.tables?.some(table => table.rows_including_header > parserLimits.docx_rows_per_table_max) || false,
    returned_segments_may_be_capped: parsed.segments.length >= parserLimits.returned_segments_max,
    xlsx_read_limit_may_apply: receipt.source_counts.sheets?.some(sheet => sheet.physical_rows > parserLimits.xlsx_rows_read_per_sheet_max + 1) || false,
    tables, notes: parsed.notes,
    coverage_statement: receipt.export_extension
      ? '本地工作簿RAG导出已补齐原有每表5000行读取范围内全部授权行，保留原text截取标记；在线解析预览仍为250行。扫描图像及超过读取范围的单元格未导出。'
      : '保留 ParserPort 实际返回的 text、segments、profile；导出仅覆盖解析快照与表格预览。未预览单元格、扫描图像和未解析页不在导出中。',
  }
  const bundle = buildRagExport({ projectId: namespace, documents: [normalized], rawDocuments: [{ id: documentId, file_name: fileName, parser_result: parsed }], sources: [source], cards: [] })
  const derivative = {
    schema_version: 'haizhizi-local-attachment-rag/1.0', namespace, content_role: 'untrusted_source_material',
    context_role: input.role, context_role_statement: roles[input.role], review_status: 'not_reviewed',
    source_path: sourcePath, source_file_name: fileName, source_sha256: sourceHash, source_bytes: info.size,
    source_counts: receipt.source_counts, parser_limits: parserLimits, extraction_boundaries: boundaries,
    export_extension: receipt.export_extension,
    parsed_result: parsed, normalized_document: normalized, rag_export: bundle,
    normalized_document_usage: '沿用UI预览形状；RAG导出从rawDocuments读取本地授权完整行，不以normalized_document.previewRows充当全量记录。',
    import_state: 'local_derivative_only_not_imported_into_project', raw_bytes_exported: false,
  }
  const markdown = `# 附件检索准备\n\n来源角色：${roles[input.role]}\n\n原件：${fileName}\n\n原字节 SHA256：${sourceHash}\n\n审核状态：未复核；本转换未执行经验卡提取或事实确认。\n\n## 解析范围\n\n${boundaries.coverage_statement}\n\n在线Parser原限制：PDF 前50页；DOCX前50表、每表最多251行；XLSX最多30表、每表读取5000行、预览250行；text最多100000字符、segments最多1000。本地工作簿导出在安全校验通过后补齐既有读取范围内的行。\n\ntext截取：${boundaries.text_truncated ? '已发生，JSON保留标记；检索片段和profile行独立保存' : '未触发'}。\n\n${parsed.notes.map(note => `- ${note}`).join('\n')}\n\n${renderRagMarkdown(bundle)}`
  return { derivative, markdown, sourcePath, sourceHash, documentId, fileName, boundaries, counts: receipt.source_counts, bundle }
}

async function main() {
  const { outputDir, attachments } = argumentsFrom(process.argv.slice(2))
  await mkdir(join(projectRoot, '.cache'), { recursive: true })
  const cacheRoot = await realpath(join(projectRoot, '.cache'))
  if (!inside(await realpath(projectRoot), cacheRoot)) throw new Error('CACHE_OUTSIDE_PROJECT')
  await mkdir(outputDir, { recursive: true })
  const physicalOutput = await realpath(outputDir)
  if (!inside(cacheRoot, physicalOutput)) throw new Error('ATTACHMENT_DERIVATIVES_MUST_STAY_IN_PROJECT_CACHE')
  const python = projectPython(projectRoot), manifestEntries = []
  for (const [index, attachment] of attachments.entries()) {
    const result = await parseAttachment(attachment, cacheRoot, python)
    const prefix = `${String(index + 1).padStart(2, '0')}-${result.documentId}`
    const jsonPath = join(physicalOutput, `${prefix}.json`), markdownPath = join(physicalOutput, `${prefix}.md`)
    await writeFile(jsonPath, json(result.derivative), 'utf8'); await writeFile(markdownPath, result.markdown, 'utf8')
    const jsonReadback = JSON.parse(await readFile(jsonPath, 'utf8')), markdownReadback = await readFile(markdownPath, 'utf8')
    if (json(jsonReadback) !== json(result.derivative) || markdownReadback !== result.markdown) throw new Error('DERIVATIVE_READBACK_MISMATCH')
    if (!markdownReadback.includes(result.sourceHash) || !jsonReadback.rag_export.documents[0].chunks.every((chunk: { text: string }) => markdownReadback.includes(chunk.text))) throw new Error('RAG_CHUNK_TEXT_READBACK_MISMATCH')
    if (result.boundaries.export_extension && !result.bundle.documents[0].tables.every(table => table.exported_rows === table.row_count && !table.truncated)) throw new Error('AUTHORIZED_WORKBOOK_ROWS_MISSING_FROM_RAG')
    manifestEntries.push({ file_name: result.fileName, source_path: result.sourcePath, document_id: result.documentId,
      context_role: attachment.role, source_sha256_before: result.sourceHash, source_sha256_after: digest(await readFile(result.sourcePath)),
      output_json: jsonPath, output_markdown: markdownPath, output_json_sha256: digest(await readFile(jsonPath)), output_markdown_sha256: digest(markdownReadback),
      source_counts: result.counts, extraction_boundaries: result.boundaries, rag_chunks: result.bundle.documents[0].chunks.length,
      export_extension: result.boundaries.export_extension,
      data_kind: result.bundle.documents[0].data_kind, readback_passed: true, raw_bytes_exported: false })
  }
  for (const entry of manifestEntries) {
    entry.source_sha256_after = digest(await readFile(entry.source_path))
    if (entry.source_sha256_after !== entry.source_sha256_before) throw new Error('SOURCE_BYTES_CHANGED_AT_FINAL_READBACK')
  }
  const manifest = { schema_version: 'haizhizi-attachment-rag-manifest/1.0', prepared_at: new Date().toISOString(), namespace,
    parser: 'services.capabilities.parsers.parse_document', python, source_file_count: manifestEntries.length,
    source_files_unchanged: true, project_data_written: false, remote_upload_performed: false, binary_originals_in_output: false,
    conversion_code: 'scripts/export-user-rag-materials.ts', parser_limits: parserLimits, entries: manifestEntries }
  const manifestPath = join(physicalOutput, 'manifest.json'); await writeFile(manifestPath, json(manifest), 'utf8')
  if (json(JSON.parse(await readFile(manifestPath, 'utf8'))) !== json(manifest)) throw new Error('MANIFEST_READBACK_MISMATCH')
  console.log(JSON.stringify({ manifest: manifestPath, files: manifestEntries.map(entry => ({ file: entry.file_name, role: entry.context_role, chunks: entry.rag_chunks, source_unchanged: entry.source_sha256_before === entry.source_sha256_after, text_truncated: entry.extraction_boundaries.text_truncated })), readback_passed: true }))
}

main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1 })
