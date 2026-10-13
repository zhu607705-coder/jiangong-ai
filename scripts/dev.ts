import { spawn, type ChildProcess } from 'node:child_process'
import { config } from '../apps/host/config'
import { projectPython } from './python-runtime'

const python = projectPython()
const existing = await fetch(`http://127.0.0.1:${config.PORT}/health`, { signal: AbortSignal.timeout(1000) }).then(async response => response.ok ? response.json() as Promise<{ service?: string }> : null).catch(() => null)
if (existing?.service === 'haizhizi-host') {
  console.log(`工作台已经运行：http://127.0.0.1:${config.WORKSPACE_PORT}。无需再次启动。`)
  process.exit(0)
}
const env = { ...process.env, CAPABILITY_TOKEN: config.capabilityToken, PYTHONUNBUFFERED: '1', NODE_USE_ENV_PROXY: '1', NO_PROXY: `${process.env.NO_PROXY || ''},127.0.0.1,localhost` }
const children: ChildProcess[] = []
let stopping = false
function stop() { if (stopping) return; stopping = true; for (const child of children) child.kill('SIGTERM') }
function start(command: string, args: string[]) {
  const child = spawn(command, args, { stdio: 'inherit', env, shell: false })
  children.push(child)
  child.on('error', error => { console.error(error.message); stop(); process.exitCode = 1 })
  child.on('exit', code => { if (!stopping) { process.exitCode = code || 1; stop() } })
}
start(python, ['-m', 'uvicorn', 'services.capabilities.app:app', '--host', '127.0.0.1', '--port', String(config.CAPABILITY_PORT), '--no-access-log'])
start(process.execPath, ['--import', 'tsx', 'apps/host/server.ts'])
start(process.execPath, ['node_modules/vite/bin/vite.js', '--config', 'apps/workspace/vite.config.ts', '--host', '127.0.0.1', '--port', String(config.WORKSPACE_PORT), '--strictPort'])
console.log(`海之子工作台：http://localhost:${config.WORKSPACE_PORT}（${config.modelConfigured ? "模型接口已配置" : "离线工程模式"}）`)
process.once('SIGINT', stop); process.once('SIGTERM', stop)
