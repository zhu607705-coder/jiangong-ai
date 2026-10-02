import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { LiveSession } from '../../runtime/dsh/live-session'
import { evaluateDocument, type EvaluationResult, type EvaluateOptions } from './evaluate'
import { loadEvaluationDocument, type EvaluationDocument, type InputOptions } from './input'
import { NEIGHBORHOOD_RUBRIC, parseRubric, type EvaluationRubric } from './rubric'

export const CLI_HELP = `文档多维评估（Qwen decision-model-preview）
用法：npm run documents:evaluate -- [选项] <文件...>
支持：TXT、MD、CSV、PDF、DOCX、XLSX；最多 20 份，每份最多 10 MB。
  --rubric <JSON>     自定义量表：name、dimensions（id/name/question/levels[5]/weight）
  --profile neighborhood  默认老旧小区六维材料支撑程度量表
  --out <目录>       写入 results.json、summary.md（已有同名文件时拒绝覆盖）
  --dry-run          仅本地解析、检查量表与请求预算，不调用模型
  --print-rubric     输出默认量表，供编辑为自定义 JSON
  --help             显示帮助
实时评估复用项目 .env 中 QWEN_DECISION_API_KEY / QWEN_DECISION_ENDPOINT / QWEN_DECISION_MODEL。
执行实时评估会将所选文件的提取内容发送到已配置 Qwen 端点；不要在命令行参数中放密钥。
Score 为 0–4 档概率期望，缺项为 null，覆盖率与已评维均值分别报告。`

const ERROR_MESSAGES: Record<string, string> = {
  DOCUMENT_FILE_NOT_FOUND: '找不到所供文件；请检查路径。', DOCUMENT_NOT_A_FILE: '输入必须是普通文件。',
  DOCUMENT_FILE_LIMIT: '文件超过 10 MB；请提供需评估的较小材料。', DOCUMENT_FORMAT_UNSUPPORTED: '请使用 TXT、MD、CSV、PDF、DOCX 或 XLSX。',
  DOCUMENT_TEXT_ENCODING: '文本不是有效 UTF-8；请先转换编码。', DOCUMENT_EXTRACT_LIMIT: '现有解析器会截断该材料；请拆分为明确的评估片段。',
  DOCUMENT_BINARY_PARSER_FAILED: '本地二进制解析未完成；请检查项目 .venv 和 Python 解析依赖，或提供导出的文本。',
  DOCUMENT_OCR_REQUIRED: 'PDF 没有可提取文字；请先提供本地 OCR 文本。', DOCUMENT_EMPTY: '材料为空或没有可提取内容。',
  DOCUMENT_SOURCE_CHANGED: '解析期间源文件发生变化；请固定文件后重试。', DOCUMENT_REQUEST_LIMIT: '单文档请求超过 160 KB；请拆分材料或缩短量表。',
  DOCUMENT_RESPONSE_INVALID: '模型返回不满足量表或概率契约；该文档未记为评估成功。',
  DECISION_NOT_CONFIGURED: '尚未配置 Qwen Key 或端点；可先使用 --dry-run。', DECISION_ENDPOINT_INVALID: 'Qwen 端点未通过现有安全地址校验。',
  DECISION_INVALID_RESPONSE: 'Qwen 响应身份或用量字段无效；未形成结果。', DECISION_RESPONSE_LIMIT: 'Qwen 响应超过现有上限。', DECISION_INPUT_LIMIT: 'Qwen 输入超过现有上限。',
  DECISION_TOOL_FAILED: 'DSH 只读工具执行失败；请检查本地运行记录。',
  DOCUMENT_RUBRIC_INVALID: '量表无效：需 1–8 个唯一 id 的维度，每维五个不同等级、正权重，以及有效阈值。',
  DOCUMENT_RUBRIC_READ_FAILED: '无法读取量表 JSON；请检查路径、UTF-8 编码和格式（最多 64 KB）。',
  DOCUMENT_ARGUMENTS_INVALID: '命令参数无效；使用 --help 查看支持的选项。',
  DOCUMENT_OUTPUT_EXISTS: '输出目录已有 results.json 或 summary.md；请指定新的 --out 目录。',
  DOCUMENT_OUTPUT_FAILED: '无法保存评估文件；请检查输出目录的写入权限。',
  DOCUMENT_EVALUATION_FAILED: '评估调用未完成；请检查连接或取消状态后重试。',
}
export function safeEvaluationError(error: unknown): { code: string; message: string } {
  const value = error instanceof Error ? error.message : ''
  if (/^DECISION_HTTP_\d{3}$/.test(value)) return { code: value, message: `Qwen 返回 HTTP ${value.slice(-3)}；请检查配置、模型权限或服务状态。` }
  const code = Object.hasOwn(ERROR_MESSAGES, value) ? value : 'DOCUMENT_EVALUATION_FAILED'
  return { code, message: ERROR_MESSAGES[code] }
}
export type FailedEvaluation = { status: 'failed'; source_path: string; error: { code: string; message: string } }
export type EvaluationBatch = { schema_version: '1.0'; created_at: string; status: 'completed' | 'partial' | 'failed' | 'dry_run'; rubric: EvaluationRubric;
  runtime: { kind: 'dsh_tool_runtime' | 'local_only'; session_id: string | null }; results: (EvaluationResult | FailedEvaluation)[] }
