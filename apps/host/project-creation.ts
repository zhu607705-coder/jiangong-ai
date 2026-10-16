import { isDeepStrictEqual } from 'node:util'
import type { ProjectInput } from './generated/contracts'
import type { ProjectRecord, Store } from './store'

/** A stable client draft ID makes a lost response or double submit safe to retry. */
export async function saveProjectCreation(store: Store, ownerId: string, name: string, input: ProjectInput): Promise<
  { status: 200 | 201; project: ProjectRecord } | { status: 409; project?: never }
> {
  const same = (project: ProjectRecord) => project.name === name && isDeepStrictEqual(project.input, input)
  const existing = await store.project(input.project_id, ownerId)
  if (existing) return same(existing) ? { status: 200, project: existing } : { status: 409 }
  const inserted = await store.db.query('INSERT INTO projects(id,owner_id,name,input) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING RETURNING id', [input.project_id, ownerId, name, JSON.stringify(input)])
  const saved = await store.project(input.project_id, ownerId)
  if (!saved || !same(saved)) return { status: 409 }
  return { status: inserted.rows.length ? 201 : 200, project: saved }
}
