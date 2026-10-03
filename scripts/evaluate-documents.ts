import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { runEvaluationCli } from '../packages/document-evaluation/cli'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
process.exitCode = await runEvaluationCli(process.argv.slice(2), { projectRoot: root })
