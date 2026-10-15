import { PGlite } from '@electric-sql/pglite';
import { readFile, writeFile, mkdir, readdir, cp, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';

const [operation, dataDirectory, bundleDirectory] = process.argv.slice(2);
if (!['export','restore'].includes(operation) || !dataDirectory || !bundleDirectory) throw new Error('Usage: node scripts/migrate-workbench-runtime.mjs export|restore DATA_DIRECTORY BUNDLE_DIRECTORY');
const data=resolve(dataDirectory), bundle=resolve(bundleDirectory);
const health=await fetch('http://127.0.0.1:4310/health',{signal:AbortSignal.timeout(800)}).then(r=>r.ok).catch(()=>false);
if(health)throw new Error('Stop the host before database migration.');
await mkdir(bundle,{recursive:true});
const inventory = async db => ({
  projects:(await db.query('SELECT count(*)::int AS n FROM projects')).rows[0].n,
  documents:(await db.query('SELECT count(*)::int AS n FROM documents')).rows[0].n,
  cards:(await db.query('SELECT count(*)::int AS n FROM experience_cards')).rows[0].n,
  project_rows:(await db.query('SELECT id,name,context_version FROM projects ORDER BY id')).rows,
});
if(operation==='export'){
  const db=new PGlite(join(data,'postgres'));
  try{
    const counts=await inventory(db);
    const blob=await db.dumpDataDir('gzip'), bytes=Buffer.from(await blob.arrayBuffer());
    await writeFile(join(bundle,'postgres.tgz'),bytes,{flag:'wx'});
    await cp(join(data,'blobs'),join(bundle,'blobs'),{recursive:true,errorOnExist:true,force:false});
    if(await stat(join(data,'amap-credentials.json')).catch(()=>null)) await cp(join(data,'amap-credentials.json'),join(bundle,'amap-credentials.json'),{errorOnExist:true,force:false});
    await writeFile(join(bundle,'manifest.json'),JSON.stringify({schema:'workbench-runtime-backup/1',created_at:new Date().toISOString(),postgres_sha256:createHash('sha256').update(bytes).digest('hex'),counts},null,2));
    console.log(JSON.stringify({operation,...counts,archive_bytes:bytes.length}));
  }finally{await db.close()}
}else{
  const pgDir=join(data,'postgres');
  if((await readdir(pgDir).catch(()=>[])).length)throw new Error('Restore target must be empty; retain the prior directory as a backup.');
  const manifest=JSON.parse(await readFile(join(bundle,'manifest.json'),'utf8'));
  const bytes=await readFile(join(bundle,'postgres.tgz'));
  if(createHash('sha256').update(bytes).digest('hex')!==manifest.postgres_sha256)throw new Error('Backup hash mismatch.');
  const db=new PGlite({dataDir:pgDir,loadDataDir:new Blob([bytes])});
  try{
    const counts=await inventory(db);
    if(JSON.stringify(counts)!==JSON.stringify(manifest.counts))throw new Error('Restored database inventory mismatch.');
    await cp(join(bundle,'blobs'),join(data,'blobs'),{recursive:true,errorOnExist:true,force:false});
    if(await stat(join(bundle,'amap-credentials.json')).catch(()=>null))await cp(join(bundle,'amap-credentials.json'),join(data,'amap-credentials.json'),{errorOnExist:true,force:false});
    console.log(JSON.stringify({operation,verified:true,...counts}));
  }finally{await db.close()}
}
