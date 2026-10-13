import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

/** Keep Windows and WSL environments separate; callers may select a prepared interpreter. */
export function projectPython(root = process.cwd()): string {
  const candidates = process.env.HZZ_PYTHON
    ? [process.env.HZZ_PYTHON]
    : process.platform === 'win32'
      ? ['.venv-win/Scripts/python.exe', '.venv/Scripts/python.exe']
      : ['.venv/bin/python']
  const executable = candidates.map(candidate => resolve(root, candidate)).find(candidate => existsSync(candidate))
  if (!executable) throw new Error('请创建本平台的 .venv（Windows 可用 .venv-win）并安装 requirements.txt，或设置 HZZ_PYTHON 指向已准备好的解释器。')
  return resolve(executable)
}
