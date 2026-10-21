import { PGlite } from '@electric-sql/pglite';
import { cp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const task = 'D:/建工ai/output/documents/case-six-dim';
const snapshot = path.join(task, 'library-snapshot');
await mkdir(task, { recursive: true });
await cp('D:/建工ai/data/local/postgres', snapshot, { recursive: true, errorOnExist: true, force: false });
const db = new PGlite(snapshot);
try {
  await db.exec('BEGIN READ ONLY');
  const projects = (await db.query(`SELECT p.id,p.name,p.input->>'synthetic' AS synthetic,
    p.input->>'business_profile' AS profile,COUNT(c.id)::int AS cards
    FROM projects p LEFT JOIN experience_cards c ON c.project_id=p.id
    GROUP BY p.id,p.name,p.input ORDER BY p.id`)).rows;
  const selected = projects.filter(p => ['P-73678dc3-b255-4ae4-848b-86f26266f0c0',
    'P-CASE-RULE-LIBRARY-20261008','P-HZ-CUIYUAN-HISTORY-20261002'].includes(p.id));
  const records = [];
  for (const project of selected) {
    const cards = (await db.query('SELECT payload FROM experience_cards WHERE project_id=$1 ORDER BY id', [project.id])).rows.map(r => r.payload);
    const documents = (await db.query('SELECT id,file_name,sha256,parser_result FROM documents WHERE project_id=$1 ORDER BY id',[project.id])).rows;
    const policies = (await db.query('SELECT payload FROM knowledge_policies WHERE project_id=$1 ORDER BY id',[project.id])).rows.map(r=>r.payload);
    records.push({project,cards,documents,policies});
  }
  await db.exec('ROLLBACK');
  await writeFile(path.join(task,'current-case-library.json'),JSON.stringify({read_mode:'read-only query on local DB copy',projects,records},null,2));
  console.log(JSON.stringify({projects,records:records.map(r=>({project:r.project,documents:r.documents.map(d=>({id:d.id,title:d.file_name})),cards:r.cards.map(c=>({id:c.id,title:c.title,status:c.status,kind:c.knowledge?.kind,measure:c.knowledge?.measure_key})),policies:r.policies.length}))},null,2));
} finally { await db.close(); }
