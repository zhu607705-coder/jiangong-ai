import { afterEach, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFile } from 'node:fs/promises'
import type { Database } from '../../apps/host/store'
import { describeWorkbenchDatabase } from '../../apps/host/database-schema'

const databases: PGlite[] = []
function memoryDatabase() { const db = new PGlite(); databases.push(db); return db }
const database = (db: PGlite) => db as unknown as Database
afterEach(async () => { await Promise.all(databases.splice(0).map(db => db.close())) })

describe('bounded workbench database schema export', () => {
  it('recreates serial sequences, quoted columns, defaults, constraints and indexes without row data', async () => {
    const source = memoryDatabase(), restored = memoryDatabase()
    await source.exec(`
      CREATE TABLE "z parent" (
        id SERIAL PRIMARY KEY, code TEXT NOT NULL UNIQUE,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (amount >= 0)
      );
      CREATE TABLE "a"" child" (
        id BIGSERIAL PRIMARY KEY, "parent""id" INTEGER NOT NULL,
        title TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "fk""parent" FOREIGN KEY ("parent""id") REFERENCES "z parent"(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
        UNIQUE ("parent""id", title)
      );
      CREATE INDEX "child title" ON "a"" child" (lower(title)) WHERE title <> '';
      CREATE INDEX parent_metadata ON "z parent" USING gin(metadata);
      CREATE SEQUENCE reverse_counter AS bigint INCREMENT BY -2 MINVALUE -200 MAXVALUE -2 START WITH -4 CACHE 3 CYCLE;
      INSERT INTO "z parent"(code,metadata) VALUES ('ROW_DATA_MUST_NOT_LEAK', '{"private":"ROW_JSON_MUST_NOT_LEAK"}');
      INSERT INTO "a"" child"("parent""id",title) VALUES (1,'CHILD_ROW_MUST_NOT_LEAK');
      CREATE SCHEMA private;
      CREATE TABLE private.hidden(secret TEXT);
      INSERT INTO private.hidden VALUES ('PRIVATE_SCHEMA_MUST_NOT_LEAK');
    `)
    const queries: string[] = []
    const readOnly: Database = {
      query: async <T>(sql: string, params?: unknown[]) => { queries.push(sql); return { rows: (await source.query(sql, params)).rows as T[] } },
      exec: async () => { throw new Error('The exporter must not mutate its source') },
      transaction: async () => { throw new Error('The exporter must use the provided connection') },
      close: async () => { throw new Error('The exporter must not close the source') },
    }
    const exported = await describeWorkbenchDatabase(readOnly)
    expect(exported.schema).toBe('public')
    expect(exported.issues).toEqual([])
    expect(Number.isNaN(Date.parse(exported.generated_at))).toBe(false)
    expect(exported.tables.map(table => [table.name, table.row_count])).toEqual([['a" child', 1], ['z parent', 1]])
    expect(queries.every(sql => /^\s*SELECT\b/i.test(sql))).toBe(true)
    expect(JSON.stringify(exported)).not.toMatch(/ROW_DATA_MUST_NOT_LEAK|ROW_JSON_MUST_NOT_LEAK|CHILD_ROW_MUST_NOT_LEAK|PRIVATE_SCHEMA_MUST_NOT_LEAK/)
    expect(exported.tables.some(table => table.name === 'hidden')).toBe(false)
    expect(exported.sql).not.toMatch(/INSERT INTO|COPY |setval\(/i)
    await restored.exec(exported.sql)
    const readBack = await describeWorkbenchDatabase(database(restored))
    expect(readBack.issues).toEqual([])
    expect(readBack.tables).toEqual(exported.tables.map(table => ({ ...table, row_count: 0 })))
    expect(readBack.sequences).toEqual(exported.sequences)
    expect(readBack.sql).toBe(exported.sql)
    expect((await restored.query(`SELECT pg_get_serial_sequence('public."z parent"','id') AS sequence`)).rows[0]).toEqual({ sequence: 'public."z parent_id_seq"' })
    expect((await restored.query(`INSERT INTO "z parent"(code) VALUES ('new') RETURNING id,metadata,amount`)).rows[0]).toEqual({ id: 1, metadata: {}, amount: '0.00' })
  })

  it('round-trips the existing initial migration through an empty database', async () => {
    const source = memoryDatabase(), restored = memoryDatabase()
    await source.exec(await readFile('packages/contracts/migrations/001_initial.sql', 'utf8'))
    const exported = await describeWorkbenchDatabase(database(source))
    expect(exported.issues).toEqual([])
    expect(exported.tables).toHaveLength(6)
    expect(exported.sequences).toHaveLength(1)
    await restored.exec(exported.sql)
    const readBack = await describeWorkbenchDatabase(database(restored))
    expect(readBack.tables).toEqual(exported.tables)
    expect(readBack.sequences).toEqual(exported.sequences)
  })

  it('reports unsupported views, routines, triggers and enum types explicitly', async () => {
    const source = memoryDatabase()
    await source.exec(`
      CREATE TYPE status_kind AS ENUM ('open','closed');
      CREATE TABLE notes(id INTEGER PRIMARY KEY, status status_kind);
      CREATE VIEW note_ids AS SELECT id FROM notes;
      CREATE FUNCTION public.note_count() RETURNS bigint LANGUAGE SQL AS 'SELECT count(*) FROM public.notes';
      CREATE FUNCTION public.touch_note() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
      CREATE TRIGGER touch_note BEFORE UPDATE ON notes FOR EACH ROW EXECUTE FUNCTION public.touch_note();
    `)
    const exported = await describeWorkbenchDatabase(database(source))
    expect(exported.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'view', name: 'note_ids' }),
      expect.objectContaining({ kind: 'function', name: 'note_count' }),
      expect.objectContaining({ kind: 'function', name: 'touch_note' }),
      expect.objectContaining({ kind: 'trigger', name: 'touch_note' }),
      expect.objectContaining({ kind: 'enum', name: 'status_kind' }),
    ]))
    expect(exported.sql).toContain('Incomplete schema export:')
    expect(exported.sql).not.toContain('CREATE FUNCTION')
  })
})
