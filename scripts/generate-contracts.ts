import { compile } from 'json-schema-to-typescript'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { projectPython } from './python-runtime'

const schema = JSON.parse(await readFile('packages/contracts/schema.json', 'utf8'))
await mkdir('apps/host/generated', { recursive: true })
await mkdir('services/capabilities/generated', { recursive: true })
const tsSchema = { ...schema, ...schema.definitions.ProjectInput, definitions: { ...schema.definitions } }
delete tsSchema.$ref
delete tsSchema.definitions.ProjectInput
const ts = await compile(tsSchema, 'ProjectInput', { unreachableDefinitions: true, ignoreMinAndMaxItems: true, bannerComment: '/* Generated from packages/contracts/schema.json. Run npm run contracts. */' })
await writeFile('apps/host/generated/contracts.ts', ts)
const result = spawnSync(projectPython(), ['-m', 'datamodel_code_generator', '--input', 'packages/contracts/schema.json', '--input-file-type', 'jsonschema', '--output', 'services/capabilities/generated/contracts.py', '--output-model-type', 'pydantic_v2.BaseModel', '--target-python-version', '3.11', '--use-standard-collections', '--use-union-operator', '--disable-timestamp', '--use-schema-description', '--field-constraints'], { stdio: 'inherit' })
if (result.status !== 0) process.exit(result.status || 1)
console.log('Generated TypeScript and Pydantic from one canonical schema.')
