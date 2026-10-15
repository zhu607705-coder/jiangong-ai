import type { Database } from './store'

export interface DatabaseSchemaColumn {
  name: string
  ordinal_position: number
  data_type: string
  nullable: boolean
  default: string | null
  collation: string | null
  identity: string
  generated: string
}
export interface DatabaseSchemaConstraint { name: string; type: string; definition: string }
export interface DatabaseSchemaIndex { name: string; definition: string; is_constraint: boolean }
export interface DatabaseSchemaTable {
  name: string
  columns: DatabaseSchemaColumn[]
  row_count: number
  constraints: DatabaseSchemaConstraint[]
  indexes: DatabaseSchemaIndex[]
}
export interface DatabaseSchemaSequence {
  name: string
  data_type: string
  start: string
  increment: string
  minimum: string
  maximum: string
  cache: string
  cycle: boolean
  owned_by: { schema: string; table: string; column: string } | null
}
export interface DatabaseSchemaIssue { kind: string; name: string; detail: string }
export interface WorkbenchDatabaseSchema {
  generated_at: string
  schema: 'public'
  tables: DatabaseSchemaTable[]
  sequences: DatabaseSchemaSequence[]
  issues: DatabaseSchemaIssue[]
  sql: string
}

const identifier = (value: string) => `"${value.replaceAll('"', '""')}"`
const publicName = (name: string) => `${identifier('public')}.${identifier(name)}`