type EvaluationSession = Pick<LiveSession, 'runReadCapability' | 'close'>
type CliDependencies = {
  projectRoot: string; cwd?: string; stdout?: (value: string) => void; stderr?: (value: string) => void
  load?: (file: string, options: InputOptions) => Promise<EvaluationDocument>
  evaluate?: (document: EvaluationDocument, rubric: EvaluationRubric, options: EvaluateOptions) => Promise<EvaluationResult>
  openSession?: (id: string, signal: AbortSignal) => Promise<EvaluationSession>
}
function argumentsFor(args: string[]) {
  const files: string[] = []; let rubric: string | undefined, out: string | undefined, dryRun = false, profile: string | undefined, positional = false
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (positional) { files.push(arg); continue }
    if (arg === '--') { positional = true; continue }
    if (arg === '--dry-run') { dryRun = true; continue }
    if (['--rubric', '--out', '--profile'].includes(arg)) {
      const value = args[++index]
      if (!value || value.startsWith('--')) throw new Error('DOCUMENT_ARGUMENTS_INVALID')
      if (arg === '--rubric') { if (rubric) throw new Error('DOCUMENT_ARGUMENTS_INVALID'); rubric = value }
      else if (arg === '--out') { if (out) throw new Error('DOCUMENT_ARGUMENTS_INVALID'); out = value }
      else { if (profile) throw new Error('DOCUMENT_ARGUMENTS_INVALID'); profile = value }
    } else if (arg.startsWith('-')) throw new Error('DOCUMENT_ARGUMENTS_INVALID')
    else files.push(arg)
  }
  if (!files.length || files.length > 20 || profile && profile !== 'neighborhood' || rubric && profile) throw new Error('DOCUMENT_ARGUMENTS_INVALID')
  return { files, rubric, out, dryRun }
}
function cell(value: string) { return value.replace(/[|\r\n]/g, ' ').replace(/[<>]/g, '').replace(/([\\`*_\[\]()#!])/g, '\\$1') }
export function markdownSummary(batch: EvaluationBatch): string {
  const lines = ['# 文档多维评估', '', `状态：${batch.status}；量表：${cell(batch.rubric.name)}`, '', '分数为 0–4 档概率期望，非真实性或成功概率。未知不按零分计，均值仅覆盖已评维度，不作审批结论。', '']
  for (const result of batch.results) {
    if (result.status === 'failed') { lines.push(`文件：${cell(result.source_path)}`, '', `未完成：${result.error.code} — ${result.error.message}`, ''); continue }
    lines.push(`## ${cell(result.document.file_name)}`, '', `状态：${result.status}；解析：${cell(result.document.parser)}；范围：${result.document.extraction_scope}`, '',
      `Source SHA-256：\`${result.document.source_hash}\``, `材料级定位（不是逐维引文校验）：${result.document.locators.map(cell).join('；')}`, '',
      `请求：${result.request_id ? cell(result.request_id) : '未调用（dry run）'}；输入 token：${result.input_tokens ?? '—'}；耗时：${result.duration_ms} ms`, '')
    if (result.summary) {
      lines.push(`已评维度：${result.summary.assessed_dimensions}/${result.summary.total_dimensions}；加权覆盖：${(result.summary.weighted_coverage * 100).toFixed(1)}%；已评维均值：${result.summary.assessed_weighted_mean?.toFixed(2) ?? '—'}`, '',
        '| 维度 | 状态 | 分数 | 材料存在概率 | 模型置信度 |', '| --- | --- | ---: | ---: | ---: |')
      for (const d of result.dimensions) lines.push(`| ${cell(d.name)} | ${d.status} | ${d.score?.toFixed(2) ?? '—'} | ${d.evidence_probability.toFixed(2)} | ${d.model_confidence.toFixed(2)} |`)
      lines.push('')
    }
    for (const note of result.document.parse_notes) lines.push(`- ${cell(note)}`)
    lines.push('')
  }
  return lines.join('\n') + '\n'
}
/** Sequential bounded batch runner. Failures remain explicit and make the command exit nonzero. */
export async function runEvaluationCli(args: string[], dependencies: CliDependencies): Promise<number> {
  const stdout = dependencies.stdout || console.log, stderr = dependencies.stderr || console.error
  let live: EvaluationSession | undefined
  try {
    if (args.length === 1 && ['--help', '-h'].includes(args[0])) { stdout(CLI_HELP); return 0 }
    if (args.length === 1 && args[0] === '--print-rubric') { stdout(JSON.stringify(NEIGHBORHOOD_RUBRIC, null, 2)); return 0 }
    const options = argumentsFor(args), cwd = dependencies.cwd || process.cwd()
    let rubric = NEIGHBORHOOD_RUBRIC
    if (options.rubric) {
      let raw: unknown
      try {
        const path = resolve(cwd, options.rubric)
        if ((await stat(path)).size > 64000) throw new Error('limit')
        raw = JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''))
      } catch { throw new Error('DOCUMENT_RUBRIC_READ_FAILED') }
      rubric = parseRubric(raw)
    }
    const out = resolve(cwd, options.out || `data/local/document-evaluation/${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`)
    if (await Promise.all(['results.json', 'summary.md'].map(file => stat(resolve(out, file)).then(() => true, () => false))).then(found => found.some(Boolean))) throw new Error('DOCUMENT_OUTPUT_EXISTS')
    try { await mkdir(out, { recursive: true, mode: 0o700 }) } catch { throw new Error('DOCUMENT_OUTPUT_FAILED') }
    const batch: EvaluationBatch = { schema_version: '1.0', created_at: new Date().toISOString(), status: 'completed', rubric,
      runtime: { kind: options.dryRun ? 'local_only' : 'dsh_tool_runtime', session_id: null }, results: [] }
    for (const file of options.files) {
      const path = isAbsolute(file) ? file : resolve(cwd, file)
      try {
        const document = await (dependencies.load || loadEvaluationDocument)(path, { projectRoot: dependencies.projectRoot })
        const evaluate = dependencies.evaluate || evaluateDocument
        let result: EvaluationResult
        if (options.dryRun) result = await evaluate(document, rubric, { dryRun: true, signal: AbortSignal.timeout(60000) })
        else {
          // Validate request size locally before allocating the persistent DSH session.
          await evaluateDocument(document, rubric, { dryRun: true, signal: AbortSignal.timeout(60000) })
          if (!live) {
            const id = 'DOCUMENT-EVAL-' + randomUUID()
            live = await (dependencies.openSession || LiveSession.open)(id, AbortSignal.timeout(options.files.length * 60000))
            batch.runtime.session_id = id
          }
          const envelope = await live.runReadCapability('document_evaluation_' + batch.results.length, async signal => {
            try { return { ok: true as const, result: await evaluate(document, rubric, { signal }) } }
            catch (error) { return { ok: false as const, error: safeEvaluationError(error) } }
          })
          if (!envelope.ok) throw new Error(envelope.error.code)
          result = envelope.result
        }
        batch.results.push(result)
      } catch (error) { batch.results.push({ status: 'failed', source_path: path, error: safeEvaluationError(error) }) }
    }
    const failures = batch.results.filter(result => result.status === 'failed').length
    batch.status = failures === batch.results.length ? 'failed' : failures || batch.results.some(result => result.status === 'partial') ? 'partial' : options.dryRun ? 'dry_run' : 'completed'
    try {
      await writeFile(resolve(out, 'results.json'), JSON.stringify(batch, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
      await writeFile(resolve(out, 'summary.md'), markdownSummary(batch), { mode: 0o600, flag: 'wx' })
    } catch { throw new Error('DOCUMENT_OUTPUT_FAILED') }
    stdout(JSON.stringify({ status: batch.status, documents: batch.results.length, failed: failures, output_directory: out }))
    return failures ? 1 : 0
  } catch (error) { const safe = safeEvaluationError(error); stderr(`${safe.code}: ${safe.message}`); return 1 }
  finally {
    if (live) try { await live.close() }
    catch { stderr('DOCUMENT_EVALUATION_FAILED: DSH 会话清理失败；已保存结果仍可核查。'); return 1 }
  }
}
