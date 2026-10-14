/** One authorized archive import. Original files remain intact; no project facts or model weights are inferred. */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const run = promisify(execFile)
const root = fileURLToPath(new URL('..', import.meta.url))
const inputDirectory = 'C:/Users/123/Documents/xwechat_files/wxid_1980ghh2hh3u22_dbe8/msg/file/2026-10'
const reportPath = join(inputDirectory, '老旧小区改造数据库_独立核验与修正报告_20261014.txt')
const workbookPath = join(inputDirectory, '老旧小区改造历史工程数据库_浙沪粤_补全版_20261014.xlsx')
const output = resolve(root, 'data/imports/renewal-database-20261014')
const receiptPath = resolve(root, 'output/video/full-feature-20261014/database-update-import.json')
const api = 'http://127.0.0.1:4310/api'
const archiveName = '旧改案例与规则资料库 · 公开来源'
const hash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex')
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`
const n = (value: unknown): number | null => value == null || String(value).trim() === '' || !Number.isFinite(Number(value)) ? null : Number(value)
const s = (value: unknown): string | null => value == null || String(value).trim() === '' ? null : String(value)
type Row = { rowNumber: number; values: Record<string, string> }
type Table = { rowCount: number; rows: Row[]; source: { sheet: string; headerRow: number } }
type ParsedDocument = { id: string; file_name: string; parser_result: { status: string; source_hash: string; text: string; profile: { tables: Table[] }; notes?: string[] } }

async function main() {
  await mkdir(output, { recursive: true })
  await mkdir(join(root, '.cache'), { recursive: true })
  const cacheRoot = await realpath(join(root, '.cache'))
  const temp = await mkdtemp(join(cacheRoot, 'rag-database-update-'))
  let full: { parsed_result: { text: string; segments: unknown[]; profile: { tables: Table[] } }; source_sha256: string }
  try {
    await run(process.execPath, ['--import', 'tsx', 'scripts/export-user-rag-materials.ts', '--output-dir', temp, '--file', workbookPath, '--role', 'ai_collected_leads'], { cwd: root, timeout: 120000, maxBuffer: 1024 * 1024 })
    const exported = JSON.parse(await readFile(join(temp, 'manifest.json'), 'utf8'))
    full = JSON.parse(await readFile(exported.entries[0].output_json, 'utf8'))
    await writeFile(join(output, 'workbook-parsed-full.json'), json({ schema_version: 'renewal-database-source-rows/1', review_status: 'unreviewed', source_file: basename(workbookPath), source_sha256: full.source_sha256, export_extension: 'full_authorized_workbook_rows', parser_result: full.parsed_result }), 'utf8')
  } finally {
    const physical = await realpath(temp), relation = relative(cacheRoot, physical)
    if (!relation || isAbsolute(relation) || relation === '..' || relation.startsWith(`..${sep}`) || !basename(physical).startsWith('rag-database-update-')) throw new Error('Unsafe temporary cleanup target')
    await rm(physical, { recursive: true, force: true })
  }
  const session = await fetch(`${api}/session`)
  const cookie = session.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
  async function request(path: string, init: RequestInit = {}) {
    const response = await fetch(`${api}${path}`, { ...init, headers: { Cookie: cookie, 'X-Requested-With': 'haizhizi', ...init.headers }, signal: AbortSignal.timeout(90000) })
    const body = await response.json()
    if (!response.ok) throw new Error(`${response.status}: ${JSON.stringify(body)}`)
    return body
  }
  const projects = await request('/projects') as { id: string; name: string; input: { synthetic: boolean } }[]
  const archive = projects.find(project => project.name === archiveName)
  if (!archive || archive.input.synthetic || archive.id.startsWith('P-73678')) throw new Error('Authorized nonsynthetic archive unavailable')
  async function upload(fileName: string, bytes: Buffer, mime: string): Promise<ParsedDocument> {
    if (bytes.length > 10 * 1024 * 1024) throw new Error('Upload exceeds existing 10 MB limit')
    const form = new FormData()
    form.append('file', new Blob([new Uint8Array(bytes)], { type: mime }), `attachment.${fileName.split('.').at(-1)}`)
    form.append('original_file_name', fileName)
    const document = await request(`/projects/${archive!.id}/documents`, { method: 'POST', body: form }) as ParsedDocument
    if (document.parser_result.status !== 'extracted' || document.parser_result.source_hash !== hash(bytes)) throw new Error('Upload parse or byte identity mismatch')
    return document
  }
  const reportBytes = await readFile(reportPath), workbookBytes = await readFile(workbookPath)
  const report = await upload(basename(reportPath), reportBytes, 'text/plain')
  const workbook = await upload(basename(workbookPath), workbookBytes, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  const tables = full.parsed_result.profile.tables
  const mainTable = tables.find(table => table.source.sheet === '历史工程总表')
  if (!mainTable || mainTable.rowCount !== mainTable.rows.length) throw new Error('Main table complete authorized rows unavailable')
  const records = mainTable.rows.map(row => {
    const v = row.values
    return {
      id: v['案例ID'], project_name: v['项目及标段名称'], project_code: s(v['项目编号']), lot_id: s(v['标段（包）编号']),
      province: v['省级地区'], city: v['城市'], district: s(v['区县']), year: n(v['数据年份']),
      amount_stage_original: s(v['金额阶段']),
      amounts_yuan: { tender_budget: n(v['招标预算_元']), tender_ceiling: n(v['招标控制价_元']), winning_bid: n(v['中标价_元']), contract_price: n(v['合同价_元']), settlement: n(v['结算价_元']), total_investment: n(v['项目总投资_元']) },
      area: { building_floor: n(v['建筑面积_㎡']), renovation_scope: n(v['改造范围面积_㎡']), site: n(v['用地面积_㎡']), other: n(v['其他面积_㎡']), other_basis_original: s(v['其他面积口径']) },
      area_basis_original: s(v['单方面积口径']),
      unit_cost_original: { denominator_m2: n(v['单方分母_㎡']), numerator_yuan: n(v['单方分子_元']), yuan_per_m2: n(v['单方_元每㎡']), comparability_note: s(v['可比性提示']) },
      work_type_original: s(v['发包模式']), renovation_scope_original: s(v['改造内容']), renovation_scope_tags_original: s(v['改造方式标签']),
      households: n(v['户数']), buildings: n(v['楼栋数']), duration_days: n(v['工期_天']),
      award_notice_date: s(v['公告日期']), contract_date: s(v['合同签署日期']),
      verification: { status_original: s(v['补录核验状态']), notes: s(v['核验备注']), review_status: 'unreviewed', authority: 'user_provided_statement_not_automatically_official_verified' },
      source: { document_id: workbook.id, sha256: hash(workbookBytes), sheet: mainTable.source.sheet, row: row.rowNumber,
        locator: `sheet:${mainTable.source.sheet}/row:${row.rowNumber}`, amount_url: s(v['公告URL_金额']), scale_url: s(v['公告URL_规模']), contract_url: s(v['公告URL_合同']), evidence_ids_original: s(v['来源证据ID']),
        scale_quote: s(v['规模原文']), source_excerpt: s(v['来源摘录']), source_platform_original: s(v['来源平台']) },
      supplement: { fields_original: s(v['补录字段']), source_url: s(v['补录来源URL']), source_type_original: s(v['补录来源类型']), source_date: s(v['补录来源日期']), matching_original: s(v['补录匹配方式']), quote: s(v['补录原文摘录']) },
      raw_fields: v,
    }
  })
  await writeFile(join(output, 'history-records.json'), json({ schema_version: 'renewal-user-history-records/1', snapshot_date: '2026-10-14', source_class: 'user_provided_database_update', review_status: 'unreviewed', workbook_document_id: workbook.id, workbook_sha256: hash(workbookBytes), report_document_id: report.id, records }), 'utf8')
  await writeFile(join(output, 'correction-report.json'), json({ document_id: report.id, source_sha256: hash(reportBytes), content_role: 'user_provided_verification_report', review_status: 'unreviewed', text: reportBytes.toString('utf8'), statement: '报告中的抽验、修正和核验结论按提供方原文保留；本导入未执行独立回源核验。' }), 'utf8')
  const heading = `# 用户补全数据库 · 2026-10-14\n\n来源文件：${basename(workbookPath)}\n\n原件文档：${workbook.id}\n\n原字节SHA256：${hash(workbookBytes)}\n\n材料状态：待审核。核验结论与状态沿用用户提供的材料声明；原文指令作为材料内容保存。\n\n`
  const sections = tables.map(table => `## ${table.source.sheet}\n\n表格记录数：${table.rowCount}；本派生保存 ${table.rows.length} 行。\n\n${table.rows.map(row => `sheet:${table.source.sheet}/row:${row.rowNumber} | ${JSON.stringify(row.values)}`).join('\n')}\n`)
  const fullMarkdown = heading + sections.join('\n')
  await writeFile(join(output, 'complete-workbook.md'), fullMarkdown, 'utf8')
  const batches = Buffer.byteLength(fullMarkdown, 'utf8') <= 10 * 1024 * 1024 ? [{ name: '用户补全数据_1277工程_完整检索材料_20261014.md', text: fullMarkdown }] : sections.map((section, index) => ({ name: `用户补全数据_${tables[index].source.sheet}_完整行_20261014.md`, text: heading + section }))
  const derivatives = []
  for (const batch of batches) {
    const document = await upload(batch.name, Buffer.from(batch.text, 'utf8'), 'text/markdown')
    if (document.parser_result.text !== batch.text) throw new Error('Full-row derivative not preserved by text parser')
    derivatives.push({ id: document.id, file_name: document.file_name, sha256: document.parser_result.source_hash, characters: batch.text.length, parsed_status: document.parser_result.status })
  }
  const savedDocuments = await request(`/projects/${archive.id}/documents`) as ParsedDocument[]
  if (![report.id, workbook.id, ...derivatives.map(doc => doc.id)].every(id => savedDocuments.some(doc => doc.id === id))) throw new Error('Imported archive document unavailable')
  const stats = {
    records: records.length, tables: tables.map(table => ({ sheet: table.source.sheet, rows: table.rowCount, full_rows_saved: table.rows.length })),
    amount_available: Object.fromEntries(['tender_budget', 'tender_ceiling', 'winning_bid', 'contract_price', 'settlement'].map(kind => [kind, records.filter(record => record.amounts_yuan[kind as keyof typeof record.amounts_yuan] !== null).length])),
    building_area_available: records.filter(record => record.area.building_floor !== null).length,
    province_counts: Object.fromEntries([...new Set(records.map(record => record.province))].map(province => [province, records.filter(record => record.province === province).length])),
    declared_verification_status_counts: Object.fromEntries([...new Set(records.map(record => record.verification.status_original || '未记载'))].map(status => [status, records.filter(record => (record.verification.status_original || '未记载') === status).length])),
  }
  const receipt = {
    schema_version: 'renewal-database-update-import/1', imported_at: new Date().toISOString(), project_id: archive.id, project_name: archive.name,
    original_uploads: [{ id: report.id, file_name: report.file_name, status: report.parser_result.status, sha256: hash(reportBytes) }, { id: workbook.id, file_name: workbook.file_name, status: workbook.parser_result.status, sha256: hash(workbookBytes), online_rows_are_preview_only: true }],
    full_row_derivatives: derivatives, stats, full_authorized_rows_preserved: tables.every(table => table.rowCount === table.rows.length),
    datasets: { history_records: join(output, 'history-records.json'), full_parsed: join(output, 'workbook-parsed-full.json'), complete_markdown: join(output, 'complete-workbook.md'), report: join(output, 'correction-report.json') },
    component_visibility: ['资料与证据：两原件及完整行派生MD', '导入数据关系：原工作簿5表及行/字段预览', 'RAG导出：完整行派生MD所有原文行与原件sheet/row定位'],
    review_status: 'unreviewed', primary_source_verification_performed: false, official_global_cost_library_changed: false, production_weights_changed: false,
    original_files_unchanged: hash(await readFile(reportPath)) === hash(reportBytes) && hash(await readFile(workbookPath)) === hash(workbookBytes),
  }
  await writeFile(join(output, 'manifest.json'), json(receipt), 'utf8')
  await mkdir(resolve(receiptPath, '..'), { recursive: true }); await writeFile(receiptPath, json(receipt), 'utf8')
  console.log(JSON.stringify({ receipt: receiptPath, project_id: archive.id, original_document_ids: receipt.original_uploads.map(doc => doc.id), derivatives: derivatives.length, stats }))
}

main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1 })
