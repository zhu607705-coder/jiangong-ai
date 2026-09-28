import path from 'node:path'
import { readFile, writeFile, mkdir, stat, rm, rename } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { buildCorpus, saveBuild, exportReviewed, canonicalUrl, assertNoCredential, hash } from '../packages/corpus/corpus'
import { bundleSchema } from '../packages/corpus/schema'
import { validate } from '../packages/contracts/validate'
import type { Source } from '../apps/host/generated/contracts'

const root = path.resolve(import.meta.dirname, '..')
const [command = 'build', ...args] = process.argv.slice(2)
function flag(name: string) { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1] }
let newIntake: string | undefined
async function saveIntake(data: string) {
  const dir = path.join(root, 'data/local/corpus/intake'), file = path.join(dir, hash(data) + '.json')
  await mkdir(dir, { recursive: true })
  try { await stat(file) }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; newIntake = file }
  await writeFile(file, data, { mode: 0o600 })
}
try {
  if (command === 'import') {
    const file = flag('--file')
    if (!file) throw new Error('用法：npm run corpus:import -- --file <source-bundle.json>')
    const bundle = bundleSchema.parse(JSON.parse((await readFile(path.resolve(file), 'utf8')).replace(/^\uFEFF/, '')))
    const sources = bundle.sources.map(s => validate<Source>('Source', s))
    if (sources.some(s => s.visibility !== 'public' || s.data_class !== 'public' || s.synthetic)) throw new Error('此采集入口只接受公开原文；内部材料与合成用例请保留在各自项目中。')
    sources.forEach(s => { if (!s.url) throw new Error('来源缺少 URL。'); canonicalUrl(s.url) })
    assertNoCredential(bundle)
    await saveIntake(JSON.stringify(bundle, null, 2) + '\n')
  } else if (command === 'collect') {
    const runId = flag('--run')
    if (!runId || !/^RUN-[a-f\d-]{36}$/i.test(runId)) throw new Error('用法：npm run corpus:collect -- --run RUN-...')
    const base = 'http://127.0.0.1:4310'
    const session = await fetch(`${base}/api/session`, { signal: AbortSignal.timeout(5000) })
    if (!session.ok) throw new Error('本机工作台会话不可用。')
    const cookie = session.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')
    const response = await fetch(`${base}/api/runs/${runId}`, { headers: { Cookie: cookie, 'X-Requested-With': 'haizhizi' }, signal: AbortSignal.timeout(10000) })
    if (!response.ok) throw new Error(`无法读取指定本机运行，HTTP ${response.status}。`)
    const run = await response.json() as any
    if (run.status !== 'completed' || !run.decision) throw new Error('仅归集已完成运行中确实存在的来源。')
    const sources = run.decision.sources.map((s: unknown) => validate<Source>('Source', s))
      .filter((s: Source) => s.visibility === 'public' && s.data_class === 'public' && !s.synthetic)
    if (!sources.length) throw new Error('此运行没有可归集的公开来源。')
    const bundle = bundleSchema.parse({ schema_version: '1.0', family_id: run.project_id, split: 'development', origin: `local_run:${runId}`, sources })
    assertNoCredential(bundle)
    await saveIntake(JSON.stringify(bundle, null, 2) + '\n')
  } else if (!['build', 'export', 'search'].includes(command)) throw new Error('命令只支持 build / collect / import / export / search。')

  const build = await buildCorpus(root), directory = await saveBuild(root, build)
  if (command === 'export') console.log(JSON.stringify(await exportReviewed(root, build), null, 2))
  else if (command === 'search') {
    const query = flag('--query')
    if (!query?.trim()) throw new Error('用法：npm run corpus:search -- --query "城市更新 实施组织"')
    const python = path.join(root, process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python')
    const result = spawnSync(python, [path.join(root, 'scripts/corpus-search.py'), directory, query], { cwd: root, stdio: 'inherit' })
    if (result.error || result.status !== 0) throw new Error('本地检索未完成。')
  } else console.log(JSON.stringify({ directory, ...build.report }, null, 2))
} catch (error) {
  if (newIntake) await rm(newIntake, { force: true })
  if (command === 'export') {
    const directory = path.join(root, 'data/local/corpus/exports')
    await mkdir(directory, { recursive: true })
    const temp = path.join(directory, `latest.${process.pid}.tmp`)
    await writeFile(temp, JSON.stringify({ status: 'blocked', reason: 'build_or_export_validation_failed', directory: null }) + '\n', { mode: 0o600 })
    await rename(temp, path.join(directory, 'latest.json'))
  }
  // Do not echo schema inputs or malformed source JSON, which may contain private data.
  const message = error instanceof Error && !['ZodError', 'SyntaxError', 'ContractError'].includes(error.name) ? error.message : '语料格式校验失败；请检查字段定义与输入文件。'
  console.error(message)
  process.exitCode = 1
}