/** Fixed public-schema inspection of the host's existing connection. No caller SQL or data-directory access. */
export async function describeWorkbenchDatabase(db: Database): Promise<WorkbenchDatabaseSchema> {
  const relations = (await db.query<{ name: string; persistence: string }>(`
    SELECT c.relname AS name, c.relpersistence AS persistence
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r' ORDER BY c.relname
  `)).rows
  const columns = (await db.query<DatabaseSchemaColumn & { table_name: string }>(`
    SELECT c.relname AS table_name, a.attname AS name, a.attnum::integer AS ordinal_position,
      pg_catalog.format_type(a.atttypid,a.atttypmod) AS data_type, NOT a.attnotnull AS nullable,
      pg_catalog.pg_get_expr(d.adbin,d.adrelid) AS "default",
      CASE WHEN a.attcollation<>t.typcollation THEN
        pg_catalog.quote_ident(cn.nspname)||'.'||pg_catalog.quote_ident(co.collname) ELSE NULL END AS collation,
      a.attidentity AS identity, a.attgenerated AS generated
    FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid=a.attrelid
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_catalog.pg_type t ON t.oid=a.atttypid
    LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    LEFT JOIN pg_catalog.pg_collation co ON co.oid=a.attcollation
    LEFT JOIN pg_catalog.pg_namespace cn ON cn.oid=co.collnamespace
    WHERE n.nspname='public' AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped
    ORDER BY c.relname,a.attnum
  `)).rows
  const constraints = (await db.query<DatabaseSchemaConstraint & { table_name: string }>(`
    SELECT c.relname AS table_name, k.conname AS name, k.contype AS type,
      pg_catalog.pg_get_constraintdef(k.oid) AS definition
    FROM pg_catalog.pg_constraint k JOIN pg_catalog.pg_class c ON c.oid=k.conrelid
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r' AND k.contype IN ('p','u','c','f','x')
    ORDER BY c.relname,k.conname
  `)).rows
  const indexes = (await db.query<DatabaseSchemaIndex & { table_name: string }>(`
    SELECT c.relname AS table_name, i.relname AS name,
      pg_catalog.pg_get_indexdef(i.oid) AS definition,
      EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k WHERE k.conindid=i.oid AND k.contype IN ('p','u','x')) AS is_constraint
    FROM pg_catalog.pg_index ix JOIN pg_catalog.pg_class c ON c.oid=ix.indrelid
    JOIN pg_catalog.pg_class i ON i.oid=ix.indexrelid
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r' ORDER BY c.relname,i.relname
  `)).rows
  const sequenceRows = (await db.query<Omit<DatabaseSchemaSequence, 'owned_by'> & {
    owner_schema: string | null; owner_table: string | null; owner_column: string | null
  }>(`
    SELECT c.relname AS name, pg_catalog.format_type(s.seqtypid,NULL) AS data_type,
      s.seqstart::text AS start, s.seqincrement::text AS increment,
      s.seqmin::text AS minimum, s.seqmax::text AS maximum, s.seqcache::text AS cache, s.seqcycle AS cycle,
      tn.nspname AS owner_schema, tc.relname AS owner_table, a.attname AS owner_column
    FROM pg_catalog.pg_sequence s JOIN pg_catalog.pg_class c ON c.oid=s.seqrelid
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    LEFT JOIN pg_catalog.pg_depend dep ON dep.classid='pg_catalog.pg_class'::regclass
      AND dep.objid=c.oid AND dep.objsubid=0 AND dep.refclassid='pg_catalog.pg_class'::regclass AND dep.deptype IN ('a','i')
    LEFT JOIN pg_catalog.pg_class tc ON tc.oid=dep.refobjid
    LEFT JOIN pg_catalog.pg_namespace tn ON tn.oid=tc.relnamespace
    LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid=tc.oid AND a.attnum=dep.refobjsubid
    WHERE n.nspname='public' ORDER BY c.relname
  `)).rows
  const issues = (await db.query<DatabaseSchemaIssue>(`
    SELECT CASE c.relkind WHEN 'v' THEN 'view' WHEN 'm' THEN 'materialized_view'
      WHEN 'p' THEN 'partitioned_table' ELSE 'foreign_table' END AS kind,
      c.relname AS name, 'This relation kind is not included in the schema SQL.' AS detail
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('v','m','p','f')
    UNION ALL
    SELECT CASE p.prokind WHEN 'p' THEN 'procedure' ELSE 'function' END, p.proname,
      'Routine is not exported: '||pg_catalog.pg_get_function_identity_arguments(p.oid)
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
    UNION ALL
    SELECT CASE t.typtype WHEN 'e' THEN 'enum' WHEN 'd' THEN 'domain' ELSE 'custom_type' END, t.typname,
      'Custom type definition is not included in the schema SQL.'
    FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid=t.typnamespace
    WHERE n.nspname='public' AND t.typtype IN ('e','d','r','m','b') AND (t.typtype<>'b' OR t.typelem=0)
    UNION ALL
    SELECT 'trigger', t.tgname, 'Trigger on table '||c.relname||' is not included in the schema SQL.'
    FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal
    UNION ALL
    SELECT 'table_features', c.relname, 'Inheritance, partitioning, row security or storage options are not exported.'
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r' AND (c.relispartition OR c.relrowsecurity OR c.relforcerowsecurity
      OR c.reloptions IS NOT NULL OR EXISTS (SELECT 1 FROM pg_catalog.pg_inherits h WHERE h.inhrelid=c.oid))
    ORDER BY kind,name,detail
  `)).rows

  const tables: DatabaseSchemaTable[] = []
  for (const relation of relations) {
    // Names originate only from the fixed public catalog query and are quoted as identifiers.
    const count = (await db.query<{ count: string }>(`SELECT count(*)::text AS count FROM ${publicName(relation.name)}`)).rows[0].count
    const rowCount = Number(count)
    if (!Number.isSafeInteger(rowCount)) throw new Error('Database row count exceeds the supported integer range')
    tables.push({ name: relation.name, row_count: rowCount,
      columns: columns.filter(column => column.table_name === relation.name).map(({ table_name: _, ...column }) => column),
      constraints: constraints.filter(constraint => constraint.table_name === relation.name).map(({ table_name: _, ...constraint }) => constraint),
      indexes: indexes.filter(index => index.table_name === relation.name).map(({ table_name: _, ...index }) => index),
    })
  }
  const sequences: DatabaseSchemaSequence[] = sequenceRows.map(({ owner_schema, owner_table, owner_column, ...sequence }) => ({
    ...sequence, owned_by: owner_schema && owner_table && owner_column ? { schema: owner_schema, table: owner_table, column: owner_column } : null,
  }))
  for (const table of tables) for (const column of table.columns) {
    if (column.identity) issues.push({ kind: 'identity', name: `${table.name}.${column.name}`, detail: 'Identity column generation is not included in the schema SQL.' })
  }
  for (const sequence of sequences) if (sequence.owned_by && sequence.owned_by.schema !== 'public') {
    issues.push({ kind: 'sequence_owner', name: sequence.name, detail: 'Sequence ownership outside public is not exported.' })
  }

  const statements = ['-- Workbench public schema only; excludes rows, sequence current values, roles, grants and credentials.',
    ...(issues.length ? [`-- Incomplete schema export: ${issues.length} unsupported objects/features; inspect the JSON issues list.`] : []),
    'CREATE SCHEMA IF NOT EXISTS "public";', 'SET search_path TO "public", "pg_catalog";']
  for (const sequence of sequences) statements.push(`CREATE SEQUENCE ${publicName(sequence.name)} AS ${sequence.data_type}
  INCREMENT BY ${sequence.increment} MINVALUE ${sequence.minimum} MAXVALUE ${sequence.maximum}
  START WITH ${sequence.start} CACHE ${sequence.cache} ${sequence.cycle ? 'CYCLE' : 'NO CYCLE'};`)
  for (const table of tables) {
    const definitions = table.columns.map(column => `${identifier(column.name)} ${column.data_type}`
      + (column.collation ? ` COLLATE ${column.collation}` : '')
      + (column.generated ? ` GENERATED ALWAYS AS (${column.default}) STORED` : column.default !== null ? ` DEFAULT ${column.default}` : '')
      + (column.nullable ? '' : ' NOT NULL'))
    const unlogged = relations.find(relation => relation.name === table.name)?.persistence === 'u'
    statements.push(`CREATE ${unlogged ? 'UNLOGGED ' : ''}TABLE ${publicName(table.name)} (\n  ${definitions.join(',\n  ')}\n);`)
  }
  // All referenced tables and their PK/UQ constraints must exist before any FK is added.
  for (const foreignKeys of [false, true]) for (const table of tables) for (const constraint of table.constraints) {
    if ((constraint.type === 'f') === foreignKeys) statements.push(`ALTER TABLE ONLY ${publicName(table.name)} ADD CONSTRAINT ${identifier(constraint.name)} ${constraint.definition};`)
  }
  for (const table of tables) for (const index of table.indexes) if (!index.is_constraint) statements.push(`${index.definition};`)
  for (const sequence of sequences) if (sequence.owned_by?.schema === 'public') {
    statements.push(`ALTER SEQUENCE ${publicName(sequence.name)} OWNED BY ${publicName(sequence.owned_by.table)}.${identifier(sequence.owned_by.column)};`)
  }
  return { generated_at: new Date().toISOString(), schema: 'public', tables, sequences, issues, sql: `${statements.join('\n\n')}\n` }
}
