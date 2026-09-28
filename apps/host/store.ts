import { PGlite } from '@electric-sql/pglite'
import pg from 'pg'
import { readFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { ProjectInput, DecisionPacket, RuntimeEvent } from './generated/contracts'

export interface Database {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>
  exec(sql: string): Promise<unknown>
  transaction<T>(body: (db: Database) => Promise<T>): Promise<T>
  close(): Promise<void>
}
export type ProjectRecord = { id: string; name: string; owner_id: string; input: ProjectInput; context_version: number; created_at: string; updated_at: string }
export type RunRecord = { id: string; project_id: string; revision: number; context_version: number; status: string; execution_mode: 'offline' | 'live'; snapshot: ProjectInput; snapshot_hash: string; decision: DecisionPacket | null; error_code: string | null; created_at: string; idempotency_key: string }

export class Store {
  constructor(readonly db: Database, readonly kind: string) {}
  static async open(directory: string, databaseUrl?: string) {
    await mkdir(directory, { recursive: true })
    let db: Database
    if (databaseUrl) {
      const pool = new pg.Pool({ connectionString: databaseUrl, max: 4, connectionTimeoutMillis: 5000 })
      const wrap = (client: pg.Pool | pg.PoolClient): Database => ({
        query: async <T>(sql: string, params?: unknown[]) => ({ rows: (await client.query(sql, params)).rows as T[] }),
        exec: sql => client.query(sql),
        transaction: async body => {
          const connection = await pool.connect()
          try { await connection.query('BEGIN'); const result = await body(wrap(connection)); await connection.query('COMMIT'); return result }
          catch (error) { await connection.query('ROLLBACK'); throw error }
          finally { connection.release() }
        },
        close: () => pool.end(),
      })
      db = wrap(pool)
    } else {
      db = new PGlite(join(directory, 'postgres')) as unknown as Database
    }
    await db.exec(await readFile('packages/contracts/migrations/001_initial.sql', 'utf8'))
    return new Store(db, databaseUrl ? 'PostgreSQL' : 'PGlite (embedded PostgreSQL)')
  }
  async project(id: string, owner: string) { return (await this.db.query<ProjectRecord>('SELECT * FROM projects WHERE id=$1 AND owner_id=$2', [id, owner])).rows[0] }
  async projects(owner: string) { return (await this.db.query<ProjectRecord>('SELECT * FROM projects WHERE owner_id=$1 ORDER BY updated_at DESC', [owner])).rows }
  async run(id: string, owner: string) { return (await this.db.query<RunRecord>('SELECT r.* FROM runs r JOIN projects p ON p.id=r.project_id WHERE r.id=$1 AND p.owner_id=$2', [id, owner])).rows[0] }
  async runs(project: string) { return (await this.db.query<RunRecord>('SELECT * FROM runs WHERE project_id=$1 ORDER BY revision DESC', [project])).rows }
  async addEvent(runId: string, stage: string, status: RuntimeEvent['status'], message: string, artifactRef: string | null = null) {
    return (await this.db.query<RuntimeEvent>('INSERT INTO run_events(run_id,stage,status,message,artifact_ref) VALUES($1,$2,$3,$4,$5) RETURNING *', [runId, stage, status, message, artifactRef])).rows[0]
  }
  async events(runId: string, after = 0) { return (await this.db.query<RuntimeEvent>('SELECT * FROM run_events WHERE run_id=$1 AND id>$2 ORDER BY id', [runId, after])).rows }
}
