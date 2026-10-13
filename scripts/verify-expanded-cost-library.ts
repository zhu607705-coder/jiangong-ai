import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, relative, isAbsolute } from 'node:path'
import { Store } from '../apps/host/store'
import { ConstructionCostLibrary } from '../packages/construction-costs/library'

const directory = await mkdtemp(join(tmpdir(), 'cost-methods-verification-'))
const store = await Store.open(directory)
try {
  const library = new ConstructionCostLibrary(store.db)
  await library.initialize()
  const result = await library.search()
  if (result.summary.issues.length) throw new Error(JSON.stringify(result.summary.issues))
  if (result.summary.total !== 20) throw new Error(`Expected the 20 source-checked price records, found ${result.summary.total}`)
  await writeFile('research/test_results/expanded-cost-library.json', JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify({ records: result.summary.total, sources: result.summary.source_count, groups: result.benchmark.groups.map(group => ({ dimensions: group.dimensions, projects: group.n_projects, median: group.median_yuan_per_m2 })) }))
} finally {
  await store.db.close()
  const rel = relative(resolve(tmpdir()), resolve(directory))
  if (!rel || rel.startsWith('..') || isAbsolute(rel) || !rel.startsWith('cost-methods-verification-')) throw new Error('Refusing unexpected cleanup path')
  await rm(directory, { recursive: true, force: true })
}
