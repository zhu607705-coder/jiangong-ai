import { spawnSync } from 'node:child_process'
const python = process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python'
const files = process.argv.includes('--e2e') ? ['tests/e2e/test_http.py'] : ['tests/test_pack.py', 'tests/test_capabilities.py', 'tests/test_parsers.py', 'tests/test_map_regions.py']
const result = spawnSync(python, ['-m', 'pytest', ...files, '-q'], { stdio: 'inherit', env: {...process.env, HZZ_TEST_NODE: process.execPath} })
process.exit(result.status || (result.error ? 1 : 0))
