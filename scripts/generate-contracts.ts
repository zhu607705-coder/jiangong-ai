import { compile } from 'json-schema-to-typescript'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'

const schema = JSON.parse(await readFile('packages/contracts/schema.json', 'utf8'))
await mkdir('apps/host/generated', { recursive: true })
await mkdir('services/capabilities/generated', { recursive: true })
const tsSchema = { ...schema, ...schema.definitions.ProjectInput, definitions: { ...schema.definitions } }
delete tsSchema.$ref
delete tsSchema.definitions.ProjectInput
const ts = await compile(tsSchema, 'ProjectInput', { unreachableDefinitions: true, ignoreMinAndMaxItems: true, bannerComment: '/* Generated from packages/contracts/schema.json. Run npm run contracts. */' })
await writeFile('apps/host/generated/contracts.ts', ts)
const generator = process.platform === 'win32' ? '.venv/Scripts/datamodel-codegen.exe' : '.venv/bin/datamodel-codegen'
if (!existsSync(generator)) throw new Error('Install requirements.txt into .venv before generating contracts')
const result = spawnSync(generator, ['--input', 'packages/contracts/schema.json', '--input-file-type', 'jsonschema', '--output', 'services/capabilities/generated/contracts.py', '--output-model-type', 'pydantic_v2.BaseModel', '--target-python-version', '3.11', '--use-standard-collections', '--use-union-operator', '--disable-timestamp', '--use-schema-description', '--field-constraints'], { stdio: 'inherit' })
if (result.status !== 0) process.exit(result.status || 1)
console.log('Generated TypeScript and Pydantic from one canonical schema.')
